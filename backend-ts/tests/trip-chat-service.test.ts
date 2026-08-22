import { describe, expect, it } from "bun:test";
import type { LlmCallOptions, LlmClient } from "../src/agents/llm/providers.ts";
import type { StructuredAgentRequest, StructuredAgentRunner } from "../src/agents/pi-trip-planner.ts";
import {
  RevisionConflictError,
  TripChatService,
  UnsafePlanPatchError,
  planRevision,
} from "../src/agents/trip-chat-service.ts";
import type { TripMemory } from "../src/services/hermes-memory.ts";

const PLAN = {
  city: "北京",
  cities: [{ city: "北京", days: 1 }],
  start_date: "2026-10-01",
  end_date: "2026-10-01",
  weather_info: [{ date: "2026-10-01", day_weather: "晴" }],
  overall_suggestions: "早睡早起",
  days: [{
    date: "2026-10-01",
    day_index: 0,
    city: "北京",
    description: "游览故宫",
    transportation: "地铁",
    accommodation: "舒适型酒店",
    hotel: { name: "高德酒店", poi_id: "H1", source: "amap" },
    attractions: [{ name: "故宫", poi_id: "P1", start_time: "09:00" }],
    meals: [{ type: "午餐", name: "简餐", estimated_cost: 50 }],
  }],
};

class FakeAgents implements StructuredAgentRunner {
  output: unknown;
  requests: StructuredAgentRequest[] = [];
  constructor(output: unknown) { this.output = output; }
  async run(request: StructuredAgentRequest) {
    this.requests.push(request);
    return structuredClone(this.output);
  }
}

class FakeLlm implements LlmClient {
  readonly model = {
    id: "fake",
    name: "fake",
    api: "openai-completions" as const,
    provider: "fake",
    baseUrl: "http://fake.invalid",
    reasoning: false,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000,
    maxTokens: 1_000,
  };
  prompts: string[] = [];
  constructor(private readonly output: string) {}
  async *stream(prompt: string, _options?: LlmCallOptions) { this.prompts.push(prompt); yield this.output; }
  async complete(prompt: string) { this.prompts.push(prompt); return this.output; }
}

class FakeMemory implements TripMemory {
  recalls: Array<[string, string]> = [];
  remembers: Array<[string, string]> = [];
  async recall(userId: string, query: string) {
    this.recalls.push([userId, query]);
    return "用户偏好每天午休";
  }
  async remember(userId: string, content: string) {
    this.remembers.push([userId, content]);
    return true;
  }
}

function editOutput(patch: unknown[]) {
  return {
    reply: "已调整第一天节奏。",
    expected_revision: planRevision(PLAN),
    patch,
    changes: ["已更新第一天说明"],
  };
}

describe("TripChatService", () => {
  it("applies a revision-bound child patch while preserving immutable facts", async () => {
    const agents = new FakeAgents(editOutput([
      { op: "replace", path: "/days/0/description", value: "上午故宫，下午休息" },
      { op: "replace", path: "/days/0/attractions/0/start_time", value: "10:00" },
    ]));
    const service = new TripChatService({
      llm: new FakeLlm("unused"),
      agents,
      mode: "pi",
    });
    const result = await service.edit({
      message: "第一天轻松一点",
      trip_plan: PLAN,
      history: [],
      revision: planRevision(PLAN),
    });
    expect(result.updated_plan).toEqual(expect.objectContaining({
      city: "北京",
      weather_info: PLAN.weather_info,
      days: [expect.objectContaining({
        description: "上午故宫，下午休息",
        hotel: PLAN.days[0]!.hotel,
        attractions: [expect.objectContaining({ poi_id: "P1", start_time: "10:00" })],
      })],
    }));
    expect(result.revision).toBe(planRevision(result.updated_plan));
    expect(agents.requests[0]?.agent).toBe("plan-editor");
  });

  it("rejects stale revisions before invoking a model", async () => {
    const agents = new FakeAgents(editOutput([]));
    const service = new TripChatService({ llm: new FakeLlm("unused"), agents, mode: "pi" });
    await expect(service.edit({
      message: "修改",
      trip_plan: PLAN,
      history: [],
      revision: "stale",
    })).rejects.toBeInstanceOf(RevisionConflictError);
    expect(agents.requests).toEqual([]);
  });

  it("blocks hotel replacement and untrusted attraction ids", async () => {
    for (const patch of [
      [{ op: "replace", path: "/days/0/hotel", value: { name: "虚构酒店" } }],
      [{ op: "replace", path: "/days/0/attractions/0/poi_id", value: "FAKE" }],
    ]) {
      const service = new TripChatService({
        llm: new FakeLlm("unused"),
        agents: new FakeAgents(editOutput(patch)),
        mode: "pi",
      });
      await expect(service.edit({ message: "修改", trip_plan: PLAN, history: [] }))
        .rejects.toBeInstanceOf(UnsafePlanPatchError);
    }
  });

  it("uses the simple LLM switch but keeps the same patch contract", async () => {
    const output = JSON.stringify(editOutput([
      { op: "replace", path: "/overall_suggestions", value: "预留午休时间" },
    ]));
    const agents = new FakeAgents({});
    const service = new TripChatService({ llm: new FakeLlm(output), agents, mode: "simple" });
    const result = await service.edit({ message: "加上午休", trip_plan: PLAN, history: [] });
    expect(result.updated_plan?.overall_suggestions).toBe("预留午休时间");
    expect(agents.requests).toEqual([]);
  });

  it("recalls isolated user memory and remembers applied edit preferences", async () => {
    const memory = new FakeMemory();
    const llm = new FakeLlm("可以按计划上午参观。");
    const service = new TripChatService({
      llm,
      agents: new FakeAgents(editOutput([
        { op: "replace", path: "/overall_suggestions", value: "每天安排午休" },
      ])),
      mode: "pi",
      memory,
    });
    await service.ask({ message: "怎么安排？", trip_plan: PLAN, user_id: "user-1" });
    expect(memory.recalls).toEqual([["user-1", "怎么安排？"]]);
    expect(llm.prompts[0]).toContain("用户偏好每天午休");
    await service.edit({ message: "记得午休", trip_plan: PLAN, user_id: "user-1" });
    expect(memory.remembers).toHaveLength(1);
    expect(memory.remembers[0]?.[0]).toBe("user-1");
    expect(memory.remembers[0]?.[1]).toContain("记得午休");
  });
});
