import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkillManagementError,
  SkillManagementService,
} from "../src/agents/skill-management-service.ts";
import type {
  GitSkillInstallRequest,
  GitSkillRemoteRequest,
  ResolvedGitRemote,
} from "../src/agents/skill-git-importer.ts";
import {
  SkillPackageStore,
  type StagedSkillPackage,
} from "../src/agents/skill-package-store.ts";
import { SkillCatalogRepository } from "../src/agents/skill-repository.ts";
import type { NewSkillAuditEvent } from "../src/agents/skill-types.ts";
import { ZipSkillImporter } from "../src/agents/skill-zip-importer.ts";
import { YoubanDatabase } from "../src/domain/database.ts";
import { createZipFixture } from "./helpers/zip-fixture.ts";

const BUILTIN_SKILLS_DIR = join(import.meta.dir, "../src/agents/skills");
const SKILL = "---\nname: museum-guide\ndescription: A practical museum visit guide.\n---\n\n# Museum guide\n";
const EDITED_SKILL = SKILL.replace("# Museum guide", "# Museum guide\n\nedited marker");
const COMMIT_ONE = "1".repeat(40);
const COMMIT_TWO = "2".repeat(40);

interface GitStageFixture {
  content?: string;
  commit: string;
  sanitizedSource?: string;
}

class StubGitImporter {
  readonly stagedRequests: GitSkillInstallRequest[] = [];
  readonly remoteRequests: GitSkillRemoteRequest[] = [];
  nextStage: GitStageFixture = { commit: COMMIT_ONE };
  nextRemote: ResolvedGitRemote = { changed: false, commit: COMMIT_ONE };

  constructor(private readonly store: SkillPackageStore) {}

  async stage(request: GitSkillInstallRequest): Promise<StagedSkillPackage> {
    this.stagedRequests.push(structuredClone(request));
    const stagingDir = this.store.createStagingDirectory();
    const content = this.nextStage.content ?? SKILL;
    this.store.writeFile(stagingDir, "SKILL.md", Buffer.from(content));
    const document = {
      name: "museum-guide",
      description: "A practical museum visit guide.",
      content,
      sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
    };
    return {
      stagingDir,
      document,
      files: ["SKILL.md"],
      source: "git",
      sanitizedSource: this.nextStage.sanitizedSource ?? request.repositoryUrl,
      sourceRef: request.ref,
      sourceCommit: this.nextStage.commit,
      cleanup: () => this.store.cleanupStaging(stagingDir),
    };
  }

  async resolveRemote(request: GitSkillRemoteRequest): Promise<ResolvedGitRemote> {
    this.remoteRequests.push(structuredClone(request));
    return { ...this.nextRemote };
  }
}

class RenameFailingStore extends SkillPackageStore {
  override commitStaging(_stagingDir: string, _packagePath: string): never {
    throw new Error("/private/tmp/secret package rename failed");
  }
}

class CreateFailingRepository extends SkillCatalogRepository {
  override createCustomSkill(): never {
    throw new Error("forced database failure with prompt content");
  }
}

class ArchiveFailingRepository extends SkillCatalogRepository {
  override archive(): never {
    throw new Error("forced archive transaction failure");
  }
}

class RestoreFailingRepository extends SkillCatalogRepository {
  override restore(): never {
    throw new Error("forced restore transaction failure");
  }
}

class AuditFailingRepository extends SkillCatalogRepository {
  override appendAudit(_event: NewSkillAuditEvent): never {
    throw new Error("forced audit failure after metadata write");
  }
}

interface Harness {
  root: string;
  database: YoubanDatabase;
  repository: SkillCatalogRepository;
  packageStore: SkillPackageStore;
  gitImporter: StubGitImporter;
  service: SkillManagementService;
}

const harnesses: Harness[] = [];

function createHarness(options: {
  repository?(database: YoubanDatabase): SkillCatalogRepository;
  packageStore?(root: string): SkillPackageStore;
} = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "youban-skill-management-"));
  const database = new YoubanDatabase(join(root, "youban.db"));
  const repository = options.repository?.(database) ?? new SkillCatalogRepository(database);
  const packageStore = options.packageStore?.(join(root, "skill-data"))
    ?? new SkillPackageStore(join(root, "skill-data"));
  const gitImporter = new StubGitImporter(packageStore);
  const service = new SkillManagementService({
    databasePath: join(root, "unused.db"),
    dataDir: join(root, "skill-data"),
    builtinSkillsDir: BUILTIN_SKILLS_DIR,
    repository,
    packageStore,
    zipImporter: new ZipSkillImporter(packageStore),
    gitImporter,
    now: () => new Date("2026-08-22T00:00:00.000Z"),
  });
  const harness = { root, database, repository, packageStore, gitImporter, service };
  harnesses.push(harness);
  return harness;
}

function uploadBytes(content = SKILL): Uint8Array {
  return createZipFixture([
    { name: "museum.zip/SKILL.md", content },
    { name: "museum.zip/references/checklist.txt", content: "bring water" },
  ]);
}

function auditRows(database: YoubanDatabase): Array<Record<string, unknown>> {
  return database.raw.query(`
    SELECT operation, skill_id, version_id, sanitized_source, result, error_code
    FROM skill_audit_events ORDER BY rowid
  `).all() as Array<Record<string, unknown>>;
}

function expectManagementCode(operation: () => unknown, code: string): void {
  expect(operation).toThrowError(expect.objectContaining({ code, constructor: SkillManagementError }));
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.service.close();
    harness.database.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

describe("SkillManagementService lifecycle", () => {
  it("installs an upload as a globally disabled candidate without publishing runtime content", async () => {
    const { service } = createHarness();
    const before = service.snapshot();
    const events: number[] = [];
    service.subscribe((snapshot) => events.push(snapshot.generation));

    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });

    expect(installed).toMatchObject({
      name: "museum-guide",
      kind: "custom",
      source: "upload",
      enabled: false,
      candidateVersion: { state: "candidate", content: SKILL },
      agentIds: [],
      generation: 0,
    });
    expect(installed.activeVersion).toBeUndefined();
    expect(service.snapshot()).toEqual(before);
    expect(events).toEqual([]);
  });

  it("rejects a same-name install and removes its finalized package", async () => {
    const { service, packageStore } = createHarness();
    await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const packagesBefore = packageStore.listFinalPackages();

    await expect(service.stageUpload({ filename: "duplicate.zip", bytes: uploadBytes() }))
      .rejects.toMatchObject({ code: "skill_name_conflict" });

    expect(packageStore.listFinalPackages()).toEqual(packagesBefore);
    expect(service.list().filter((skill) => skill.name === "museum-guide")).toHaveLength(1);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
  });

  it("keeps the active version while an edit waits for review", async () => {
    const { service } = createHarness();
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    await service.activate(installed.id, {
      enabled: true,
      agentIds: ["segment-planner"],
    });
    const active = service.get(installed.id).activeVersion?.id;
    const generation = service.snapshot().generation;
    const events: number[] = [];
    service.subscribe((snapshot) => events.push(snapshot.generation));

    await service.saveCandidate(installed.id, EDITED_SKILL);

    expect(service.get(installed.id).activeVersion?.id).toBe(active);
    expect(service.get(installed.id).candidateVersion?.content).toContain("edited marker");
    expect(service.snapshot().assignments["segment-planner"][0]?.content)
      .not.toContain("edited marker");
    expect(service.snapshot().generation).toBe(generation);
    expect(events).toEqual([]);
  });

  it("publishes activation once and preserves assignments across global disable", async () => {
    const { service } = createHarness();
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const events: number[] = [];
    service.subscribe((snapshot) => events.push(snapshot.generation));

    const active = service.activate(installed.id, {
      enabled: true,
      agentIds: ["segment-planner"],
    });
    service.configure(installed.id, { enabled: false, agentIds: [] });
    const disabled = service.get(installed.id);
    service.configure(installed.id, { enabled: true, agentIds: disabled.agentIds });

    expect(active.activeVersion?.content).toBe(SKILL);
    expect(disabled.agentIds).toEqual(["segment-planner"]);
    expect(service.snapshot().assignments["segment-planner"])
      .toContainEqual(expect.objectContaining({ id: installed.id }));
    expect(events).toHaveLength(3);
    expect(events[1] - events[0]).toBe(1);
    expect(events[2] - events[1]).toBe(1);
  });

  it("allows built-in configuration but rejects edit, archive, and restore", async () => {
    const { service } = createHarness();
    const builtin = service.list().find((skill) => skill.name === "trip-planning")!;

    service.configure(builtin.id, {
      enabled: true,
      agentIds: ["summary"],
    });
    const configured = service.configure(builtin.id, { enabled: false, agentIds: [] });

    expect(configured.enabled).toBe(false);
    expect(configured.agentIds).toEqual(["summary"]);
    await expect(service.saveCandidate(builtin.id, SKILL)).rejects.toMatchObject({
      code: "builtin_skill_immutable",
    });
    expectManagementCode(() => service.archive(builtin.id), "builtin_skill_immutable");
    expectManagementCode(() => service.restore(builtin.id), "builtin_skill_immutable");
  });

  it("requires custom skills to be disabled before atomic archive and restores them disabled", async () => {
    const { service, packageStore } = createHarness();
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    service.activate(installed.id, { enabled: true, agentIds: ["segment-planner"] });

    expectManagementCode(() => service.archive(installed.id), "skill_must_be_disabled");
    service.configure(installed.id, { enabled: false, agentIds: [] });
    const beforeArchive = service.snapshot().generation;
    const archived = service.archive(installed.id);

    expect(archived.archivedAt).toBeDefined();
    expect(archived.enabled).toBe(false);
    expect(service.list()).not.toContainEqual(expect.objectContaining({ id: installed.id }));
    expect(service.list({ archived: true })).toContainEqual(expect.objectContaining({ id: installed.id }));
    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(readdirSync(packageStore.archiveRoot)).toEqual(["museum-guide"]);

    const restored = service.restore(installed.id);
    expect(restored.enabled).toBe(false);
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.agentIds).toEqual(["segment-planner"]);
    expect(packageStore.listFinalPackages()).not.toEqual([]);
    expect(service.snapshot().generation).toBe(beforeArchive + 2);
  });
});

describe("SkillManagementService Git, audit, and events", () => {
  it("does not create a candidate when a Git remote is unchanged", async () => {
    const { service, gitImporter } = createHarness();
    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
      ref: "main",
    });
    service.activate(installed.id, { enabled: true, agentIds: ["summary"] });
    const generation = service.snapshot().generation;
    const stageCount = gitImporter.stagedRequests.length;

    gitImporter.nextRemote = { changed: false, commit: COMMIT_ONE };
    const result = await service.checkGitUpdate(installed.id);

    expect(result.changed).toBe(false);
    expect(result.skill.candidateVersion).toBeUndefined();
    expect(service.snapshot().generation).toBe(generation);
    expect(gitImporter.stagedRequests).toHaveLength(stageCount);
    expect(gitImporter.remoteRequests[0]).toMatchObject({
      activeCommit: COMMIT_ONE,
    });
    expect(gitImporter.remoteRequests[0].candidateCommit).toBeUndefined();
  });

  it("replaces only the Git candidate when the remote commit changes", async () => {
    const { service, gitImporter } = createHarness();
    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
      ref: "main",
    });
    const generation = service.snapshot().generation;
    const firstCandidate = installed.candidateVersion?.id;
    gitImporter.nextRemote = { changed: true, commit: COMMIT_TWO };
    gitImporter.nextStage = { commit: COMMIT_TWO, content: EDITED_SKILL };

    const result = await service.checkGitUpdate(installed.id);

    expect(result.changed).toBe(true);
    expect(result.skill.candidateVersion).toMatchObject({ sourceCommit: COMMIT_TWO });
    expect(result.skill.candidateVersion?.id).not.toBe(firstCandidate);
    expect(result.skill.versions.map((version) => version.state)).toEqual(["archived", "candidate"]);
    expect(service.snapshot().generation).toBe(generation);
  });

  it("stores only sanitized Git provenance and stable audit fields", async () => {
    const { service, gitImporter, database, root } = createHarness();
    gitImporter.nextStage = {
      commit: COMMIT_ONE,
      sanitizedSource: "https://user:secret@git.example.com/org/museum.git?token=secret#private",
    };

    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
      ref: "main",
    });
    const serialized = JSON.stringify(auditRows(database));

    expect(installed.repositoryUrl).toBe("https://git.example.com/org/museum.git");
    expect(installed.sourceRef).toBe("main");
    expect(installed.candidateVersion?.sourceCommit).toBe(COMMIT_ONE);
    expect(auditRows(database)).toEqual([
      expect.objectContaining({
        operation: "candidate_git_staged",
        skill_id: installed.id,
        sanitized_source: "https://git.example.com/org/museum.git",
        result: "success",
        error_code: null,
      }),
    ]);
    expect(serialized).not.toContain("user:secret");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("# Museum guide");
  });

  it("drops a non-commit importer value before persisting Git provenance", async () => {
    const { service, gitImporter, database } = createHarness();
    gitImporter.nextStage = {
      commit: `${COMMIT_ONE}/private/token-value`,
    };

    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
    });

    expect(installed.candidateVersion?.sourceCommit).toBeUndefined();
    const row = database.raw.query(
      "SELECT source_commit FROM skill_versions WHERE id = ?",
    ).get(installed.candidateVersion!.id);
    expect(row).toEqual({ source_commit: null });
    expect(JSON.stringify(row)).not.toContain("token-value");
  });

  it("emits detached frozen snapshots once per runtime mutation and stops after close", async () => {
    const { service } = createHarness();
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const delivered: Array<ReturnType<SkillManagementService["snapshot"]>> = [];
    const unsubscribe = service.subscribe((snapshot) => delivered.push(snapshot));

    service.activate(installed.id, { enabled: true, agentIds: ["summary"] });
    await service.saveCandidate(installed.id, EDITED_SKILL);
    service.configure(installed.id, { enabled: false, agentIds: [] });

    expect(delivered).toHaveLength(2);
    expect(Object.isFrozen(delivered[0])).toBe(true);
    expect(Object.isFrozen(delivered[0].assignments)).toBe(true);
    expect(Object.isFrozen(delivered[0].assignments.summary)).toBe(true);
    expect(Object.isFrozen(delivered[0].assignments.summary[0])).toBe(true);
    expect(delivered[0]).not.toBe(service.snapshot());
    expect(() => {
      (delivered[0].assignments.summary as unknown as unknown[]).push("mutation");
    }).toThrow();

    unsubscribe();
    service.close();
    service.close();
    expectManagementCode(() => service.configure(installed.id, {
      enabled: true,
      agentIds: ["summary"],
    }), "skill_service_closed");
    expect(delivered).toHaveLength(2);
  });
});

describe("SkillManagementService filesystem and transaction compensation", () => {
  it("does not write metadata when the package rename fails", async () => {
    const { service, repository, packageStore } = createHarness({
      packageStore: (root) => new RenameFailingStore(root),
    });

    await expect(service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() }))
      .rejects.toMatchObject({ code: "package_commit_failed" });

    expect(repository.getByName("museum-guide")).toBeUndefined();
    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
  });

  it("compensates the package rename when the candidate transaction fails", async () => {
    const { service, repository, packageStore } = createHarness({
      repository: (database) => new CreateFailingRepository(database),
    });

    await expect(service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() }))
      .rejects.toMatchObject({ code: "candidate_write_failed" });

    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(repository.getByName("museum-guide")).toBeUndefined();
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
  });

  it("rolls back metadata and package state when audit persistence fails", async () => {
    const { service, repository, packageStore } = createHarness({
      repository: (database) => new AuditFailingRepository(database),
    });

    await expect(service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() }))
      .rejects.toMatchObject({ code: "candidate_write_failed" });

    expect(repository.getByName("museum-guide")).toBeUndefined();
    expect(packageStore.listFinalPackages()).toEqual([]);
  });

  it("moves an archived package back when the archive transaction fails", async () => {
    const { service, repository, packageStore } = createHarness({
      repository: (database) => new ArchiveFailingRepository(database),
    });
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const packagesBefore = packageStore.listFinalPackages();

    expect(() => service.archive(installed.id)).toThrow();

    expect(repository.get(installed.id)?.archivedAt).toBeUndefined();
    expect(packageStore.listFinalPackages()).toEqual(packagesBefore);
    expect(existsSync(join(packageStore.archiveRoot, "museum-guide"))).toBe(false);
  });

  it("moves a restored package back to archive when the restore transaction fails", async () => {
    const { service, repository, packageStore } = createHarness({
      repository: (database) => new RestoreFailingRepository(database),
    });
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    service.archive(installed.id);

    expect(() => service.restore(installed.id)).toThrowError(
      expect.objectContaining({ code: "skill_restore_failed" }),
    );

    expect(repository.get(installed.id)?.archivedAt).toBeDefined();
    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(existsSync(join(packageStore.archiveRoot, "museum-guide"))).toBe(true);
  });
});
