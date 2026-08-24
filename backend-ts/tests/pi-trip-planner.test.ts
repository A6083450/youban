import { describe, expect, it } from "bun:test";
import type { PlannerRunContext } from "../src/agents/trip-planner.ts";
import {
  PiTripPlanner,
  type StructuredAgentRequest,
  type StructuredAgentRunner,
  type TripResearchSources,
} from "../src/agents/pi-trip-planner.ts";
import { emptyCheckpoint, type TripPlanningRequest } from "../src/domain/orchestrator.ts";

const REQUEST: TripPlanningRequest = {
  city: "大理",
  cities: [{ city: "大理", days: 4 }],
  start_date: "2026-10-01",
  end_date: "2026-10-04",
  travel_days: 4,
  transportation: "公共交通",
  accommodation: "舒适型酒店",
  traveler_count: 2,
  room_count: 1,
  preferences: ["自然风光"],
};

const POIS = ["P1", "P2", "P3", "P4"].map((poiId, index) => ({
  poi_id: poiId,
  name: `景点${index + 1}`,
  address: `地址${index + 1}`,
  type: "风景名胜",
  location: { longitude: 100 + index, latitude: 25 + index },
}));

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

class FakeResearch implements TripResearchSources {
  calls: string[] = [];
  async searchAttractions(city: string) {
    this.calls.push(`attractions:${city}`);
    return structuredClone(POIS);
  }
  async searchHotels(city: string) {
    this.calls.push(`hotels:${city}`);
    return [{ ...POIS[0]!, poi_id: "H1", name: "湖景酒店", rating: 4.7 }];
  }
  async getWeather(city: string) {
    this.calls.push(`weather:${city}`);
    return [{ city, date: "2026-10-01", day_weather: "晴" }];
  }
}

class FakeAgents implements StructuredAgentRunner {
  requests: StructuredAgentRequest[] = [];
  active = 0;
  maxActive = 0;
  hallucinate = false;
  hallucinateResearch = false;
  misalignSegmentMetadata = false;
  mealCost: number | null = null;
  failSummary = false;
  failReview = false;
  finalizationDelayMs = 0;
  omitLastSegmentDay = false;

  async run(request: StructuredAgentRequest): Promise<unknown> {
    this.requests.push({
      ...request,
      input: structuredClone(request.input),
      schema: structuredClone(request.schema),
    });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const isFinalization = request.agent === "summary" || request.agent === "itinerary-reviewer";
      await sleepWithSignal(5 + (isFinalization ? this.finalizationDelayMs : 0), request.signal);
      const input = request.input as Record<string, any>;
      if (request.agent === "destination-researcher") {
        return { selected_poi_ids: this.hallucinateResearch ? ["FAKE"] : POIS.map((poi) => poi.poi_id) };
      }
      if (request.agent === "segment-planner") {
        const segment = input.segment as Record<string, any>;
        const candidates = input.attractions as Array<Record<string, any>>;
        const days = segment.day_indices.map((dayIndex: number, offset: number) => ({
            date: this.misalignSegmentMetadata
              ? "2027-01-01"
              : new Date(Date.UTC(2026, 9, dayIndex + 1)).toISOString().slice(0, 10),
            day_index: this.misalignSegmentMetadata ? dayIndex + 99 : dayIndex,
            city: this.misalignSegmentMetadata ? "错误城市" : segment.city,
            description: `第${dayIndex + 1}天`,
            transportation: "公共交通",
            accommodation: "湖景酒店",
            hotel: null,
            attractions: [{
              name: this.hallucinate ? "虚构景点" : candidates[offset]?.name ?? candidates[0]?.name,
              poi_id: this.hallucinate ? "FAKE" : candidates[offset]?.poi_id ?? candidates[0]?.poi_id,
            }],
            meals: this.mealCost === null ? [] : [{
              type: "lunch",
              name: "午餐",
              estimated_cost: this.mealCost,
            }],
          }));
        return { days: this.omitLastSegmentDay ? days.slice(0, -1) : days };
      }
      if (request.agent === "summary") {
        if (this.failSummary) throw new Error("summary unavailable");
        return { overall_suggestions: "按天气灵活调整" };
      }
      if (request.agent === "itinerary-reviewer") {
        if (this.failReview) throw new Error("review unavailable");
        return { issues: [] };
      }
      throw new Error(`unexpected agent ${request.agent}`);
    } finally {
      this.active -= 1;
    }
  }
}

function context(checkpoint = emptyCheckpoint()) {
  const snapshots: unknown[] = [];
  const progress: unknown[] = [];
  const value: PlannerRunContext = {
    checkpoint,
    signal: new AbortController().signal,
    onCheckpoint(next) {
      JSON.stringify(next);
      snapshots.push(structuredClone(next));
    },
    onProgress(next) {
      progress.push(structuredClone(next));
    },
  };
  return { value, snapshots, progress };
}

describe("PiTripPlanner", () => {
  it("emits only deterministic stage summaries when thought visibility is enabled", async () => {
    const planner = new PiTripPlanner({
      research: new FakeResearch(),
      agents: new FakeAgents(),
      showThoughts: true,
    });
    const run = context();

    await planner.plan(REQUEST, run.value);

    const details = run.progress.flatMap((update) => (
      (update as { details?: Array<{ type: string; title: string }> }).details ?? []
    ));
    expect(details).toContainEqual(expect.objectContaining({
      type: "thinking",
      title: "正在为大理筛选符合偏好的可信景点",
    }));
    expect(details.every((detail) => detail.type === "thinking" && detail.title.length <= 160)).toBeTrue();
    expect(JSON.stringify(details)).not.toContain("selected_poi_ids");
    expect(JSON.stringify(details)).not.toContain("overall_suggestions");
    expect((run.progress.at(-1) as { details: Array<{ title: string }> }).details.map((detail) => detail.title))
      .toEqual(expect.arrayContaining([
        "正在为大理筛选符合偏好的可信景点",
        "正在平衡各天景点节奏与交通衔接",
        "正在校验行程完整性与预算节奏",
      ]));
  });

  it("omits every thought detail when thought visibility is disabled", async () => {
    const planner = new PiTripPlanner({
      research: new FakeResearch(),
      agents: new FakeAgents(),
      showThoughts: false,
    });
    const run = context();

    await planner.plan(REQUEST, run.value);

    expect(run.progress.every((update) => (
      !(update as { details?: unknown[] }).details?.some((detail) => (
        (detail as { type?: string }).type === "thinking"
      ))
    ))).toBeTrue();
  });

  it("prefetches trusted facts, runs bounded segment children, and checkpoints every wave", async () => {
    const research = new FakeResearch();
    const agents = new FakeAgents();
    const planner = new PiTripPlanner({
      research,
      agents,
      segmentDays: 3,
      segmentConcurrency: 8,
      reviewEnabled: true,
      duplicateRepairRounds: 1,
    });
    const run = context();
    const result = await planner.plan(REQUEST, run.value);

    expect(research.calls.sort()).toEqual([
      "attractions:大理",
      "hotels:大理",
      "weather:大理",
    ]);
    const expectedAgents: StructuredAgentRequest["agent"][] = [
      "destination-researcher",
      "itinerary-reviewer",
      "segment-planner",
      "segment-planner",
      "summary",
    ];
    expect(agents.requests.map((request) => request.agent).sort()).toEqual(expectedAgents.sort());
    const summaryRequest = agents.requests.find((request) => request.agent === "summary")!;
    const reviewRequest = agents.requests.find((request) => request.agent === "itinerary-reviewer")!;
    expect((summaryRequest.schema as any).properties.overall_suggestions.maxLength).toBe(800);
    expect((reviewRequest.schema as any).properties.issues).toEqual(expect.objectContaining({
      maxItems: 6,
      items: expect.objectContaining({ maxLength: 240 }),
    }));
    expect((summaryRequest.input as any).days[0].attractions[0]).toEqual({ name: "景点1", poi_id: "P1" });
    expect((summaryRequest.input as any).days[0].attractions[0].location).toBeUndefined();
    expect(agents.maxActive).toBeGreaterThanOrEqual(2);
    expect(run.snapshots.length).toBeGreaterThanOrEqual(7);
    expect(run.progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "attraction_search" }),
      expect.objectContaining({ stage: "planning" }),
      expect.objectContaining({ stage: "reviewing" }),
    ]));
    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        city: "大理",
        days: expect.any(Array),
        weather_info: [expect.objectContaining({ day_weather: "晴" })],
        budget: expect.objectContaining({ total: 0 }),
        overall_suggestions: "按天气灵活调整",
      }),
    }));
    expect((result.data as Record<string, any>).days).toHaveLength(4);
  });

  it("reuses a completed checkpoint without repeating research or child work", async () => {
    const research = new FakeResearch();
    const agents = new FakeAgents();
    const planner = new PiTripPlanner({ research, agents, reviewEnabled: true });
    let saved = emptyCheckpoint();
    await planner.plan(REQUEST, {
      ...context().value,
      onCheckpoint(next) { saved = structuredClone(next); },
    });
    research.calls = [];
    agents.requests = [];
    await planner.plan(REQUEST, context(saved).value);
    expect(research.calls).toEqual([]);
    expect(agents.requests).toEqual([]);
  });

  it("replaces untrusted segment attractions with unique server-assigned candidates", async () => {
    const agents = new FakeAgents();
    agents.hallucinate = true;
    const planner = new PiTripPlanner({ research: new FakeResearch(), agents });
    const result = await planner.plan(REQUEST, context().value);
    const attractions = ((result.data as Record<string, any>).days as Array<Record<string, any>>)
      .flatMap((day) => day.attractions);

    expect(attractions).toHaveLength(4);
    expect(attractions.map((item) => item.poi_id).sort()).toEqual(POIS.map((poi) => poi.poi_id).sort());
    expect(attractions.every((item) => item.name.startsWith("景点"))).toBeTrue();
  });

  it("falls back to ranked trusted candidates when the research child selects only unknown ids", async () => {
    const agents = new FakeAgents();
    agents.hallucinateResearch = true;
    const planner = new PiTripPlanner({ research: new FakeResearch(), agents });
    const result = await planner.plan(REQUEST, context().value);
    const days = (result.data as Record<string, any>).days as Array<Record<string, any>>;

    expect(days).toHaveLength(4);
    expect(days.flatMap((day) => day.attractions).every((item) =>
      POIS.some((poi) => poi.poi_id === item.poi_id))).toBeTrue();
  });

  it("overrides model-provided dates, indices, and cities with deterministic segment metadata", async () => {
    const agents = new FakeAgents();
    agents.misalignSegmentMetadata = true;
    const planner = new PiTripPlanner({ research: new FakeResearch(), agents });
    const result = await planner.plan(REQUEST, context().value);
    const days = (result.data as Record<string, any>).days as Array<Record<string, any>>;

    expect(days.map(({ date, day_index, city }) => ({ date, day_index, city }))).toEqual([
      { date: "2026-10-01", day_index: 0, city: "大理" },
      { date: "2026-10-02", day_index: 1, city: "大理" },
      { date: "2026-10-03", day_index: 2, city: "大理" },
      { date: "2026-10-04", day_index: 3, city: "大理" },
    ]);
  });

  it("fills a missing model day from deterministic segment metadata", async () => {
    const agents = new FakeAgents();
    agents.omitLastSegmentDay = true;
    const planner = new PiTripPlanner({ research: new FakeResearch(), agents });
    const result = await planner.plan(REQUEST, context().value);
    const days = (result.data as Record<string, any>).days as Array<Record<string, any>>;

    expect(days).toHaveLength(4);
    expect(days.map((day) => day.day_index)).toEqual([0, 1, 2, 3]);
    expect(days[3]).toEqual(expect.objectContaining({
      date: "2026-10-04",
      city: "大理",
      transportation: "待确认",
      accommodation: "待确认",
      meals: [],
    }));
    const segmentRequest = agents.requests.find((request) => request.agent === "segment-planner")!;
    expect((segmentRequest.schema as any).properties.days).toEqual(expect.objectContaining({
      minItems: 4,
      maxItems: 4,
    }));
  });

  it("keeps a segment usable without inventing POIs when research has no trusted candidates", async () => {
    class EmptyResearch extends FakeResearch {
      override async searchAttractions(city: string) {
        this.calls.push(`attractions:${city}`);
        return [];
      }
    }
    class PlaceholderAgents extends FakeAgents {
      override async run(request: StructuredAgentRequest): Promise<unknown> {
        if (request.agent === "destination-researcher") return { selected_poi_ids: [] };
        if (request.agent !== "segment-planner") return super.run(request);
        const segment = (request.input as Record<string, any>).segment as Record<string, any>;
        return {
          days: segment.day_indices.map((dayIndex: number) => ({
            date: new Date(Date.UTC(2026, 9, dayIndex + 1)).toISOString().slice(0, 10),
            day_index: dayIndex,
            city: segment.city,
            description: "候选信息不足，保留自由活动",
            transportation: "待确认",
            accommodation: "待确认",
            hotel: null,
            attractions: [{ name: "待确认", poi_id: "unknown" }],
            meals: [],
          })),
        };
      }
    }
    const planner = new PiTripPlanner({ research: new EmptyResearch(), agents: new PlaceholderAgents() });
    const result = await planner.plan(REQUEST, context().value);
    const days = (result.data as Record<string, any>).days as Array<Record<string, any>>;

    expect(days).toHaveLength(4);
    expect(days.every((day) => Array.isArray(day.attractions) && day.attractions.length === 0)).toBeTrue();
  });

  it("applies deterministic scheduling and budget guardrails to the final plan", async () => {
    const agents = new FakeAgents();
    agents.mealCost = 100;
    const planner = new PiTripPlanner({ research: new FakeResearch(), agents });
    const result = await planner.plan({ ...REQUEST, budget_amount: 700 }, context().value);
    const data = result.data as Record<string, any>;

    expect(data.days[0].attractions[0]).toEqual(expect.objectContaining({
      start_time: "09:00",
      time_recommendation_basis: "weather",
      crowd_recommendation_basis: "heuristic",
    }));
    expect(data.days[0].meals[0]).toEqual(expect.objectContaining({
      time: "12:30",
      time_recommendation_basis: "schedule",
    }));
    expect(data.budget_adjustment_applied).toBeTrue();
    expect(data.budget_adjustment_note).toContain("待报价项目预留");
  });

  it("returns a complete plan with deterministic summary when summary child fails", async () => {
    const agents = new FakeAgents();
    agents.failSummary = true;
    const run = context();
    const result = await new PiTripPlanner({ research: new FakeResearch(), agents }).plan(REQUEST, run.value);
    expect((result.data as Record<string, any>).overall_suggestions).toContain("行程已按日期生成");
    expect((run.snapshots.at(-1) as Record<string, any>).summary).toEqual(expect.objectContaining({
      status: "failed",
      error: "summary unavailable",
    }));
  });

  it("returns a complete plan with an empty review when review child fails", async () => {
    const agents = new FakeAgents();
    agents.failReview = true;
    const run = context();
    const result = await new PiTripPlanner({ research: new FakeResearch(), agents }).plan(REQUEST, run.value);
    expect(result.review).toEqual({ issues: [] });
    expect((run.snapshots.at(-1) as Record<string, any>).review).toEqual(expect.objectContaining({
      status: "failed",
      error: "review unavailable",
    }));
  });

  it("bounds slow summary and review work and falls back without losing the plan", async () => {
    const agents = new FakeAgents();
    agents.finalizationDelayMs = 100;
    const run = context();
    const startedAt = performance.now();
    const result = await new PiTripPlanner({
      research: new FakeResearch(),
      agents,
      finalizationTimeoutMs: 15,
    } as any).plan(REQUEST, run.value);

    expect(performance.now() - startedAt).toBeLessThan(80);
    expect((result.data as Record<string, any>).overall_suggestions).toContain("行程已按日期生成");
    expect(result.review).toEqual({ issues: [] });
    const checkpoint = run.snapshots.at(-1) as Record<string, any>;
    expect(checkpoint.summary.status).toBe("failed");
    expect(checkpoint.review.status).toBe("failed");
  });

  it("starts a ready city's segments before slower city research finishes", async () => {
    const events: string[] = [];
    class TimedResearch extends FakeResearch {
      private async complete(kind: string, city: string, value: any) {
        await Bun.sleep(city === "丽江" ? 80 : 2);
        events.push(`${kind}:${city}:done`);
        return value;
      }
      override async searchAttractions(city: string) {
        this.calls.push(`attractions:${city}`);
        return this.complete("attractions", city, structuredClone(POIS));
      }
      override async searchHotels(city: string) {
        this.calls.push(`hotels:${city}`);
        return this.complete("hotels", city, [{ ...POIS[0]!, poi_id: "H1", name: "测试酒店" }]);
      }
      override async getWeather(city: string) {
        this.calls.push(`weather:${city}`);
        return this.complete("weather", city, [{ city, date: "2026-10-01", day_weather: "晴" }]);
      }
    }
    class TimedAgents extends FakeAgents {
      activeSegments = 0;
      maxActiveSegments = 0;
      override async run(request: StructuredAgentRequest) {
        if (request.agent !== "segment-planner") return super.run(request);
        const city = String((request.input as Record<string, any>).segment.city);
        events.push(`segment:${city}:start`);
        this.activeSegments += 1;
        this.maxActiveSegments = Math.max(this.maxActiveSegments, this.activeSegments);
        try {
          return await super.run(request);
        } finally {
          this.activeSegments -= 1;
        }
      }
    }
    const agents = new TimedAgents();
    const planner = new PiTripPlanner({
      research: new TimedResearch(),
      agents,
      segmentDays: 2,
      segmentConcurrency: 1,
    });
    await planner.plan({
      ...REQUEST,
      city: "大理",
      cities: [{ city: "大理", days: 2 }, { city: "丽江", days: 2 }],
    }, context().value);
    expect(events.indexOf("segment:大理:start")).toBeLessThan(events.indexOf("weather:丽江:done"));
    expect(agents.maxActiveSegments).toBe(1);
  });
});
