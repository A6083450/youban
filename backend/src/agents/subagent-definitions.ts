import type { RuntimeAgentDefinition } from "pi-subagents/agents";
import { renderAssignedSkills } from "./skill-registry.ts";
import type { SkillAgentId, SkillCatalogSnapshot } from "./skill-types.ts";

export interface YoubanSubagentDefinition {
  name: string;
  definition: RuntimeAgentDefinition;
}

function defineAgent(
  name: Exclude<SkillAgentId, "parent-assistant">,
  description: string,
  instructions: string,
  snapshot: SkillCatalogSnapshot,
): YoubanSubagentDefinition {
  return {
    name,
    definition: {
      description,
      systemPrompt: [instructions, renderAssignedSkills(snapshot, name)].filter(Boolean).join("\n\n"),
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

export const YOUBAN_SUBAGENT_NAMES = [
  "destination-researcher",
  "segment-planner",
  "summary",
  "itinerary-reviewer",
  "plan-editor",
] as const satisfies readonly Exclude<SkillAgentId, "parent-assistant">[];

export function createYoubanSubagentDefinitions(
  snapshot: SkillCatalogSnapshot,
): readonly YoubanSubagentDefinition[] {
  return [
  defineAgent(
    "destination-researcher",
    "Select destination candidates from server-provided travel facts.",
    "Use only the structured facts in the task. Return the requested schema without reading files or calling tools.",
    snapshot,
  ),
  defineAgent(
    "segment-planner",
    "Build one bounded itinerary segment from validated inputs.",
    "Plan only the assigned dates and cities. Preserve every hard constraint and return the requested schema without calling tools.",
    snapshot,
  ),
  defineAgent(
    "summary",
    "Summarize a complete itinerary without changing its facts.",
    "Summarize only the supplied itinerary in at most 800 Chinese characters. Be concise and do not add destinations, prices, bookings, or claims that are absent from the input.",
    snapshot,
  ),
  defineAgent(
    "itinerary-reviewer",
    "Review itinerary consistency, feasibility, accessibility, and budget.",
    "Return at most 6 concise, highest-impact violations against the supplied facts and constraints. Do not silently repair the plan or invent missing evidence.",
    snapshot,
  ),
  defineAgent(
    "plan-editor",
    "Produce a minimal revision-safe patch for a requested itinerary change.",
    "Return only the requested structured patch. Preserve untouched fields and stop on revision or evidence conflicts.",
    snapshot,
  ),
  ];
}
