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
import type { LlmCallOptions, LlmClient } from "../src/agents/llm/providers.ts";
import type { StructuredAgentRequest } from "../src/agents/pi-trip-planner.ts";
import { TripAssistant } from "../src/agents/trip-assistant.ts";
import { ConfirmationLedger } from "../src/domain/confirmation.ts";
import { createTaskState } from "../src/domain/task-store.ts";
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

class HangingLlm implements LlmClient {
  readonly model = {
    id: "hanging",
    name: "hanging",
    api: "openai-completions" as const,
    provider: "test",
    baseUrl: "http://test.invalid",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000,
    maxTokens: 1_000,
  };
  signal: AbortSignal | undefined;

  async *stream(_prompt: string, options?: LlmCallOptions): AsyncIterable<string> {
    this.signal = options?.signal;
    if (!this.signal) throw new Error("missing request signal");
    await new Promise<void>((_resolve, reject) => {
      if (this.signal!.aborted) return reject(this.signal!.reason);
      this.signal!.addEventListener("abort", () => reject(this.signal!.reason), { once: true });
    });
  }

  async complete(): Promise<string> {
    throw new Error("unexpected non-stream completion");
  }
}

async function flushAsyncWork(): Promise<void> {
  await Bun.sleep(0);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("timed out waiting for condition");
    await Bun.sleep(5);
  }
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

  it("begins runtime drain before server stop and closes resources afterward", async () => {
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
      beginShutdown() { order.push("runtime:begin"); },
      async close() { order.push("runtime:close"); },
    }, { timeoutMs: 1_000 });

    await flushAsyncWork();
    expect(order).toEqual(["runtime:begin", "stop:false:start"]);
    finishStop();
    await shutdown;
    expect(order).toEqual(["runtime:begin", "stop:false:start", "stop:end", "runtime:close"]);
  });

  it("drains a live SSE request and WebSocket before Bun stops accepting connections", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-runtime-shutdown-"));
    const llm = new HangingLlm();
    const runtime = createHttpRuntime({
      dataDir,
      parentAgent: new ReleasableParent(),
      assistant: new TripAssistant({ llm, ledger: new ConfirmationLedger() }),
    });
    runtime.tasks.save(createTaskState("active-task", { user_id: "owner" }), { immediate: true });
    const server = runtime.app.listen({ hostname: "127.0.0.1", port: 0 }).server;
    if (!server) throw new Error("test server did not bind a port");

    const sseRequest = fetch(`http://127.0.0.1:${server.port}/api/trip/parse/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "keep streaming" }),
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/trip/ws/active-task?user_id=owner`);
    const socketReady = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("websocket did not open")), 2_000);
      socket.onmessage = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("websocket failed before shutdown"));
      };
    });
    const socketClosed = new Promise<number>((resolve) => {
      socket.onclose = (event) => resolve(event.code);
    });

    try {
      await Promise.all([waitUntil(() => Boolean(llm.signal)), socketReady]);
      const startedAt = performance.now();
      await shutdownServer(server, runtime, { timeoutMs: 1_000 });
      expect(performance.now() - startedAt).toBeLessThan(1_000);
      expect(llm.signal?.aborted).toBeTrue();
      expect(await socketClosed).toBe(1012);
      const sseResponse = await sseRequest;
      expect(sseResponse.status).toBe(200);
      expect(await sseResponse.text()).toBe("");
    } finally {
      socket.close();
      await server.stop(true);
      await runtime.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
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
