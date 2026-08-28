import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmCallOptions, LlmClient, PiAgentCallOptions } from "../src/agents/llm/providers.ts";
import type {
  ParentAgentCompletion,
  ParentAgentScope,
  YoubanParentAgent,
} from "../src/agents/persistent-parent-agent.ts";
import { TripAssistant } from "../src/agents/trip-assistant.ts";
import { ConfirmationLedger } from "../src/domain/confirmation.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class FakeLlmClient implements LlmClient {
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

  constructor(private readonly outputs: string[][]) {}

  async *stream(prompt: string, _options?: LlmCallOptions): AsyncIterable<string> {
    this.prompts.push(prompt);
    const chunks = this.outputs.shift();
    if (!chunks) throw new Error("no fake LLM output queued");
    for (const chunk of chunks) yield chunk;
  }

  async complete(prompt: string, options?: LlmCallOptions): Promise<string> {
    let output = "";
    for await (const chunk of this.stream(prompt, options)) output += chunk;
    return output;
  }
}

class AbortAwareLlm implements LlmClient {
  readonly model = new FakeLlmClient([]).model;
  signal: AbortSignal | undefined;

  async *stream(_prompt: string, options?: LlmCallOptions): AsyncIterable<string> {
    this.signal = options?.signal;
    if (!this.signal) throw new Error("missing signal");
    await new Promise<void>((_resolve, reject) => {
      if (this.signal!.aborted) return reject(this.signal!.reason);
      this.signal!.addEventListener("abort", () => reject(this.signal!.reason), { once: true });
    });
  }

  async complete(): Promise<string> {
    throw new Error("unexpected non-stream completion");
  }
}

class FailingLlm implements LlmClient {
  readonly model = new FakeLlmClient([]).model;

  async *stream(): AsyncIterable<string> {
    throw new Error("DeepSeek request failed with status 400");
  }

  async complete(): Promise<string> {
    throw new Error("DeepSeek request failed with status 400");
  }
}

class AgentOnlyLlm implements LlmClient {
  readonly model = new FakeLlmClient([]).model;
  readonly calls: Array<{ prompt: string; options: PiAgentCallOptions }> = [];

  constructor(private readonly outputs: string[][]) {}

  stream(): AsyncIterable<string> {
    throw new Error("unexpected direct stream");
  }

  async complete(): Promise<string> {
    throw new Error("unexpected direct completion");
  }

  async agentComplete(prompt: string, options: PiAgentCallOptions): Promise<string> {
    this.calls.push({ prompt, options });
    const chunks = this.outputs.shift();
    if (!chunks) throw new Error("no fake Pi Agent output queued");
    let output = "";
    for (const chunk of chunks) {
      output += chunk;
      await options.onDelta?.(chunk);
    }
    return output;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("timed out waiting for condition");
    await Bun.sleep(5);
  }
}

class FakeParentAgent implements YoubanParentAgent {
  readonly scopes: ParentAgentScope[] = [];

  constructor(private readonly outputs: string[]) {}

  async complete(input: ParentAgentCompletion): Promise<string> {
    this.scopes.push(input.scope);
    const output = this.outputs.shift();
    if (!output) throw new Error("no fake parent output queued");
    await input.onDelta?.(output);
    return output;
  }

  async delegate(): Promise<unknown> { throw new Error("unexpected delegation"); }
  async recordExchange(): Promise<void> {}
  async close(): Promise<void> {}
}

const tempDirs: string[] = [];
const runtimes: HttpRuntime[] = [];

function makeRuntime(outputs: string[][]): { runtime: HttpRuntime; ledger: ConfirmationLedger; llm: FakeLlmClient } {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-assistant-"));
  tempDirs.push(dataDir);
  const llm = new FakeLlmClient(outputs);
  const ledger = new ConfirmationLedger({ secret: Buffer.alloc(32, 11) });
  const assistant = new TripAssistant({ llm, ledger });
  const runtime = createHttpRuntime({ dataDir, assistant });
  runtimes.push(runtime);
  return { runtime, ledger, llm };
}

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function post(app: HttpRuntime["app"], path: string, body: unknown, userId?: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(userId ? { "x-user-id": userId } : {}),
    },
    body: JSON.stringify(body),
  }));
}

function sseEvents(raw: string): Array<Record<string, any> | "done"> {
  return raw.split("\n\n").flatMap((block) => {
    const data = block.trim().replace(/^data:\s*/, "");
    if (!data) return [];
    return data === "[DONE]" ? ["done" as const] : [JSON.parse(data)];
  });
}

describe("trip parse/confirm HTTP and SSE", () => {
  it("normalizes a plan draft from the non-stream parse endpoint", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "excited",
      reply: "我整理了一份草稿。",
      cities: [{ city: "大理", days: 7 }],
      start_date: "2026-10-01",
      end_date: "2026-10-05",
      transportation: "公共交通",
      accommodation: "经济型酒店",
      traveler_count: 2,
      room_count: 1,
      budget_amount: 3000,
      budget_basis: "group_total",
      preferences: ["自然风光"],
      ready_to_generate: true,
      inferred_fields: ["dates"],
      suggestions: ["should be removed"],
    });
    const { runtime, llm } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "国庆帮我安排大理七天",
      language: "zh-CN",
      today: "2026-08-21",
      history: [],
    });
    expect(response.status).toBe(200);
    const result = await response.json() as Record<string, any>;
    expect(result).toEqual(expect.objectContaining({
      success: true,
      action: "plan",
      ready_to_generate: true,
      readiness_token: expect.any(String),
      trip: expect.objectContaining({
        city: "大理",
        travel_days: 7,
        end_date: "2026-10-07",
        traveler_count: 2,
        budget_amount: 3000,
        inferred_fields: [],
        suggestions: [],
      }),
    }));
    expect(result.readiness_token).not.toBe("");
    expect(llm.prompts[0]).toContain("国庆帮我安排大理七天");
  });

  it("gives the intake model a warm first-turn and private emotion policy", async () => {
    const output = JSON.stringify({
      action: "clarify",
      emotion: "neutral",
      emotion_score: 2,
      engagement: "engaged",
      response_mode: "question",
      reply: "带娃去三亚放松几天很合适，我先帮你把节奏放轻松。更偏海边玩水，还是亲子乐园？",
    });
    const { runtime, llm } = makeRuntime([[output]]);

    await post(runtime.app, "/api/trip/parse", {
      text: "带娃去三亚海边度假4天",
      language: "zh-CN",
      today: "2026-08-24",
      history: [],
    });

    expect(llm.prompts[0]).toContain("内部情绪负面分");
    expect(llm.prompts[0]).toContain("1-3");
    expect(llm.prompts[0]).toContain("首次对话");
    expect(llm.prompts[0]).toContain("最多追问一个");
    expect(llm.prompts[0]).toContain("不得向用户展示");
  });

  it("asks the Agent to infer dialogue stage, intent, emotion, and next step from full context", async () => {
    const output = JSON.stringify({
      action: "recommend",
      emotion: "uncertain",
      emotion_score: 4,
      engagement: "uncertain",
      dialogue_stage: "exploring",
      next_step: "offer_generation",
      response_mode: "choices",
      reply: "没关系，我先给你几个容易选的方向。",
      choice_options: [
        { name: "海边放松", highlights: "慢节奏亲子玩水", suggested_days: "4天" },
        { name: "雨林探索", highlights: "自然体验与轻徒步", suggested_days: "4天" },
      ],
    });
    const { runtime, llm } = makeRuntime([[output]]);

    await post(runtime.app, "/api/trip/parse", {
      text: "我也没什么思路，你看着推荐吧",
      language: "zh-CN",
      today: "2026-08-24",
      history: [
        { role: "user", content: "想带孩子出去玩几天，但还没想好去哪" },
        { role: "assistant", content: "更喜欢海边还是山里？" },
      ],
    });

    expect(llm.prompts[0]).toContain("dialogue_stage");
    expect(llm.prompts[0]).toContain("next_step");
    expect(llm.prompts[0]).toContain("结合完整对话语义");
    expect(llm.prompts[0]).toContain("一句话可能同时包含");
    expect(llm.prompts[0]).not.toContain("consecutive_low_engagement_turns");
  });

  it("lets the Agent advance from a recommendation to a ready draft without another choice loop", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "neutral",
      emotion_score: 5,
      engagement: "disengaging",
      dialogue_stage: "decision_fatigue",
      next_step: "offer_generation",
      response_mode: "support",
      reply: "好，我替你收住选择，也会避开让孩子太累的安排。轻松的海边亲子路线已经整理好，要现在生成游玩计划吗？",
      cities: [{ city: "三亚", days: 4 }],
      start_date: "2026-08-25",
      transportation: "公共交通",
      accommodation: "亲子酒店",
      traveler_count: 2,
      room_count: 1,
      preferences: ["自然风光", "亲子", "轻松"],
      ready_to_generate: true,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "我没心思继续挑了，不过孩子不能玩太累",
      language: "zh-CN",
      today: "2026-08-24",
      history: [
        { role: "user", content: "带孩子去三亚玩4天" },
        { role: "assistant", content: "我推荐海边放松、雨林探索和经典景点三种方向。" },
      ],
    });
    const result = await response.json() as Record<string, any>;

    expect(result).toEqual(expect.objectContaining({
      action: "plan",
      next_step: "offer_generation",
      auto_generate: false,
      ready_to_generate: true,
      trip: expect.objectContaining({
        city: "三亚",
        preferences: ["自然风光", "亲子", "轻松"],
      }),
    }));
    expect(result.reply).toContain("孩子太累");
    expect(result.reply).not.toContain("| 方案 |");
  });

  it("issues a one-time execution token when the Agent confidently chooses direct generation", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "frustrated",
      emotion_score: 7,
      engagement: "disengaging",
      dialogue_stage: "decision_fatigue",
      next_step: "generate_now",
      next_step_confidence: 0.93,
      response_mode: "support",
      reply: "明白，我不再让你做选择，按刚才推荐的轻松路线直接生成。",
      cities: [{ city: "三亚", days: 4 }],
      start_date: "2026-08-25",
      transportation: "公共交通",
      accommodation: "亲子酒店",
      traveler_count: 2,
      room_count: 1,
      preferences: ["自然风光", "亲子", "轻松"],
      ready_to_generate: true,
    });
    const { runtime, ledger } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "别再让我选了，孩子不能太累，其他你安排",
      language: "zh-CN",
      today: "2026-08-24",
      history: [
        { role: "user", content: "带孩子去三亚玩4天" },
        { role: "assistant", content: "我已经推荐了三个适合亲子的方向。" },
      ],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.auto_generate).toBeTrue();
    expect(result.execution_token).not.toBe("");
    expect(ledger.validate(result.execution_token, { ...result.trip, language: "zh-CN" }).valid).toBeTrue();
  });

  it("downgrades an uncertain direct-generation decision to an explicit offer", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "uncertain",
      engagement: "disengaging",
      dialogue_stage: "decision_fatigue",
      next_step: "generate_now",
      next_step_confidence: 0.68,
      response_mode: "support",
      reply: "我先替你选好轻松路线，你确认后就可以生成。",
      cities: [{ city: "三亚", days: 4 }],
      start_date: "2026-08-25",
      preferences: ["亲子", "轻松"],
      ready_to_generate: true,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "我有点拿不准，先帮我看看",
      language: "zh-CN",
      today: "2026-08-24",
      history: [{ role: "assistant", content: "我推荐了三个亲子方向。" }],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.next_step).toBe("offer_generation");
    expect(result.auto_generate).toBeFalse();
    expect(result.execution_token).toBe("");
    expect(result.readiness_token).not.toBe("");
  });

  it("does not render a follow-up question already contained in the main reply", async () => {
    const question = "住宿和出行方式，你更倾向哪种？";
    const output = JSON.stringify({
      action: "clarify",
      emotion: "neutral",
      reply: `带娃去三亚放松几天很合适。${question}`,
      follow_up_question: question,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "带娃去三亚海边度假4天",
      language: "zh-CN",
      today: "2026-08-24",
      history: [],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.follow_up_question).toBe("");
  });

  it("renders model choice options as one Markdown comparison table", async () => {
    const output = JSON.stringify({
      action: "clarify",
      emotion: "neutral",
      response_mode: "choices",
      reply: "序号 方案 特点 建议天数\n1 亚龙湾 热带天堂森林公园 2天\n\n1. 亚龙湾：热带天堂森林公园",
      choice_options: [
        { name: "亚龙湾 + 热带天堂森林公园", highlights: "沙滩海水与雨林景观", suggested_days: "2天" },
        { name: "蜈支洲岛 + 后海村", highlights: "海岛浮潜与渔村赶海", suggested_days: "2天" },
        { name: "大小洞天 + 南山文化旅游区", highlights: "礁石海岸与椰林", suggested_days: "2天" },
      ],
      recommendations: [
        { destination: "亚龙湾 + 热带天堂森林公园", reason: "沙滩海水与雨林景观", suggested_days: 2 },
        { destination: "蜈支洲岛 + 后海村", reason: "海岛浮潜与渔村赶海", suggested_days: 2 },
      ],
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "自然风光",
      language: "zh-CN",
      today: "2026-08-24",
      history: [
        { role: "user", content: "带娃去三亚海边度假4天" },
        { role: "assistant", content: "你更想看自然风光，还是逛吃和人文？" },
      ],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.reply).toContain("| 方案 | 特点 | 建议天数 |");
    expect(result.reply).toContain("| --- | --- | --- |");
    expect(result.reply.match(/亚龙湾/g)).toHaveLength(1);
    expect(result.reply).not.toContain("序号 方案 特点");
    expect(result.follow_up_question).toBe("");
    expect(result.recommendations).toEqual([]);
  });

  it("trims city stays to the 30-day planning limit without breaking their sum", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "neutral",
      reply: "草稿已整理。",
      cities: [
        { city: "乌鲁木齐", days: 10 },
        { city: "伊犁", days: 10 },
        { city: "喀什", days: 15 },
      ],
      start_date: "2026-10-01",
      transportation: "",
      accommodation: "   ",
      ready_to_generate: true,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "国庆新疆玩一个月帮我计划下",
      language: "zh-CN",
      today: "2026-08-23",
      history: [],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.trip).toEqual(expect.objectContaining({
      cities: [
        { city: "乌鲁木齐", days: 10 },
        { city: "伊犁", days: 10 },
        { city: "喀什", days: 10 },
      ],
      travel_days: 30,
      start_date: "2026-10-01",
      end_date: "2026-10-30",
      transportation: "公共交通",
      accommodation: "经济型酒店",
    }));
  });

  it("expands a vague Xinjiang month draft into a concrete 30-day route", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "neutral",
      reply: "草稿已整理。",
      cities: [{ city: "新疆", days: 15 }],
      start_date: "2026-10-01",
      ready_to_generate: true,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "国庆新疆玩一个月帮我计划下",
      language: "zh-CN",
      today: "2026-08-23",
      history: [],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.trip.travel_days).toBe(30);
    expect(result.trip.end_date).toBe("2026-10-30");
    expect(result.trip.cities.length).toBeGreaterThan(1);
    expect(result.trip.cities.reduce((total: number, city: Record<string, any>) => total + city.days, 0)).toBe(30);
    expect(result.trip.cities.every((city: Record<string, any>) => city.city !== "新疆")).toBeTrue();
  });

  it("fills a multi-city Xinjiang month draft to 30 days", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "neutral",
      reply: "草稿已整理。",
      cities: [
        { city: "乌鲁木齐", days: 10 },
        { city: "伊犁", days: 10 },
        { city: "喀什", days: 9 },
      ],
      start_date: "2026-10-01",
      ready_to_generate: true,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "国庆新疆玩一个月帮我计划下",
      language: "zh-CN",
      today: "2026-08-23",
      history: [],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.trip.travel_days).toBe(30);
    expect(result.trip.end_date).toBe("2026-10-30");
    expect(result.trip.cities.reduce((total: number, city: Record<string, any>) => total + city.days, 0)).toBe(30);
  });

  it("does not expand a shorter South and North Xinjiang request to 30 days", async () => {
    const output = JSON.stringify({
      action: "plan",
      emotion: "neutral",
      reply: "草稿已整理。",
      cities: [
        { city: "乌鲁木齐", days: 5 },
        { city: "喀什", days: 5 },
      ],
      start_date: "2026-10-01",
      ready_to_generate: true,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/parse", {
      text: "国庆南北疆玩10天",
      language: "zh-CN",
      today: "2026-08-23",
      history: [],
    });
    const result = await response.json() as Record<string, any>;

    expect(result.trip.travel_days).toBe(10);
    expect(result.trip.end_date).toBe("2026-10-10");
  });

  it("streams parse reply deltas, one final payload, and DONE", async () => {
    const chunks = [
      '{"action":"chat","emotion":"neutral",',
      '"reply":"你好',
      '呀朋友","follow_up_question":"","recommendations":[]}',
    ];
    const { runtime } = makeRuntime([chunks]);
    const response = await post(runtime.app, "/api/trip/parse/stream", {
      text: "随便聊聊",
      language: "zh",
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const events = sseEvents(await response.text());
    expect(events.filter((event): event is Record<string, any> => event !== "done" && event.type === "delta")
      .map((event) => event.text).join("")).toBe("你好呀朋友");
    const finals = events.filter((event): event is Record<string, any> => event !== "done" && event.type === "final");
    expect(finals).toHaveLength(1);
    expect(finals[0]?.payload).toEqual(expect.objectContaining({ action: "chat", reply: "你好呀朋友" }));
    expect(events.at(-1)).toBe("done");
  });

  it("reports an unavailable intake model instead of repeating a clarification fallback", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-assistant-unavailable-"));
    tempDirs.push(dataDir);
    const runtime = createHttpRuntime({
      dataDir,
      assistant: new TripAssistant({
        llm: new FailingLlm(),
        ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 23) }),
      }),
    });
    runtimes.push(runtime);

    const response = await post(runtime.app, "/api/trip/parse/stream", {
      text: "自然风光",
      language: "zh-CN",
    });
    const raw = await response.text();
    const events = sseEvents(raw);
    const errors = events.filter((event): event is Record<string, any> => (
      event !== "done" && event.type === "error"
    ));

    expect(errors).toEqual([{
      type: "error",
      message: "游伴暂时没有连接上，请稍后再试。刚才的消息已经保留。",
    }]);
    expect(events.some((event) => event !== "done" && event.type === "final")).toBeFalse();
    expect(raw).not.toContain("你更想看自然风光");
  });

  it("reports intake failures in French", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-assistant-unavailable-fr-"));
    tempDirs.push(dataDir);
    const runtime = createHttpRuntime({
      dataDir,
      assistant: new TripAssistant({
        llm: new FailingLlm(),
        ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 31) }),
      }),
    });
    runtimes.push(runtime);

    const response = await post(runtime.app, "/api/trip/parse/stream", {
      text: "Je cherche un voyage nature et économique",
      language: "fr-FR",
    });
    const events = sseEvents(await response.text());

    expect(events).toContainEqual({
      type: "error",
      message: "YouBan n'a pas pu se connecter. Réessayez dans un instant ; votre message a bien été conservé.",
    });
    expect(events.some((event) => event !== "done" && event.type === "final")).toBeFalse();
  });

  it("falls an unsupported persisted locale back to Chinese", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-assistant-unsupported-locale-"));
    tempDirs.push(dataDir);
    const runtime = createHttpRuntime({
      dataDir,
      assistant: new TripAssistant({
        llm: new FailingLlm(),
        ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 32) }),
      }),
    });
    runtimes.push(runtime);

    const response = await post(runtime.app, "/api/trip/parse/stream", {
      text: "继续规划",
      language: "xx-XX",
    });
    const events = sseEvents(await response.text());

    expect(events).toContainEqual({
      type: "error",
      message: "游伴暂时没有连接上，请稍后再试。刚才的消息已经保留。",
    });
  });

  it("requests French output and renders French comparison tables", async () => {
    const output = JSON.stringify({
      action: "recommend",
      emotion: "neutral",
      next_step: "recommend",
      response_mode: "choices",
      reply: "Je vous propose trois destinations.",
      choice_options: [
        { name: "Annecy", highlights: "Lac et montagne", suggested_days: "3 jours" },
        { name: "Auvergne", highlights: "Volcans et randonnée", suggested_days: "4 jours" },
      ],
    });
    const { runtime, llm } = makeRuntime([[output]]);

    const response = await post(runtime.app, "/api/trip/parse", {
      text: "Je voudrais des idées nature",
      language: "fr-FR",
      history: [],
    });
    const result = await response.json() as Record<string, any>;

    expect(llm.prompts[0]).toContain("回复语言：fr-FR");
    expect(result.reply).toContain("| Option | Points forts | Durée conseillée |");
    expect(result.reply).toContain("Répondez avec un numéro");
  });

  it("streams a safe intake summary only from an enabled visibility snapshot", async () => {
    for (const [thinkingVisible, expectedCount] of [[false, 0], [true, 1]] as const) {
      const dataDir = mkdtempSync(join(tmpdir(), `youban-intake-thinking-${thinkingVisible}-`));
      tempDirs.push(dataDir);
      const llm = new FakeLlmClient([[
        '{"reply":"你好","action":"chat","emotion":"neutral"}',
      ]]);
      const runtime = createHttpRuntime({
        dataDir,
        assistant: new TripAssistant({
          llm,
          ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 29) }),
          thinkingVisible,
        }),
      });
      runtimes.push(runtime);

      const response = await post(runtime.app, "/api/trip/parse/stream", { text: "想去放松一下" });
      const events = sseEvents(await response.text());
      const thoughts = events.filter((event): event is Record<string, any> => (
        event !== "done" && event.type === "thinking"
      ));
      const deltas = events.filter((event): event is Record<string, any> => (
        event !== "done" && event.type === "delta"
      ));

      expect(thoughts).toHaveLength(expectedCount);
      if (thinkingVisible) {
        expect(thoughts[0]?.detail).toEqual({
          type: "thinking",
          title: "正在梳理你的旅行偏好与行程条件",
        });
      }
      expect(deltas.map((event) => event.text).join("")).toBe("你好");
    }
  });

  it("aborts the parse model when the SSE reader disconnects", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-assistant-abort-"));
    tempDirs.push(dataDir);
    const llm = new AbortAwareLlm();
    const runtime = createHttpRuntime({
      dataDir,
      assistant: new TripAssistant({
        llm,
        ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 19) }),
      }),
    });
    runtimes.push(runtime);
    const requestAbort = new AbortController();
    const response = await runtime.app.handle(new Request("http://localhost/api/trip/parse/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "开始一个长请求", language: "zh-CN" }),
      signal: requestAbort.signal,
    }));
    const reader = response.body!.getReader();
    await waitUntil(() => llm.signal !== undefined);

    const cancelling = reader.cancel("client-left");
    try {
      await Bun.sleep(10);
      expect(llm.signal?.aborted).toBeTrue();
      expect(llm.signal?.reason).toBe("client-left");
    } finally {
      requestAbort.abort(new Error("test cleanup"));
      await cancelling.catch(() => {});
    }
  });

  it("streams confirm message and signs only a high-confidence explicit confirmation", async () => {
    const draft = {
      city: "大理",
      cities: [{ city: "大理", days: 3 }],
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
      transportation: "公共交通",
      accommodation: "经济型酒店",
      traveler_count: 1,
      room_count: 1,
      budget_amount: null,
      budget_basis: "group_total",
      preferences: [],
      free_text_input: "去大理",
      origin_text: "去大理",
    };
    const chunks = [
      '{"action":"confirm","confidence":0.95,',
      '"message":"这就帮你',
      '生成","cities":[]}',
    ];
    const { runtime, ledger } = makeRuntime([chunks]);
    const readinessToken = ledger.attestReady({ ...draft, language: "zh-CN" });
    const response = await post(runtime.app, "/api/trip/confirm-reply/stream", {
      text: "照这个执行",
      draft,
      language: "zh-CN",
      today: "2026-08-21",
      history: [],
      readiness_token: readinessToken,
    });
    const events = sseEvents(await response.text());
    const deltas = events.filter((event): event is Record<string, any> => event !== "done" && event.type === "delta");
    expect(deltas.map((event) => event.text).join("")).toBe("这就帮你生成");
    const final = events.find((event): event is Record<string, any> => event !== "done" && event.type === "final")!;
    expect(final.payload.action).toBe("confirm");
    expect(final.payload.decision_id).not.toBe("");
    expect(final.payload.execution_token).not.toBe("");
    expect(ledger.validate(final.payload.execution_token, { ...draft, language: "zh-CN" })).toEqual({
      valid: true,
      reason: "ok",
    });
  });

  it("renders requested choices and keeps a ready draft actionable", async () => {
    const draft = {
      city: "大理",
      cities: [
        { city: "大理", days: 2 },
        { city: "丽江", days: 3 },
      ],
      start_date: "2026-10-01",
      end_date: "2026-10-05",
      travel_days: 5,
      transportation: "公共交通",
      accommodation: "经济型酒店",
      traveler_count: 1,
      room_count: 1,
      budget_amount: null,
      budget_basis: "group_total",
      preferences: ["自然风光", "古城文化"],
      free_text_input: "国庆去云南大理丽江玩5天",
      origin_text: "国庆去云南大理丽江玩5天",
    };
    const output = JSON.stringify({
      action: "chat",
      confidence: 0.91,
      message: "我给你两个方向参考。",
      response_mode: "choices",
      choice_options: [
        { name: "苍山 + 洱海", highlights: "自然风光，适合大理段", suggested_days: "2天" },
        { name: "玉龙雪山 + 蓝月谷", highlights: "高山景观，适合丽江段", suggested_days: "1天" },
      ],
      next_step: "recommend",
    });
    const { runtime, ledger, llm } = makeRuntime([[output]]);
    const readinessToken = ledger.attestReady({ ...draft, language: "zh-CN" });

    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "一个给两个景点我参考吧",
      draft,
      language: "zh-CN",
      today: "2026-08-25",
      history: [{ role: "assistant", content: "我先按聊到的信息整理了一份路线初稿。" }],
      readiness_token: readinessToken,
    });
    const result = await response.json() as Record<string, any>;

    expect(result).toEqual(expect.objectContaining({
      action: "chat",
      next_step: "offer_generation",
      ready_to_generate: true,
      readiness_token: readinessToken,
      execution_token: "",
    }));
    expect(result.message).toContain("| 方案 | 特点 | 建议天数 |");
    expect(result.message).toContain("苍山 + 洱海");
    expect(result.message).toContain("玉龙雪山 + 蓝月谷");
    expect(result.message).toContain("生成详细行程吗");
    expect(llm.prompts[0]).toContain("choice_options");
    expect(llm.prompts[0]).toContain("next_step");
  });

  it("downgrades low-confidence confirm to ask_confirmation without a token", async () => {
    const output = JSON.stringify({ action: "confirm", confidence: 0.5, message: "开始吧" });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "嗯",
      draft: { cities: [{ city: "大理", days: 3 }] },
      language: "zh",
    });
    expect(await response.json()).toEqual(expect.objectContaining({
      action: "ask_confirmation",
      confidence: 0.5,
      decision_id: "",
      execution_token: "",
      readiness_token: "",
    }));
  });

  it("applies a structured traveler patch without resetting the rest of the draft", async () => {
    const originalDraft = {
      city: "乌鲁木齐",
      cities: [
        { city: "乌鲁木齐", days: 3 },
        { city: "喀纳斯", days: 4 },
        { city: "赛里木湖", days: 3 },
        { city: "伊宁", days: 3 },
        { city: "那拉提", days: 2 },
        { city: "巴音布鲁克", days: 2 },
        { city: "库车", days: 2 },
        { city: "喀什", days: 3 },
        { city: "塔什库尔干", days: 2 },
        { city: "和田", days: 2 },
        { city: "库尔勒", days: 2 },
        { city: "吐鲁番", days: 2 },
      ],
      start_date: "2026-08-26",
      end_date: "2026-09-24",
      travel_days: 30,
      transportation: "自驾",
      accommodation: "经济型酒店与民宿结合",
      traveler_count: 1,
      room_count: 1,
      preferences: ["自然风光", "自驾", "南疆北疆环线"],
    };
    const output = JSON.stringify({
      action: "update",
      confidence: 0.97,
      message: "好的，两个人一起自驾新疆，住宿和费用也可以分摊。",
      draft_patch: { traveler_count: 2 },
      ready_to_generate: true,
      next_step: "offer_generation",
    });
    const { runtime, ledger, llm } = makeRuntime([[output]]);
    const readinessToken = ledger.attestReady({ ...originalDraft, language: "zh-CN" });

    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "两个人",
      draft: originalDraft,
      language: "zh-CN",
      today: "2026-08-25",
      readiness_token: readinessToken,
    });
    const result = await response.json() as Record<string, any>;

    expect(result).toEqual(expect.objectContaining({
      action: "update",
      next_step: "offer_generation",
      trip: expect.objectContaining({
        traveler_count: 2,
        room_count: 1,
        travel_days: 30,
        start_date: "2026-08-26",
        end_date: "2026-09-24",
      }),
    }));
    expect(result.trip.cities).toEqual(originalDraft.cities);
    expect(result.readiness_token).not.toBe("");
    expect(result.readiness_token).not.toBe(readinessToken);
    expect(llm.prompts[0]).toContain("draft_patch");
  });

  it("rejects a narrative-only update instead of presenting an unchanged draft as updated", async () => {
    const originalDraft = {
      city: "乌鲁木齐",
      cities: [{ city: "乌鲁木齐", days: 3 }],
      start_date: "2026-08-26",
      end_date: "2026-08-28",
      travel_days: 3,
      traveler_count: 1,
      room_count: 1,
    };
    const output = JSON.stringify({
      action: "update",
      confidence: 0.97,
      message: "已经改成两个人了。",
      draft_patch: {},
      ready_to_generate: true,
      next_step: "offer_generation",
    });
    const { runtime, ledger } = makeRuntime([[output]]);
    const readinessToken = ledger.attestReady({ ...originalDraft, language: "zh-CN" });

    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "两个人",
      draft: originalDraft,
      language: "zh-CN",
      today: "2026-08-25",
      readiness_token: readinessToken,
    });
    const result = await response.json() as Record<string, any>;

    expect(result.action).toBe("chat");
    expect(result.next_step).toBe("ask");
    expect(result.message).toContain("没有成功写入草稿");
    expect(result.message).not.toContain("已经改成两个人");
    expect(result.trip).toBeNull();
    expect(result.readiness_token).toBe(readinessToken);
  });

  it("keeps an updated draft conversational while required details are still missing", async () => {
    const output = JSON.stringify({
      action: "update",
      confidence: 0.92,
      message: "三天记下了。你大概什么时候出发？",
      draft_patch: {
        cities: [{ city: "北京", days: 3 }],
        traveler_count: 1,
        inferred_fields: ["dates", "transportation", "accommodation"],
      },
      ready_to_generate: false,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "玩三天",
      draft: { cities: [{ city: "北京", days: 1 }] },
      language: "zh-CN",
      today: "2026-08-23",
    });

    expect(await response.json()).toEqual(expect.objectContaining({
      action: "update",
      ready_to_generate: false,
      readiness_token: "",
      message: "三天记下了。你大概什么时候出发？",
      trip: expect.objectContaining({ travel_days: 3 }),
    }));
  });

  it("marks an updated draft ready only when the intake Agent says it is complete", async () => {
    const output = JSON.stringify({
      action: "update",
      confidence: 0.96,
      message: "信息齐了，我先给你一份路线初稿。",
      draft_patch: {
        cities: [{ city: "北京", days: 3 }],
        start_date: "2026-10-01",
        transportation: "公共交通",
        accommodation: "舒适型酒店",
        traveler_count: 2,
        room_count: 1,
        preferences: ["历史文化"],
        inferred_fields: [],
      },
      ready_to_generate: true,
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "国庆出发，两个人，喜欢历史文化",
      draft: { cities: [{ city: "北京", days: 3 }] },
      language: "zh-CN",
      today: "2026-08-23",
    });

    const result = await response.json() as Record<string, any>;
    expect(result).toEqual(expect.objectContaining({
      action: "update",
      ready_to_generate: true,
      readiness_token: expect.any(String),
      trip: expect.objectContaining({
        start_date: "2026-10-01",
        traveler_count: 2,
        inferred_fields: [],
      }),
    }));
    expect(result.readiness_token).not.toBe("");
  });

  it("keeps duration updates consistent and lets the Agent finish the revised draft", async () => {
    const originalDraft = {
      city: "大理",
      cities: [
        { city: "大理", days: 2 },
        { city: "丽江", days: 3 },
      ],
      start_date: "2026-10-01",
      end_date: "2026-10-05",
      travel_days: 5,
      transportation: "公共交通",
      accommodation: "经济型酒店",
      traveler_count: 1,
      room_count: 1,
      preferences: ["自然风光", "古城文化"],
    };
    const { runtime, ledger } = makeRuntime([
      [JSON.stringify({
        action: "update",
        confidence: 0.97,
        message: "已经调整为 7 天。要按这份草稿生成详细行程吗？",
        draft_patch: { travel_days: 7 },
        next_step: "offer_generation",
      })],
      [JSON.stringify({
        action: "confirm",
        confidence: 0.94,
        message: "好，我按刚刚调整好的 7 天方案生成。",
        next_step: "generate_now",
        next_step_confidence: 0.94,
      })],
    ]);
    const originalToken = ledger.attestReady({ ...originalDraft, language: "zh-CN" });

    const updatedResponse = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "行程增加到7天",
      draft: originalDraft,
      language: "zh-CN",
      today: "2026-08-25",
      history: [{ role: "assistant", content: "我先按聊到的信息整理了一份 5 天路线初稿。" }],
      readiness_token: originalToken,
    });
    const updated = await updatedResponse.json() as Record<string, any>;

    expect(updated).toEqual(expect.objectContaining({
      action: "update",
      next_step: "offer_generation",
      ready_to_generate: true,
      execution_token: "",
      trip: expect.objectContaining({
        travel_days: 7,
        end_date: "2026-10-07",
      }),
    }));
    expect(updated.trip.cities.reduce((sum: number, city: { days: number }) => sum + city.days, 0)).toBe(7);
    expect(updated.readiness_token).not.toBe("");
    expect(updated.readiness_token).not.toBe(originalToken);

    const confirmedResponse = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "这几天看着够了，后面直接安排吧",
      draft: updated.trip,
      language: "zh-CN",
      today: "2026-08-25",
      history: [
        { role: "user", content: "行程增加到7天" },
        { role: "assistant", content: updated.message },
      ],
      readiness_token: updated.readiness_token,
    });
    const confirmed = await confirmedResponse.json() as Record<string, any>;

    expect(confirmed.action).toBe("confirm");
    expect(confirmed.next_step).toBe("generate_now");
    expect(confirmed.trip.travel_days).toBe(7);
    expect(confirmed.execution_token).not.toBe("");
    expect(ledger.validate(confirmed.execution_token, { ...updated.trip, language: "zh-CN" }).valid).toBeTrue();
  });

  it("honors a high-confidence Agent execution decision for a ready draft", async () => {
    const draft = {
      city: "乌鲁木齐",
      cities: [{ city: "乌鲁木齐", days: 3 }],
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
    };
    const output = JSON.stringify({
      action: "confirm",
      confidence: 0.96,
      message: "好，我现在按这份草稿生成。",
      next_step: "generate_now",
      next_step_confidence: 0.96,
    });
    const { runtime, ledger } = makeRuntime([[output]]);
    const readinessToken = ledger.attestReady({ ...draft, language: "zh-CN" });
    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "确认，立即按这个方案生成",
      draft,
      language: "zh-CN",
      readiness_token: readinessToken,
    });
    const result = await response.json() as Record<string, any>;

    expect(result.action).toBe("confirm");
    expect(result.confidence).toBe(0.96);
    expect(result.execution_token).not.toBe("");
    expect(ledger.validate(result.execution_token, { ...draft, language: "zh-CN" }).valid).toBeTrue();
  });

  it("does not authorize a short affirmative for a draft without a readiness attestation", async () => {
    const draft = {
      city: "北京",
      cities: [{ city: "北京", days: 3 }],
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
    };
    const output = JSON.stringify({
      action: "ask_confirmation",
      confidence: 0.2,
      message: "你要开始生成吗？",
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "确定",
      draft,
      language: "zh-CN",
    });
    const result = await response.json() as Record<string, any>;

    expect(result.action).toBe("ask_confirmation");
    expect(result.execution_token).toBe("");
    expect(result.readiness_token).toBe("");
  });

  it("re-attests a complete draft after readiness expires without executing in the same turn", async () => {
    const draft = {
      city: "北京",
      cities: [{ city: "北京", days: 3 }],
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
    };
    const { runtime, ledger } = makeRuntime([
      [JSON.stringify({
        action: "confirm",
        confidence: 0.96,
        message: "草稿完整，可以开始生成。",
      })],
      [JSON.stringify({
        action: "confirm",
        confidence: 0.95,
        message: "好，我现在开始生成。",
        next_step: "generate_now",
        next_step_confidence: 0.95,
      })],
    ]);

    const refreshed = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "确定",
      draft,
      language: "zh-CN",
      readiness_token: "expired-or-restarted-token",
    });
    const refreshedResult = await refreshed.json() as Record<string, any>;

    expect(refreshedResult.action).toBe("ask_confirmation");
    expect(refreshedResult.execution_token).toBe("");
    expect(refreshedResult.ready_to_generate).toBeTrue();
    expect(refreshedResult.readiness_token).not.toBe("");
    expect(ledger.validateReady(
      refreshedResult.readiness_token,
      { ...draft, language: "zh-CN" },
    ).valid).toBeTrue();

    const confirmed = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "确定",
      draft,
      language: "zh-CN",
      readiness_token: refreshedResult.readiness_token,
    });
    const confirmedResult = await confirmed.json() as Record<string, any>;
    expect(confirmedResult.action).toBe("confirm");
    expect(confirmedResult.execution_token).not.toBe("");
  });

  it("does not override the Agent decision with a local authorization phrase list", async () => {
    const draft = {
      city: "北京",
      cities: [{ city: "北京", days: 3 }],
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
    };
    const output = JSON.stringify({
      action: "chat",
      confidence: 0.91,
      message: "我先回答你刚才的问题，再由你决定是否生成。",
      next_step: "offer_generation",
    });
    const { runtime, ledger } = makeRuntime([[output]]);
    const readinessToken = ledger.attestReady({ ...draft, language: "zh-CN" });
    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "生成详细行程",
      draft,
      language: "zh-CN",
      readiness_token: readinessToken,
    });
    const result = await response.json() as Record<string, any>;

    expect(result.action).toBe("chat");
    expect(result.next_step).toBe("offer_generation");
    expect(result.execution_token).toBe("");
  });

  it("never treats a negated confirmation phrase as explicit authorization", async () => {
    const output = JSON.stringify({
      action: "ask_confirmation",
      confidence: 0.2,
      message: "请确认是否生成。",
    });
    const { runtime } = makeRuntime([[output]]);
    const response = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "我不确定，先不要生成",
      draft: { cities: [{ city: "乌鲁木齐", days: 3 }] },
      language: "zh-CN",
    });
    const result = await response.json() as Record<string, any>;

    expect(result.action).toBe("ask_confirmation");
    expect(result.execution_token).toBe("");
  });

  it("routes parse and confirm through lightweight Pi Agent turns without invoking the full parent", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-parent-http-"));
    tempDirs.push(dataDir);
    const parent = new FakeParentAgent([]);
    const llm = new AgentOnlyLlm([
      [JSON.stringify({
        action: "plan",
        emotion: "neutral",
        reply: "草稿已整理。",
        cities: [{ city: "北京", days: 1 }],
        start_date: "2026-10-01",
        ready_to_generate: true,
      })],
      [JSON.stringify({ action: "confirm", confidence: 0.95, message: "开始生成。" })],
    ]);
    const assistant = new TripAssistant({
      llm,
      ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 7) }),
      parentAgent: parent,
      thinkingEnabled: true,
    });
    const runtime = createHttpRuntime({ dataDir, assistant, parentAgent: parent });
    runtimes.push(runtime);

    const parsed = await post(runtime.app, "/api/trip/parse", { text: "去北京一天" }, "user-parent");
    const parsedResult = await parsed.json() as Record<string, any>;
    const draft = parsedResult.trip;
    const confirmed = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "开始吧",
      draft,
      readiness_token: parsedResult.readiness_token,
    }, "user-parent");

    expect(confirmed.status).toBe(200);
    expect(llm.calls.map((call) => call.options.sessionId)).toEqual([
      "user:user-parent",
      "user:user-parent",
    ]);
    expect(llm.calls.every((call) => call.options.systemPrompt.length < 500)).toBeTrue();
    expect(llm.calls.every((call) => call.options.thinkingEnabled === true)).toBeTrue();
    expect(llm.calls[0]?.prompt).toContain("首次对话先亲切承接");
    expect(llm.calls[0]?.prompt).toContain('输出必须以 {"reply":" 开始');
    expect(llm.calls[1]?.prompt).toContain("连续低意愿时停止重复确认");
    expect(llm.calls[1]?.prompt).toContain('输出必须以 {"message":" 开始');
    expect(parent.scopes).toEqual([]);
  });
});
