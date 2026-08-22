import { describe, expect, it } from "bun:test";
import {
  createYoubanSubagentDefinitions,
  YOUBAN_SUBAGENT_NAMES,
} from "../src/agents/subagent-definitions.ts";
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
  assignments: Partial<Record<SkillAgentId, readonly SkillPrompt[]>> = {},
): SkillCatalogSnapshot {
  return {
    generation: 101,
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
  return snapshot({
    "parent-assistant": [prompt("budget-control"), prompt("family-accessibility"), prompt("plan-editing"), prompt("trip-planning")],
    "destination-researcher": [prompt("family-accessibility"), prompt("trip-planning")],
    "segment-planner": [prompt("budget-control"), prompt("family-accessibility"), prompt("trip-planning")],
    summary: [prompt("trip-planning")],
    "itinerary-reviewer": [prompt("budget-control"), prompt("family-accessibility"), prompt("trip-planning")],
    "plan-editor": [prompt("budget-control"), prompt("family-accessibility"), prompt("plan-editing")],
  });
}

describe("YouBan runtime subagents", () => {
  it("defines the five planning roles as fresh zero-capability children", () => {
    const definitions = createYoubanSubagentDefinitions(builtinSnapshot());
    expect(YOUBAN_SUBAGENT_NAMES).toEqual([
      "destination-researcher",
      "segment-planner",
      "summary",
      "itinerary-reviewer",
      "plan-editor",
    ]);

    expect(definitions.map((agent) => agent.name)).toEqual([...YOUBAN_SUBAGENT_NAMES]);
    for (const agent of definitions) {
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

  it("renders only enabled content assigned to each subagent", () => {
    const definitions = createYoubanSubagentDefinitions(snapshot({
      "segment-planner": [prompt("segment-only")],
      summary: [prompt("summary-only")],
    }));
    const definition = (name: string) => definitions.find((agent) => agent.name === name)!.definition;

    expect(definition("segment-planner").systemPrompt).toContain("segment-only");
    expect(definition("segment-planner").systemPrompt).not.toContain("summary-only");
    expect(definition("summary").systemPrompt).toContain("summary-only");
    expect(definition("summary").systemPrompt).not.toContain("segment-only");
  });
});
