import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPROVED_SKILL_NAMES,
  loadApprovedSkillRegistry,
  renderApprovedSkills,
} from "../src/agents/skill-registry.ts";

describe("approved Pi skills", () => {
  it("discovers exactly the repository-owned skill allowlist", () => {
    const registry = loadApprovedSkillRegistry();

    expect(registry.diagnostics).toEqual([]);
    expect(registry.skills.map((skill) => skill.name).sort()).toEqual(
      [...APPROVED_SKILL_NAMES].sort(),
    );
  });

  it("preloads only the selected skill contents without exposing file paths", () => {
    const prompt = renderApprovedSkills(["trip-planning"]);

    expect(prompt).toContain('<skill name="trip-planning">');
    expect(prompt).toContain("行程节奏");
    expect(prompt).not.toContain("预算硬约束");
    expect(prompt).not.toContain("SKILL.md");
  });

  it("rejects names outside the fixed allowlist", () => {
    expect(() =>
      renderApprovedSkills(["../../user-skill" as "trip-planning"]),
    ).toThrow("Unknown approved skill");
  });

  it("rejects an allowlisted skill symlink that escapes the registry", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "youban-skills-"));
    const registryRoot = join(tempRoot, "registry");
    const escapedRoot = join(tempRoot, "escaped-plan-editing");
    mkdirSync(registryRoot);

    const writeSkill = (baseDir: string, name: string) => {
      mkdirSync(baseDir, { recursive: true });
      writeFileSync(
        join(baseDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: Test skill for registry validation.\n---\n\n# ${name}\n`,
      );
    };

    for (const name of APPROVED_SKILL_NAMES) {
      if (name === "plan-editing") continue;
      writeSkill(join(registryRoot, name), name);
    }
    writeSkill(escapedRoot, "plan-editing");
    symlinkSync(escapedRoot, join(registryRoot, "plan-editing"));

    try {
      expect(() => loadApprovedSkillRegistry(registryRoot)).toThrow(
        "resolves outside registry",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
