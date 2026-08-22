import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPROVED_SKILL_NAMES,
  BUILTIN_SKILL_ASSIGNMENTS,
  loadBuiltinSkillDefinitions,
  reconcileBuiltinSkills,
  renderAssignedSkills,
} from "../src/agents/skill-registry.ts";
import { SkillCatalogRepository } from "../src/agents/skill-repository.ts";
import type { SkillAgentId } from "../src/agents/skill-types.ts";
import { YoubanDatabase } from "../src/domain/database.ts";

const tempDirs: string[] = [];

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "youban-skill-registry-"));
  tempDirs.push(dir);
  return join(dir, "youban.db");
}

function createRepository(): { database: YoubanDatabase; repository: SkillCatalogRepository } {
  const database = new YoubanDatabase(databasePath());
  return { database, repository: new SkillCatalogRepository(database) };
}

function idFor(name: string, repository: SkillCatalogRepository): string {
  const skill = repository.getByName(name);
  if (!skill) throw new Error(`Missing built-in skill: ${name}`);
  return skill.id;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("repository-owned built-in skills", () => {
  it("loads exactly four validated built-ins without file-system metadata", () => {
    const definitions = loadBuiltinSkillDefinitions();

    expect(definitions.map((skill) => skill.name).sort()).toEqual(
      [...APPROVED_SKILL_NAMES].sort(),
    );
    expect(definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "trip-planning",
        content: expect.not.stringContaining("SKILL.md"),
        packageRelativePath: "skills/trip-planning/SKILL.md",
      }),
    ]));
  });

  it("rejects a built-in skill file that resolves outside the repository directory", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-skills-"));
    const registryRoot = join(tempRoot, "registry");
    const escapedRoot = join(tempRoot, "escaped-plan-editing");
    mkdirSync(registryRoot);

    for (const name of APPROVED_SKILL_NAMES) {
      const skillDirectory = join(registryRoot, name);
      mkdirSync(skillDirectory, { recursive: true });
      writeFileSync(
        join(skillDirectory, "SKILL.md"),
        `---\nname: ${name}\ndescription: Test skill for registry validation.\n---\n\n# ${name}\n`,
      );
    }
    mkdirSync(escapedRoot);
    writeFileSync(
      join(escapedRoot, "SKILL.md"),
      "---\nname: plan-editing\ndescription: Escaped skill.\n---\n\n# Plan editing\n",
    );
    rmSync(join(registryRoot, "plan-editing", "SKILL.md"));
    symlinkSync(join(escapedRoot, "SKILL.md"), join(registryRoot, "plan-editing", "SKILL.md"));

    try {
      expect(() => loadBuiltinSkillDefinitions(registryRoot)).toThrow("resolves outside registry");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reconciles four built-ins without replacing admin assignments", () => {
    const { database, repository } = createRepository();
    try {
      reconcileBuiltinSkills(repository);
      repository.configure(idFor("trip-planning", repository), {
        enabled: true,
        agentIds: ["segment-planner"],
      });
      reconcileBuiltinSkills(repository);

      expect(repository.get(idFor("trip-planning", repository))?.agentIds).toEqual(["segment-planner"]);
      expect(repository.list()).toHaveLength(4);
    } finally {
      database.close();
    }
  });

  it("preserves the four existing parent and subagent assignments on first reconciliation", () => {
    const { database, repository } = createRepository();
    try {
      reconcileBuiltinSkills(repository);
      const snapshot = repository.snapshot();

      for (const [agentId, expectedNames] of Object.entries(BUILTIN_SKILL_ASSIGNMENTS) as Array<[
        SkillAgentId,
        readonly string[],
      ]>) {
        expect(snapshot.assignments[agentId].map((skill) => skill.name)).toEqual(
          [...expectedNames].sort(),
        );
      }
    } finally {
      database.close();
    }
  });

  it("renders only enabled prompt contents assigned in the snapshot", () => {
    const { database, repository } = createRepository();
    try {
      reconcileBuiltinSkills(repository);
      const prompt = renderAssignedSkills(repository.snapshot(), "segment-planner");

      expect(prompt).toContain('<skill name="trip-planning">');
      expect(prompt).toContain("行程节奏");
      expect(prompt).toContain("预算硬约束");
      expect(prompt).not.toContain("SKILL.md");
      expect(prompt).not.toContain("skills/");
    } finally {
      database.close();
    }
  });
});
