import { isUtf8 } from "node:buffer";
import { lookup } from "node:dns/promises";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { isIP } from "node:net";
import { isAbsolute, join, relative, sep } from "node:path";
import { SkillValidationError, validateSkillDocument } from "./skill-document.ts";
import {
  normalizeSkillPackagePath,
  type SkillPackageStore,
  type StagedSkillPackage,
} from "./skill-package-store.ts";

const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_REGULAR_FILES = 100;
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
const COMMIT_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

export interface GitInvocation {
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  run(invocation: GitInvocation): Promise<GitResult>;
}

export interface GitSkillInstallRequest {
  repositoryUrl: string;
  ref?: string;
  subdirectory?: string;
}

export interface GitSkillRemoteRequest extends GitSkillInstallRequest {
  activeCommit?: string;
  candidateCommit?: string;
}

export interface ResolvedGitRemote {
  commit: string;
  changed: boolean;
}

export type SkillGitImportErrorCode =
  | "invalid_git_url"
  | "invalid_git_host"
  | "invalid_git_ref"
  | "invalid_git_subdirectory"
  | "invalid_git_commit"
  | "invalid_git_package"
  | "skill_package_too_large"
  | "git_unavailable"
  | "git_timeout"
  | "git_output_too_large"
  | "git_redirect"
  | "git_failed";

export class SkillGitImportError extends Error {
  constructor(public readonly code: SkillGitImportErrorCode, message: string) {
    super(message);
    this.name = "SkillGitImportError";
  }
}

interface BunGitRunnerOptions {
  executable?: string;
  maxOutputBytes?: number;
}

export interface GitHostAddress {
  address: string;
  family: 4 | 6;
}

export interface GitSkillImporterOptions {
  resolveHostname?: (hostname: string) => Promise<readonly GitHostAddress[]>;
}

function gitError(code: SkillGitImportErrorCode, message: string): never {
  throw new SkillGitImportError(code, message);
}

function secretFragments(env: Readonly<Record<string, string>> | undefined): string[] {
  const fragments = new Set<string>();
  for (const value of Object.values(env ?? {})) {
    const bearer = value.match(/^Authorization: Bearer (.+)$/i)?.[1];
    if (!bearer) continue;
    fragments.add(value);
    fragments.add(bearer);
  }
  return [...fragments].sort((left, right) => right.length - left.length);
}

function redact(text: string, secrets: readonly string[]): string {
  let sanitized = text;
  for (const secret of secrets) sanitized = sanitized.split(secret).join("[REDACTED]");
  return sanitized;
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  terminate: () => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        terminate();
        gitError("git_output_too_large", "Git process output exceeded its configured limit");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class BunGitRunner implements GitRunner {
  private readonly executable: string;
  private readonly maxOutputBytes: number;

  constructor(options: BunGitRunnerOptions = {}) {
    this.executable = options.executable ?? "git";
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  async run(invocation: GitInvocation): Promise<GitResult> {
    const childEnv: Record<string, string | undefined> = {};
    for (const key of [
      "PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "WINDIR",
      "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
    ]) {
      if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    }
    for (const [key, value] of Object.entries(invocation.env ?? {})) {
      if (
        key === "GIT_CONFIG_COUNT" || key === "GIT_CONFIG_NOSYSTEM" || key === "GIT_CONFIG_GLOBAL" ||
        key === "GIT_TERMINAL_PROMPT" || key === "GCM_INTERACTIVE" ||
        /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
      ) childEnv[key] = value;
    }

    let child!: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn({
        cmd: [this.executable, ...invocation.args],
        cwd: invocation.cwd,
        env: childEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
    } catch {
      gitError("git_unavailable", "Git executable is unavailable");
    }

    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationComplete: Promise<void> | undefined;
    const outputAbort = new AbortController();
    const signalProcessTree = (signal: NodeJS.Signals | number): void => {
      if (process.platform !== "win32") {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall through when the process group has already disappeared.
        }
      }
      try {
        child.kill(signal);
      } catch {
        // The direct child already exited.
      }
    };
    const terminate = () => {
      if (terminationComplete) return;
      outputAbort.abort();
      signalProcessTree("SIGTERM");
      terminationComplete = new Promise((resolveTermination) => {
        forceKillTimer = setTimeout(() => {
          signalProcessTree("SIGKILL");
          resolveTermination();
        }, 100);
      });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, invocation.timeoutMs);
    const secrets = secretFragments(invocation.env);
    // stdout/stderr are streams because this spawn invocation fixes both options to "pipe".
    const stdout = child.stdout as ReadableStream<Uint8Array>;
    const stderr = child.stderr as ReadableStream<Uint8Array>;
    try {
      const [exitCode, stdoutBytes, stderrBytes] = await Promise.all([
        child.exited,
        readBounded(stdout, this.maxOutputBytes, terminate, outputAbort.signal),
        readBounded(stderr, this.maxOutputBytes, terminate, outputAbort.signal),
      ]);
      if (timedOut) gitError("git_timeout", "Git process exceeded its timeout");
      const decoder = new TextDecoder("utf-8", { fatal: false });
      return {
        exitCode,
        stdout: redact(decoder.decode(stdoutBytes), secrets),
        stderr: redact(decoder.decode(stderrBytes), secrets),
      };
    } catch (error) {
      terminate();
      try {
        await child.exited;
      } catch {
        // Process exit failures are mapped below without child output.
      }
      if (terminationComplete) await terminationComplete;
      if (timedOut) gitError("git_timeout", "Git process exceeded its timeout");
      if (error instanceof SkillGitImportError) throw error;
      gitError("git_failed", "Git process could not be completed");
    } finally {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    }
    gitError("git_failed", "Git process could not be completed");
  }
}

function normalizeRepositoryUrl(repositoryUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    gitError("invalid_git_url", "Git repository URL must use HTTPS");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hostname === "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    gitError("invalid_git_url", "Git repository URL must be credential-free HTTPS");
  }
  if (containsConfiguredToken(repositoryUrl)) {
    gitError("invalid_git_url", "Git repository URL must not contain configured credentials");
  }
  return parsed;
}

function containsConfiguredToken(value: string): boolean {
  const token = process.env.YOUBAN_SKILL_GIT_TOKEN;
  return Boolean(token && value.includes(token));
}

function normalizeConfiguredHost(configuredHost: string | undefined): string | undefined {
  if (!configuredHost) return undefined;
  try {
    const parsed = new URL(`https://${configuredHost}`);
    if (
      parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || !parsed.hostname
    ) return undefined;
    return parsed.host;
  } catch {
    return undefined;
  }
}

function remoteEnvironment(
  repositoryUrl: URL,
  pinnedAddresses: readonly GitHostAddress[],
): Readonly<Record<string, string>> {
  const entries: Array<readonly [string, string]> = [];
  const token = process.env.YOUBAN_SKILL_GIT_TOKEN;
  const tokenHost = normalizeConfiguredHost(process.env.YOUBAN_SKILL_GIT_TOKEN_HOST);
  const originScope = `${repositoryUrl.origin}/`;
  if (token && tokenHost === repositoryUrl.host) {
    entries.push([`http.${originScope}.extraHeader`, `Authorization: Bearer ${token}`]);
  }
  entries.push([`http.${originScope}.followRedirects`, "false"]);
  entries.push(["credential.helper", ""]);
  const hostname = repositoryUrl.hostname.replace(/^\[|\]$/g, "");
  const port = repositoryUrl.port || "443";
  const addresses = pinnedAddresses.map(({ address, family }) => family === 6 ? `[${address}]` : address);
  entries.push([
    `http.${originScope}.curloptResolve`,
    `+${hostname}:${port}:${addresses.join(",")}`,
  ]);

  const env: Record<string, string> = {
    GIT_CONFIG_COUNT: String(entries.length),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  };
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function ipv4Parts(address: string): readonly number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  const parts = address.split(".").map(Number);
  return parts.length === 4 ? parts : undefined;
}

function ipv6Groups(address: string): readonly number[] | undefined {
  if (isIP(address) !== 6 || address.includes("%")) return undefined;
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (value: string): number[] | undefined => {
    if (!value) return [];
    const groups: number[] = [];
    for (const part of value.split(":")) {
      if (part.includes(".")) {
        const ipv4 = ipv4Parts(part);
        if (!ipv4) return undefined;
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
        groups.push(Number.parseInt(part, 16));
      }
    }
    return groups;
  };
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return undefined;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function isPublicAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4) {
    const [a, b] = ipv4;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0)
    );
  }
  const ipv6 = ipv6Groups(address);
  if (!ipv6) return false;
  const [first, second] = ipv6;
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && second <= 0x01ff) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && second <= 0x0fff) return false;
  return true;
}

function canonicalHostname(repositoryUrl: URL): string {
  return repositoryUrl.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

async function validateAndResolveHost(
  repositoryUrl: URL,
  resolveHostname: (hostname: string) => Promise<readonly GitHostAddress[]>,
): Promise<readonly GitHostAddress[]> {
  const hostname = canonicalHostname(repositoryUrl);
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
    hostname.endsWith(".internal") || hostname.endsWith(".lan") || hostname.endsWith(".home") ||
    hostname.endsWith(".home.arpa") || (!hostname.includes(".") && isIP(hostname) === 0)
  ) gitError("invalid_git_host", "Git repository host must resolve only to public addresses");

  let addresses: readonly GitHostAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily as 4 | 6 }];
  } else {
    try {
      addresses = await resolveHostname(hostname);
    } catch {
      gitError("invalid_git_host", "Git repository host could not be safely resolved");
    }
  }
  const unique = [...new Map(addresses.map((item) => [`${item.family}:${item.address}`, item])).values()];
  if (
    unique.length === 0 ||
    unique.some(({ address, family }) => isIP(address) !== family || !isPublicAddress(address))
  ) gitError("invalid_git_host", "Git repository host must resolve only to public addresses");
  return unique;
}

function validateRef(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const fullRef = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
  const invalidComponent = fullRef.split("/").some(
    (component) => !component || component.startsWith(".") || component.endsWith(".lock"),
  );
  if (
    !ref || ref !== ref.trim() || ref.startsWith("-") || ref.startsWith("+") || ref === "@" ||
    /[\x00-\x20\x7f~^:?*[\\]/.test(ref) || ref.includes("..") || ref.includes("@{") ||
    ref.endsWith(".") || ref.endsWith("/") || invalidComponent
  ) {
    gitError("invalid_git_ref", "Git ref is invalid");
  }
  if (containsConfiguredToken(ref)) gitError("invalid_git_ref", "Git ref must not contain configured credentials");
  return ref;
}

function validateSubdirectory(subdirectory: string | undefined): string | undefined {
  if (subdirectory === undefined) return undefined;
  try {
    const normalized = normalizeSkillPackagePath(subdirectory);
    if (normalized === ".git" || normalized.startsWith(".git/")) throw new Error("repository metadata");
    if (containsConfiguredToken(normalized)) throw new Error("configured credential");
    return normalized;
  } catch {
    gitError("invalid_git_subdirectory", "Git skill subdirectory must stay within the repository");
  }
}

function validateCommit(commit: string): string {
  if (!COMMIT_PATTERN.test(commit)) gitError("invalid_git_commit", "Git did not resolve a complete commit SHA");
  return commit;
}

function resolveContainedDirectory(cloneDir: string, subdirectory: string | undefined): string {
  if (!subdirectory) return cloneDir;
  let current = cloneDir;
  for (const component of subdirectory.split("/")) {
    current = join(current, component);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(current);
    } catch {
      gitError("invalid_git_subdirectory", "Git skill subdirectory does not exist");
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      gitError("invalid_git_subdirectory", "Git skill subdirectory must be a real directory");
    }
  }
  const cloneReal = realpathSync(cloneDir);
  const currentReal = realpathSync(current);
  const pathRelative = relative(cloneReal, currentReal);
  if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
    gitError("invalid_git_subdirectory", "Git skill subdirectory escapes the repository");
  }
  return current;
}

interface PackageEntry {
  path: string;
  content: Buffer;
}

function collectRegularFiles(root: string): PackageEntry[] {
  const files: PackageEntry[] = [];
  let totalBytes = 0;

  const visit = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = join(directory, name);
      const packagePath = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolutePath);
      if (name === ".git") {
        rmSync(absolutePath, { recursive: true, force: true });
        continue;
      }
      if (stat.isSymbolicLink()) gitError("invalid_git_package", "Git skill package contains a symbolic link");
      if (stat.isDirectory()) {
        visit(absolutePath, packagePath);
        continue;
      }
      if (!stat.isFile()) gitError("invalid_git_package", "Git skill package contains a non-regular file");
      if (
        files.length >= MAX_REGULAR_FILES || stat.size < 0 ||
        stat.size > MAX_PACKAGE_BYTES - totalBytes
      ) {
        gitError("skill_package_too_large", "Git skill package exceeds the package limits");
      }
      let descriptor: number;
      try {
        descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch {
        gitError("invalid_git_package", "Git skill package file could not be opened safely");
      }
      let content: Buffer;
      try {
        const beforeRead = fstatSync(descriptor);
        if (
          !beforeRead.isFile() || beforeRead.dev !== stat.dev || beforeRead.ino !== stat.ino ||
          beforeRead.size !== stat.size
        ) gitError("invalid_git_package", "Git skill package file changed during staging");
        if (beforeRead.size > MAX_PACKAGE_BYTES - totalBytes) {
          gitError("skill_package_too_large", "Git skill package exceeds the package limits");
        }
        content = readFileSync(descriptor);
        const afterRead = fstatSync(descriptor);
        if (
          afterRead.dev !== beforeRead.dev || afterRead.ino !== beforeRead.ino ||
          afterRead.size !== beforeRead.size || content.length !== beforeRead.size
        ) gitError("invalid_git_package", "Git skill package file changed during staging");
      } finally {
        closeSync(descriptor);
      }
      totalBytes += content.length;
      files.push({ path: packagePath, content });
    }
  };

  visit(root, "");
  return files;
}

function remotePatterns(ref: string | undefined): readonly string[] {
  if (!ref) return ["HEAD"];
  if (COMMIT_PATTERN.test(ref)) return [];
  if (ref.startsWith("refs/tags/")) return [ref, `${ref}^{}`];
  if (ref.startsWith("refs/")) return [ref];
  return [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`];
}

type GitRefAcquisition =
  | { kind: "default" }
  | { kind: "branch-or-tag"; branchArgument: string }
  | { kind: "explicit"; fetchRef: string };

function classifyRefAcquisition(ref: string | undefined): GitRefAcquisition {
  if (!ref) return { kind: "default" };
  if (COMMIT_PATTERN.test(ref)) return { kind: "explicit", fetchRef: ref };
  if (ref.startsWith("refs/")) return { kind: "explicit", fetchRef: ref };
  return { kind: "branch-or-tag", branchArgument: ref };
}

export class GitSkillImporter {
  private readonly resolveHostname: (hostname: string) => Promise<readonly GitHostAddress[]>;

  constructor(
    private readonly store: SkillPackageStore,
    private readonly runner: GitRunner = new BunGitRunner(),
    options: GitSkillImporterOptions = {},
  ) {
    this.resolveHostname = options.resolveHostname ?? (async (hostname) => {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
    });
  }

  async stage(request: GitSkillInstallRequest): Promise<StagedSkillPackage> {
    const repositoryUrl = normalizeRepositoryUrl(request.repositoryUrl);
    const pinnedAddresses = await validateAndResolveHost(repositoryUrl, this.resolveHostname);
    const ref = validateRef(request.ref);
    const subdirectory = validateSubdirectory(request.subdirectory);
    const acquisition = classifyRefAcquisition(ref);
    const checkoutRoot = mkdtempSync(join(tmpdir(), "youban-skill-git-checkout-"));
    const cloneDir = join(checkoutRoot, "repository");

    try {
      const cloneArgs = ["clone", "--depth=1", "--filter=blob:none", "--no-tags"];
      if (acquisition.kind === "branch-or-tag") cloneArgs.push("--branch", acquisition.branchArgument);
      if (acquisition.kind === "explicit") cloneArgs.push("--no-checkout");
      cloneArgs.push(repositoryUrl.href, cloneDir);
      await this.runGit(cloneArgs, undefined, remoteEnvironment(repositoryUrl, pinnedAddresses));

      if (acquisition.kind === "explicit") {
        await this.runGit(
          ["fetch", "--depth=1", "origin", acquisition.fetchRef],
          cloneDir,
          remoteEnvironment(repositoryUrl, pinnedAddresses),
        );
        await this.runGit(["checkout", "--detach", "FETCH_HEAD"], cloneDir);
      }

      const resolved = await this.runGit(["rev-parse", "HEAD"], cloneDir);
      const commit = validateCommit(resolved.stdout.trim());
      rmSync(join(cloneDir, ".git"), { recursive: true, force: true });
      const packageRoot = resolveContainedDirectory(cloneDir, subdirectory);
      const entries = collectRegularFiles(packageRoot);
      const skillEntries = entries.filter(({ path }) => path === "SKILL.md");
      const allSkillDocuments = entries.filter(({ path }) => path === "SKILL.md" || path.endsWith("/SKILL.md"));
      if (skillEntries.length !== 1 || allSkillDocuments.length !== 1) {
        gitError("invalid_git_package", "Git skill package must contain one root SKILL.md");
      }
      if (!isUtf8(skillEntries[0].content)) {
        throw new SkillValidationError("invalid_skill_encoding", "skill document must be valid UTF-8 text");
      }
      const document = validateSkillDocument(skillEntries[0].content.toString("utf8"));

      const stagingDir = this.store.createStagingDirectory();
      try {
        for (const entry of entries) this.store.writeFile(stagingDir, entry.path, entry.content);
        return {
          stagingDir,
          document,
          files: entries.map(({ path }) => path),
          source: "git",
          sanitizedSource: repositoryUrl.href,
          sourceRef: ref,
          sourceCommit: commit,
          cleanup: () => this.store.cleanupStaging(stagingDir),
        };
      } catch (error) {
        this.store.cleanupStaging(stagingDir);
        throw error;
      }
    } finally {
      rmSync(checkoutRoot, { recursive: true, force: true });
    }
  }

  async resolveRemote(request: GitSkillRemoteRequest): Promise<ResolvedGitRemote> {
    const repositoryUrl = normalizeRepositoryUrl(request.repositoryUrl);
    const pinnedAddresses = await validateAndResolveHost(repositoryUrl, this.resolveHostname);
    const ref = validateRef(request.ref);
    validateSubdirectory(request.subdirectory);
    let commit: string;
    if (ref && COMMIT_PATTERN.test(ref)) {
      commit = validateCommit(ref);
    } else {
      const result = await this.runGit(
        ["ls-remote", repositoryUrl.href, ...remotePatterns(ref)],
        undefined,
        remoteEnvironment(repositoryUrl, pinnedAddresses),
      );
      const advertised = result.stdout
        .split("\n")
        .map((line) => line.trim().split(/\s+/, 2))
        .filter((parts): parts is [string, string] => parts.length === 2 && COMMIT_PATTERN.test(parts[0]));
      const byReference = new Map(advertised.map(([sha, reference]) => [reference, sha]));
      const tagReference = ref?.startsWith("refs/tags/") ? ref : ref ? `refs/tags/${ref}` : undefined;
      const branchReference = ref?.startsWith("refs/heads/") ? ref : ref && !ref.startsWith("refs/")
        ? `refs/heads/${ref}`
        : undefined;
      const advertisedTag = tagReference && (
        byReference.has(tagReference) || byReference.has(`${tagReference}^{}`)
      );
      if (ref?.startsWith("refs/tags/") || (branchReference && !byReference.has(branchReference) && advertisedTag)) {
        if (!tagReference || !advertisedTag) {
          gitError("invalid_git_commit", "Git remote did not advertise the requested complete commit SHA");
        }
        commit = await this.resolveTagCommit(repositoryUrl, tagReference, pinnedAddresses);
      } else {
        const resolved = !ref
          ? byReference.get("HEAD")
          : branchReference
            ? byReference.get(branchReference)
            : byReference.get(ref);
        if (!resolved) gitError("invalid_git_commit", "Git remote did not advertise the requested complete commit SHA");
        commit = validateCommit(resolved);
      }
    }
    return {
      commit,
      changed: commit !== request.activeCommit && commit !== request.candidateCommit,
    };
  }

  private async resolveTagCommit(
    repositoryUrl: URL,
    tagReference: string,
    pinnedAddresses: readonly GitHostAddress[],
  ): Promise<string> {
    const resolutionDirectory = mkdtempSync(join(tmpdir(), "youban-skill-git-resolve-"));
    try {
      await this.runGit(["init", "--bare"], resolutionDirectory);
      await this.runGit(
        ["fetch", "--depth=1", "--no-tags", repositoryUrl.href, tagReference],
        resolutionDirectory,
        remoteEnvironment(repositoryUrl, pinnedAddresses),
      );
      let result: GitResult;
      try {
        result = await this.runGit(
          ["rev-parse", "--verify", "FETCH_HEAD^{commit}"],
          resolutionDirectory,
        );
      } catch (error) {
        if (error instanceof SkillGitImportError && error.code === "git_failed") {
          gitError("invalid_git_commit", "Git tag does not resolve to a complete commit SHA");
        }
        throw error;
      }
      return validateCommit(result.stdout.trim());
    } finally {
      rmSync(resolutionDirectory, { recursive: true, force: true });
    }
  }

  private async runGit(
    args: readonly string[],
    cwd?: string,
    env?: Readonly<Record<string, string>>,
  ): Promise<GitResult> {
    let result: GitResult;
    try {
      result = await this.runner.run({ args, cwd, env, timeoutMs: DEFAULT_GIT_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof SkillGitImportError) throw error;
      gitError("git_failed", "Git process could not be completed");
    }
    if (result.exitCode === 0) return result;
    if (/redirect|location:/i.test(result.stderr)) {
      gitError("git_redirect", "Git repository redirects are not accepted");
    }
    gitError("git_failed", "Git process failed");
  }
}
