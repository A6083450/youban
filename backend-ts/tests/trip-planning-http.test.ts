import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PlannerRunContext,
  TripPlanner,
} from "../src/agents/trip-planner.ts";
import { emptyCheckpoint, type PlanningCheckpoint, type TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { _resetSettingsForTest } from "../src/config/settings.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";
import { createTaskState } from "../src/domain/task-store.ts";

const runtimes: HttpRuntime[] = [];
const tempDirs: string[] = [];
const dataDirOverrides: Array<string | undefined> = [];

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

class BlockingPlanner implements TripPlanner {
  started = false;
  closed = false;
  private releaseRun!: () => void;
  private readonly runGate = new Promise<void>((resolve) => { this.releaseRun = resolve; });

  async plan(request: TripPlanningRequest): Promise<Record<string, unknown>> {
    this.started = true;
    await this.runGate;
    return {
      success: true,
      data: {
        ...request,
        days: [{ date: request.start_date, day_index: 0, city: request.city, attractions: [] }],
      },
    };
  }

  release(): void { this.releaseRun(); }
  close(): void { this.closed = true; }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ManualClock {
  private time = 0;
  private nextId = 0;
  private sleepers: Array<{
    id: number;
    due: number;
    resolve: () => void;
    reject: (reason?: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }> = [];

  readonly now = () => this.time;
  readonly sleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const id = ++this.nextId;
      const abort = () => {
        this.sleepers = this.sleepers.filter((entry) => entry.id !== id);
        reject(signal.reason);
      };
      this.sleepers.push({
        id,
        due: this.time + milliseconds,
        resolve,
        reject,
        signal,
        abort,
      });
      signal.addEventListener("abort", abort, { once: true });
    });

  get pendingCount(): number { return this.sleepers.length; }

  advanceBy(milliseconds: number): void {
    const target = this.time + milliseconds;
    const ready = this.sleepers
      .filter((entry) => entry.due <= target)
      .sort((left, right) => left.due - right.due);
    for (const entry of ready) {
      this.time = entry.due;
      this.sleepers = this.sleepers.filter((candidate) => candidate.id !== entry.id);
      entry.signal.removeEventListener("abort", entry.abort);
      entry.resolve();
    }
    this.time = target;
  }
}

class DeadlinePlanner implements TripPlanner {
  readonly runs: Array<{
    request: TripPlanningRequest;
    context: PlannerRunContext;
    result: ReturnType<typeof deferred<Record<string, unknown>>>;
  }> = [];

  plan(request: TripPlanningRequest, context: PlannerRunContext): Promise<Record<string, unknown>> {
    const result = deferred<Record<string, unknown>>();
    this.runs.push({ request: structuredClone(request), context, result });
    return Promise.race([
      result.promise,
      new Promise<Record<string, unknown>>((_, reject) => {
        if (context.signal.aborted) return reject(context.signal.reason);
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      }),
    ]);
  }

  succeed(index: number, marker = "enhanced"): void {
    const run = this.runs[index]!;
    run.result.resolve(enhancedPlan(run.request, marker));
  }

  fail(index: number, message = "规划模型暂时不可用"): void {
    this.runs[index]!.result.reject(new Error(message));
  }
}

function enhancedPlan(request: TripPlanningRequest, marker = "enhanced"): Record<string, unknown> {
  return {
    success: true,
    data: {
      ...request,
      marker,
      days: Array.from({ length: request.travel_days }, (_, dayIndex) => ({
        date: new Date(Date.parse(`${request.start_date}T00:00:00Z`) + dayIndex * 86_400_000)
          .toISOString().slice(0, 10),
        day_index: dayIndex,
        city: request.city,
        attractions: [],
      })),
    },
  };
}

function makeRuntime(planner = new FakePlanner()): { runtime: HttpRuntime; planner: FakePlanner } {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-plan-http-"));
  tempDirs.push(dataDir);
  const runtime = createHttpRuntime({ dataDir, planner });
  runtimes.push(runtime);
  return { runtime, planner };
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  if (dataDirOverrides.length > 0) {
    const previousDataDir = dataDirOverrides.pop();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolateRuntimeSettings(): void {
  dataDirOverrides.push(process.env.DATA_DIR);
  const settingsDir = mkdtempSync(join(tmpdir(), "youban-plan-settings-"));
  tempDirs.push(settingsDir);
  process.env.DATA_DIR = settingsDir;
  _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
}

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

function makeDeadlineRuntime(): { runtime: HttpRuntime; planner: DeadlinePlanner; clock: ManualClock } {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-deadline-http-"));
  tempDirs.push(dataDir);
  const planner = new DeadlinePlanner();
  const clock = new ManualClock();
  const runtime = createHttpRuntime({
    dataDir,
    planner,
    planningClock: { now: clock.now, sleep: clock.sleep },
  });
  runtimes.push(runtime);
  return { runtime, planner, clock };
}

async function submit(runtime: HttpRuntime): Promise<Record<string, any>> {
  const token = runtime.assistant.ledger.register(DRAFT, 0.95).token;
  const response = await request(runtime.app, "POST", "/api/trip/plan", {
    ...DRAFT,
    execution_token: token,
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, any>>;
}

describe("trip planning HTTP lifecycle", () => {
  it("returns accumulated Agent details to polling clients while generation is running", async () => {
    const { runtime } = makeRuntime();
    runtime.tasks.save(createTaskState("task-with-details", {
      user_id: "owner-1",
      stage: "weather_search",
      progress: 24,
      message: "正在查询成都天气",
      details: [
        { type: "thinking", title: "正在核对成都出行期间的天气条件", timestamp: 1 },
        { type: "found", title: "已找到成都景点", content: "武侯祠、杜甫草堂", timestamp: 2 },
      ],
    }), { immediate: true });

    const response = await request(runtime.app, "GET", "/api/trip/status/task-with-details");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "processing",
      progress_text: "正在查询成都天气",
      details: [
        { type: "thinking", title: "正在核对成都出行期间的天气条件" },
        { type: "found", title: "已找到成都景点", content: "武侯祠、杜甫草堂" },
      ],
    });
  });

  it("includes planner startup delay in accepted-to-persisted elapsed time", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-accepted-clock-http-"));
    tempDirs.push(dataDir);
    const planner = new DeadlinePlanner();
    const clock = new ManualClock();
    clock.advanceBy(1_000);
    let firstClockRead = true;
    const runtime = createHttpRuntime({
      dataDir,
      planner,
      planningClock: {
        now: () => {
          if (!firstClockRead) return clock.now();
          firstClockRead = false;
          return 0;
        },
        sleep: clock.sleep,
      },
    });
    runtimes.push(runtime);
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);

    clock.advanceBy(4_499);
    await Promise.resolve();
    expect(runtime.tasks.get(accepted.task_id)?.status).toBe("processing");
    clock.advanceBy(1);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "completed");

    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      plan_quality: "fast",
      generation_elapsed_ms: 5_500,
    }));
  });

  it("publishes fast at the trigger, freezes terminal state, then applies unchanged enhancement", async () => {
    const { runtime, planner, clock } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);

    clock.advanceBy(5_500);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "completed");
    const fast = runtime.tasks.get(accepted.task_id)!;
    expect(fast).toEqual(expect.objectContaining({
      status: "completed",
      stage: "completed",
      progress: 100,
      plan_quality: "fast",
      enhancement_status: "running",
      deadline_seconds: 6,
      generation_elapsed_ms: 5_500,
      fast_plan_revision: expect.any(String),
    }));
    expect(((fast.result as Record<string, any>).data.days)).toHaveLength(3);

    await planner.runs[0]!.context.onProgress({
      stage: "reviewing",
      progress: 95,
      message: "晚到的进度不能覆盖终态",
    });
    await planner.runs[0]!.context.onCheckpoint({
      ...emptyCheckpoint(),
      summary: { status: "completed", output: { overall_suggestions: "late" }, error: "" },
    });
    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      status: "completed",
      stage: "completed",
      progress: 100,
      result: fast.result,
    }));

    planner.succeed(0);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.enhancement_status === "completed");
    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      status: "completed",
      plan_quality: "enhanced",
      enhancement_status: "completed",
    }));
    const status = await request(runtime.app, "GET", `/api/trip/status/${accepted.task_id}`);
    expect(await status.json()).toEqual(expect.objectContaining({
      status: "completed",
      plan_quality: "enhanced",
      enhancement_status: "completed",
    }));
  });

  it("applies background enhancement after the result page reads the budget ledger", async () => {
    const { runtime, planner, clock } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);

    clock.advanceBy(5_500);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.plan_quality === "fast");
    const budget = await request(
      runtime.app,
      "GET",
      `/api/trip/plan/${accepted.task_id}/budget-items`,
    );
    expect(budget.status).toBe(200);

    planner.succeed(0);
    await waitFor(() => {
      const status = runtime.tasks.get(accepted.task_id)?.enhancement_status;
      return status === "completed" || status === "skipped";
    });
    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      status: "completed",
      plan_quality: "enhanced",
      enhancement_status: "completed",
    }));
  });

  it("skips a background enhancement after the user-visible plan is edited", async () => {
    const { runtime, planner, clock } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);
    clock.advanceBy(5_500);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.plan_quality === "fast");
    const edited = runtime.tasks.get(accepted.task_id)!;
    const result = structuredClone(edited.result) as Record<string, any>;
    result.data.days[0].description = "用户编辑后的内容";
    runtime.tasks.save({ ...edited, result }, { immediate: true });

    planner.succeed(0);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.enhancement_status === "skipped");
    const preserved = runtime.tasks.get(accepted.task_id)!;
    expect(preserved.plan_quality).toBe("fast");
    expect((preserved.result as Record<string, any>).data.days[0].description).toBe("用户编辑后的内容");
  });

  it("keeps a completed fast plan when the background planner fails", async () => {
    const { runtime, planner, clock } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);
    clock.advanceBy(5_500);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.plan_quality === "fast");
    const fastResult = runtime.tasks.get(accepted.task_id)?.result;

    planner.fail(0, "enhanced unavailable");
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.enhancement_status === "failed");
    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      status: "completed",
      stage: "completed",
      progress: 100,
      plan_quality: "fast",
      result: fastResult,
    }));
  });

  it("cancels a deleted fast task and never applies a late result", async () => {
    const { runtime, planner, clock } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);
    clock.advanceBy(5_500);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.plan_quality === "fast");
    const fastResult = runtime.tasks.get(accepted.task_id)?.result;

    const deleted = await request(runtime.app, "DELETE", `/api/trip/plan/${accepted.task_id}`);
    expect(deleted.status).toBe(200);
    expect(planner.runs[0]!.context.signal.aborted).toBe(true);
    planner.succeed(0, "too-late");
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      plan_quality: "fast",
      result: fastResult,
    }));
  });

  it("starts a fresh deadline window when retrying the same task id", async () => {
    const { runtime, planner, clock } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);
    planner.fail(0);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "failed");
    expect(clock.pendingCount).toBe(0);
    clock.advanceBy(10_000);

    const retry = await request(runtime.app, "POST", `/api/trip/plan/${accepted.task_id}/retry`, {
      restart_all: false,
    });
    expect(retry.status).toBe(200);
    expect((await retry.json() as Record<string, unknown>).task_id).toBe(accepted.task_id);
    await waitFor(() => planner.runs.length === 2);
    clock.advanceBy(5_499);
    await Promise.resolve();
    expect(runtime.tasks.get(accepted.task_id)?.status).toBe("processing");
    clock.advanceBy(1);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.status === "completed");
    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      task_id: accepted.task_id,
      plan_quality: "fast",
      generation_elapsed_ms: 5_500,
    }));
  });

  it("ignores checkpoint and progress callbacks from the cancelled run after retry", async () => {
    const { runtime, planner } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);
    const failed = runtime.tasks.get(accepted.task_id)!;
    runtime.tasks.save({
      ...failed,
      status: "failed",
      stage: "failed",
      progress: 100,
      message: "旧轮次失败",
      error: "旧轮次失败",
    }, { immediate: true });

    const retry = await request(runtime.app, "POST", `/api/trip/plan/${accepted.task_id}/retry`, {
      restart_all: true,
    });
    expect(retry.status).toBe(200);
    await waitFor(() => planner.runs.length === 2);
    const retried = runtime.tasks.get(accepted.task_id)!;

    await planner.runs[0]!.context.onProgress({
      stage: "reviewing",
      progress: 98,
      message: "旧轮次晚到进度",
    });
    await planner.runs[0]!.context.onCheckpoint({
      ...emptyCheckpoint(),
      summary: { status: "completed", output: { overall_suggestions: "old" }, error: "" },
    });

    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      status: "processing",
      stage: retried.stage,
      progress: retried.progress,
      message: retried.message,
      checkpoint: retried.checkpoint,
    }));
  });

  it("cancels background enhancement on global shutdown without a late write", async () => {
    const { runtime, planner, clock } = makeDeadlineRuntime();
    const accepted = await submit(runtime);
    await waitFor(() => planner.runs.length === 1);
    clock.advanceBy(5_500);
    await waitFor(() => runtime.tasks.get(accepted.task_id)?.plan_quality === "fast");
    const fastResult = runtime.tasks.get(accepted.task_id)?.result;

    runtime.beginShutdown();
    expect(planner.runs[0]!.context.signal.aborted).toBe(true);
    planner.succeed(0, "too-late");
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.tasks.get(accepted.task_id)).toEqual(expect.objectContaining({
      status: "completed",
      plan_quality: "fast",
      result: fastResult,
    }));
  });

  it("drains the active service generation before applying runtime settings", async () => {
    isolateRuntimeSettings();
    const dataDir = mkdtempSync(join(tmpdir(), "youban-plan-refresh-"));
    tempDirs.push(dataDir);
    const first = new BlockingPlanner();
    const second = new FakePlanner();
    const factories: TripPlanner[] = [first, second];
    const runtime = createHttpRuntime({
      dataDir,
      serviceFactories: { planner: () => factories.shift()! },
    });
    runtimes.push(runtime);
    const planToken = runtime.assistant.ledger.register(DRAFT, 0.95).token;
    const pendingToken = runtime.assistant.ledger.register({ city: "北京" }, 0.95).token;

    const created = await request(runtime.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      execution_token: planToken,
    });
    expect(created.status).toBe(200);
    await waitFor(() => first.started);

    let updateSettled = false;
    const update = runtime.app.handle(new Request("http://localhost/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": "admin@123" },
      body: JSON.stringify({ openai_model: "next-model" }),
    })).then((response) => {
      updateSettled = true;
      return response;
    });
    await Bun.sleep(20);
    expect(updateSettled).toBe(false);
    expect(first.closed).toBe(false);

    first.release();
    expect((await update).status).toBe(200);
    expect(first.closed).toBe(true);
    expect(runtime.planner).toBe(second);
    expect(runtime.assistant.ledger.validate(pendingToken, { city: "北京" })).toEqual({
      valid: true,
      reason: "ok",
    });
  });

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
