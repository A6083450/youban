import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createYoubanAgentSession } from "../src/agents/session-host.ts";
import { YOUBAN_SUBAGENT_NAMES } from "../src/agents/subagent-definitions.ts";
import type {
  SkillAgentId,
  SkillCatalogSnapshot,
  SkillPrompt,
} from "../src/agents/skill-types.ts";
import { createMockPiModel } from "./helpers/mock-pi-model.ts";

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

describe("Pi session host", () => {
  it("pins every parent and child prompt before asynchronous session initialization", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-session-"));
    const runtimeDir = join(tempRoot, "runtime");
    const mockModel = createMockPiModel(runtimeDir);
    const markers: Record<SkillAgentId, string> = {
      "parent-assistant": "parent-original-marker",
      "destination-researcher": "destination-original-marker",
      "segment-planner": "segment-original-marker",
      summary: "summary-original-marker",
      "itinerary-reviewer": "review-original-marker",
      "plan-editor": "editor-original-marker",
    };
    const original = snapshot(201, {
      "parent-assistant": [prompt(markers["parent-assistant"])],
      "destination-researcher": [prompt(markers["destination-researcher"])],
      "segment-planner": [prompt(markers["segment-planner"])],
      summary: [prompt(markers.summary)],
      "itinerary-reviewer": [prompt(markers["itinerary-reviewer"])],
      "plan-editor": [prompt(markers["plan-editor"])],
    });
    const hostPromise = createYoubanAgentSession({
      cwd: tempRoot,
      runtimeDir,
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: original,
      tools: ["subagent"],
    });
    original.generation = 202;
    for (const agentId of Object.keys(markers) as SkillAgentId[]) {
      const assigned = original.assignments[agentId] as SkillPrompt[];
      assigned[0]!.name = `mutated-${agentId}`;
      assigned[0]!.content = `mutated-${agentId}`;
    }
    const host = await hostPromise;

    try {
      expect(host.extensionErrors).toEqual([]);
      expect(host.session.getActiveToolNames()).toEqual(["subagent"]);
      expect(host.session.getActiveToolNames()).not.toContain("read");
      expect(host.session.getActiveToolNames()).not.toContain("bash");
      expect(host.session.getActiveToolNames()).not.toContain("edit");
      expect(host.session.getActiveToolNames()).not.toContain("write");
      expect(host.resourceLoader.getSkills().skills).toEqual([]);
      expect(host.generation).toBe(201);
      expect(host.session.systemPrompt).toContain(markers["parent-assistant"]);
      for (const agentId of YOUBAN_SUBAGENT_NAMES) {
        expect(host.session.systemPrompt).not.toContain(markers[agentId]);
      }
      expect(host.session.systemPrompt).not.toContain("mutated-parent-assistant");
      expect(host.session.systemPrompt).not.toContain("SKILL.md");

      for (const agentId of YOUBAN_SUBAGENT_NAMES) {
        const response = await host.delegate({
          requestId: crypto.randomUUID(),
          ownerRunId: "snapshot-pinning",
          nodeId: `pinned-${agentId}`,
          agent: agentId,
          task: `Return the fixed verdict for ${agentId}.`,
          context: "fresh",
          cwd: tempRoot,
          timeoutMs: 10_000,
          turnBudget: { maxTurns: 1 },
          toolBudget: { hard: 0, block: ["read", "bash", "edit", "write", "grep", "find", "ls"] },
          result: {
            kind: "structured",
            schema: {
              type: "object",
              properties: { verdict: { type: "string" } },
              required: ["verdict"],
              additionalProperties: false,
            },
          },
        });
        expect(response.status).toBe("completed");
      }
      expect(mockModel.requests).toHaveLength(YOUBAN_SUBAGENT_NAMES.length);
      for (const [index, agentId] of YOUBAN_SUBAGENT_NAMES.entries()) {
        const request = JSON.stringify(mockModel.requests[index]);
        expect(request).toContain(markers[agentId]);
        expect(request).not.toContain(markers["parent-assistant"]);
        for (const otherAgentId of YOUBAN_SUBAGENT_NAMES) {
          if (otherAgentId !== agentId) expect(request).not.toContain(markers[otherAgentId]);
        }
        expect(request).not.toContain("mutated-");
      }

      const denied = await host.delegate({
        requestId: crypto.randomUUID(),
        ownerRunId: "test-run",
        nodeId: "deny-ambient-agent",
        agent: "scout",
        task: "This ambient builtin must never launch.",
        context: "fresh",
        cwd: tempRoot,
        result: { kind: "text" },
      });
      expect(denied.status).toBe("failed");
      expect(denied.error?.toLowerCase()).toContain("capability ceiling");
    } finally {
      host.dispose();
      mockModel.stop();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs a real structured child against a local mock model with no caller tools", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-child-"));
    const runtimeDir = join(tempRoot, "runtime");
    const mockModel = createMockPiModel(runtimeDir);
    const childSnapshot = snapshot(203, {
      "segment-planner": [prompt("child-generation-one-marker")],
      summary: [prompt("summary-only-marker")],
    });

    const parentModel = getModel("openai", "gpt-4o-mini")!;
    const host = await createYoubanAgentSession({
      cwd: tempRoot,
      runtimeDir,
      model: parentModel,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: childSnapshot,
      tools: ["subagent"],
    });

    try {
      const response = await host.delegate({
        requestId: crypto.randomUUID(),
        ownerRunId: "structured-smoke",
        nodeId: "segment-1",
        agent: "segment-planner",
        task: "Return the fixed verdict from the local test model.",
        context: "fresh",
        cwd: tempRoot,
        timeoutMs: 10_000,
        turnBudget: { maxTurns: 1 },
        toolBudget: {
          hard: 0,
          block: ["read", "bash", "edit", "write", "grep", "find", "ls"],
        },
        result: {
          kind: "structured",
          schema: {
            type: "object",
            properties: { verdict: { type: "string" } },
            required: ["verdict"],
            additionalProperties: false,
          },
        },
      });

      if (response.status === "invalid_request") {
        throw new Error(response.error ?? "invalid structured delegation request");
      }
      expect(response).toMatchObject({ status: "completed" });
      expect(response.result).toEqual({
        kind: "structured",
        value: { verdict: "ok" },
      });
      expect(mockModel.requests).toHaveLength(1);
      expect(JSON.stringify(mockModel.requests[0])).toContain("child-generation-one-marker");
      expect(JSON.stringify(mockModel.requests[0])).not.toContain("summary-only-marker");
      const tools = mockModel.requests[0]?.tools as Array<{ function?: { name?: string } }>;
      expect(tools.map((tool) => tool.function?.name)).toEqual(["structured_output"]);
    } finally {
      host.dispose();
      mockModel.stop();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("cancels one exact child attempt without waiting for the model response", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-cancel-"));
    const runtimeDir = join(tempRoot, "runtime");
    const mockModel = createMockPiModel(runtimeDir, { delayMs: 5_000 });
    const host = await createYoubanAgentSession({
      cwd: tempRoot,
      runtimeDir,
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: builtinSnapshot(),
      tools: ["subagent"],
    });
    const identity = {
      requestId: crypto.randomUUID(),
      ownerRunId: "cancel-smoke",
      nodeId: "segment-cancelled",
    };

    try {
      const startedAt = performance.now();
      const resultPromise = host.delegate({
        ...identity,
        agent: "segment-planner",
        task: "Wait until cancelled.",
        context: "fresh",
        cwd: tempRoot,
        timeoutMs: 10_000,
        result: { kind: "text" },
      });
      for (let attempts = 0; attempts < 500 && mockModel.requests.length === 0; attempts += 1) {
        await Bun.sleep(10);
      }
      expect(mockModel.requests).toHaveLength(1);
      host.cancel(identity);

      const response = await resultPromise;
      expect(response.status).toBe("cancelled");
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    } finally {
      host.dispose();
      mockModel.stop();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("runs independent structured children concurrently", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-parallel-"));
    const runtimeDir = join(tempRoot, "runtime");
    const mockModel = createMockPiModel(runtimeDir, { delayMs: 200 });
    const host = await createYoubanAgentSession({
      cwd: tempRoot,
      runtimeDir,
      model: getModel("openai", "gpt-4o-mini")!,
      subagentModel: "youban-mock/mock-model",
      skillSnapshot: builtinSnapshot(),
      tools: ["subagent"],
    });
    const run = (nodeId: string) =>
      host.delegate({
        requestId: crypto.randomUUID(),
        ownerRunId: "parallel-smoke",
        nodeId,
        agent: "segment-planner",
        task: `Build ${nodeId}.`,
        context: "fresh",
        cwd: tempRoot,
        timeoutMs: 10_000,
        toolBudget: {
          hard: 0,
          block: ["read", "bash", "edit", "write", "grep", "find", "ls"],
        },
        result: {
          kind: "structured",
          schema: {
            type: "object",
            properties: { verdict: { type: "string" } },
            required: ["verdict"],
            additionalProperties: false,
          },
        },
      });

    try {
      const responses = await Promise.all([run("segment-a"), run("segment-b")]);
      expect(responses.map((response) => response.status)).toEqual([
        "completed",
        "completed",
      ]);
      expect(mockModel.maxActiveRequests).toBe(2);
    } finally {
      host.dispose();
      mockModel.stop();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
