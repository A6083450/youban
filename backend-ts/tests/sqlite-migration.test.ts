import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSqliteToJson } from "../scripts/export-sqlite-to-json.ts";
import { migrateJsonToSqlite } from "../scripts/migrate-json-to-sqlite.ts";
import { ConversationRepository } from "../src/domain/conversations.ts";

const tempDirs: string[] = [];

function fixture(options: { invalidTask?: boolean } = {}): string {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-migration-"));
  tempDirs.push(dataDir);
  mkdirSync(join(dataDir, "trip_tasks"), { recursive: true });
  mkdirSync(join(dataDir, "conversations"), { recursive: true });
  writeFileSync(join(dataDir, "trip_tasks", "task-1.json"), JSON.stringify({
    task_id: "task-1",
    plan_id: "task-1",
    user_id: "user-1",
    status: "completed",
    stage: "completed",
    progress: 100,
    message: "完成",
    details: [],
    result: { success: true, data: { city: "北京", days: [] } },
    error: null,
    share_token: "",
    request_payload: { city: "北京", travel_days: 3 },
    checkpoint: {},
    execution: {},
    budget_items: null,
  }, null, 2));
  if (options.invalidTask) {
    writeFileSync(join(dataDir, "trip_tasks", "invalid.json"), "[]");
  }
  writeFileSync(join(dataDir, "conversations", "task-1.json"), JSON.stringify({
    plan_id: "task-1",
    user_id: "user-1",
    messages: [{ role: "user", content: "去北京" }],
  }, null, 2));
  writeFileSync(join(dataDir, "users.json"), JSON.stringify({
    users: [{
      user_id: "user-1",
      nickname: "Neo",
      created_at: "2026-08-01T00:00:00",
      last_login_at: "2026-08-02T00:00:00",
    }],
  }, null, 2));
  return dataDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("JSON to SQLite migration", () => {
  it("dry-run reports counts, hashes and invalid records without creating a database", () => {
    const dataDir = fixture({ invalidTask: true });
    const result = migrateJsonToSqlite({ dataDir, dryRun: true });

    expect(existsSync(join(dataDir, "youban.db"))).toBe(false);
    expect(result.schemaVersion).toBe(2);
    expect(result.source.tasks).toEqual(expect.objectContaining({ valid: 1, invalid: 1 }));
    expect(result.source.users.valid).toBe(1);
    expect(result.source.conversations.valid).toBe(1);
    expect(result.source.tasks.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.invalidRecords[0]?.path).toEndWith("invalid.json");
    expect(result.quickCheck).toBe("not-run");
    expect(result.backupDir).toBeNull();
  });

  it("backs up source data, migrates idempotently, and exports a rollback snapshot", () => {
    const dataDir = fixture();
    const first = migrateJsonToSqlite({ dataDir });
    expect(first.backupDir).not.toBeNull();
    expect(existsSync(join(first.backupDir!, "trip_tasks", "task-1.json"))).toBe(true);
    expect(first.quickCheck).toBe("ok");
    const conversations = new ConversationRepository(join(dataDir, "youban.db"));
    expect(conversations.get("task-1")).toEqual([{ role: "user", content: "去北京" }]);
    conversations.append("task-1", "user-1", [{ role: "assistant", content: "已生成" }]);
    expect(conversations.get("task-1")).toEqual([
      { role: "user", content: "去北京" },
      { role: "assistant", content: "已生成" },
    ]);
    conversations.close();
    const compatibilityDb = new Database(join(dataDir, "youban.db"));
    compatibilityDb.query("UPDATE conversations SET payload = ? WHERE plan_id = ?").run(JSON.stringify({
      plan_id: "task-1",
      user_id: "user-1",
      messages: [{ role: "user", content: "旧包装历史" }],
    }), "task-1");
    compatibilityDb.close();
    const compatible = new ConversationRepository(join(dataDir, "youban.db"));
    compatible.append("task-1", "user-1", [{ role: "assistant", content: "继续对话" }]);
    expect(compatible.get("task-1")).toEqual([
      { role: "user", content: "旧包装历史" },
      { role: "assistant", content: "继续对话" },
    ]);
    compatible.close();
    expect(first.target).toEqual(expect.objectContaining({ tasks: 1, users: 1, conversations: 1 }));
    expect(first.targetHashes.tasks).toBe(first.source.tasks.hash);

    const second = migrateJsonToSqlite({ dataDir, skipBackup: true });
    expect(second.target).toEqual({ tasks: 1, users: 1, conversations: 1 });
    expect(second.targetHashes).toEqual(first.targetHashes);

    const db = new Database(join(dataDir, "youban.db"), { readonly: true });
    expect(db.query("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    db.close();

    const outputDir = join(dataDir, "rollback-export");
    const exported = exportSqliteToJson({ databasePath: join(dataDir, "youban.db"), outputDir });
    expect(exported).toEqual({ tasks: 1, users: 1, conversations: 1 });
    expect(readdirSync(join(outputDir, "trip_tasks"))).toEqual(["task-1.json"]);
    expect(JSON.parse(readFileSync(join(outputDir, "trip_tasks", "task-1.json"), "utf8"))).toEqual(
      expect.objectContaining({ task_id: "task-1", status: "completed" }),
    );
    expect(JSON.parse(readFileSync(join(outputDir, "users.json"), "utf8"))).toEqual({
      users: [expect.objectContaining({ user_id: "user-1", nickname: "Neo" })],
    });
    expect(JSON.parse(readFileSync(join(outputDir, "conversations", "task-1.json"), "utf8"))).toEqual({
      plan_id: "task-1",
      user_id: "user-1",
      messages: [{ role: "user", content: "去北京" }],
    });
  });

  it("leaves a pre-existing target unchanged when invalid or duplicate sources are reported", () => {
    for (const issue of ["invalid", "duplicate"] as const) {
      const dataDir = fixture();
      const databasePath = join(dataDir, "youban.db");
      migrateJsonToSqlite({ dataDir, skipBackup: true });

      const beforeBytes = readFileSync(databasePath);
      const beforeDb = new Database(databasePath, { readonly: true });
      const beforePayload = beforeDb.query("SELECT payload FROM tasks WHERE task_id = 'task-1'").get();
      beforeDb.close();

      const taskPath = join(dataDir, "trip_tasks", "task-1.json");
      const changedTask = JSON.parse(readFileSync(taskPath, "utf8")) as Record<string, unknown>;
      changedTask.status = "failed";
      changedTask.error = "must not be imported";
      writeFileSync(taskPath, JSON.stringify(changedTask, null, 2));
      if (issue === "invalid") {
        writeFileSync(join(dataDir, "trip_tasks", "invalid.json"), "[]");
      } else {
        writeFileSync(join(dataDir, "trip_tasks", "duplicate.json"), JSON.stringify(changedTask, null, 2));
      }

      const result = migrateJsonToSqlite({ dataDir, skipBackup: true });

      expect(result.quickCheck).toBe("not-run");
      expect(issue === "invalid" ? result.invalidRecords : result.duplicateRecords).toHaveLength(1);
      expect(readFileSync(databasePath)).toEqual(beforeBytes);
      const afterDb = new Database(databasePath, { readonly: true });
      expect(afterDb.query("SELECT payload FROM tasks WHERE task_id = 'task-1'").get()).toEqual(beforePayload);
      afterDb.close();
    }
  });

  it("contains unsafe identifiers and exports colliding identifiers to distinct files", () => {
    const dataDir = fixture();
    const databasePath = join(dataDir, "youban.db");
    migrateJsonToSqlite({ dataDir, skipBackup: true });

    const ids = ["../../escaped", "./same", "same"];
    const conversationIds = ["../../conversation-escaped", "./conversation-same", "conversation-same"];
    const db = new Database(databasePath);
    const insert = db.query(`
      INSERT INTO tasks (
        task_id, plan_id, user_id, status, share_token, created_at, updated_at, payload
      ) VALUES (?, ?, '', 'completed', '', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)
    `);
    for (const id of ids) {
      insert.run(id, id, JSON.stringify({ task_id: id, plan_id: id, status: "completed" }));
    }
    const insertConversation = db.query(`
      INSERT INTO conversations (plan_id, user_id, payload, updated_at)
      VALUES (?, '', ?, '2026-08-01T00:00:00Z')
    `);
    for (const planId of conversationIds) {
      insertConversation.run(planId, JSON.stringify([{ role: "user", content: planId }]));
    }
    db.close();

    const outputDir = join(dataDir, "unsafe-export");
    const exported = exportSqliteToJson({ databasePath, outputDir });

    expect(exported.tasks).toBe(4);
    expect(existsSync(join(dataDir, "escaped.json"))).toBe(false);
    const taskFiles = readdirSync(join(outputDir, "trip_tasks"));
    expect(taskFiles).toHaveLength(4);
    expect(taskFiles.map((name) => {
      const payload = JSON.parse(readFileSync(join(outputDir, "trip_tasks", name), "utf8"));
      return payload.task_id;
    }).sort()).toEqual(["../../escaped", "./same", "same", "task-1"].sort());
    expect(existsSync(join(dataDir, "conversation-escaped.json"))).toBe(false);
    const conversationFiles = readdirSync(join(outputDir, "conversations"));
    expect(conversationFiles).toHaveLength(4);
    expect(conversationFiles.map((name) => {
      const payload = JSON.parse(readFileSync(join(outputDir, "conversations", name), "utf8"));
      return payload.plan_id;
    }).sort()).toEqual([...conversationIds, "task-1"].sort());
  });
});
