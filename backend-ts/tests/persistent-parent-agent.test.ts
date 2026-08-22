import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PersistentPiParentAgent, type ParentAgentScope } from "../src/agents/persistent-parent-agent.ts";
import { createMockPiModel } from "./helpers/mock-pi-model.ts";
import { createYoubanAgentSession } from "../src/agents/session-host.ts";
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

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("timed out waiting for condition");
    await Bun.sleep(5);
  }
}

describe("persistent Pi parent agent", () => {
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
