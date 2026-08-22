import { existsSync } from "node:fs";
import { YoubanDatabase } from "../domain/database.ts";
import { validateSkillDocument } from "./skill-document.ts";
import {
  GitSkillImporter,
  type GitSkillInstallRequest,
  type GitSkillRemoteRequest,
  type ResolvedGitRemote,
  validateGitRef,
} from "./skill-git-importer.ts";
import {
  normalizeSkillPackagePath,
  SkillPackageStore,
  type StagedSkillPackage,
} from "./skill-package-store.ts";
import { loadBuiltinSkillDefinitions } from "./skill-registry.ts";
import { SkillCatalogRepository, SkillVersionConflictError } from "./skill-repository.ts";
import type {
  CandidateWrite,
  ManagedSkill,
  ManagedSkillDetail,
  ManagedSkillSummary,
  NewSkillAuditEvent,
  SkillActivationInput,
  SkillCatalogSnapshot,
  SkillConfigurationInput,
} from "./skill-types.ts";
import { ZipSkillImporter } from "./skill-zip-importer.ts";

export interface SkillCatalogProvider {
  snapshot(): SkillCatalogSnapshot;
  subscribe(listener: (snapshot: SkillCatalogSnapshot) => void): () => void;
}

type ZipImporter = Pick<ZipSkillImporter, "stage">;
type GitImporter = Pick<GitSkillImporter, "stage" | "resolveRemote">;

export interface SkillManagementServiceOptions {
  databasePath: string;
  dataDir: string;
  builtinSkillsDir: string;
  repository?: SkillCatalogRepository;
  packageStore?: SkillPackageStore;
  zipImporter?: ZipImporter;
  gitImporter?: GitImporter;
  now?: () => Date;
}

export type SkillManagementErrorCode =
  | "skill_not_found"
  | "skill_name_conflict"
  | "builtin_skill_immutable"
  | "skill_must_be_disabled"
  | "skill_not_archived"
  | "skill_archived"
  | "skill_not_git_managed"
  | "skill_service_closed"
  | "skill_state_changed"
  | "skill_catalog_refresh_failed"
  | "package_commit_failed"
  | "package_compensation_failed"
  | "candidate_write_failed"
  | "skill_version_conflict"
  | "skill_activation_failed"
  | "skill_configuration_failed"
  | "skill_archive_failed"
  | "skill_restore_failed";

export class SkillManagementError extends Error {
  readonly committed: boolean;

  constructor(
    public readonly code: SkillManagementErrorCode,
    message: string,
    options: { committed?: boolean } = {},
  ) {
    super(message);
    this.name = "SkillManagementError";
    this.committed = options.committed ?? false;
  }
}

const STABLE_DEPENDENCY_CODES = new Set([
  "invalid_skill_encoding",
  "invalid_skill_frontmatter",
  "invalid_skill_name",
  "skill_name_mismatch",
  "invalid_skill_description",
  "skill_document_too_large",
  "invalid_zip_archive",
  "invalid_zip_entry",
  "invalid_skill_package",
  "skill_package_too_large",
  "invalid_git_url",
  "invalid_git_host",
  "invalid_git_ref",
  "invalid_git_subdirectory",
  "invalid_git_commit",
  "invalid_git_package",
  "git_unavailable",
  "git_timeout",
  "git_output_too_large",
  "git_redirect",
  "git_failed",
]);

function managementError(
  code: SkillManagementErrorCode,
  message: string,
  options?: { committed?: boolean },
): SkillManagementError {
  return new SkillManagementError(code, message, options);
}

function stableErrorCode(error: unknown, fallback: string): string {
  if (error instanceof SkillManagementError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (STABLE_DEPENDENCY_CODES.has(code)) return code;
  }
  return fallback;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function detached<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function sanitizeGitUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname) return undefined;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
}

function sanitizeSubdirectory(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const normalized = normalizeSkillPackagePath(value);
    const configuredToken = process.env.YOUBAN_SKILL_GIT_TOKEN;
    return configuredToken && normalized.includes(configuredToken) ? undefined : normalized;
  } catch {
    return undefined;
  }
}

function sanitizeCommit(value: string | undefined): string | undefined {
  return value && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value) ? value.toLowerCase() : undefined;
}

function summary(skill: ManagedSkill): ManagedSkillSummary {
  const { activeVersion, candidateVersion, versions: _versions, ...fields } = skill;
  return {
    ...fields,
    ...(activeVersion ? { activeVersionId: activeVersion.id } : {}),
    ...(candidateVersion ? { candidateVersionId: candidateVersion.id } : {}),
  };
}

export class SkillManagementService implements SkillCatalogProvider {
  private readonly repository: SkillCatalogRepository;
  private readonly packageStore: SkillPackageStore;
  private readonly zipImporter: ZipImporter;
  private readonly gitImporter: GitImporter;
  private readonly now: () => Date;
  private readonly ownedDatabase?: YoubanDatabase;
  private readonly listeners = new Set<(snapshot: SkillCatalogSnapshot) => void>();
  private readonly pendingSnapshots: SkillCatalogSnapshot[] = [];
  private currentSnapshot: SkillCatalogSnapshot;
  private snapshotDirty = false;
  private dispatching = false;
  private closed = false;

  constructor(options: SkillManagementServiceOptions) {
    this.now = options.now ?? (() => new Date());
    if (options.repository) {
      this.repository = options.repository;
    } else {
      this.ownedDatabase = new YoubanDatabase(options.databasePath);
      this.repository = new SkillCatalogRepository(this.ownedDatabase);
    }
    this.packageStore = options.packageStore ?? new SkillPackageStore(options.dataDir);
    this.zipImporter = options.zipImporter ?? new ZipSkillImporter(this.packageStore);
    this.gitImporter = options.gitImporter ?? new GitSkillImporter(this.packageStore);

    try {
      const builtins = loadBuiltinSkillDefinitions(options.builtinSkillsDir);
      this.repository.transaction(() => {
        for (const skill of builtins) this.repository.reconcileBuiltin(skill);
      });
      this.currentSnapshot = this.readSnapshot();
    } catch (error) {
      this.ownedDatabase?.close();
      throw error;
    }
  }

  list(options: { archived?: boolean } = {}): ManagedSkillSummary[] {
    this.assertOpen();
    return detached(this.repository.list(options).map(summary));
  }

  get(skillId: string): ManagedSkillDetail {
    this.assertOpen();
    return detached(this.requireSkill(skillId));
  }

  async stageUpload(input: { filename: string; bytes: Uint8Array }): Promise<ManagedSkillDetail> {
    this.assertOpen();
    const staged = await this.zipImporter.stage(input.bytes);
    try {
      this.assertOpen();
    } catch (error) {
      this.cleanupStaged(staged);
      throw error;
    }
    return this.finalizeCandidate(staged, {
      operation: "candidate_upload_staged",
      source: "upload",
    });
  }

  async stageGit(input: GitSkillInstallRequest): Promise<ManagedSkillDetail> {
    this.assertOpen();
    const staged = await this.gitImporter.stage(input);
    let sourceRef: string | undefined;
    try {
      this.assertOpen();
      sourceRef = validateGitRef(staged.sourceRef);
    } catch (error) {
      this.cleanupStaged(staged);
      throw error;
    }
    return this.finalizeCandidate(staged, {
      operation: "candidate_git_staged",
      source: "git",
      repositoryUrl: sanitizeGitUrl(staged.sanitizedSource),
      sourceRef,
      sourceSubdirectory: sanitizeSubdirectory(input.subdirectory),
    });
  }

  async checkGitUpdate(skillId: string): Promise<{ changed: boolean; skill: ManagedSkillDetail }> {
    this.assertOpen();
    const existing = this.requireSkill(skillId);
    if (existing.kind !== "custom" || existing.source !== "git" || !existing.repositoryUrl) {
      const error = managementError("skill_not_git_managed", "skill is not managed from Git");
      this.appendFailureAudit(existing.id, "git_update_checked", error, existing.repositoryUrl);
      throw error;
    }
    if (existing.archivedAt) throw managementError("skill_archived", "archived skills cannot be updated");

    const request: GitSkillRemoteRequest = {
      repositoryUrl: existing.repositoryUrl,
      ...(existing.sourceRef ? { ref: existing.sourceRef } : {}),
      ...(existing.sourceSubdirectory ? { subdirectory: existing.sourceSubdirectory } : {}),
      ...(existing.activeVersion?.sourceCommit
        ? { activeCommit: existing.activeVersion.sourceCommit }
        : {}),
      ...(existing.candidateVersion?.sourceCommit
        ? { candidateCommit: existing.candidateVersion.sourceCommit }
        : {}),
    };
    let remote: ResolvedGitRemote;
    try {
      remote = await this.gitImporter.resolveRemote(request);
    } catch (error) {
      if (!this.closed) {
        this.appendFailureAudit(existing.id, "git_update_checked", error, existing.repositoryUrl);
      }
      throw error;
    }
    let resolvedState: ManagedSkill;
    try {
      resolvedState = this.requireUnchangedSkill(existing);
    } catch (error) {
      if (!this.closed) {
        this.appendFailureAudit(existing.id, "git_update_checked", error, existing.repositoryUrl);
      }
      throw error;
    }
    if (!remote.changed) {
      this.repository.appendAudit({
        operation: "git_update_checked",
        skillId: existing.id,
        sanitizedSource: sanitizeGitUrl(existing.repositoryUrl),
        result: "success",
      });
      return { changed: false, skill: detached(resolvedState) };
    }

    let staged: StagedSkillPackage;
    try {
      staged = await this.gitImporter.stage({
        repositoryUrl: existing.repositoryUrl,
        ...(existing.sourceRef ? { ref: existing.sourceRef } : {}),
        ...(existing.sourceSubdirectory ? { subdirectory: existing.sourceSubdirectory } : {}),
      });
    } catch (error) {
      if (!this.closed) {
        this.appendFailureAudit(existing.id, "candidate_git_staged", error, existing.repositoryUrl);
      }
      throw error;
    }
    let current: ManagedSkill;
    try {
      current = this.requireUnchangedSkill(existing);
    } catch (error) {
      this.cleanupStaged(staged);
      if (!this.closed) {
        this.appendFailureAudit(existing.id, "candidate_git_staged", error, existing.repositoryUrl);
      }
      throw error;
    }
    const skill = this.finalizeCandidate(staged, {
      operation: "candidate_git_staged",
      existing: current,
      source: "git",
      repositoryUrl: sanitizeGitUrl(existing.repositoryUrl),
    });
    return { changed: true, skill };
  }

  async saveCandidate(skillId: string, content: string): Promise<ManagedSkillDetail> {
    this.assertOpen();
    const existing = this.requireEditableCustomSkill(skillId);
    const document = validateSkillDocument(content, existing.name);
    const basePackage = existing.candidateVersion?.packageRelativePath
      ?? existing.activeVersion?.packageRelativePath;
    if (!basePackage) throw managementError("candidate_write_failed", "skill has no package to edit");
    const stagingDir = this.packageStore.createEditedStaging(
      basePackage,
      Buffer.from(document.content),
    );
    const staged: StagedSkillPackage = {
      stagingDir,
      document,
      files: [],
      source: existing.source === "git" ? "git" : "upload",
      cleanup: () => this.packageStore.cleanupStaging(stagingDir),
    };
    return this.finalizeCandidate(staged, {
      operation: "candidate_edit_saved",
      existing,
      source: existing.source === "git" ? "git" : "upload",
      repositoryUrl: sanitizeGitUrl(existing.repositoryUrl),
    });
  }

  activate(skillId: string, input: SkillActivationInput): ManagedSkillDetail {
    this.assertOpen();
    const existing = this.requireSkill(skillId);
    if (existing.archivedAt) throw managementError("skill_archived", "archived skills cannot be activated");
    let activated: ManagedSkill;
    try {
      activated = this.repository.transaction(() => {
        const skill = this.repository.activate(skillId, input);
        this.repository.appendAudit({
          operation: "skill_activated",
          skillId,
          versionId: skill.activeVersion?.id,
          result: "success",
        });
        return skill;
      });
    } catch (error) {
      const failure = error instanceof SkillVersionConflictError
        ? managementError("skill_version_conflict", "skill has no pending candidate version")
        : error;
      this.appendFailureAudit(skillId, "skill_activated", failure);
      if (failure instanceof SkillManagementError) throw failure;
      throw managementError("skill_activation_failed", "skill activation failed");
    }
    this.refreshAfterCommit();
    return detached(activated);
  }

  configure(skillId: string, input: SkillConfigurationInput): ManagedSkillDetail {
    this.assertOpen();
    const existing = this.requireSkill(skillId);
    if (existing.archivedAt) throw managementError("skill_archived", "archived skills cannot be configured");
    const configuration = input.enabled ? input : { enabled: false, agentIds: existing.agentIds };
    let configured: ManagedSkill;
    try {
      configured = this.repository.transaction(() => {
        const skill = this.repository.configure(skillId, configuration);
        this.repository.appendAudit({
          operation: "skill_configured",
          skillId,
          versionId: skill.activeVersion?.id,
          result: "success",
        });
        return skill;
      });
    } catch (error) {
      this.appendFailureAudit(skillId, "skill_configured", error);
      throw managementError("skill_configuration_failed", "skill configuration failed");
    }
    this.refreshAfterCommit();
    return detached(configured);
  }

  archive(skillId: string): ManagedSkillDetail {
    this.assertOpen();
    const existing = this.requireEditableCustomSkill(skillId);
    if (existing.enabled) {
      const error = managementError("skill_must_be_disabled", "skill must be disabled before archive");
      this.appendFailureAudit(skillId, "skill_archived", error);
      throw error;
    }
    if (existing.archivedAt) throw managementError("skill_archived", "skill is already archived");
    let renamed = false;
    let archived: ManagedSkill;
    try {
      archived = this.repository.transaction(() => {
        try {
          this.packageStore.archivePackage(existing.name, existing.name);
          renamed = true;
        } catch {
          throw managementError("package_commit_failed", "skill package archive failed");
        }
        const skill = this.repository.archive(skillId);
        this.repository.appendAudit({
          operation: "skill_archived",
          skillId,
          versionId: skill.activeVersion?.id,
          result: "success",
        });
        return skill;
      });
    } catch (error) {
      let compensationFailed = false;
      if (renamed) {
        try {
          this.packageStore.restoreArchivedPackage(existing.name, existing.name);
        } catch {
          try {
            this.packageStore.recoverArchivedPackage(existing.name, existing.name);
          } catch {
            compensationFailed = true;
          }
        }
      }
      const failure = error instanceof SkillManagementError
        ? error
        : managementError("skill_archive_failed", "skill archive failed");
      this.appendFailureAudit(skillId, "skill_archived", failure);
      if (compensationFailed) {
        throw managementError("package_compensation_failed", "skill package compensation failed");
      }
      throw failure;
    }
    this.refreshAfterCommit();
    return detached(archived);
  }

  restore(skillId: string): ManagedSkillDetail {
    this.assertOpen();
    const existing = this.requireSkill(skillId);
    if (existing.kind === "builtin") throw managementError("builtin_skill_immutable", "built-in skills cannot be restored");
    if (!existing.archivedAt) throw managementError("skill_not_archived", "skill is not archived");
    let renamed = false;
    let restored: ManagedSkill;
    try {
      restored = this.repository.transaction(() => {
        try {
          this.packageStore.restoreArchivedPackage(existing.name, existing.name);
          renamed = true;
        } catch {
          throw managementError("package_commit_failed", "skill package restore failed");
        }
        const skill = this.repository.restore(skillId);
        this.repository.appendAudit({
          operation: "skill_restored",
          skillId,
          versionId: skill.activeVersion?.id,
          result: "success",
        });
        return skill;
      });
    } catch (error) {
      let compensationFailed = false;
      if (renamed) {
        try {
          this.packageStore.archivePackage(existing.name, existing.name);
        } catch {
          try {
            this.packageStore.recoverRestoredPackage(existing.name, existing.name);
          } catch {
            compensationFailed = true;
          }
        }
      }
      const failure = error instanceof SkillManagementError
        ? error
        : managementError("skill_restore_failed", "skill restore failed");
      this.appendFailureAudit(skillId, "skill_restored", failure);
      if (compensationFailed) {
        throw managementError("package_compensation_failed", "skill package compensation failed");
      }
      throw failure;
    }
    this.refreshAfterCommit();
    return detached(restored);
  }

  snapshot(): SkillCatalogSnapshot {
    this.assertOpen();
    if (this.snapshotDirty) this.refreshAfterCommit();
    return detached(this.currentSnapshot);
  }

  subscribe(listener: (snapshot: SkillCatalogSnapshot) => void): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.pendingSnapshots.length = 0;
    this.ownedDatabase?.close();
  }

  private finalizeCandidate(
    staged: StagedSkillPackage,
    options: {
      operation: string;
      existing?: ManagedSkill;
      source: "upload" | "git";
      repositoryUrl?: string;
      sourceRef?: string;
      sourceSubdirectory?: string;
    },
  ): ManagedSkillDetail {
    const existing = options.existing ?? this.repository.getByName(staged.document.name);
    if (!options.existing && existing) {
      this.cleanupStaged(staged);
      const error = managementError("skill_name_conflict", "skill name already exists");
      this.appendFailureAudit(existing.id, options.operation, error, options.repositoryUrl);
      throw error;
    }
    if (options.existing && staged.document.name !== options.existing.name) {
      this.cleanupStaged(staged);
      throw managementError("candidate_write_failed", "candidate name does not match installed skill");
    }

    const packageRelativePath = this.nextPackagePath(staged.document.name);
    const candidate: CandidateWrite = {
      ...staged.document,
      packageRelativePath,
      ...(sanitizeCommit(staged.sourceCommit)
        ? { sourceCommit: sanitizeCommit(staged.sourceCommit) }
        : {}),
    };
    let committed = false;
    try {
      const saved = this.repository.transaction(() => {
        try {
          this.packageStore.commitStaging(staged.stagingDir, packageRelativePath);
          committed = true;
        } catch {
          throw managementError("package_commit_failed", "skill package finalization failed");
        }
        const skill = options.existing
          ? this.repository.saveCandidate(options.existing.id, candidate)
          : this.repository.createCustomSkill(candidate, {
            source: options.source,
            ...(options.repositoryUrl ? { repositoryUrl: options.repositoryUrl } : {}),
            ...(options.sourceRef ? { sourceRef: options.sourceRef } : {}),
            ...(options.sourceSubdirectory
              ? { sourceSubdirectory: options.sourceSubdirectory }
              : {}),
          });
        this.repository.appendAudit({
          operation: options.operation,
          skillId: skill.id,
          versionId: skill.candidateVersion?.id,
          ...(options.repositoryUrl ? { sanitizedSource: options.repositoryUrl } : {}),
          result: "success",
        });
        return skill;
      });
      return detached(saved);
    } catch (error) {
      let compensationFailed = false;
      if (committed) {
        try {
          this.packageStore.restoreCommittedPackageToStaging(packageRelativePath, staged.stagingDir);
          committed = false;
        } catch {
          try {
            this.packageStore.recoverCommittedPackageToStaging(packageRelativePath, staged.stagingDir);
            committed = false;
          } catch {
            try {
              this.packageStore.discardCommittedPackage(packageRelativePath);
              committed = false;
            } catch {
              compensationFailed = true;
            }
          }
        }
      }
      this.cleanupStaged(staged);
      const failure = error instanceof SkillManagementError
        ? error
        : managementError("candidate_write_failed", "candidate metadata could not be saved");
      if (options.existing) {
        this.appendFailureAudit(options.existing.id, options.operation, failure, options.repositoryUrl);
      }
      if (compensationFailed) {
        throw managementError("package_compensation_failed", "skill package compensation failed");
      }
      throw failure;
    }
  }

  private nextPackagePath(name: string): string {
    return `${name}/${this.now().getTime()}-${crypto.randomUUID()}`;
  }

  private requireSkill(skillId: string): ManagedSkill {
    const skill = this.repository.get(skillId);
    if (!skill) throw managementError("skill_not_found", "skill was not found");
    return skill;
  }

  private requireEditableCustomSkill(skillId: string): ManagedSkill {
    const skill = this.requireSkill(skillId);
    if (skill.kind === "builtin") {
      throw managementError("builtin_skill_immutable", "built-in skills cannot be edited or archived");
    }
    if (skill.archivedAt) throw managementError("skill_archived", "archived skills cannot be edited");
    return skill;
  }

  private requireUnchangedSkill(expected: ManagedSkill): ManagedSkill {
    this.assertOpen();
    const current = this.repository.get(expected.id);
    if (!current || !this.hasSameLifecycleState(current, expected)) {
      throw managementError(
        "skill_state_changed",
        "skill changed while the asynchronous operation was in progress",
      );
    }
    return current;
  }

  private hasSameLifecycleState(current: ManagedSkill, expected: ManagedSkill): boolean {
    return current.name === expected.name
      && current.kind === expected.kind
      && current.source === expected.source
      && current.repositoryUrl === expected.repositoryUrl
      && current.sourceRef === expected.sourceRef
      && current.sourceSubdirectory === expected.sourceSubdirectory
      && current.enabled === expected.enabled
      && current.generation === expected.generation
      && current.archivedAt === expected.archivedAt
      && current.activeVersion?.id === expected.activeVersion?.id
      && current.activeVersion?.sourceCommit === expected.activeVersion?.sourceCommit
      && current.candidateVersion?.id === expected.candidateVersion?.id
      && current.candidateVersion?.sourceCommit === expected.candidateVersion?.sourceCommit
      && current.agentIds.length === expected.agentIds.length
      && current.agentIds.every((agentId, index) => agentId === expected.agentIds[index]);
  }

  private appendFailureAudit(
    skillId: string,
    operation: string,
    error: unknown,
    source?: string,
  ): void {
    const event: NewSkillAuditEvent = {
      operation,
      skillId,
      ...(sanitizeGitUrl(source) ? { sanitizedSource: sanitizeGitUrl(source) } : {}),
      result: "failure",
      errorCode: stableErrorCode(error, "internal_error"),
    };
    try {
      this.repository.appendAudit(event);
    } catch {
      // A failed audit must not replace the stable lifecycle failure returned to the caller.
    }
  }

  private cleanupStaged(staged: StagedSkillPackage): void {
    if (!existsSync(staged.stagingDir)) return;
    try {
      staged.cleanup();
    } catch {
      // Importers and the package store own only generated staging directories.
    }
  }

  private readSnapshot(): SkillCatalogSnapshot {
    return detached(this.repository.snapshot());
  }

  private publish(): void {
    if (this.closed) return;
    const published = this.readSnapshot();
    this.currentSnapshot = published;
    this.snapshotDirty = false;

    this.pendingSnapshots.push(published);
    if (this.dispatching) return;

    this.dispatching = true;
    try {
      while (!this.closed) {
        const next = this.pendingSnapshots.shift();
        if (!next) break;
        for (const listener of [...this.listeners]) {
          if (this.closed) break;
          if (!this.listeners.has(listener)) continue;
          try {
            listener(detached(next));
          } catch {
            // Listener failures are isolated from catalog commits and other subscribers.
          }
        }
      }
    } finally {
      this.dispatching = false;
      if (this.closed) this.pendingSnapshots.length = 0;
    }
  }

  private refreshAfterCommit(): void {
    try {
      this.publish();
    } catch {
      this.snapshotDirty = true;
      throw managementError(
        "skill_catalog_refresh_failed",
        "skill catalog changed but its runtime snapshot could not be refreshed",
        { committed: true },
      );
    }
  }

  private assertOpen(): void {
    if (this.closed) throw managementError("skill_service_closed", "skill service is closed");
  }
}
