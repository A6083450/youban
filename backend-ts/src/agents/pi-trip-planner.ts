import {
  allocateSegmentCandidates,
  buildBudget,
  buildSegments,
  buildWeatherInfo,
  duplicateAttractionIssues,
  mergeSegmentDays,
  normalizeCheckpoint,
  type DayPlan,
  type PlanningCheckpoint,
  type Segment,
  type TripPlanningRequest,
} from "../domain/orchestrator.ts";
import type { TrustedPoi, WeatherForecast } from "../services/amap-research-sources.ts";
import { adjustGeneratedDaysToBudget } from "../domain/budget-guard.ts";
import { recommendVisitTimes } from "../domain/itinerary-scheduler.ts";
import type { PlannerRunContext, TripPlanner } from "./trip-planner.ts";

export interface TripResearchSources {
  searchAttractions(city: string, preferences: string[]): Promise<TrustedPoi[]>;
  searchHotels(city: string, accommodation: string): Promise<TrustedPoi[]>;
  getWeather(city: string): Promise<Array<WeatherForecast | Record<string, unknown>>>;
}

export interface StructuredAgentRequest {
  agent: "destination-researcher" | "segment-planner" | "summary" | "itinerary-reviewer" | "plan-editor";
  nodeId: string;
  input: unknown;
  schema: Record<string, unknown>;
  signal: AbortSignal;
}

export interface StructuredAgentRunner {
  run(request: StructuredAgentRequest): Promise<unknown>;
  close?(): void | Promise<void>;
}

interface PiTripPlannerOptions {
  research: TripResearchSources;
  agents: StructuredAgentRunner;
  segmentDays?: number;
  segmentConcurrency?: number;
  reviewEnabled?: boolean;
  duplicateRepairRounds?: number;
}

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    selected_poi_ids: { type: "array", items: { type: "string" } },
  },
  required: ["selected_poi_ids"],
  additionalProperties: false,
};

const SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          day_index: { type: "integer" },
          city: { type: "string" },
          description: { type: "string" },
          transportation: { type: "string" },
          accommodation: { type: "string" },
          hotel: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  name: { type: "string" },
                  poi_id: { type: "string" },
                  estimated_cost: { type: "number" },
                },
                required: ["name"],
                additionalProperties: true,
              },
            ],
          },
          attractions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                poi_id: { type: "string" },
                ticket_price: { type: "number" },
              },
              required: ["name", "poi_id"],
              additionalProperties: true,
            },
          },
          meals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                name: { type: "string" },
                estimated_cost: { type: "number" },
              },
              required: ["type", "name"],
              additionalProperties: true,
            },
          },
        },
        required: [
          "date",
          "day_index",
          "city",
          "description",
          "transportation",
          "accommodation",
          "attractions",
          "meals",
        ],
        additionalProperties: true,
      },
    },
  },
  required: ["days"],
  additionalProperties: false,
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { overall_suggestions: { type: "string" } },
  required: ["overall_suggestions"],
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: "object",
  properties: { issues: { type: "array", items: { type: "string" } } },
  required: ["issues"],
  additionalProperties: false,
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("旅行规划已取消");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fallbackSummary(request: TripPlanningRequest): string {
  const cities = request.cities.map((stay) => stay.city).filter(Boolean).join("、") || request.city;
  return `${cities}行程已按日期生成，请结合天气、预约规则和现场开放情况灵活调整。`;
}

async function mapConcurrent<T>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const count = Math.min(Math.max(1, Math.floor(concurrency)), values.length);
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      await worker(values[index]!);
    }
  }));
}

type AsyncLimiter = <T>(run: () => Promise<T>) => Promise<T>;

function createLimiter(concurrency: number): AsyncLimiter {
  const limit = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => new Promise<void>((resolve) => {
    if (active < limit) {
      active += 1;
      resolve();
      return;
    }
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });
  return async <T>(run: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await run();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function cloneCheckpoint(checkpoint: PlanningCheckpoint): PlanningCheckpoint {
  return structuredClone(checkpoint);
}

function validateResearchSelection(raw: unknown, candidates: TrustedPoi[]): TrustedPoi[] {
  if (!record(raw) || !Array.isArray(raw.selected_poi_ids)) throw new Error("景点研究子 Agent 输出无效");
  const trusted = new Map(candidates.map((candidate) => [candidate.poi_id, candidate]));
  const selected: TrustedPoi[] = [];
  const seen = new Set<string>();
  for (const value of raw.selected_poi_ids) {
    const poiId = String(value ?? "").trim();
    const candidate = trusted.get(poiId);
    if (!candidate) throw new Error(`景点研究结果未通过高德候选池验证: ${poiId}`);
    if (!seen.has(poiId)) selected.push(structuredClone(candidate));
    seen.add(poiId);
  }
  return selected;
}

function validateSegmentOutput(raw: unknown, segment: Segment, trustedIds: Set<string>): DayPlan[] {
  if (!record(raw) || !Array.isArray(raw.days)) throw new Error("分段子 Agent 输出无效");
  const days = raw.days as unknown[];
  if (days.length !== segment.day_indices.length) throw new Error("分段天数与 day_indices 不符");
  return days.map((value, offset): DayPlan => {
    if (!record(value)
      || !Array.isArray(value.attractions)
      || !Array.isArray(value.meals)
      || value.day_index !== segment.day_indices[offset]
      || String(value.city ?? "") !== segment.city) {
      throw new Error("分段输出的日期索引或城市无效");
    }
    for (const attraction of value.attractions) {
      if (!record(attraction) || !trustedIds.has(String(attraction.poi_id ?? "").trim())) {
        throw new Error(`景点未通过高德候选池验证: ${record(attraction) ? String(attraction.poi_id ?? "") : ""}`);
      }
    }
    return structuredClone(value) as unknown as DayPlan;
  });
}

export class PiTripPlanner implements TripPlanner {
  private readonly segmentDays: number;
  private readonly segmentConcurrency: number;
  private readonly reviewEnabled: boolean;
  private readonly duplicateRepairRounds: number;

  constructor(private readonly options: PiTripPlannerOptions) {
    this.segmentDays = options.segmentDays ?? 5;
    this.segmentConcurrency = options.segmentConcurrency ?? 8;
    this.reviewEnabled = options.reviewEnabled ?? true;
    this.duplicateRepairRounds = options.duplicateRepairRounds ?? 2;
  }

  async plan(request: TripPlanningRequest, context: PlannerRunContext): Promise<Record<string, unknown>> {
    const checkpoint = normalizeCheckpoint(context.checkpoint);
    const ownerRunId = crypto.randomUUID();
    const cities = [...new Set(request.cities.map((stay) => stay.city.trim()).filter(Boolean))];
    const baseSegments = buildSegments(request, this.segmentDays);
    const segmentLimiter = createLimiter(this.segmentConcurrency);
    const plannedSegments = new Map<string, Segment>();
    ensureActive(context.signal);
    await context.onProgress({ stage: "initializing", progress: 8, message: "正在初始化旅行规划" });

    const save = () => context.onCheckpoint(cloneCheckpoint(checkpoint));
    await mapConcurrent(cities, 6, async (city) => {
      const researchJobs = (["attractions", "weather", "hotels"] as const)
        .filter((kind) => !Object.hasOwn(checkpoint.search[kind], city));
      await Promise.all(researchJobs.map(async (kind) => {
        ensureActive(context.signal);
        if (kind === "attractions") {
          await context.onProgress({ stage: "attraction_search", progress: 15, message: `正在研究${city}景点` });
          const candidates = await this.options.research.searchAttractions(city, request.preferences);
          const selected = await this.options.agents.run({
            agent: "destination-researcher",
            nodeId: `${ownerRunId}:research:${city}`,
            input: { city, preferences: request.preferences, candidates },
            schema: RESEARCH_SCHEMA,
            signal: context.signal,
          });
          checkpoint.search.attractions[city] = validateResearchSelection(selected, candidates);
        } else if (kind === "weather") {
          await context.onProgress({ stage: "weather_search", progress: 24, message: `正在查询${city}天气` });
          checkpoint.search.weather[city] = await this.options.research.getWeather(city);
        } else {
          await context.onProgress({ stage: "hotel_search", progress: 32, message: `正在查询${city}酒店` });
          checkpoint.search.hotels[city] = await this.options.research.searchHotels(city, request.accommodation);
        }
        await save();
      }));
      const citySegments = allocateSegmentCandidates(
        baseSegments.filter((segment) => segment.city === city),
        checkpoint.search.attractions,
      );
      for (const segment of citySegments) {
        plannedSegments.set(segment.segment_id, segment);
        if (!checkpoint.segments[segment.segment_id]) {
          checkpoint.segments[segment.segment_id] = {
            day_indices: [...segment.day_indices],
            status: "pending",
            output: [],
            attempts: 0,
            error: "",
          };
        }
      }
      await save();
      await this.planSegments(
        request,
        citySegments,
        checkpoint,
        context,
        ownerRunId,
        save,
        {},
        segmentLimiter,
      );
    });

    let segments = baseSegments.map((segment) => plannedSegments.get(segment.segment_id) ?? segment);

    let days = mergeSegmentDays(request, segments, checkpoint);
    for (let round = 0; round < this.duplicateRepairRounds; round += 1) {
      const issues = duplicateAttractionIssues(days, segments);
      if (Object.keys(issues).length === 0) break;
      for (const segmentId of Object.keys(issues)) checkpoint.segments[segmentId]!.status = "pending";
      await this.planSegments(
        request,
        segments,
        checkpoint,
        context,
        `${ownerRunId}:repair:${round}`,
        save,
        issues,
        segmentLimiter,
      );
      days = mergeSegmentDays(request, segments, checkpoint);
    }
    const unresolved = duplicateAttractionIssues(days, segments);
    if (Object.keys(unresolved).length > 0) throw new Error("跨分段景点重复修复失败");

    await context.onProgress({ stage: "reviewing", progress: 88, message: "正在汇总并审查行程" });
    const jobs: Promise<void>[] = [];
    if (checkpoint.summary.status !== "completed") {
      jobs.push(this.options.agents.run({
        agent: "summary",
        nodeId: `${ownerRunId}:summary`,
        input: { request, days },
        schema: SUMMARY_SCHEMA,
        signal: context.signal,
      }).then(async (output) => {
        if (!record(output) || typeof output.overall_suggestions !== "string") throw new Error("摘要子 Agent 输出无效");
        checkpoint.summary = { status: "completed", output: structuredClone(output), error: "" };
        await save();
      }).catch(async (error) => {
        checkpoint.summary = {
          status: "failed",
          output: { overall_suggestions: fallbackSummary(request) },
          error: errorMessage(error),
        };
        await save();
      }));
    }
    if (this.reviewEnabled && checkpoint.review.status !== "completed") {
      jobs.push(this.options.agents.run({
        agent: "itinerary-reviewer",
        nodeId: `${ownerRunId}:review`,
        input: { request, days },
        schema: REVIEW_SCHEMA,
        signal: context.signal,
      }).then(async (output) => {
        if (!record(output) || !Array.isArray(output.issues)) throw new Error("审查子 Agent 输出无效");
        checkpoint.review = { status: "completed", output: structuredClone(output), error: "" };
        await save();
      }).catch(async (error) => {
        checkpoint.review = { status: "failed", output: { issues: [] }, error: errorMessage(error) };
        await save();
      }));
    }
    await Promise.all(jobs);
    ensureActive(context.signal);

    const summary = record(checkpoint.summary.output) ? checkpoint.summary.output : {};
    const weatherInfo = buildWeatherInfo(request, checkpoint.search.weather);
    const adjusted = adjustGeneratedDaysToBudget(request, days);
    days = recommendVisitTimes(adjusted.days, weatherInfo);
    return {
      success: true,
      data: {
        ...request,
        days,
        weather_info: weatherInfo,
        budget: buildBudget(days, request.traveler_count, request.room_count),
        budget_adjustment_applied: adjusted.budget_adjustment_applied,
        budget_adjustment_note: adjusted.budget_adjustment_note,
        overall_suggestions: String(summary.overall_suggestions ?? ""),
      },
      review: checkpoint.review.output,
    };
  }

  private async planSegments(
    request: TripPlanningRequest,
    segments: Segment[],
    checkpoint: PlanningCheckpoint,
    context: PlannerRunContext,
    ownerRunId: string,
    save: () => void | Promise<void>,
    repairIssues: Record<string, string[]> = {},
    limiter: AsyncLimiter = createLimiter(this.segmentConcurrency),
  ): Promise<void> {
    const pending = segments.filter((segment) => checkpoint.segments[segment.segment_id]?.status !== "completed");
    await context.onProgress({ stage: "planning", progress: 45, message: "正在并行生成分段行程" });
    await Promise.all(pending.map((segment) => limiter(async () => {
      ensureActive(context.signal);
      const state = checkpoint.segments[segment.segment_id]!;
      state.status = "processing";
      state.attempts += 1;
      state.error = "";
      await save();
      const candidates = Array.isArray(checkpoint.search.attractions[segment.city])
        ? checkpoint.search.attractions[segment.city] as TrustedPoi[]
        : [];
      const allowed = new Set(segment.attraction_candidate_ids ?? []);
      const attractions = candidates.filter((candidate) => allowed.has(candidate.poi_id));
      const hotels = Array.isArray(checkpoint.search.hotels[segment.city])
        ? checkpoint.search.hotels[segment.city]
        : [];
      try {
        const output = await this.options.agents.run({
          agent: "segment-planner",
          nodeId: `${ownerRunId}:${segment.segment_id}:${state.attempts}`,
          input: {
            request,
            segment,
            attractions,
            hotels,
            weather: checkpoint.search.weather[segment.city] ?? [],
            repair_issues: repairIssues[segment.segment_id] ?? [],
          },
          schema: SEGMENT_SCHEMA,
          signal: context.signal,
        });
        state.output = validateSegmentOutput(output, segment, allowed);
        state.status = "completed";
      } catch (error) {
        state.status = "failed";
        state.error = error instanceof Error ? error.message : String(error);
        await save();
        throw error;
      }
      await save();
    })));
  }

  close(): void | Promise<void> {
    return this.options.agents.close?.();
  }
}
