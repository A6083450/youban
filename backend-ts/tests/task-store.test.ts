import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteTaskStore,
  buildTaskEvent,
  createTaskState,
  type TripTaskState,
} from "../src/domain/task-store.ts";
import { INITIAL_SCHEMA_SQL, SKILL_CATALOG_SCHEMA_SQL } from "../src/domain/db-schema.ts";
import { YoubanDatabase } from "../src/domain/database.ts";

const tempDirs: string[] = [];

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "youban-task-store-"));
  tempDirs.push(dir);
  return join(dir, "youban.db");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SqliteTaskStore", () => {
  it("initializes deadline metadata and emits only non-null compatible fields", () => {
    const task = createTaskState("task-metadata");
    expect(task).toEqual(expect.objectContaining({
      plan_quality: null,
      enhancement_status: null,
      deadline_seconds: null,
      generation_elapsed_ms: null,
      fast_plan_revision: null,
    }));
    expect(buildTaskEvent(task)).not.toEqual(expect.objectContaining({
      plan_quality: expect.anything(),
    }));

    const event = buildTaskEvent({
      ...task,
      plan_quality: "fast",
      enhancement_status: "running",
      deadline_seconds: 6,
      generation_elapsed_ms: 5_500,
      fast_plan_revision: "revision-1",
    });
    expect(event).toEqual(expect.objectContaining({
      plan_quality: "fast",
      enhancement_status: "running",
      deadline_seconds: 6,
      generation_elapsed_ms: 5_500,
      fast_plan_revision: "revision-1",
    }));
  });

  it("creates a WAL database with the current schema version", () => {
    const path = databasePath();
    const store = new SqliteTaskStore(path);
    store.close();

    const db = new Database(path, { readonly: true });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 3 });
    expect(db.query("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
    ).toEqual(expect.arrayContaining([
      { name: "conversations" },
      { name: "conversation_sessions" },
      { name: "tasks" },
      { name: "users" },
    ]));
    db.close();
  });

  it("migrates a version-two database without losing tasks or its existing rows", () => {
    const path = databasePath();
    const now = "2026-08-22T00:00:00.000Z";
    const database = new Database(path);
    database.exec(INITIAL_SCHEMA_SQL);
    database.exec(SKILL_CATALOG_SCHEMA_SQL);
    database.exec("PRAGMA user_version = 2");
    database.query(
      "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("t1", "t1", "u1", "completed", "", now, now, "{}");
    database.close();

    const migrated = new YoubanDatabase(path);
    expect(migrated.raw.query("PRAGMA user_version").get()).toEqual({ user_version: 3 });
    expect(migrated.raw.query("SELECT task_id FROM tasks").get()).toEqual({ task_id: "t1" });
    expect(migrated.raw.query("SELECT user_deleted_at FROM tasks WHERE task_id = 't1'").get()).toEqual({
      user_deleted_at: null,
    });
    expect(
      migrated.raw.query("SELECT name FROM sqlite_master WHERE name = 'conversation_sessions'").get(),
    ).toBeDefined();
    expect(
      migrated.raw.query("SELECT name FROM sqlite_master WHERE name = 'managed_skills'").get(),
    ).toBeDefined();
    expect(
      migrated.raw.query("SELECT name FROM sqlite_master WHERE name = 'skill_versions'").get(),
    ).toBeDefined();
    expect(
      migrated.raw.query("SELECT name FROM sqlite_master WHERE name = 'skill_agent_assignments'").get(),
    ).toBeDefined();
    expect(
      migrated.raw.query("SELECT name FROM sqlite_master WHERE name = 'skill_audit_events'").get(),
    ).toBeDefined();
    migrated.close();
  });

  it("debounces progress writes but flushes terminal state immediately", async () => {
    const path = databasePath();
    const store = new SqliteTaskStore(path, { flushDelayMs: 30 });
    const task = createTaskState("task-debounce", {
      user_id: "owner-1",
      request_payload: { city: "北京", travel_days: 3 },
    });

    store.save(task);
    const observer = new Database(path, { readonly: true });
    expect(observer.query("SELECT count(*) AS count FROM tasks").get()).toEqual({ count: 0 });

    await Bun.sleep(50);
    expect(observer.query("SELECT count(*) AS count FROM tasks").get()).toEqual({ count: 1 });

    task.status = "completed";
    task.stage = "completed";
    task.progress = 100;
    task.result = { success: true, data: { city: "北京", days: [] } };
    store.save(task);
    expect(
      observer.query("SELECT status FROM tasks WHERE task_id = ?").get(task.task_id),
    ).toEqual({ status: "completed" });

    observer.close();
    store.close();
  });

  it("marks interrupted tasks failed on restart and preserves retry payload", () => {
    const path = databasePath();
    const first = new SqliteTaskStore(path, { flushDelayMs: 1_000 });
    const task = createTaskState("task-restart", {
      user_id: "owner-1",
      request_payload: { city: "成都", travel_days: 4 },
      checkpoint: { segments: { "day:1": { status: "completed" } } },
    });
    first.save(task);
    first.flush();
    first.close();

    const second = new SqliteTaskStore(path);
    const recovered = second.get(task.task_id);
    expect(recovered?.status).toBe("failed");
    expect(recovered?.stage).toBe("failed");
    expect(recovered?.progress).toBe(100);
    expect(recovered?.error).toBe("服务已重启，未完成的旅行规划任务无法恢复，请重新生成。");
    expect(recovered?.request_payload).toEqual({ city: "成都", travel_days: 4 });
    expect(recovered?.checkpoint).toEqual({ segments: { "day:1": { status: "completed" } } });
    second.close();
  });

  it("retains a completed fast result and marks interrupted enhancement failed on restart", () => {
    const path = databasePath();
    const first = new SqliteTaskStore(path);
    const result = { success: true, data: { city: "成都", days: [{ day_index: 0 }] } };
    first.save(createTaskState("task-fast-restart", {
      user_id: "owner-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      message: "旅行计划生成完成",
      result,
      plan_quality: "fast",
      enhancement_status: "running",
      deadline_seconds: 6,
      generation_elapsed_ms: 5_500,
      fast_plan_revision: "revision-1",
    }), { immediate: true });
    first.close();

    const second = new SqliteTaskStore(path);
    expect(second.get("task-fast-restart")).toEqual(expect.objectContaining({
      status: "completed",
      stage: "completed",
      progress: 100,
      result,
      plan_quality: "fast",
      enhancement_status: "failed",
      fast_plan_revision: "revision-1",
    }));
    second.close();
  });

  it("assigns stable itinerary item ids on save and persists legacy lazy migration", () => {
    const path = databasePath();
    const first = new SqliteTaskStore(path);
    const task = createTaskState("task-items", {
      status: "completed",
      stage: "completed",
      progress: 100,
      result: {
        success: true,
        data: {
          days: [{
            attractions: [{ name: "故宫", poi_id: "P1" }],
            meals: [{ id: "itm_existing", name: "午餐", type: "lunch" }],
          }],
        },
      },
    });
    first.save(task, { immediate: true });
    const saved = first.get(task.task_id)!;
    const savedDays = (saved.result as Record<string, any>).data.days;
    expect(savedDays[0].attractions[0].id).toMatch(/^itm_[a-f0-9]{8}$/);
    expect(savedDays[0].meals[0].id).toBe("itm_existing");
    const stableId = savedDays[0].attractions[0].id;
    first.close();

    const db = new Database(path);
    const row = db.query("SELECT payload FROM tasks WHERE task_id = ?").get(task.task_id) as { payload: string };
    const legacy = JSON.parse(row.payload);
    delete legacy.result.data.days[0].attractions[0].id;
    db.query("UPDATE tasks SET payload = ? WHERE task_id = ?").run(JSON.stringify(legacy), task.task_id);
    db.close();

    const second = new SqliteTaskStore(path);
    const migrated = second.get(task.task_id)!;
    const migratedId = (migrated.result as Record<string, any>).data.days[0].attractions[0].id;
    expect(migratedId).toMatch(/^itm_[a-f0-9]{8}$/);
    second.close();
    const observer = new Database(path, { readonly: true });
    const persisted = observer.query("SELECT payload FROM tasks WHERE task_id = ?").get(task.task_id) as { payload: string };
    expect(JSON.parse(persisted.payload).result.data.days[0].attractions[0].id).toBe(migratedId);
    expect(migratedId).not.toBe(stableId);
    observer.close();
  });

  it("builds history summaries and isolates owned from legacy tasks", () => {
    const path = databasePath();
    const store = new SqliteTaskStore(path);
    const tasks: TripTaskState[] = [
      createTaskState("owned", {
        user_id: "owner-1",
        status: "completed",
        stage: "completed",
        progress: 100,
        request_payload: {
          city: "北京",
          cities: ["北京", "西安"],
          start_date: "2026-08-01",
          end_date: "2026-08-05",
          travel_days: 5,
        },
        result: { data: { cities: ["北京", "西安"], days: [], overall_suggestions: "慢慢走" } },
      }),
      createTaskState("legacy", {
        request_payload: {
          city: "成都",
          start_date: "2026-09-01",
          end_date: "2026-09-03",
          travel_days: 3,
        },
      }),
    ];
    for (const task of tasks) store.save(task, { immediate: true });

    expect(store.listHistory({ userId: "owner-1", limit: 10 })).toEqual([
      expect.objectContaining({ task_id: "owned", city: "北京 → 西安", travel_days: 5 }),
    ]);
    expect(store.listHistory({ userId: "", limit: 10 })).toEqual([
      expect.objectContaining({ task_id: "legacy", city: "成都", status: "processing" }),
    ]);
    store.close();
  });

  it("hides user-soft-deleted tasks from owners while retaining them for administrators", () => {
    const path = databasePath();
    const store = new SqliteTaskStore(path);
    const task = createTaskState("hidden-task", {
      user_id: "owner-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      request_payload: { city: "北京", travel_days: 3 },
      result: { data: { city: "北京", days: [] } },
    });
    store.save(task, { immediate: true });

    expect(store.softDelete(task.task_id)).toBe(true);
    expect(store.listHistory({ userId: "owner-1", limit: 10 })).toEqual([]);
    expect(store.listHistory({ userId: "", limit: 10, allUsers: true })).toEqual([
      expect.objectContaining({ task_id: task.task_id }),
    ]);
    store.close();
  });
});
