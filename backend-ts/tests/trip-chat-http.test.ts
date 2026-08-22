import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmCallOptions, LlmClient } from "../src/agents/llm/providers.ts";
import type {
  ParentAgentCompletion,
  ParentAgentScope,
  YoubanParentAgent,
} from "../src/agents/persistent-parent-agent.ts";
import type { StructuredAgentRequest, StructuredAgentRunner } from "../src/agents/pi-trip-planner.ts";
import { TripChatService, planRevision } from "../src/agents/trip-chat-service.ts";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

const PLAN = {
  city: "北京",
  cities: [{ city: "北京", days: 1 }],
  start_date: "2026-10-01",
  end_date: "2026-10-01",
  weather_info: [],
  overall_suggestions: "原建议",
  days: [{
    date: "2026-10-01",
    day_index: 0,
    city: "北京",
    description: "原计划",
    transportation: "地铁",
    accommodation: "酒店",
    hotel: { name: "可信酒店", poi_id: "H1" },
    attractions: [{ name: "故宫", poi_id: "P1" }],
    meals: [],
  }],
};

class NoopPlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) {
    return { success: true, data: request };
  }
}

class FakeLlm implements LlmClient {
  readonly model = {
    id: "fake", name: "fake", api: "openai-completions" as const, provider: "fake",
    baseUrl: "http://fake.invalid", reasoning: false, input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1_000, maxTokens: 1_000,
  };
  async *stream(_prompt: string, _options?: LlmCallOptions) { yield "按原计划上午参观即可。"; }
  async complete() { return "按原计划上午参观即可。"; }
}

class EditAgents implements StructuredAgentRunner {
  async run(request: StructuredAgentRequest) {
    const input = request.input as Record<string, any>;
    return {
      reply: "已调整说明。",
      expected_revision: input.expected_revision,
      patch: [{ op: "replace", path: "/days/0/description", value: "上午错峰参观" }],
      changes: ["已调整第一天说明"],
    };
  }
}

class FakeParentAgent implements YoubanParentAgent {
  readonly completionScopes: string[] = [];
  readonly delegationScopes: string[] = [];
  readonly exchanges: Array<{ scope: string; user: string; assistant: string }> = [];

  async complete(input: ParentAgentCompletion): Promise<string> {
    this.completionScopes.push(input.scope.key);
    return "由父会话回答。";
  }

  async delegate(scope: ParentAgentScope, request: StructuredAgentRequest): Promise<unknown> {
    this.delegationScopes.push(scope.key);
    const input = request.input as Record<string, any>;
    return {
      reply: "父会话已调整。",
      expected_revision: input.expected_revision,
      patch: [{ op: "replace", path: "/days/0/description", value: "父会话调整后的计划" }],
      changes: ["已通过父会话调整第一天"],
    };
  }

  async recordExchange(scope: ParentAgentScope, user: string, assistant: string): Promise<void> {
    this.exchanges.push({ scope: scope.key, user, assistant });
  }

  async close(): Promise<void> {}
}

const runtimes: HttpRuntime[] = [];
const dirs: string[] = [];

function runtime() {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-chat-http-"));
  dirs.push(dataDir);
  const chatService = new TripChatService({ llm: new FakeLlm(), agents: new EditAgents(), mode: "pi" });
  const value = createHttpRuntime({ dataDir, planner: new NoopPlanner(), chatService });
  value.tasks.save(createTaskState("plan-1", {
    user_id: "owner-1",
    status: "completed",
    stage: "completed",
    progress: 100,
    result: { success: true, data: structuredClone(PLAN) },
    request_payload: { city: "北京" },
  }), { immediate: true });
  value.conversations.save("plan-1", "owner-1", [{ role: "user", content: "创建北京行程" }]);
  runtimes.push(value);
  return value;
}

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function call(app: HttpRuntime["app"], path: string, body: unknown, user = "owner-1") {
  return app.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": user },
    body: JSON.stringify(body),
  }));
}

function persistedPlan(value: HttpRuntime): Record<string, any> {
  return (value.tasks.get("plan-1")!.result as Record<string, any>).data;
}

describe("trip chat HTTP", () => {
  it("answers plan questions", async () => {
    const value = runtime();
    const response = await call(value.app, "/api/chat/ask", {
      message: "几点去故宫？",
      trip_plan: PLAN,
      history: [],
    });
    expect(await response.json()).toEqual({ success: true, reply: "按原计划上午参观即可。" });
  });

  it("persists an owned revisioned edit and appends its conversation", async () => {
    const value = runtime();
    const current = persistedPlan(value);
    const response = await call(value.app, "/api/chat/edit", {
      plan_id: "plan-1",
      revision: planRevision(current),
      message: "第一天错峰",
      trip_plan: current,
      history: [],
    });
    expect(response.status).toBe(200);
    const result = await response.json() as Record<string, any>;
    expect(result).toEqual(expect.objectContaining({
      success: true,
      updated_plan: expect.objectContaining({
        days: [expect.objectContaining({ description: "上午错峰参观" })],
      }),
      changes: ["已调整第一天说明"],
      revision: expect.any(String),
    }));
    expect((value.tasks.get("plan-1")?.result as Record<string, any>).data.days[0].description)
      .toBe("上午错峰参观");
    expect(value.conversations.get("plan-1").slice(-2)).toEqual([
      { role: "user", content: "第一天错峰" },
      { role: "assistant", content: "已调整说明。" },
    ]);
  });

  it("rejects non-owners and stale edits with 403/409", async () => {
    const value = runtime();
    const current = persistedPlan(value);
    const body = {
      plan_id: "plan-1",
      revision: planRevision(current),
      message: "修改",
      trip_plan: current,
      history: [],
    };
    const forbidden = await call(value.app, "/api/chat/edit", body, "other");
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ detail: "无权修改该计划" });
    const stale = await call(value.app, "/api/chat/edit", { ...body, revision: "stale" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ detail: "行程版本已变化，请刷新后重试" });
  });

  it("allows only one concurrent edit based on the same revision", async () => {
    const value = runtime();
    const current = persistedPlan(value);
    const body = {
      plan_id: "plan-1",
      revision: planRevision(current),
      message: "并发修改",
      trip_plan: current,
      history: [],
    };
    const responses = await Promise.all([
      call(value.app, "/api/chat/edit", body),
      call(value.app, "/api/chat/edit", body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(value.conversations.get("plan-1").filter((message) => message.content === "并发修改"))
      .toHaveLength(1);
  });

  it("uses one plan-scoped parent session for ask, edit delegation, and transcript recording", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-chat-parent-"));
    dirs.push(dataDir);
    const parent = new FakeParentAgent();
    const chatService = new TripChatService({ llm: new FakeLlm(), parentAgent: parent, mode: "pi" });
    const value = createHttpRuntime({ dataDir, planner: new NoopPlanner(), chatService, parentAgent: parent });
    value.tasks.save(createTaskState("plan-1", {
      user_id: "owner-1",
      status: "completed",
      stage: "completed",
      progress: 100,
      result: { success: true, data: structuredClone(PLAN) },
      request_payload: { city: "北京" },
    }), { immediate: true });
    runtimes.push(value);

    const asked = await call(value.app, "/api/chat/ask", {
      message: "几点去故宫？",
      plan_id: "plan-1",
      trip_plan: PLAN,
    });
    expect(await asked.json()).toEqual({ success: true, reply: "由父会话回答。" });

    const current = persistedPlan(value);
    const edited = await call(value.app, "/api/chat/edit", {
      message: "调整第一天",
      plan_id: "plan-1",
      revision: planRevision(current),
      trip_plan: current,
    });
    expect(edited.status).toBe(200);
    expect(parent.completionScopes).toEqual(["plan:owner-1:plan-1"]);
    expect(parent.delegationScopes).toEqual(["plan:owner-1:plan-1"]);
    expect(parent.exchanges).toEqual([{
      scope: "plan:owner-1:plan-1",
      user: "调整第一天",
      assistant: "父会话已调整。",
    }]);
  });

  it("emits an edit reply delta before the final SSE payload", async () => {
    const value = runtime();
    const current = persistedPlan(value);
    const response = await call(value.app, "/api/chat/edit/stream", {
      plan_id: "plan-1",
      revision: planRevision(current),
      message: "第一天错峰",
      trip_plan: current,
    });
    const raw = await response.text();
    expect(raw).toContain('"type":"delta","text":"已调整说明。"');
    expect(raw).toContain('"type":"final"');
    expect(raw).toContain("data: [DONE]");
  });
});
