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
import type {
  CandidateWrite,
  NewSkillAuditEvent,
  ReconciledBuiltinSkill,
} from "../src/agents/skill-types.ts";
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

class BlockingGitImporter extends StubGitImporter {
  remoteGate?: Deferred<ResolvedGitRemote>;
  stageGate?: Deferred<void>;
  readonly stageBlocked = deferred<void>();

  override async stage(request: GitSkillInstallRequest): Promise<StagedSkillPackage> {
    const staged = await super.stage(request);
    if (this.stageGate) {
      this.stageBlocked.resolve();
      await this.stageGate.promise;
    }
    return staged;
  }

  override async resolveRemote(request: GitSkillRemoteRequest): Promise<ResolvedGitRemote> {
    this.remoteRequests.push(structuredClone(request));
    return this.remoteGate ? this.remoteGate.promise : { ...this.nextRemote };
  }
}

class AcquisitionFailingGitImporter extends StubGitImporter {
  failStage = false;

  override async stage(request: GitSkillInstallRequest): Promise<StagedSkillPackage> {
    if (this.failStage) {
      throw Object.assign(new Error("private acquisition path"), {
        code: "git_acquisition_too_large",
      });
    }
    return super.stage(request);
  }
}

class BlockingZipImporter extends ZipSkillImporter {
  readonly release = deferred<void>();
  readonly stageBlocked = deferred<void>();

  override async stage(bytes: Uint8Array): Promise<StagedSkillPackage> {
    const staged = await super.stage(bytes);
    this.stageBlocked.resolve();
    await this.release.promise;
    return staged;
  }
}

class RenameFailingStore extends SkillPackageStore {
  override commitStaging(_stagingDir: string, _packagePath: string): never {
    throw new Error("/private/tmp/secret package rename failed");
  }
}

class ReverseCandidateFailingStore extends SkillPackageStore {
  failReverse = false;

  override restoreCommittedPackageToStaging(packagePath: string, stagingDir: string): void {
    if (this.failReverse) throw new Error("forced first reverse rename failure");
    super.restoreCommittedPackageToStaging(packagePath, stagingDir);
  }
}

class ReverseArchiveFailingStore extends SkillPackageStore {
  failReverse = false;

  override restoreArchivedPackage(archivePath: string, packagePath: string): string {
    if (this.failReverse) throw new Error("forced first archive reverse rename failure");
    return super.restoreArchivedPackage(archivePath, packagePath);
  }
}

class CreateFailingRepository extends SkillCatalogRepository {
  override createCustomSkill(): never {
    throw new Error("forced database failure with prompt content");
  }
}

class SaveFailingRepository extends SkillCatalogRepository {
  failSave = false;

  override saveCandidate(skillId: string, input: CandidateWrite) {
    if (this.failSave) throw new Error("forced candidate database failure");
    return super.saveCandidate(skillId, input);
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

class SnapshotFailingRepository extends SkillCatalogRepository {
  failuresRemaining = 0;

  override snapshot() {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("forced snapshot refresh failure");
    }
    return super.snapshot();
  }
}

class SecondBuiltinFailingRepository extends SkillCatalogRepository {
  private reconciled = 0;

  override reconcileBuiltin(input: ReconciledBuiltinSkill) {
    this.reconciled += 1;
    if (this.reconciled === 2) throw new Error("forced second builtin failure");
    return super.reconcileBuiltin(input);
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
  gitImporter?(store: SkillPackageStore): StubGitImporter;
  zipImporter?(store: SkillPackageStore): ZipSkillImporter;
} = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "youban-skill-management-"));
  const database = new YoubanDatabase(join(root, "youban.db"));
  const repository = options.repository?.(database) ?? new SkillCatalogRepository(database);
  const packageStore = options.packageStore?.(join(root, "skill-data"))
    ?? new SkillPackageStore(join(root, "skill-data"));
  const gitImporter = options.gitImporter?.(packageStore) ?? new StubGitImporter(packageStore);
  const service = new SkillManagementService({
    databasePath: join(root, "unused.db"),
    dataDir: join(root, "skill-data"),
    builtinSkillsDir: BUILTIN_SKILLS_DIR,
    repository,
    packageStore,
    zipImporter: options.zipImporter?.(packageStore) ?? new ZipSkillImporter(packageStore),
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
  it("rolls back the complete built-in reconciliation batch when a later skill fails", () => {
    const root = mkdtempSync(join(tmpdir(), "youban-builtin-reconcile-"));
    const database = new YoubanDatabase(join(root, "youban.db"));
    const repository = new SecondBuiltinFailingRepository(database);
    try {
      expect(() => new SkillManagementService({
        databasePath: join(root, "unused.db"),
        dataDir: join(root, "skill-data"),
        builtinSkillsDir: BUILTIN_SKILLS_DIR,
        repository,
      })).toThrow("forced second builtin failure");

      expect(repository.list()).toEqual([]);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

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
      candidateVersionId: installed.candidateVersion!.id,
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
      candidateVersionId: installed.candidateVersion!.id,
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

  it("preserves a stable version conflict when activation has no pending candidate", async () => {
    const { service } = createHarness();
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const active = service.activate(installed.id, {
      candidateVersionId: installed.candidateVersion!.id,
      enabled: true,
      agentIds: ["segment-planner"],
    });

    expectManagementCode(() => service.activate(installed.id, {
      candidateVersionId: installed.candidateVersion!.id,
      enabled: false,
      agentIds: ["summary"],
    }), "skill_version_conflict");

    const unchanged = service.get(installed.id);
    expect(unchanged.generation).toBe(active.generation);
    expect(unchanged.enabled).toBe(true);
    expect(unchanged.agentIds).toEqual(["segment-planner"]);
    expect(unchanged.activeVersion?.id).toBe(active.activeVersion?.id);
    expect(unchanged.candidateVersion).toBeUndefined();
  });

  it("treats a dangling candidate version pointer as an internal activation failure", async () => {
    const { service, database } = createHarness();
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const danglingCandidateId = "dangling-/private/staging/prompt-secret";
    database.raw.exec("PRAGMA foreign_keys = OFF");
    try {
      database.raw.query(
        "UPDATE managed_skills SET candidate_version_id = ? WHERE id = ?",
      ).run(danglingCandidateId, installed.id);
    } finally {
      database.raw.exec("PRAGMA foreign_keys = ON");
    }

    expectManagementCode(() => service.activate(installed.id, {
      candidateVersionId: danglingCandidateId,
      enabled: true,
      agentIds: ["segment-planner"],
    }), "skill_activation_failed");

    expect(auditRows(database).at(-1)).toMatchObject({
      operation: "skill_activated",
      result: "failure",
      error_code: "internal_error",
    });
    expect(JSON.stringify(auditRows(database))).not.toContain(danglingCandidateId);
    expect(service.snapshot().assignments["segment-planner"])
      .not.toContainEqual(expect.objectContaining({ id: installed.id }));
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
    service.activate(installed.id, {
      candidateVersionId: installed.candidateVersion!.id,
      enabled: true,
      agentIds: ["segment-planner"],
    });

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
  it("keeps acquisition-limit failures stable in Git update audit records", async () => {
    const { service, gitImporter, database } = createHarness({
      gitImporter: (store) => new AcquisitionFailingGitImporter(store),
    });
    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
    });
    gitImporter.nextRemote = { changed: true, commit: COMMIT_TWO };
    (gitImporter as AcquisitionFailingGitImporter).failStage = true;

    await expect(service.checkGitUpdate(installed.id)).rejects.toMatchObject({
      code: "git_acquisition_too_large",
    });
    expect(auditRows(database).at(-1)).toMatchObject({
      operation: "candidate_git_staged",
      result: "failure",
      error_code: "git_acquisition_too_large",
    });
  });

  it("does not create a candidate when a Git remote is unchanged", async () => {
    const { service, gitImporter } = createHarness();
    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
      ref: "main",
    });
    service.activate(installed.id, {
      candidateVersionId: installed.candidateVersion!.id,
      enabled: true,
      agentIds: ["summary"],
    });
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

  it.each([
    "Authorization: Bearer injected-secret",
    "/private/tmp/credential-ref",
    "refs/heads/main\nX-Token: secret",
    "main:evil",
    "+refs/heads/main",
    "refs/heads/a..b",
  ])("rejects an invalid ref returned by an injected importer: %s", async (ref) => {
    const { service, repository, packageStore } = createHarness();

    await expect(service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
      ref,
    })).rejects.toMatchObject({ code: "invalid_git_ref" });

    expect(repository.getByName("museum-guide")).toBeUndefined();
    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
  });

  it("rejects token-derived importer ref metadata without persisting the token", async () => {
    const previousToken = process.env.YOUBAN_SKILL_GIT_TOKEN;
    const token = "configured-secret-token";
    process.env.YOUBAN_SKILL_GIT_TOKEN = token;
    try {
      const { service, repository, packageStore, database } = createHarness();

      await expect(service.stageGit({
        repositoryUrl: "https://git.example.com/org/museum.git",
        ref: `release-${token}`,
      })).rejects.toMatchObject({ code: "invalid_git_ref" });

      expect(repository.getByName("museum-guide")).toBeUndefined();
      expect(packageStore.listFinalPackages()).toEqual([]);
      expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
      expect(JSON.stringify(auditRows(database))).not.toContain(token);
    } finally {
      if (previousToken === undefined) delete process.env.YOUBAN_SKILL_GIT_TOKEN;
      else process.env.YOUBAN_SKILL_GIT_TOKEN = previousToken;
    }
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
    service.subscribe(() => {
      throw new Error("listener failure with private content");
    });
    const unsubscribe = service.subscribe((snapshot) => delivered.push(snapshot));

    service.activate(installed.id, {
      candidateVersionId: installed.candidateVersion!.id,
      enabled: true,
      agentIds: ["summary"],
    });
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

  it("serializes reentrant publications so every listener receives each generation in order", async () => {
    const { service } = createHarness();
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const baseGeneration = service.snapshot().generation;
    const first: number[] = [];
    const second: number[] = [];
    let nested = false;
    service.subscribe((snapshot) => {
      first.push(snapshot.generation);
      if (nested) return;
      nested = true;
      service.configure(installed.id, { enabled: false, agentIds: [] });
    });
    service.subscribe((snapshot) => second.push(snapshot.generation));

    service.activate(installed.id, {
      candidateVersionId: installed.candidateVersion!.id,
      enabled: true,
      agentIds: ["summary"],
    });

    expect(first).toEqual([baseGeneration + 1, baseGeneration + 2]);
    expect(second).toEqual([baseGeneration + 1, baseGeneration + 2]);
  });

  it("skips listeners unsubscribed or closed before their delivery turn", async () => {
    const firstHarness = createHarness();
    const firstInstalled = await firstHarness.service.stageUpload({
      filename: "museum.zip",
      bytes: uploadBytes(),
    });
    const unsubscribed: number[] = [];
    let unsubscribeSecond = () => {};
    firstHarness.service.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = firstHarness.service.subscribe((snapshot) => {
      unsubscribed.push(snapshot.generation);
    });

    firstHarness.service.activate(firstInstalled.id, {
      candidateVersionId: firstInstalled.candidateVersion!.id,
      enabled: true,
      agentIds: ["summary"],
    });
    expect(unsubscribed).toEqual([]);

    const secondHarness = createHarness();
    const secondInstalled = await secondHarness.service.stageUpload({
      filename: "museum.zip",
      bytes: uploadBytes(),
    });
    const afterClose: number[] = [];
    secondHarness.service.subscribe(() => secondHarness.service.close());
    secondHarness.service.subscribe((snapshot) => afterClose.push(snapshot.generation));

    secondHarness.service.activate(secondInstalled.id, {
      candidateVersionId: secondInstalled.candidateVersion!.id,
      enabled: true,
      agentIds: ["summary"],
    });
    expect(afterClose).toEqual([]);
  });

  it("cleans an upload staged after the service closes without writing metadata", async () => {
    let importer!: BlockingZipImporter;
    const { service, repository, packageStore } = createHarness({
      zipImporter: (store) => {
        importer = new BlockingZipImporter(store);
        return importer;
      },
    });
    const installing = service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    await importer.stageBlocked.promise;

    service.close();
    importer.release.resolve();

    await expect(installing).rejects.toMatchObject({ code: "skill_service_closed" });
    expect(repository.getByName("museum-guide")).toBeUndefined();
    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
  });

  it("rejects a Git update when the skill is archived during remote resolution", async () => {
    let importer!: BlockingGitImporter;
    const { service, packageStore, database } = createHarness({
      gitImporter: (store) => {
        importer = new BlockingGitImporter(store);
        return importer;
      },
    });
    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
      ref: "main",
    });
    service.activate(installed.id, {
      candidateVersionId: installed.candidateVersion!.id,
      enabled: false,
      agentIds: ["summary"],
    });
    importer.remoteGate = deferred<ResolvedGitRemote>();
    const checking = service.checkGitUpdate(installed.id);

    service.archive(installed.id);
    importer.remoteGate.resolve({ changed: true, commit: COMMIT_TWO });

    await expect(checking).rejects.toMatchObject({ code: "skill_state_changed" });
    expect(service.get(installed.id).archivedAt).toBeDefined();
    expect(importer.stagedRequests).toHaveLength(1);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
    expect(auditRows(database).at(-1)).toMatchObject({
      operation: "git_update_checked",
      result: "failure",
      error_code: "skill_state_changed",
    });
  });

  it("cleans a staged Git update when its candidate changes while staging", async () => {
    let importer!: BlockingGitImporter;
    const { service, packageStore } = createHarness({
      gitImporter: (store) => {
        importer = new BlockingGitImporter(store);
        return importer;
      },
    });
    const installed = await service.stageGit({
      repositoryUrl: "https://git.example.com/org/museum.git",
      ref: "main",
    });
    importer.nextRemote = { changed: true, commit: COMMIT_TWO };
    importer.nextStage = { commit: COMMIT_TWO, content: EDITED_SKILL };
    importer.stageGate = deferred<void>();
    const checking = service.checkGitUpdate(installed.id);
    await importer.stageBlocked.promise;

    const changed = await service.saveCandidate(installed.id, SKILL);
    importer.stageGate.resolve();

    await expect(checking).rejects.toMatchObject({ code: "skill_state_changed" });
    expect(service.get(installed.id).candidateVersion?.id).toBe(changed.candidateVersion?.id);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
  });
});

describe("SkillManagementService filesystem and transaction compensation", () => {
  it("keeps a committed archive coherent and recovers delivery after snapshot refresh fails", async () => {
    let failingRepository!: SnapshotFailingRepository;
    const { service, repository, packageStore } = createHarness({
      repository: (database) => {
        failingRepository = new SnapshotFailingRepository(database);
        return failingRepository;
      },
    });
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const delivered: number[] = [];
    service.subscribe((snapshot) => delivered.push(snapshot.generation));
    failingRepository.failuresRemaining = 1;

    expect(() => service.archive(installed.id)).toThrowError(expect.objectContaining({
      code: "skill_catalog_refresh_failed",
      committed: true,
    }));

    expect(repository.get(installed.id)?.archivedAt).toBeDefined();
    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(existsSync(join(packageStore.archiveRoot, "museum-guide"))).toBe(true);
    const recovered = service.snapshot();
    expect(recovered.generation).toBe(repository.snapshot().generation);
    expect(delivered).toEqual([recovered.generation]);
  });

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

  it("treats empty-parent cleanup as best effort after the candidate rename is reversed", async () => {
    const { service, repository, packageStore } = createHarness({
      repository: (database) => new CreateFailingRepository(database),
    });
    const storeWithInjectedCleanup = packageStore as unknown as {
      removeEmptyPackageParents(directory: string, root: string): void;
    };
    storeWithInjectedCleanup.removeEmptyPackageParents = () => {
      throw new Error("forced empty-parent cleanup failure");
    };

    await expect(service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() }))
      .rejects.toMatchObject({ code: "candidate_write_failed" });

    expect(repository.getByName("museum-guide")).toBeUndefined();
    expect(packageStore.listFinalPackages()).toEqual([]);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
  });

  it("uses deterministic recovery when the first candidate reverse rename fails", async () => {
    let failingRepository!: SaveFailingRepository;
    let failingStore!: ReverseCandidateFailingStore;
    const { service, database, packageStore } = createHarness({
      repository: (db) => {
        failingRepository = new SaveFailingRepository(db);
        return failingRepository;
      },
      packageStore: (root) => {
        failingStore = new ReverseCandidateFailingStore(root);
        return failingStore;
      },
    });
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const packagesBefore = packageStore.listFinalPackages();
    failingRepository.failSave = true;
    failingStore.failReverse = true;

    await expect(service.saveCandidate(installed.id, EDITED_SKILL))
      .rejects.toMatchObject({ code: "candidate_write_failed" });

    expect(packageStore.listFinalPackages()).toEqual(packagesBefore);
    expect(readdirSync(packageStore.stagingRoot)).toEqual([]);
    expect(auditRows(database).at(-1)).toMatchObject({
      operation: "candidate_edit_saved",
      result: "failure",
      error_code: "candidate_write_failed",
    });
  });

  it("uses deterministic recovery when the first archive reverse rename fails", async () => {
    let failingStore!: ReverseArchiveFailingStore;
    const { service, repository, database, packageStore } = createHarness({
      repository: (db) => new ArchiveFailingRepository(db),
      packageStore: (root) => {
        failingStore = new ReverseArchiveFailingStore(root);
        return failingStore;
      },
    });
    const installed = await service.stageUpload({ filename: "museum.zip", bytes: uploadBytes() });
    const packagesBefore = packageStore.listFinalPackages();
    failingStore.failReverse = true;

    expect(() => service.archive(installed.id)).toThrowError(
      expect.objectContaining({ code: "skill_archive_failed" }),
    );

    expect(repository.get(installed.id)?.archivedAt).toBeUndefined();
    expect(packageStore.listFinalPackages()).toEqual(packagesBefore);
    expect(existsSync(join(packageStore.archiveRoot, "museum-guide"))).toBe(false);
    expect(auditRows(database).at(-1)).toMatchObject({
      operation: "skill_archived",
      result: "failure",
      error_code: "skill_archive_failed",
    });
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
