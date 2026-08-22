import { basename } from "node:path";
import { Elysia, t } from "elysia";
import type { GitSkillInstallRequest } from "../agents/skill-git-importer.ts";
import { validateGitRef } from "../agents/skill-git-importer.ts";
import type { SkillCatalogProvider } from "../agents/skill-management-service.ts";
import { normalizeSkillPackagePath } from "../agents/skill-package-store.ts";
import {
  SKILL_AGENT_IDS,
  type SkillActivationInput,
  type ManagedSkillDetail,
  type ManagedSkillSummary,
  type SkillConfigurationInput,
  type SkillVersion,
} from "../agents/skill-types.ts";
import { MAX_SKILL_ARCHIVE_BYTES } from "./admin-skill-limits.ts";

const MAX_FILENAME_LENGTH = 255;

const SkillAgentIdSchema = t.Union([
  t.Literal("parent-assistant"),
  t.Literal("destination-researcher"),
  t.Literal("segment-planner"),
  t.Literal("summary"),
  t.Literal("itinerary-reviewer"),
  t.Literal("plan-editor"),
]);
const SkillStateSchema = t.Union([
  t.Literal("candidate"),
  t.Literal("enabled"),
  t.Literal("disabled"),
  t.Literal("archived"),
]);
const SkillKindSchema = t.Union([t.Literal("builtin"), t.Literal("custom")]);
const SkillSourceSchema = t.Union([
  t.Literal("builtin"),
  t.Literal("upload"),
  t.Literal("git"),
]);
const SkillVersionStateSchema = t.Union([
  t.Literal("candidate"),
  t.Literal("active"),
  t.Literal("superseded"),
  t.Literal("archived"),
]);
const NullableStringSchema = t.Union([t.String(), t.Null()]);

const SkillSummarySchema = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.String(),
  kind: SkillKindSchema,
  source: SkillSourceSchema,
  state: SkillStateSchema,
  enabled: t.Boolean(),
  agent_ids: t.Array(SkillAgentIdSchema),
  active_version_id: NullableStringSchema,
  candidate_version_id: NullableStringSchema,
  repository_url: NullableStringSchema,
  source_ref: NullableStringSchema,
  source_subdirectory: NullableStringSchema,
  generation: t.Integer({ minimum: 0 }),
  archived_at: NullableStringSchema,
}, { additionalProperties: false });

const SkillVersionSchema = t.Object({
  id: t.String(),
  skill_id: t.String(),
  version_number: t.Integer({ minimum: 1 }),
  state: SkillVersionStateSchema,
  content: t.String(),
  name: t.String(),
  description: t.String(),
  sha256: t.String(),
  source_commit: NullableStringSchema,
  created_at: t.String(),
  activated_at: NullableStringSchema,
}, { additionalProperties: false });

const SkillDetailSchema = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.String(),
  kind: SkillKindSchema,
  source: SkillSourceSchema,
  state: SkillStateSchema,
  enabled: t.Boolean(),
  agent_ids: t.Array(SkillAgentIdSchema),
  active_version_id: NullableStringSchema,
  candidate_version_id: NullableStringSchema,
  repository_url: NullableStringSchema,
  source_ref: NullableStringSchema,
  source_subdirectory: NullableStringSchema,
  generation: t.Integer({ minimum: 0 }),
  archived_at: NullableStringSchema,
  active_version: t.Union([SkillVersionSchema, t.Null()]),
  candidate_version: t.Union([SkillVersionSchema, t.Null()]),
  versions: t.Array(SkillVersionSchema),
}, { additionalProperties: false });

const SkillErrorSchema = t.Object({
  detail: t.String(),
  code: t.String(),
}, { additionalProperties: false });

const SkillMutationResponseSchema = t.Object({ skill: SkillDetailSchema }, {
  additionalProperties: false,
});

const SkillErrorResponses = {
  401: SkillErrorSchema,
  404: SkillErrorSchema,
  409: SkillErrorSchema,
  413: SkillErrorSchema,
  422: SkillErrorSchema,
  500: SkillErrorSchema,
  503: SkillErrorSchema,
  504: SkillErrorSchema,
};

const SkillIdParamsSchema = t.Object({
  skillId: t.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });

const ConfigurationBodySchema = t.Object({
  enabled: t.Boolean(),
  agent_ids: t.Array(SkillAgentIdSchema, { maxItems: SKILL_AGENT_IDS.length, uniqueItems: true }),
}, { additionalProperties: false });

export interface AdminSkillService extends SkillCatalogProvider {
  list(options?: { archived?: boolean }): ManagedSkillSummary[];
  get(skillId: string): ManagedSkillDetail;
  stageUpload(input: { filename: string; bytes: Uint8Array }): Promise<ManagedSkillDetail>;
  stageGit(input: GitSkillInstallRequest): Promise<ManagedSkillDetail>;
  checkGitUpdate(skillId: string): Promise<{ changed: boolean; skill: ManagedSkillDetail }>;
  saveCandidate(skillId: string, content: string): Promise<ManagedSkillDetail>;
  activate(skillId: string, input: SkillActivationInput): ManagedSkillDetail;
  configure(skillId: string, input: SkillConfigurationInput): ManagedSkillDetail;
  archive(skillId: string): ManagedSkillDetail;
  restore(skillId: string): ManagedSkillDetail;
  close(): void;
}

export interface AdminSkillCapabilities {
  gitAvailable: boolean;
  privateGitCredentialsAvailable: boolean;
}

export interface AdminSkillRoutesOptions {
  skills: AdminSkillService;
  authorize(headers: Record<string, string | undefined>): boolean;
  runSkillOperation?<T>(operation: () => T | Promise<T>): Promise<T>;
  capabilities?(): AdminSkillCapabilities;
}

type SkillState = "candidate" | "enabled" | "disabled" | "archived";

interface AdminSkillError {
  detail: string;
  code: string;
}

interface ResponseSet {
  status?: number | string;
}

const KNOWN_ERROR_CODES = new Set([
  "skill_not_found",
  "skill_name_conflict",
  "builtin_skill_immutable",
  "skill_must_be_disabled",
  "skill_not_archived",
  "skill_archived",
  "skill_not_git_managed",
  "skill_service_closed",
  "skill_state_changed",
  "skill_catalog_refresh_failed",
  "package_commit_failed",
  "package_compensation_failed",
  "candidate_write_failed",
  "skill_version_conflict",
  "skill_activation_failed",
  "skill_configuration_failed",
  "skill_archive_failed",
  "skill_restore_failed",
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
  "invalid_archive",
  "invalid_assignment",
  "invalid_skill_document",
  "invalid_source",
  "invalid_request",
]);

const ERROR_DETAILS: Readonly<Record<string, string>> = {
  skill_not_found: "技能不存在",
  skill_name_conflict: "同名技能已存在",
  builtin_skill_immutable: "内置技能不支持此操作",
  skill_must_be_disabled: "归档前必须先停用技能",
  skill_not_archived: "技能尚未归档",
  skill_archived: "已归档技能不支持此操作",
  skill_not_git_managed: "该技能不是 Git 来源",
  skill_state_changed: "技能状态已变化，请刷新后重试",
  skill_version_conflict: "技能候选版本不存在或已被激活",
  invalid_skill_encoding: "技能文档编码无效",
  invalid_skill_frontmatter: "技能文档格式无效",
  invalid_skill_name: "技能名称无效",
  skill_name_mismatch: "技能名称与已安装名称不一致",
  invalid_skill_description: "技能说明无效",
  skill_document_too_large: "技能文档超出大小限制",
  invalid_zip_archive: "ZIP 文件无效",
  invalid_zip_entry: "ZIP 文件包含不安全条目",
  invalid_skill_package: "技能包无效",
  skill_package_too_large: "技能包超出大小或文件数限制",
  invalid_git_url: "Git 仓库地址无效",
  invalid_git_host: "Git 仓库主机无效",
  invalid_git_ref: "Git 分支、标签或提交无效",
  invalid_git_subdirectory: "Git 技能目录无效",
  invalid_git_commit: "Git 提交无效",
  invalid_git_package: "Git 技能包无效",
  git_unavailable: "服务器当前无法使用 Git",
  git_timeout: "Git 操作超时",
  git_output_too_large: "Git 响应超出限制",
  git_redirect: "Git 仓库重定向不受支持",
  git_failed: "Git 操作失败",
  invalid_archive: "上传文件必须是唯一的 ZIP 文件字段",
  invalid_assignment: "Agent 分配无效",
  invalid_skill_document: "技能文档无效",
  invalid_source: "技能来源无效",
  invalid_request: "请求参数无效",
};

function skillState(skill: ManagedSkillSummary | ManagedSkillDetail): SkillState {
  if (skill.archivedAt) return "archived";
  const candidate = "versions" in skill ? skill.candidateVersion : skill.candidateVersionId;
  if (candidate) return "candidate";
  return skill.enabled ? "enabled" : "disabled";
}

function safeRepositoryUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname) return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function containsConfiguredCredential(value: string): boolean {
  const token = process.env.YOUBAN_SKILL_GIT_TOKEN?.trim();
  if (!token) return false;
  if (value.includes(token)) return true;
  return /^[0-9a-f]+$/i.test(token)
    && value.toLowerCase().includes(token.toLowerCase());
}

function safeSourceRef(value: string | undefined): string | null {
  if (!value || containsConfiguredCredential(value)) return null;
  try {
    return validateGitRef(value) ?? null;
  } catch {
    return null;
  }
}

function safeSubdirectory(value: string | undefined): string | null {
  if (!value || containsConfiguredCredential(value)) return null;
  try {
    return normalizeSkillPackagePath(value);
  } catch {
    return null;
  }
}

function toSummaryDto(skill: ManagedSkillSummary) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
    source: skill.source,
    state: skillState(skill),
    enabled: skill.enabled,
    agent_ids: [...skill.agentIds],
    active_version_id: skill.activeVersionId ?? null,
    candidate_version_id: skill.candidateVersionId ?? null,
    repository_url: safeRepositoryUrl(skill.repositoryUrl),
    source_ref: safeSourceRef(skill.sourceRef),
    source_subdirectory: safeSubdirectory(skill.sourceSubdirectory),
    generation: skill.generation,
    archived_at: skill.archivedAt ?? null,
  };
}

function toVersionDto(version: SkillVersion) {
  if (!/^[0-9a-f]{64}$/i.test(version.sha256) || containsConfiguredCredential(version.sha256)) {
    throw new Error("invalid skill version sha256");
  }
  const sourceCommit = version.sourceCommit
    && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(version.sourceCommit)
    && !containsConfiguredCredential(version.sourceCommit)
    ? version.sourceCommit.toLowerCase()
    : null;
  return {
    id: version.id,
    skill_id: version.skillId,
    version_number: version.versionNumber,
    state: version.state,
    content: version.content,
    name: version.name,
    description: version.description,
    sha256: version.sha256.toLowerCase(),
    source_commit: sourceCommit,
    created_at: version.createdAt,
    activated_at: version.activatedAt ?? null,
  };
}

function toDetailDto(skill: ManagedSkillDetail) {
  const base = toSummaryDto({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
    source: skill.source,
    enabled: skill.enabled,
    agentIds: skill.agentIds,
    generation: skill.generation,
    ...(skill.repositoryUrl ? { repositoryUrl: skill.repositoryUrl } : {}),
    ...(skill.sourceRef ? { sourceRef: skill.sourceRef } : {}),
    ...(skill.sourceSubdirectory ? { sourceSubdirectory: skill.sourceSubdirectory } : {}),
    ...(skill.archivedAt ? { archivedAt: skill.archivedAt } : {}),
    ...(skill.activeVersion ? { activeVersionId: skill.activeVersion.id } : {}),
    ...(skill.candidateVersion ? { candidateVersionId: skill.candidateVersion.id } : {}),
  });
  return {
    ...base,
    active_version: skill.activeVersion ? toVersionDto(skill.activeVersion) : null,
    candidate_version: skill.candidateVersion ? toVersionDto(skill.candidateVersion) : null,
    versions: [...skill.versions]
      .sort((left, right) => left.versionNumber - right.versionNumber)
      .map(toVersionDto),
  };
}

function statusForError(code: string): number {
  if (code === "skill_not_found") return 404;
  if ([
    "skill_name_conflict",
    "builtin_skill_immutable",
    "skill_must_be_disabled",
    "skill_not_archived",
    "skill_archived",
    "skill_state_changed",
    "skill_version_conflict",
  ].includes(code)) return 409;
  if (code === "skill_package_too_large") return 413;
  if (code === "git_unavailable") return 503;
  if (code === "git_timeout") return 504;
  if (
    code.startsWith("invalid_")
    || code === "skill_name_mismatch"
    || code === "skill_document_too_large"
    || code === "skill_not_git_managed"
    || code === "git_output_too_large"
    || code === "git_redirect"
    || code === "git_failed"
  ) return 422;
  return 500;
}

function stableErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "internal_error";
  const code = String(error.code);
  return KNOWN_ERROR_CODES.has(code) ? code : "internal_error";
}

function errorBody(code: string): AdminSkillError {
  return {
    detail: ERROR_DETAILS[code] ?? "技能管理服务暂时不可用",
    code,
  };
}

function fail(set: ResponseSet, code: string, status = statusForError(code)): AdminSkillError {
  set.status = status;
  return errorBody(code);
}

function unauthorized(set: ResponseSet): AdminSkillError {
  set.status = 401;
  return { detail: "后台密码校验失败，请重新登录", code: "invalid_admin_token" };
}

function configuration(input: { enabled: boolean; agent_ids: readonly (typeof SKILL_AGENT_IDS)[number][] }): SkillConfigurationInput {
  return { enabled: input.enabled, agentIds: [...input.agent_ids] };
}

function activation(input: {
  candidate_version_id: string;
  enabled: boolean;
  agent_ids: readonly (typeof SKILL_AGENT_IDS)[number][];
}): SkillActivationInput {
  return {
    candidateVersionId: input.candidate_version_id,
    enabled: input.enabled,
    agentIds: [...input.agent_ids],
  };
}

function boundedFilename(file: File): string {
  const name = basename(file.name.replaceAll("\0", "")).slice(0, MAX_FILENAME_LENGTH);
  return name || "skill.zip";
}

export function adminSkillValidationFailure(request: Request): AdminSkillError {
  const pathname = new URL(request.url).pathname;
  let code = "invalid_request";
  if (pathname.endsWith("/upload")) code = "invalid_archive";
  if (pathname.endsWith("/activate") || pathname.endsWith("/configuration")) {
    code = "invalid_assignment";
  }
  if (pathname.endsWith("/candidate")) code = "invalid_skill_document";
  if (pathname.endsWith("/git")) code = "invalid_source";
  return errorBody(code);
}

export function createAdminSkillRoutes(options: AdminSkillRoutesOptions) {
  const runSkillOperation = options.runSkillOperation
    ?? (async <T>(operation: () => T | Promise<T>): Promise<T> => await operation());
  const capabilities = options.capabilities ?? (() => ({
    gitAvailable: Bun.which("git") !== null,
    privateGitCredentialsAvailable: Boolean(
      process.env.YOUBAN_SKILL_GIT_TOKEN?.trim()
      && process.env.YOUBAN_SKILL_GIT_TOKEN_HOST?.trim(),
    ),
  }));
  const execute = async <T>(set: ResponseSet, operation: () => T | Promise<T>): Promise<T | AdminSkillError> => {
    try {
      return await runSkillOperation(operation);
    } catch (error) {
      return fail(set, stableErrorCode(error));
    }
  };

  return new Elysia({ name: "youban-admin-skills" })
    .onRequest(({ request, set }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/api/admin/skills" && !pathname.startsWith("/api/admin/skills/")) return;
      if (!options.authorize(Object.fromEntries(request.headers.entries()))) return unauthorized(set);
    })
    .onError(({ code, request, set }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/api/admin/skills" && !pathname.startsWith("/api/admin/skills/")) return;
      if (code !== "VALIDATION" && code !== "PARSE") return;
      const failure = adminSkillValidationFailure(request);
      return fail(set, failure.code, 422);
    })
    .get("/api/admin/skills", ({ headers, query, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, () => {
        const includeArchived = query.archived === "true";
        const items = [
          ...options.skills.list(),
          ...(includeArchived ? options.skills.list({ archived: true }) : []),
        ].map(toSummaryDto).filter((skill) => {
          const normalizedQuery = query.query?.trim().toLowerCase();
          if (normalizedQuery && !`${skill.name}\n${skill.description}`.toLowerCase().includes(normalizedQuery)) {
            return false;
          }
          if (query.source && skill.source !== query.source) return false;
          if (query.state && skill.state !== query.state) return false;
          return true;
        }).sort((left, right) => left.name === right.name
          ? left.id.localeCompare(right.id)
          : left.name.localeCompare(right.name));
        const available = capabilities();
        return {
          items,
          capabilities: {
            git_available: Boolean(available.gitAvailable),
            private_git_credentials_available: Boolean(available.privateGitCredentialsAvailable),
          },
        };
      });
    }, {
      query: t.Object({
        archived: t.Optional(t.Union([t.Literal("true"), t.Literal("false")])),
        query: t.Optional(t.String({ maxLength: 200 })),
        source: t.Optional(SkillSourceSchema),
        state: t.Optional(SkillStateSchema),
      }, { additionalProperties: false }),
      response: {
        200: t.Object({
          items: t.Array(SkillSummarySchema),
          capabilities: t.Object({
            git_available: t.Boolean(),
            private_git_credentials_available: t.Boolean(),
          }, { additionalProperties: false }),
        }, { additionalProperties: false }),
        ...SkillErrorResponses,
      },
    })
    .get("/api/admin/skills/:skillId", ({ params, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, () => ({ skill: toDetailDto(options.skills.get(params.skillId)) }));
    }, {
      params: SkillIdParamsSchema,
      response: { 200: SkillMutationResponseSchema, ...SkillErrorResponses },
    })
    .post("/api/admin/skills/upload", async ({ body, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      if (Object.keys(body).length !== 1 || !("file" in body)) {
        return fail(set, "invalid_archive", 422);
      }
      const file = body.file;
      if (!(file instanceof File)) return fail(set, "invalid_archive", 422);
      if (file.size > MAX_SKILL_ARCHIVE_BYTES) return fail(set, "skill_package_too_large", 413);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await execute(set, async () => ({
        skill: toDetailDto(await options.skills.stageUpload({
          filename: boundedFilename(file),
          bytes,
        })),
      }));
      if (!("code" in result)) set.status = 201;
      return result;
    }, {
      // Keep unknown multipart keys visible so the handler can reject them instead of
      // allowing Elysia's normalizer to silently strip them.
      body: t.Record(t.String(), t.Unknown()),
      response: { 201: SkillMutationResponseSchema, ...SkillErrorResponses },
    })
    .post("/api/admin/skills/git", async ({ body, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      const result = await execute(set, async () => ({
        skill: toDetailDto(await options.skills.stageGit({
          repositoryUrl: body.repository_url,
          ...(body.ref ? { ref: body.ref } : {}),
          ...(body.subdirectory ? { subdirectory: body.subdirectory } : {}),
        })),
      }));
      if (!("code" in result)) set.status = 201;
      return result;
    }, {
      body: t.Object({
        repository_url: t.String({ minLength: 1, maxLength: 2_048 }),
        ref: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
        subdirectory: t.Optional(t.String({ minLength: 1, maxLength: 1_024 })),
      }, { additionalProperties: false }),
      response: { 201: SkillMutationResponseSchema, ...SkillErrorResponses },
    })
    .post("/api/admin/skills/:skillId/check-update", async ({ params, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, async () => {
        const result = await options.skills.checkGitUpdate(params.skillId);
        return { changed: result.changed, skill: toDetailDto(result.skill) };
      });
    }, {
      params: SkillIdParamsSchema,
      response: {
        200: t.Object({ changed: t.Boolean(), skill: SkillDetailSchema }, { additionalProperties: false }),
        ...SkillErrorResponses,
      },
    })
    .put("/api/admin/skills/:skillId/candidate", async ({ params, body, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, async () => ({
        skill: toDetailDto(await options.skills.saveCandidate(params.skillId, body.content)),
      }));
    }, {
      params: SkillIdParamsSchema,
      body: t.Object({ content: t.String({ minLength: 1, maxLength: 262_144 }) }, {
        additionalProperties: false,
      }),
      response: { 200: SkillMutationResponseSchema, ...SkillErrorResponses },
    })
    .post("/api/admin/skills/:skillId/activate", ({ params, body, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, () => ({
        skill: toDetailDto(options.skills.activate(params.skillId, activation(body))),
      }));
    }, {
      params: SkillIdParamsSchema,
      body: t.Object({
        candidate_version_id: t.String({ minLength: 1, maxLength: 128 }),
        enabled: t.Boolean(),
        agent_ids: t.Array(SkillAgentIdSchema, { maxItems: SKILL_AGENT_IDS.length, uniqueItems: true }),
      }, { additionalProperties: false }),
      response: { 200: SkillMutationResponseSchema, ...SkillErrorResponses },
    })
    .put("/api/admin/skills/:skillId/configuration", ({ params, body, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, () => ({
        skill: toDetailDto(options.skills.configure(params.skillId, configuration(body))),
      }));
    }, {
      params: SkillIdParamsSchema,
      body: ConfigurationBodySchema,
      response: { 200: SkillMutationResponseSchema, ...SkillErrorResponses },
    })
    .delete("/api/admin/skills/:skillId", ({ params, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, () => ({ skill: toDetailDto(options.skills.archive(params.skillId)) }));
    }, {
      params: SkillIdParamsSchema,
      response: { 200: SkillMutationResponseSchema, ...SkillErrorResponses },
    })
    .post("/api/admin/skills/:skillId/restore", ({ params, headers, set }) => {
      if (!options.authorize(headers)) return unauthorized(set);
      return execute(set, () => ({ skill: toDetailDto(options.skills.restore(params.skillId)) }));
    }, {
      params: SkillIdParamsSchema,
      response: { 200: SkillMutationResponseSchema, ...SkillErrorResponses },
    });
}
