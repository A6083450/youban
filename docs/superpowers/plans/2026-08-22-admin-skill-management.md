# YouBan Admin Skill Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Admin workspace that installs Skills from ZIP or HTTPS Git, stages reviewed versions, controls enablement and six-agent assignment, and rotates runtime prompt snapshots without interrupting active trips.

**Architecture:** SQLite owns catalog metadata, validated prompt text, assignments, versions, and audit events; immutable package files live below `DATA_DIR/skills`. A `SkillManagementService` coordinates validation and staged filesystem changes, publishes immutable catalog snapshots, and powers a dedicated Admin HTTP plugin. Parent and structured-agent hosts pin one catalog generation while active and rotate before later work.

**Tech Stack:** Bun 1.4, TypeScript, Elysia, TypeBox, `bun:sqlite`, Drizzle ORM, `yaml@2.9.0`, `yauzl@3.3.1`, Vue 3, Ant Design Vue, vue-i18n, `diff@8.0.4`, Bun tests, browser-use.

## Global Constraints

- Preserve the four built-in Skills and their current parent/subagent assignments.
- Built-in Skills may be viewed, enabled, disabled, and reassigned; backend code must reject edit, archive, restore, and delete operations.
- Custom changes always create a candidate. Active content remains unchanged until explicit activation.
- Global disable overrides assignments and re-enable restores saved assignments.
- Supported targets are exactly `parent-assistant`, `destination-researcher`, `segment-planner`, `summary`, `itinerary-reviewer`, and `plan-editor`.
- Runtime injection reads only validated `SKILL.md`; never execute scripts, install package dependencies, enable ambient Pi Skills, or grant additional tools.
- ZIP limits are 100 regular files, 10 MiB total uncompressed data, and 256 KiB for `SKILL.md`.
- Git accepts only HTTPS URLs. Private credentials come only from `YOUBAN_SKILL_GIT_TOKEN` and are sent only when the host exactly matches `YOUBAN_SKILL_GIT_TOKEN_HOST`.
- Git updates are manual and candidate-only. Persist the exact resolved commit SHA.
- Admin navigation keeps `Skills` visible at every viewport; it must not move behind an overflow or hamburger menu.
- Browser interaction and visual acceptance use browser-use only, reuse an existing target tab when available, and close only tabs opened by this task.
- Do not modify the legacy Python backend, deployment configuration, or production data.

---

### Task 1: Add Skill Catalog Schema And Repository

**Files:**
- Modify: `backend-ts/src/domain/db-schema.ts`
- Modify: `backend-ts/src/domain/database.ts`
- Create: `backend-ts/src/agents/skill-types.ts`
- Create: `backend-ts/src/agents/skill-repository.ts`
- Create: `backend-ts/tests/skill-repository.test.ts`
- Modify: `backend-ts/tests/task-store.test.ts`

**Interfaces:**
- Produces: `SkillAgentId`, `ManagedSkill`, `SkillVersion`, `SkillAssignment`, `SkillCatalogSnapshot`, and `SkillCatalogRepository`.
- Produces: schema version 2 with `managed_skills`, `skill_versions`, `skill_agent_assignments`, and `skill_audit_events`.
- Consumed by: Tasks 2, 5, 6, and 8.

- [ ] **Step 1: Write migration and repository failure tests**

Create tests that open a version-1 database containing an existing task, reopen it through `YoubanDatabase`, and assert that the task survives while all four Skill tables appear. Add repository tests for unique normalized names, one candidate per Skill, assignment deduplication, and transaction rollback.

```ts
it("migrates a version-one database without losing tasks", () => {
  const database = new Database(path);
  database.exec(INITIAL_SCHEMA_SQL);
  database.exec("PRAGMA user_version = 1");
  database.query("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("t1", "t1", "u1", "completed", "", now, now, payload);
  database.close();

  const migrated = new YoubanDatabase(path);
  expect(migrated.raw.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
  expect(migrated.raw.query("SELECT task_id FROM tasks").get()).toEqual({ task_id: "t1" });
  expect(migrated.raw.query("SELECT name FROM sqlite_master WHERE name = 'managed_skills'").get())
    .toBeDefined();
});

it("replaces only the unactivated candidate", () => {
  const skill = repository.createCustomSkill(candidate("museum-guide", "first"));
  repository.saveCandidate(skill.id, candidate("museum-guide", "second"));
  expect(repository.get(skill.id)?.candidateVersion?.content).toContain("second");
  expect(repository.get(skill.id)?.versions.filter((item) => item.state === "candidate"))
    .toHaveLength(1);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd backend-ts
bun test tests/skill-repository.test.ts tests/task-store.test.ts
```

Expected: FAIL because schema version 2, Skill tables, types, and repository do not exist.

- [ ] **Step 3: Define stable catalog types**

Create `skill-types.ts` with these exact public shapes:

```ts
export const SKILL_AGENT_IDS = [
  "parent-assistant",
  "destination-researcher",
  "segment-planner",
  "summary",
  "itinerary-reviewer",
  "plan-editor",
] as const;
export type SkillAgentId = (typeof SKILL_AGENT_IDS)[number];
export type SkillKind = "builtin" | "custom";
export type SkillSource = "builtin" | "upload" | "git";
export type SkillVersionState = "candidate" | "active" | "superseded" | "archived";

export interface SkillPrompt {
  id: string;
  name: string;
  content: string;
  versionId: string;
}

export interface SkillCatalogSnapshot {
  generation: number;
  assignments: Readonly<Record<SkillAgentId, readonly SkillPrompt[]>>;
}

export interface SkillConfigurationInput {
  enabled: boolean;
  agentIds: readonly SkillAgentId[];
}

export interface CandidateWrite {
  content: string;
  description: string;
  sha256: string;
  packageRelativePath: string;
  sourceCommit?: string;
}

export interface ReconciledBuiltinSkill extends CandidateWrite {
  name: string;
  defaultAgentIds: readonly SkillAgentId[];
}

export interface SkillVersion {
  id: string;
  skillId: string;
  versionNumber: number;
  state: SkillVersionState;
  content: string;
  name: string;
  description: string;
  sha256: string;
  packageRelativePath: string;
  sourceCommit?: string;
  createdAt: string;
  activatedAt?: string;
}

export interface SkillAssignment {
  skillId: string;
  agentId: SkillAgentId;
}

export interface SkillAuditEvent {
  id: string;
  operation: string;
  skillId: string;
  versionId?: string;
  sanitizedSource?: string;
  result: "success" | "failure";
  errorCode?: string;
  createdAt: string;
}

export interface ManagedSkill {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  source: SkillSource;
  enabled: boolean;
  agentIds: readonly SkillAgentId[];
  activeVersion?: SkillVersion;
  candidateVersion?: SkillVersion;
  versions: readonly SkillVersion[];
  repositoryUrl?: string;
  sourceRef?: string;
  sourceSubdirectory?: string;
  generation: number;
  archivedAt?: string;
}

export type ManagedSkillSummary = Omit<
  ManagedSkill,
  "activeVersion" | "candidateVersion" | "versions"
> & {
  activeVersionId?: string;
  candidateVersionId?: string;
};
export type ManagedSkillDetail = ManagedSkill;

export interface NewSkillAuditEvent {
  operation: string;
  skillId: string;
  versionId?: string;
  sanitizedSource?: string;
  result: "success" | "failure";
  errorCode?: string;
}
```

Database row adapters remain internal and map snake_case columns into these detached camelCase values.

- [ ] **Step 4: Implement ordered database migrations**

Change `CURRENT_SCHEMA_VERSION` to `2`, add Drizzle tables and indexes, and replace the one-shot `migrate()` branch with ordered migration functions. Version 1 creates the existing tables; version 2 creates the Skill tables without rebuilding or deleting existing data.

Use text ids and timestamps, integer booleans, a composite primary key on `(skill_id, agent_id)`, unique indexes for Skill name and version number, and foreign keys with cascading child deletion only for custom metadata cleanup.

- [ ] **Step 5: Implement `SkillCatalogRepository`**

The repository receives an existing `YoubanDatabase` and exposes synchronous transaction-safe methods:

```ts
export class SkillCatalogRepository {
  list(options?: { archived?: boolean }): ManagedSkill[];
  get(skillId: string): ManagedSkill | undefined;
  getByName(name: string): ManagedSkill | undefined;
  reconcileBuiltin(input: ReconciledBuiltinSkill): ManagedSkill;
  createCustomSkill(input: CandidateWrite): ManagedSkill;
  saveCandidate(skillId: string, input: CandidateWrite): ManagedSkill;
  activate(skillId: string, input: SkillConfigurationInput): ManagedSkill;
  configure(skillId: string, input: SkillConfigurationInput): ManagedSkill;
  archive(skillId: string): ManagedSkill;
  restore(skillId: string): ManagedSkill;
  snapshot(): SkillCatalogSnapshot;
  appendAudit(event: NewSkillAuditEvent): void;
}
```

Keep built-in restrictions out of this low-level repository; Task 5 enforces product rules in the service. Every returned object is detached from mutable database rows.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
cd backend-ts
bun test tests/skill-repository.test.ts tests/task-store.test.ts
bun run typecheck
```

Expected: PASS; the old task survives migration and repository rollback tests leave no partial Skill rows.

- [ ] **Step 7: Commit**

```bash
git add backend-ts/src/domain/db-schema.ts backend-ts/src/domain/database.ts \
  backend-ts/src/agents/skill-types.ts backend-ts/src/agents/skill-repository.ts \
  backend-ts/tests/skill-repository.test.ts backend-ts/tests/task-store.test.ts
git commit -m "feat(backend-ts): persist managed skill catalog"
```

---

### Task 2: Validate Skill Documents And Reconcile Built-ins

**Files:**
- Modify: `backend-ts/package.json`
- Modify: `backend-ts/bun.lock`
- Create: `backend-ts/src/agents/skill-document.ts`
- Modify: `backend-ts/src/agents/skill-registry.ts`
- Modify: `backend-ts/tests/skill-registry.test.ts`
- Create: `backend-ts/tests/skill-document.test.ts`

**Interfaces:**
- Consumes: `SkillCatalogRepository` and `SkillCatalogSnapshot` from Task 1.
- Produces: `validateSkillDocument(content, expectedName?)`, `loadBuiltinSkillDefinitions()`, `renderAssignedSkills(snapshot, agentId)`, and `reconcileBuiltinSkills(repository)`.
- Consumed by: Tasks 3, 4, 5, and 6.

- [ ] **Step 1: Add failing document and reconciliation tests**

Cover valid UTF-8 content, missing frontmatter, malformed YAML, invalid names, name mismatch, blank/oversized descriptions, 256 KiB file rejection, repository containment, and preserved built-in defaults.

```ts
it("rejects a frontmatter name that differs from the installed name", () => {
  expect(() => validateSkillDocument(skill("other-name"), "museum-guide"))
    .toThrowError(expect.objectContaining({ code: "skill_name_mismatch" }));
});

it("reconciles four built-ins without replacing admin assignments", () => {
  reconcileBuiltinSkills(repository);
  repository.configure(idFor("trip-planning"), {
    enabled: true,
    agentIds: ["segment-planner"],
  });
  reconcileBuiltinSkills(repository);
  expect(repository.get(idFor("trip-planning"))?.agentIds).toEqual(["segment-planner"]);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd backend-ts
bun test tests/skill-document.test.ts tests/skill-registry.test.ts
```

Expected: FAIL because structured document validation and persisted built-in reconciliation do not exist.

- [ ] **Step 3: Add the direct YAML dependency**

```bash
cd backend-ts
bun add yaml@2.9.0
```

Use the parser's safe document API. Reject aliases, custom tags, non-string `name`/`description`, and extra YAML documents. Do not rely on a transitive copy of `yaml` from Pi packages.

- [ ] **Step 4: Implement document validation and error codes**

Create:

```ts
export class SkillValidationError extends Error {
  constructor(public readonly code: SkillValidationErrorCode, message: string) {
    super(message);
  }
}

export type SkillValidationErrorCode =
  | "invalid_skill_encoding"
  | "invalid_skill_frontmatter"
  | "invalid_skill_name"
  | "skill_name_mismatch"
  | "invalid_skill_description"
  | "skill_document_too_large";

export interface ValidatedSkillDocument {
  name: string;
  description: string;
  content: string;
  sha256: string;
}

export function validateSkillDocument(
  content: string,
  expectedName?: string,
): ValidatedSkillDocument;
```

Normalize line endings only for hashing and persisted content. The name regex is `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, description is 1-500 Unicode characters after trimming, and content is at most 262,144 UTF-8 bytes.

- [ ] **Step 5: Convert the fixed registry into built-in definitions plus snapshot rendering**

Keep `APPROVED_SKILL_NAMES` as the built-in compatibility constant, but stop using it as the complete runtime type. Export default assignments keyed by all six agent ids, reconcile repository versions by content hash, and render prompts from a snapshot:

```ts
export function renderAssignedSkills(
  snapshot: SkillCatalogSnapshot,
  agentId: SkillAgentId,
): string {
  const blocks = snapshot.assignments[agentId].map(
    (skill) => `<skill name="${skill.name}">\n${skill.content.trim()}\n</skill>`,
  );
  return blocks.length
    ? `Follow these server-approved skills when relevant:\n\n${blocks.join("\n\n")}`
    : "";
}
```

- [ ] **Step 6: Run focused tests and typecheck**

```bash
cd backend-ts
bun test tests/skill-document.test.ts tests/skill-registry.test.ts
bun run typecheck
```

Expected: PASS; built-ins remain contained, repository-owned, and assigned exactly as before.

- [ ] **Step 7: Commit**

```bash
git add backend-ts/package.json backend-ts/bun.lock \
  backend-ts/src/agents/skill-document.ts backend-ts/src/agents/skill-registry.ts \
  backend-ts/tests/skill-document.test.ts backend-ts/tests/skill-registry.test.ts
git commit -m "feat(backend-ts): validate managed skill documents"
```

---

### Task 3: Stage ZIP Skill Packages Safely

**Files:**
- Modify: `backend-ts/package.json`
- Modify: `backend-ts/bun.lock`
- Create: `backend-ts/src/agents/skill-package-store.ts`
- Create: `backend-ts/src/agents/skill-zip-importer.ts`
- Create: `backend-ts/tests/helpers/zip-fixture.ts`
- Create: `backend-ts/tests/skill-zip-importer.test.ts`

**Interfaces:**
- Consumes: `ValidatedSkillDocument` and `validateSkillDocument()` from Task 2.
- Produces: `StagedSkillPackage`, `SkillPackageStore`, and `ZipSkillImporter.stage(bytes)`.
- Consumed by: Task 5.

- [ ] **Step 1: Add ZIP dependencies and malicious fixture builder**

```bash
cd backend-ts
bun add yauzl@3.3.1
bun add --dev @types/yauzl@3.4.0 yazl@3.3.1 @types/yazl@3.3.1
```

Create a test helper that emits regular entries with controlled paths, sizes, duplicate normalized names, encrypted flags, and Unix mode bits. Do not invoke a system `zip` or `unzip` binary in tests.

- [ ] **Step 2: Write failing archive safety tests**

```ts
it.each([
  ["parent traversal", [{ name: "../escape/SKILL.md", content: validSkill }]],
  ["absolute path", [{ name: "/tmp/SKILL.md", content: validSkill }]],
  ["symlink", [{ name: "skill/SKILL.md", content: "target", mode: 0o120777 }]],
])("rejects %s without writing outside staging", async (_label, entries) => {
  const archive = await createZipFixture(entries);
  await expect(importer.stage(archive)).rejects.toMatchObject({ code: "invalid_zip_entry" });
  expect(readdirSync(outsideRoot)).toEqual([]);
});

it("accepts one root folder and returns an inert staged package", async () => {
  const staged = await importer.stage(await createZipFixture([
    { name: "museum-guide/SKILL.md", content: validSkill },
    { name: "museum-guide/scripts/run.sh", content: "exit 99" },
  ]));
  expect(staged.document.name).toBe("museum-guide");
  expect(staged.files).toContain("scripts/run.sh");
  expect(statSync(join(staged.stagingDir, "scripts/run.sh")).mode & 0o111).toBe(0);
});
```

Also cover 101 files, more than 10 MiB uncompressed data, a 256 KiB-plus `SKILL.md`, encrypted entries, duplicate normalized paths, non-regular Unix types, invalid UTF-8, zero/multiple `SKILL.md` files, and cleanup after stream errors.

- [ ] **Step 3: Run tests and verify RED**

```bash
cd backend-ts
bun test tests/skill-zip-importer.test.ts
```

Expected: FAIL because the package store and ZIP importer do not exist.

- [ ] **Step 4: Implement the contained package store**

`SkillPackageStore` owns `staging`, `packages`, and `archive` roots. It creates staging directories with generated ids, resolves every target through a shared containment guard, writes regular files with mode `0o600` or directories with `0o700`, and exposes synchronous rename/compensation methods used inside Task 5's repository transaction.

```ts
export interface StagedSkillPackage {
  stagingDir: string;
  document: ValidatedSkillDocument;
  files: readonly string[];
  source: "upload" | "git";
  sanitizedSource?: string;
  sourceRef?: string;
  sourceCommit?: string;
  cleanup(): void;
}
```

- [ ] **Step 5: Implement lazy, bounded ZIP iteration**

Open from a buffer with `lazyEntries`, `validateEntrySizes`, and strict filenames. Before reading a stream, validate the path, flags, external Unix type bits, entry count, declared size, and cumulative size. Read one entry at a time and stop immediately on a violated limit. Normalize the optional single containing directory away before writing staging files.

Treat ZIP hard-link encodings or any non-regular/non-directory Unix type as invalid. A producer that encodes a hard link as ordinary bytes is extracted as a separate regular file, so no filesystem link is created.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
cd backend-ts
bun test tests/skill-zip-importer.test.ts tests/skill-document.test.ts
bun run typecheck
```

Expected: PASS with no file created outside the task-owned temporary root.

- [ ] **Step 7: Commit**

```bash
git add backend-ts/package.json backend-ts/bun.lock \
  backend-ts/src/agents/skill-package-store.ts backend-ts/src/agents/skill-zip-importer.ts \
  backend-ts/tests/helpers/zip-fixture.ts backend-ts/tests/skill-zip-importer.test.ts
git commit -m "feat(backend-ts): stage validated skill zip packages"
```

---

### Task 4: Stage HTTPS Git Skill Packages

**Files:**
- Create: `backend-ts/src/agents/skill-git-importer.ts`
- Create: `backend-ts/tests/helpers/fake-git.ts`
- Create: `backend-ts/tests/skill-git-importer.test.ts`
- Modify: `backend-ts/tests/timings.json`

**Interfaces:**
- Consumes: `SkillPackageStore`, `StagedSkillPackage`, and `validateSkillDocument()`.
- Produces: `GitRunner`, `BunGitRunner`, `GitSkillImporter.stage(request)`, and `GitSkillImporter.resolveRemote(request)`.
- Consumed by: Task 5 and the browser fixture in Task 12.

- [ ] **Step 1: Write failing source, credential, and timeout tests**

Inject a fake runner that records executable arguments and environment keys but never records secret values in assertion messages.

```ts
it.each(["git@github.com:org/repo.git", "ssh://host/repo", "file:///tmp/repo", "../repo"])(
  "rejects non-HTTPS source %s",
  async (repositoryUrl) => {
    await expect(importer.stage({ repositoryUrl })).rejects.toMatchObject({ code: "invalid_git_url" });
  },
);

it("sends the private token only to the configured exact host", async () => {
  process.env.YOUBAN_SKILL_GIT_TOKEN = "private-secret";
  process.env.YOUBAN_SKILL_GIT_TOKEN_HOST = "git.example.com";
  await importer.stage({ repositoryUrl: "https://public.example.com/org/repo.git" });
  expect(fake.lastInvocation?.env.GIT_CONFIG_VALUE_0).toBeUndefined();
  expect(JSON.stringify(fake.invocations)).not.toContain("private-secret");
});
```

Cover URL user information, case-normalized exact host matching, redirect rejection, missing Git executable, clone timeout with child termination, invalid subdirectory containment, requested ref, resolved 40/64-character commit SHA, unchanged remote SHA, stderr redaction, and staging cleanup.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd backend-ts
bun test tests/skill-git-importer.test.ts
```

Expected: FAIL because Git acquisition interfaces do not exist.

- [ ] **Step 3: Implement the injectable runner**

```ts
export interface GitInvocation {
  args: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  run(invocation: GitInvocation): Promise<GitResult>;
}

export interface GitSkillInstallRequest {
  repositoryUrl: string;
  ref?: string;
  subdirectory?: string;
}
```

`BunGitRunner` uses `Bun.spawn`, bounded stdout/stderr, a timer that terminates the child, and a sanitized error mapper. Use `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0=http.extraHeader`, and `GIT_CONFIG_VALUE_0=Authorization: Bearer ...` only for the configured host, never `-c` command arguments.

- [ ] **Step 4: Implement Git staging and update resolution**

Clone with `--depth=1 --filter=blob:none --no-tags`, add `--branch` only for a branch or tag request, and fetch a requested commit explicitly when required. Resolve `HEAD` with `git rev-parse HEAD`, validate the optional Skill subdirectory beneath the clone, copy inert regular files into a package-store staging directory, and remove `.git` before returning.

`resolveRemote()` returns only `{ commit, changed }`; it does not create a candidate when the commit equals the active or candidate source commit.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
cd backend-ts
bun test tests/skill-git-importer.test.ts
bun run typecheck
```

Expected: PASS; no assertion output, serialized result, or child argument contains the test secret.

- [ ] **Step 6: Update timing metadata intentionally and commit**

Run the focused timing update once because this adds a new subprocess test file:

```bash
cd backend-ts
bun test tests/skill-git-importer.test.ts --timings=tests/timings.json --update-timings
cd ..
git add backend-ts/src/agents/skill-git-importer.ts backend-ts/tests/helpers/fake-git.ts \
  backend-ts/tests/skill-git-importer.test.ts backend-ts/tests/timings.json
git commit -m "feat(backend-ts): stage skills from secure git sources"
```

---

### Task 5: Implement Skill Lifecycle, Audit, And Catalog Events

**Files:**
- Create: `backend-ts/src/agents/skill-management-service.ts`
- Create: `backend-ts/tests/skill-management-service.test.ts`
- Modify: `backend-ts/src/agents/skill-repository.ts`
- Modify: `backend-ts/src/agents/skill-package-store.ts`

**Interfaces:**
- Consumes: repository, validator, package store, ZIP importer, and Git importer.
- Produces: `SkillManagementService` and `SkillCatalogProvider` used by runtime and HTTP tasks.

- [ ] **Step 1: Write failing lifecycle and compensation tests**

Cover initial disabled candidate creation, same-name conflicts, online candidate replacement, active version preservation, activation, enable/assignment changes, built-in restrictions, archive precondition, archive/restore, Git unchanged response, audit redaction, listener generation, filesystem rename failure, and database rollback compensation.

```ts
it("keeps the active version while an edit waits for review", async () => {
  const installed = await service.stageUpload({ filename: "museum.zip", bytes });
  await service.activate(installed.id, {
    enabled: true,
    agentIds: ["segment-planner"],
  });
  const active = service.get(installed.id).activeVersion?.id;
  await service.saveCandidate(installed.id, editedSkillMarkdown);
  expect(service.get(installed.id).activeVersion?.id).toBe(active);
  expect(service.snapshot().assignments["segment-planner"][0]?.content)
    .not.toContain("edited marker");
});

it("compensates the package rename when the candidate transaction fails", async () => {
  const failingRepository = new class extends SkillCatalogRepository {
    override createCustomSkill(_input: CandidateWrite): never {
      throw new Error("forced database failure");
    }
  }(database);
  const failingService = createService({ repository: failingRepository });
  await expect(failingService.stageUpload({ filename: "museum.zip", bytes })).rejects.toThrow();
  expect(packageStore.listFinalPackages()).toEqual([]);
  expect(repository.getByName("museum-guide")).toBeUndefined();
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd backend-ts
bun test tests/skill-management-service.test.ts
```

Expected: FAIL because no orchestration service or catalog event contract exists.

- [ ] **Step 3: Implement the service contract**

```ts
export interface SkillCatalogProvider {
  snapshot(): SkillCatalogSnapshot;
  subscribe(listener: (snapshot: SkillCatalogSnapshot) => void): () => void;
}

export interface SkillManagementServiceOptions {
  databasePath: string;
  dataDir: string;
  builtinSkillsDir: string;
  repository?: SkillCatalogRepository;
  packageStore?: SkillPackageStore;
  zipImporter?: SkillZipImporter;
  gitImporter?: GitSkillImporter;
  now?: () => Date;
}

export class SkillManagementService implements SkillCatalogProvider {
  constructor(options: SkillManagementServiceOptions);
  list(options?: { archived?: boolean }): ManagedSkillSummary[];
  get(skillId: string): ManagedSkillDetail;
  stageUpload(input: { filename: string; bytes: Uint8Array }): Promise<ManagedSkillDetail>;
  stageGit(input: GitSkillInstallRequest): Promise<ManagedSkillDetail>;
  checkGitUpdate(skillId: string): Promise<{ changed: boolean; skill: ManagedSkillDetail }>;
  saveCandidate(skillId: string, content: string): Promise<ManagedSkillDetail>;
  activate(skillId: string, input: SkillConfigurationInput): ManagedSkillDetail;
  configure(skillId: string, input: SkillConfigurationInput): ManagedSkillDetail;
  archive(skillId: string): ManagedSkillDetail;
  restore(skillId: string): ManagedSkillDetail;
  snapshot(): SkillCatalogSnapshot;
  subscribe(listener: (snapshot: SkillCatalogSnapshot) => void): () => void;
  close(): void;
}
```

Production creates omitted dependencies from `databasePath` and `dataDir`; tests may inject the repository, package store, or importers. Reconcile built-ins in the constructor before producing the first snapshot.

- [ ] **Step 4: Implement atomic candidate, activation, and archive behavior**

Use synchronous `renameSync` inside the repository transaction boundary. If a database write throws, rename the package back to staging before propagating. Do not increment generation for candidate-only changes. Increment and publish exactly once after activation, configuration, archive, restore, or built-in deployment reconciliation changes runtime content.

Sanitize every audit source and error code. Store the Git URL without query, fragment, user information, or credential-derived headers.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
cd backend-ts
bun test tests/skill-management-service.test.ts tests/skill-repository.test.ts \
  tests/skill-zip-importer.test.ts tests/skill-git-importer.test.ts
bun run typecheck
```

Expected: PASS; candidate failures preserve active prompts and every published snapshot is immutable.

- [ ] **Step 6: Commit**

```bash
git add backend-ts/src/agents/skill-management-service.ts \
  backend-ts/src/agents/skill-repository.ts backend-ts/src/agents/skill-package-store.ts \
  backend-ts/tests/skill-management-service.test.ts
git commit -m "feat(backend-ts): manage skill lifecycle and audit"
```

---

### Task 6: Inject Catalog Snapshots Into Parent And Subagent Prompts

**Files:**
- Modify: `backend-ts/src/agents/subagent-definitions.ts`
- Modify: `backend-ts/src/agents/session-host.ts`
- Modify: `backend-ts/tests/subagent-definitions.test.ts`
- Modify: `backend-ts/tests/session-host.test.ts`
- Modify: `backend-ts/tests/persistent-parent-agent.test.ts`

**Interfaces:**
- Consumes: `SkillCatalogSnapshot`, `SkillAgentId`, and `renderAssignedSkills()`.
- Produces: `createYoubanSubagentDefinitions(snapshot)` and snapshot-pinned `createYoubanAgentSession()`.
- Consumed by: Task 7.

- [ ] **Step 1: Write failing prompt assignment tests**

```ts
it("renders only enabled content assigned to each subagent", () => {
  const definitions = createYoubanSubagentDefinitions(snapshot({
    "segment-planner": [prompt("segment-only")],
    "summary": [prompt("summary-only")],
  }));
  expect(definition(definitions, "segment-planner").systemPrompt).toContain("segment-only");
  expect(definition(definitions, "segment-planner").systemPrompt).not.toContain("summary-only");
});

it("pins the parent and children to one catalog generation", async () => {
  const host = await createYoubanAgentSession({ ...options, skillSnapshot: generationOne });
  catalog.publish(generationTwo);
  expect(host.generation).toBe(generationOne.generation);
  expect(host.session.systemPrompt).toContain("generation-one-marker");
});
```

Retain assertions that ambient Skills and read/bash/edit/write tools stay disabled.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd backend-ts
bun test tests/subagent-definitions.test.ts tests/session-host.test.ts \
  tests/persistent-parent-agent.test.ts
```

Expected: FAIL because definitions and session hosts still read the compile-time fixed registry.

- [ ] **Step 3: Replace module-load definitions with a factory**

`createYoubanSubagentDefinitions(snapshot)` creates the same five definitions and capability ceilings, but calls `renderAssignedSkills(snapshot, agentId)` for each target. Export `YOUBAN_SUBAGENT_NAMES` separately as a stable constant.

- [ ] **Step 4: Pin one snapshot in `createYoubanAgentSession`**

Replace `skillNames` with `skillSnapshot`. Add `generation` to `YoubanAgentSessionHost`. Parent appended system prompt uses `parent-assistant`; the extension factory registers subagent definitions produced from the same snapshot.

Tests that do not construct a persisted service use a deterministic built-in snapshot fixture, not ambient filesystem discovery.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
cd backend-ts
bun test tests/subagent-definitions.test.ts tests/session-host.test.ts \
  tests/persistent-parent-agent.test.ts
bun run typecheck
```

Expected: PASS; exact assignment isolation and existing no-tool boundaries are proven.

- [ ] **Step 6: Commit**

```bash
git add backend-ts/src/agents/subagent-definitions.ts backend-ts/src/agents/session-host.ts \
  backend-ts/tests/subagent-definitions.test.ts backend-ts/tests/session-host.test.ts \
  backend-ts/tests/persistent-parent-agent.test.ts
git commit -m "feat(backend-ts): inject versioned skill snapshots"
```

---

### Task 7: Rotate Stale Runtime Hosts Without Interrupting Work

**Files:**
- Modify: `backend-ts/src/agents/persistent-parent-agent.ts`
- Modify: `backend-ts/src/agents/pi-subagent-runner.ts`
- Modify: `backend-ts/src/agents/default-parent-agent.ts`
- Modify: `backend-ts/src/agents/default-trip-planner.ts`
- Modify: `backend-ts/src/agents/default-trip-chat-service.ts`
- Create: `backend-ts/src/agents/skill-runtime-diagnostics.ts`
- Modify: `backend-ts/tests/persistent-parent-agent.test.ts`
- Modify: `backend-ts/tests/pi-subagent-runner.test.ts`
- Modify: `backend-ts/tests/default-trip-planner.test.ts`
- Create: `backend-ts/tests/skill-runtime-diagnostics.test.ts`

**Interfaces:**
- Consumes: `SkillCatalogProvider` and snapshot-pinned session hosts.
- Produces: generation-aware parent sessions and `PiSubagentRunner` hosts.
- Consumed by: Task 8 runtime wiring.

- [ ] **Step 1: Write failing idle, busy, and concurrent rotation tests**

Use controlled host promises and disposal counters.

```ts
it("lets busy work finish, then recreates the scope at the new generation", async () => {
  const first = parent.complete({ scope, prompt: "hold" });
  await started;
  catalog.publish(snapshot(2));
  const second = parent.complete({ scope, prompt: "after activation" });
  releaseFirst();
  await expect(first).resolves.toBe("old");
  await expect(second).resolves.toBe("new");
  expect(createdGenerations).toEqual([1, 2]);
  expect(disposedGenerations).toEqual([1]);
});

it("does not break same-generation parallel subagent runs", async () => {
  await Promise.all([runner.run(request("a")), runner.run(request("b"))]);
  expect(host.maxActive).toBe(2);
  expect(createdGenerations).toEqual([1]);
});
```

Also test idle rotation before reuse, failed new-host creation retry, `close()` during a pending rotation, preserved parent transcript `sessionDir`, and sanitized rotation diagnostics that contain component/generation/error-code but no local path, prompt text, or credential.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd backend-ts
bun test tests/persistent-parent-agent.test.ts tests/pi-subagent-runner.test.ts \
  tests/default-trip-planner.test.ts
```

Expected: FAIL because runtime hosts do not observe catalog generation.

- [ ] **Step 3: Implement parent-session stale rotation**

Store `generation` on each `ParentSessionEntry`. After the current serialized tail finishes but before the next operation starts, compare `skillCatalog.snapshot().generation`. If stale, dispose the old host, recreate it with the same persisted `sessionDir`, replace the pending session, and only then run the queued operation. A failed recreation removes the entry so the following call retries.

- [ ] **Step 4: Implement structured-host rotation gate**

Track active runs and host generation in `PiSubagentRunner`. Same-generation runs remain concurrent. When the catalog changes, new runs wait for old-generation active runs to reach zero, dispose that host once, create the new-generation host once, and then resume concurrently. Cancellation while waiting must reject without creating or delegating work.

- [ ] **Step 5: Thread the catalog provider through default factories**

Add `skillCatalog` to default parent, planner, and chat service options and pass it to every parent and structured runner. Keep explicit test doubles optional.

- [ ] **Step 6: Record bounded runtime diagnostics**

Create `SkillRuntimeDiagnostics` with `recordFailure(component, generation, errorCode)`, `recordSuccess(component, generation)`, and `snapshot()`. Keep only the latest status per component, never persist exception messages, and expose no prompt content or path. Parent and structured runners record failed/successful rotations through this shared instance.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
cd backend-ts
bun test tests/persistent-parent-agent.test.ts tests/pi-subagent-runner.test.ts \
  tests/default-trip-planner.test.ts tests/session-host.test.ts \
  tests/skill-runtime-diagnostics.test.ts
bun run typecheck
```

Expected: PASS; busy work returns old-generation results, later work receives the new generation, and concurrency remains intact.

- [ ] **Step 8: Commit**

```bash
git add backend-ts/src/agents/persistent-parent-agent.ts backend-ts/src/agents/pi-subagent-runner.ts \
  backend-ts/src/agents/default-parent-agent.ts backend-ts/src/agents/default-trip-planner.ts \
  backend-ts/src/agents/default-trip-chat-service.ts \
  backend-ts/src/agents/skill-runtime-diagnostics.ts \
  backend-ts/tests/persistent-parent-agent.test.ts \
  backend-ts/tests/pi-subagent-runner.test.ts backend-ts/tests/default-trip-planner.test.ts \
  backend-ts/tests/skill-runtime-diagnostics.test.ts
git commit -m "feat(backend-ts): rotate stale skill runtime hosts"
```

---

### Task 8: Expose Authenticated Admin Skill APIs

**Files:**
- Create: `backend-ts/src/http/admin-skills.ts`
- Modify: `backend-ts/src/http/app.ts`
- Create: `backend-ts/tests/admin-skills-http.test.ts`
- Modify: `backend-ts/tests/admin-http.test.ts`
- Modify: `backend-ts/tests/http-contract.test.ts`

**Interfaces:**
- Consumes: `SkillManagementService` and its detail/summary shapes.
- Produces: the ten Admin endpoints in the design spec and `HttpRuntime.skills` for tests/lifecycle shutdown.
- Consumed by: frontend Task 9.

- [ ] **Step 1: Write failing HTTP contract tests**

Cover authentication on every route, list/detail DTOs, multipart upload, Git request, update check, candidate edit, activation, configuration, archive, restore, status mapping, built-in restrictions, secret/path redaction, credential-availability flags, and sanitized Skill runtime health diagnostics.

```ts
it("stages a ZIP as a disabled candidate and activates it explicitly", async () => {
  const upload = new FormData();
  upload.set("file", new File([bytes], "museum-guide.zip", { type: "application/zip" }));
  const staged = await callMultipart("POST", "/api/admin/skills/upload", upload, ADMIN);
  expect(staged.status).toBe(201);
  const stagedBody = await staged.json() as { skill: { id: string } };
  expect(stagedBody).toEqual(expect.objectContaining({
    skill: expect.objectContaining({ enabled: false, state: "candidate" }),
  }));

  const id = stagedBody.skill.id;
  const activated = await call("POST", `/api/admin/skills/${id}/activate`, {
    enabled: true,
    agent_ids: ["segment-planner"],
  }, ADMIN);
  expect(activated.status).toBe(200);
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd backend-ts
bun test tests/admin-skills-http.test.ts tests/admin-http.test.ts tests/http-contract.test.ts
```

Expected: FAIL with 404 for Skill routes and missing `runtime.skills`.

- [ ] **Step 3: Build a focused Elysia plugin**

Export `createAdminSkillRoutes({ skills, authorize })`. Define TypeBox bodies for Git install, candidate editing, activation, and configuration. Normalize output to snake_case at the HTTP boundary. Use stable error codes and these statuses:

- `401` invalid Admin token.
- `404` missing Skill.
- `409` name/version conflict, active-before-archive, or built-in restriction.
- `413` archive size/count limits.
- `422` invalid document, archive, source, assignment, or ref.
- `503` Git unavailable.
- `504` Git timeout.

`GET /api/admin/skills` returns `{ items, capabilities }`, where capabilities contains only `git_available` and `private_git_credentials_available` booleans. Extend `/api/trip/health` with `{ skills: { catalog_generation, runtime_components } }` from `SkillRuntimeDiagnostics`; never include raw exception messages.

- [ ] **Step 4: Wire service and runtime lifecycle**

Create `SkillManagementService` before parent/planner/chat factories. Pass it as `skillCatalog`, mount the plugin, expose `skills` on `HttpRuntime`, and close it after active service calls have drained. Add optional `skillService` injection to `HttpRuntimeOptions` for deterministic HTTP and browser fixtures.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
cd backend-ts
bun test tests/admin-skills-http.test.ts tests/admin-http.test.ts tests/http-contract.test.ts \
  tests/server-lifecycle.test.ts
bun run typecheck
```

Expected: PASS; all routes enforce the live password file and all runtime resources close once.

- [ ] **Step 6: Commit**

```bash
git add backend-ts/src/http/admin-skills.ts backend-ts/src/http/app.ts \
  backend-ts/tests/admin-skills-http.test.ts backend-ts/tests/admin-http.test.ts \
  backend-ts/tests/http-contract.test.ts
git commit -m "feat(backend-ts): expose admin skill management api"
```

---

### Task 9: Add Frontend Skill DTOs, API Client, And Pure State Helpers

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/admin/skill-management.ts`
- Create: `frontend/src/admin/skill-management.test.ts`

**Interfaces:**
- Consumes: snake_case DTOs from Task 8.
- Produces: `AdminSkillSummary`, `AdminSkillDetail`, `AdminSkillVersion`, `AdminSkillAgentId`, `AdminSkillCapabilities`, Admin API calls, filter helpers, and display-state helpers.
- Consumed by: Tasks 10 and 11.

- [ ] **Step 1: Write failing pure helper tests**

```ts
it("filters by query, source, and state without hiding candidates", () => {
  expect(filterAdminSkills(skills, {
    query: "museum",
    source: "git",
    state: "candidate",
  }).map((skill) => skill.name)).toEqual(["museum-guide"]);
});

it("preserves assignments while globally disabled", () => {
  expect(toSkillConfiguration(skill, false)).toEqual({
    enabled: false,
    agent_ids: ["segment-planner", "itinerary-reviewer"],
  });
});
```

Also cover built-in/custom capabilities, source labels, active/candidate/disabled/archived badges, version ordering, immutable arrays, and API error-code normalization.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd frontend
bun test src/admin/skill-management.test.ts
```

Expected: FAIL because types and helpers do not exist.

- [ ] **Step 3: Add exact frontend DTOs and pure helpers**

Define the six-agent union, summary/detail/version/source/state types, capability booleans, and request bodies using the API's snake_case field names. Keep display copy outside helpers by returning semantic keys such as `candidate`, `enabled`, `disabled`, and `archived`.

- [ ] **Step 4: Add Admin API methods**

Add:

```ts
adminListSkills(filters)
adminGetSkill(skillId)
adminUploadSkill(file)
adminInstallGitSkill(input)
adminCheckSkillUpdate(skillId)
adminSaveSkillCandidate(skillId, content)
adminActivateSkill(skillId, configuration)
adminConfigureSkill(skillId, configuration)
adminArchiveSkill(skillId)
adminRestoreSkill(skillId)
```

Use `FormData` for upload and the existing Admin token interceptor. Extend `toAdminError` with `status` and backend `code` while preserving `unauthorized` behavior.

- [ ] **Step 5: Run tests and typecheck through the build command**

```bash
cd frontend
bun test src/admin/skill-management.test.ts
bunx vue-tsc --noEmit
```

Expected: PASS with no component code required yet.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts \
  frontend/src/admin/skill-management.ts frontend/src/admin/skill-management.test.ts
git commit -m "feat(frontend): add admin skill management client"
```

---

### Task 10: Refactor Admin Into A Persistent Navigation Shell

**Files:**
- Modify: `frontend/src/views/AdminView.vue`
- Create: `frontend/src/components/admin/AdminNavigation.vue`
- Create: `frontend/src/components/admin/AdminRuntimeSettingsPanel.vue`
- Create: `frontend/src/components/admin/AdminTripsPanel.vue`
- Create: `frontend/src/admin/navigation.ts`
- Create: `frontend/src/admin/navigation.test.ts`
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: existing runtime settings and trip API methods.
- Produces: `AdminSection = "settings" | "skills" | "trips"`, visible navigation, and panel events.
- Consumed by: Task 11's Skill panel.

- [ ] **Step 1: Write failing navigation-state tests**

```ts
it("keeps all first-level destinations visible and restores a valid section", () => {
  expect(ADMIN_SECTIONS.map((item) => item.id)).toEqual(["settings", "skills", "trips"]);
  expect(normalizeAdminSection("unknown")).toBe("settings");
  expect(normalizeAdminSection("skills")).toBe("skills");
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
cd frontend
bun test src/admin/navigation.test.ts
```

Expected: FAIL because the Admin shell has no section model.

- [ ] **Step 3: Extract existing panels without changing behavior**

Move runtime settings state/actions/styles into `AdminRuntimeSettingsPanel.vue` and trip listing/filter/detail/delete behavior into `AdminTripsPanel.vue`. Keep the current API calls, success/error messages, and route navigation unchanged. `AdminView.vue` continues to own login/session expiration and supplies a single `onUnauthorized` callback to panels.

- [ ] **Step 4: Implement persistent responsive navigation**

Use the existing Ant Design icon library. Desktop uses a quiet dark left rail with visible labels. At narrow widths, render three equal-width sticky top navigation buttons, each at least 44 px high. Store the last section in `sessionStorage` and normalize unknown values.

Do not render panels as nested cards. The navigation shell is a full-width work surface; individual dialogs and repeated Skill rows may use bounded surfaces.

- [ ] **Step 5: Add Chinese and English navigation copy**

Add `admin.navigation.settings`, `admin.navigation.skills`, and `admin.navigation.trips`, plus shared loading/session errors. Do not add Japanese copy because Japanese is not an active product locale.

- [ ] **Step 6: Run frontend tests and build**

```bash
cd frontend
bun run test:unit
bun run build
```

Expected: all existing tests pass and build exits 0; record existing unresolved legacy image/font and large-chunk warnings without treating them as new failures.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/AdminView.vue frontend/src/components/admin/AdminNavigation.vue \
  frontend/src/components/admin/AdminRuntimeSettingsPanel.vue \
  frontend/src/components/admin/AdminTripsPanel.vue frontend/src/admin/navigation.ts \
  frontend/src/admin/navigation.test.ts frontend/src/i18n/locales/zh.json \
  frontend/src/i18n/locales/en.json
git commit -m "refactor(frontend): add persistent admin navigation"
```

---

### Task 11: Build The Skill Workspace And Installation Flow

**Files:**
- Create: `frontend/src/components/admin/AdminSkillsPanel.vue`
- Create: `frontend/src/components/admin/SkillInstallDialog.vue`
- Create: `frontend/src/components/admin/SkillDetailPanel.vue`
- Modify: `frontend/package.json`
- Modify: `frontend/bun.lock`
- Modify: `frontend/src/views/AdminView.vue`
- Modify: `frontend/src/admin/skill-management.ts`
- Modify: `frontend/src/admin/skill-management.test.ts`
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: Task 9 API and Task 10 shell.
- Produces: complete ZIP/Git install, review/edit/activate, configuration, update, archive, and restore UI.

- [ ] **Step 1: Extend failing state tests for UI transitions**

```ts
it("does not replace active content when candidate editing begins", () => {
  const state = beginCandidateEdit(detail);
  expect(state.editorContent).toBe(detail.candidate_version?.content ?? detail.active_version?.content);
  expect(state.activeVersionId).toBe(detail.active_version?.id);
  expect(state.dirty).toBeFalse();
});

it("requires a disabled custom skill before archive", () => {
  expect(skillActions(customEnabled)).not.toContain("archive");
  expect(skillActions(customDisabled)).toContain("archive");
  expect(skillActions(builtinDisabled)).not.toContain("archive");
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd frontend
bun test src/admin/skill-management.test.ts
```

Expected: FAIL because candidate editor and action capability helpers are absent.

- [ ] **Step 3: Add the explicit line-diff dependency**

```bash
cd frontend
bun add diff@8.0.4
```

Use `diffLines()` for current-versus-candidate review. Do not implement diff parsing with ad hoc string splitting.

- [ ] **Step 4: Build the list/detail work surface**

`AdminSkillsPanel.vue` owns loading, selection, search, source/state filters, archived toggle, and refetch after mutations. Desktop uses a stable `minmax(300px, 38%) 1fr` split. Mobile stacks list and detail; selecting a row focuses the detail heading and exposes a visible back-to-list button.

Status badges always include text. Empty, loading, initial error, mutation error, no selection, no search results, and archived states each have distinct UI.

- [ ] **Step 5: Build content, assignment, and version detail tabs**

`SkillDetailPanel.vue` shows full active/candidate content, sanitized source, hash, commit, timestamps, and a `diffLines()` change view with added/removed text labels. Custom candidate text uses an editor; built-in content is read-only. Use checkboxes for six assignments, a switch for global enablement, and explicit Save/Activate commands.

Activation sends enablement and assignments together. Configuration changes do not edit content. Archive requires a confirm dialog and is absent for built-ins. Restore returns to disabled state. Git update check reports unchanged separately from a newly staged candidate.

- [ ] **Step 6: Build the ZIP/Git install dialog**

Use a segmented source selector. ZIP accepts one `.zip` file and does not claim success until the backend returns a candidate. Git exposes repository URL, optional ref, and optional subdirectory. Read `private_git_credentials_available` from the list response and show only whether server credentials are available; never display a token field.

Disable duplicate submits, keep user input after validation errors, clear secrets from error details, and focus the candidate review after success.

- [ ] **Step 7: Add complete Chinese and English copy**

Add labels for navigation, list filters, sources, states, content/review, assignments, versions, install fields, candidate actions, update results, archive/restore confirmations, and each stable backend error code. Use product language such as `待审核`, `已启用`, `已停用`, `内置`, `上传`, and `Git`; do not expose database or runtime implementation terms.

- [ ] **Step 8: Run frontend tests and build**

```bash
cd frontend
bun run test:unit
bun run build
```

Expected: all tests pass and production build exits 0 with only separately reported pre-existing warnings.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/admin/AdminSkillsPanel.vue \
  frontend/src/components/admin/SkillInstallDialog.vue \
  frontend/src/components/admin/SkillDetailPanel.vue frontend/package.json frontend/bun.lock \
  frontend/src/views/AdminView.vue \
  frontend/src/admin/skill-management.ts frontend/src/admin/skill-management.test.ts \
  frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json
git commit -m "feat(frontend): manage skills from admin"
```

---

### Task 12: Document, Exercise Real Browser Flows, And Run The Final Gate

**Files:**
- Create: `backend-ts/tests/fixtures/skills/museum-guide/SKILL.md`
- Create: `backend-ts/scripts/skill-admin-browser-fixture.ts`
- Modify: `backend-ts/package.json`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: completed backend, frontend, and injected `skillService` test seam.
- Produces: deterministic local browser fixture, operator documentation, and final evidence.

- [ ] **Step 1: Create deterministic browser fixture data**

Add one inert `museum-guide` Skill and a script that:

- Creates a temporary `DATA_DIR` with the default Admin password.
- Builds a valid ZIP through the checked-in JS fixture helper.
- Injects a fake Git importer that returns the same package with commit `0123456789abcdef0123456789abcdef01234567` for `https://git.example.test/travel-skills.git`.
- Starts the real Elysia Admin API and built frontend on task-owned unused ports.
- Prints JSON containing both URLs, ZIP path, and a cleanup token.
- Removes only its own temporary directory on shutdown.

Add `browser:skills-fixture` to `backend-ts/package.json` so the harness is reproducible.

- [ ] **Step 2: Add operator documentation**

Document the visible Admin path, ZIP/Git behavior, candidate activation, built-in restrictions, six targets, archive/restore semantics, size limits, and `YOUBAN_SKILL_GIT_TOKEN` plus `YOUBAN_SKILL_GIT_TOKEN_HOST`. State explicitly that scripts and dependencies are not executed and Git updates are manual.

- [ ] **Step 3: Run focused automated acceptance**

```bash
cd backend-ts
bun test tests/skill-repository.test.ts tests/skill-document.test.ts \
  tests/skill-zip-importer.test.ts tests/skill-git-importer.test.ts \
  tests/skill-management-service.test.ts tests/admin-skills-http.test.ts \
  tests/session-host.test.ts tests/persistent-parent-agent.test.ts \
  tests/pi-subagent-runner.test.ts
bun run typecheck
cd ../frontend
bun run test:unit
bun run build
```

Expected: all focused tests pass, typecheck exits 0, and build exits 0.

- [ ] **Step 4: Start the task-owned browser fixture and use browser-use only**

Start the fixture and frontend server, then use browser-use to reuse a matching `/admin` tab or open one task-owned tab. Start a recording named `youban-admin-skills-green`.

Verify at desktop 1440x900:

- Skills is a visible first-level destination.
- ZIP install creates a disabled candidate.
- Candidate review displays content, hash, source, and six assignments.
- Activation for `segment-planner` persists after reload.
- Online editing leaves the prior active version visible until activation.
- Git install/update uses the deterministic fixture commit and never renders a token.
- Built-in content is read-only and has no archive action.
- Disable/re-enable preserves assignments; custom archive requires disable and restore returns disabled.

Verify at 375x844 and 320x700:

- All three Admin destinations remain visible.
- Skill list and detail are both reachable.
- Every primary interactive target is at least 44 px high.
- There is no horizontal overflow or overlapping text/action controls.
- Keyboard focus follows navigation, install, filters, list, detail tabs, assignments, and actions.

Stop the recording, close only the task-owned tab, and stop the fixture process. Retain the exact recording path in the verification notes.

- [ ] **Step 5: Run the complete integration gate**

Use the serial full backend suite so verification does not rewrite `tests/timings.json`:

```bash
cd backend-ts
bun run test:serial
bun run typecheck
bun run audit:python-tests
cd ../frontend
bun run test:unit
bun run build
cd ..
git diff --check
git status --short --branch
```

Expected: complete backend and frontend tests pass, typecheck and audit exit 0, build exits 0, `git diff --check` is empty, and only the intended documentation/fixture commit remains to be created.

- [ ] **Step 6: Commit documentation and browser fixture**

```bash
git add backend-ts/tests/fixtures/skills/museum-guide/SKILL.md \
  backend-ts/scripts/skill-admin-browser-fixture.ts backend-ts/package.json \
  backend-ts/bun.lock README.md .env.example
git commit -m "docs: explain admin skill management"
```

- [ ] **Step 7: Verify the committed tree**

```bash
git status --short --branch
git log --oneline --decorate -12
```

Expected: clean `codex/backend-ts-rewrite` worktree with the Skill management commits at `HEAD`. Do not merge, push, deploy, or remove the worktree without an explicit user choice.
