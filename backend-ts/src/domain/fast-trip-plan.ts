import { adjustGeneratedDaysToBudget } from "./budget-guard.ts";
import { recommendVisitTimes } from "./itinerary-scheduler.ts";
import {
  buildBudget,
  buildWeatherInfo,
  normalizeCheckpoint,
  type AttractionPlan,
  type DayPlan,
  type TripPlanningRequest,
} from "./orchestrator.ts";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function trustedAttractions(value: unknown): AttractionPlan[] {
  const seen = new Set<string>();
  const attractions: AttractionPlan[] = [];
  for (const raw of array(value)) {
    const poi = record(raw);
    const location = record(poi?.location);
    const poiId = String(poi?.poi_id ?? "").trim();
    const name = String(poi?.name ?? "").trim();
    const longitude = Number(location?.longitude);
    const latitude = Number(location?.latitude);
    if (!poiId || !name || seen.has(poiId) || !Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    seen.add(poiId);
    const attraction: AttractionPlan = {
      poi_id: poiId,
      name,
      address: String(poi?.address ?? "").trim(),
      location: { longitude, latitude },
    };
    for (const key of ["description", "category", "type", "visit_duration", "reservation_required", "reservation_tips"] as const) {
      if (poi?.[key] !== undefined) attraction[key] = structuredClone(poi[key]);
    }
    const price = Number(poi?.ticket_price);
    if (Number.isFinite(price) && price >= 0) attraction.ticket_price = price;
    attractions.push(attraction);
  }
  return attractions;
}

function addDays(startDate: string, offset: number): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error("start_date 格式无效");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function genericMeals(language: unknown): DayPlan["meals"] {
  const code = String(language ?? "zh").toLocaleLowerCase("und");
  if (code.startsWith("fr")) {
    return [
      { type: "breakfast", name: "Petit-déjeuner local (à choisir selon les horaires d'ouverture)" },
      { type: "lunch", name: "Déjeuner local (à choisir selon les horaires d'ouverture)" },
      { type: "dinner", name: "Dîner local (à choisir selon les horaires d'ouverture)" },
    ];
  }
  return [
    { type: "breakfast", name: "当地早餐（请按实际营业情况选择）" },
    { type: "lunch", name: "当地午餐（请按实际营业情况选择）" },
    { type: "dinner", name: "当地晚餐（请按实际营业情况选择）" },
  ];
}

function genericSuggestion(request: TripPlanningRequest): string {
  const language = String(request.language ?? "zh").toLocaleLowerCase("und");
  if (language.startsWith("en")) return "Confirm opening hours, transport, and reservations before departure.";
  if (language.startsWith("fr")) return "Vérifiez les horaires d'ouverture, les transports et les réservations avant le départ.";
  return "出发前请确认开放时间、交通和预约情况。";
}

function genericDescription(request: TripPlanningRequest, city: string, dayIndex: number): string {
  const language = String(request.language ?? "zh").toLocaleLowerCase("und");
  if (language.startsWith("fr")) {
    return `Jour ${dayIndex + 1} à ${city} : proposition locale à adapter aux horaires d'ouverture réels.`;
  }
  return `第${dayIndex + 1}天在${city}的本地行程建议，请以实际开放时间为准。`;
}

function summarySuggestion(summary: unknown, request: TripPlanningRequest): string {
  const output = record(summary);
  const suggestion = String(output?.overall_suggestions ?? "").trim();
  return suggestion || genericSuggestion(request);
}

export function buildFastTripPlan(
  request: TripPlanningRequest,
  checkpoint: unknown,
): Record<string, unknown> {
  const saved = normalizeCheckpoint(checkpoint);
  const weatherInfo = buildWeatherInfo(request, saved.search.weather);
  const attractionsByCity = new Map(
    request.cities.map((stay) => [stay.city, trustedAttractions(saved.search.attractions[stay.city])]),
  );
  const usedPoiIds = new Set<string>();
  const days: DayPlan[] = [];
  let dayIndex = 0;

  for (const stay of request.cities) {
    const candidates = attractionsByCity.get(stay.city) ?? [];
    for (let offset = 0; offset < stay.days; offset += 1) {
      const attraction = candidates.find((item) => !usedPoiIds.has(String(item.poi_id)));
      if (attraction?.poi_id) usedPoiIds.add(attraction.poi_id);
      days.push({
        date: addDays(request.start_date, dayIndex),
        day_index: dayIndex,
        city: stay.city,
        description: genericDescription(request, stay.city, dayIndex),
        transportation: request.transportation,
        accommodation: request.accommodation,
        hotel: null,
        attractions: attraction ? [structuredClone(attraction)] : [],
        meals: genericMeals(request.language),
      });
      dayIndex += 1;
    }
  }

  if (dayIndex !== request.travel_days) throw new Error("cities 天数总和必须等于 travel_days");
  const adjusted = adjustGeneratedDaysToBudget(request, days);
  const scheduledDays = recommendVisitTimes(adjusted.days, weatherInfo);

  return {
    success: true,
    data: {
      ...request,
      days: scheduledDays,
      weather_info: weatherInfo,
      budget: buildBudget(scheduledDays, request.traveler_count, request.room_count),
      budget_adjustment_applied: adjusted.budget_adjustment_applied,
      budget_adjustment_note: adjusted.budget_adjustment_note,
      overall_suggestions: summarySuggestion(saved.summary.output, request),
    },
    review: saved.review.output,
  };
}
