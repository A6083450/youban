import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  closeSkillAdminBrowserFixtureResources,
  createSkillAdminFixtureDataDirectory,
  startSkillAdminBrowserFixture,
  type SkillAdminBrowserFixture,
  type SkillAdminBrowserFixtureInfo,
} from "../scripts/skill-admin-browser-fixture.ts";

const REPOSITORY_URL = "https://git.example.test/travel-skills.git";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ADMIN_PASSWORD = "admin@123";
const repoRoot = resolve(import.meta.dir, "..", "..");
const fixtures: SkillAdminBrowserFixture[] = [];
const temporaryRoots: string[] = [];
let previousGitToken: string | undefined;
let previousGitTokenHost: string | undefined;

afterEach(async () => {
  const errors: unknown[] = [];
  const fixtureResults = await Promise.allSettled(fixtures.splice(0).map((fixture) => fixture.stop()));
  for (const result of fixtureResults) {
    if (result.status === "rejected") errors.push(result.reason);
  }
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (previousGitToken === undefined) delete process.env.YOUBAN_SKILL_GIT_TOKEN;
  else process.env.YOUBAN_SKILL_GIT_TOKEN = previousGitToken;
  if (previousGitTokenHost === undefined) delete process.env.YOUBAN_SKILL_GIT_TOKEN_HOST;
  else process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = previousGitTokenHost;
  previousGitToken = undefined;
  previousGitTokenHost = undefined;
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "fixture test cleanup failed");
});

function authenticatedHeaders(): Record<string, string> {
  return { "x-admin-token": ADMIN_PASSWORD };
}

async function readLaunchRecord(
  stream: ReadableStream<Uint8Array>,
): Promise<SkillAdminBrowserFixtureInfo> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("fixture process exited before printing its launch record");
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        return JSON.parse(line) as SkillAdminBrowserFixtureInfo;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function waitUntilRemoved(path: string, timeoutMs = 2_000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (existsSync(path) && performance.now() < deadline) await Bun.sleep(25);
  return !existsSync(path);
}

async function start() {
  const lines: string[] = [];
  const fixture = await startSkillAdminBrowserFixture({
    repoRoot,
    log: (line) => lines.push(line),
  });
  fixtures.push(fixture);
  return { fixture, lines };
}

describe("Skill Admin browser fixture", () => {
  it("removes a still-empty initial directory when cleanup marker creation fails", () => {
    let dataDir = "";
    const failure = new Error("marker write failed");

    expect(() => createSkillAdminFixtureDataDirectory((markerPath) => {
      dataDir = resolve(markerPath, "..");
      throw failure;
    })).toThrow(failure);
    expect(dataDir).not.toBe("");
    expect(existsSync(dataDir)).toBe(false);
  });

  it("does not recursively remove an initial directory that became non-empty before marker failure", () => {
    let dataDir = "";
    let sentinel = "";
    expect(() => createSkillAdminFixtureDataDirectory((markerPath) => {
      dataDir = resolve(markerPath, "..");
      sentinel = join(dataDir, "unexpected-file.txt");
      writeFileSync(sentinel, "preserve", "utf8");
      throw new Error("marker write failed after another file appeared");
    })).toThrow();
    temporaryRoots.push(dataDir);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve");
  });

  it("closes listener, runtime, and injected Skills strictly in order while collecting failures", async () => {
    const events: string[] = [];
    const failures = [new Error("listener failed"), new Error("runtime failed"), new Error("skills failed")];
    let releaseListener!: () => void;
    let releaseRuntime!: () => void;
    const listenerGate = new Promise<void>((resolve) => { releaseListener = resolve; });
    const runtimeGate = new Promise<void>((resolve) => { releaseRuntime = resolve; });
    const cleanup = closeSkillAdminBrowserFixtureResources(
      {
        async stop() {
          events.push("listener:start");
          await listenerGate;
          events.push("listener:end");
          throw failures[0];
        },
      },
      {
        async close() {
          events.push("runtime:start");
          await runtimeGate;
          events.push("runtime:end");
          throw failures[1];
        },
      },
      {
        close() {
          events.push("skills");
          throw failures[2];
        },
      },
    );

    await Bun.sleep(0);
    expect(events).toEqual(["listener:start"]);
    releaseListener();
    await Bun.sleep(0);
    expect(events).toEqual(["listener:start", "listener:end", "runtime:start"]);
    releaseRuntime();

    expect(await cleanup).toEqual(failures);
    expect(events).toEqual([
      "listener:start",
      "listener:end",
      "runtime:start",
      "runtime:end",
      "skills",
    ]);
  });

  it("prints one machine-readable launch record and serves the built Admin frontend", async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), "youban-skill-fixture-outside-"));
    temporaryRoots.push(outsideRoot);
    const sentinel = join(outsideRoot, "preserved.txt");
    writeFileSync(sentinel, "keep", "utf8");

    const { fixture, lines } = await start();

    expect(lines).toHaveLength(1);
    const info = JSON.parse(lines[0]) as SkillAdminBrowserFixtureInfo;
    expect(info).toEqual({
      type: "youban-skill-admin-browser-fixture",
      api_url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      frontend_url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/admin$/),
      zip_path: expect.stringMatching(/museum-guide\.zip$/),
      cleanup_token: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(new URL(info.api_url).origin).toBe(new URL(info.frontend_url).origin);
    expect(info.zip_path.startsWith(`${fixture.dataDir}/`)).toBe(true);
    expect(existsSync(info.zip_path)).toBe(true);

    const page = await fetch(info.frontend_url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("<div id=\"app\">");

    const login = await fetch(`${info.api_url}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    expect(login.status).toBe(200);

    const skills = await fetch(`${info.api_url}/api/admin/skills`, {
      headers: authenticatedHeaders(),
    });
    expect(skills.status).toBe(200);
    const listed = await skills.json() as { items: Array<{ kind: string }> };
    expect(listed.items.filter((skill) => skill.kind === "builtin")).toHaveLength(4);

    const dataDir = fixture.dataDir;
    await fixture.stop();
    expect(existsSync(dataDir)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("keep");
    await fixture.stop();
  });

  it("stages deterministic ZIP and Git candidates without exposing a configured token", async () => {
    const secret = "fixture-secret-that-must-not-leak";
    previousGitToken = process.env.YOUBAN_SKILL_GIT_TOKEN;
    previousGitTokenHost = process.env.YOUBAN_SKILL_GIT_TOKEN_HOST;
    process.env.YOUBAN_SKILL_GIT_TOKEN = secret;
    process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = "git.example.test";
    const { fixture, lines } = await start();
    const info = JSON.parse(lines[0]) as SkillAdminBrowserFixtureInfo;

    const archive = new File(
      [readFileSync(info.zip_path)],
      "museum-guide.zip",
      { type: "application/zip" },
    );
    const uploadBody = new FormData();
    uploadBody.set("file", archive);
    const upload = await fetch(`${info.api_url}/api/admin/skills/upload`, {
      method: "POST",
      headers: authenticatedHeaders(),
      body: uploadBody,
    });
    expect(upload.status).toBe(201);
    const uploaded = await upload.json() as Record<string, any>;
    expect(uploaded.skill).toMatchObject({
      name: "museum-guide",
      source: "upload",
      enabled: false,
      state: "candidate",
    });

    const install = await fetch(`${info.api_url}/api/admin/skills/git`, {
      method: "POST",
      headers: { ...authenticatedHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ repository_url: REPOSITORY_URL }),
    });
    expect(install.status).toBe(201);
    const installed = await install.json() as Record<string, any>;
    expect(installed.skill).toMatchObject({
      name: "travel-skills",
      source: "git",
      repository_url: REPOSITORY_URL,
      enabled: false,
      state: "candidate",
      candidate_version: { source_commit: COMMIT },
    });

    const update = await fetch(
      `${info.api_url}/api/admin/skills/${installed.skill.id}/check-update`,
      { method: "POST", headers: authenticatedHeaders() },
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      changed: false,
      skill: { candidate_version: { source_commit: COMMIT } },
    });

    const observable = JSON.stringify({ lines, uploaded, installed });
    expect(observable).not.toContain(secret);
    expect(observable).not.toContain("YOUBAN_SKILL_GIT_TOKEN");
    expect(existsSync(fixture.dataDir)).toBe(true);
  });

  it("refuses cleanup when the launch token does not match its owned directory", async () => {
    const { fixture } = await start();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    temporaryRoots.push(fixture.dataDir);
    const sentinel = join(fixture.dataDir, "sentinel.txt");
    writeFileSync(sentinel, "preserve", "utf8");
    writeFileSync(join(fixture.dataDir, ".cleanup-token"), "different-token\n", { mode: 0o600 });

    await expect(fixture.stop()).rejects.toThrow("cleanup token does not match");
    expect(readFileSync(sentinel, "utf8")).toBe("preserve");
  });

  it("cleans its temporary data when the package script receives SIGINT", async () => {
    const child = Bun.spawn(["bun", "run", "--shell=bun", "browser:skills-fixture"], {
      cwd: join(repoRoot, "backend-ts"),
      stdout: "pipe",
      stderr: "inherit",
      detached: true,
    });
    const info = await readLaunchRecord(child.stdout);
    const dataDir = resolve(info.zip_path, "..", "..");
    temporaryRoots.push(dataDir);

    if (process.platform === "win32") child.kill("SIGINT");
    else process.kill(-child.pid, "SIGINT");
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(3_000).then(() => null),
    ]);
    if (exitCode === null) {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
      await child.exited;
    }

    expect(exitCode).not.toBeNull();
    expect(await waitUntilRemoved(dataDir)).toBe(true);
  });

  it("cleans its temporary data when the package process group receives SIGKILL", async () => {
    const child = Bun.spawn(["bun", "run", "--shell=bun", "browser:skills-fixture"], {
      cwd: join(repoRoot, "backend-ts"),
      stdout: "pipe",
      stderr: "inherit",
      detached: true,
    });
    const info = await readLaunchRecord(child.stdout);
    const dataDir = resolve(info.zip_path, "..", "..");
    temporaryRoots.push(dataDir);

    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(3_000).then(() => null),
    ]);
    if (exitCode === null) {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-child.pid, "SIGKILL");
      await child.exited;
    }

    expect(exitCode).not.toBeNull();
    expect(await waitUntilRemoved(dataDir)).toBe(true);
  });
});
