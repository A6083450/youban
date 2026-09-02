import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import type {
  ParentAgentCompletion,
  ParentAgentScope,
  YoubanParentAgent,
} from "../src/agents/persistent-parent-agent.ts";
import {
  createDefaultTripChatService,
  type DefaultTripChatServiceOptions,
} from "../src/agents/default-trip-chat-service.ts";
import type { DefaultParentAgentOptions } from "../src/agents/default-parent-agent.ts";
import type { DefaultTripPlannerOptions } from "../src/agents/default-trip-planner.ts";
import type { StructuredAgentRequest } from "../src/agents/pi-trip-planner.ts";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import { _resetSettingsForTest, getSettings } from "../src/config/settings.ts";
import { ConversationSessionRepository } from "../src/domain/conversation-sessions.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class NoopPlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) { return { success: true, data: request }; }
}

class ClosableParent implements YoubanParentAgent {
  closed = false;

  async complete(_input: ParentAgentCompletion): Promise<string> { return ""; }
  async delegate(_scope: ParentAgentScope, _request: StructuredAgentRequest): Promise<unknown> { return {}; }
  async recordExchange(): Promise<void> {}
  async close(): Promise<void> { this.closed = true; }
}

let previousDataDir: string | undefined;
let dataDir = "";
let runtime: HttpRuntime;
let aliceId = "";

beforeEach(() => {
  previousDataDir = process.env.DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "youban-admin-"));
  process.env.DATA_DIR = dataDir;
  _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
  runtime = createHttpRuntime({ dataDir, planner: new NoopPlanner() });
  const now = new Date().toISOString();
  runtime.users.database.raw.query(`
    INSERT INTO users (user_id, nickname, created_at, last_login_at)
    VALUES (?, ?, ?, ?)
  `).run("admin-alice", "小艾", now, now);
  const alice = runtime.users.get("admin-alice")!;
  aliceId = alice.user_id;
  runtime.tasks.save(createTaskState("alice-trip", {
    user_id: alice.user_id,
    status: "completed",
    stage: "completed",
    progress: 100,
    request_payload: {
      city: "北京", cities: [{ city: "北京", days: 3 }], start_date: "2026-08-01",
      end_date: "2026-08-03", travel_days: 3,
    },
    result: { success: true, data: { city: "北京", days: [], overall_suggestions: "" } },
  }), { immediate: true });
});

afterEach(async () => {
  await runtime.close();
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
});

function call(method: string, path: string, body?: unknown, token?: string) {
  return runtime.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

async function adminRecords(visibility: "all" | "active" | "user_deleted") {
  const response = await call("GET", `/api/admin/records?visibility=${visibility}`, undefined, "admin@123");
  expect(response.status).toBe(200);
  return (await response.json() as Record<string, any>).items as Array<Record<string, any>>;
}

describe("admin HTTP", () => {
  it("creates the password file and rereads it on every request", async () => {
    expect(readFileSync(join(dataDir, "admin_password.txt"), "utf8").trim()).toBe("admin@123");
    expect((await call("POST", "/api/admin/login", { password: "wrong" })).status).toBe(401);
    expect((await call("POST", "/api/admin/login", { password: "admin@123" })).status).toBe(200);
    writeFileSync(join(dataDir, "admin_password.txt"), "new-secret\n", "utf8");
    expect((await call("GET", "/api/admin/trips", undefined, "admin@123")).status).toBe(401);
    expect((await call("GET", "/api/admin/trips", undefined, "new-secret")).status).toBe(200);
  });

  it("lists all users with nicknames and lets an admin delete a completed trip", async () => {
    const response = await call("GET", "/api/admin/trips", undefined, "admin@123");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual(expect.objectContaining({
      task_id: "alice-trip", city: "北京", nickname: "小艾",
    }));
    expect((await call("DELETE", "/api/admin/trips/alice-trip", undefined, "admin@123")).status).toBe(200);
    expect(runtime.tasks.get("alice-trip")).toBeUndefined();
  });

  it("keeps legacy task deletion in the task namespace when a session id collides", async () => {
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    sessions.create({
      sessionId: "alice-trip",
      userId: aliceId,
      firstMessage: "与任务编号碰撞的纯聊天",
      snapshot: { version: 1, items: [] },
    });

    const removed = await call("DELETE", "/api/admin/trips/alice-trip", undefined, "admin@123");

    expect(removed.status).toBe(200);
    expect(runtime.tasks.get("alice-trip")).toBeUndefined();
    expect(sessions.getOwned("alice-trip", aliceId)).toEqual(expect.objectContaining({
      sessionId: "alice-trip",
      planId: null,
    }));
    sessions.close();
  });

  it("uses namespaced record ids to delete the selected side of an id collision", async () => {
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    sessions.create({
      sessionId: "alice-trip",
      userId: aliceId,
      firstMessage: "与任务编号碰撞的纯聊天",
      snapshot: { version: 1, items: [] },
    });

    const recordIds = (await adminRecords("all")).map((record) => record.record_id).sort();
    expect(recordIds).toEqual(["session:alice-trip", "task:alice-trip"]);

    const chatRemoved = await call(
      "DELETE",
      "/api/admin/records/session:alice-trip",
      undefined,
      "admin@123",
    );
    expect(chatRemoved.status).toBe(200);
    expect(sessions.getOwned("alice-trip", aliceId)).toBeUndefined();
    expect(runtime.tasks.get("alice-trip")).toBeDefined();

    const taskRemoved = await call(
      "DELETE",
      "/api/admin/records/task:alice-trip",
      undefined,
      "admin@123",
    );
    expect(taskRemoved.status).toBe(200);
    expect(runtime.tasks.get("alice-trip")).toBeUndefined();
    sessions.close();
  });

  it("lists conversations and plans by visibility with owner nicknames", async () => {
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    sessions.create({
      sessionId: "active-chat",
      userId: aliceId,
      firstMessage: "继续聊聊北京",
      snapshot: { version: 1, items: [] },
    });
    sessions.create({
      sessionId: "deleted-chat",
      userId: aliceId,
      firstMessage: "稍后删除的聊天",
      snapshot: { version: 1, items: [] },
    });
    sessions.softDelete("deleted-chat", aliceId);
    runtime.tasks.softDelete("alice-trip");

    expect((await call("GET", "/api/admin/records", undefined, "wrong-secret")).status).toBe(401);
    const all = await adminRecords("all");
    const active = await adminRecords("active");
    const deleted = await adminRecords("user_deleted");

    expect(all).toHaveLength(3);
    expect(all).toEqual(expect.arrayContaining([
      expect.objectContaining({ record_id: "session:active-chat", kind: "conversation", nickname: "小艾", user_deleted_at: null }),
      expect.objectContaining({ record_id: "session:deleted-chat", kind: "conversation", nickname: "小艾", user_deleted_at: expect.any(String) }),
      expect.objectContaining({ record_id: "task:alice-trip", kind: "plan", nickname: "小艾", user_deleted_at: expect.any(String) }),
    ]));
    expect(active.map((record) => record.record_id)).toEqual(["session:active-chat"]);
    expect(deleted.map((record) => record.record_id).sort()).toEqual(["session:deleted-chat", "task:alice-trip"]);
    sessions.close();
  });

  it("paginates after visibility filtering so older deleted records survive more than 500 active rows", async () => {
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    for (let index = 0; index < 501; index += 1) {
      const sessionId = `newer-active-${String(index).padStart(3, "0")}`;
      sessions.create({
        sessionId,
        userId: aliceId,
        firstMessage: `活跃对话 ${index}`,
        snapshot: { version: 1, items: [] },
      });
      sessions.database.raw.query(
        "UPDATE conversation_sessions SET updated_at = ? WHERE session_id = ?",
      ).run(`2026-08-24T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`, sessionId);
    }
    for (const [index, sessionId] of ["older-deleted-a", "older-deleted-b"].entries()) {
      sessions.create({
        sessionId,
        userId: aliceId,
        firstMessage: `已删除对话 ${index}`,
        snapshot: { version: 1, items: [] },
      });
      sessions.softDelete(sessionId, aliceId);
      sessions.database.raw.query(
        "UPDATE conversation_sessions SET updated_at = ? WHERE session_id = ?",
      ).run(`2020-01-0${index + 1}T00:00:00.000Z`, sessionId);
    }

    const deletedPage = await call(
      "GET",
      "/api/admin/records?visibility=user_deleted&limit=1&offset=0",
      undefined,
      "admin@123",
    );
    const deletedNextPage = await call(
      "GET",
      "/api/admin/records?visibility=user_deleted&limit=1&offset=1",
      undefined,
      "admin@123",
    );
    const allSecondPage = await call(
      "GET",
      "/api/admin/records?visibility=all&limit=500&offset=500",
      undefined,
      "admin@123",
    );

    expect(deletedPage.status).toBe(200);
    expect(deletedNextPage.status).toBe(200);
    const firstDeletedBody = await deletedPage.json() as {
      items: Array<{ record_id: string }>;
      total: number;
      snapshot_id: string;
    };
    const nextDeletedBody = await deletedNextPage.json() as {
      items: Array<{ record_id: string }>;
      total: number;
      snapshot_id: string;
    };
    const allSecondBody = await allSecondPage.json() as {
      items: Array<{ record_id: string }>;
      total: number;
      snapshot_id: string;
    };
    const firstDeletedItems = firstDeletedBody.items;
    const nextDeletedItems = nextDeletedBody.items;
    expect(firstDeletedItems).toHaveLength(1);
    expect(nextDeletedItems).toHaveLength(1);
    expect(firstDeletedBody.total).toBe(2);
    expect(nextDeletedBody.total).toBe(2);
    expect(allSecondBody.total).toBe(504);
    expect(firstDeletedBody.snapshot_id).toMatch(/^[a-f0-9]{64}$/);
    expect(nextDeletedBody.snapshot_id).toBe(firstDeletedBody.snapshot_id);
    expect(nextDeletedItems[0]?.record_id).not.toBe(firstDeletedItems[0]?.record_id);
    expect(allSecondBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_id: "session:older-deleted-a" }),
        expect.objectContaining({ record_id: "session:older-deleted-b" }),
      ]),
    );
    expect((await call(
      "GET",
      "/api/admin/records?visibility=all&limit=10&offset=-1",
      undefined,
      "admin@123",
    )).status).toBe(422);
    sessions.close();
  });

  it("changes the admin record snapshot after same-total replacement or visible content mutation", async () => {
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    for (const sessionId of ["snapshot-a", "snapshot-b"]) {
      sessions.create({
        sessionId,
        userId: aliceId,
        firstMessage: sessionId,
        snapshot: { version: 1, items: [] },
      });
    }
    const readPage = async (offset: number) => {
      const response = await call(
        "GET",
        `/api/admin/records?visibility=active&limit=1&offset=${offset}`,
        undefined,
        "admin@123",
      );
      expect(response.status).toBe(200);
      return response.json() as Promise<{ total: number; snapshot_id: string }>;
    };

    const original = await readPage(0);
    const unchangedNextPage = await readPage(1);
    expect(unchangedNextPage.snapshot_id).toBe(original.snapshot_id);

    expect(sessions.hardDelete("snapshot-a")).toBeTrue();
    sessions.create({
      sessionId: "snapshot-c",
      userId: aliceId,
      firstMessage: "snapshot-c",
      snapshot: { version: 1, items: [] },
    });
    const replaced = await readPage(0);
    expect(replaced.total).toBe(original.total);
    expect(replaced.snapshot_id).not.toBe(original.snapshot_id);

    sessions.database.raw.query(
      "UPDATE conversation_sessions SET title = ?, title_status = ? WHERE session_id = ?",
    ).run("内容已变化", "generated", "snapshot-c");
    const contentChanged = await readPage(0);
    expect(contentChanged.total).toBe(replaced.total);
    expect(contentChanged.snapshot_id).not.toBe(replaced.snapshot_id);

    runtime.users.database.raw.query(
      "UPDATE users SET nickname = ? WHERE user_id = ?",
    ).run("新的昵称", aliceId);
    const nicknameChanged = await readPage(0);
    expect(nicknameChanged.total).toBe(contentChanged.total);
    expect(nicknameChanged.snapshot_id).not.toBe(contentChanged.snapshot_id);
    sessions.close();
  });

  it("permanently deletes a pure conversation without touching plan rows", async () => {
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    sessions.create({
      sessionId: "pure-chat",
      userId: aliceId,
      firstMessage: "只聊天不生成",
      snapshot: { version: 1, items: [] },
    });

    const removed = await call("DELETE", "/api/admin/records/session:pure-chat", undefined, "admin@123");

    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ success: true, removed_images: 0 });
    expect(sessions.database.raw.query(
      "SELECT session_id FROM conversation_sessions WHERE session_id = ?",
    ).get("pure-chat")).toBeNull();
    expect(runtime.tasks.get("alice-trip")).toBeDefined();
    expect((await call("DELETE", "/api/admin/records/task:missing", undefined, "admin@123")).status).toBe(404);
    sessions.close();
  });

  it("permanently deletes a plan, its linked session, legacy conversation, and unreferenced image", async () => {
    const image = join(dataDir, "images", "admin-only.jpg");
    mkdirSync(join(dataDir, "images"), { recursive: true });
    writeFileSync(image, "image");
    const task = runtime.tasks.get("alice-trip")!;
    runtime.tasks.save({
      ...task,
      result: { success: true, data: { city: "北京", days: [{ image_url: "/api/images/admin-only.jpg" }] } },
    }, { immediate: true });
    runtime.conversations.save("alice-trip", aliceId, [{ role: "user", content: "计划对话" }]);
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    sessions.create({
      sessionId: "planned-session",
      userId: aliceId,
      firstMessage: "北京三天",
      snapshot: { version: 1, items: [] },
    });
    sessions.linkPlan("planned-session", aliceId, "alice-trip");
    sessions.markPlanned("planned-session");

    const removed = await call("DELETE", "/api/admin/records/session:planned-session", undefined, "admin@123");

    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ success: true, removed_images: 1 });
    expect(runtime.tasks.get("alice-trip")).toBeUndefined();
    expect(runtime.conversations.get("alice-trip")).toEqual([]);
    expect(sessions.database.raw.query(
      "SELECT session_id FROM conversation_sessions WHERE session_id = ?",
    ).get("planned-session")).toBeNull();
    expect(existsSync(image)).toBe(false);
    sessions.close();
  });

  it("rejects permanent deletion while the linked record is generating", async () => {
    const task = runtime.tasks.get("alice-trip")!;
    runtime.tasks.save({ ...task, status: "processing", stage: "planning" }, { immediate: true });
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    sessions.create({
      sessionId: "generating-session",
      userId: aliceId,
      firstMessage: "北京三天",
      snapshot: { version: 1, items: [] },
    });
    sessions.linkPlan("generating-session", aliceId, "alice-trip");

    const rejected = await call("DELETE", "/api/admin/records/session:generating-session", undefined, "admin@123");

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ detail: "计划正在生成中，完成或失败后才能删除" });
    expect(runtime.tasks.get("alice-trip")).toBeDefined();
    expect(sessions.getByPlanId("alice-trip")).toBeDefined();
    sessions.close();
  });

  it("removes a percent-encoded cached image only after its last task reference is permanently deleted", async () => {
    const image = join(dataDir, "images", "shared photo.jpg");
    mkdirSync(join(dataDir, "images"), { recursive: true });
    writeFileSync(image, "image");
    const first = runtime.tasks.get("alice-trip")!;
    runtime.tasks.save({
      ...first,
      result: { success: true, data: { city: "北京", days: [{ image_url: "/api/images/shared%20photo.jpg" }] } },
    }, { immediate: true });
    runtime.tasks.save(createTaskState("second-trip", {
      user_id: aliceId,
      status: "completed",
      stage: "completed",
      progress: 100,
      request_payload: { city: "上海", travel_days: 1 },
      result: { success: true, data: { city: "上海", days: [{ image_url: "/api/images/shared%20photo.jpg" }] } },
    }), { immediate: true });

    const firstRemoved = await call("DELETE", "/api/admin/records/task:alice-trip", undefined, "admin@123");
    expect(await firstRemoved.json()).toEqual({ success: true, removed_images: 0 });
    expect(existsSync(image)).toBe(true);

    const secondRemoved = await call("DELETE", "/api/admin/records/task:second-trip", undefined, "admin@123");
    expect(await secondRemoved.json()).toEqual({ success: true, removed_images: 1 });
    expect(existsSync(image)).toBe(false);
  });

  it("rolls back all database rows before attempting image cleanup", async () => {
    const image = join(dataDir, "images", "transactional.jpg");
    mkdirSync(join(dataDir, "images"), { recursive: true });
    writeFileSync(image, "image");
    const task = runtime.tasks.get("alice-trip")!;
    runtime.tasks.save({
      ...task,
      result: { success: true, data: { city: "北京", days: [{ image_url: "/api/images/transactional.jpg" }] } },
    }, { immediate: true });
    runtime.conversations.save("alice-trip", aliceId, [{ role: "user", content: "计划对话" }]);
    const sessions = new ConversationSessionRepository(join(dataDir, "youban.db"));
    sessions.create({
      sessionId: "transaction-session",
      userId: aliceId,
      firstMessage: "北京三天",
      snapshot: { version: 1, items: [] },
    });
    sessions.linkPlan("transaction-session", aliceId, "alice-trip");
    sessions.markPlanned("transaction-session");
    sessions.database.raw.exec(`
      CREATE TRIGGER reject_conversation_delete
      BEFORE DELETE ON conversations
      BEGIN
        SELECT RAISE(ABORT, 'reject conversation delete');
      END;
    `);

    const rejected = await call("DELETE", "/api/admin/records/session:transaction-session", undefined, "admin@123");

    expect(rejected.status).toBe(500);
    expect(runtime.tasks.get("alice-trip")).toBeDefined();
    expect(runtime.conversations.get("alice-trip")).toEqual([{ role: "user", content: "计划对话" }]);
    expect(sessions.getByPlanId("alice-trip", { includeDeleted: true })).toBeDefined();
    expect(existsSync(image)).toBe(true);
    sessions.close();
  });

  it("lets a live admin token cross owner guards and rejects an invalid token", async () => {
    const allowed = await call("GET", "/api/trip/status/alice-trip", undefined, "admin@123");
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(expect.objectContaining({ task_id: "alice-trip", status: "completed" }));
    const conversation = await call("GET", "/api/trip/plan/alice-trip/conversation", undefined, "admin@123");
    expect(conversation.status).toBe(200);
    const rejected = await call("GET", "/api/trip/status/alice-trip", undefined, "wrong-secret");
    expect(rejected.status).toBe(403);
  });

  it("projects thinking as hidden through public settings when thinking is disabled", async () => {
    const update = await call("PUT", "/api/admin/settings", {
      llm_thinking_enabled: false,
      llm_thinking_visible: true,
    }, "admin@123");
    expect(update.status).toBe(200);

    const response = await call("GET", "/api/settings");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        llm_thinking_enabled: false,
        llm_thinking_visible: false,
      }),
    }));
  });

  it("applies the updated thinking setting to replacement intake requests", async () => {
    const requests: Array<Record<string, any>> = [];
    const provider = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push(await request.json() as Record<string, any>);
        const output = JSON.stringify({
          action: "chat",
          emotion: "neutral",
          reply: "收到。",
        });
        const chunks = [
          {
            id: "thinking-settings",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: { role: "assistant", content: output }, finish_reason: null }],
          },
          {
            id: "thinking-settings",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
          },
        ];
        return new Response(
          `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    try {
      for (const [thinkingEnabled, expected] of [
        [true, { type: "enabled" }],
        [false, { type: "disabled" }],
      ] as const) {
        const update = await call("PUT", "/api/admin/settings", {
          openai_api_key: "test-key",
          openai_base_url: `${provider.url}v1`,
          openai_model: "mock-model",
          llm_api_style: "completions",
          llm_thinking_enabled: thinkingEnabled,
        }, "admin@123");
        expect(update.status).toBe(200);

        const response = await call("POST", "/api/trip/parse", {
          text: "随便聊聊",
          language: "zh-CN",
        });
        expect(response.status).toBe(200);
        expect(requests.at(-1)?.thinking).toEqual(expected);
      }
      expect(readdirSync(join(dataDir, "pi-runtime", "generations"))).toHaveLength(3);
    } finally {
      provider.stop(true);
    }
  });

  it("reads and persists filtered runtime settings", async () => {
    const getResponse = await call("GET", "/api/admin/settings", undefined, "admin@123");
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json() as Record<string, any>;
    expect(getBody).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        openai_model: expect.any(String),
        llm_thinking_enabled: false,
        llm_thinking_visible: false,
      }),
    }));
    expect(getBody.data.fliggy_proxy_token).toBeUndefined();
    const draft = { city: "北京", travel_days: 3 };
    const pendingToken = runtime.assistant.ledger.register(draft, 0.95).token;
    const update = await call("PUT", "/api/admin/settings", {
      openai_model: "admin-model",
      llm_thinking_enabled: true,
      llm_thinking_visible: true,
      unknown_key: "ignored",
    }, "admin@123");
    expect(update.status).toBe(200);
    const updateBody = await update.json() as Record<string, any>;
    expect(updateBody.data.openai_model).toBe("admin-model");
    expect(updateBody.data.fliggy_proxy_token).toBeUndefined();
    expect(runtime.assistant.ledger.validate(pendingToken, draft)).toEqual({ valid: true, reason: "ok" });
    const persisted = JSON.parse(readFileSync(join(dataDir, "runtime_settings.json"), "utf8"));
    expect(persisted).toEqual({
      openai_model: "admin-model",
      llm_thinking_enabled: true,
      llm_thinking_visible: true,
    });
  });

  it("keeps the active settings and services when a replacement generation cannot be built", async () => {
    await runtime.close();
    const initialPlanner = new NoopPlanner();
    const initialParent = new ClosableParent();
    const candidateParent = new ClosableParent();
    const parents = [initialParent, candidateParent];
    let plannerBuilds = 0;
    runtime = createHttpRuntime({
      dataDir,
      serviceFactories: {
        parentAgent: () => parents.shift()!,
        planner() {
          plannerBuilds += 1;
          if (plannerBuilds === 1) return initialPlanner;
          throw new Error("candidate planner failed");
        },
      },
    });
    const previousModel = getSettings().openai_model;

    const response = await call("PUT", "/api/admin/settings", {
      openai_model: "must-not-commit",
    }, "admin@123");

    expect(response.status).toBe(500);
    expect(getSettings().openai_model).toBe(previousModel);
    expect(runtime.parentAgent).toBe(initialParent);
    expect(runtime.planner).toBe(initialPlanner);
    expect(initialParent.closed).toBe(false);
    expect(candidateParent.closed).toBe(true);
    expect(existsSync(join(dataDir, "runtime_settings.json"))).toBe(false);
  });

  it("keeps one injected Skill service across settings rebuilds without taking ownership", async () => {
    await runtime.close();
    const skillService = {
      closeCount: 0,
      snapshot: () => ({
        generation: 73,
        assignments: {
          "parent-assistant": [],
          "destination-researcher": [],
          "segment-planner": [],
          summary: [],
          "itinerary-reviewer": [],
          "plan-editor": [],
        },
      }),
      subscribe: () => () => {},
      list: () => [],
      get: () => { throw new Error("unused"); },
      stageUpload: async () => { throw new Error("unused"); },
      stageGit: async () => { throw new Error("unused"); },
      checkGitUpdate: async () => { throw new Error("unused"); },
      saveCandidate: async () => { throw new Error("unused"); },
      activate: () => { throw new Error("unused"); },
      configure: () => { throw new Error("unused"); },
      archive: () => { throw new Error("unused"); },
      restore: () => { throw new Error("unused"); },
      close() { this.closeCount += 1; },
    };
    const parent = new ClosableParent();
    runtime = createHttpRuntime({
      dataDir,
      planner: new NoopPlanner(),
      parentAgent: parent,
      skillService,
    });
    const initialSkills = runtime.skills;

    const response = await call("PUT", "/api/admin/settings", {
      openai_model: "shared-skill-catalog-model",
    }, "admin@123");

    expect(response.status).toBe(200);
    expect(runtime.skills).toBe(initialSkills);
    expect(runtime.skills).toBe(skillService);
    expect(skillService.closeCount).toBe(0);
    await runtime.close();
    expect(skillService.closeCount).toBe(0);
  });

  it("threads one Skill catalog and diagnostics object through initial and replacement factories", async () => {
    await runtime.close();
    const observed: Array<{
      kind: "parent" | "planner" | "chat";
      catalog: unknown;
      diagnostics: unknown;
    }> = [];
    runtime = createHttpRuntime({
      dataDir,
      serviceFactories: {
        parentAgent(options: DefaultParentAgentOptions) {
          observed.push({
            kind: "parent",
            catalog: options.skillCatalog,
            diagnostics: options.skillRuntimeDiagnostics,
          });
          return new ClosableParent();
        },
        planner(options: DefaultTripPlannerOptions) {
          observed.push({
            kind: "planner",
            catalog: options.skillCatalog,
            diagnostics: options.skillRuntimeDiagnostics,
          });
          return new NoopPlanner();
        },
        chatService(options: DefaultTripChatServiceOptions) {
          observed.push({
            kind: "chat",
            catalog: options.skillCatalog,
            diagnostics: options.skillRuntimeDiagnostics,
          });
          return createDefaultTripChatService(options);
        },
      },
    });

    expect((await call("PUT", "/api/admin/settings", {
      openai_model: "factory-threading-model",
    }, "admin@123")).status).toBe(200);

    expect(observed.map((entry) => entry.kind)).toEqual([
      "parent",
      "planner",
      "chat",
      "parent",
      "planner",
      "chat",
    ]);
    for (const entry of observed) {
      expect(entry.catalog).toBe(runtime.skills);
      expect(entry.diagnostics).toBe(runtime.skillRuntimeDiagnostics);
    }
  });
});
