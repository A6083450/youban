import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesMemoryBridge } from "../src/services/hermes-memory.ts";

const lifecycleWorker = join(import.meta.dir, "fixtures/hermes-lifecycle-worker.mjs");

function workerPidPath(dataDir: string, userId: string): string {
  const userHash = createHash("sha256").update(userId).digest("hex");
  return join(dataDir, "memory", "users", userHash, "worker.pid");
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("timed out waiting for Hermes worker");
    await Bun.sleep(5);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKill(pid: number | undefined): void {
  if (pid === undefined || !isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The worker exited between the liveness check and cleanup.
  }
}

describe("HermesMemoryBridge", () => {
  it("runs an injected worker executable at the external process seam", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-hermes-worker-seam-"));
    const memory = new HermesMemoryBridge({
      dataDir,
      timeoutMs: 1_000,
      workerPath: lifecycleWorker,
    });
    try {
      expect(await memory.recall("user-a", "worker seam")).toBe("fixture-output");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("drains stderr while the worker is running", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-hermes-stderr-"));
    const memory = new HermesMemoryBridge({
      dataDir,
      timeoutMs: 500,
      workerPath: lifecycleWorker,
    });
    try {
      expect(await memory.remember("user-a", "stderr-flood")).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("force-terminates and awaits a timed-out worker before resolving", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-hermes-timeout-"));
    const userId = "timeout-user";
    const pidPath = workerPidPath(dataDir, userId);
    let pid: number | undefined;
    const memory = new HermesMemoryBridge({
      dataDir,
      timeoutMs: 25,
      terminationGraceMs: 30,
      workerPath: lifecycleWorker,
    });
    try {
      const operation = memory.remember(userId, "ignore-termination");
      await waitUntil(() => existsSync(pidPath));
      pid = Number(readFileSync(pidPath, "utf8"));

      expect(await operation).toBe(false);
      expect(isProcessAlive(pid)).toBe(false);
    } finally {
      forceKill(pid);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("idempotently closes every active worker and rejects later calls", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-hermes-close-"));
    const users = ["close-user-a", "close-user-b"];
    const pidPaths = users.map((userId) => workerPidPath(dataDir, userId));
    const pids: number[] = [];
    const memory = new HermesMemoryBridge({
      dataDir,
      timeoutMs: 5_000,
      terminationGraceMs: 30,
      workerPath: lifecycleWorker,
    });
    try {
      let settledCalls = 0;
      const operations = users.map((userId) => memory.remember(userId, "ignore-termination")
        .finally(() => { settledCalls += 1; }));
      await waitUntil(() => pidPaths.every(existsSync));
      pids.push(...pidPaths.map((path) => Number(readFileSync(path, "utf8"))));

      const firstClose = memory.close();
      const secondClose = memory.close();
      expect(firstClose).toBe(secondClose);
      await firstClose;

      expect(settledCalls).toBe(2);
      expect(await Promise.all(operations)).toEqual([false, false]);
      expect(pids.every((pid) => !isProcessAlive(pid))).toBe(true);
      await expect(memory.recall("later-user", "later call")).rejects.toThrow("closed");
    } finally {
      for (const pid of pids) forceKill(pid);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("stores and recalls user-isolated memory through the real plugin", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-hermes-bridge-"));
    const memory = new HermesMemoryBridge({ dataDir, timeoutMs: 10_000 });
    try {
      expect(await memory.remember("user-a", "用户偏好靠窗的火车座位。"))
        .toBe(true);
      expect(await memory.recall("user-a", "火车座位偏好")).toContain("靠窗");
      expect(await memory.recall("user-b", "火车座位偏好")).toBe("");
      const entries = await memory.list("user-a");
      expect(entries).toEqual([
        expect.objectContaining({ id: expect.any(String), memory: expect.stringContaining("靠窗") }),
      ]);
      expect(await memory.remove("user-a", entries[0].id)).toBe(true);
      expect(await memory.list("user-a")).toEqual([]);
      expect(await memory.recall("user-a", "火车座位偏好")).not.toContain("靠窗");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("degrades blank identities and queries without starting a worker", async () => {
    const memory = new HermesMemoryBridge({ dataDir: "/path/that/must/not/be/created" });
    expect(await memory.recall("", "偏好")).toBe("");
    expect(await memory.recall("user", "  ")).toBe("");
    expect(await memory.remember("", "内容")).toBe(false);
    expect(await memory.list("")).toEqual([]);
    expect(await memory.remove("", "1")).toBe(false);
  });
});
