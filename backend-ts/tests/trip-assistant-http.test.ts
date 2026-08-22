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
    expect(llm.prompts[0]).toContain("国庆帮我安排大理七天");
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
    const response = await post(runtime.app, "/api/trip/confirm-reply/stream", {
      text: "照这个执行",
      draft,
      language: "zh-CN",
      today: "2026-08-21",
      history: [],
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
    }));
  });

  it("routes parse and confirm through the same authenticated persistent parent scope", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "youban-parent-http-"));
    tempDirs.push(dataDir);
    const parent = new FakeParentAgent([
      JSON.stringify({
        action: "plan",
        emotion: "neutral",
        reply: "草稿已整理。",
        cities: [{ city: "北京", days: 1 }],
        start_date: "2026-10-01",
        ready_to_generate: true,
      }),
      JSON.stringify({ action: "confirm", confidence: 0.95, message: "开始生成。" }),
    ]);
    const llm = new FakeLlmClient([]);
    const assistant = new TripAssistant({
      llm,
      ledger: new ConfirmationLedger({ secret: Buffer.alloc(32, 7) }),
      parentAgent: parent,
    });
    const runtime = createHttpRuntime({ dataDir, assistant, parentAgent: parent });
    runtimes.push(runtime);

    const parsed = await post(runtime.app, "/api/trip/parse", { text: "去北京一天" }, "user-parent");
    const draft = (await parsed.json() as Record<string, any>).trip;
    const confirmed = await post(runtime.app, "/api/trip/confirm-reply", {
      text: "开始吧",
      draft,
    }, "user-parent");

    expect(confirmed.status).toBe(200);
    expect(parent.scopes.map((scope) => scope.key)).toEqual(["user:user-parent", "user:user-parent"]);
    expect(llm.prompts).toEqual([]);
  });
});
