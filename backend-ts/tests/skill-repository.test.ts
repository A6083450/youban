import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillCatalogRepository } from "../src/agents/skill-repository.ts";
import type { CandidateWrite, ReconciledBuiltinSkill } from "../src/agents/skill-types.ts";
import { YoubanDatabase } from "../src/domain/database.ts";

const tempDirs: string[] = [];

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "youban-skill-catalog-"));
  tempDirs.push(dir);
  return join(dir, "youban.db");
}

function candidate(name: string, content: string): CandidateWrite {
  return {
    content: `---\nname: ${name}\ndescription: ${name} description\n---\n\n${content}`,
    description: `${name} description`,
    sha256: `sha-${content}`,
    packageRelativePath: `packages/${name}/${content}`,
  };
}

function builtin(name: string, content: string): ReconciledBuiltinSkill {
  return { ...candidate(name, content), name, defaultAgentIds: ["parent-assistant"] };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createRepository(): { database: YoubanDatabase; repository: SkillCatalogRepository } {
  const database = new YoubanDatabase(databasePath());
  return { database, repository: new SkillCatalogRepository(database) };
}

describe("SkillCatalogRepository", () => {
  it("uses normalized names as unique catalog identities", () => {
    const { database, repository } = createRepository();
    try {
      const skill = repository.createCustomSkill(candidate("Museum-Guide", "first"));

      expect(repository.getByName(" museum-guide ")?.id).toBe(skill.id);
      expect(() => repository.createCustomSkill(candidate("museum-guide", "second"))).toThrow();
    } finally {
      database.close();
    }
  });

  it("replaces only the unactivated candidate", () => {
    const { database, repository } = createRepository();
    try {
      const skill = repository.createCustomSkill(candidate("museum-guide", "first"));
      repository.saveCandidate(skill.id, candidate("museum-guide", "second"));

      const saved = repository.get(skill.id)!;
      expect(saved.candidateVersion?.content).toContain("second");
      expect(saved.candidateVersion?.versionNumber).toBe(2);
      expect(saved.versions.filter((item) => item.state === "candidate")).toHaveLength(1);
      expect(saved.versions.map((item) => item.state)).toEqual(["archived", "candidate"]);
    } finally {
      database.close();
    }
  });

  it("preserves audit records for a superseded candidate", () => {
    const { database, repository } = createRepository();
    try {
      const skill = repository.createCustomSkill(candidate("museum-guide", "first"));
      repository.appendAudit({
        operation: "candidate-created",
        skillId: skill.id,
        versionId: skill.candidateVersion!.id,
        result: "success",
      });

      repository.saveCandidate(skill.id, candidate("museum-guide", "second"));

      expect(database.raw.query("SELECT count(*) AS count FROM skill_audit_events").get()).toEqual({ count: 1 });
      expect(repository.get(skill.id)?.versions.map((version) => version.state)).toEqual([
        "archived",
        "candidate",
      ]);
    } finally {
      database.close();
    }
  });

  it("rejects version pointers owned by another skill", () => {
    const { database, repository } = createRepository();
    try {
      const first = repository.createCustomSkill(candidate("museum-guide", "first"));
      repository.activate(first.id, { enabled: true, agentIds: ["parent-assistant"] });
      const second = repository.createCustomSkill(candidate("city-guide", "second"));

      expect(() => database.raw.query(
        "UPDATE managed_skills SET active_version_id = ? WHERE id = ?",
      ).run(second.candidateVersion!.id, first.id)).toThrow("FOREIGN KEY constraint failed");
    } finally {
      database.close();
    }
  });

  it("rejects audit events that reference another skill's version", () => {
    const { database, repository } = createRepository();
    try {
      const first = repository.createCustomSkill(candidate("museum-guide", "first"));
      const second = repository.createCustomSkill(candidate("city-guide", "second"));

      expect(() => repository.appendAudit({
        operation: "candidate-created",
        skillId: first.id,
        versionId: second.candidateVersion!.id,
        result: "success",
      })).toThrow("audit version does not belong to skill");
      expect(database.raw.query("SELECT count(*) AS count FROM skill_audit_events").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("deduplicates agent assignments while preserving the active prompt snapshot", () => {
    const { database, repository } = createRepository();
    try {
      const skill = repository.createCustomSkill(candidate("museum-guide", "first"));
      repository.activate(skill.id, {
        enabled: true,
        agentIds: ["parent-assistant", "parent-assistant", "summary"],
      });

      const active = repository.get(skill.id)!;
      expect(active.agentIds).toEqual(["parent-assistant", "summary"]);
      expect(
        database.raw.query("SELECT count(*) AS count FROM skill_agent_assignments WHERE skill_id = ?").get(skill.id),
      ).toEqual({ count: 2 });
      expect(repository.snapshot()).toEqual({
        generation: active.generation,
        assignments: {
          "parent-assistant": [{
            id: skill.id,
            name: "museum-guide",
            content: expect.stringContaining("first"),
            versionId: active.activeVersion!.id,
          }],
          "destination-researcher": [],
          "segment-planner": [],
          summary: [{
            id: skill.id,
            name: "museum-guide",
            content: expect.stringContaining("first"),
            versionId: active.activeVersion!.id,
          }],
          "itinerary-reviewer": [],
          "plan-editor": [],
        },
      });
    } finally {
      database.close();
    }
  });

  it("rolls back activation when a replacement assignment fails", () => {
    const { database, repository } = createRepository();
    try {
      const skill = repository.createCustomSkill(candidate("museum-guide", "first"));
      database.raw.exec(`
        CREATE TRIGGER reject_skill_assignment
        BEFORE INSERT ON skill_agent_assignments
        BEGIN
          SELECT RAISE(ABORT, 'assignment rejected');
        END;
      `);

      expect(() => repository.activate(skill.id, {
        enabled: true,
        agentIds: ["parent-assistant"],
      })).toThrow("assignment rejected");

      const unchanged = repository.get(skill.id)!;
      expect(unchanged.enabled).toBe(false);
      expect(unchanged.activeVersion).toBeUndefined();
      expect(unchanged.candidateVersion?.content).toContain("first");
      expect(unchanged.agentIds).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("reconciles builtin content without replacing saved configuration", () => {
    const { database, repository } = createRepository();
    try {
      const created = repository.reconcileBuiltin(builtin("plan-editing", "first"));
      repository.configure(created.id, { enabled: false, agentIds: ["summary"] });
      repository.reconcileBuiltin(builtin("plan-editing", "second"));
      const restoredContent = repository.reconcileBuiltin(builtin("plan-editing", "first"));

      expect(restoredContent.enabled).toBe(false);
      expect(restoredContent.agentIds).toEqual(["summary"]);
      expect(restoredContent.activeVersion?.content).toContain("first");
      expect(restoredContent.activeVersion?.versionNumber).toBe(3);
      expect(restoredContent.versions.filter((version) => version.state === "active")).toHaveLength(1);
      expect(restoredContent.versions.filter((version) => version.state === "superseded")).toHaveLength(2);
    } finally {
      database.close();
    }
  });
});
