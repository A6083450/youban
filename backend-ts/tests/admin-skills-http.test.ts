import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type {
  GitSkillInstallRequest,
} from "../src/agents/skill-git-importer.ts";
import type {
  ManagedSkillDetail,
  ManagedSkillSummary,
  SkillCatalogSnapshot,
  SkillConfigurationInput,
} from "../src/agents/skill-types.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";
import { createZipFixture } from "./helpers/zip-fixture.ts";

const ADMIN = "admin@123";
const SKILL = "---\nname: museum-guide\ndescription: A practical museum visit guide.\n---\n\n# Museum guide\n";
const EDITED_SKILL = SKILL.replace("# Museum guide", "# Museum guide\n\nEdited candidate marker");
const COMMIT = "1".repeat(40);
const EMPTY_SNAPSHOT: SkillCatalogSnapshot = {
  generation: 41,
  assignments: {
    "parent-assistant": [],
    "destination-researcher": [],
    "segment-planner": [],
    summary: [],
    "itinerary-reviewer": [],
    "plan-editor": [],
  },
};

class NoopPlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) {
    return { success: true, data: request };
  }
}

function version(overrides: Partial<ManagedSkillDetail["versions"][number]> = {}) {
  return {
    id: "version-1",
    skillId: "skill-1",
    versionNumber: 1,
    state: "candidate" as const,
    content: SKILL,
    name: "museum-guide",
    description: "A practical museum visit guide.",
    sha256: "a".repeat(64),
    packageRelativePath: "/private/staging/skill-1/version-1",
    sourceCommit: COMMIT,
    createdAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function detail(overrides: Partial<ManagedSkillDetail> = {}): ManagedSkillDetail {
  const candidateVersion = version();
  return {
    id: "skill-1",
    name: "museum-guide",
    description: "A practical museum visit guide.",
    kind: "custom",
    source: "git",
    enabled: false,
    agentIds: [],
    candidateVersion,
    versions: [candidateVersion],
    repositoryUrl: "https://user:password@git.example.test/org/repo.git?token=secret#fragment",
    sourceRef: "main",
    sourceSubdirectory: "skills/museum-guide",
    generation: 1,
    ...overrides,
  };
}

function summary(skill: ManagedSkillDetail): ManagedSkillSummary {
  return {
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
  };
}

class FakeSkillService {
  current = detail();
  gitRequests: GitSkillInstallRequest[] = [];
  closeCount = 0;

  snapshot(): SkillCatalogSnapshot { return structuredClone(EMPTY_SNAPSHOT); }
  subscribe(): () => void { return () => {}; }
  close(): void { this.closeCount += 1; }
  list(options: { archived?: boolean } = {}): ManagedSkillSummary[] {
    if (options.archived !== Boolean(this.current.archivedAt)) return [];
    return [summary(this.current)];
  }
  get(): ManagedSkillDetail { return structuredClone(this.current); }
  async stageUpload(): Promise<ManagedSkillDetail> { return structuredClone(this.current); }
  async stageGit(input: GitSkillInstallRequest): Promise<ManagedSkillDetail> {
    this.gitRequests.push(structuredClone(input));
    return structuredClone(this.current);
  }
  async checkGitUpdate(): Promise<{ changed: boolean; skill: ManagedSkillDetail }> {
    return { changed: false, skill: structuredClone(this.current) };
  }
  async saveCandidate(): Promise<ManagedSkillDetail> { return structuredClone(this.current); }
  activate(_id: string, input: SkillConfigurationInput): ManagedSkillDetail {
    this.current = { ...this.current, enabled: input.enabled, agentIds: [...input.agentIds] };
    return structuredClone(this.current);
  }
  configure(_id: string, input: SkillConfigurationInput): ManagedSkillDetail {
    this.current = { ...this.current, enabled: input.enabled, agentIds: [...input.agentIds] };
    return structuredClone(this.current);
  }
  archive(): ManagedSkillDetail {
    this.current = { ...this.current, enabled: false, archivedAt: "2026-08-22T01:00:00.000Z" };
    return structuredClone(this.current);
  }
  restore(): ManagedSkillDetail {
    const { archivedAt: _archivedAt, ...restored } = this.current;
    this.current = { ...restored, enabled: false };
    return structuredClone(this.current);
  }
}

const runtimes: HttpRuntime[] = [];
const tempDirs: string[] = [];

function runtime(options: Record<string, unknown> = {}): HttpRuntime {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-admin-skills-http-"));
  tempDirs.push(dataDir);
  const value = createHttpRuntime({
    dataDir,
    planner: new NoopPlanner(),
    ...options,
  });
  runtimes.push(value);
  return value;
}

afterEach(async () => {
  for (const value of runtimes.splice(0)) await value.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function jsonRequest(
  value: HttpRuntime,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  return value.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

function multipartRequest(
  value: HttpRuntime,
  path: string,
  form: FormData,
  token?: string,
): Promise<Response> {
  return value.app.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: token ? { "x-admin-token": token } : undefined,
    body: form,
  }));
}

function validUpload(content = SKILL): FormData {
  const bytes = createZipFixture([
    { name: "museum-guide/SKILL.md", content },
    { name: "museum-guide/references/checklist.txt", content: "bring water" },
  ]);
  const form = new FormData();
  form.set("file", new File([bytes], "museum-guide.zip", { type: "application/zip" }));
  return form;
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

describe("admin Skill HTTP", () => {
  it("authenticates every Skill endpoint through the live Admin password boundary", async () => {
    const value = runtime();
    const routes: Array<() => Promise<Response>> = [
      () => jsonRequest(value, "GET", "/api/admin/skills?query=private-prompt"),
      () => jsonRequest(value, "GET", "/api/admin/skills/missing"),
      () => multipartRequest(value, "/api/admin/skills/upload", validUpload()),
      // Authentication must win even when the request would otherwise fail validation.
      () => jsonRequest(value, "POST", "/api/admin/skills/git", {}),
      () => jsonRequest(value, "POST", "/api/admin/skills/missing/check-update", {}),
      () => jsonRequest(value, "PUT", "/api/admin/skills/missing/candidate", { content: SKILL }),
      () => jsonRequest(value, "POST", "/api/admin/skills/missing/activate", {
        enabled: true,
        agent_ids: ["segment-planner"],
      }),
      () => jsonRequest(value, "PUT", "/api/admin/skills/missing/configuration", {
        enabled: false,
        agent_ids: ["segment-planner"],
      }),
      () => jsonRequest(value, "DELETE", "/api/admin/skills/missing"),
      () => jsonRequest(value, "POST", "/api/admin/skills/missing/restore", {}),
    ];

    for (const invoke of routes) {
      const response = await invoke();
      expect(response.status).toBe(401);
      expect(await responseJson(response)).toEqual({
        detail: "后台密码校验失败，请重新登录",
        code: "invalid_admin_token",
      });
    }

    expect(readFileSync(join(value.dataDir, "admin_password.txt"), "utf8").trim()).toBe(ADMIN);
    writeFileSync(join(value.dataDir, "admin_password.txt"), "rotated-secret\n", "utf8");
    expect((await jsonRequest(value, "GET", "/api/admin/skills", undefined, ADMIN)).status).toBe(401);
    expect((await jsonRequest(value, "GET", "/api/admin/skills", undefined, "rotated-secret")).status).toBe(200);
  });

  it("returns exact snake_case summaries, detail versions, and bounded capabilities", async () => {
    const value = runtime();
    const listResponse = await jsonRequest(value, "GET", "/api/admin/skills", undefined, ADMIN);
    expect(listResponse.status).toBe(200);
    const list = await responseJson(listResponse);
    expect(Object.keys(list.capabilities).sort()).toEqual([
      "git_available",
      "private_git_credentials_available",
    ]);
    expect(list.capabilities).toEqual({
      git_available: expect.any(Boolean),
      private_git_credentials_available: expect.any(Boolean),
    });
    expect(list.items).toHaveLength(4);
    expect(list.items[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      kind: "builtin",
      source: "builtin",
      state: expect.stringMatching(/^(enabled|disabled)$/),
      enabled: expect.any(Boolean),
      agent_ids: expect.any(Array),
      active_version_id: expect.any(String),
      candidate_version_id: null,
      repository_url: null,
      source_ref: null,
      source_subdirectory: null,
      generation: expect.any(Number),
      archived_at: null,
    });
    const listText = JSON.stringify(list);
    expect(listText).not.toContain("packageRelativePath");
    expect(listText).not.toContain("package_relative_path");
    expect(listText).not.toContain("SKILL.md");

    const id = list.items[0].id as string;
    const detailResponse = await jsonRequest(value, "GET", `/api/admin/skills/${id}`, undefined, ADMIN);
    expect(detailResponse.status).toBe(200);
    const body = await responseJson(detailResponse);
    expect(body.skill.agent_ids).toEqual(expect.any(Array));
    expect(body.skill.active_version).toEqual(expect.objectContaining({
      id: expect.any(String),
      skill_id: id,
      version_number: 1,
      state: "active",
      content: expect.stringContaining("---"),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(JSON.stringify(body)).not.toContain("packageRelativePath");
    expect(JSON.stringify(body)).not.toContain("package_relative_path");
  });

  it("stages a ZIP as a disabled candidate and applies lifecycle changes explicitly", async () => {
    const value = runtime();
    const stagedResponse = await multipartRequest(value, "/api/admin/skills/upload", validUpload(), ADMIN);
    expect(stagedResponse.status).toBe(201);
    const staged = await responseJson(stagedResponse);
    expect(staged.skill).toEqual(expect.objectContaining({
      name: "museum-guide",
      enabled: false,
      state: "candidate",
      active_version: null,
      candidate_version: expect.objectContaining({ content: SKILL }),
    }));
    const id = staged.skill.id as string;

    const activated = await responseJson(await jsonRequest(
      value,
      "POST",
      `/api/admin/skills/${id}/activate`,
      { enabled: true, agent_ids: ["segment-planner"] },
      ADMIN,
    ));
    expect(activated.skill).toEqual(expect.objectContaining({
      state: "enabled",
      enabled: true,
      agent_ids: ["segment-planner"],
      candidate_version: null,
      active_version: expect.objectContaining({ content: SKILL }),
    }));

    const edited = await responseJson(await jsonRequest(
      value,
      "PUT",
      `/api/admin/skills/${id}/candidate`,
      { content: EDITED_SKILL },
      ADMIN,
    ));
    expect(edited.skill.state).toBe("candidate");
    expect(edited.skill.active_version.content).toBe(SKILL);
    expect(edited.skill.candidate_version.content).toBe(EDITED_SKILL);

    const disabled = await responseJson(await jsonRequest(
      value,
      "PUT",
      `/api/admin/skills/${id}/configuration`,
      { enabled: false, agent_ids: [] },
      ADMIN,
    ));
    expect(disabled.skill.enabled).toBe(false);
    expect(disabled.skill.agent_ids).toEqual(["segment-planner"]);

    const archived = await responseJson(await jsonRequest(
      value,
      "DELETE",
      `/api/admin/skills/${id}`,
      undefined,
      ADMIN,
    ));
    expect(archived.skill.state).toBe("archived");
    const activeList = await responseJson(await jsonRequest(value, "GET", "/api/admin/skills", undefined, ADMIN));
    expect(activeList.items.some((item: Record<string, unknown>) => item.id === id)).toBe(false);
    const archivedList = await responseJson(await jsonRequest(
      value,
      "GET",
      "/api/admin/skills?archived=true",
      undefined,
      ADMIN,
    ));
    expect(archivedList.items.some((item: Record<string, unknown>) => item.id === id)).toBe(true);

    const restored = await responseJson(await jsonRequest(
      value,
      "POST",
      `/api/admin/skills/${id}/restore`,
      {},
      ADMIN,
    ));
    expect(restored.skill).toEqual(expect.objectContaining({
      state: "disabled",
      enabled: false,
      archived_at: null,
    }));
  });

  it("normalizes Git inputs and strips URL credentials, query, fragment, and package paths", async () => {
    const skills = new FakeSkillService();
    const value = runtime({ skillService: skills });
    const installedResponse = await jsonRequest(value, "POST", "/api/admin/skills/git", {
      repository_url: "https://git.example.test/org/repo.git",
      ref: "main",
      subdirectory: "skills/museum-guide",
    }, ADMIN);
    expect(installedResponse.status).toBe(201);
    const installed = await responseJson(installedResponse);
    expect(skills.gitRequests).toEqual([{
      repositoryUrl: "https://git.example.test/org/repo.git",
      ref: "main",
      subdirectory: "skills/museum-guide",
    }]);
    expect(installed.skill.repository_url).toBe("https://git.example.test/org/repo.git");
    const serialized = JSON.stringify(installed);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("fragment");
    expect(serialized).not.toContain("/private/staging");
    expect(serialized).not.toContain("package_relative_path");

    const checked = await jsonRequest(
      value,
      "POST",
      "/api/admin/skills/skill-1/check-update",
      {},
      ADMIN,
    );
    expect(checked.status).toBe(200);
    expect(await responseJson(checked)).toEqual(expect.objectContaining({
      changed: false,
      skill: expect.objectContaining({ id: "skill-1" }),
    }));
  });

  it("rejects built-in edits, archives, and restores below the HTTP boundary", async () => {
    const value = runtime();
    const list = await responseJson(await jsonRequest(value, "GET", "/api/admin/skills", undefined, ADMIN));
    const builtinId = list.items.find((item: Record<string, unknown>) => item.kind === "builtin").id as string;
    for (const response of [
      await jsonRequest(value, "PUT", `/api/admin/skills/${builtinId}/candidate`, { content: SKILL }, ADMIN),
      await jsonRequest(value, "DELETE", `/api/admin/skills/${builtinId}`, undefined, ADMIN),
      await jsonRequest(value, "POST", `/api/admin/skills/${builtinId}/restore`, {}, ADMIN),
    ]) {
      expect(response.status).toBe(409);
      expect(await responseJson(response)).toEqual({
        detail: expect.any(String),
        code: "builtin_skill_immutable",
      });
    }
  });

  it("maps stable failures without returning exception messages, paths, credentials, or stacks", async () => {
    const cases = [
      ["skill_not_found", 404],
      ["skill_name_conflict", 409],
      ["skill_package_too_large", 413],
      ["invalid_skill_frontmatter", 422],
      ["invalid_git_ref", 422],
      ["git_unavailable", 503],
      ["git_timeout", 504],
      ["unknown_failure", 500],
    ] as const;

    for (const [code, expectedStatus] of cases) {
      const skills = new FakeSkillService();
      skills.list = () => {
        throw Object.assign(new Error(
          "Authorization: Bearer private-token /private/staging prompt=complete-skill-content",
        ), { code, stack: "private stack" });
      };
      const value = runtime({ skillService: skills });
      const response = await jsonRequest(value, "GET", "/api/admin/skills", undefined, ADMIN);
      expect(response.status).toBe(expectedStatus);
      const body = await responseJson(response);
      expect(body.code).toBe(code === "unknown_failure" ? "internal_error" : code);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("private-token");
      expect(serialized).not.toContain("/private/staging");
      expect(serialized).not.toContain("complete-skill-content");
      expect(serialized).not.toContain("private stack");
      await value.close();
      runtimes.splice(runtimes.indexOf(value), 1);
    }
  });

  it("accepts only one multipart file and returns stable assignment validation errors", async () => {
    const value = runtime();
    const upload = validUpload();
    upload.set("metadata", "must-not-be-accepted");
    const extraField = await multipartRequest(value, "/api/admin/skills/upload", upload, ADMIN);
    expect(extraField.status).toBe(422);
    expect(await responseJson(extraField)).toEqual({
      detail: expect.any(String),
      code: "invalid_archive",
    });

    const invalidAssignment = await jsonRequest(
      value,
      "POST",
      "/api/admin/skills/missing/activate",
      { enabled: true, agent_ids: ["filesystem-agent"] },
      ADMIN,
    );
    expect(invalidAssignment.status).toBe(422);
    expect(await responseJson(invalidAssignment)).toEqual({
      detail: expect.any(String),
      code: "invalid_assignment",
    });
  });
});
