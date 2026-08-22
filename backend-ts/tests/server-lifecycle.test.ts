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
import type { DefaultParentAgentOptions } from "../src/agents/default-parent-agent.ts";
import type { DefaultTripPlannerOptions } from "../src/agents/default-trip-planner.ts";
import type { DefaultTripChatServiceOptions } from "../src/agents/default-trip-chat-service.ts";
import type { LlmCallOptions, LlmClient } from "../src/agents/llm/providers.ts";
import type { StructuredAgentRequest } from "../src/agents/pi-trip-planner.ts";
import { SkillManagementService } from "../src/agents/skill-management-service.ts";
import { TripAssistant } from "../src/agents/trip-assistant.ts";
import { TripChatService } from "../src/agents/trip-chat-service.ts";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import { ConfirmationLedger } from "../src/domain/confirmation.ts";
import { ConversationRepository } from "../src/domain/conversations.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createTaskState, SqliteTaskStore } from "../src/domain/task-store.ts";
import { SqliteUserRepository } from "../src/domain/users.ts";
import type { AdminSkillService } from "../src/http/admin-skills.ts";
import { createHttpRuntime } from "../src/http/app.ts";
import {
  installMemoryPressureHandler,
  listenProductionHttpServer,
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

class ClosablePlanner implements TripPlanner {
  closeCount = 0;

  constructor(private readonly onClose: () => void | Promise<void> = () => {}) {}

  async plan(request: TripPlanningRequest, _context: PlannerRunContext) {
    return { success: true, data: request };
  }

  close(): void | Promise<void> {
    this.closeCount += 1;
    return this.onClose();
  }
}

function observeConstructionStoreCloses() {
  const counts = { tasks: 0, users: 0, conversations: 0 };
  const taskClose = SqliteTaskStore.prototype.close;
  const userClose = SqliteUserRepository.prototype.close;
  const conversationClose = ConversationRepository.prototype.close;
  SqliteTaskStore.prototype.close = function closeObservedTaskStore() {
    counts.tasks += 1;
    return taskClose.call(this);
  };
  SqliteUserRepository.prototype.close = function closeObservedUserStore() {
    counts.users += 1;
    return userClose.call(this);
  };
  ConversationRepository.prototype.close = function closeObservedConversationStore() {
    counts.conversations += 1;
    return conversationClose.call(this);
  };
  return {
    counts,
    restore() {
      SqliteTaskStore.prototype.close = taskClose;
      SqliteUserRepository.prototype.close = userClose;
      ConversationRepository.prototype.close = conversationClose;
    },
  };
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
  it("supplies a bounded production request body limit with multipart envelope room", () => {
    let received: {
      hostname: string;
      port: number;
      maxRequestBodySize: number;
    } | undefined;
    const marker = { stop() {} };
    const result = listenProductionHttpServer({
      listen(options) {
        received = options;
        return marker;
      },
    }, { hostname: "127.0.0.1", port: 8000 });

    expect(result).toBe(marker);
    expect(received).toEqual({
      hostname: "127.0.0.1",
      port: 8000,
      maxRequestBodySize: 13 * 1024 * 1024,
    });
  });

  it("closes owned stores and Skills exactly once when the initial parent factory throws", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-construction-parent-failure-"));
    const stores = observeConstructionStoreCloses();
    let ownedSkills: AdminSkillService | undefined;
    let skillCloseCount = 0;
    try {
      expect(() => createHttpRuntime({
        dataDir,
        serviceFactories: {
          parentAgent(options: DefaultParentAgentOptions) {
            ownedSkills = options.skillCatalog as AdminSkillService;
            const close = ownedSkills.close.bind(ownedSkills);
            ownedSkills.close = () => {
              skillCloseCount += 1;
              close();
            };
            throw new Error("initial parent factory failed");
          },
        },
      })).toThrow("initial parent factory failed");

      await waitUntil(() => skillCloseCount === 1);
      expect(stores.counts).toEqual({ tasks: 1, users: 1, conversations: 1 });
      expect(() => ownedSkills!.list()).toThrowError(expect.objectContaining({ code: "skill_service_closed" }));
      await flushAsyncWork();
      expect(skillCloseCount).toBe(1);
      expect(stores.counts).toEqual({ tasks: 1, users: 1, conversations: 1 });
    } finally {
      stores.restore();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("settles generated agents before closing owned Skills when chat construction fails", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-construction-chat-failure-"));
    const stores = observeConstructionStoreCloses();
    const order: string[] = [];
    let skillCloseCount = 0;
    let catalog: AdminSkillService | undefined;
    let diagnostics: DefaultParentAgentOptions["skillRuntimeDiagnostics"];
    let parentCloseCount = 0;
    let plannerCloseCount = 0;
    const parent = new ReleasableParent();
    parent.close = async () => {
      parentCloseCount += 1;
      order.push("parent:start");
      await Bun.sleep(0);
      order.push("parent:end");
      throw new Error("generated parent close failed");
    };
    const planner = new ClosablePlanner(async () => {
      order.push("planner:start");
      await Bun.sleep(0);
      order.push("planner:end");
    });
    try {
      expect(() => createHttpRuntime({
        dataDir,
        serviceFactories: {
          parentAgent(options: DefaultParentAgentOptions) {
            catalog = options.skillCatalog as AdminSkillService;
            diagnostics = options.skillRuntimeDiagnostics;
            const close = catalog.close.bind(catalog);
            catalog.close = () => {
              skillCloseCount += 1;
              order.push("skills");
              close();
            };
            return parent;
          },
          planner(options: DefaultTripPlannerOptions) {
            expect(options.skillCatalog).toBe(catalog);
            expect(options.skillRuntimeDiagnostics).toBe(diagnostics);
            return planner;
          },
          chatService(options: DefaultTripChatServiceOptions) {
            expect(options.skillCatalog).toBe(catalog);
            expect(options.skillRuntimeDiagnostics).toBe(diagnostics);
            throw new Error("initial chat factory failed");
          },
        },
      })).toThrow("initial chat factory failed");

      await waitUntil(() => skillCloseCount === 1);
      expect(parentCloseCount).toBe(1);
      plannerCloseCount = planner.closeCount;
      expect(plannerCloseCount).toBe(1);
      expect(order.indexOf("parent:end")).toBeLessThan(order.indexOf("skills"));
      expect(order.indexOf("planner:end")).toBeLessThan(order.indexOf("skills"));
      expect(stores.counts).toEqual({ tasks: 1, users: 1, conversations: 1 });
      await flushAsyncWork();
      expect(skillCloseCount).toBe(1);
    } finally {
      stores.restore();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("does not close injected services when a later initial factory throws", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-construction-borrowed-failure-"));
    const skillRoot = mkdtempSync(join(tmpdir(), "youban-construction-borrowed-skill-"));
    const skillService = new SkillManagementService({
      databasePath: join(skillRoot, "youban.db"),
      dataDir: join(skillRoot, "skills"),
      builtinSkillsDir: join(import.meta.dir, "../src/agents/skills"),
    });
    let skillCloseCount = 0;
    const originalSkillClose = skillService.close.bind(skillService);
    skillService.close = () => {
      skillCloseCount += 1;
      originalSkillClose();
    };
    const parent = new ReleasableParent();
    let parentCloseCount = 0;
    parent.close = async () => { parentCloseCount += 1; };
    const planner = new ClosablePlanner();
    const chat = new TripChatService({ llm: new HangingLlm(), mode: "simple", parentAgent: parent });
    let chatCloseCount = 0;
    chat.close = () => { chatCloseCount += 1; };
    let unexpectedRuntime: ReturnType<typeof createHttpRuntime> | undefined;
    try {
      let constructionError: unknown;
      try {
        unexpectedRuntime = createHttpRuntime({
          dataDir,
          skillService,
          parentAgent: parent,
          planner,
          chatService: chat,
          serviceFactories: {
            poiSearch() { throw new Error("initial poi factory failed"); },
          },
        });
      } catch (error) {
        constructionError = error;
      }
      expect(constructionError).toEqual(expect.objectContaining({ message: "initial poi factory failed" }));
      await flushAsyncWork();
      expect(skillCloseCount).toBe(0);
      expect(parentCloseCount).toBe(0);
      expect(planner.closeCount).toBe(0);
      expect(chatCloseCount).toBe(0);
    } finally {
      await unexpectedRuntime?.close();
      originalSkillClose();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(skillRoot, { recursive: true, force: true });
    }
  });

  it("does not close injected services during normal runtime shutdown", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-shutdown-borrowed-"));
    const skillRoot = mkdtempSync(join(tmpdir(), "youban-shutdown-borrowed-skill-"));
    const skillService = new SkillManagementService({
      databasePath: join(skillRoot, "youban.db"),
      dataDir: join(skillRoot, "skills"),
      builtinSkillsDir: join(import.meta.dir, "../src/agents/skills"),
    });
    let skillCloseCount = 0;
    const originalSkillClose = skillService.close.bind(skillService);
    skillService.close = () => {
      skillCloseCount += 1;
      originalSkillClose();
    };
    const parent = new ReleasableParent();
    let parentCloseCount = 0;
    parent.close = async () => { parentCloseCount += 1; };
    const planner = new ClosablePlanner();
    const chat = new TripChatService({ llm: new HangingLlm(), mode: "simple", parentAgent: parent });
    let chatCloseCount = 0;
    chat.close = () => { chatCloseCount += 1; };
    let runtime: ReturnType<typeof createHttpRuntime> | undefined;
    try {
      runtime = createHttpRuntime({
        dataDir,
        skillService,
        parentAgent: parent,
        planner,
        chatService: chat,
      });
      await runtime.close();
      expect(skillCloseCount).toBe(0);
      expect(parentCloseCount).toBe(0);
      expect(planner.closeCount).toBe(0);
      expect(chatCloseCount).toBe(0);
    } finally {
      await runtime?.close();
      originalSkillClose();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(skillRoot, { recursive: true, force: true });
    }
  });

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

  it("drains active Skill calls before closing its owned service exactly once", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-skill-runtime-close-"));
    const runtime = createHttpRuntime({ dataDir, parentAgent: new ReleasableParent() });
    const skills = runtime.skills;
    const installed = skills.get(skills.list()[0]!.id);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    const originalClose = skills.close.bind(skills);
    let closeCount = 0;
    skills.stageGit = async () => {
      started = true;
      await gate;
      return installed;
    };
    skills.close = () => {
      closeCount += 1;
      originalClose();
    };

    try {
      const request = runtime.app.handle(new Request("http://localhost/api/admin/skills/git", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": "admin@123",
        },
        body: JSON.stringify({ repository_url: "https://git.example.test/org/repo.git" }),
      }));
      await waitUntil(() => started);
      const firstClose = runtime.close();
      const secondClose = runtime.close();
      expect(firstClose).toBe(secondClose);
      await flushAsyncWork();
      expect(closeCount).toBe(0);

      release();
      expect((await request).status).toBe(201);
      await firstClose;
      expect(closeCount).toBe(1);
    } finally {
      release();
      await runtime.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("does not close a Skill service injected by its caller", async () => {
    const ownerDir = mkdtempSync(join(tmpdir(), "youban-skill-owner-"));
    const borrowerDir = mkdtempSync(join(tmpdir(), "youban-skill-borrower-"));
    const owner = createHttpRuntime({ dataDir: ownerDir, parentAgent: new ReleasableParent() });
    const sharedSkills = owner.skills;
    const originalClose = sharedSkills.close.bind(sharedSkills);
    let closeCount = 0;
    sharedSkills.close = () => {
      closeCount += 1;
      originalClose();
    };
    const borrower = createHttpRuntime({
      dataDir: borrowerDir,
      parentAgent: new ReleasableParent(),
      skillService: sharedSkills,
    });

    try {
      await borrower.close();
      expect(closeCount).toBe(0);
      expect(sharedSkills.list()).toHaveLength(4);
      await owner.close();
      expect(closeCount).toBe(1);
    } finally {
      await borrower.close();
      await owner.close();
      rmSync(ownerDir, { recursive: true, force: true });
      rmSync(borrowerDir, { recursive: true, force: true });
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
