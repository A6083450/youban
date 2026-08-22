import { describe, expect, it } from "bun:test";
import {
  fixUnescapedQuotes,
  parseJsonObject,
  removeTrailingCommas,
  repairTruncatedJson,
  sanitizeJsonString,
} from "../src/agents/llm/plan-parser.ts";

describe("LLM JSON repair pipeline", () => {
  it("parses fenced JSON and preserves URLs", () => {
    expect(parseJsonObject('```json\n{"city":"北京","url":"https://example.com/a//b"}\n```')).toEqual({
      city: "北京",
      url: "https://example.com/a//b",
    });
  });

  it("removes comments, control bytes, trailing commas, and arithmetic expressions", () => {
    const cleaned = sanitizeJsonString(`{
      // comment
      "url": "https://example.com/a//b",
      "total": 30+54+120=204,
      "label": "好\u0001玩",
    }`);
    expect(JSON.parse(cleaned)).toEqual({
      url: "https://example.com/a//b",
      total: 204,
      label: "好玩",
    });
  });

  it("repairs unescaped quotes and truncated containers", () => {
    expect(fixUnescapedQuotes('{"d": "这是"好的"景点"}')).toBe('{"d": "这是\'好的\'景点"}');
    expect(JSON.parse(repairTruncatedJson('{"a": [{"b": "text'))).toEqual({ a: [{ b: "text" }] });
  });

  it("handles trailing commas only outside strings", () => {
    expect(removeTrailingCommas('{"a": "x,}", "b": 1,}')).toBe('{"a": "x,}", "b": 1}');
  });

  it("repairs unquoted keys, single quotes, and missing commas", () => {
    expect(parseJsonObject("result: {city: '成都' days: 3}" )).toEqual({ city: "成都", days: 3 });
  });

  it("rejects output without a JSON object", () => {
    expect(() => parseJsonObject("完全不是 JSON")).toThrow("响应中未找到JSON数据");
  });
});
