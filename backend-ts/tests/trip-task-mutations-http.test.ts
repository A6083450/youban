import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
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
    result: { success: true, data: structuredClone(PLAN) },
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

function call(app: HttpRuntime["app"], method: string, path: string, body?: unknown, user = "owner-1") {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": user },
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
      plan_id: "plan-1",
      status: "completed",
      result: { success: true, data: PLAN },
    });
    const raw = JSON.stringify(publicPayload);
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

  it("deletes a terminal plan, its conversation, and an unreferenced cached image", async () => {
    const value = runtime();
    const image = join(value.dataDir, "images", "orphan.jpg");
    writeFileSync(image, "image");
    const response = await call(value.app, "DELETE", "/api/trip/plan/plan-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, removed_images: 1 });
    expect(value.tasks.get("plan-1")).toBeUndefined();
    expect(value.conversations.get("plan-1")).toEqual([]);
    expect(existsSync(image)).toBe(false);
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
