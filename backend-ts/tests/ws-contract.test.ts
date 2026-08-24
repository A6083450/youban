import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

const runtimes: HttpRuntime[] = [];
const tempDirs: string[] = [];

class ManualClock {
  private time = 0;
  private sleepers: Array<{
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
      const entry = {
        due: this.time + milliseconds,
        resolve,
        reject,
        signal,
        abort: () => undefined,
      };
      entry.abort = () => {
        this.sleepers = this.sleepers.filter((candidate) => candidate !== entry);
        reject(signal.reason);
      };
      this.sleepers.push(entry);
      signal.addEventListener("abort", entry.abort, { once: true });
    });

  advanceBy(milliseconds: number): void {
    const target = this.time + milliseconds;
    for (const entry of this.sleepers.filter((candidate) => candidate.due <= target)) {
      this.time = entry.due;
      this.sleepers = this.sleepers.filter((candidate) => candidate !== entry);
      entry.signal.removeEventListener("abort", entry.abort);
      entry.resolve();
    }
    this.time = target;
  }
}

class SlowPlanner implements TripPlanner {
  started = false;

  plan(_request: TripPlanningRequest, context: PlannerRunContext): Promise<Record<string, unknown>> {
    this.started = true;
    return new Promise((_, reject) => {
      if (context.signal.aborted) return reject(context.signal.reason);
      context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    });
  }
}

function startRuntime(): { runtime: HttpRuntime; baseUrl: string } {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-ws-"));
  tempDirs.push(dataDir);
  const runtime = createHttpRuntime({ dataDir });
  runtimes.push(runtime);
  runtime.app.listen({ hostname: "127.0.0.1", port: 0 });
  const port = runtime.app.server?.port;
  if (!port) throw new Error("test server did not bind a port");
  return { runtime, baseUrl: `ws://127.0.0.1:${port}` };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.app.stop(true);
    await runtime.close();
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function collect(url: string): Promise<{ messages: Record<string, any>[]; code: number }> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, any>[] = [];
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`websocket timeout for ${url}`));
    }, 2_000);
    socket.onmessage = (event) => messages.push(JSON.parse(String(event.data)));
    socket.onerror = () => reject(new Error(`websocket error for ${url}`));
    socket.onclose = (event) => {
      clearTimeout(timeout);
      resolve({ messages, code: event.code });
    };
  });
}

function collectWhile(url: string, update: () => void): Promise<{ messages: Record<string, any>[]; code: number }> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, any>[] = [];
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => reject(new Error(`websocket timeout for ${url}`)), 2_000);
    socket.onmessage = (event) => {
      messages.push(JSON.parse(String(event.data)));
      if (messages.length === 1) update();
    };
    socket.onerror = () => reject(new Error(`websocket error for ${url}`));
    socket.onclose = (event) => {
      clearTimeout(timeout);
      resolve({ messages, code: event.code });
    };
  });
}

function expectUpgradeRejected(url: string): Promise<{ opened: boolean }> {
  return new Promise((resolve, reject) => {
    let opened = false;
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`websocket timeout for ${url}`));
    }, 2_000);
    socket.onopen = () => { opened = true; };
    socket.onerror = () => {
      clearTimeout(timeout);
      resolve({ opened });
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      resolve({ opened });
    };
  });
}

function handshakeStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const socket = connect(Number(target.port), target.hostname);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`websocket handshake timeout for ${url}`));
    }, 2_000);
    socket.on("connect", () => {
      socket.write([
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"));
    });
    socket.once("data", (chunk) => {
      clearTimeout(timeout);
      socket.destroy();
      const match = String(chunk).match(/^HTTP\/1\.1 (\d{3})/);
      if (!match) return reject(new Error(`invalid websocket handshake response: ${String(chunk)}`));
      resolve(Number(match[1]));
    });
    socket.once("error", reject);
  });
}

describe("trip task websocket contract", () => {
  it("publishes a slow seven-day request through the existing terminal frame at 5.5 seconds", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-ws-deadline-"));
    tempDirs.push(dataDir);
    const clock = new ManualClock();
    const planner = new SlowPlanner();
    const runtime = createHttpRuntime({
      dataDir,
      planner,
      planningClock: { now: clock.now, sleep: clock.sleep },
    });
    runtimes.push(runtime);
    runtime.app.listen({ hostname: "127.0.0.1", port: 0 });
    const port = runtime.app.server?.port;
    if (!port) throw new Error("test server did not bind a port");
    const draft = {
      city: "大理",
      cities: [{ city: "大理", days: 7 }],
      start_date: "2026-10-01",
      end_date: "2026-10-07",
      travel_days: 7,
      transportation: "公共交通",
      accommodation: "舒适型酒店",
      preferences: ["自然风光"],
      traveler_count: 2,
      room_count: 1,
      budget_amount: 8_000,
      budget_basis: "group_total" as const,
      language: "zh-CN",
    };
    const token = runtime.assistant.ledger.register(draft, 0.95).token;
    const acceptedResponse = await runtime.app.handle(new Request(`http://127.0.0.1:${port}/api/trip/plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "owner-1" },
      body: JSON.stringify({ ...draft, execution_token: token }),
    }));
    const accepted = await acceptedResponse.json() as Record<string, any>;
    while (!planner.started) await Bun.sleep(0);

    const result = await collectWhile(
      `ws://127.0.0.1:${port}/api/trip/ws/${accepted.task_id}?user_id=owner-1`,
      () => clock.advanceBy(5_500),
    );

    expect(result.code).toBe(1000);
    expect(result.messages[0]).toEqual(expect.objectContaining({ status: "processing" }));
    expect(result.messages.at(-1)).toEqual(expect.objectContaining({
      status: "completed",
      progress: 100,
      plan_quality: "fast",
      enhancement_status: "running",
      result: expect.objectContaining({ success: true }),
    }));
  });

  it("sends a failed frame before closing a missing task with 1008", async () => {
    const { baseUrl } = startRuntime();
    const result = await collect(`${baseUrl}/api/trip/ws/missing`);
    expect(result.code).toBe(1008);
    expect(result.messages).toEqual([
      expect.objectContaining({ task_id: "missing", status: "failed", error: "任务不存在" }),
    ]);
  });

  it("sends a failed frame before closing unauthorized access with 1008", async () => {
    const { runtime, baseUrl } = startRuntime();
    runtime.tasks.save(createTaskState("private", {
      user_id: "owner-1",
      request_payload: { city: "北京" },
    }), { immediate: true });
    const result = await collect(`${baseUrl}/api/trip/ws/private?user_id=owner-2`);
    expect(result.code).toBe(1008);
    expect(result.messages[0]).toEqual(expect.objectContaining({ status: "failed", error: "无权访问该计划" }));
  });

  it("sends a terminal snapshot with the complete result and closes normally", async () => {
    const { runtime, baseUrl } = startRuntime();
    const plan = { success: true, data: { city: "北京", days: [{ day: 1 }] } };
    runtime.tasks.save(createTaskState("complete", {
      user_id: "owner-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      message: "旅行计划生成完成",
      result: plan,
      plan_quality: "fast",
      enhancement_status: "running",
      deadline_seconds: 6,
      generation_elapsed_ms: 5_500,
      fast_plan_revision: "revision-1",
    }), { immediate: true });
    const result = await collect(`${baseUrl}/api/trip/ws/complete?user_id=owner-1`);
    expect(result.code).toBe(1000);
    expect(result.messages).toEqual([
      expect.objectContaining({
        task_id: "complete",
        status: "completed",
        result: plan,
        plan_quality: "fast",
        enhancement_status: "running",
      }),
    ]);
  });

  it("allows a valid admin token to inspect another user's task", async () => {
    const { runtime, baseUrl } = startRuntime();
    runtime.tasks.save(createTaskState("admin-visible", {
      user_id: "owner-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      result: { success: true, data: { city: "北京" } },
    }), { immediate: true });
    const result = await collect(`${baseUrl}/api/trip/ws/admin-visible?user_id=other&admin_token=admin%40123`);
    expect(result.code).toBe(1000);
    expect(result.messages[0]).toEqual(expect.objectContaining({ task_id: "admin-visible", status: "completed" }));
  });

  it("rejects a user-deleted task before upgrading the connection", async () => {
    const { runtime, baseUrl } = startRuntime();
    runtime.tasks.save(createTaskState("user-deleted", {
      user_id: "owner-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      result: { success: true, data: { city: "北京" } },
    }), { immediate: true });
    expect(runtime.conversationRecords.softDeletePlan("user-deleted", "owner-1")).toBe(true);

    const url = `${baseUrl}/api/trip/ws/user-deleted?user_id=owner-1`;
    expect(await handshakeStatus(url)).toBe(404);
    expect(await expectUpgradeRejected(url))
      .toEqual({ opened: false });
  });

  it("includes the complete result in a later terminal event", async () => {
    const { runtime, baseUrl } = startRuntime();
    const task = createTaskState("running", {
      user_id: "owner-1",
      stage: "planning",
      progress: 50,
      request_payload: { city: "北京" },
    });
    runtime.tasks.save(task, { immediate: true });
    const plan = { success: true, data: { city: "北京", days: [{ day: 1 }] } };
    const result = await collectWhile(`${baseUrl}/api/trip/ws/running?user_id=owner-1`, () => {
      runtime.tasks.save({
        ...task,
        status: "completed",
        stage: "completed",
        progress: 100,
        message: "旅行计划生成完成",
        result: plan,
      });
    });
    expect(result.code).toBe(1000);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(expect.objectContaining({ status: "processing" }));
    expect(result.messages[1]).toEqual(expect.objectContaining({ status: "completed", result: plan }));
  });
});
