import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationTitleService } from "../src/agents/conversation-title.ts";
import { ConversationSessionRepository } from "../src/domain/conversation-sessions.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

const runtimes: HttpRuntime[] = [];
const dirs: string[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runtime(conversationTitleService?: ConversationTitleService) {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-conversation-records-"));
  dirs.push(dataDir);
  const value = createHttpRuntime({ dataDir, conversationTitleService });
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
