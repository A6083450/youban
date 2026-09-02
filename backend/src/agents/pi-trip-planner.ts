import {
  allocateSegmentCandidates,
  buildBudget,
  buildSegments,
  buildWeatherInfo,
  duplicateAttractionIssues,
  mergeSegmentDays,
  normalizeCheckpoint,
  rebalanceSparseAttractionDays,
  type DayPlan,
  type PlanningCheckpoint,
  type Segment,
  type TripPlanningRequest,
} from "../domain/orchestrator.ts";
import type { TrustedPoi, WeatherForecast } from "../services/amap-research-sources.ts";
import { adjustGeneratedDaysToBudget } from "../domain/budget-guard.ts";
import { recommendVisitTimes } from "../domain/itinerary-scheduler.ts";
import { enrichHotelPrices } from "../services/hotel-price-enrichment.ts";
import type { HotelPriceSource } from "../services/hotel-price-source.ts";
import type { PlannerProgress, PlannerRunContext, TripPlanner } from "./trip-planner.ts";
import { visibleThoughtSummary } from "./thought-summary-policy.ts";

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
  finalizationTimeoutMs?: number;
  showThoughts?: boolean;
  hotelPrices?: HotelPriceSource;
}

function researchSchema(candidates: TrustedPoi[]) {
  return {
    type: "object",
    properties: {
      selected_poi_ids: {
        type: "array",
        items: { type: "string", enum: candidates.map((candidate) => candidate.poi_id) },
      },
    },
    required: ["selected_poi_ids"],
    additionalProperties: false,
  };
}

function segmentSchema(candidates: TrustedPoi[], hotelCandidates: TrustedPoi[], dayCount: number) {
  const poiIds = candidates.map((candidate) => candidate.poi_id);
  const hotelPoiIds = hotelCandidates.map((candidate) => candidate.poi_id);
  return {
    type: "object",
    properties: {
      days: {
        type: "array",
        minItems: dayCount,
        maxItems: dayCount,
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            day_index: { type: "integer" },
            city: { type: "string" },
            description: { type: "string" },
            transportation: { type: "string" },
            accommodation: { type: "string" },
            hotel: hotelPoiIds.length === 0 ? { type: "null" } : {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    poi_id: { type: "string", enum: hotelPoiIds },
                    estimated_cost: { type: "number" },
                  },
                  required: ["poi_id"],
                  additionalProperties: true,
                },
              ],
            },
            attractions: {
              type: "array",
              ...(poiIds.length === 0 ? { maxItems: 0 } : {}),
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  poi_id: { type: "string", ...(poiIds.length > 0 ? { enum: poiIds } : {}) },
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
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { overall_suggestions: { type: "string", maxLength: 800 } },
  required: ["overall_suggestions"],
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      maxItems: 6,
      items: { type: "string", maxLength: 240 },
    },
  },
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

function addUtcDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function fallbackSummary(request: TripPlanningRequest): string {
  const cities = request.cities.map((stay) => stay.city).filter(Boolean).join("、") || request.city;
  return `${cities}行程已按日期生成，请结合天气、预约规则和现场开放情况灵活调整。`;
}

function compactAgentDays(days: DayPlan[]): Array<Record<string, unknown>> {
  return days.map((day) => ({
    date: day.date,
    day_index: day.day_index,
    city: day.city,
    description: day.description,
    transportation: day.transportation,
    accommodation: day.accommodation,
    hotel: record(day.hotel) ? { name: String(day.hotel.name ?? ""), poi_id: String(day.hotel.poi_id ?? "") } : null,
    attractions: day.attractions.flatMap((attraction) => record(attraction) ? [{
      name: String(attraction.name ?? ""),
      poi_id: String(attraction.poi_id ?? ""),
    }] : []),
    meals: day.meals.flatMap((meal) => record(meal) ? [{
      type: String(meal.type ?? ""),
      name: String(meal.name ?? ""),
    }] : []),
  }));
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

function validateResearchSelection(
  raw: unknown,
  candidates: TrustedPoi[],
  minimumCount: number,
): TrustedPoi[] {
  if (!record(raw) || !Array.isArray(raw.selected_poi_ids)) throw new Error("景点研究子 Agent 输出无效");
  const trusted = new Map(candidates.map((candidate) => [candidate.poi_id, candidate]));
  const selected: TrustedPoi[] = [];
  const seen = new Set<string>();
  for (const value of raw.selected_poi_ids) {
    const poiId = String(value ?? "").trim();
    const candidate = trusted.get(poiId);
    if (!candidate) continue;
    if (!seen.has(poiId)) selected.push(structuredClone(candidate));
    seen.add(poiId);
  }
  const target = Math.min(candidates.length, Math.max(1, Math.floor(minimumCount)));
  for (const candidate of candidates) {
    if (selected.length >= target) break;
    if (seen.has(candidate.poi_id)) continue;
    selected.push(structuredClone(candidate));
    seen.add(candidate.poi_id);
  }
  return selected;
}

function validateSegmentOutput(
  raw: unknown,
  segment: Segment,
  trustedCandidates: TrustedPoi[],
  trustedHotels: TrustedPoi[],
): DayPlan[] {
  const days = record(raw) && Array.isArray(raw.days) ? raw.days as unknown[] : [];
  const trusted = new Map(trustedCandidates.map((candidate) => [candidate.poi_id, candidate]));
  const hotels = new Map(trustedHotels.map((candidate) => [candidate.poi_id, candidate]));
  const used = new Set<string>();
  return segment.day_indices.map((dayIndex, offset): DayPlan => {
    const value = record(days[offset]) ? structuredClone(days[offset]) as Record<string, unknown> : {};
    const rawAttractions = Array.isArray(value.attractions) ? value.attractions : [];
    const normalized: DayPlan = {
      ...value,
      date: addUtcDays(segment.start_date, offset),
      day_index: dayIndex,
      city: segment.city,
      description: String(value.description ?? "").trim() || `${segment.city}自由活动与机动安排`,
      transportation: String(value.transportation ?? "").trim() || "待确认",
      accommodation: String(value.accommodation ?? "").trim() || "待确认",
      hotel: null,
      attractions: [],
      meals: Array.isArray(value.meals)
        ? value.meals.filter(record).map((meal) => structuredClone(meal) as DayPlan["meals"][number])
        : [],
    };
    if (record(value.hotel)) {
      const candidate = hotels.get(String(value.hotel.poi_id ?? "").trim());
      if (candidate) {
        normalized.hotel = {
          ...structuredClone(candidate),
          name: candidate.name,
          poi_id: candidate.poi_id,
          source: "amap",
          source_hotel_id: candidate.poi_id,
          price_status: "unavailable",
        };
        delete normalized.hotel.estimated_cost;
      }
    }
    normalized.attractions = rawAttractions.flatMap((attraction) => {
      if (!record(attraction)) return [];
      const candidate = trusted.get(String(attraction.poi_id ?? "").trim());
      if (!candidate || used.has(candidate.poi_id)) return [];
      used.add(candidate.poi_id);
      return [{ ...attraction, ...structuredClone(candidate), name: candidate.name, poi_id: candidate.poi_id }];
    });
    if (normalized.attractions.length === 0) {
      const fallback = trustedCandidates.find((candidate) => !used.has(candidate.poi_id));
      if (fallback) {
        used.add(fallback.poi_id);
        normalized.attractions = [{
          ...structuredClone(fallback),
          name: fallback.name,
          poi_id: fallback.poi_id,
          ticket_price: Number(fallback.estimated_cost ?? 0),
        }];
      }
    }
    return normalized;
  });
}

export class PiTripPlanner implements TripPlanner {
  private readonly segmentDays: number;
  private readonly segmentConcurrency: number;
  private readonly reviewEnabled: boolean;
  private readonly duplicateRepairRounds: number;
  private readonly finalizationTimeoutMs: number;
  private readonly showThoughts: boolean;

  constructor(private readonly options: PiTripPlannerOptions) {
    this.segmentDays = options.segmentDays ?? 5;
    this.segmentConcurrency = options.segmentConcurrency ?? 8;
    this.reviewEnabled = options.reviewEnabled ?? true;
    this.duplicateRepairRounds = options.duplicateRepairRounds ?? 2;
    this.finalizationTimeoutMs = Math.max(1, options.finalizationTimeoutMs ?? 8_000);
    this.showThoughts = options.showThoughts === true;
  }

  async plan(request: TripPlanningRequest, context: PlannerRunContext): Promise<Record<string, unknown>> {
    const checkpoint = normalizeCheckpoint(context.checkpoint);
    const ownerRunId = crypto.randomUUID();
    const cities = [...new Set(request.cities.map((stay) => stay.city.trim()).filter(Boolean))];
    const baseSegments = buildSegments(request, this.segmentDays);
    const segmentLimiter = createLimiter(this.segmentConcurrency);
    const plannedSegments = new Map<string, Segment>();
    const details: NonNullable<PlannerProgress["details"]> = [];
    const reportProgress = async (update: PlannerProgress, thought: string): Promise<void> => {
      const stageSummary = visibleThoughtSummary(update.message, true);
      if (stageSummary && details.at(-1)?.title !== stageSummary) {
        details.push({ type: "info", title: stageSummary, timestamp: Date.now() });
      }
      const summary = visibleThoughtSummary(thought, this.showThoughts);
      if (summary) details.push({ type: "thinking", title: summary, timestamp: Date.now() });
      await context.onProgress({ ...update, details: structuredClone(details) });
    };
    ensureActive(context.signal);
    await reportProgress(
      { stage: "initializing", progress: 8, message: "正在初始化旅行规划" },
      "正在梳理行程范围与生成步骤",
    );

    const save = () => context.onCheckpoint(cloneCheckpoint(checkpoint));
    await mapConcurrent(cities, 6, async (city) => {
      const researchJobs = (["attractions", "weather", "hotels"] as const)
        .filter((kind) => !Object.hasOwn(checkpoint.search[kind], city));
      await Promise.all(researchJobs.map(async (kind) => {
        ensureActive(context.signal);
        if (kind === "attractions") {
          await reportProgress(
            { stage: "attraction_search", progress: 15, message: `正在研究${city}景点` },
            `正在为${city}筛选符合偏好的可信景点`,
          );
          const candidates = await this.options.research.searchAttractions(city, request.preferences);
          if (candidates.length === 0) {
            checkpoint.search.attractions[city] = [];
          } else {
            const selected = await this.options.agents.run({
              agent: "destination-researcher",
              nodeId: `${ownerRunId}:research:${city}`,
              input: { city, preferences: request.preferences, candidates },
              schema: researchSchema(candidates),
              signal: context.signal,
            });
            const cityDays = request.cities
              .filter((stay) => stay.city.trim() === city)
              .reduce((total, stay) => total + stay.days, 0);
            checkpoint.search.attractions[city] = validateResearchSelection(selected, candidates, cityDays);
          }
        } else if (kind === "weather") {
          await reportProgress(
            { stage: "weather_search", progress: 24, message: `正在查询${city}天气` },
            `正在核对${city}出行期间的天气条件`,
          );
          checkpoint.search.weather[city] = await this.options.research.getWeather(city);
        } else {
          await reportProgress(
            { stage: "hotel_search", progress: 32, message: `正在查询${city}酒店` },
            `正在匹配${city}住宿偏好与行程动线`,
          );
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
        reportProgress,
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
        reportProgress,
        issues,
        segmentLimiter,
      );
      days = mergeSegmentDays(request, segments, checkpoint);
    }
    const unresolved = duplicateAttractionIssues(days, segments);
    if (Object.keys(unresolved).length > 0) throw new Error("跨分段景点重复修复失败");
    days = rebalanceSparseAttractionDays(days);
    days = days.map((day) => day.date === request.end_date ? { ...day, hotel: null } : day);

    await reportProgress(
      { stage: "reviewing", progress: 88, message: "正在汇总并审查行程" },
      "正在校验行程完整性与预算节奏",
    );
    const jobs: Promise<void>[] = [];
    const compactDays = compactAgentDays(days);
    if (checkpoint.summary.status !== "completed") {
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(this.finalizationTimeoutMs)]);
      jobs.push(this.options.agents.run({
        agent: "summary",
        nodeId: `${ownerRunId}:summary`,
        input: { request, days: compactDays },
        schema: SUMMARY_SCHEMA,
        signal,
      }).then(async (output) => {
        if (!record(output) || typeof output.overall_suggestions !== "string") throw new Error("摘要子 Agent 输出无效");
        checkpoint.summary = {
          status: "completed",
          output: { overall_suggestions: output.overall_suggestions.slice(0, 800) },
          error: "",
        };
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
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(this.finalizationTimeoutMs)]);
      jobs.push(this.options.agents.run({
        agent: "itinerary-reviewer",
        nodeId: `${ownerRunId}:review`,
        input: { request, days: compactDays },
        schema: REVIEW_SCHEMA,
        signal,
      }).then(async (output) => {
        if (!record(output) || !Array.isArray(output.issues)) throw new Error("审查子 Agent 输出无效");
        checkpoint.review = {
          status: "completed",
          output: {
            issues: output.issues.slice(0, 6).map((issue) => String(issue).slice(0, 240)),
          },
          error: "",
        };
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
    days = await enrichHotelPrices(days, request, this.options.hotelPrices);
    ensureActive(context.signal);
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
    reportProgress: (update: PlannerProgress, thought: string) => Promise<void>,
    repairIssues: Record<string, string[]> = {},
    limiter: AsyncLimiter = createLimiter(this.segmentConcurrency),
  ): Promise<void> {
    const pending = segments.filter((segment) => checkpoint.segments[segment.segment_id]?.status !== "completed");
    await reportProgress(
      { stage: "planning", progress: 45, message: "正在并行生成分段行程" },
      "正在平衡各天景点节奏与交通衔接",
    );
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
          schema: segmentSchema(attractions, hotels as TrustedPoi[], segment.day_indices.length),
          signal: context.signal,
        });
        state.output = validateSegmentOutput(output, segment, attractions, hotels as TrustedPoi[]);
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
