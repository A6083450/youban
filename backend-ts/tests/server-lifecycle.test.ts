import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ParentAgentCompletion,
  ParentAgentScope,
  ParentSessionPoolSnapshot,
  YoubanParentAgent,
} from "../src/agents/persistent-parent-agent.ts";
import type { StructuredAgentRequest } from "../src/agents/pi-trip-planner.ts";
import { createHttpRuntime } from "../src/http/app.ts";
import {
  installMemoryPressureHandler,
  shutdownServer,
  type MemoryPressureProcess,
} from "../src/runtime/server-lifecycle.ts";

class ReleasableParent implements YoubanParentAgent {
  readonly releaseReasons: string[] = [];

  async complete(_input: ParentAgentCompletion): Promise<string> { return ""; }
  async delegate(_scope: ParentAgentScope, _request: StructuredAgentRequest): Promise<unknown> { return {}; }
  async recordExchange(): Promise<void> {}
  async close(): Promise<void> {}
  async releaseIdleResources(reason: "ttl" | "limit" | "memory-pressure"): Promise<ParentSessionPoolSnapshot> {
    this.releaseReasons.push(reason);
    return { persistent: 1, temporary: 0, busy: 1, evicted: 2 };
  }
}

async function flushAsyncWork(): Promise<void> {
  await Bun.sleep(0);
}

describe("Bun server lifecycle", () => {
  it("releases idle runtime resources on memory pressure and removes its listener", async () => {
    const processRef = new EventEmitter() as MemoryPressureProcess & EventEmitter;
    const calls: string[] = [];
    const logs: unknown[] = [];
    const cleanup = installMemoryPressureHandler({
      async releaseIdleResources(reason) {
        calls.push(reason);
        return { persistent: 1, temporary: 0, busy: 1, evicted: 2 };
      },
    }, processRef, {
      info(message, details) { logs.push([message, details]); },
      warn() {},
      error() {},
    });

    processRef.emit("memoryPressure", "critical");
    await flushAsyncWork();
    expect(calls).toEqual(["memory-pressure"]);
    expect(logs).toEqual([["Bun memory pressure cleanup", {
      level: "critical",
      persistent: 1,
      temporary: 0,
      busy: 1,
      evicted: 2,
    }]]);

    cleanup();
    processRef.emit("memoryPressure", "warning");
    await flushAsyncWork();
    expect(calls).toEqual(["memory-pressure"]);
  });

  it("contains memory-pressure cleanup failures", async () => {
    const processRef = new EventEmitter() as MemoryPressureProcess & EventEmitter;
    const warnings: string[] = [];
    const cleanup = installMemoryPressureHandler({
      async releaseIdleResources() { throw new Error("cleanup failed"); },
    }, processRef, {
      info() {},
      warn(message) { warnings.push(message); },
      error() {},
    });

    processRef.emit("memoryPressure", "critical");
    await flushAsyncWork();
    expect(warnings).toEqual(["Bun memory pressure cleanup failed: Error: cleanup failed"]);
    cleanup();
  });

  it("exposes parent-session cleanup through the HTTP runtime", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-runtime-release-"));
    const parent = new ReleasableParent();
    const runtime = createHttpRuntime({ dataDir, parentAgent: parent });
    try {
      expect(await runtime.releaseIdleResources("memory-pressure")).toEqual({
        persistent: 1,
        temporary: 0,
        busy: 1,
        evicted: 2,
      });
      expect(parent.releaseReasons).toEqual(["memory-pressure"]);
    } finally {
      await runtime.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("waits for server stop before closing runtime resources", async () => {
    const order: string[] = [];
    let finishStop!: () => void;
    const stopGate = new Promise<void>((resolve) => { finishStop = resolve; });
    const shutdown = shutdownServer({
      async stop(force) {
        order.push(`stop:${force}:start`);
        await stopGate;
        order.push("stop:end");
      },
    }, {
      async close() { order.push("runtime:close"); },
    }, { timeoutMs: 1_000 });

    await flushAsyncWork();
    expect(order).toEqual(["stop:false:start"]);
    finishStop();
    await shutdown;
    expect(order).toEqual(["stop:false:start", "stop:end", "runtime:close"]);
  });

  it("still closes runtime resources when server stop fails", async () => {
    const order: string[] = [];
    await expect(shutdownServer({
      async stop() {
        order.push("stop");
        throw new Error("stop failed");
      },
    }, {
      async close() { order.push("runtime:close"); },
    })).rejects.toThrow("stop failed");
    expect(order).toEqual(["stop", "runtime:close"]);
  });

  it("exits with status one when graceful shutdown times out", async () => {
    const exitCodes: number[] = [];
    await expect(shutdownServer({
      stop: () => new Promise<void>(() => {}),
    }, {
      async close() {},
    }, {
      timeoutMs: 10,
      exit(code) {
        exitCodes.push(code);
        throw new Error("exit called");
      },
      logger: { info() {}, warn() {}, error() {} },
    })).rejects.toThrow("exit called");
    expect(exitCodes).toEqual([1]);
  });
});
