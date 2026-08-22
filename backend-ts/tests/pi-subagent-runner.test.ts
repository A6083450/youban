import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  PI_RUNTIME_API_KEY_ENV,
  PiSubagentRunner,
  writeRuntimeModelConfig,
} from "../src/agents/pi-subagent-runner.ts";
import { createMockPiModel } from "./helpers/mock-pi-model.ts";
import type { SkillCatalogProvider } from "../src/agents/skill-management-service.ts";
import type { SkillCatalogSnapshot } from "../src/agents/skill-types.ts";
import { SkillRuntimeDiagnostics } from "../src/agents/skill-runtime-diagnostics.ts";

function skillSnapshot(generation: number): SkillCatalogSnapshot {
  return {
    generation,
    assignments: {
      "parent-assistant": [],
      "destination-researcher": [],
      "segment-planner": [],
      summary: [],
      "itinerary-reviewer": [],
      "plan-editor": [],
    },
  };
}

class TestSkillCatalog implements SkillCatalogProvider {
  constructor(private current: SkillCatalogSnapshot) {}
  snapshot(): SkillCatalogSnapshot { return this.current; }
  subscribe(): () => void { return () => {}; }
  publish(next: SkillCatalogSnapshot): void { this.current = next; }
}

function request(nodeId: string, signal = new AbortController().signal) {
  return {
    agent: "segment-planner" as const,
    nodeId,
    input: { nodeId },
    schema: { type: "string" },
    signal,
  };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("timed out waiting for condition");
    await Bun.sleep(5);
  }
}

describe("PiSubagentRunner", () => {
  it("keeps same-generation structured runs parallel on one host", async () => {
    const catalog = new TestSkillCatalog(skillSnapshot(1));
    const release = deferred();
    const createdGenerations: number[] = [];
    let active = 0;
    let maxActive = 0;
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-parallel",
      runtimeDir: "/tmp/youban-runner-parallel/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillCatalog: catalog,
      hostFactory: async (options) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        return {
          generation,
          async delegate() {
            active += 1;
            maxActive = Math.max(maxActive, active);
            try { await release.promise; } finally { active -= 1; }
            return { status: "completed", result: { kind: "structured", value: generation } };
          },
          cancel() {},
          dispose() {},
        } as any;
      },
    });
    try {
      const first = runner.run(request("a"));
      const second = runner.run(request("b"));
      await waitUntil(() => maxActive === 2);
      release.resolve();
      await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
      expect(maxActive).toBe(2);
      expect(createdGenerations).toEqual([1]);
    } finally {
      release.resolve();
      await runner.close();
    }
  });

  it("waits for old structured work, rotates once, then resumes new-generation runs in parallel", async () => {
    const catalog = new TestSkillCatalog(skillSnapshot(1));
    const oldStarted = deferred();
    const releaseOld = deferred();
    const createdGenerations: number[] = [];
    const disposedGenerations: number[] = [];
    const activeByGeneration = new Map<number, number>();
    const maxActiveByGeneration = new Map<number, number>();
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-busy-rotation",
      runtimeDir: "/tmp/youban-runner-busy-rotation/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillCatalog: catalog,
      hostFactory: async (options) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        return {
          generation,
          async delegate(delegation: { nodeId: string }) {
            const active = (activeByGeneration.get(generation) ?? 0) + 1;
            activeByGeneration.set(generation, active);
            maxActiveByGeneration.set(generation, Math.max(maxActiveByGeneration.get(generation) ?? 0, active));
            try {
              if (delegation.nodeId === "old") {
                oldStarted.resolve();
                await releaseOld.promise;
              } else {
                await Bun.sleep(20);
              }
            } finally {
              activeByGeneration.set(generation, (activeByGeneration.get(generation) ?? 1) - 1);
            }
            return {
              status: "completed",
              result: { kind: "structured", value: `${generation}:${delegation.nodeId}` },
            };
          },
          cancel() {},
          dispose() { disposedGenerations.push(generation); },
        } as any;
      },
    });
    try {
      const old = runner.run(request("old"));
      await oldStarted.promise;
      catalog.publish(skillSnapshot(2));
      const nextA = runner.run(request("next-a"));
      const nextB = runner.run(request("next-b"));
      await Bun.sleep(10);
      expect(createdGenerations).toEqual([1]);
      releaseOld.resolve();

      await expect(old).resolves.toBe("1:old");
      await expect(Promise.all([nextA, nextB])).resolves.toEqual(["2:next-a", "2:next-b"]);
      expect(createdGenerations).toEqual([1, 2]);
      expect(disposedGenerations).toEqual([1]);
      expect(maxActiveByGeneration.get(2)).toBe(2);
    } finally {
      releaseOld.resolve();
      await runner.close();
    }
  });

  it("refreshes a stale waiter to the latest generation before rotating", async () => {
    const catalog = new TestSkillCatalog(skillSnapshot(1));
    const oldStarted = deferred();
    const releaseOld = deferred();
    const createdGenerations: number[] = [];
    const delegatedGenerations: number[] = [];
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-latest-waiter",
      runtimeDir: "/tmp/youban-runner-latest-waiter/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillCatalog: catalog,
      hostFactory: async (options) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        return {
          generation,
          async delegate(delegation: { nodeId: string }) {
            delegatedGenerations.push(generation);
            if (delegation.nodeId === "old") {
              oldStarted.resolve();
              await releaseOld.promise;
            }
            return { status: "completed", result: { kind: "structured", value: generation } };
          },
          cancel() {},
          dispose() {},
        } as any;
      },
    });
    try {
      const old = runner.run(request("old"));
      await oldStarted.promise;
      catalog.publish(skillSnapshot(2));
      const waiting = runner.run(request("waiting"));
      await Bun.sleep(0);
      catalog.publish(skillSnapshot(3));
      releaseOld.resolve();

      await expect(old).resolves.toBe(1);
      await expect(waiting).resolves.toBe(3);
      expect(createdGenerations).toEqual([1, 3]);
      expect(delegatedGenerations).toEqual([1, 3]);
    } finally {
      releaseOld.resolve();
      await runner.close();
    }
  });

  it("rejects cancellation while waiting for rotation without creating or delegating", async () => {
    const catalog = new TestSkillCatalog(skillSnapshot(1));
    const oldStarted = deferred();
    const releaseOld = deferred();
    const createdGenerations: number[] = [];
    const delegatedNodes: string[] = [];
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-cancel-rotation",
      runtimeDir: "/tmp/youban-runner-cancel-rotation/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillCatalog: catalog,
      hostFactory: async (options) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        return {
          generation,
          async delegate(delegation: { nodeId: string }) {
            delegatedNodes.push(delegation.nodeId);
            if (delegation.nodeId === "old") {
              oldStarted.resolve();
              await releaseOld.promise;
            }
            return { status: "completed", result: { kind: "structured", value: generation } };
          },
          cancel() {},
          dispose() {},
        } as any;
      },
    });
    const old = runner.run(request("old"));
    await oldStarted.promise;
    catalog.publish(skillSnapshot(2));
    const controller = new AbortController();
    const cancelled = runner.run(request("cancelled", controller.signal));
    await Bun.sleep(0);
    controller.abort(new Error("cancelled while waiting"));

    await expect(cancelled).rejects.toThrow("cancelled while waiting");
    expect(createdGenerations).toEqual([1]);
    expect(delegatedNodes).toEqual(["old"]);
    releaseOld.resolve();
    await old;
    await runner.close();
  });

  it("replaces a failed structured-host rotation with a later generation success", async () => {
    const catalog = new TestSkillCatalog(skillSnapshot(1));
    const diagnostics = new SkillRuntimeDiagnostics();
    const createdGenerations: number[] = [];
    let generationTwoAttempts = 0;
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-rotation-retry",
      runtimeDir: "/tmp/youban-runner-rotation-retry/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillCatalog: catalog,
      skillRuntimeDiagnostics: diagnostics,
      hostFactory: async (options) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        if (generation === 2 && ++generationTwoAttempts === 1) {
          throw new Error("failed at /private/runner with token=secret");
        }
        return {
          generation,
          async delegate() {
            return { status: "completed", result: { kind: "structured", value: generation } };
          },
          cancel() {},
          dispose() {},
        } as any;
      },
    });
    try {
      await expect(runner.run(request("old"))).resolves.toBe(1);
      catalog.publish(skillSnapshot(2));
      await expect(runner.run(request("failure"))).rejects.toThrow("failed at");
      expect(diagnostics.snapshot()).toEqual([{
        component: "pi-subagent-runner",
        generation: 2,
        status: "failure",
        errorCode: "structured_host_rotation_failed",
      }]);
      expect(JSON.stringify(diagnostics.snapshot())).not.toContain("/private/runner");
      expect(JSON.stringify(diagnostics.snapshot())).not.toContain("token=secret");
      catalog.publish(skillSnapshot(3));
      await expect(runner.run(request("retry"))).resolves.toBe(3);
      expect(createdGenerations).toEqual([1, 2, 3]);
      expect(diagnostics.snapshot()).toEqual([{
        component: "pi-subagent-runner",
        generation: 3,
        status: "success",
      }]);
    } finally {
      await runner.close();
    }
  });

  it("keeps explicit fixed-snapshot runner test doubles compatible", async () => {
    const createdGenerations: number[] = [];
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-fixed-snapshot",
      runtimeDir: "/tmp/youban-runner-fixed-snapshot/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillSnapshot: skillSnapshot(41),
      hostFactory: async (options) => {
        const generation = options.skillSnapshot.generation;
        createdGenerations.push(generation);
        return {
          generation,
          async delegate() {
            return { status: "completed", result: { kind: "structured", value: generation } };
          },
          cancel() {},
          dispose() {},
        } as any;
      },
    });
    try {
      await expect(Promise.all([
        runner.run(request("fixed-a")),
        runner.run(request("fixed-b")),
      ])).resolves.toEqual([41, 41]);
      expect(createdGenerations).toEqual([41]);
    } finally {
      await runner.close();
    }
  });

  it("waits for pending host creation before closing and delegates nothing", async () => {
    const creationStarted = deferred();
    const releaseCreation = deferred();
    let delegateCalls = 0;
    let disposeCalls = 0;
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-close-creation",
      runtimeDir: "/tmp/youban-runner-close-creation/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillSnapshot: skillSnapshot(1),
      hostFactory: async (options) => {
        creationStarted.resolve();
        await releaseCreation.promise;
        return {
          generation: options.skillSnapshot.generation,
          async delegate() {
            delegateCalls += 1;
            return { status: "completed", result: { kind: "structured", value: 1 } };
          },
          cancel() {},
          dispose() { disposeCalls += 1; },
        } as any;
      },
    });
    const running = runner.run(request("creation"));
    await creationStarted.promise;
    let closed = false;
    const closing = runner.close().then(() => { closed = true; });
    await Bun.sleep(0);
    expect(closed).toBeFalse();
    releaseCreation.resolve();

    await expect(running).rejects.toThrow("closed");
    await closing;
    expect(delegateCalls).toBe(0);
    expect(disposeCalls).toBe(1);
  });

  it("waits for active work before closing its structured host once", async () => {
    const workStarted = deferred();
    const releaseWork = deferred();
    let disposeCalls = 0;
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-close-work",
      runtimeDir: "/tmp/youban-runner-close-work/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillSnapshot: skillSnapshot(1),
      hostFactory: async (options) => ({
        generation: options.skillSnapshot.generation,
        async delegate() {
          workStarted.resolve();
          await releaseWork.promise;
          return { status: "completed", result: { kind: "structured", value: 1 } };
        },
        cancel() {},
        dispose() { disposeCalls += 1; },
      } as any),
    });
    const running = runner.run(request("work"));
    await workStarted.promise;
    let closed = false;
    const closing = runner.close().then(() => { closed = true; });
    await Bun.sleep(0);
    expect(closed).toBeFalse();
    releaseWork.resolve();

    await expect(running).resolves.toBe(1);
    await closing;
    expect(disposeCalls).toBe(1);
  });

  it("waits for pending rotation creation before closing both generations once", async () => {
    const catalog = new TestSkillCatalog(skillSnapshot(1));
    const rotationStarted = deferred();
    const releaseRotation = deferred();
    const disposeCounts = new Map<number, number>();
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-runner-close-rotation",
      runtimeDir: "/tmp/youban-runner-close-rotation/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "test/model",
      skillCatalog: catalog,
      hostFactory: async (options) => {
        const generation = options.skillSnapshot.generation;
        if (generation === 2) {
          rotationStarted.resolve();
          await releaseRotation.promise;
        }
        return {
          generation,
          async delegate() {
            return { status: "completed", result: { kind: "structured", value: generation } };
          },
          cancel() {},
          dispose() { disposeCounts.set(generation, (disposeCounts.get(generation) ?? 0) + 1); },
        } as any;
      },
    });
    try {
      await expect(runner.run(request("old"))).resolves.toBe(1);
      catalog.publish(skillSnapshot(2));
      const rotating = runner.run(request("rotating"));
      await rotationStarted.promise;
      let closed = false;
      const closing = runner.close().then(() => { closed = true; });
      await Bun.sleep(0);
      expect(closed).toBeFalse();
      releaseRotation.resolve();

      await expect(rotating).rejects.toThrow("closed");
      await closing;
      expect(Object.fromEntries(disposeCounts)).toEqual({ 1: 1, 2: 1 });
    } finally {
      releaseRotation.resolve();
      await runner.close();
    }
  });

  it("runs a real structured pi-subagents child and returns its value", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-runner-"));
    const runtimeDir = join(tempRoot, "runtime");
    const mock = createMockPiModel(runtimeDir, { value: { verdict: "ok" } });
    const previousKey = process.env[PI_RUNTIME_API_KEY_ENV];
    process.env[PI_RUNTIME_API_KEY_ENV] = "previous-value";
    const runner = new PiSubagentRunner({
      cwd: tempRoot,
      runtimeDir,
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "youban-mock/mock-model",
      apiKey: "runtime-secret",
      timeoutMs: 10_000,
    });
    try {
      expect(await runner.run({
        agent: "segment-planner",
        nodeId: "runner-smoke",
        input: { fixed: true },
        schema: {
          type: "object",
          properties: { verdict: { type: "string" } },
          required: ["verdict"],
          additionalProperties: false,
        },
        signal: new AbortController().signal,
      })).toEqual({ verdict: "ok" });
      expect(mock.requests).toHaveLength(1);
      const systemPrompt = (
        mock.requests[0]?.messages as Array<{ role: string; content: string }> | undefined
      )?.find((message) => message.role === "system")?.content ?? "";
      expect(systemPrompt).toContain('<skill name="trip-planning">');
      expect(systemPrompt).toContain('<skill name="budget-control">');
      expect(systemPrompt).not.toContain('<skill name="plan-editing">');
      expect(systemPrompt).not.toContain("SKILL.md");
      expect(process.env[PI_RUNTIME_API_KEY_ENV]).toBe("runtime-secret");
    } finally {
      await runner.close();
      expect(process.env[PI_RUNTIME_API_KEY_ENV]).toBe("previous-value");
      if (previousKey === undefined) delete process.env[PI_RUNTIME_API_KEY_ENV];
      else process.env[PI_RUNTIME_API_KEY_ENV] = previousKey;
      mock.stop();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("writes a restrictive model config with an env reference instead of the secret", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-config-"));
    try {
      const path = writeRuntimeModelConfig(tempRoot, {
        baseUrl: "https://example.invalid/v1/",
        model: "deepseek-v4-flash",
        apiStyle: "responses",
      });
      const raw = readFileSync(path, "utf8");
      expect(raw).toContain("$YOUBAN_PI_RUNTIME_API_KEY");
      expect(raw).not.toContain("real-secret-value");
      const parsed = JSON.parse(raw);
      expect(parsed.providers["youban-runtime"]).toEqual(expect.objectContaining({
        baseUrl: "https://example.invalid/v1",
        api: "openai-responses",
      }));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not delegate when cancellation happens during host initialization", async () => {
    let resolveHost!: (host: any) => void;
    const hostPromise = new Promise<any>((resolve) => { resolveHost = resolve; });
    let delegateCalls = 0;
    let disposed = false;
    const runner = new PiSubagentRunner({
      cwd: "/tmp/youban-pi-cold-cancel",
      runtimeDir: "/tmp/youban-pi-cold-cancel/runtime",
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "youban-mock/mock-model",
      hostFactory: () => hostPromise,
    });
    const controller = new AbortController();
    const result = runner.run({
      agent: "segment-planner",
      nodeId: "cold-cancel",
      input: {},
      schema: { type: "object" },
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled during startup"));
    resolveHost({
      delegate: async () => { delegateCalls += 1; return { status: "completed" }; },
      cancel() {},
      dispose() { disposed = true; },
    });
    await expect(result).rejects.toThrow("cancelled during startup");
    expect(delegateCalls).toBe(0);
    await runner.close();
    expect(disposed).toBeTrue();
  });
});
