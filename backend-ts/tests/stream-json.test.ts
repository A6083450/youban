import { describe, expect, it } from "bun:test";
import { streamExtractStringField } from "../src/agents/llm/stream-json.ts";

describe("streamExtractStringField", () => {
  it("extracts complete and partial values", () => {
    expect(streamExtractStringField('{"reply":"你好世界"}', "reply")).toEqual({ value: "你好世界", closed: true });
    expect(streamExtractStringField('{"reply":"你好', "reply")).toEqual({ value: "你好", closed: false });
  });

  it("decodes complete escapes but withholds partial escapes", () => {
    expect(streamExtractStringField('{"reply":"他说\\"嗨\\"\\n\\u4f60\\u597d"}', "reply")).toEqual({
      value: '他说"嗨"\n你好',
      closed: true,
    });
    expect(streamExtractStringField('{"reply":"a\\', "reply")).toEqual({ value: "a", closed: false });
    expect(streamExtractStringField('{"reply":"a\\u4f6', "reply")).toEqual({ value: "a", closed: false });
  });

  it("is monotonic for every prefix of a streamed JSON response", () => {
    const full = '{"action":"chat","reply":"你好\\n世界\\"引用\\"结束","other":1}';
    let previous = "";
    for (let index = 1; index <= full.length; index += 1) {
      const current = streamExtractStringField(full.slice(0, index), "reply").value;
      expect(current.startsWith(previous)).toBe(true);
      previous = current;
    }
    expect(previous).toBe('你好\n世界"引用"结束');
  });

  it("returns empty while the field or opening quote has not arrived", () => {
    expect(streamExtractStringField('{"action":"chat"}', "reply")).toEqual({ value: "", closed: false });
    expect(streamExtractStringField('{"reply":  ', "reply")).toEqual({ value: "", closed: false });
  });
});
