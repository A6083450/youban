import type { TripPlanningRequest } from "./orchestrator.ts";

function dateValue(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function normalizeTripPlanningRequest(
  input: Record<string, unknown>,
): TripPlanningRequest & Record<string, unknown> {
  const travelDays = Number(input.travel_days);
  const rawCity = String(input.city ?? "").trim();
  const rawCities = Array.isArray(input.cities) ? input.cities : [];
  const cities = rawCities.map((entry) => {
    const value = entry as Record<string, unknown>;
    return { city: String(value.city ?? "").trim(), days: Number(value.days) };
  });
  if (cities.length === 0 && rawCity) cities.push({ city: rawCity, days: travelDays });
  if (cities.length === 0 || cities.some((stay) => !stay.city)) {
    throw new Error("至少需要一个有效目的地城市");
  }
  if (cities.reduce((total, stay) => total + stay.days, 0) !== travelDays) {
    throw new Error("城市停留天数总和必须等于旅行天数");
  }
  const start = dateValue(input.start_date);
  const end = dateValue(input.end_date);
  if (!Number.isFinite(start) || !Number.isFinite(end)
    || Math.floor((end - start) / 86_400_000) + 1 !== travelDays) {
    throw new Error("起止日期必须有效且与旅行天数一致");
  }
  const travelerCount = Number(input.traveler_count ?? 1);
  const roomCount = Number(input.room_count ?? Math.ceil(travelerCount / 2));
  return {
    ...input,
    city: rawCity || cities[0]!.city,
    cities,
    start_date: String(input.start_date),
    end_date: String(input.end_date),
    travel_days: travelDays,
    transportation: String(input.transportation).trim(),
    accommodation: String(input.accommodation).trim(),
    traveler_count: travelerCount,
    room_count: roomCount,
    budget_basis: input.budget_basis === "per_person" ? "per_person" : "group_total",
    preferences: Array.isArray(input.preferences)
      ? input.preferences.map(String).map((value) => value.trim()).filter(Boolean)
      : [],
  };
}
