import type { DayPlan } from "./orchestrator.ts";

const OUTDOOR_KEYWORDS = [
  "公园", "山", "湖", "岛", "海滩", "沙滩", "湿地", "森林", "草原",
  "古镇", "古村", "步道", "广场", "街", "园林", "动物园", "植物园",
  "park", "mountain", "lake", "island", "beach", "forest", "garden",
];
const ARRIVAL_KEYWORDS = ["抵达", "到达", "arrive", "arrival", "到着"];
const AFTERNOON_KEYWORDS = ["下午", "傍晚", "afternoon", "evening", "午後", "夕方"];
const MEAL_ANCHORS: Record<string, number> = {
  breakfast: 8 * 60,
  lunch: 12 * 60 + 30,
  dinner: 18 * 60 + 30,
  snack: 15 * 60 + 30,
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null;
}

function formatMinutes(value: number): string {
  const normalized = Math.max(0, Math.min(value, 23 * 60 + 59));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function hasForecast(weather: Record<string, unknown> | undefined): boolean {
  return Boolean(weather && ["day_weather", "night_weather", "day_temp", "night_temp"]
    .some((key) => weather[key] !== null && weather[key] !== undefined && weather[key] !== ""));
}

function isHot(weather: Record<string, unknown> | undefined): boolean {
  if (!hasForecast(weather)) return false;
  const temperature = Number.parseFloat(String(weather?.day_temp ?? ""));
  return Number.isFinite(temperature) && temperature >= 29;
}

function isWeekend(rawDate: string): boolean {
  const date = new Date(`${rawDate}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && [0, 6].includes(date.getUTCDay());
}

function includesAny(value: string, keywords: string[]): boolean {
  const normalized = value.toLocaleLowerCase("und");
  return keywords.some((keyword) => normalized.includes(keyword));
}

export function recommendVisitTimes(
  sourceDays: DayPlan[],
  weatherInfo: Array<Record<string, unknown>> = [],
): DayPlan[] {
  const weatherByDate = new Map(weatherInfo.map((item) => [String(item.date ?? ""), item]));
  return structuredClone(sourceDays).map((day) => {
    const weather = weatherByDate.get(day.date);
    const afternoonArrival = includesAny(day.description, ARRIVAL_KEYWORDS)
      && includesAny(day.description, AFTERNOON_KEYWORDS);
    let previousEnd: number | null = null;

    day.attractions.forEach((rawAttraction, index) => {
      const attraction = rawAttraction as Record<string, unknown>;
      const durationValue = Number(attraction.visit_duration ?? 90);
      const duration = Math.max(30, Number.isFinite(durationValue) ? Math.trunc(durationValue) : 90);
      const existingStart = toMinutes(attraction.start_time);
      let existingEnd = toMinutes(attraction.end_time);
      if (existingStart !== null) {
        if (existingEnd === null) {
          attraction.end_time = formatMinutes(existingStart + duration);
          existingEnd = existingStart + duration;
        }
        previousEnd = existingEnd;
        return;
      }

      const searchable = `${String(attraction.name ?? "")} ${String(attraction.category ?? "")} ${String(attraction.description ?? "")}`;
      const outdoor = includesAny(searchable, OUTDOOR_KEYWORDS);
      let start: number;
      if (afternoonArrival) start = index === 0 ? 15 * 60 + 30 : 18 * 60;
      else if (index === 0) start = outdoor && (isHot(weather) || isWeekend(day.date)) ? 8 * 60 : 9 * 60;
      else if (outdoor && isHot(weather)) start = 16 * 60;
      else start = 14 * 60 + (index - 1) * 150;
      if (previousEnd !== null) start = Math.max(start, previousEnd + 30);

      attraction.start_time = formatMinutes(start);
      attraction.end_time = formatMinutes(start + duration);
      attraction.time_recommendation_basis = hasForecast(weather) ? "weather" : "seasonal";
      attraction.crowd_recommendation_basis = "heuristic";
      previousEnd = start + duration;
    });

    const timeRanges = day.attractions.map((item) => {
      const attraction = record(item);
      return { start: toMinutes(attraction.start_time), end: toMinutes(attraction.end_time) };
    });
    const morningEnds = timeRanges.filter(({ start, end }) => start !== null && start < 13 * 60 && end !== null)
      .map(({ end }) => end as number);
    const afternoonEnds = timeRanges.filter(({ start, end }) => start !== null && start >= 14 * 60 && end !== null)
      .map(({ end }) => end as number);
    const latestMorningEnd = morningEnds.length ? Math.max(...morningEnds) : null;
    const latestAfternoonEnd = afternoonEnds.length ? Math.max(...afternoonEnds) : null;

    day.meals.forEach((rawMeal) => {
      const meal = rawMeal as Record<string, unknown>;
      if (toMinutes(meal.time) !== null) return;
      const type = String(meal.type ?? "").toLocaleLowerCase("und");
      let anchor = MEAL_ANCHORS[type] ?? 12 * 60 + 30;
      if (type === "lunch" && latestMorningEnd !== null) anchor = Math.max(anchor, latestMorningEnd + 30);
      if (type === "dinner" && latestAfternoonEnd !== null) anchor = Math.max(anchor, latestAfternoonEnd + 30);
      meal.time = formatMinutes(anchor);
      meal.time_recommendation_basis = "schedule";
    });
    return day;
  });
}
