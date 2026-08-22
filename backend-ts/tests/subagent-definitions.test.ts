import { describe, expect, it } from "bun:test";
import { YOUBAN_SUBAGENT_DEFINITIONS } from "../src/agents/subagent-definitions.ts";

describe("YouBan runtime subagents", () => {
  it("defines the five planning roles as fresh zero-capability children", () => {
    expect(YOUBAN_SUBAGENT_DEFINITIONS.map((agent) => agent.name)).toEqual([
      "destination-researcher",
      "segment-planner",
      "summary",
      "itinerary-reviewer",
      "plan-editor",
    ]);

    for (const agent of YOUBAN_SUBAGENT_DEFINITIONS) {
      expect(agent.definition.tools).toEqual([]);
      expect(agent.definition.extensions).toEqual([]);
      expect(agent.definition.inheritSkills).toBe(false);
      expect(agent.definition.inheritProjectContext).toBe(false);
      expect(agent.definition.defaultContext).toBe("fresh");
      expect(agent.definition.maxSubagentDepth).toBe(1);
      expect(agent.definition).not.toHaveProperty("skills");
      expect(agent.definition).not.toHaveProperty("skillPath");
      expect(agent.definition.systemPrompt).toContain("<skill name=");
      expect(agent.definition.systemPrompt).not.toContain("SKILL.md");
    }
  });
});
