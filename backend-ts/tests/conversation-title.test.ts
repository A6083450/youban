import { describe, expect, it } from "bun:test";
import type { PiAgentCallOptions, PiAgentLlmClient } from "../src/agents/llm/providers.ts";
import {
  ConversationTitleService,
  fallbackConversationTitle,
} from "../src/agents/conversation-title.ts";

class FakeTitleLlm implements Pick<PiAgentLlmClient, "agentComplete"> {
  readonly calls: Array<{ prompt: string; options: PiAgentCallOptions }> = [];

  constructor(private readonly complete: (prompt: string, options: PiAgentCallOptions) => Promise<string>) {}

  async agentComplete(prompt: string, options: PiAgentCallOptions): Promise<string> {
    this.calls.push({ prompt, options });
    return this.complete(prompt, options);
  }
}

function serviceFor(output: string): { service: ConversationTitleService; llm: FakeTitleLlm } {
  const llm = new FakeTitleLlm(async () => output);
  return { service: new ConversationTitleService(llm), llm };
}

describe("ConversationTitleService", () => {
  it("generates a valid Chinese intent title from only the normalized first message", async () => {
    const { service, llm } = serviceFor("规划一个月新疆深度游");

    await expect(service.infer("  国庆新疆玩一个月\n帮我计划下  "))
      .resolves.toEqual({ title: "规划一个月新疆深度游", status: "generated" });

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toEqual(expect.objectContaining({
      prompt: "国庆新疆玩一个月 帮我计划下",
      options: expect.objectContaining({
        temperature: 0.1,
        maxTokens: 32,
        thinkingEnabled: false,
        sessionId: expect.stringMatching(/^conversation-title:[a-f0-9]{16}$/),
      }),
    }));
  });

  it("accepts a valid English title with three to eight words", async () => {
    const { service } = serviceFor("Plan a month-long Xinjiang trip");

    await expect(service.infer("Plan a month in Xinjiang"))
      .resolves.toEqual({ title: "Plan a month-long Xinjiang trip", status: "generated" });
  });

  it("strips wrapping quotes and ending punctuation from a generated title", async () => {
    const { service } = serviceFor("  \"规划一个月新疆深度游。\"  ");

    await expect(service.infer("国庆新疆玩一个月帮我计划下"))
      .resolves.toEqual({ title: "规划一个月新疆深度游", status: "generated" });
  });

  it("falls back when the generated Chinese title exceeds eighteen characters", async () => {
    const { service } = serviceFor("规划国庆新疆南北疆一个月深度自由行旅行攻略路线");

    await expect(service.infer("国庆新疆玩一个月帮我计划下"))
      .resolves.toEqual({ title: "国庆新疆玩一个月帮我计划下", status: "fallback" });
  });

  it("rejects an empty first message before calling the provider", async () => {
    const { service, llm } = serviceFor("规划一个月新疆深度游");

    await expect(service.infer(" \n\t ")).rejects.toThrow("first message is required");
    expect(llm.calls).toHaveLength(0);
  });

  it("falls back to a deterministic title derived from the first message when the provider fails", async () => {
    const llm = new FakeTitleLlm(async () => { throw new Error("provider unavailable"); });
    const service = new ConversationTitleService(llm);

    await expect(service.infer("帮我安排青岛旅行")).resolves.toEqual({
      title: "帮我安排青岛旅行",
      status: "fallback",
    });
    expect(fallbackConversationTitle("帮我安排青岛旅行")).toBe("帮我安排青岛旅行");
    expect(fallbackConversationTitle("帮我安排青岛旅行")).not.toBe("新对话");
  });

  it("uses a five-second local deadline and returns the fallback when the provider does not finish", async () => {
    const llm = new FakeTitleLlm(async (_prompt, options) => new Promise<string>((_resolve, reject) => {
      if (options.signal?.aborted) return reject(options.signal.reason);
      options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    const service = new ConversationTitleService(llm);
    const startedAt = performance.now();

    await expect(service.infer("帮我安排青岛旅行")).resolves.toEqual({
      title: "帮我安排青岛旅行",
      status: "fallback",
    });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(4_500);
  }, 7_000);

  it("removes its caller abort listener after a successful completion", async () => {
    const controller = new AbortController();
    const originalAdd = controller.signal.addEventListener.bind(controller.signal);
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
    let added = 0;
    let removed = 0;
    const signal = {
      get aborted() { return controller.signal.aborted; },
      get reason() { return controller.signal.reason; },
      addEventListener(...args: Parameters<AbortSignal["addEventListener"]>) {
        added += 1;
        originalAdd(...args);
      },
      removeEventListener(...args: Parameters<AbortSignal["removeEventListener"]>) {
        removed += 1;
        originalRemove(...args);
      },
    } as AbortSignal;
    const { service } = serviceFor("规划一个月新疆深度游");

    await expect(service.infer("国庆新疆玩一个月帮我计划下", signal))
      .resolves.toEqual({ title: "规划一个月新疆深度游", status: "generated" });
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });
});
