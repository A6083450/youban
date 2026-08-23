import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import { ConversationTitleService } from "../src/agents/conversation-title.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { ConversationSessionRepository } from "../src/domain/conversation-sessions.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

const runtimes: HttpRuntime[] = [];
const dirs: string[] = [];

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
  budget_amount: 3_000,
  budget_basis: "group_total" as const,
  free_text_input: "大理三天",
  origin_text: "大理三天",
  language: "zh-CN",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ControlledPlanner implements TripPlanner {
  readonly started = deferred<void>();
  private readonly result = deferred<Record<string, unknown>>();

  async plan(_request: TripPlanningRequest, _context: PlannerRunContext): Promise<Record<string, unknown>> {
    this.started.resolve();
    return this.result.promise;
  }

  succeed(): void {
    this.result.resolve({
      success: true,
      data: { ...DRAFT, days: [{ day_index: 0, city: "大理", attractions: [] }] },
    });
  }

  fail(): void {
    this.result.reject(new Error("规划模型暂时不可用"));
  }
}

function runtime(conversationTitleService?: ConversationTitleService, planner?: TripPlanner) {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-conversation-records-"));
  dirs.push(dataDir);
  const value = createHttpRuntime({ dataDir, conversationTitleService, planner });
  runtimes.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((value) => value.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function call(
  app: HttpRuntime["app"],
  method: string,
  path: string,
  body?: unknown,
  userId = "user-1",
) {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

async function createConversation(
  app: HttpRuntime["app"],
  sessionId = "session-1",
  firstMessage = "国庆新疆玩一个月帮我计划下",
) {
  return call(app, "POST", "/api/conversations", {
    session_id: sessionId,
    first_message: firstMessage,
    snapshot: { version: 1, items: [{ role: "user", text: "去新疆" }] },
  });
}

describe("conversation record HTTP API", () => {
  it("returns a durable placeholder immediately and creates a client UUID idempotently", async () => {
    const title = deferred<string>();
    let titleCalls = 0;
    const value = runtime(new ConversationTitleService({
      agentComplete: async () => {
        titleCalls += 1;
        return title.promise;
      },
    }));

    const first = await createConversation(value.app);
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({
      record_id: "session-1",
      kind: "conversation",
      session_id: "session-1",
      plan_id: null,
      task_id: null,
      title: "新对话",
      title_status: "pending",
      state: "chatting",
      revision: 0,
    });
    const repeated = await createConversation(value.app);
    expect(repeated.status).toBe(200);
    expect(await json(repeated)).toMatchObject({ record_id: "session-1", revision: 0 });
    expect(titleCalls).toBe(1);

    const listed = await json(await call(value.app, "GET", "/api/conversations"));
    expect(listed.items).toHaveLength(1);
    title.resolve("国庆新疆深度旅行规划");
  });

  it("persists an asynchronously inferred title and retries only a still-pending title", async () => {
    let attempts = 0;
    const service = new ConversationTitleService({
      agentComplete: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary provider failure");
        return "国庆新疆深度旅行规划";
      },
    });
    const value = runtime(service);

    expect((await json(await createConversation(value.app))).title_status).toBe("pending");
    await Bun.sleep(0);
    expect((await json(await call(value.app, "GET", "/api/conversations"))).items[0])
      .toMatchObject({ title_status: "fallback", title: "国庆新疆玩一个月帮我计划下" });

    const secondDataDir = mkdtempSync(join(tmpdir(), "youban-title-retry-"));
    dirs.push(secondDataDir);
    let recoverAttempts = 0;
    const inferredMessages: string[] = [];
    class RecoveringTitleService extends ConversationTitleService {
      constructor() {
        super({ agentComplete: async () => "" });
      }

      override async infer(firstMessage: string) {
        inferredMessages.push(firstMessage);
        recoverAttempts += 1;
        if (recoverAttempts === 1) throw new Error("interrupted title job");
        return { title: "国庆新疆深度旅行规划", status: "generated" as const };
      }
    }
    const recovering = createHttpRuntime({
      dataDir: secondDataDir,
      conversationTitleService: new RecoveringTitleService(),
    });
    runtimes.push(recovering);
    await createConversation(recovering.app, "recover-session");
    await Bun.sleep(0);
    expect((await json(await createConversation(
      recovering.app,
      "recover-session",
      "这条重试内容不能替换最初消息",
    ))).title_status).toBe("pending");
    await Bun.sleep(0);
    expect((await json(await call(recovering.app, "GET", "/api/conversations"))).items[0])
      .toMatchObject({ title: "国庆新疆深度旅行规划", title_status: "generated" });
    expect(recoverAttempts).toBe(2);
    expect(inferredMessages).toEqual([
      "国庆新疆玩一个月帮我计划下",
      "国庆新疆玩一个月帮我计划下",
    ]);
  });

  it("lists, restores, replaces, and soft-deletes only an owner's session", async () => {
    const value = runtime(new ConversationTitleService({ agentComplete: async () => "国庆新疆深度旅行规划" }));
    await createConversation(value.app);
    await Bun.sleep(0);

    const detail = await call(value.app, "GET", "/api/conversations/session-1");
    expect(detail.status).toBe(200);
    expect(await json(detail)).toMatchObject({
      record_id: "session-1",
      snapshot: { version: 1, items: [{ role: "user", text: "去新疆" }] },
      revision: 0,
    });

    const updated = await call(value.app, "PUT", "/api/conversations/session-1", {
      revision: 0,
      snapshot: { version: 2, items: [{ role: "assistant", text: "已记录" }] },
    });
    expect(updated.status).toBe(200);
    expect(await json(updated)).toMatchObject({
      revision: 1,
      snapshot: { version: 2, items: [{ role: "assistant", text: "已记录" }] },
    });

    const stale = await call(value.app, "PUT", "/api/conversations/session-1", {
      revision: 0,
      snapshot: { version: 3, items: [] },
    });
    expect(stale.status).toBe(409);

    for (const method of ["GET", "PUT", "DELETE"] as const) {
      const response = await call(
        value.app,
        method,
        "/api/conversations/session-1",
        method === "PUT" ? { revision: 1, snapshot: { version: 3, items: [] } } : undefined,
        "other-user",
      );
      expect(response.status).toBe(404);
    }

    const removed = await call(value.app, "DELETE", "/api/conversations/session-1");
    expect(removed.status).toBe(200);
    expect(await json(removed)).toEqual({ success: true });
    expect((await json(await call(value.app, "GET", "/api/conversations"))).items).toEqual([]);
    expect((await call(value.app, "GET", "/api/conversations/session-1")).status).toBe(404);
    expect((await call(value.app, "PUT", "/api/conversations/session-1", {
      revision: 1,
      snapshot: { version: 3, items: [] },
    })).status).toBe(404);
  });

  it("projects legacy plans and lets the linked session win by plan id", async () => {
    const value = runtime(new ConversationTitleService({ agentComplete: async () => "国庆新疆深度旅行规划" }));
    value.tasks.save(createTaskState("task-legacy", {
      plan_id: "plan-legacy",
      user_id: "user-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      request_payload: {
        city: "杭州",
        cities: ["杭州", "绍兴"],
        start_date: "2026-10-01",
        end_date: "2026-10-03",
        travel_days: 3,
      },
      result: { data: { cities: ["杭州", "绍兴"], days: [], overall_suggestions: "江南慢游" } },
    }), { immediate: true });
    value.tasks.save(createTaskState("task-linked", {
      plan_id: "plan-linked",
      user_id: "user-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      request_payload: { city: "新疆", travel_days: 30 },
      result: { data: { city: "新疆", days: [] } },
    }), { immediate: true });
    await createConversation(value.app);
    await Bun.sleep(0);
    const sessions = new ConversationSessionRepository(join(value.dataDir, "youban.db"));
    sessions.linkPlan("session-1", "user-1", "plan-linked");
    sessions.markPlanned("session-1");
    sessions.close();

    const response = await call(value.app, "GET", "/api/conversations?limit=10");
    expect(response.status).toBe(200);
    const items = (await json(response)).items;
    expect(items).toHaveLength(2);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        record_id: "plan-legacy",
        kind: "plan",
        session_id: null,
        plan_id: "plan-legacy",
        task_id: "task-legacy",
        title: "杭州 → 绍兴",
        state: "planned",
        city: "杭州 → 绍兴",
        start_date: "2026-10-01",
        end_date: "2026-10-03",
        travel_days: 3,
      }),
      expect.objectContaining({
        record_id: "session-1",
        kind: "plan",
        session_id: "session-1",
        plan_id: "plan-linked",
        task_id: "task-linked",
        title: "国庆新疆深度旅行规划",
        state: "planned",
      }),
    ]));
    expect(items.filter((item: Record<string, unknown>) => item.plan_id === "plan-linked")).toHaveLength(1);
  });

  it("links a signed plan submission synchronously and promotes the same record after completion", async () => {
    const planner = new ControlledPlanner();
    const value = runtime(
      new ConversationTitleService({ agentComplete: async () => "大理三日自然旅行" }),
      planner,
    );
    await createConversation(value.app);
    await Bun.sleep(0);
    const token = value.assistant.ledger.register(DRAFT, 0.95).token;

    const submitted = await call(value.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      session_id: "session-1",
      execution_token: token,
    });

    const accepted = await json(submitted);
    const storedRequest = value.tasks.get(accepted.task_id)?.request_payload;
    const generatingItems = (await json(await call(value.app, "GET", "/api/conversations"))).items;
    const sessions = new ConversationSessionRepository(join(value.dataDir, "youban.db"));
    expect(sessions.linkPlan("session-1", "user-1", accepted.plan_id)?.planId).toBe(accepted.plan_id);
    expect(sessions.linkPlan("session-1", "user-1", "different-plan")).toBeUndefined();
    expect(sessions.getByPlanId(accepted.plan_id)?.sessionId).toBe("session-1");
    sessions.close();
    planner.succeed();

    expect(submitted.status).toBe(200);
    expect(storedRequest).toEqual(expect.objectContaining({
      session_id: "session-1",
    }));
    expect(generatingItems).toEqual([
      expect.objectContaining({
        record_id: "session-1",
        kind: "conversation",
        plan_id: accepted.plan_id,
        task_id: accepted.task_id,
        state: "generating",
        status: "processing",
      }),
    ]);

    await waitFor(() => value.tasks.get(accepted.task_id)?.status === "completed");
    expect((await json(await call(value.app, "GET", "/api/conversations"))).items).toEqual([
      expect.objectContaining({
        record_id: "session-1",
        kind: "plan",
        plan_id: accepted.plan_id,
        task_id: accepted.task_id,
        state: "planned",
        status: "completed",
      }),
    ]);
  });

  it("returns a failed linked generation to chatting without creating a duplicate record", async () => {
    const planner = new ControlledPlanner();
    const value = runtime(
      new ConversationTitleService({ agentComplete: async () => "大理三日自然旅行" }),
      planner,
    );
    await createConversation(value.app);
    const token = value.assistant.ledger.register(DRAFT, 0.95).token;
    const accepted = await json(await call(value.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      session_id: "session-1",
      execution_token: token,
    }));

    planner.fail();
    await waitFor(() => value.tasks.get(accepted.task_id)?.status === "failed");

    expect((await json(await call(value.app, "GET", "/api/conversations"))).items).toEqual([
      expect.objectContaining({
        record_id: "session-1",
        kind: "conversation",
        plan_id: accepted.plan_id,
        state: "chatting",
        status: "failed",
      }),
    ]);
  });

  it("applies authoritative completion after user deletion so admin deletion does not stay blocked", async () => {
    const planner = new ControlledPlanner();
    const value = runtime(
      new ConversationTitleService({ agentComplete: async () => "大理三日自然旅行" }),
      planner,
    );
    await createConversation(value.app);
    const token = value.assistant.ledger.register(DRAFT, 0.95).token;
    const accepted = await json(await call(value.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      session_id: "session-1",
      execution_token: token,
    }));
    expect((await call(value.app, "DELETE", "/api/conversations/session-1")).status).toBe(200);

    planner.succeed();
    await waitFor(() => value.tasks.get(accepted.task_id)?.status === "completed");
    const adminList = await value.app.handle(new Request(
      "http://localhost/api/admin/records?visibility=user_deleted",
      { headers: { "x-admin-token": "admin@123" } },
    ));

    expect(adminList.status).toBe(200);
    expect((await json(adminList)).items).toEqual([
      expect.objectContaining({ record_id: "session-1", state: "planned", status: "completed" }),
    ]);
    const permanentlyDeleted = await value.app.handle(new Request(
      "http://localhost/api/admin/records/session-1",
      { method: "DELETE", headers: { "x-admin-token": "admin@123" } },
    ));
    expect(permanentlyDeleted.status).toBe(200);
  });

  it("verifies session ownership before consuming confirmation or creating a task", async () => {
    const value = runtime(new ConversationTitleService({ agentComplete: async () => "大理三日自然旅行" }));
    await createConversation(value.app);
    const token = value.assistant.ledger.register(DRAFT, 0.95).token;

    const rejected = await call(value.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      session_id: "session-1",
      execution_token: token,
    }, "other-user");

    expect(rejected.status).toBe(404);
    expect(await json(rejected)).toEqual({ detail: "会话不存在" });
    expect(value.assistant.ledger.validate(token, DRAFT)).toEqual({ valid: true, reason: "ok" });
    expect(value.tasks.all()).toEqual([]);
    expect((await json(await call(value.app, "GET", "/api/conversations"))).items)
      .toEqual([expect.objectContaining({ record_id: "session-1", plan_id: null, state: "chatting" })]);
  });

  it("soft-deletes both sides of a linked planned record without removing either row", async () => {
    const value = runtime(new ConversationTitleService({ agentComplete: async () => "国庆新疆深度旅行规划" }));
    value.tasks.save(createTaskState("task-linked", {
      plan_id: "plan-linked",
      user_id: "user-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      request_payload: { city: "新疆", travel_days: 30 },
      result: { data: { city: "新疆", days: [] } },
    }), { immediate: true });
    await createConversation(value.app);
    await Bun.sleep(0);
    const sessions = new ConversationSessionRepository(join(value.dataDir, "youban.db"));
    sessions.linkPlan("session-1", "user-1", "plan-linked");
    sessions.markPlanned("session-1");

    const removed = await call(value.app, "DELETE", "/api/conversations/session-1");

    expect(removed.status).toBe(200);
    expect((await json(await call(value.app, "GET", "/api/conversations"))).items).toEqual([]);
    expect(value.tasks.get("task-linked")).toBeDefined();
    expect(value.tasks.database.raw.query(
      "SELECT user_deleted_at FROM tasks WHERE task_id = ?",
    ).get("task-linked")).toEqual({ user_deleted_at: expect.any(String) });
    expect(sessions.getByPlanId("plan-linked", { includeDeleted: true })).toEqual(expect.objectContaining({
      sessionId: "session-1",
      deletedAt: expect.any(String),
    }));
    sessions.close();
  });

  it("fails closed when a linked task belongs to a different owner", async () => {
    const value = runtime(new ConversationTitleService({ agentComplete: async () => "国庆新疆深度旅行规划" }));
    value.tasks.save(createTaskState("task-linked", {
      plan_id: "plan-linked",
      user_id: "other-user",
      status: "completed",
      stage: "completed",
      progress: 100,
      request_payload: { city: "新疆", travel_days: 30 },
      result: { data: { city: "新疆", days: [] } },
    }), { immediate: true });
    await createConversation(value.app);
    await Bun.sleep(0);
    const sessions = new ConversationSessionRepository(join(value.dataDir, "youban.db"));
    sessions.linkPlan("session-1", "user-1", "plan-linked");
    sessions.markPlanned("session-1");

    const rejected = await call(value.app, "DELETE", "/api/conversations/session-1");

    expect(rejected.status).toBe(404);
    expect((await json(await call(value.app, "GET", "/api/conversations"))).items)
      .toEqual([expect.objectContaining({ record_id: "session-1", plan_id: "plan-linked" })]);
    expect(value.tasks.database.raw.query(
      "SELECT user_deleted_at FROM tasks WHERE task_id = ?",
    ).get("task-linked")).toEqual({ user_deleted_at: null });
    expect(sessions.getByPlanId("plan-linked", { includeDeleted: true })).toEqual(expect.objectContaining({
      sessionId: "session-1",
      deletedAt: null,
    }));
    sessions.close();
  });

  it("rolls back the task tombstone when the linked session tombstone fails", async () => {
    const value = runtime(new ConversationTitleService({ agentComplete: async () => "国庆新疆深度旅行规划" }));
    value.tasks.save(createTaskState("task-linked", {
      plan_id: "plan-linked",
      user_id: "user-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      request_payload: { city: "新疆", travel_days: 30 },
      result: { data: { city: "新疆", days: [] } },
    }), { immediate: true });
    await createConversation(value.app);
    const sessions = new ConversationSessionRepository(join(value.dataDir, "youban.db"));
    sessions.linkPlan("session-1", "user-1", "plan-linked");
    sessions.markPlanned("session-1");
    sessions.database.raw.exec(`
      CREATE TRIGGER reject_session_tombstone
      BEFORE UPDATE OF deleted_at ON conversation_sessions
      BEGIN
        SELECT RAISE(ABORT, 'reject session tombstone');
      END;
    `);

    const rejected = await call(value.app, "DELETE", "/api/conversations/session-1");

    expect(rejected.status).toBe(500);
    expect(value.tasks.database.raw.query(
      "SELECT user_deleted_at FROM tasks WHERE task_id = ?",
    ).get("task-linked")).toEqual({ user_deleted_at: null });
    expect(sessions.getByPlanId("plan-linked", { includeDeleted: true })?.deletedAt).toBeNull();
    sessions.close();
  });

  it("waits for its title jobs before closing the session repository", async () => {
    const title = deferred<string>();
    const value = runtime(new ConversationTitleService({ agentComplete: async () => title.promise }));
    await createConversation(value.app);

    let closed = false;
    const closing = value.close().then(() => { closed = true; });
    await Bun.sleep(0);
    expect(closed).toBe(false);
    title.resolve("国庆新疆深度旅行规划");
    await closing;
    runtimes.splice(runtimes.indexOf(value), 1);

    const observer = new ConversationSessionRepository(join(value.dataDir, "youban.db"));
    expect(observer.getOwned("session-1", "user-1")).toMatchObject({
      title: "国庆新疆深度旅行规划",
      titleStatus: "generated",
    });
    observer.close();
  });
});
