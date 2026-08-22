import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PersistentPiParentAgent, type ParentAgentScope } from "../src/agents/persistent-parent-agent.ts";
import { createMockPiModel } from "./helpers/mock-pi-model.ts";

describe("persistent Pi parent agent", () => {
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
      expect(inspected.systemPrompt).toContain('<skill name="trip-planning">');
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
});
