import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  loadSkillsFromDir,
  type ResourceDiagnostic,
  type Skill,
} from "@earendil-works/pi-coding-agent";

export const APPROVED_SKILL_NAMES = [
  "budget-control",
  "family-accessibility",
  "plan-editing",
  "trip-planning",
] as const;

export type ApprovedSkillName = (typeof APPROVED_SKILL_NAMES)[number];

export interface ApprovedSkillRegistry {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
  contents: ReadonlyMap<ApprovedSkillName, string>;
}

const DEFAULT_SKILLS_DIR = join(import.meta.dir, "skills");
const APPROVED_SKILL_SET = new Set<string>(APPROVED_SKILL_NAMES);

function isInsideDirectory(filePath: string, directory: string): boolean {
  const childPath = relative(directory, filePath);
  return childPath !== ".." && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath);
}

export function loadApprovedSkillRegistry(
  skillsDir = DEFAULT_SKILLS_DIR,
): ApprovedSkillRegistry {
  const root = realpathSync(skillsDir);
  const result = loadSkillsFromDir({ dir: root, source: "youban-server" });

  if (result.diagnostics.length > 0) {
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
    throw new Error(`Invalid approved skill registry: ${messages}`);
  }

  const discoveredNames = new Set(result.skills.map((skill) => skill.name));
  const missing = APPROVED_SKILL_NAMES.filter((name) => !discoveredNames.has(name));
  const unexpected = result.skills
    .map((skill) => skill.name)
    .filter((name) => !APPROVED_SKILL_SET.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Approved skill allowlist mismatch: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  const contents = new Map<ApprovedSkillName, string>();
  for (const skill of result.skills) {
    const filePath = realpathSync(skill.filePath);
    if (!isInsideDirectory(filePath, root)) {
      throw new Error(`Approved skill resolves outside registry: ${skill.name}`);
    }
    contents.set(skill.name as ApprovedSkillName, readFileSync(filePath, "utf-8"));
  }

  return { ...result, contents };
}

export function renderApprovedSkills(
  names: readonly ApprovedSkillName[],
  registry = loadApprovedSkillRegistry(),
): string {
  const blocks = names.map((name) => {
    if (!APPROVED_SKILL_SET.has(name)) {
      throw new Error(`Unknown approved skill: ${name}`);
    }
    const content = registry.contents.get(name);
    if (content === undefined) {
      throw new Error(`Approved skill content is unavailable: ${name}`);
    }
    return `<skill name="${name}">\n${content.trim()}\n</skill>`;
  });

  return blocks.length === 0
    ? ""
    : `Follow these server-approved skills when relevant:\n\n${blocks.join("\n\n")}`;
}
