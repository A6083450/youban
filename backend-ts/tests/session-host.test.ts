import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createYoubanAgentSession } from "../src/agents/session-host.ts";
import { createMockPiModel } from "./helpers/mock-pi-model.ts";

describe("Pi session host", () => {
  it("loads only the explicit subagent extension, tools, and preloaded skills", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-session-"));
    const model = getModel("openai", "gpt-4o-mini");
    expect(model).toBeDefined();

    const host = await createYoubanAgentSession({
      cwd: tempRoot,
      runtimeDir: join(tempRoot, "runtime"),
      model: model!,
      skillNames: ["trip-planning"],
      tools: ["subagent"],
    });

    try {
      expect(host.extensionErrors).toEqual([]);
      expect(host.session.getActiveToolNames()).toEqual(["subagent"]);
      expect(host.session.getActiveToolNames()).not.toContain("read");
      expect(host.session.getActiveToolNames()).not.toContain("bash");
      expect(host.session.getActiveToolNames()).not.toContain("edit");
      expect(host.session.getActiveToolNames()).not.toContain("write");
      expect(host.resourceLoader.getSkills().skills).toEqual([]);
      expect(host.session.systemPrompt).toContain('<skill name="trip-planning">');
      expect(host.session.systemPrompt).not.toContain("SKILL.md");

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
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs a real structured child against a local mock model with no caller tools", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-child-"));
    const runtimeDir = join(tempRoot, "runtime");
    const mockModel = createMockPiModel(runtimeDir);

    const parentModel = getModel("openai", "gpt-4o-mini")!;
    const host = await createYoubanAgentSession({
      cwd: tempRoot,
      runtimeDir,
      model: parentModel,
      subagentModel: "youban-mock/mock-model",
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
