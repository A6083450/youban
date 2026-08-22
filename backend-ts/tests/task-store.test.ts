import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteTaskStore,
  createTaskState,
  type TripTaskState,
} from "../src/domain/task-store.ts";

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
  it("creates a WAL database with the current schema version", () => {
    const path = databasePath();
    const store = new SqliteTaskStore(path);
    store.close();

    const db = new Database(path, { readonly: true });
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(db.query("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
    ).toEqual(expect.arrayContaining([
      { name: "conversations" },
      { name: "tasks" },
      { name: "users" },
    ]));
    db.close();
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
});
