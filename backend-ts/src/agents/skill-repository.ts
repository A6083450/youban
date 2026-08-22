import { YoubanDatabase } from "../domain/database.ts";
import {
  SKILL_AGENT_IDS,
  type CandidateWrite,
  type ManagedSkill,
  type NewSkillAuditEvent,
  type ReconciledBuiltinSkill,
  type SkillAgentId,
  type SkillCatalogSnapshot,
  type SkillConfigurationInput,
  type SkillKind,
  type SkillSource,
  type SkillVersion,
  type SkillVersionState,
} from "./skill-types.ts";

interface ManagedSkillRow {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  source: SkillSource;
  repository_url: string | null;
  source_ref: string | null;
  source_subdirectory: string | null;
  enabled: number;
  active_version_id: string | null;
  candidate_version_id: string | null;
  generation: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface SkillVersionRow {
  id: string;
  skill_id: string;
  version_number: number;
  state: SkillVersionState;
  content: string;
  name: string;
  description: string;
  sha256: string;
  package_relative_path: string;
  source_commit: string | null;
  created_at: string;
  activated_at: string | null;
}

const SKILL_AGENT_ID_SET = new Set<string>(SKILL_AGENT_IDS);

function nowIso(): string {
  return new Date().toISOString();
}

function nextId(): string {
  return crypto.randomUUID();
}

function normalizeName(value: string): string {
  return String(value ?? "").trim().normalize("NFKC").toLocaleLowerCase("und");
}

function nameFromContent(content: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const match = frontmatter?.[1].match(/^name:\s*(.+?)\s*$/m);
  if (!match) throw new Error("skill content must include a frontmatter name");
  return normalizeName(match[1].replace(/^(?:"|')|(?:"|')$/g, ""));
}

function toVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    versionNumber: row.version_number,
    state: row.state,
    content: row.content,
    name: row.name,
    description: row.description,
    sha256: row.sha256,
    packageRelativePath: row.package_relative_path,
    ...(row.source_commit ? { sourceCommit: row.source_commit } : {}),
    createdAt: row.created_at,
    ...(row.activated_at ? { activatedAt: row.activated_at } : {}),
  };
}

export class SkillCatalogRepository {
  constructor(private readonly database: YoubanDatabase) {}

  transaction<T>(operation: () => T): T {
    return this.database.raw.transaction(operation)();
  }

  list(options: { archived?: boolean } = {}): ManagedSkill[] {
    const rows = this.database.raw.query(
      `SELECT * FROM managed_skills
       WHERE archived_at IS ${options.archived ? "NOT " : ""}NULL
       ORDER BY name`,
    ).all() as ManagedSkillRow[];
    return rows.map((row) => this.toManagedSkill(row));
  }

  get(skillId: string): ManagedSkill | undefined {
    const row = this.database.raw.query("SELECT * FROM managed_skills WHERE id = ?").get(skillId) as ManagedSkillRow | null;
    return row ? this.toManagedSkill(row) : undefined;
  }

  getByName(name: string): ManagedSkill | undefined {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return undefined;
    const row = this.database.raw.query("SELECT * FROM managed_skills WHERE name = ?").get(normalizedName) as ManagedSkillRow | null;
    return row ? this.toManagedSkill(row) : undefined;
  }

  reconcileBuiltin(input: ReconciledBuiltinSkill): ManagedSkill {
    const name = normalizeName(input.name);
    if (!name) throw new Error("builtin skill name is required");
    let skillId = "";
    this.transaction(() => {
      const existing = this.skillRowByName(name);
      if (!existing) {
        const createdAt = nowIso();
        skillId = nextId();
        this.database.raw.query(`
          INSERT INTO managed_skills (
            id, name, description, kind, source, enabled, generation, created_at, updated_at
          ) VALUES (?, ?, ?, 'builtin', 'builtin', 1, 1, ?, ?)
        `).run(skillId, name, input.description, createdAt, createdAt);
        const versionId = this.insertVersion(skillId, 1, "active", input, name, createdAt);
        this.database.raw.query(
          "UPDATE managed_skills SET active_version_id = ? WHERE id = ?",
        ).run(versionId, skillId);
        this.replaceAssignments(skillId, input.defaultAgentIds);
        return;
      }

      if (existing.kind !== "builtin") {
        throw new Error(`skill name is already used by a custom skill: ${name}`);
      }
      skillId = existing.id;
      const matchingVersion = existing.active_version_id
        ? this.database.raw.query(
          "SELECT id FROM skill_versions WHERE id = ? AND skill_id = ? AND sha256 = ?",
        ).get(existing.active_version_id, existing.id, input.sha256) as { id: string } | null
        : null;
      if (matchingVersion) return;

      const changedAt = nowIso();
      if (existing.active_version_id) {
        this.database.raw.query(
          "UPDATE skill_versions SET state = 'superseded' WHERE id = ?",
        ).run(existing.active_version_id);
      }
      if (existing.candidate_version_id) {
        this.database.raw.query(
          "UPDATE skill_versions SET state = 'archived' WHERE id = ?",
        ).run(existing.candidate_version_id);
      }
      const versionId = this.insertVersion(
        existing.id,
        this.nextVersionNumber(existing.id),
        "active",
        input,
        name,
        changedAt,
      );
      this.database.raw.query(`
        UPDATE managed_skills
        SET description = ?, active_version_id = ?, candidate_version_id = NULL,
            generation = generation + 1, updated_at = ?
        WHERE id = ?
      `).run(input.description, versionId, changedAt, existing.id);
    });
    return this.get(skillId)!;
  }

  createCustomSkill(
    input: CandidateWrite,
    source: {
      source?: "upload" | "git";
      repositoryUrl?: string;
      sourceRef?: string;
      sourceSubdirectory?: string;
    } = {},
  ): ManagedSkill {
    const name = nameFromContent(input.content);
    if (!name) throw new Error("custom skill name is required");
    let skillId = "";
    this.transaction(() => {
      if (this.skillRowByName(name)) throw new Error(`skill name already exists: ${name}`);
      const createdAt = nowIso();
      skillId = nextId();
      this.database.raw.query(`
        INSERT INTO managed_skills (
          id, name, description, kind, source, repository_url, source_ref,
          source_subdirectory, enabled, generation, created_at, updated_at
        ) VALUES (?, ?, ?, 'custom', ?, ?, ?, ?, 0, 0, ?, ?)
      `).run(
        skillId,
        name,
        input.description,
        source.source ?? "upload",
        source.repositoryUrl ?? null,
        source.sourceRef ?? null,
        source.sourceSubdirectory ?? null,
        createdAt,
        createdAt,
      );
      const versionId = this.insertVersion(skillId, 1, "candidate", input, name);
      this.database.raw.query(
        "UPDATE managed_skills SET candidate_version_id = ? WHERE id = ?",
      ).run(versionId, skillId);
    });
    return this.get(skillId)!;
  }

  saveCandidate(skillId: string, input: CandidateWrite): ManagedSkill {
    this.transaction(() => {
      const skill = this.requireSkillRow(skillId);
      const savedAt = nowIso();
      const versionNumber = this.nextVersionNumber(skill.id);
      if (skill.candidate_version_id) {
        this.database.raw.query(
          "UPDATE skill_versions SET state = 'archived' WHERE id = ?",
        ).run(skill.candidate_version_id);
      }
      const versionId = this.insertVersion(
        skill.id,
        versionNumber,
        "candidate",
        input,
        skill.name,
      );
      this.database.raw.query(`
        UPDATE managed_skills
        SET candidate_version_id = ?, updated_at = ?
        WHERE id = ?
      `).run(versionId, savedAt, skill.id);
    });
    return this.get(skillId)!;
  }

  activate(skillId: string, input: SkillConfigurationInput): ManagedSkill {
    const agentIds = this.normalizeAgentIds(input.agentIds);
    this.transaction(() => {
      const skill = this.requireSkillRow(skillId);
      if (!skill.candidate_version_id) throw new Error(`skill has no candidate version: ${skillId}`);
      const candidate = this.versionRow(skill.candidate_version_id);
      if (!candidate) throw new Error(`candidate version is missing: ${skill.candidate_version_id}`);
      const activatedAt = nowIso();
      if (skill.active_version_id) {
        this.database.raw.query(
          "UPDATE skill_versions SET state = 'superseded' WHERE id = ?",
        ).run(skill.active_version_id);
      }
      this.database.raw.query(
        "UPDATE skill_versions SET state = 'active', activated_at = ? WHERE id = ?",
      ).run(activatedAt, candidate.id);
      this.replaceAssignments(skill.id, agentIds);
      this.database.raw.query(`
        UPDATE managed_skills
        SET description = ?, enabled = ?, active_version_id = ?, candidate_version_id = NULL,
            generation = generation + 1, updated_at = ?
        WHERE id = ?
      `).run(candidate.description, input.enabled ? 1 : 0, candidate.id, activatedAt, skill.id);
    });
    return this.get(skillId)!;
  }

  configure(skillId: string, input: SkillConfigurationInput): ManagedSkill {
    const agentIds = this.normalizeAgentIds(input.agentIds);
    this.transaction(() => {
      const skill = this.requireSkillRow(skillId);
      this.replaceAssignments(skill.id, agentIds);
      this.database.raw.query(`
        UPDATE managed_skills
        SET enabled = ?, generation = generation + 1, updated_at = ?
        WHERE id = ?
      `).run(input.enabled ? 1 : 0, nowIso(), skill.id);
    });
    return this.get(skillId)!;
  }

  archive(skillId: string): ManagedSkill {
    this.transaction(() => {
      const skill = this.requireSkillRow(skillId);
      if (!skill.archived_at) {
        const archivedAt = nowIso();
        this.database.raw.query(`
          UPDATE managed_skills
          SET enabled = 0, archived_at = ?, generation = generation + 1, updated_at = ?
          WHERE id = ?
        `).run(archivedAt, archivedAt, skill.id);
      }
    });
    return this.get(skillId)!;
  }

  restore(skillId: string): ManagedSkill {
    this.transaction(() => {
      const skill = this.requireSkillRow(skillId);
      if (skill.archived_at) {
        this.database.raw.query(`
          UPDATE managed_skills
          SET enabled = 0, archived_at = NULL, generation = generation + 1, updated_at = ?
          WHERE id = ?
        `).run(nowIso(), skill.id);
      }
    });
    return this.get(skillId)!;
  }

  snapshot(): SkillCatalogSnapshot {
    const assignments = Object.fromEntries(
      SKILL_AGENT_IDS.map((agentId) => [agentId, [] as import("./skill-types.ts").SkillPrompt[]]),
    ) as Record<SkillAgentId, import("./skill-types.ts").SkillPrompt[]>;
    for (const skill of this.list()) {
      if (!skill.enabled || !skill.activeVersion) continue;
      for (const agentId of skill.agentIds) {
        assignments[agentId].push({
          id: skill.id,
          name: skill.activeVersion.name,
          content: skill.activeVersion.content,
          versionId: skill.activeVersion.id,
        });
      }
    }
    const row = this.database.raw.query(
      "SELECT COALESCE(SUM(generation), 0) AS generation FROM managed_skills",
    ).get() as { generation: number };
    return { generation: row.generation, assignments };
  }

  appendAudit(event: NewSkillAuditEvent): void {
    this.transaction(() => {
      this.requireSkillRow(event.skillId);
      if (event.versionId) {
        const version = this.versionRow(event.versionId);
        if (!version || version.skill_id !== event.skillId) {
          throw new Error(`audit version does not belong to skill: ${event.skillId}`);
        }
      }
      this.database.raw.query(`
        INSERT INTO skill_audit_events (
          id, operation, skill_id, version_id, sanitized_source, result, error_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextId(),
        event.operation,
        event.skillId,
        event.versionId ?? null,
        event.sanitizedSource ?? null,
        event.result,
        event.errorCode ?? null,
        nowIso(),
      );
    });
  }

  private toManagedSkill(row: ManagedSkillRow): ManagedSkill {
    const versionRows = this.database.raw.query(
      "SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version_number",
    ).all(row.id) as SkillVersionRow[];
    const versions = versionRows.map(toVersion);
    const assignedRows = this.database.raw.query(
      "SELECT agent_id FROM skill_agent_assignments WHERE skill_id = ?",
    ).all(row.id) as Array<{ agent_id: string }>;
    const assigned = new Set(assignedRows.map((assignment) => assignment.agent_id));
    const agentIds = SKILL_AGENT_IDS.filter((agentId) => assigned.has(agentId));
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      kind: row.kind,
      source: row.source,
      enabled: row.enabled === 1,
      agentIds,
      ...(row.active_version_id
        ? { activeVersion: versions.find((version) => version.id === row.active_version_id) }
        : {}),
      ...(row.candidate_version_id
        ? { candidateVersion: versions.find((version) => version.id === row.candidate_version_id) }
        : {}),
      versions,
      ...(row.repository_url ? { repositoryUrl: row.repository_url } : {}),
      ...(row.source_ref ? { sourceRef: row.source_ref } : {}),
      ...(row.source_subdirectory ? { sourceSubdirectory: row.source_subdirectory } : {}),
      generation: row.generation,
      ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    };
  }

  private insertVersion(
    skillId: string,
    versionNumber: number,
    state: SkillVersionState,
    input: CandidateWrite,
    name: string,
    activatedAt?: string,
  ): string {
    const id = nextId();
    this.database.raw.query(`
      INSERT INTO skill_versions (
        id, skill_id, version_number, state, content, name, description, sha256,
        package_relative_path, source_commit, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      skillId,
      versionNumber,
      state,
      input.content,
      name,
      input.description,
      input.sha256,
      input.packageRelativePath,
      input.sourceCommit ?? null,
      nowIso(),
      activatedAt ?? null,
    );
    return id;
  }

  private replaceAssignments(skillId: string, agentIds: readonly SkillAgentId[]): void {
    this.database.raw.query("DELETE FROM skill_agent_assignments WHERE skill_id = ?").run(skillId);
    for (const agentId of this.normalizeAgentIds(agentIds)) {
      this.database.raw.query(
        "INSERT INTO skill_agent_assignments (skill_id, agent_id) VALUES (?, ?)",
      ).run(skillId, agentId);
    }
  }

  private normalizeAgentIds(agentIds: readonly SkillAgentId[]): SkillAgentId[] {
    const unique = new Set<SkillAgentId>();
    for (const agentId of agentIds) {
      if (!SKILL_AGENT_ID_SET.has(agentId)) throw new Error(`unsupported skill agent: ${agentId}`);
      unique.add(agentId);
    }
    return SKILL_AGENT_IDS.filter((agentId) => unique.has(agentId));
  }

  private nextVersionNumber(skillId: string): number {
    const row = this.database.raw.query(
      "SELECT COALESCE(MAX(version_number), 0) AS version_number FROM skill_versions WHERE skill_id = ?",
    ).get(skillId) as { version_number: number };
    return row.version_number + 1;
  }

  private requireSkillRow(skillId: string): ManagedSkillRow {
    const row = this.database.raw.query("SELECT * FROM managed_skills WHERE id = ?").get(skillId) as ManagedSkillRow | null;
    if (!row) throw new Error(`skill not found: ${skillId}`);
    return row;
  }

  private skillRowByName(name: string): ManagedSkillRow | undefined {
    return this.database.raw.query("SELECT * FROM managed_skills WHERE name = ?").get(name) as ManagedSkillRow | undefined;
  }

  private versionRow(versionId: string): SkillVersionRow | undefined {
    return this.database.raw.query("SELECT * FROM skill_versions WHERE id = ?").get(versionId) as SkillVersionRow | undefined;
  }

}
