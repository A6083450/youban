import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const backendRoot = resolve(import.meta.dir, "..");
const children: Array<ReturnType<typeof Bun.spawn>> = [];
const dataDirectories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGTERM");
    await child.exited;
  }
  for (const directory of dataDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function spawnBackend(environment: Record<string, string>) {
  const child = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      AUTH_PEPPER: "",
      WECHAT_APP_SECRET: "",
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  return child;
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream ? await new Response(stream).text() : "";
}

async function waitForHealth(baseUrl: string, child: ReturnType<typeof spawnBackend>): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited before health check: ${await streamText(child.stderr)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await Bun.sleep(50);
  }
  throw new Error("backend did not become healthy");
}

describe("local WeChat authentication mode", () => {
  it("starts without AppSecret and maps changing wx.login codes to one local account", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-local-wechat-"));
    dataDirectories.push(dataDir);
    const port = 46_000 + Math.floor(Math.random() * 1_000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawnBackend({
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      NODE_ENV: "development",
      PORT: String(port),
      YOUBAN_DEV_WECHAT_AUTH: "1",
    });
    await waitForHealth(baseUrl, child);

    const login = async (code: string) => {
      const response = await fetch(`${baseUrl}/api/auth/wechat/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      expect(response.status).toBe(200);
      return await response.json() as { token: string; user: { user_id: string } };
    };
    const first = await login("temporary-code-one");
    const second = await login("temporary-code-two");

    expect(second.user.user_id).toBe(first.user.user_id);
    expect(second.token).not.toBe(first.token);
  });

  it("refuses the local authentication switch in production", async () => {
    const child = spawnBackend({
      NODE_ENV: "production",
      YOUBAN_DEV_WECHAT_AUTH: "1",
    });
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(3_000).then(() => null),
    ]);
    if (exitCode === null) child.kill("SIGTERM");
    expect(exitCode).not.toBeNull();
    expect(await streamText(child.stderr)).toContain(
      "YOUBAN_DEV_WECHAT_AUTH cannot be enabled in production",
    );
  });

  it("refuses an invalid mini-program code environment", async () => {
    const child = spawnBackend({
      AUTH_PEPPER: "x".repeat(32),
      NODE_ENV: "production",
      WECHAT_APP_SECRET: "server-secret",
      WECHAT_MINI_PROGRAM_ENV_VERSION: "invalid",
    });
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(3_000).then(() => null),
    ]);
    if (exitCode === null) child.kill("SIGTERM");
    expect(exitCode).not.toBeNull();
    expect(await streamText(child.stderr)).toContain(
      "WECHAT_MINI_PROGRAM_ENV_VERSION must be release, trial, or develop",
    );
  });

  it("refuses an invalid mini-program page check setting", async () => {
    const child = spawnBackend({
      AUTH_PEPPER: "x".repeat(32),
      NODE_ENV: "production",
      WECHAT_APP_SECRET: "server-secret",
      WECHAT_MINI_PROGRAM_CHECK_PATH: "invalid",
    });
    const exitCode = await Promise.race([
      child.exited,
      Bun.sleep(3_000).then(() => null),
    ]);
    if (exitCode === null) child.kill("SIGTERM");
    expect(exitCode).not.toBeNull();
    expect(await streamText(child.stderr)).toContain(
      "WECHAT_MINI_PROGRAM_CHECK_PATH must be true or false",
    );
  });
});
