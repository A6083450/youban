import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { SkillValidationError, validateSkillDocument } from "./skill-document.ts";
import { SkillCatalogRepository } from "./skill-repository.ts";
import {
  SKILL_AGENT_IDS,
  type ReconciledBuiltinSkill,
  type SkillAgentId,
  type SkillCatalogSnapshot,
  type SkillPrompt,
} from "./skill-types.ts";

export const APPROVED_SKILL_NAMES = [
  "budget-control",
  "family-accessibility",
  "plan-editing",
  "trip-planning",
] as const;

export type ApprovedSkillName = (typeof APPROVED_SKILL_NAMES)[number];

export const BUILTIN_SKILL_ASSIGNMENTS: Readonly<Record<SkillAgentId, readonly ApprovedSkillName[]>> = {
  "parent-assistant": APPROVED_SKILL_NAMES,
  "destination-researcher": ["trip-planning", "family-accessibility"],
  "segment-planner": ["trip-planning", "budget-control", "family-accessibility"],
  summary: ["trip-planning"],
  "itinerary-reviewer": ["trip-planning", "budget-control", "family-accessibility"],
  "plan-editor": ["plan-editing", "budget-control", "family-accessibility"],
};

const DEFAULT_SKILLS_DIR = join(import.meta.dir, "skills");

function isInsideDirectory(filePath: string, directory: string): boolean {
  const childPath = relative(directory, filePath);
  return childPath !== ".." && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath);
}

function defaultAgentIdsFor(name: ApprovedSkillName): SkillAgentId[] {
  return SKILL_AGENT_IDS.filter((agentId) => BUILTIN_SKILL_ASSIGNMENTS[agentId].includes(name));
}

function readUtf8SkillDocument(filePath: string): string {
  const bytes = readFileSync(filePath);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SkillValidationError("invalid_skill_encoding", "skill document must be valid UTF-8 text");
  }
}

export function loadBuiltinSkillDefinitions(
  skillsDir = DEFAULT_SKILLS_DIR,
): ReconciledBuiltinSkill[] {
  const root = realpathSync(skillsDir);
  return APPROVED_SKILL_NAMES.map((name) => {
    const relativePath = join(name, "SKILL.md");
    const filePath = realpathSync(join(root, relativePath));
    if (!isInsideDirectory(filePath, root)) {
      throw new Error(`Built-in skill resolves outside registry: ${name}`);
    }
    const document = validateSkillDocument(readUtf8SkillDocument(filePath), name);
    return {
      ...document,
      packageRelativePath: join("skills", relativePath),
      defaultAgentIds: defaultAgentIdsFor(name),
    };
  });
}

export function reconcileBuiltinSkills(repository: SkillCatalogRepository): void {
  for (const skill of loadBuiltinSkillDefinitions()) repository.reconcileBuiltin(skill);
}

export function createBuiltinSkillCatalogSnapshot(): SkillCatalogSnapshot {
  const definitions = new Map(loadBuiltinSkillDefinitions().map((skill) => [skill.name, skill]));
  const assignments = {} as Record<SkillAgentId, SkillPrompt[]>;
  for (const agentId of SKILL_AGENT_IDS) {
    assignments[agentId] = BUILTIN_SKILL_ASSIGNMENTS[agentId].map((name) => {
      const skill = definitions.get(name);
      if (!skill) throw new Error(`Unknown approved skill: ${name}`);
      return {
        id: `builtin:${name}`,
        name: skill.name,
        content: skill.content,
        versionId: skill.sha256,
      } satisfies SkillPrompt;
    });
  }
  return { generation: 0, assignments };
}

export function renderAssignedSkills(
  snapshot: SkillCatalogSnapshot,
  agentId: SkillAgentId,
): string {
  const blocks = snapshot.assignments[agentId].map(
    (skill) => `<skill name="${skill.name}">\n${skill.content.trim()}\n</skill>`,
  );
  return blocks.length
    ? `Follow these server-approved skills when relevant:\n\n${blocks.join("\n\n")}`
    : "";
}

// Compatibility for the current fixed agent definitions until they consume catalog snapshots.
export function renderApprovedSkills(names: readonly ApprovedSkillName[]): string {
  const definitions = new Map(loadBuiltinSkillDefinitions().map((skill) => [skill.name, skill]));
  const assigned = names.map((name) => {
    const skill = definitions.get(name);
    if (!skill) throw new Error(`Unknown approved skill: ${name}`);
    return {
      id: `builtin:${name}`,
      name: skill.name,
      content: skill.content,
      versionId: skill.sha256,
    } satisfies SkillPrompt;
  });
  const assignments = {} as Record<SkillAgentId, readonly SkillPrompt[]>;
  for (const agentId of SKILL_AGENT_IDS) {
    assignments[agentId] = agentId === "parent-assistant" ? assigned : [];
  }
  return renderAssignedSkills({ generation: 0, assignments }, "parent-assistant");
}
