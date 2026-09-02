import { Database } from "bun:sqlite";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { conversationsTable, CURRENT_SCHEMA_VERSION, tasksTable, usersTable } from "../src/domain/db-schema.ts";
import { YoubanDatabase } from "../src/domain/database.ts";
import { createTaskState, type TripTaskState } from "../src/domain/task-store.ts";

interface SourceSummary {
  valid: number;
  invalid: number;
  duplicates: number;
  hash: string;
}

export interface MigrationReport {
  dryRun: boolean;
  schemaVersion: number;
  source: {
    tasks: SourceSummary;
    users: SourceSummary;
    conversations: SourceSummary;
  };
  target: { tasks: number; users: number; conversations: number };
  targetHashes: { tasks: string; users: string; conversations: string };
  invalidRecords: Array<{ path: string; reason: string }>;
  duplicateRecords: Array<{ path: string; key: string }>;
  backupDir: string | null;
  quickCheck: string;
}

export interface MigrationOptions {
  dataDir: string;
  dryRun?: boolean;
  skipBackup?: boolean;
}

interface TaskSource {
  path: string;
  task: TripTaskState;
  createdAt: string;
  updatedAt: string;
}

interface ConversationSource {
  path: string;
  planId: string;
  userId: string;
  payload: unknown[];
  updatedAt: string;
}

interface UserSource {
  path: string;
  user: {
    user_id: string;
    nickname: string;
    created_at: string;
    last_login_at: string;
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function stablePayloadHash(values: unknown[]): string {
  const canonical = JSON.stringify(values.map(canonicalize));
  return new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

function readObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function normalizeTask(path: string, payload: Record<string, unknown>): TaskSource {
  const taskId = String(payload.task_id ?? basename(path, ".json")).trim();
  if (!taskId) throw new Error("missing task_id");
  const status = payload.status;
  if (status !== "processing" && status !== "completed" && status !== "failed") {
    throw new Error("invalid task status");
  }
  const task = createTaskState(taskId, {
    ...(payload as unknown as Partial<TripTaskState>),
    plan_id: String(payload.plan_id ?? taskId),
    status,
  });
  const stat = statSync(path);
  return {
    path,
    task,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
  };
}

function loadSources(dataDir: string) {
  const invalidRecords: MigrationReport["invalidRecords"] = [];
  const duplicateRecords: MigrationReport["duplicateRecords"] = [];
  const tasks: TaskSource[] = [];
  const conversations: ConversationSource[] = [];
  const users: UserSource[] = [];

  const taskIds = new Set<string>();
  for (const path of jsonFiles(join(dataDir, "trip_tasks"))) {
    try {
      const task = normalizeTask(path, readObject(path));
      if (taskIds.has(task.task.task_id)) {
        duplicateRecords.push({ path, key: task.task.task_id });
        continue;
      }
      taskIds.add(task.task.task_id);
      tasks.push(task);
    } catch (error) {
      invalidRecords.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const conversationIds = new Set<string>();
  for (const path of jsonFiles(join(dataDir, "conversations"))) {
    try {
      const payload = readObject(path);
      const planId = String(payload.plan_id ?? basename(path, ".json")).trim();
      if (!planId) throw new Error("missing plan_id");
      if (!Array.isArray(payload.messages)) throw new Error("messages must be an array");
      if (conversationIds.has(planId)) {
        duplicateRecords.push({ path, key: planId });
        continue;
      }
      conversationIds.add(planId);
      conversations.push({
        path,
        planId,
        userId: String(payload.user_id ?? ""),
        payload: payload.messages,
        updatedAt: statSync(path).mtime.toISOString(),
      });
    } catch (error) {
      invalidRecords.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const usersPath = join(dataDir, "users.json");
  if (existsSync(usersPath)) {
    try {
      const payload = readObject(usersPath);
      if (!Array.isArray(payload.users)) throw new Error("users must be an array");
      const userIds = new Set<string>();
      for (const [index, entry] of payload.users.entries()) {
        const path = `${usersPath}#users[${index}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          invalidRecords.push({ path, reason: "expected a user object" });
          continue;
        }
        const raw = entry as Record<string, unknown>;
        const userId = String(raw.user_id ?? "").trim();
        const nickname = String(raw.nickname ?? "").trim();
        if (!userId || !nickname) {
          invalidRecords.push({ path, reason: "missing user_id or nickname" });
          continue;
        }
        if (userIds.has(userId)) {
          duplicateRecords.push({ path, key: userId });
          continue;
        }
        userIds.add(userId);
        users.push({
          path,
          user: {
            user_id: userId,
            nickname,
            created_at: String(raw.created_at ?? new Date(0).toISOString()),
            last_login_at: String(raw.last_login_at ?? raw.created_at ?? new Date(0).toISOString()),
          },
        });
      }
    } catch (error) {
      invalidRecords.push({ path: usersPath, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { tasks, conversations, users, invalidRecords, duplicateRecords };
}

function sourceSummary(values: unknown[], invalid: number, duplicates: number): SourceSummary {
  return { valid: values.length, invalid, duplicates, hash: stablePayloadHash(values) };
}

function targetState(databasePath: string) {
  if (!existsSync(databasePath)) {
    const emptyHash = stablePayloadHash([]);
    return {
      counts: { tasks: 0, users: 0, conversations: 0 },
      hashes: { tasks: emptyHash, users: emptyHash, conversations: emptyHash },
    };
  }
  const db = new Database(databasePath, { readonly: true, strict: true });
  try {
    const taskRows = db.query("SELECT payload FROM tasks ORDER BY task_id").all() as Array<{ payload: string }>;
    const userRows = db.query(
      "SELECT user_id, nickname, created_at, last_login_at FROM users ORDER BY user_id",
    ).all() as Array<Record<string, string>>;
    const conversationRows = db.query(
      "SELECT payload FROM conversations ORDER BY plan_id",
    ).all() as Array<{ payload: string }>;
    return {
      counts: {
        tasks: taskRows.length,
        users: userRows.length,
        conversations: conversationRows.length,
      },
      hashes: {
        tasks: stablePayloadHash(taskRows.map((row) => JSON.parse(row.payload))),
        users: stablePayloadHash(userRows),
        conversations: stablePayloadHash(conversationRows.map((row) => JSON.parse(row.payload))),
      },
    };
  } finally {
    db.close();
  }
}

function backupSources(dataDir: string): string {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  let backupDir = join(dataDir, "migration-backups", stamp);
  let sequence = 1;
  while (existsSync(backupDir)) backupDir = join(dataDir, "migration-backups", `${stamp}-${sequence++}`);
  mkdirSync(backupDir, { recursive: true });
  for (const directory of ["trip_tasks", "conversations"]) {
    const source = join(dataDir, directory);
    if (existsSync(source)) cpSync(source, join(backupDir, directory), { recursive: true });
  }
  for (const file of ["users.json", "youban.db", "youban.db-wal", "youban.db-shm"]) {
    const source = join(dataDir, file);
    if (existsSync(source)) copyFileSync(source, join(backupDir, file));
  }
  return backupDir;
}

export function migrateJsonToSqlite(options: MigrationOptions): MigrationReport {
  const source = loadSources(options.dataDir);
  const invalidByKind = {
    tasks: source.invalidRecords.filter((record) => record.path.includes("trip_tasks")).length,
    conversations: source.invalidRecords.filter((record) => record.path.includes("conversations")).length,
    users: source.invalidRecords.filter((record) => record.path.includes("users.json")).length,
  };
  const duplicateByKind = {
    tasks: source.duplicateRecords.filter((record) => record.path.includes("trip_tasks")).length,
    conversations: source.duplicateRecords.filter((record) => record.path.includes("conversations")).length,
    users: source.duplicateRecords.filter((record) => record.path.includes("users.json")).length,
  };
  const sourceValues = {
    tasks: source.tasks.map((entry) => entry.task).sort((a, b) => a.task_id.localeCompare(b.task_id)),
    conversations: [...source.conversations]
      .sort((a, b) => a.planId.localeCompare(b.planId))
      .map((entry) => entry.payload),
    users: source.users.map((entry) => entry.user).sort((a, b) => a.user_id.localeCompare(b.user_id)),
  };
  const databasePath = join(options.dataDir, "youban.db");
  const hasSourceIssues = source.invalidRecords.length > 0 || source.duplicateRecords.length > 0;
  let backupDir: string | null = null;
  let quickCheck = "not-run";

  if (!options.dryRun && !hasSourceIssues) {
    if (!options.skipBackup) backupDir = backupSources(options.dataDir);
    const database = new YoubanDatabase(databasePath);
    try {
      const migrate = database.raw.transaction(() => {
        for (const entry of source.tasks) {
          database.orm.insert(tasksTable).values({
            taskId: entry.task.task_id,
            planId: entry.task.plan_id,
            userId: entry.task.user_id,
            status: entry.task.status,
            shareToken: entry.task.share_token,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            payload: JSON.stringify(entry.task),
          }).onConflictDoUpdate({
            target: tasksTable.taskId,
            set: {
              planId: entry.task.plan_id,
              userId: entry.task.user_id,
              status: entry.task.status,
              shareToken: entry.task.share_token,
              updatedAt: entry.updatedAt,
              payload: JSON.stringify(entry.task),
            },
          }).run();
        }
        for (const entry of source.conversations) {
          database.orm.insert(conversationsTable).values({
            planId: entry.planId,
            userId: entry.userId,
            payload: JSON.stringify(entry.payload),
            updatedAt: entry.updatedAt,
          }).onConflictDoUpdate({
            target: conversationsTable.planId,
            set: { userId: entry.userId, payload: JSON.stringify(entry.payload), updatedAt: entry.updatedAt },
          }).run();
        }
        for (const entry of source.users) {
          const user = entry.user;
          database.orm.insert(usersTable).values({
            userId: user.user_id,
            nickname: user.nickname,
            avatarFile: null,
            profileCompletedAt: null,
            createdAt: user.created_at,
            lastLoginAt: user.last_login_at,
          }).onConflictDoUpdate({
            target: usersTable.userId,
            set: {
              nickname: user.nickname,
              lastLoginAt: user.last_login_at,
            },
          }).run();
        }
      });
      migrate();
      quickCheck = database.quickCheck();
      if (quickCheck !== "ok") throw new Error(`SQLite quick_check failed: ${quickCheck}`);
    } finally {
      database.close();
    }
  }

  const target = targetState(databasePath);
  return {
    dryRun: options.dryRun === true,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    source: {
      tasks: sourceSummary(sourceValues.tasks, invalidByKind.tasks, duplicateByKind.tasks),
      users: sourceSummary(sourceValues.users, invalidByKind.users, duplicateByKind.users),
      conversations: sourceSummary(
        sourceValues.conversations,
        invalidByKind.conversations,
        duplicateByKind.conversations,
      ),
    },
    target: target.counts,
    targetHashes: target.hashes,
    invalidRecords: source.invalidRecords,
    duplicateRecords: source.duplicateRecords,
    backupDir,
    quickCheck,
  };
}

if (import.meta.main) {
  const dryRun = Bun.argv.includes("--dry-run");
  const dataArg = Bun.argv.find((arg) => arg.startsWith("--data-dir="));
  const dataDir = dataArg?.slice("--data-dir=".length) || process.env.DATA_DIR || join(import.meta.dir, "..", "..", "data");
  const report = migrateJsonToSqlite({ dataDir, dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (report.invalidRecords.length > 0 || report.duplicateRecords.length > 0) process.exitCode = 2;
}
