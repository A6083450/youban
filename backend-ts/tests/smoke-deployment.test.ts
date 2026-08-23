import { describe, expect, it } from "bun:test";
import { resolveSmokeDraft } from "../scripts/smoke-deployment.ts";

describe("deployment smoke draft resolution", () => {
  it("answers one clarification with fixed executable Guangzhou details", async () => {
    const turns: Array<{ text: string; history: unknown[] }> = [];
    const draft = { cities: [{ city: "广州", days: 1 }], travel_days: 1 };
    const responses = [
      { action: "clarify", reply: "你喜欢什么？", trip: null },
      { action: "plan", trip: draft },
    ];

    const resolved = await resolveSmokeDraft(async (text, history) => {
      turns.push({ text, history: structuredClone(history) });
      return responses.shift()!;
    });

    expect(resolved).toEqual(draft);
    expect(turns).toEqual([
      { text: "明天去广州玩一天，1个人，公共交通，喜欢人文景点", history: [] },
      {
        text: "确认具体安排：明天去广州玩1天，1个人，公共交通，经济型酒店，喜欢人文景点。请直接生成可执行草稿，不再追问。",
        history: [
          { role: "user", content: "明天去广州玩一天，1个人，公共交通，喜欢人文景点" },
          { role: "assistant", content: "你喜欢什么？" },
        ],
      },
    ]);
  });
});
