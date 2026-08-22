import type { RuntimeAgentDefinition } from "pi-subagents/agents";
import { renderApprovedSkills, type ApprovedSkillName } from "./skill-registry.ts";

export interface YoubanSubagentDefinition {
  name: string;
  definition: RuntimeAgentDefinition;
}

function defineAgent(
  name: string,
  description: string,
  instructions: string,
  skillNames: readonly ApprovedSkillName[],
): YoubanSubagentDefinition {
  return {
    name,
    definition: {
      description,
      systemPrompt: `${instructions}\n\n${renderApprovedSkills(skillNames)}`,
      systemPromptMode: "replace",
      tools: [],
      extensions: [],
      inheritProjectContext: false,
      inheritSkills: false,
      defaultContext: "fresh",
      maxSubagentDepth: 1,
      completionGuard: false,
    },
  };
}

export const YOUBAN_SUBAGENT_DEFINITIONS: readonly YoubanSubagentDefinition[] = [
  defineAgent(
    "destination-researcher",
    "Select destination candidates from server-provided travel facts.",
    "Use only the structured facts in the task. Return the requested schema without reading files or calling tools.",
    ["trip-planning", "family-accessibility"],
  ),
  defineAgent(
    "segment-planner",
    "Build one bounded itinerary segment from validated inputs.",
    "Plan only the assigned dates and cities. Preserve every hard constraint and return the requested schema without calling tools.",
    ["trip-planning", "budget-control", "family-accessibility"],
  ),
  defineAgent(
    "summary",
    "Summarize a complete itinerary without changing its facts.",
    "Summarize only the supplied itinerary. Do not add destinations, prices, bookings, or claims that are absent from the input.",
    ["trip-planning"],
  ),
  defineAgent(
    "itinerary-reviewer",
    "Review itinerary consistency, feasibility, accessibility, and budget.",
    "Report concrete violations against the supplied facts and constraints. Do not silently repair the plan or invent missing evidence.",
    ["trip-planning", "budget-control", "family-accessibility"],
  ),
  defineAgent(
    "plan-editor",
    "Produce a minimal revision-safe patch for a requested itinerary change.",
    "Return only the requested structured patch. Preserve untouched fields and stop on revision or evidence conflicts.",
    ["plan-editing", "budget-control", "family-accessibility"],
  ),
];

export const YOUBAN_SUBAGENT_NAMES = YOUBAN_SUBAGENT_DEFINITIONS.map(
  (agent) => agent.name,
);
