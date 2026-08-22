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

function fixture(): string {
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
  writeFileSync(join(dataDir, "trip_tasks", "invalid.json"), "[]");
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
    const dataDir = fixture();
    const result = migrateJsonToSqlite({ dataDir, dryRun: true });

    expect(existsSync(join(dataDir, "youban.db"))).toBe(false);
    expect(result.schemaVersion).toBe(1);
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
  });
});
