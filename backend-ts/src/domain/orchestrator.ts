export interface CityStay {
  city: string;
  days: number;
}

export interface TripPlanningRequest {
  city: string;
  cities: CityStay[];
  start_date: string;
  end_date: string;
  travel_days: number;
  transportation: string;
  accommodation: string;
  traveler_count?: number;
  room_count?: number;
  budget_amount?: number | null;
  budget_basis?: "group_total" | "per_person";
  preferences: string[];
  [key: string]: unknown;
}

export interface AttractionPlan {
  name: string;
  poi_id?: string;
  ticket_price?: number;
  [key: string]: unknown;
}

export interface MealPlan {
  type: string;
  name: string;
  estimated_cost?: number;
  [key: string]: unknown;
}

export interface DayPlan {
  date: string;
  day_index: number;
  city: string;
  description: string;
  transportation: string;
  accommodation: string;
  hotel?: ({ name: string; estimated_cost?: number; [key: string]: unknown } | null);
  attractions: AttractionPlan[];
  meals: MealPlan[];
  [key: string]: unknown;
}

export interface Segment {
  segment_id: string;
  day_indices: number[];
  city: string;
  start_date: string;
  end_date: string;
  attraction_candidate_ids?: string[];
}

export interface SegmentCheckpoint {
  day_indices: number[];
  status: "pending" | "processing" | "completed" | "failed";
  output: DayPlan[];
  attempts: number;
  error: string;
}

export interface PlanningCheckpoint {
  version: 1;
  search: {
    attractions: Record<string, unknown>;
    weather: Record<string, unknown>;
    hotels: Record<string, unknown>;
  };
  segments: Record<string, SegmentCheckpoint>;
  summary: { status: "pending" | "completed" | "failed"; output: unknown; error: string };
  review: { status: "pending" | "completed" | "failed"; output: unknown; error: string };
}

export function emptyCheckpoint(): PlanningCheckpoint {
  return {
    version: 1,
    search: { attractions: {}, weather: {}, hotels: {} },
    segments: {},
    summary: { status: "pending", output: null, error: "" },
    review: { status: "pending", output: null, error: "" },
  };
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validStage(value: unknown): boolean {
  return record(value)
    && exactKeys(value, ["status", "output", "error"])
    && ["pending", "completed", "failed"].includes(String(value.status))
    && typeof value.error === "string";
}

function validSegment(value: unknown): value is SegmentCheckpoint {
  return record(value)
    && exactKeys(value, ["day_indices", "status", "output", "attempts", "error"])
    && Array.isArray(value.day_indices)
    && value.day_indices.every(Number.isInteger)
    && ["pending", "processing", "completed", "failed"].includes(String(value.status))
    && Array.isArray(value.output)
    && Number.isInteger(value.attempts)
    && Number(value.attempts) >= 0
    && typeof value.error === "string";
}

export function normalizeCheckpoint(value: unknown): PlanningCheckpoint {
  if (!record(value)
    || !exactKeys(value, ["version", "search", "segments", "summary", "review"])
    || value.version !== 1
    || !record(value.search)
    || !exactKeys(value.search, ["attractions", "weather", "hotels"])
    || !Object.values(value.search).every(record)
    || !record(value.segments)
    || !Object.values(value.segments).every(validSegment)
    || !validStage(value.summary)
    || !validStage(value.review)) {
    return emptyCheckpoint();
  }
  const normalized = structuredClone(value) as unknown as PlanningCheckpoint;
  for (const segment of Object.values(normalized.segments)) {
    if (segment.status === "processing") segment.status = "pending";
  }
  return normalized;
}

function segmentSizes(dayCount: number, maxDays: number): number[] {
  const segmentCount = Math.ceil(dayCount / maxDays);
  const baseSize = Math.floor(dayCount / segmentCount);
  const largerSegments = dayCount % segmentCount;
  return Array.from(
    { length: segmentCount },
    (_, index) => baseSize + (index < largerSegments ? 1 : 0),
  );
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.valueOf())) throw new Error("start_date 格式无效");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function buildSegments(request: TripPlanningRequest, maxDays = 5): Segment[] {
  if (request.cities.reduce((total, city) => total + city.days, 0) !== request.travel_days) {
    throw new Error("cities 天数总和必须等于 travel_days");
  }
  if (!Number.isInteger(maxDays) || maxDays < 1) {
    throw new Error("segment days 必须是正整数");
  }
  const segments: Segment[] = [];
  let dayIndex = 0;
  for (const stay of request.cities) {
    for (const size of segmentSizes(stay.days, maxDays)) {
      const indices = Array.from({ length: size }, (_, offset) => dayIndex + offset);
      segments.push({
        segment_id: `seg-${String(segments.length + 1).padStart(2, "0")}`,
        day_indices: indices,
        city: stay.city,
        start_date: addDays(request.start_date, indices[0]!),
        end_date: addDays(request.start_date, indices.at(-1)!),
      });
      dayIndex += size;
    }
  }
  return segments;
}

function candidateIds(value: unknown): string[] {
  const values = typeof value === "string" ? (() => {
    try { return JSON.parse(value) as unknown; } catch { return []; }
  })() : value;
  if (!Array.isArray(values)) return [];
  return values.flatMap((entry) => {
    if (!record(entry)) return [];
    const poiId = String(entry.poi_id ?? "").trim();
    const name = String(entry.name ?? "").trim();
    const location = entry.location;
    if (!poiId || !name || !record(location)
      || !Number.isFinite(Number(location.longitude))
      || !Number.isFinite(Number(location.latitude))) return [];
    return [poiId];
  });
}

export function allocateSegmentCandidates(
  segments: Segment[],
  attractions: Record<string, unknown>,
): Segment[] {
  const allocated = structuredClone(segments);
  const indicesByCity = new Map<string, number[]>();
  allocated.forEach((segment, index) => {
    const indices = indicesByCity.get(segment.city) ?? [];
    indices.push(index);
    indicesByCity.set(segment.city, indices);
  });
  for (const [city, segmentIndices] of indicesByCity) {
    const ids = candidateIds(attractions[city]);
    if (ids.length === 0) continue;
    const weights = segmentIndices.map((index) => allocated[index]!.day_indices.length);
    const totalWeight = weights.reduce((left, right) => left + right, 0) || 1;
    const raw = weights.map((weight) => ids.length * weight / totalWeight);
    const quotas = raw.map(Math.floor);
    let remainder = ids.length - quotas.reduce((left, right) => left + right, 0);
    const order = raw.map((value, index) => ({ index, fraction: value - quotas[index]! }))
      .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    for (const item of order) {
      if (remainder-- <= 0) break;
      quotas[item.index]! += 1;
    }
    const pools = segmentIndices.map(() => [] as string[]);
    let cursor = 0;
    for (const id of ids) {
      for (let attempts = 0; attempts < segmentIndices.length; attempts += 1) {
        const poolIndex = cursor++ % segmentIndices.length;
        if (pools[poolIndex]!.length < quotas[poolIndex]!) {
          pools[poolIndex]!.push(id);
          break;
        }
      }
    }
    segmentIndices.forEach((segmentIndex, poolIndex) => {
      allocated[segmentIndex]!.attraction_candidate_ids = pools[poolIndex];
    });
  }
  return allocated;
}

export function mergeSegmentDays(
  request: TripPlanningRequest,
  segments: Segment[],
  checkpoint: PlanningCheckpoint,
): DayPlan[] {
  const expected = new Map(segments.map((segment) => [segment.segment_id, segment]));
  const days: DayPlan[] = [];
  for (const [segmentId, saved] of Object.entries(checkpoint.segments)) {
    if (saved.status !== "completed") continue;
    const segment = expected.get(segmentId);
    if (!segment) throw new Error("checkpoint 包含未知 segment_id");
    const indices = saved.output.map((day) => day.day_index);
    if (JSON.stringify(indices) !== JSON.stringify(segment.day_indices)) {
      throw new Error("segment output 与 day_indices 不符");
    }
    days.push(...structuredClone(saved.output));
  }
  days.sort((left, right) => left.day_index - right.day_index);
  if (days.length !== request.travel_days
    || days.some((day, index) => day.day_index !== index)) {
    throw new Error("day_index 存在重复或缺失");
  }
  const cityByDay = request.cities.flatMap((stay) => Array.from({ length: stay.days }, () => stay.city));
  for (const day of days) {
    if (day.date !== addDays(request.start_date, day.day_index)) throw new Error("日期与 day_index 不符");
    if (day.city !== cityByDay[day.day_index]) throw new Error("城市与请求不符");
  }
  return days;
}

function normalizedName(value: string): string {
  return (value.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}]/gu) ?? []).join("");
}

export function duplicateAttractionIssues(
  days: DayPlan[],
  segments: Segment[],
): Record<string, string[]> {
  const segmentByDay = new Map<number, string>();
  for (const segment of segments) for (const index of segment.day_indices) segmentByDay.set(index, segment.segment_id);
  const seen = new Map<string, { dayIndex: number; name: string }>();
  const issues: Record<string, string[]> = {};
  for (const day of [...days].sort((left, right) => left.day_index - right.day_index)) {
    for (const attraction of day.attractions) {
      const poiId = String(attraction.poi_id ?? "").trim();
      const identity = poiId ? `poi:${poiId}` : `name:${normalizedName(attraction.name)}`;
      if (identity === "name:") continue;
      const key = `${day.city.trim()}\0${identity}`;
      const previous = seen.get(key);
      if (!previous) {
        seen.set(key, { dayIndex: day.day_index, name: attraction.name });
        continue;
      }
      const segmentId = segmentByDay.get(day.day_index);
      if (!segmentId) throw new Error("景点所在 day_index 不属于任何分段");
      const source = poiId ? `，高德 POI ID=${poiId}` : "";
      (issues[segmentId] ??= []).push(
        `D${day.day_index + 1} 的“${attraction.name}”与 D${previous.dayIndex + 1} 的“${previous.name}”重复${source}；必须改为尚未使用的真实景点`,
      );
    }
  }
  return issues;
}

export function buildBudget(days: DayPlan[], travelerCount = 1, roomCount = 1) {
  const travelers = Math.max(1, travelerCount);
  const rooms = Math.max(1, roomCount);
  const totalAttractions = days.reduce((total, day) => total
    + day.attractions.reduce((sum, item) => sum + Number(item.ticket_price ?? 0) * travelers, 0), 0);
  const totalHotels = days.reduce((total, day) => total + Number(day.hotel?.estimated_cost ?? 0) * rooms, 0);
  const totalMeals = days.reduce((total, day) => total
    + day.meals.reduce((sum, meal) => sum + Number(meal.estimated_cost ?? 0) * travelers, 0), 0);
  return {
    total_attractions: totalAttractions,
    total_hotels: totalHotels,
    total_meals: totalMeals,
    total_transportation: 0,
    total_inter_city_transport: 0,
    total: totalAttractions + totalHotels + totalMeals,
  };
}

export function buildWeatherInfo(
  request: TripPlanningRequest,
  weather: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const raw of Object.values(weather)) {
    let entries: unknown = raw;
    if (typeof raw === "string") {
      try { entries = JSON.parse(raw); } catch { continue; }
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!record(entry)) continue;
      const date = String(entry.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
        || date < request.start_date
        || date > request.end_date
        || byDate.has(date)) continue;
      byDate.set(date, structuredClone(entry));
    }
  }
  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}
