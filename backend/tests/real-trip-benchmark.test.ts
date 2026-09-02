import { describe, expect, it } from "bun:test";
import {
  benchmarkOptionsFromArgv,
  benchmarkNickname,
  buildPlanPayload,
  formatHttpError,
  nearestRankPercentile,
  recordStageOffset,
  resolveTripDraft,
  summarizeBenchmark,
  validateApprovedInputDraft,
  validateTripQuality,
} from "../scripts/benchmark-real-trip.ts";

const draft = {
  city: "乌鲁木齐",
  cities: [
    { city: "乌鲁木齐", days: 2 },
    { city: "吐鲁番", days: 1 },
  ],
  start_date: "2026-10-01",
  end_date: "2026-10-03",
  travel_days: 3,
};

const planResult = {
  success: true,
  data: {
    days: [
      { day_index: 0, date: "2026-10-01", city: "乌鲁木齐" },
      { day_index: 1, date: "2026-10-02", city: "乌鲁木齐" },
      { day_index: 2, date: "2026-10-03", city: "吐鲁番" },
    ],
  },
};

describe("real trip benchmark", () => {
  it("keeps the approved input and ten-run acceptance defaults", () => {
    expect(benchmarkOptionsFromArgv([])).toEqual(expect.objectContaining({
      input: "国庆新疆玩一个月帮我计划下",
      runs: 10,
      generationTimeoutMs: 45_000,
      p50LimitMs: 30_000,
      p95LimitMs: 35_000,
    }));
  });

  it("keeps every benchmark login nickname within the API limit", () => {
    const first = benchmarkNickname(1, 1_787_466_268_071);
    const tenth = benchmarkNickname(10, 1_787_466_268_071);
    expect(first.length).toBeLessThanOrEqual(20);
    expect(tenth.length).toBeLessThanOrEqual(20);
    expect(tenth).not.toBe(first);
  });

  it("uses nearest-rank percentiles so ten-run p95 exposes the slowest run", () => {
    const values = [18_000, 19_000, 20_000, 21_000, 22_000, 23_000, 24_000, 25_000, 26_000, 41_000];
    expect(nearestRankPercentile(values, 0.5)).toBe(22_000);
    expect(nearestRankPercentile(values, 0.95)).toBe(41_000);
  });

  it("records only the first observed offset for each websocket stage", () => {
    const stages: Record<string, number> = {};
    recordStageOffset(stages, { stage: "planning" }, 8_200);
    recordStageOffset(stages, { stage: "planning" }, 9_900);
    recordStageOffset(stages, { stage: "reviewing" }, 21_500);
    recordStageOffset(stages, { status: "completed", stage: "completed" }, 25_100);
    expect(stages).toEqual({ planning: 8_200, reviewing: 21_500, completed: 25_100 });
  });

  it("summarizes validation errors without leaking the request body or execution token", () => {
    const detail = JSON.stringify({
      summary: "Expected string length greater or equal to 1",
      found: { transportation: "", execution_token: "secret-token" },
    });
    const message = formatHttpError("POST", "/api/trip/plan", 422, { detail });
    expect(message).toBe("POST /api/trip/plan -> 422: Expected string length greater or equal to 1");
    expect(message).not.toContain("secret-token");
  });

  it("keeps the approved input as the first turn and resolves one clarification with fixed assumptions", async () => {
    const turns: Array<{ text: string; history: Array<{ role: string; content: string }> }> = [];
    const responses = [
      { action: "clarify", reply: "请补充人数和路线", trip: null },
      { action: "plan", reply: "草稿已生成", trip: draft },
    ];
    const resolved = await resolveTripDraft(
      "国庆新疆玩一个月帮我计划下",
      "2026-08-23",
      async (text, history) => {
        turns.push({ text, history: structuredClone(history) });
        return responses.shift()!;
      },
    );

    expect(resolved).toEqual({ draft, clarification_turns: 1 });
    expect(turns).toEqual([
      { text: "国庆新疆玩一个月帮我计划下", history: [] },
      {
        text: "按合理默认值继续：2026年10月1日出发，10月30日返程，1人，预算暂不限制，南北疆都安排，公共交通结合当地包车，舒适型住宿。请直接给出可执行草稿，不再追问。",
        history: [
          { role: "user", content: "国庆新疆玩一个月帮我计划下" },
          { role: "assistant", content: "请补充人数和路线" },
        ],
      },
    ]);
  });

  it("preserves every confirmation-bound draft field when adding plan-only metadata", () => {
    expect(buildPlanPayload({
      ...draft,
      origin_text: "固定澄清答案",
      free_text_input: "固定澄清答案",
      inferred_fields: ["transportation"],
      suggestions: ["可调整住宿"],
    }, "signed-token", "国庆新疆玩一个月帮我计划下")).toEqual({
      ...draft,
      origin_text: "固定澄清答案",
      free_text_input: "固定澄清答案",
      language: "zh-CN",
      conversation: [{ role: "user", content: "国庆新疆玩一个月帮我计划下" }],
      execution_token: "signed-token",
    });
  });

  it("accepts a complete plan whose dates and cities match the parsed draft", () => {
    expect(validateTripQuality(draft, planResult, { totals: { total: 8_800 } })).toEqual([]);
  });

  it("rejects a one-month Xinjiang draft that is short or not split into concrete destinations", () => {
    expect(validateApprovedInputDraft({
      start_date: "2026-10-01",
      end_date: "2026-10-15",
      travel_days: 15,
      cities: [{ city: "新疆", days: 15 }],
    })).toEqual([
      "一个月行程必须为 30 天，实际为 15 天",
      "新疆行程必须拆分为至少两个具体目的地",
      "行程结束日期必须为 2026-10-30，实际为 2026-10-15",
    ]);
  });

  it("accepts a 30-day National Day trip that starts shortly before October", () => {
    expect(validateApprovedInputDraft({
      start_date: "2026-09-25",
      end_date: "2026-10-24",
      travel_days: 30,
      cities: [
        { city: "乌鲁木齐", days: 15 },
        { city: "喀什", days: 15 },
      ],
    })).toEqual([]);
  });

  it("reports missing days, non-contiguous dates, city drift, and invalid budget", () => {
    const brokenResult = structuredClone(planResult);
    brokenResult.data.days = [
      { day_index: 0, date: "2026-10-01", city: "乌鲁木齐" },
      { day_index: 2, date: "2026-10-04", city: "哈密" },
    ];
    expect(validateTripQuality(draft, brokenResult, { totals: { total: -1 } })).toEqual([
      "行程天数 2 与草稿 3 不一致",
      "第 2 天 day_index 应为 1，实际为 2",
      "第 2 天日期应为 2026-10-02，实际为 2026-10-04",
      "第 2 天城市应为 乌鲁木齐，实际为 哈密",
      "预算总额必须是非负有限数值",
    ]);
  });

  it("fails acceptance when quality or percentile limits are exceeded", () => {
    const samples = [
      ...Array.from({ length: 9 }, (_, index) => ({
        run: index + 1,
        success: true,
        generation_ms: 20_000 + index * 500,
        end_to_end_ms: 35_000 + index * 500,
        quality_errors: [] as string[],
      })),
      {
        run: 10,
        success: false,
        generation_ms: 41_000,
        end_to_end_ms: 55_000,
        quality_errors: ["行程天数不一致"],
        error: "行程天数不一致",
      },
    ];
    expect(summarizeBenchmark(samples, { p50LimitMs: 30_000, p95LimitMs: 35_000 })).toEqual({
      run_count: 10,
      successful_runs: 9,
      success_rate: 0.9,
      generation_ms: { p50: 22_000, p95: 41_000, max: 41_000 },
      end_to_end_ms: { p50: 37_000, p95: 55_000, max: 55_000 },
      thresholds: { p50_ms: 30_000, p95_ms: 35_000 },
      passed: false,
    });
  });
});
