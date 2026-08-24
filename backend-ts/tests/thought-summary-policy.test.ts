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
      "tool_call: search_places",
      '{"tool":"search_places","arguments":{"city":"大理"}}',
      "provider reasoning event",
      "系统提示：请输出工具调用与内部推理",
      '{\n  "type": "response.reasoning.delta"\n}',
      null,
      { title: "看起来安全" },
    ]) {
      expect(visibleThoughtSummary(unsafe, true)).toBeNull();
    }
  });
});
