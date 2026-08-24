import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PersistentPiParentAgent, type ParentAgentScope } from "../src/agents/persistent-parent-agent.ts";
import { createMockPiModel } from "./helpers/mock-pi-model.ts";
import {
  createYoubanAgentSession,
  type CreateYoubanAgentSessionOptions,
  type YoubanAgentSessionHost,
} from "../src/agents/session-host.ts";
import type { SkillCatalogProvider } from "../src/agents/skill-management-service.ts";
import { SkillRuntimeDiagnostics } from "../src/agents/skill-runtime-diagnostics.ts";
import type {
  SkillAgentId,
  SkillCatalogSnapshot,
  SkillPrompt,
} from "../src/agents/skill-types.ts";

function prompt(marker: string): SkillPrompt {
  return {
    id: `skill:${marker}`,
    name: marker,
    content: marker,
    versionId: `version:${marker}`,
  };
}

function snapshot(
  generation = 101,
  assignments: Partial<Record<SkillAgentId, readonly SkillPrompt[]>> = {},
): SkillCatalogSnapshot {
  return {
    generation,
    assignments: {
      "parent-assistant": assignments["parent-assistant"] ?? [],
      "destination-researcher": assignments["destination-researcher"] ?? [],
      "segment-planner": assignments["segment-planner"] ?? [],
      summary: assignments.summary ?? [],
      "itinerary-reviewer": assignments["itinerary-reviewer"] ?? [],
      "plan-editor": assignments["plan-editor"] ?? [],
    },
  };
}

function builtinSnapshot(): SkillCatalogSnapshot {
  return snapshot(101, {
    "parent-assistant": [prompt("budget-control"), prompt("family-accessibility"), prompt("plan-editing"), prompt("trip-planning")],
    "destination-researcher": [prompt("family-accessibility"), prompt("trip-planning")],
    "segment-planner": [prompt("budget-control"), prompt("family-accessibility"), prompt("trip-planning")],
    summary: [prompt("trip-planning")],
    "itinerary-reviewer": [prompt("budget-control"), prompt("family-accessibility"), prompt("trip-planning")],
    "plan-editor": [prompt("budget-control"), prompt("family-accessibility"), prompt("plan-editing")],
  });
}

class TestSkillCatalog implements SkillCatalogProvider {
  private current: SkillCatalogSnapshot;
  private readonly listeners = new Set<(snapshot: SkillCatalogSnapshot) => void>();

  constructor(initial: SkillCatalogSnapshot) {
    this.current = initial;
  }

  snapshot(): SkillCatalogSnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: SkillCatalogSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(next: SkillCatalogSnapshot): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function controlledParentHost(options: {
  generation: number;
  sessionDir: string;
  transcript: string[];
  onPrompt?: (prompt: string) => Promise<void>;
  onDispose: () => void;
}): YoubanAgentSessionHost {
  let lastAssistantText = "";
  let disposed = false;
  const session = {
    sessionFile: join(options.sessionDir, "session.jsonl"),
    systemPrompt: `generation:${options.generation}`,
    subscribe() { return () => {}; },
    async abort() {},
    async prompt(value: string) {
      await options.onPrompt?.(value);
      options.transcript.push(value);
      lastAssistantText = options.transcript.join("|");
    },
    getLastAssistantText() { return lastAssistantText; },
    getActiveToolNames() { return ["subagent"]; },
    async sendCustomMessage() {},
  };
  return {
    session,
    resourceLoader: {} as YoubanAgentSessionHost["resourceLoader"],
    extensionErrors: [],
    generation: options.generation,
    async delegate() {
      return { status: "completed", result: { kind: "structured", value: options.generation } };
    },
    cancel() {},
    dispose() {
      if (disposed) return;
      disposed = true;
      options.onDispose();
    },
  } as unknown as YoubanAgentSessionHost;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("timed out waiting for condition");
    await Bun.sleep(5);
  }
}

describe("persistent Pi parent agent", () => {
  it("uses one immutable thinking mode for parent sessions and delegated children", async () => {
    for (const [thinkingEnabled, expectedThinking] of [
      [false, "off"],
      [true, "medium"],
    ] as const) {
      let sessionThinking: boolean | undefined;
      let delegatedThinking: string | undefined;
      const parent = new PersistentPiParentAgent({
        cwd: "/tmp/youban-parent-thinking",
        runtimeDir: "/tmp/youban-parent-thinking/runtime",
        model: {} as never,
        subagentModel: "test/model",
        thinkingEnabled,
        skillSnapshot: snapshot(1),
        sweepIntervalMs: 0,
        sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
          sessionThinking = options.thinkingEnabled;
          const host = controlledParentHost({
            generation: options.skillSnapshot.generation,
            sessionDir: options.sessionDir!,
            transcript: [],
            onDispose() {},
          });
          host.delegate = async (request) => {
            delegatedThinking = request.thinking;
            return {
              requestId: request.requestId,
              ownerRunId: request.ownerRunId,
              nodeId: request.nodeId,
              status: "completed",
              result: { kind: "structured", value: { ok: true } },
            };
          };
          return host;
        },
      });
      try {
        await parent.delegate(
          { key: `user:thinking-${thinkingEnabled}`, userId: "thinking" },
          {
            agent: "plan-editor",
            nodeId: `thinking-${thinkingEnabled}`,
            input: {},
            schema: { type: "object" },
            signal: new AbortController().signal,
          },
        );
        expect(sessionThinking).toBe(thinkingEnabled);
        expect(delegatedThinking).toBe(expectedThinking);
      } finally {
        await parent.close();
      }
    }
  });

  it("rotates an idle scope and preserves its persisted transcript directory", async () => {
    const catalog = new TestSkillCatalog(snapshot(1));
    const createdGenerations: number[] = [];
    const disposedGenerations: number[] = [];
    const sessionDirs: string[] = [];
    const transcripts = new Map<string, string[]>();
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-idle-rotation",
      runtimeDir: "/tmp/youban-parent-idle-rotation/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
        const sessionDir = options.sessionDir!;
        createdGenerations.push(options.skillSnapshot.generation);
        sessionDirs.push(sessionDir);
        const transcript = transcripts.get(sessionDir) ?? [];
        transcripts.set(sessionDir, transcript);
        return controlledParentHost({
          generation: options.skillSnapshot.generation,
          sessionDir,
          transcript,
          onDispose: () => { disposedGenerations.push(options.skillSnapshot.generation); },
        });
      },
    });
    const scope = { key: "user:idle-rotation", userId: "idle-rotation" };
    try {
      await expect(parent.complete({ scope, prompt: "old" })).resolves.toBe("old");
      catalog.publish(snapshot(2));
      await expect(parent.complete({ scope, prompt: "new" })).resolves.toBe("old|new");

      expect(createdGenerations).toEqual([1, 2]);
      expect(disposedGenerations).toEqual([1]);
      expect(sessionDirs).toHaveLength(2);
      expect(sessionDirs[1]).toBe(sessionDirs[0]);
    } finally {
      await parent.close();
    }
  });

  it("lets busy work finish before recreating the scope at the new generation", async () => {
    const catalog = new TestSkillCatalog(snapshot(1));
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const createdGenerations: number[] = [];
    const disposedGenerations: number[] = [];
    let activePrompts = 0;
    let maxActivePrompts = 0;
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-busy-rotation",
      runtimeDir: "/tmp/youban-parent-busy-rotation/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        return controlledParentHost({
          generation,
          sessionDir: options.sessionDir!,
          transcript: [],
          onPrompt: async () => {
            activePrompts += 1;
            maxActivePrompts = Math.max(maxActivePrompts, activePrompts);
            try {
              if (generation === 1) {
                firstStarted.resolve();
                await releaseFirst.promise;
              }
            } finally {
              activePrompts -= 1;
            }
          },
          onDispose: () => { disposedGenerations.push(generation); },
        });
      },
    });
    const scope = { key: "user:busy-rotation", userId: "busy-rotation" };
    try {
      const first = parent.complete({ scope, prompt: "old" });
      await firstStarted.promise;
      catalog.publish(snapshot(2));
      const second = parent.complete({ scope, prompt: "new" });
      releaseFirst.resolve();

      await expect(first).resolves.toBe("old");
      await expect(second).resolves.toBe("new");
      expect(createdGenerations).toEqual([1, 2]);
      expect(disposedGenerations).toEqual([1]);
      expect(maxActivePrompts).toBe(1);
    } finally {
      releaseFirst.resolve();
      await parent.close();
    }
  });

  it("does not create a parent host for pre-aborted completion or delegation", async () => {
    const catalog = new TestSkillCatalog(snapshot(1));
    let factoryCalls = 0;
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-pre-aborted",
      runtimeDir: "/tmp/youban-parent-pre-aborted/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
        factoryCalls += 1;
        return controlledParentHost({
          generation: options.skillSnapshot.generation,
          sessionDir: options.sessionDir!,
          transcript: [],
          onDispose() {},
        });
      },
    });
    const completeController = new AbortController();
    completeController.abort(new Error("completion already cancelled"));
    const delegateController = new AbortController();
    delegateController.abort(new Error("delegation already cancelled"));
    try {
      await expect(parent.complete({
        scope: { key: "user:pre-aborted-complete", userId: "pre-aborted-complete" },
        prompt: "must not create",
        signal: completeController.signal,
      })).rejects.toThrow("completion already cancelled");
      await expect(parent.delegate(
        { key: "user:pre-aborted-delegate", userId: "pre-aborted-delegate" },
        {
          agent: "plan-editor",
          nodeId: "pre-aborted",
          input: {},
          schema: { type: "object" },
          signal: delegateController.signal,
        },
      )).rejects.toThrow("delegation already cancelled");
      expect(factoryCalls).toBe(0);
    } finally {
      await parent.close();
    }
  });

  it("does not rotate a parent host for queued operations cancelled before admission", async () => {
    const catalog = new TestSkillCatalog(snapshot(1));
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const createdGenerations: number[] = [];
    const disposedGenerations: number[] = [];
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-queued-cancel",
      runtimeDir: "/tmp/youban-parent-queued-cancel/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        return controlledParentHost({
          generation,
          sessionDir: options.sessionDir!,
          transcript: [],
          onPrompt: async (value) => {
            if (value === "old") {
              firstStarted.resolve();
              await releaseFirst.promise;
            }
          },
          onDispose: () => { disposedGenerations.push(generation); },
        });
      },
    });
    const scope = { key: "user:queued-cancel", userId: "queued-cancel" };
    const first = parent.complete({ scope, prompt: "old" });
    await firstStarted.promise;
    catalog.publish(snapshot(2));
    const completeController = new AbortController();
    const delegateController = new AbortController();
    const cancelledComplete = parent.complete({
      scope,
      prompt: "cancelled completion",
      signal: completeController.signal,
    });
    const cancelledDelegate = parent.delegate(scope, {
      agent: "plan-editor",
      nodeId: "cancelled-delegation",
      input: {},
      schema: { type: "object" },
      signal: delegateController.signal,
    });
    const observedComplete = cancelledComplete.catch((error) => error);
    const observedDelegate = cancelledDelegate.catch((error) => error);
    await Bun.sleep(0);
    completeController.abort(new Error("queued completion cancelled"));
    delegateController.abort(new Error("queued delegation cancelled"));
    releaseFirst.resolve();
    try {
      await expect(first).resolves.toBe("old");
      expect((await observedComplete as Error).message).toBe("queued completion cancelled");
      expect((await observedDelegate as Error).message).toBe("queued delegation cancelled");
      expect(createdGenerations).toEqual([1]);
      expect(disposedGenerations).toEqual([]);
    } finally {
      releaseFirst.resolve();
      await parent.close();
    }
  });

  it("replaces a failed parent-host rotation with a later generation success", async () => {
    const catalog = new TestSkillCatalog(snapshot(1));
    const diagnostics = new SkillRuntimeDiagnostics();
    const createdGenerations: number[] = [];
    let generationTwoAttempts = 0;
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-rotation-retry",
      runtimeDir: "/tmp/youban-parent-rotation-retry/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillRuntimeDiagnostics: diagnostics,
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        if (generation === 2 && ++generationTwoAttempts === 1) {
          throw new Error("rotation failed at /private/runtime with credential=secret");
        }
        return controlledParentHost({
          generation,
          sessionDir: options.sessionDir!,
          transcript: [],
          onDispose() {},
        });
      },
    });
    const scope = { key: "user:rotation-retry", userId: "rotation-retry" };
    try {
      await parent.complete({ scope, prompt: "old" });
      catalog.publish(snapshot(2));
      await expect(parent.complete({ scope, prompt: "sensitive prompt" })).rejects.toThrow("rotation failed");
      expect(diagnostics.snapshot()).toEqual([{
        component: "persistent-parent-agent",
        generation: 2,
        status: "failure",
        errorCode: "parent_host_rotation_failed",
      }]);
      expect(JSON.stringify(diagnostics.snapshot())).not.toContain("/private/runtime");
      expect(JSON.stringify(diagnostics.snapshot())).not.toContain("sensitive prompt");
      expect(JSON.stringify(diagnostics.snapshot())).not.toContain("credential=secret");
      catalog.publish(snapshot(3));
      await expect(parent.complete({ scope, prompt: "retry" })).resolves.toBe("retry");
      expect(createdGenerations).toEqual([1, 2, 3]);
      expect(diagnostics.snapshot()).toEqual([{
        component: "persistent-parent-agent",
        generation: 3,
        status: "success",
      }]);
    } finally {
      await parent.close();
    }
  });

  it("invalidates a scope when old-host disposal throws and retries with the same session directory", async () => {
    const catalog = new TestSkillCatalog(snapshot(1));
    const diagnostics = new SkillRuntimeDiagnostics();
    const createdGenerations: number[] = [];
    const sessionDirs: string[] = [];
    let generationOneDisposals = 0;
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-dispose-failure",
      runtimeDir: "/tmp/youban-parent-dispose-failure/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillRuntimeDiagnostics: diagnostics,
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        sessionDirs.push(options.sessionDir!);
        return controlledParentHost({
          generation,
          sessionDir: options.sessionDir!,
          transcript: [],
          onDispose: () => {
            if (generation === 1) {
              generationOneDisposals += 1;
              throw new Error("dispose failed at /private/parent with credential=secret");
            }
          },
        });
      },
    });
    const scope = { key: "user:dispose-failure", userId: "dispose-failure" };
    try {
      await expect(parent.complete({ scope, prompt: "old" })).resolves.toBe("old");
      catalog.publish(snapshot(2));
      await expect(parent.complete({ scope, prompt: "rotation" })).rejects.toThrow("dispose failed");
      const failureStatus = diagnostics.snapshot();
      catalog.publish(snapshot(3));
      await expect(parent.complete({ scope, prompt: "retry" })).resolves.toBe("retry");

      expect(generationOneDisposals).toBe(1);
      expect(createdGenerations).toEqual([1, 3]);
      expect(sessionDirs[1]).toBe(sessionDirs[0]);
      expect(failureStatus).toEqual([{
        component: "persistent-parent-agent",
        generation: 2,
        status: "failure",
        errorCode: "parent_host_rotation_failed",
      }]);
      expect(JSON.stringify(failureStatus)).not.toContain("/private/parent");
      expect(JSON.stringify(failureStatus)).not.toContain("credential=secret");
      expect(diagnostics.snapshot()).toEqual([{
        component: "persistent-parent-agent",
        generation: 3,
        status: "success",
      }]);
    } finally {
      await parent.close();
    }
  });

  it("cleans each host once when close waits for a pending rotation", async () => {
    const catalog = new TestSkillCatalog(snapshot(1));
    const rotationStarted = deferred();
    const releaseRotation = deferred();
    const disposeCounts = new Map<number, number>();
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-close-rotation",
      runtimeDir: "/tmp/youban-parent-close-rotation/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => {
        const generation = options.skillSnapshot.generation;
        if (generation === 2) {
          rotationStarted.resolve();
          await releaseRotation.promise;
        }
        return controlledParentHost({
          generation,
          sessionDir: options.sessionDir!,
          transcript: [],
          onDispose: () => { disposeCounts.set(generation, (disposeCounts.get(generation) ?? 0) + 1); },
        });
      },
    });
    const scope = { key: "user:close-rotation", userId: "close-rotation" };
    try {
      await parent.complete({ scope, prompt: "old" });
      catalog.publish(snapshot(2));
      const rotated = parent.complete({ scope, prompt: "new" });
      await waitUntil(() => disposeCounts.get(1) === 1, 200);
      const closed = parent.close();
      releaseRotation.resolve();

      await expect(rotated).resolves.toBe("new");
      await closed;
      expect(Object.fromEntries(disposeCounts)).toEqual({ 1: 1, 2: 1 });
    } finally {
      releaseRotation.resolve();
      await parent.close();
    }
  });

  it("returns one close promise and keeps concurrent callers waiting for active work", async () => {
    const workStarted = deferred();
    const releaseWork = deferred();
    let disposeCalls = 0;
    const parent = new PersistentPiParentAgent({
      cwd: "/tmp/youban-parent-close-idempotent",
      runtimeDir: "/tmp/youban-parent-close-idempotent/runtime",
      model: {} as never,
      subagentModel: "test/model",
      skillSnapshot: snapshot(1),
      sweepIntervalMs: 0,
      sessionFactory: async (options: CreateYoubanAgentSessionOptions) => controlledParentHost({
        generation: options.skillSnapshot.generation,
        sessionDir: options.sessionDir!,
        transcript: [],
        onPrompt: async () => {
          workStarted.resolve();
          await releaseWork.promise;
        },
        onDispose: () => { disposeCalls += 1; },
      }),
    });
    const scope = { key: "user:close-idempotent", userId: "close-idempotent" };
    const running = parent.complete({ scope, prompt: "hold" });
    await workStarted.promise;
    const firstClose = parent.close();
    const secondClose = parent.close();
    const samePromise = firstClose === secondClose;
    const secondResolvedEarly = await Promise.race([
      secondClose.then(() => true),
      Bun.sleep(10).then(() => false),
    ]);
    releaseWork.resolve();

    await expect(running).resolves.toBe("hold");
    await Promise.all([firstClose, secondClose]);
    expect(samePromise).toBeTrue();
    expect(secondResolvedEarly).toBeFalse();
    expect(disposeCalls).toBe(1);
  });

  it("uses the repository-owned built-in parent snapshot without a persisted catalog service", async () => {
    const root = mkdtempSync(join(tmpdir(), "youban-parent-default-snapshot-"));
    const runtimeDir = join(root, "runtime");
    const mock = createMockPiModel(runtimeDir, { text: "default-answer" });
    const parent = new PersistentPiParentAgent({
      cwd: root,
      runtimeDir,
      model: mock.model,
      subagentModel: "youban-mock/mock-model",
      sweepIntervalMs: 0,
    });
    try {
      const inspected = await parent.inspect({ key: "user:defaults", userId: "defaults" });
      expect(inspected.systemPrompt).toContain('<skill name="trip-planning">');
      expect(inspected.systemPrompt).toContain('<skill name="budget-control">');
      expect(inspected.systemPrompt).not.toContain("SKILL.md");
      expect(inspected.tools).toEqual(["subagent"]);
    } finally {
      await parent.close();
      mock.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("persists one scoped transcript, preloads skills, exposes business tools, and delegates a real child", async () => {
    const root = mkdtempSync(join(tmpdir(), "youban-parent-agent-"));
    const runtimeDir = join(root, "runtime");
    const mock = createMockPiModel(runtimeDir, { text: "parent-answer", value: { verdict: "child-ok" } });
    const scope: ParentAgentScope = { key: "user:u1", userId: "u1" };
    const create = () => new PersistentPiParentAgent({
      cwd: root,
      runtimeDir,
      model: mock.model,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: snapshot(301, {
        "parent-assistant": [prompt("persistent-parent-marker")],
      }),
      toolsForScope: () => [defineTool({
        name: "get_trip_context",
        label: "Trip context",
        description: "Returns an owned trip context.",
        parameters: Type.Object({ plan_id: Type.String() }),
        async execute(_id, params) {
          return {
            content: [{ type: "text", text: JSON.stringify({ plan_id: params.plan_id }) }],
            details: undefined,
          };
        },
      })],
    });
    let parent = create();
    try {
      const deltas: string[] = [];
      expect(await parent.complete({ scope, prompt: "hello", onDelta: (text) => { deltas.push(text); } }))
        .toBe("parent-answer");
      expect(deltas.join("")).toBe("parent-answer");
      const inspected = await parent.inspect(scope);
      expect(inspected.tools.sort()).toEqual(["get_trip_context", "subagent"]);
      expect(inspected.systemPrompt).toContain("persistent-parent-marker");
      expect(inspected.sessionFile && existsSync(inspected.sessionFile)).toBeTrue();
      const originalSessionFile = inspected.sessionFile;
      expect(await parent.delegate(scope, {
        agent: "plan-editor",
        nodeId: "edit-1",
        input: { fixed: true },
        schema: {
          type: "object",
          properties: { verdict: { type: "string" } },
          required: ["verdict"],
          additionalProperties: false,
        },
        signal: new AbortController().signal,
      })).toEqual({ verdict: "child-ok" });
      await parent.recordExchange(scope, "change day one", "updated");
      await parent.close();

      parent = create();
      expect((await parent.inspect(scope)).sessionFile).toBe(originalSessionFile);
      expect(await parent.complete({ scope, prompt: "continue" })).toBe("parent-answer");
    } finally {
      await parent.close();
      mock.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("reclaims only idle sessions and restores their persisted transcript", async () => {
    const root = mkdtempSync(join(tmpdir(), "youban-parent-pool-"));
    const runtimeDir = join(root, "runtime");
    const mock = createMockPiModel(runtimeDir, { text: "pool-answer" });
    const scope: ParentAgentScope = { key: "user:idle", userId: "idle" };
    let now = 1_000;
    const parent = new PersistentPiParentAgent({
      cwd: root,
      runtimeDir,
      model: mock.model,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: builtinSnapshot(),
      sessionLimit: 2,
      sessionIdleMs: 100,
      sweepIntervalMs: 0,
      now: () => now,
    });
    try {
      await parent.complete({ scope, prompt: "first" });
      const sessionFile = (await parent.inspect(scope)).sessionFile;
      now += 101;

      expect(await parent.releaseIdleResources("ttl")).toEqual({
        persistent: 0,
        temporary: 0,
        busy: 0,
        evicted: 1,
      });
      expect((await parent.inspect(scope)).sessionFile).toBe(sessionFile);
      expect(await parent.releaseIdleResources("memory-pressure")).toEqual({
        persistent: 0,
        temporary: 0,
        busy: 0,
        evicted: 1,
      });
    } finally {
      await parent.close();
      mock.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("uses one temporary scoped session while the persistent pool is busy", async () => {
    const root = mkdtempSync(join(tmpdir(), "youban-parent-temporary-"));
    const runtimeDir = join(root, "runtime");
    const mock = createMockPiModel(runtimeDir, { text: "delayed", delayMs: 150 });
    const parent = new PersistentPiParentAgent({
      cwd: root,
      runtimeDir,
      model: mock.model,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: builtinSnapshot(),
      sessionLimit: 1,
      sessionIdleMs: 60_000,
      sweepIntervalMs: 0,
    });
    const firstScope: ParentAgentScope = { key: "user:first", userId: "first" };
    const temporaryScope: ParentAgentScope = { key: "user:temporary", userId: "temporary" };
    try {
      const first = parent.complete({ scope: firstScope, prompt: "hold persistent" });
      await waitUntil(() => mock.requests.length === 1);
      const temporaryA = parent.complete({ scope: temporaryScope, prompt: "temporary a" });
      const temporaryB = parent.complete({ scope: temporaryScope, prompt: "temporary b" });
      await waitUntil(() => mock.requests.length === 2);

      expect(await parent.releaseIdleResources("memory-pressure")).toEqual({
        persistent: 1,
        temporary: 1,
        busy: 2,
        evicted: 0,
      });

      await Promise.all([first, temporaryA, temporaryB]);
      expect(mock.maxActiveRequests).toBe(2);
      expect(await parent.releaseIdleResources("memory-pressure")).toEqual({
        persistent: 0,
        temporary: 0,
        busy: 0,
        evicted: 1,
      });
    } finally {
      await parent.close();
      await parent.close();
      mock.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("removes a failed session creation so the same scope can retry", async () => {
    const root = mkdtempSync(join(tmpdir(), "youban-parent-retry-"));
    const runtimeDir = join(root, "runtime");
    const mock = createMockPiModel(runtimeDir, { text: "retry-answer" });
    let attempts = 0;
    const parent = new PersistentPiParentAgent({
      cwd: root,
      runtimeDir,
      model: mock.model,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: builtinSnapshot(),
      sweepIntervalMs: 0,
      sessionFactory: async (options) => {
        attempts += 1;
        if (attempts === 1) throw new Error("session init failed");
        return createYoubanAgentSession(options);
      },
    });
    const scope: ParentAgentScope = { key: "user:retry", userId: "retry" };
    try {
      await expect(parent.inspect(scope)).rejects.toThrow("session init failed");
      expect((await parent.inspect(scope)).sessionFile).toBeString();
      expect(attempts).toBe(2);
    } finally {
      await parent.close();
      mock.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("waits for asynchronous delta handlers before completing", async () => {
    const root = mkdtempSync(join(tmpdir(), "youban-parent-delta-"));
    const runtimeDir = join(root, "runtime");
    const mock = createMockPiModel(runtimeDir, { text: "ordered-delta" });
    const parent = new PersistentPiParentAgent({
      cwd: root,
      runtimeDir,
      model: mock.model,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: builtinSnapshot(),
      sweepIntervalMs: 0,
    });
    const observed: string[] = [];
    try {
      expect(await parent.complete({
        scope: { key: "user:delta", userId: "delta" },
        prompt: "stream",
        async onDelta(text) {
          await Bun.sleep(20);
          observed.push(text);
        },
      })).toBe("ordered-delta");
      expect(observed.join("")).toBe("ordered-delta");
    } finally {
      await parent.close();
      mock.stop();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);
});
