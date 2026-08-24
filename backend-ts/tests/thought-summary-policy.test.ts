import { describe, expect, it } from "bun:test";
import { visibleThoughtSummary } from "../src/agents/thought-summary-policy.ts";

describe("visible thought summary policy", () => {
  it("returns only a short sanitized one-line summary when visibility is enabled", () => {
    expect(visibleThoughtSummary("正在平衡亲子节奏", false)).toBeNull();
    expect(visibleThoughtSummary("正在平衡亲子节奏", true)).toBe("正在平衡亲子节奏");
    expect(visibleThoughtSummary("**正在筛选**\u0000  可信景点", true)).toBe("正在筛选 可信景点");

    const long = visibleThoughtSummary("a".repeat(300), true);
    expect(long?.length).toBeLessThanOrEqual(160);
    expect(long).toBe("a".repeat(160));
  });

  it("rejects prompt, secret, tool, reasoning, and multiline protocol content", () => {
    for (const unsafe of [
      "system prompt: secret\nAPI_KEY=abc",
      "Authorization: Bearer private-token",
      "token=private-token",
      "access_token=private-value",
      "api-key=private-value",
      "reasoning_content: private chain",
      "authorization=Basic YWJj",
      "**access_token**=private-value",
      "to**ken=private-value",
      "tok\u0000en=private-value",
      "```text\nreasoning_content: private chain\n```",
      "provider-event: private-value",
      "function-call: private-value",
      "tool_call: search_places",
      '{"tool":"search_places","arguments":{"city":"大理"}}',
      "provider reasoning event",
      "系统提示：请输出工具调用与内部推理",
      '{\n  "type": "response.reasoning.delta"\n}',
      "status: connected\rdata: private-event",
      "status: connected\r\ndata: private-event",
      null,
      { title: "看起来安全" },
    ]) {
      expect(visibleThoughtSummary(unsafe, true)).toBeNull();
    }
  });

  it("keeps a legitimate Chinese stage summary after line and Markdown normalization", () => {
    expect(visibleThoughtSummary("**正在核对**\r\n行程节奏", true))
      .toBe("正在核对 行程节奏");
  });
});
