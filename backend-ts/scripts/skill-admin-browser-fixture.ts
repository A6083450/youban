import { spawn as spawnChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { SkillGitImportError, type GitSkillInstallRequest, type GitSkillRemoteRequest } from "../src/agents/skill-git-importer.ts";
import { SkillManagementService } from "../src/agents/skill-management-service.ts";
import { type StagedSkillPackage, SkillPackageStore } from "../src/agents/skill-package-store.ts";
import { validateSkillDocument } from "../src/agents/skill-document.ts";
import type { YoubanParentAgent } from "../src/agents/persistent-parent-agent.ts";
import type { TripPlanner } from "../src/agents/trip-planner.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";
import { listenProductionHttpServer } from "../src/runtime/server-lifecycle.ts";
import { createZipFixture } from "../tests/helpers/zip-fixture.ts";

const HOSTNAME = "127.0.0.1";
const REPOSITORY_URL = "https://git.example.test/travel-skills.git";
const FIXTURE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TEMPORARY_DIRECTORY_PREFIX = "youban-skill-admin-browser-";
const CLEANUP_GUARDIAN_FLAG = "--cleanup-guardian";
const CLEANUP_TOKEN_MARKER = ".cleanup-token";
const GIT_SKILL_CONTENT = `---
name: travel-skills
description: Provide deterministic travel research guidance for browser acceptance.
---

# Travel skills

Verify important opening hours and reservation requirements before presenting a route.
`;

export interface SkillAdminBrowserFixtureInfo {
  type: "youban-skill-admin-browser-fixture";
  api_url: string;
  frontend_url: string;
  zip_path: string;
  cleanup_token: string;
}

export interface SkillAdminBrowserFixture {
  readonly dataDir: string;
  readonly info: SkillAdminBrowserFixtureInfo;
  stop(): Promise<void>;
}

export interface StartSkillAdminBrowserFixtureOptions {
  repoRoot?: string;
  log?: (line: string) => void;
}

type CleanupMarkerWriter = (markerPath: string, cleanupToken: string) => void;

export function createSkillAdminFixtureDataDirectory(
  writeMarker: CleanupMarkerWriter = (markerPath, cleanupToken) => {
    writeFileSync(markerPath, `${cleanupToken}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  },
): { dataDir: string; cleanupToken: string } {
  const dataDir = mkdtempSync(join(tmpdir(), TEMPORARY_DIRECTORY_PREFIX));
  const cleanupToken = crypto.randomUUID();
  try {
    writeMarker(join(dataDir, CLEANUP_TOKEN_MARKER), cleanupToken);
  } catch (error) {
    try {
      removeInitialEmptyTemporaryDirectory(dataDir);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "cleanup marker creation failed and the initial directory was not empty",
      );
    }
    throw error;
  }
  return { dataDir, cleanupToken };
}

export async function startSkillAdminBrowserFixture(
  options: StartSkillAdminBrowserFixtureOptions = {},
): Promise<SkillAdminBrowserFixture> {
  const repoRoot = resolve(options.repoRoot ?? join(import.meta.dir, "..", ".."));
  const frontendDist = join(repoRoot, "frontend", "dist");
  if (!existsSync(join(frontendDist, "index.html"))) {
    throw new Error("built frontend is missing; run `cd frontend && bun run build`");
  }

  const { dataDir, cleanupToken } = createSkillAdminFixtureDataDirectory();
  let skillService: SkillManagementService | undefined;
  let runtime: HttpRuntime | undefined;
  let listener: ReturnType<HttpRuntime["app"]["listen"]> | undefined;
  try {
    const fixtureDocumentPath = join(
      repoRoot,
      "backend-ts",
      "tests",
      "fixtures",
      "skills",
      "museum-guide",
      "SKILL.md",
    );
    const museumGuideContent = readFileSync(fixtureDocumentPath, "utf8");
    validateSkillDocument(museumGuideContent, "museum-guide");

    const fixtureFilesDir = join(dataDir, "fixture-files");
    mkdirSync(fixtureFilesDir, { mode: 0o700 });
    const zipPath = join(fixtureFilesDir, "museum-guide.zip");
    writeFileSync(zipPath, createZipFixture([
      { name: "museum-guide/SKILL.md", content: museumGuideContent },
      {
        name: "museum-guide/README.md",
        content: "This browser fixture package is inert and deterministic.\n",
      },
    ]), { mode: 0o600 });

    const packageStore = new SkillPackageStore(join(dataDir, "skills"));
    skillService = new SkillManagementService({
      databasePath: join(dataDir, "youban.db"),
      dataDir: join(dataDir, "skills"),
      builtinSkillsDir: join(repoRoot, "backend-ts", "src", "agents", "skills"),
      packageStore,
      gitImporter: new DeterministicGitImporter(packageStore),
    });
    runtime = createHttpRuntime({
      dataDir,
      frontendDist,
      skillService,
      parentAgent: NOOP_PARENT_AGENT,
      planner: NOOP_PLANNER,
    });
    listener = listenProductionHttpServer(runtime.app, { hostname: HOSTNAME, port: 0 });
    const port = listener.server?.port;
    if (typeof port !== "number") throw new Error("browser fixture server did not bind a port");

    const apiUrl = `http://${HOSTNAME}:${port}`;
    const info: SkillAdminBrowserFixtureInfo = {
      type: "youban-skill-admin-browser-fixture",
      api_url: apiUrl,
      frontend_url: `${apiUrl}/admin`,
      zip_path: zipPath,
      cleanup_token: cleanupToken,
    };
    const fixture = fixtureHandle({ dataDir, info, listener, runtime, skillService });
    (options.log ?? console.log)(JSON.stringify(info));
    return fixture;
  } catch (error) {
    await closeSkillAdminBrowserFixtureResources(listener, runtime, skillService);
    removeOwnedTemporaryDirectory(dataDir, cleanupToken);
    throw error;
  }
}

class DeterministicGitImporter {
  constructor(private readonly packageStore: SkillPackageStore) {}

  async stage(request: GitSkillInstallRequest): Promise<StagedSkillPackage> {
    this.assertRequest(request);
    const stagingDir = this.packageStore.createStagingDirectory();
    try {
      this.packageStore.writeFile(stagingDir, "SKILL.md", Buffer.from(GIT_SKILL_CONTENT));
      this.packageStore.writeFile(
        stagingDir,
        "README.md",
        Buffer.from("This Git browser fixture package is inert and deterministic.\n"),
      );
      return {
        stagingDir,
        document: validateSkillDocument(GIT_SKILL_CONTENT, "travel-skills"),
        files: ["README.md", "SKILL.md"],
        source: "git",
        sanitizedSource: REPOSITORY_URL,
        sourceCommit: FIXTURE_COMMIT,
        cleanup: () => this.packageStore.cleanupStaging(stagingDir),
      };
    } catch (error) {
      this.packageStore.cleanupStaging(stagingDir);
      throw error;
    }
  }

  async resolveRemote(request: GitSkillRemoteRequest) {
    this.assertRequest(request);
    return {
      commit: FIXTURE_COMMIT,
      changed: request.activeCommit !== FIXTURE_COMMIT && request.candidateCommit !== FIXTURE_COMMIT,
    };
  }

  private assertRequest(request: GitSkillInstallRequest): void {
    let normalized: string;
    try {
      normalized = new URL(request.repositoryUrl).href;
    } catch {
      throw new SkillGitImportError("invalid_git_url", "fixture accepts only its controlled Git URL");
    }
    if (normalized !== REPOSITORY_URL || request.ref || request.subdirectory) {
      throw new SkillGitImportError("invalid_git_url", "fixture accepts only its controlled Git URL");
    }
  }
}

const NOOP_PARENT_AGENT: YoubanParentAgent = {
  async complete() { return ""; },
  async delegate() { return {}; },
  async recordExchange() {},
  async close() {},
};

const NOOP_PLANNER: TripPlanner = {
  async plan(request) { return { success: true, data: request }; },
};

function fixtureHandle(options: {
  dataDir: string;
  info: SkillAdminBrowserFixtureInfo;
  listener: ReturnType<HttpRuntime["app"]["listen"]>;
  runtime: HttpRuntime;
  skillService: SkillManagementService;
}): SkillAdminBrowserFixture {
  let stopPromise: Promise<void> | undefined;
  return {
    dataDir: options.dataDir,
    info: options.info,
    stop() {
      stopPromise ??= (async () => {
        const errors = await closeSkillAdminBrowserFixtureResources(
          options.listener,
          options.runtime,
          options.skillService,
        );
        try {
          removeOwnedTemporaryDirectory(options.dataDir, options.info.cleanup_token);
        } catch (error) {
          errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "browser fixture cleanup failed");
      })();
      return stopPromise;
    },
  };
}

export async function closeSkillAdminBrowserFixtureResources(
  listener: { stop(force?: boolean): unknown | Promise<unknown> } | undefined,
  runtime: { close(): Promise<void> } | undefined,
  skillService: { close(): void | Promise<void> } | undefined,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  const settle = async (operation: (() => unknown | Promise<unknown>) | undefined) => {
    if (!operation) return;
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  await settle(listener ? () => listener.stop(false) : undefined);
  await settle(runtime ? () => runtime.close() : undefined);
  await settle(skillService ? () => skillService.close() : undefined);
  return errors;
}

function removeOwnedTemporaryDirectory(dataDir: string, cleanupToken: string): void {
  if (!existsSync(dataDir)) return;
  const realDataDir = realpathSync(dataDir);
  const realTemporaryRoot = realpathSync(tmpdir());
  if (
    dirname(realDataDir) !== realTemporaryRoot
    || !basename(realDataDir).startsWith(TEMPORARY_DIRECTORY_PREFIX)
  ) {
    throw new Error("refusing to remove a directory not owned by the browser fixture");
  }
  const marker = join(realDataDir, CLEANUP_TOKEN_MARKER);
  const markerStat = lstatSync(marker);
  if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error("cleanup token marker is not an owned regular file");
  }
  if (readFileSync(marker, "utf8") !== `${cleanupToken}\n`) {
    throw new Error("cleanup token does not match the owned browser fixture directory");
  }
  rmSync(realDataDir, { recursive: true, force: true });
}

function removeInitialEmptyTemporaryDirectory(dataDir: string): void {
  const realDataDir = realpathSync(dataDir);
  const realTemporaryRoot = realpathSync(tmpdir());
  if (
    dirname(realDataDir) !== realTemporaryRoot
    || !basename(realDataDir).startsWith(TEMPORARY_DIRECTORY_PREFIX)
  ) {
    throw new Error("refusing to remove an unowned initial fixture directory");
  }
  if (readdirSync(realDataDir).length !== 0) {
    throw new Error("refusing to remove a non-empty initial fixture directory");
  }
  rmdirSync(realDataDir);
}

async function runCleanupGuardian(dataDir: string, cleanupToken: string): Promise<void> {
  for await (const _chunk of process.stdin) {
    // The parent never writes data; EOF is the precise parent-death notification.
  }
  removeOwnedTemporaryDirectory(dataDir, cleanupToken);
}

function startCleanupGuardian(dataDir: string, cleanupToken: string): { release(): void } {
  const guardian = spawnChildProcess(process.execPath, [
    import.meta.path,
    CLEANUP_GUARDIAN_FLAG,
    dataDir,
    cleanupToken,
  ], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
  });
  guardian.unref();
  const guardianInput = guardian.stdin as typeof guardian.stdin & { unref?: () => void };
  guardianInput.unref?.();
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      guardianInput.end();
    },
  };
}

if (import.meta.main) {
  if (process.argv[2] === CLEANUP_GUARDIAN_FLAG) {
    await runCleanupGuardian(
      process.argv[3] ?? "",
      process.argv[4] ?? "",
    );
  } else {
    const fixture = await startSkillAdminBrowserFixture({ log: () => {} });
    const cleanupGuardian = startCleanupGuardian(fixture.dataDir, fixture.info.cleanup_token);
    console.log(JSON.stringify(fixture.info));
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await fixture.stop();
      } catch (error) {
        console.error(`browser fixture cleanup failed: ${String(error)}`);
        process.exitCode = 1;
      } finally {
        cleanupGuardian.release();
      }
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  }
}
