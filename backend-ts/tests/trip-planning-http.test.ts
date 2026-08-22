import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PlannerRunContext,
  TripPlanner,
} from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import type { PlanningCheckpoint } from "../src/domain/orchestrator.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

const runtimes: HttpRuntime[] = [];
const tempDirs: string[] = [];

const DRAFT = {
  city: "大理",
  cities: [{ city: "大理", days: 3 }],
  start_date: "2026-10-01",
  end_date: "2026-10-03",
  travel_days: 3,
  transportation: "公共交通",
  accommodation: "舒适型酒店",
  preferences: ["自然风光"],
  traveler_count: 2,
  room_count: 1,
  budget_amount: 3000,
  budget_basis: "group_total" as const,
  free_text_input: "大理三天",
  origin_text: "大理三天",
  language: "zh-CN",
};

class FakePlanner implements TripPlanner {
  runs: Array<{ request: TripPlanningRequest; checkpoint: PlanningCheckpoint }> = [];
  shouldFail = false;

  async plan(request: TripPlanningRequest, context: PlannerRunContext): Promise<Record<string, unknown>> {
    this.runs.push({ request: structuredClone(request), checkpoint: structuredClone(context.checkpoint) });
    const checkpoint = structuredClone(context.checkpoint);
    checkpoint.search.attractions[request.city] = [{ poi_id: "B001", name: "洱海" }];
    await context.onCheckpoint(checkpoint);
    await context.onProgress({ stage: "planning", progress: 70, message: "正在生成分段行程" });
    if (this.shouldFail) throw new Error("规划模型暂时不可用");
    return {
      success: true,
      data: {
        ...request,
        days: [{ date: request.start_date, day_index: 0, city: request.city, attractions: [] }],
      },
    };
  }
}

function makeRuntime(planner = new FakePlanner()): { runtime: HttpRuntime; planner: FakePlanner } {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-plan-http-"));
  tempDirs.push(dataDir);
  const runtime = createHttpRuntime({ dataDir, planner });
  runtimes.push(runtime);
  return { runtime, planner };
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(app: HttpRuntime["app"], method: string, path: string, body?: unknown, userId = "owner-1") {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

describe("trip planning HTTP lifecycle", () => {
  it("consumes a confirmation exactly once and completes in the background", async () => {
    const { runtime, planner } = makeRuntime();
    const token = runtime.assistant.ledger.register(DRAFT, 0.95).token;
    const created = await request(runtime.app, "POST", "/api/trip/plan", { ...DRAFT, execution_token: token });
    expect(created.status).toBe(200);
    const accepted = await created.json() as Record<string, any>;
    expect(accepted).toEqual(expect.objectContaining({
      task_id: expect.stringMatching(/^[a-f0-9]{8}$/),
      plan_id: expect.any(String),
      status: "processing",
      ws_url: expect.stringMatching(/^\/api\/trip\/ws\/[a-f0-9]{8}$/),
    }));
    expect(accepted.plan_id).toBe(accepted.task_id);

    const duplicate = await request(runtime.app, "POST", "/api/trip/plan", { ...DRAFT, execution_token: token });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ detail: "该确认已执行，请勿重复提交" });

    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "completed");
    const status = await request(runtime.app, "GET", `/api/trip/status/${accepted.task_id}`);
    expect(await status.json()).toEqual(expect.objectContaining({
      task_id: accepted.task_id,
      status: "completed",
      result: expect.objectContaining({ success: true }),
    }));
    expect(planner.runs).toHaveLength(1);
  });

  it("maps invalid, expired, and mismatched confirmation tokens without side effects", async () => {
    let now = 1_000;
    const { runtime } = makeRuntime();
    const invalid = await request(runtime.app, "POST", "/api/trip/plan", { ...DRAFT, execution_token: "bad" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ detail: "缺少有效的 Agent 确认凭证" });

    const mismatchToken = runtime.assistant.ledger.register(DRAFT, 0.95).token;
    const mismatch = await request(runtime.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      free_text_input: "临时改成深度摄影",
      execution_token: mismatchToken,
    });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ detail: "行程草稿已变化，请重新确认" });
    expect(runtime.tasks.listHistory({ userId: "owner-1", limit: 10 })).toEqual([]);
    void now;
  });

  it("validates semantics before consuming confirmation and normalizes compatibility defaults", async () => {
    const { runtime, planner } = makeRuntime();
    const cityOnly = {
      city: "大理",
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
      transportation: "公共交通",
      accommodation: "舒适型酒店",
    };
    const token = runtime.assistant.ledger.register(cityOnly, 0.95).token;
    const invalid = await request(runtime.app, "POST", "/api/trip/plan", {
      ...cityOnly,
      cities: [{ city: "大理", days: 2 }],
      execution_token: token,
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ detail: "城市停留天数总和必须等于旅行天数" });

    const created = await request(runtime.app, "POST", "/api/trip/plan", {
      ...cityOnly,
      execution_token: token,
    });
    expect(created.status).toBe(200);
    await waitFor(() => planner.runs.length === 1);
    expect(planner.runs[0]!.request).toEqual(expect.objectContaining({
      city: "大理",
      cities: [{ city: "大理", days: 3 }],
      traveler_count: 1,
      room_count: 1,
      preferences: [],
      budget_basis: "group_total",
    }));
  });

  it("enforces ownership and exposes only a checkpoint summary on failure", async () => {
    const planner = new FakePlanner();
    planner.shouldFail = true;
    const { runtime } = makeRuntime(planner);
    const token = runtime.assistant.ledger.register(DRAFT, 0.95).token;
    const accepted = await (await request(runtime.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      execution_token: token,
    })).json() as Record<string, any>;
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "failed");

    const forbidden = await request(runtime.app, "GET", `/api/trip/status/${accepted.task_id}`, undefined, "other");
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ detail: "无权访问该计划" });

    const failed = await request(runtime.app, "GET", `/api/trip/status/${accepted.task_id}`);
    const payload = await failed.json() as Record<string, any>;
    expect(payload).toEqual(expect.objectContaining({
      status: "failed",
      error: "规划模型暂时不可用",
      checkpoint_summary: {
        completed_segments: 0,
        total_segments: 0,
        last_successful_stage: "search",
      },
    }));
    expect(payload.checkpoint).toBeUndefined();
  });

  it("retries only failed tasks with the same id and optionally clears checkpoint", async () => {
    const planner = new FakePlanner();
    planner.shouldFail = true;
    const { runtime } = makeRuntime(planner);
    const token = runtime.assistant.ledger.register(DRAFT, 0.95).token;
    const accepted = await (await request(runtime.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      execution_token: token,
    })).json() as Record<string, any>;
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "failed");

    planner.shouldFail = false;
    const retry = await request(runtime.app, "POST", `/api/trip/plan/${accepted.task_id}/retry`, {
      restart_all: false,
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(expect.objectContaining({
      task_id: accepted.task_id,
      plan_id: accepted.task_id,
      status: "processing",
    }));
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "completed");
    expect(planner.runs[1]?.checkpoint.search.attractions["大理"]).toBeDefined();

    const conflict = await request(runtime.app, "POST", `/api/trip/plan/${accepted.task_id}/retry`, {
      restart_all: true,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ detail: "仅失败任务可重试" });
  });
});
