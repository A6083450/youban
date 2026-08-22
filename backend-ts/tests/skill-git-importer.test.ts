import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import {
  BunGitRunner,
  GitSkillImporter,
  type GitInvocation,
  type GitResult,
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

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function createCheckout(destination: string, files: Readonly<Record<string, string>> = {
  "SKILL.md": VALID_SKILL,
  "scripts/run.sh": "exit 99",
}): void {
  mkdirSync(join(destination, ".git"), { recursive: true });
  writeFileSync(join(destination, ".git", "config"), "credential = private-secret\n");
  for (const [path, content] of Object.entries(files)) {
    const target = join(destination, ...path.split("/"));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, { mode: path.endsWith(".sh") ? 0o755 : 0o600 });
  }
}

function successfulFake(options: {
  commit?: string;
  files?: Readonly<Record<string, string>>;
  onInvocation?: (invocation: GitInvocation) => void;
  cloneResult?: GitResult;
} = {}): FakeGitRunner {
  const commit = options.commit ?? COMMIT_40;
  return new FakeGitRunner(async (invocation) => {
    options.onInvocation?.(invocation);
    if (invocation.args[0] === "clone") {
      if (options.cloneResult) return options.cloneResult;
      createCheckout(invocation.args.at(-1)!, options.files);
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (invocation.args[0] === "rev-parse") {
      return { exitCode: 0, stdout: `${commit}\n`, stderr: "" };
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

function createImporter(runner = successfulFake()): {
  importer: GitSkillImporter;
  runner: FakeGitRunner;
  root: string;
} {
  const root = temporaryRoot("youban-skill-git-");
  return {
    importer: new GitSkillImporter(new SkillPackageStore(root), runner),
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
    expect(exactRunner.invocations[0].env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(exactRunner.invocations[0].env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(exactRunner.invocations[0].envKeys).toContain("GIT_CONFIG_GLOBAL");
    expect(Object.entries(exactRunner.invocations[0].env)).toContainEqual([
      "GIT_CONFIG_KEY_2",
      "credential.helper",
    ]);
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
    const redirectKey = invocation.envKeys.find((key) => invocation.env[key] === "http.followRedirects");
    expect(redirectKey).toBeDefined();
    expect(JSON.stringify(runner.invocations)).not.toContain("private-secret");
  });
});

describe("BunGitRunner process boundaries", () => {
  it("maps a missing Git executable to a sanitized stable code", async () => {
    const runner = new BunGitRunner({ executable: join(temporaryRoot("youban-missing-git-"), "git") });
    await expectGitCode(runner.run({ args: ["--version"], timeoutMs: 100 }), "git_unavailable");
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
});

describe("GitSkillImporter staging", () => {
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
      "--branch",
      "release-v2",
      "https://git.example.com/org/repo.git",
      expect.any(String),
    ]);
    expect(staged.sourceRef).toBe("release-v2");
    staged.cleanup();
  });

  it.each([
    ["refs/heads/release-v2", "release-v2"],
    ["refs/tags/release-v2", "release-v2"],
  ])("uses --branch for full branch or tag ref %s", async (ref, branchArgument) => {
    const { importer, runner } = createImporter();
    const staged = await importer.stage({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref,
    });

    expect(runner.invocations[0].args).toContain("--branch");
    expect(runner.invocations[0].args.at(runner.invocations[0].args.indexOf("--branch") + 1)).toBe(branchArgument);
    staged.cleanup();
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
    expect(runner.invocations[1].args).toEqual(["fetch", "--depth=1", "origin", customRef]);
    expect(runner.invocations[2].args).toEqual(["checkout", "--detach", "FETCH_HEAD"]);
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
      "checkout",
      "rev-parse",
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
      if (invocation.args[0] === "clone") {
        const destination = invocation.args.at(-1)!;
        createCheckout(destination, { "SKILL.md": VALID_SKILL });
        symlinkSync("SKILL.md", join(destination, "linked-skill"));
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (invocation.args[0] === "rev-parse") {
        return { exitCode: 0, stdout: `${COMMIT_40}\n`, stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const { importer, root } = createImporter(runner);
    mkdirSync(join(root, "packages", "preserved"));

    await expectGitCode(importer.stage({ repositoryUrl: "https://git.example.com/org/repo.git" }), "invalid_git_package");
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
    const runner = new FakeGitRunner((invocation) => {
      if (invocation.args[0] !== "ls-remote") return { exitCode: 0, stdout: "", stderr: "" };
      return {
        exitCode: 0,
        stdout: [
          `${tagObject}\trefs/tags/release-v2`,
          `${peeledCommit}\trefs/tags/release-v2^{}`,
          "",
        ].join("\n"),
        stderr: "",
      };
    });
    const { importer } = createImporter(runner);

    const result = await importer.resolveRemote({
      repositoryUrl: "https://git.example.com/org/repo.git",
      ref: "release-v2",
      activeCommit: tagObject,
    });

    expect(result).toEqual({ commit: peeledCommit, changed: true });
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
