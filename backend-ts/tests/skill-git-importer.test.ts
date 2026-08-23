import { afterEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BunGitRunner,
  GitSkillImporter,
  SkillGitImportError,
  type GitInvocation,
  type GitResult,
  type GitRunner,
} from "../src/agents/skill-git-importer.ts";
import { SkillPackageStore } from "../src/agents/skill-package-store.ts";
import { FakeGitRunner } from "./helpers/fake-git.ts";

const COMMIT_40 = "0123456789abcdef0123456789abcdef01234567";
const COMMIT_64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const VALID_SKILL = "---\nname: museum-guide\ndescription: A practical museum visit guide.\n---\n\n# Museum guide\n";
const temporaryRoots: string[] = [];
const savedGitToken = process.env.YOUBAN_SKILL_GIT_TOKEN;
const savedGitTokenHost = process.env.YOUBAN_SKILL_GIT_TOKEN_HOST;
const savedGitAskPass = process.env.GIT_ASKPASS;
const savedGitConfigParameters = process.env.GIT_CONFIG_PARAMETERS;
const guardedAmbientNames = [
  "GIT_TEMPLATE_DIR",
  "GIT_EXEC_PATH",
  "GIT_TRACE",
  "GIT_TRACE_CURL",
  "GIT_TRACE_CURL_NO_DATA",
  "GIT_TRACE_REDACT",
  "GIT_SSH_COMMAND",
  "UNRELATED_PRIVATE_ENV",
] as const;
const savedGuardedAmbient = Object.fromEntries(
  guardedAmbientNames.map((name) => [name, process.env[name]]),
);

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function successfulFake(options: {
  commit?: string;
  files?: Readonly<Record<string, string>>;
  onInvocation?: (invocation: GitInvocation) => void;
  cloneResult?: GitResult;
} = {}): FakeGitRunner {
  const commit = options.commit ?? COMMIT_40;
  const repositoryFiles = options.files ?? {
    "SKILL.md": VALID_SKILL,
    "scripts/run.sh": "exit 99",
  };
  let selectedFiles = repositoryFiles;
  return new FakeGitRunner(async (invocation) => {
    options.onInvocation?.(invocation);
    if (invocation.args[0] === "clone") {
      if (options.cloneResult) return options.cloneResult;
      const destination = invocation.args.at(-1)!;
      mkdirSync(join(destination, ".git"), { recursive: true });
      writeFileSync(join(destination, ".git", "config"), "credential = private-secret\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (invocation.args[0] === "rev-parse") {
      return { exitCode: 0, stdout: `${commit}\n`, stderr: "" };
    }
    if (invocation.args[0] === "ls-tree") {
      if (!invocation.args.includes("-r")) {
        const pathspec = invocation.args.at(-1)!;
        const subdirectory = pathspec.replace(/^:\(top,literal\)/, "");
        selectedFiles = Object.fromEntries(Object.entries(repositoryFiles)
          .filter(([path]) => path.startsWith(`${subdirectory}/`))
          .map(([path, content]) => [path.slice(subdirectory.length + 1), content]));
        const exists = Object.keys(selectedFiles).length > 0;
        return {
          exitCode: 0,
          stdout: exists ? `040000 tree ${commit}\t${subdirectory}\0` : "",
          stderr: "",
        };
      }
      const includeSizes = invocation.args.includes("-l");
      const stdout = Object.entries(selectedFiles).sort(([left], [right]) => left.localeCompare(right))
        .map(([path, content]) => [
          `100${path.endsWith(".sh") ? "755" : "644"} blob ${commit}`,
          includeSizes ? ` ${Buffer.byteLength(content)}` : "",
          `\t${path}\0`,
        ].join(""))
        .join("");
      return { exitCode: 0, stdout, stderr: "" };
    }
    if (invocation.args[0] === "checkout-index") {
      const prefix = invocation.args.find((argument) => argument.startsWith("--prefix="))!.slice("--prefix=".length);
      for (const [path, content] of Object.entries(selectedFiles)) {
        const target = join(prefix, ...path.split("/"));
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, content, { mode: path.endsWith(".sh") ? 0o755 : 0o600 });
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (invocation.args[0] === "ls-remote") {
      const advertisedRef = invocation.args.includes("HEAD")
        ? "HEAD"
        : invocation.args.find((argument) => argument.startsWith("refs/heads/"))
          ?? invocation.args.find((argument) => argument.startsWith("refs/tags/"));
      return { exitCode: 0, stdout: `${commit}\t${advertisedRef}\n`, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });
}

function runFixtureGit(cwd: string, args: readonly string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

function createRepositoryWithOversizedUnselectedFile(): string {
  const repository = join(temporaryRoot("youban-skill-git-source-"), "repository");
  mkdirSync(repository);
  runFixtureGit(repository, ["init", "--quiet"]);
  runFixtureGit(repository, ["config", "user.email", "skills@example.com"]);
  runFixtureGit(repository, ["config", "user.name", "Skill Fixture"]);
  mkdirSync(join(repository, "skills", "museum"), { recursive: true });
  writeFileSync(join(repository, "skills", "museum", "SKILL.md"), VALID_SKILL);
  const oversized = openSync(join(repository, "outside.bin"), "w");
  ftruncateSync(oversized, 10 * 1024 * 1024 + 1);
  closeSync(oversized);
  runFixtureGit(repository, ["add", "."]);
  runFixtureGit(repository, ["commit", "--quiet", "-m", "fixture"]);
  runFixtureGit(repository, ["config", "uploadpack.allowFilter", "true"]);
  runFixtureGit(repository, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
  runFixtureGit(repository, ["config", "uploadpack.allowReachableSHA1InWant", "true"]);
  return pathToFileURL(repository).href;
}

function createRepositoryWithOversizedSelectedFile(size: number, allowFilter: boolean): string {
  const repository = join(temporaryRoot("youban-skill-git-source-"), "repository");
  mkdirSync(join(repository, "skills", "museum"), { recursive: true });
  runFixtureGit(repository, ["init", "--quiet"]);
  runFixtureGit(repository, ["config", "user.email", "skills@example.com"]);
  runFixtureGit(repository, ["config", "user.name", "Skill Fixture"]);
  writeFileSync(join(repository, "skills", "museum", "SKILL.md"), VALID_SKILL);
  writeFileSync(join(repository, "skills", "museum", "oversized.bin"), randomBytes(size));
  runFixtureGit(repository, ["add", "."]);
  runFixtureGit(repository, ["commit", "--quiet", "-m", "fixture"]);
  if (allowFilter) {
    runFixtureGit(repository, ["config", "uploadpack.allowFilter", "true"]);
    runFixtureGit(repository, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
    runFixtureGit(repository, ["config", "uploadpack.allowReachableSHA1InWant", "true"]);
  }
  return pathToFileURL(repository).href;
}

function directorySize(root: string): number {
  if (!existsSync(root)) return 0;
  let total = 0;
  const visit = (directory: string): void => {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const name of names) {
      const path = join(directory, name);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(path);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
      if (stat.isDirectory()) visit(path);
      else total += stat.size;
    }
  };
  visit(root);
  return total;
}

class ObservedLocalGitRunner implements GitRunner {
  private readonly actual = new BunGitRunner();
  private acquisitionRoot: string | undefined;
  maxObservedAcquisitionBytes = 0;

  constructor(
    private readonly requestedUrl: string,
    private readonly fixtureUrl: string,
  ) {}

  async run(invocation: GitInvocation): Promise<GitResult> {
    if (invocation.args[0] === "clone") this.acquisitionRoot = dirname(invocation.args.at(-1)!);
    try {
      return await this.actual.run({
        ...invocation,
        args: invocation.args.map((argument) => argument === this.requestedUrl ? this.fixtureUrl : argument),
      });
    } finally {
      if (this.acquisitionRoot) {
        this.maxObservedAcquisitionBytes = Math.max(
          this.maxObservedAcquisitionBytes,
          directorySize(this.acquisitionRoot),
        );
      }
    }
  }
}

class RejectOutsideMaterializationRunner implements GitRunner {
  private readonly actual = new BunGitRunner();
  private checkoutDirectory: string | undefined;

  constructor(
    private readonly requestedUrl: string,
    private readonly fixtureUrl: string,
  ) {}

  async run(invocation: GitInvocation): Promise<GitResult> {
    const result = await this.actual.run({
      ...invocation,
      args: invocation.args.map((argument) => argument === this.requestedUrl ? this.fixtureUrl : argument),
    });
    if (invocation.args[0] === "clone") this.checkoutDirectory = invocation.args.at(-1);
    if (this.checkoutDirectory && existsSync(join(this.checkoutDirectory, "outside.bin"))) {
      throw new SkillGitImportError(
        "skill_package_too_large",
        "Git materialized oversized content outside the selected skill directory",
      );
    }
    return result;
  }
}

function createImporter(
  runner = successfulFake(),
  resolveHostname: (
    hostname: string,
  ) => Promise<readonly { address: string; family: 4 | 6 }[]> = async () => [
    { address: "93.184.216.34", family: 4 },
  ],
): {
  importer: GitSkillImporter;
  runner: FakeGitRunner;
  root: string;
} {
  const root = temporaryRoot("youban-skill-git-");
  const store = new SkillPackageStore(root);
  return {
    importer: new GitSkillImporter(store, runner, { resolveHostname }),
    runner,
    root,
  };
}

async function expectGitCode(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
}

afterEach(() => {
  if (savedGitToken === undefined) delete process.env.YOUBAN_SKILL_GIT_TOKEN;
  else process.env.YOUBAN_SKILL_GIT_TOKEN = savedGitToken;
  if (savedGitTokenHost === undefined) delete process.env.YOUBAN_SKILL_GIT_TOKEN_HOST;
  else process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = savedGitTokenHost;
  if (savedGitAskPass === undefined) delete process.env.GIT_ASKPASS;
  else process.env.GIT_ASKPASS = savedGitAskPass;
  if (savedGitConfigParameters === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
  else process.env.GIT_CONFIG_PARAMETERS = savedGitConfigParameters;
  for (const name of guardedAmbientNames) {
    const saved = savedGuardedAmbient[name];
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("GitSkillImporter source and credential boundaries", () => {
  it.each(["git@github.com:org/repo.git", "ssh://host/repo", "file:///tmp/repo", "../repo"])(
    "rejects non-HTTPS source %s",
    async (repositoryUrl) => {
      const { importer, runner } = createImporter();
      await expectGitCode(importer.stage({ repositoryUrl }), "invalid_git_url");
      expect(runner.invocations).toHaveLength(0);
    },
  );

  it.each([
    "https://user@host/repo.git",
    "https://user:password@host/repo.git",
  ])("rejects URL user information %s", async (repositoryUrl) => {
    const { importer, runner } = createImporter();
    await expectGitCode(importer.stage({ repositoryUrl }), "invalid_git_url");
    expect(runner.invocations).toHaveLength(0);
  });

  it("sends the private token only to the configured case-normalized exact host", async () => {
    const secret = "private-secret";
    process.env.YOUBAN_SKILL_GIT_TOKEN = secret;
    process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = "GIT.EXAMPLE.COM";
    let exactHeaderSeen = false;
    const exactRunner = successfulFake({
      onInvocation(invocation) {
        exactHeaderSeen ||= invocation.env?.GIT_CONFIG_VALUE_0 === `Authorization: Bearer ${secret}`;
      },
    });
    const exact = createImporter(exactRunner);
    const staged = await exact.importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" });

    expect(exactHeaderSeen).toBe(true);
    expect(exactRunner.invocations[0].authorizationHeaderKeys).toEqual(["GIT_CONFIG_VALUE_0"]);
    expect(exactRunner.invocations[0].env.GIT_CONFIG_KEY_0).toBe(
      "http.https://git.example.com/.extraHeader",
    );
    expect(exactRunner.invocations[0].env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(exactRunner.invocations[0].env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(exactRunner.invocations[0].envKeys).toContain("GIT_CONFIG_GLOBAL");
    expect(Object.entries(exactRunner.invocations[0].env)).toContainEqual([
      "GIT_CONFIG_KEY_2",
      "credential.helper",
    ]);
    const lazyFetchInvocations = exactRunner.invocations.filter(({ args }) =>
      (args[0] === "fetch" && args.includes("--refetch")) ||
      (args[0] === "ls-tree" && args.includes("-l")) || args[0] === "checkout-index"
    );
    expect(lazyFetchInvocations).toHaveLength(3);
    expect(lazyFetchInvocations.every(({ authorizationHeaderKeys }) => authorizationHeaderKeys.length === 1)).toBe(true);
    expect(lazyFetchInvocations.every(({ env, envKeys }) => envKeys.some(
      (key) => env[key]?.endsWith(".curloptResolve"),
    ))).toBe(true);
    expect(exactRunner.invocations[0].args.join(" ")).not.toContain(secret);
    expect(JSON.stringify(exactRunner.invocations)).not.toContain(secret);
    staged.cleanup();

    const publicRunner = successfulFake();
    const publicImporter = createImporter(publicRunner).importer;
    const publicStage = await publicImporter.stage({ repositoryUrl: "https://sub.git.example.com/org/repo.git" });
    expect(publicRunner.invocations[0].authorizationHeaderKeys).toEqual([]);
    expect(publicRunner.invocations[0].env.GIT_CONFIG_VALUE_0).toBe("false");
    expect(JSON.stringify(publicRunner.invocations)).not.toContain(secret);
    publicStage.cleanup();
  });

  it("rejects the configured token when it is embedded in a repository URL argument", async () => {
    const secret = ["private", "secret"].join("-");
    process.env.YOUBAN_SKILL_GIT_TOKEN = secret;
    process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = "git.example.com";
    const { importer, runner } = createImporter();

    await expectGitCode(
      importer.stage({ repositoryUrl: `https://git.example.com/org/${secret}.git` }),
      "invalid_git_url",
    );
    expect(runner.invocations).toHaveLength(0);
  });

  it("rejects redirects through Git configuration and a sanitized stable code", async () => {
    const runner = successfulFake({
      cloneResult: {
        exitCode: 128,
        stdout: "",
        stderr: "fatal: unable to update url base from redirection\nAuthorization: Bearer private-secret",
      },
    });
    const { importer } = createImporter(runner);

    await expectGitCode(importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" }), "git_redirect");
    const invocation = runner.invocations[0];
    const redirectKey = invocation.envKeys.find(
      (key) => invocation.env[key] === "http.https://git.example.com/.followRedirects",
    );
    expect(redirectKey).toBeDefined();
    expect(JSON.stringify(runner.invocations)).not.toContain("private-secret");
  });

  it.each([
    "https://localhost/repo.git",
    "https://LOCALHOST./repo.git",
    "https://service.local/repo.git",
    "https://printer/repo.git",
    "https://127.1/repo.git",
    "https://10.0.0.1/repo.git",
    "https://169.254.1.1/repo.git",
    "https://172.16.0.1/repo.git",
    "https://192.168.1.1/repo.git",
    "https://[::1]/repo.git",
    "https://[fc00::1]/repo.git",
    "https://[fe80::1]/repo.git",
  ])("rejects non-public local target %s before Git execution", async (repositoryUrl) => {
    const runner = successfulFake();
    const { importer } = createImporter(runner);

    await expectGitCode(importer.stage({ repositoryUrl }), "invalid_git_host");
    expect(runner.invocations).toHaveLength(0);
  });

  it.each([
    [[{ address: "127.0.0.1", family: 4 as const }]],
    [[
      { address: "93.184.216.34", family: 4 as const },
      { address: "192.168.1.10", family: 4 as const },
    ]],
  ])("rejects DNS answers containing non-public addresses", async (addresses) => {
    const runner = successfulFake();
    const { importer } = createImporter(runner, async () => addresses);

    await expectGitCode(
      importer.stage({ repositoryUrl: "https://git.public-example.com/org/repo.git" }),
      "invalid_git_host",
    );
    expect(runner.invocations).toHaveLength(0);
  });

  it("pins validated public DNS answers for a canonical IDNA host", async () => {
    const runner = successfulFake();
    const resolvedHosts: string[] = [];
    const { importer } = createImporter(runner, async (hostname) => {
      resolvedHosts.push(hostname);
      return [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700::1111", family: 6 },
      ];
    });

    const staged = await importer.stage({
      repositoryUrl: "https://b\u00fccher.example.com/org/repo.git",
    });

    expect(resolvedHosts).toEqual(["xn--bcher-kva.example.com"]);
    const invocation = runner.invocations[0];
    const resolveKey = invocation.envKeys.find((key) => invocation.env[key]?.endsWith(".curloptResolve"));
    expect(resolveKey).toBeDefined();
    expect(invocation.env[resolveKey!.replace("KEY", "VALUE")]).toBe(
      "+xn--bcher-kva.example.com:443:93.184.216.34,[2606:4700::1111]",
    );
    expect(staged.sanitizedSource).toBe("https://xn--bcher-kva.example.com/org/repo.git");
    staged.cleanup();
  });
});

describe("BunGitRunner process boundaries", () => {
  it("maps a missing Git executable to a sanitized stable code", async () => {
    const runner = new BunGitRunner({ executable: join(temporaryRoot("youban-missing-git-"), "git") });
    await expectGitCode(runner.run({ args: ["--version"], timeoutMs: 100 }), "git_unavailable");
  });

  it("maps a missing Git executable while acquisition limits are active", async () => {
    const root = temporaryRoot("youban-missing-limited-git-");
    const runner = new BunGitRunner({ executable: join(root, "git") });

    await expectGitCode(
      runner.run({ args: ["--version"], acquisitionRoot: root, timeoutMs: 100 }),
      "git_unavailable",
    );
  });

  it("terminates a timed-out child without exposing its private environment", async () => {
    const root = temporaryRoot("youban-git-timeout-");
    const script = join(root, "hang.ts");
    const marker = join(root, "terminated");
    writeFileSync(script, [
      "import { writeFileSync } from 'node:fs';",
      `process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(marker)}, 'yes'); process.exit(0); });`,
      "setInterval(() => {}, 1000);",
    ].join("\n"));
    const runner = new BunGitRunner({ executable: process.execPath });

    const error = await runner.run({
      args: [script],
      env: { PRIVATE_VALUE: "private-secret" },
      timeoutMs: 100,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "git_timeout" });
    expect(String(error)).not.toContain("private-secret");
    expect(existsSync(marker)).toBe(true);
  });

  it("bounds child output and redacts credential values", async () => {
    const root = temporaryRoot("youban-git-output-");
    const script = join(root, "output.ts");
    writeFileSync(script, "process.stdout.write('private-secret' + 'x'.repeat(4096));\n");
    const runner = new BunGitRunner({ executable: process.execPath, maxOutputBytes: 64 });

    const error = await runner.run({
      args: [script],
      env: { GIT_CONFIG_VALUE_0: "Authorization: Bearer private-secret" },
      timeoutMs: 1_000,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "git_output_too_large" });
    expect(String(error)).not.toContain("private-secret");
  });

  it("redacts credential values from captured stderr", async () => {
    const root = temporaryRoot("youban-git-stderr-");
    const script = join(root, "stderr.ts");
    writeFileSync(script, "process.stderr.write('private-secret'); process.exit(7);\n");
    const runner = new BunGitRunner({ executable: process.execPath });

    const result = await runner.run({
      args: [script],
      env: { GIT_CONFIG_VALUE_0: "Authorization: Bearer private-secret" },
      timeoutMs: 1_000,
    });

    expect(result).toEqual({ exitCode: 7, stdout: "", stderr: "[REDACTED]" });
    expect(JSON.stringify(result)).not.toContain("private-secret");
  });

  it("preserves commit output while redacting only the bearer credential", async () => {
    const root = temporaryRoot("youban-git-redaction-");
    const script = join(root, "redaction.ts");
    writeFileSync(script, `process.stdout.write(${JSON.stringify(`${COMMIT_40} private-secret`)});\n`);
    const runner = new BunGitRunner({ executable: process.execPath });

    const result = await runner.run({
      args: [script],
      env: {
        GIT_CONFIG_COUNT: "3",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_VALUE_0: "Authorization: Bearer private-secret",
        GIT_CONFIG_VALUE_1: "false",
      },
      timeoutMs: 1_000,
    });

    expect(result.stdout).toBe(`${COMMIT_40} [REDACTED]`);
  });

  it("removes inherited token and askpass credential sources from the child", async () => {
    const root = temporaryRoot("youban-git-env-");
    const script = join(root, "env.ts");
    writeFileSync(script, [
      "process.stdout.write(JSON.stringify({",
      "  token: Boolean(process.env.YOUBAN_SKILL_GIT_TOKEN),",
      "  tokenHost: Boolean(process.env.YOUBAN_SKILL_GIT_TOKEN_HOST),",
      "  askpass: Boolean(process.env.GIT_ASKPASS),",
      "}));",
    ].join("\n"));
    process.env.YOUBAN_SKILL_GIT_TOKEN = ["private", "secret"].join("-");
    process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = "git.example.com";
    process.env.GIT_ASKPASS = join(root, "credential-helper");
    const runner = new BunGitRunner({ executable: process.execPath });

    const result = await runner.run({ args: [script], timeoutMs: 1_000 });

    expect(JSON.parse(result.stdout)).toEqual({ token: false, tokenHost: false, askpass: false });
  });

  it("prevents inherited Git config parameters from overriding secure remote config", async () => {
    process.env.GIT_CONFIG_PARAMETERS = "'http.followRedirects=true' 'credential.helper=evil-helper'";
    const runner = new BunGitRunner();
    const env = {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.followRedirects",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
    };

    const redirects = await runner.run({
      args: ["config", "--get-all", "http.followRedirects"],
      env,
      timeoutMs: 1_000,
    });
    const helpers = await runner.run({
      args: ["config", "--get-all", "credential.helper"],
      env,
      timeoutMs: 1_000,
    });

    expect(redirects.stdout.trim().split("\n")).toEqual(["false"]);
    expect(helpers.stdout).toBe("\n");
  });

  it("passes only allowlisted ambient and invocation environment to the child", async () => {
    const root = temporaryRoot("youban-git-env-allowlist-");
    const script = join(root, "env-allowlist.ts");
    writeFileSync(script, [
      "process.stdout.write(JSON.stringify({",
      "  template: Boolean(process.env.GIT_TEMPLATE_DIR),",
      "  execPath: Boolean(process.env.GIT_EXEC_PATH),",
      "  traces: Object.keys(process.env).some((key) => key.startsWith('GIT_TRACE')),",
      "  sshCommand: Boolean(process.env.GIT_SSH_COMMAND),",
      "  unrelated: Boolean(process.env.UNRELATED_PRIVATE_ENV),",
      "  configKey: process.env.GIT_CONFIG_KEY_0,",
      "  configValue: Boolean(process.env.GIT_CONFIG_VALUE_0),",
      "}));",
    ].join("\n"));
    for (const name of guardedAmbientNames) process.env[name] = "ambient-private-value";
    const runner = new BunGitRunner({ executable: process.execPath });

    const result = await runner.run({
      args: [script],
      env: {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://git.example.com/.extraHeader",
        GIT_CONFIG_VALUE_0: "Authorization: Bearer private-secret",
      },
      timeoutMs: 1_000,
    });

    expect(JSON.parse(result.stdout)).toEqual({
      template: false,
      execPath: false,
      traces: false,
      sshCommand: false,
      unrelated: false,
      configKey: "http.https://git.example.com/.extraHeader",
      configValue: true,
    });
    expect(JSON.stringify(result)).not.toContain("private-secret");
  });

  it("terminates a grandchild retaining output pipes within the timeout boundary", async () => {
    const root = temporaryRoot("youban-git-process-tree-");
    const marker = join(root, "grandchild-terminated");
    const grandchildScript = join(root, "grandchild.ts");
    const parentScript = join(root, "parent.ts");
    writeFileSync(grandchildScript, [
      "import { writeFileSync } from 'node:fs';",
      `process.on('SIGTERM', () => { writeFileSync(${JSON.stringify(marker)}, 'yes'); process.exit(0); });`,
      "setTimeout(() => process.exit(0), 1200);",
    ].join("\n"));
    writeFileSync(parentScript, [
      "import { spawn } from 'node:child_process';",
      `spawn(process.execPath, [${JSON.stringify(grandchildScript)}], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();`,
    ].join("\n"));
    const runner = new BunGitRunner({ executable: process.execPath });
    const startedAt = performance.now();

    const error = await runner.run({ args: [parentScript], timeoutMs: 100 }).catch((caught: unknown) => caught);
    const elapsedMs = performance.now() - startedAt;

    expect(error).toMatchObject({ code: "git_timeout" });
    expect(elapsedMs).toBeLessThan(700);
    expect(existsSync(marker)).toBe(true);
  });

  it("caps a single acquisition file before polling can observe it", async () => {
    if (process.platform === "win32") return;
    const root = temporaryRoot("youban-git-acquisition-file-limit-");
    const acquisitionRoot = join(root, "acquisition");
    const output = join(acquisitionRoot, "oversized.pack");
    const script = join(root, "write-oversized.ts");
    mkdirSync(acquisitionRoot);
    writeFileSync(script, [
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(output)}, Buffer.alloc(4 * 1024 * 1024));`,
    ].join("\n"));
    const maximumBytes = 1024 * 1024;
    const runner = new BunGitRunner({
      executable: process.execPath,
      maxAcquisitionBytes: maximumBytes,
    });

    const error = await runner.run({
      args: [script],
      acquisitionRoot,
      timeoutMs: 1_000,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "git_acquisition_too_large" });
    expect(statSync(output).size).toBeLessThanOrEqual(maximumBytes);
  });
});

describe("GitSkillImporter staging", () => {
  it("rejects an omitted oversized selected blob without lazily fetching it", async () => {
    const repositoryUrl = "https://git.example.com/org/repo.git";
    const runner = new ObservedLocalGitRunner(
      repositoryUrl,
      createRepositoryWithOversizedSelectedFile(12 * 1024 * 1024, true),
    );
    const root = temporaryRoot("youban-skill-git-");
    const importer = new GitSkillImporter(new SkillPackageStore(root), runner, {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    await expectGitCode(importer.stage({
      repositoryUrl,
      subdirectory: "skills/museum",
    }), "skill_package_too_large");
    expect(runner.maxObservedAcquisitionBytes).toBeLessThan(2 * 1024 * 1024);
  });

  it("terminates acquisition when the remote ignores blob filtering", async () => {
    const repositoryUrl = "https://git.example.com/org/repo.git";
    const runner = new ObservedLocalGitRunner(
      repositoryUrl,
      createRepositoryWithOversizedSelectedFile(40 * 1024 * 1024, false),
    );
    const root = temporaryRoot("youban-skill-git-");
    const importer = new GitSkillImporter(new SkillPackageStore(root), runner, {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    await expectGitCode(importer.stage({
      repositoryUrl,
      subdirectory: "skills/museum",
    }), "git_acquisition_too_large");
  });

  it("does not materialize an oversized file outside the selected subdirectory", async () => {
    const repositoryUrl = "https://git.example.com/org/repo.git";
    const runner = new RejectOutsideMaterializationRunner(
      repositoryUrl,
      createRepositoryWithOversizedUnselectedFile(),
    );
    const root = temporaryRoot("youban-skill-git-");
    const importer = new GitSkillImporter(new SkillPackageStore(root), runner, {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    const staged = await importer.stage({
      repositoryUrl,
      subdirectory: "skills/museum",
    });

    expect(staged.files).toEqual(["SKILL.md"]);
    staged.cleanup();
  });

  it("clones a branch or tag request with hardened acquisition arguments", async () => {
    const { importer, runner } = createImporter();
    const staged = await importer.stage({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "release-v2",
    });

    expect(runner.invocations[0].args).toEqual([
      "clone",
      "--depth=1",
      "--filter=blob:none",
      "--no-tags",
      "--no-checkout",
      "--branch",
      "release-v2",
      "https://git.example.com/org/repo.git",
      expect.any(String),
    ]);
    expect(staged.sourceRef).toBe("release-v2");
    staged.cleanup();
  });

  it.each(["refs/heads/release-v2", "refs/tags/release-v2"])(
    "fetches full ref %s exactly without branch/tag ambiguity",
    async (ref) => {
    const { importer, runner } = createImporter();
    const staged = await importer.stage({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref,
    });

    expect(runner.invocations[0].args).toContain("--no-checkout");
    expect(runner.invocations[0].args).not.toContain("--branch");
    expect(runner.invocations[1].args).toEqual(["fetch", "--depth=1", "--filter=blob:none", "origin", ref]);
    expect(runner.invocations[2].args).toEqual(["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
    staged.cleanup();
  });

  it.each([
    "main:evil",
    "+refs/heads/main",
    "refs/heads/*",
    "refs/heads/a..b",
    "refs/heads/a^b",
    "refs/heads/a~b",
    "refs/heads/a?b",
    "refs/heads/[a",
    "refs/heads/a.lock",
    "refs/heads/.hidden",
    "refs/heads/a/",
    "refs/heads/a//b",
    "@{upstream}",
  ])("rejects invalid or refspec-style ref %s before Git execution", async (ref) => {
    const { importer, runner } = createImporter();

    await expectGitCode(importer.stage({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref,
    }), "invalid_git_ref");
    expect(runner.invocations).toHaveLength(0);
  });

  it("fetches a custom ref explicitly instead of passing it to clone --branch", async () => {
    const customRef = "refs/pull/123/head";
    const { importer, runner } = createImporter();
    const staged = await importer.stage({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: customRef,
    });

    expect(runner.invocations[0].args).toContain("--no-checkout");
    expect(runner.invocations[0].args).not.toContain("--branch");
    expect(runner.invocations[1].args).toEqual([
      "fetch", "--depth=1", "--filter=blob:none", "origin", customRef,
    ]);
    expect(runner.invocations[2].args).toEqual(["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
    staged.cleanup();
  });

  it("fetches a requested commit explicitly and preserves a resolved 64-character SHA", async () => {
    const runner = successfulFake({ commit: COMMIT_64 });
    const { importer } = createImporter(runner);
    const staged = await importer.stage({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: COMMIT_64,
    });

    expect(runner.invocations.map(({ args }) => args[0])).toEqual([
      "clone",
      "fetch",
      "rev-parse",
      "ls-tree",
      "fetch",
      "ls-tree",
      "read-tree",
      "checkout-index",
    ]);
    expect(runner.invocations[1].args.at(-1)).toBe(COMMIT_64);
    expect(staged.sourceCommit).toBe(COMMIT_64);
    staged.cleanup();
  });

  it("returns a validated inert package without repository metadata", async () => {
    const { importer } = createImporter();
    const staged = await importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" });

    expect(staged.document.name).toBe("museum-guide");
    expect(staged.files).toEqual(["SKILL.md", "scripts/run.sh"]);
    expect(staged.source).toBe("git");
    expect(staged.sanitizedSource).toBe("https://git.example.com/org/repo.git");
    expect(staged.sourceCommit).toBe(COMMIT_40);
    expect(existsSync(join(staged.stagingDir, ".git"))).toBe(false);
    expect(statSync(join(staged.stagingDir, "scripts/run.sh")).mode & 0o111).toBe(0);
    expect(readFileSync(join(staged.stagingDir, "scripts/run.sh"), "utf8")).toBe("exit 99");
    staged.cleanup();
    expect(existsSync(staged.stagingDir)).toBe(false);
  });

  it("stages only a contained regular-file subdirectory", async () => {
    const runner = successfulFake({ files: {
      "SKILL.md": "not selected",
      "skills/museum/SKILL.md": VALID_SKILL,
      "skills/museum/notes.txt": "selected",
      "skills/other/private.txt": "not selected",
    } });
    const { importer } = createImporter(runner);
    const staged = await importer.stage({
      repositoryUrl: "https://git.example.com/org/repo.git",
      subdirectory: "skills/museum",
    });

    expect(staged.files).toEqual(["SKILL.md", "notes.txt"]);
    expect(existsSync(join(staged.stagingDir, "..", "other", "private.txt"))).toBe(false);
    staged.cleanup();
  });

  it.each(["../museum", "/tmp/museum", "skills\\museum", ".git"])(
    "rejects invalid subdirectory containment %s",
    async (subdirectory) => {
      const { importer, root } = createImporter();
      await expectGitCode(importer.stage({
        repositoryUrl: "https://git.example.com/org/repo.git",
        subdirectory,
      }), "invalid_git_subdirectory");
      expect(readdirSync(join(root, "staging"))).toEqual([]);
    },
  );

  it("rejects symlinks and cleans only the failed operation staging directory", async () => {
    const runner = new FakeGitRunner((invocation) => {
      if (invocation.args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${COMMIT_40}\n`, stderr: "" };
      }
      if (invocation.args[0] === "ls-tree" && invocation.args.includes("-r")) {
        return {
          exitCode: 0,
          stdout: [
            `100644 blob ${COMMIT_40}\tSKILL.md\0`,
            `120000 blob ${COMMIT_40}\tlinked-skill\0`,
          ].join(""),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const { importer, root } = createImporter(runner);
    mkdirSync(join(root, "packages", "preserved"));

    await expectGitCode(importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" }), "invalid_git_package");
    expect(runner.invocations.some(({ args }) => args[0] === "checkout-index")).toBe(false);
    expect(readdirSync(join(root, "staging"))).toEqual([]);
    expect(existsSync(join(root, "packages", "preserved"))).toBe(true);
  });

  it("rejects a second nested skill document", async () => {
    const runner = successfulFake({ files: {
      "SKILL.md": VALID_SKILL,
      "nested/SKILL.md": VALID_SKILL,
    } });
    const { importer, root } = createImporter(runner);

    await expectGitCode(importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" }), "invalid_git_package");
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("rejects an oversized regular file from tree metadata before materializing it", async () => {
    const runner = new FakeGitRunner((invocation) => {
      if (invocation.args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${COMMIT_40}\n`, stderr: "" };
      }
      if (invocation.args[0] === "ls-tree" && invocation.args.includes("-r")) {
        const includeSizes = invocation.args.includes("-l");
        return {
          exitCode: 0,
          stdout: [
            `100644 blob ${COMMIT_40}${includeSizes ? ` ${Buffer.byteLength(VALID_SKILL)}` : ""}\tSKILL.md\0`,
            `100644 blob ${COMMIT_40}${includeSizes ? " 10485761" : ""}\toversized.bin\0`,
          ].join(""),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const { importer, root } = createImporter(runner);

    await expectGitCode(
      importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" }),
      "skill_package_too_large",
    );
    expect(runner.invocations.some(({ args }) => args[0] === "checkout-index")).toBe(false);
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it.each(["short", `${COMMIT_40}00`])("rejects an invalid resolved commit %s", async (commit) => {
    const { importer } = createImporter(successfulFake({ commit }));
    await expectGitCode(importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" }), "invalid_git_commit");
  });
});

describe("GitSkillImporter remote update checks", () => {
  it("reports an unchanged active or candidate SHA without staging a package", async () => {
    for (const known of ["activeCommit", "candidateCommit"] as const) {
      const runner = successfulFake();
      const { importer, root } = createImporter(runner);
      const result = await importer.resolveRemote({
        repositoryUrl: "https://git.example.com/org/repo.git",
        [known]: COMMIT_40,
      });

      expect(result).toEqual({ commit: COMMIT_40, changed: false });
      expect(readdirSync(join(root, "staging"))).toEqual([]);
      expect(runner.invocations).toHaveLength(1);
      expect(runner.invocations[0].args).toEqual([
        "ls-remote",
        "https://git.example.com/org/repo.git",
        "HEAD",
      ]);
    }
  });

  it("reports a changed remote SHA as metadata only", async () => {
    const { importer, root } = createImporter(successfulFake({ commit: COMMIT_64 }));
    const result = await importer.resolveRemote({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "release-v2",
      activeCommit: COMMIT_40,
    });

    expect(result).toEqual({ commit: COMMIT_64, changed: true });
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("uses the peeled commit for an annotated tag update", async () => {
    const tagObject = COMMIT_40;
    const peeledCommit = COMMIT_64;
    let resolutionDirectory: string | undefined;
    const runner = new FakeGitRunner((invocation) => {
      if (invocation.args[0] === "ls-remote") {
        return {
          exitCode: 0,
          stdout: [
            `${tagObject}\trefs/tags/release-v2`,
            `${peeledCommit}\trefs/tags/release-v2^{}`,
            "",
          ].join("\n"),
          stderr: "",
        };
      }
      if (invocation.args[0] === "init") resolutionDirectory = invocation.cwd;
      if (invocation.args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${peeledCommit}\n`, stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const { importer } = createImporter(runner);

    const result = await importer.resolveRemote({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "release-v2",
      activeCommit: tagObject,
    });

    expect(result).toEqual({ commit: peeledCommit, changed: true });
    expect(runner.invocations.map(({ args }) => args[0])).toEqual([
      "ls-remote",
      "init",
      "fetch",
      "rev-parse",
    ]);
    expect(runner.invocations[2].args).toEqual([
      "fetch",
      "--depth=1",
      "--filter=blob:none",
      "--no-tags",
      "https://git.example.com/org/repo.git",
      "refs/tags/release-v2",
    ]);
    expect(runner.invocations[3].args).toEqual(["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
    expect(resolutionDirectory).toBeDefined();
    expect(existsSync(resolutionDirectory!)).toBe(false);
  });

  it("accepts a valid lightweight tag after resolving it as a commit", async () => {
    process.env.YOUBAN_SKILL_GIT_TOKEN = "private-secret";
    process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = "git.example.com";
    const runner = new FakeGitRunner((invocation) => {
      if (invocation.args[0] === "ls-remote") {
        return {
          exitCode: 0,
          stdout: `${COMMIT_40}\trefs/tags/release-v2\n`,
          stderr: "",
        };
      }
      if (invocation.args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${COMMIT_40}\n`, stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const { importer, root } = createImporter(runner);

    const result = await importer.resolveRemote({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "refs/tags/release-v2",
    });

    expect(result).toEqual({ commit: COMMIT_40, changed: true });
    expect(runner.invocations[2].args.at(-1)).toBe("refs/tags/release-v2");
    expect(runner.invocations[2].authorizationHeaderKeys).toHaveLength(1);
    expect(runner.invocations[2].envKeys.some(
      (key) => runner.invocations[2].env[key]?.endsWith(".curloptResolve"),
    )).toBe(true);
    expect(JSON.stringify(runner.invocations)).not.toContain("private-secret");
    expect(readdirSync(join(root, "staging"))).toEqual([]);
  });

  it("rejects a tag whose peeled target is not a commit", async () => {
    const blobObject = COMMIT_64;
    const runner = new FakeGitRunner((invocation) => {
      if (invocation.args[0] === "ls-remote") {
        return {
          exitCode: 0,
          stdout: [
            `${COMMIT_40}\trefs/tags/release-v2`,
            `${blobObject}\trefs/tags/release-v2^{}`,
            "",
          ].join("\n"),
          stderr: "",
        };
      }
      if (invocation.args[0] === "rev-parse") {
        return { exitCode: 128, stdout: "", stderr: "fatal: expected commit type" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const { importer } = createImporter(runner);

    await expectGitCode(importer.resolveRemote({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "refs/tags/release-v2",
    }), "invalid_git_commit");
    expect(runner.invocations.map(({ args }) => args[0])).toEqual([
      "ls-remote",
      "init",
      "fetch",
      "rev-parse",
    ]);
  });

  it("cleans temporary tag resolution after a failed object inspection", async () => {
    let resolutionDirectory: string | undefined;
    const runner = new FakeGitRunner((invocation) => {
      if (invocation.args[0] === "ls-remote") {
        return { exitCode: 0, stdout: `${COMMIT_40}\trefs/tags/release-v2\n`, stderr: "" };
      }
      if (invocation.args[0] === "init") resolutionDirectory = invocation.cwd;
      if (invocation.args[0] === "rev-parse") {
        return { exitCode: 128, stdout: "", stderr: "fatal: expected commit type" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const { importer } = createImporter(runner);

    await expectGitCode(importer.resolveRemote({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "refs/tags/release-v2",
    }), "invalid_git_commit");
    expect(resolutionDirectory).toBeDefined();
    expect(existsSync(resolutionDirectory!)).toBe(false);
  });

  it("rejects an unrelated advertised ref instead of using a fuzzy fallback", async () => {
    const runner = new FakeGitRunner(() => ({
      exitCode: 0,
      stdout: `${COMMIT_40}\trefs/heads/other/release-v2\n`,
      stderr: "",
    }));
    const { importer } = createImporter(runner);

    await expectGitCode(importer.resolveRemote({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "release-v2",
    }), "invalid_git_commit");
  });
});
