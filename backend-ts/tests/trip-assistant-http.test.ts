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

  it("keeps an updated draft conversational while required details are still missing", async () => {
    const output = JSON.stringify({
      action: "update",
      confidence: 0.92,
      message: "三天记下了。你大概什么时候出发？",
      cities: [{ city: "北京", days: 3 }],
      traveler_count: 1,
      ready_to_generate: false,
      inferred_fields: ["dates", "transportation", "accommodation"],
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
      cities: [{ city: "北京", days: 3 }],
      start_date: "2026-10-01",
      transportation: "公共交通",
      accommodation: "舒适型酒店",
      traveler_count: 2,
      room_count: 1,
      preferences: ["历史文化"],
      ready_to_generate: true,
      inferred_fields: [],
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

  it("honors an explicit execution command even when the model asks for confirmation again", async () => {
    const draft = {
      city: "乌鲁木齐",
      cities: [{ city: "乌鲁木齐", days: 3 }],
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
    };
    const output = JSON.stringify({
      action: "ask_confirmation",
      confidence: 0.2,
      message: "还需要确认吗？",
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
    expect(result.confidence).toBe(1);
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
      [JSON.stringify({ action: "ask_confirmation", confidence: 0.2, message: "再确认一次？" })],
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

  it("accepts visible Chinese and English authorization commands for an attested draft", async () => {
    const draft = {
      city: "北京",
      cities: [{ city: "北京", days: 3 }],
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      travel_days: 3,
    };

    for (const [text, language] of [
      ["生成详细行程", "zh-CN"],
      ["Generate detailed itinerary", "en-US"],
      ["confirm", "en-US"],
    ] as const) {
      const output = JSON.stringify({
        action: "ask_confirmation",
        confidence: 0.2,
        message: "需要确认吗？",
      });
      const { runtime, ledger } = makeRuntime([[output]]);
      const readinessToken = ledger.attestReady({ ...draft, language });
      const response = await post(runtime.app, "/api/trip/confirm-reply", {
        text,
        draft,
        language,
        readiness_token: readinessToken,
      });
      const result = await response.json() as Record<string, any>;

      expect(result.action).toBe("confirm");
      expect(result.execution_token).not.toBe("");
      expect(ledger.validate(result.execution_token, { ...draft, language }).valid).toBeTrue();
    }
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
    expect(parent.scopes).toEqual([]);
  });
});
