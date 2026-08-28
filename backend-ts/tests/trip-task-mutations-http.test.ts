import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { ConversationSessionRepository } from "../src/domain/conversation-sessions.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class NoopPlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) {
    return { success: true, data: request };
  }
}

const PLAN = {
  city: "北京",
  days: [{
    day_index: 0,
    attractions: [{ id: "itm_attr0001", name: "故宫", image_url: "/api/images/orphan.jpg" }],
    meals: [{ id: "itm_meal0001", type: "lunch", name: "午餐" }],
  }],
};

const runtimes: HttpRuntime[] = [];
const dirs: string[] = [];

function runtime() {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-task-mutation-"));
  dirs.push(dataDir);
  mkdirSync(join(dataDir, "images"), { recursive: true });
  const value = createHttpRuntime({ dataDir, planner: new NoopPlanner() });
  value.tasks.save(createTaskState("plan-1", {
    user_id: "owner-1",
    status: "completed",
    stage: "completed",
    progress: 100,
    result: {
      success: true,
      plan_id: "plan-1",
      task_id: "plan-1",
      user_id: "owner-1",
      data: { ...structuredClone(PLAN), plan_id: "nested-plan-1" },
    },
    request_payload: { city: "北京" },
  }), { immediate: true });
  value.conversations.save("plan-1", "owner-1", [{ role: "user", content: "私密创建对话" }]);
  runtimes.push(value);
  return value;
}

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function call(
  app: HttpRuntime["app"],
  method: string,
  path: string,
  body?: unknown,
  user = "owner-1",
  adminToken = "",
) {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": user,
      ...(adminToken ? { "x-admin-token": adminToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe("share, execution, and deletion contracts", () => {
  it("creates a stable 32-hex share code and exposes only the public result", async () => {
    const value = runtime();
    const first = await call(value.app, "POST", "/api/trip/share/plan-1");
    expect(first.status).toBe(200);
    const shared = await first.json() as Record<string, any>;
    expect(shared.share_code).toMatch(/^[a-f0-9]{32}$/);
    const second = await (await call(value.app, "POST", "/api/trip/share/plan-1")).json() as Record<string, any>;
    expect(second.share_code).toBe(shared.share_code);

    const publicResponse = await call(value.app, "GET", `/api/trip/share/${shared.share_code}`, undefined, "");
    const publicPayload = await publicResponse.json();
    expect(publicPayload).toEqual({
      status: "completed",
      result: { success: true, data: PLAN },
    });
    const raw = JSON.stringify(publicPayload);
    expect(raw).not.toContain("plan-1");
    expect(raw).not.toContain("nested-plan-1");
    expect(raw).not.toContain("owner-1");
    expect(raw).not.toContain("私密创建对话");
  });

  it("updates known item execution state and removes pending entries", async () => {
    const value = runtime();
    const done = await call(value.app, "PATCH", "/api/trip/plan/plan-1/items/itm_attr0001/status", {
      status: "done",
      actual_cost: 55,
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({
      success: true,
      execution: expect.objectContaining({ status: "done", actual_cost: 55, updated_at: expect.any(String) }),
    });
    const status = await call(value.app, "GET", "/api/trip/status/plan-1");
    expect((await status.json() as Record<string, any>).execution.itm_attr0001.status).toBe("done");

    const pending = await call(value.app, "PATCH", "/api/trip/plan/plan-1/items/itm_attr0001/status", {
      status: "pending",
    });
    expect(await pending.json()).toEqual({ success: true, execution: null });
    expect(value.tasks.get("plan-1")?.execution).toEqual({});

    const missing = await call(value.app, "PATCH", "/api/trip/plan/plan-1/items/itm_missing/status", {
      status: "done",
    });
    expect(missing.status).toBe(404);
  });

  it("soft-deletes a terminal plan while retaining task, session, conversation, and image data", async () => {
    const value = runtime();
    const image = join(value.dataDir, "images", "orphan.jpg");
    writeFileSync(image, "image");
    const sessions = new ConversationSessionRepository(join(value.dataDir, "youban.db"));
    sessions.create({
      sessionId: "session-1",
      userId: "owner-1",
      firstMessage: "北京三天",
      snapshot: { version: 1, items: [] },
    });
    sessions.linkPlan("session-1", "owner-1", "plan-1");
    sessions.markPlanned("session-1");

    const response = await call(value.app, "DELETE", "/api/trip/plan/plan-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, removed_images: 0 });
    expect(value.tasks.get("plan-1")).toBeDefined();
    expect(value.tasks.database.raw.query(
      "SELECT user_deleted_at FROM tasks WHERE task_id = ?",
    ).get("plan-1")).toEqual({ user_deleted_at: expect.any(String) });
    expect(sessions.getByPlanId("plan-1", { includeDeleted: true })).toEqual(expect.objectContaining({
      sessionId: "session-1",
      deletedAt: expect.any(String),
    }));
    expect(value.conversations.get("plan-1")).toEqual([{ role: "user", content: "私密创建对话" }]);
    expect(existsSync(image)).toBe(true);
    expect((await call(value.app, "GET", "/api/trip/history").then((result) => result.json()) as Record<string, any>).items)
      .toEqual([]);
    expect((await call(value.app, "GET", "/api/conversations").then((result) => result.json()) as Record<string, any>).items)
      .toEqual([]);
    expect((await call(value.app, "GET", "/api/trip/status/plan-1")).status).toBe(404);
    expect((await call(value.app, "GET", "/api/trip/plan/plan-1/conversation")).status).toBe(404);
    const stream = await call(value.app, "POST", "/api/chat/edit/stream", {
      message: "把故宫改到下午",
      trip_plan: PLAN,
      plan_id: "plan-1",
    });
    expect(stream.status).toBe(404);
    expect(await stream.json()).toEqual({ detail: "任务不存在" });
    expect((await call(value.app, "GET", "/api/trip/status/plan-1", undefined, "", "admin@123")).status)
      .toBe(200);
    expect((await call(value.app, "DELETE", "/api/trip/plan/plan-1")).status).toBe(200);
    sessions.close();
  });

  it("rejects non-owner sharing/deletion and processing deletion", async () => {
    const value = runtime();
    expect((await call(value.app, "POST", "/api/trip/share/plan-1", undefined, "other")).status).toBe(403);
    expect((await call(value.app, "DELETE", "/api/trip/plan/plan-1", undefined, "other")).status).toBe(403);
    const task = value.tasks.get("plan-1")!;
    value.tasks.save({ ...task, status: "processing", stage: "planning" }, { immediate: true });
    const processing = await call(value.app, "DELETE", "/api/trip/plan/plan-1");
    expect(processing.status).toBe(409);
    expect(await processing.json()).toEqual({ detail: "计划正在生成中，完成或失败后才能删除" });
  });
});
