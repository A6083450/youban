const INFERRED_FIELDS = new Set([
  "dates",
  "transportation",
  "accommodation",
  "preferences",
  "traveler_count",
]);

interface CityStay {
  city: string;
  days: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDate(value: unknown): string | null {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value: unknown, maximum: number): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function normalizeCities(value: unknown): CityStay[] | null {
  if (!Array.isArray(value)) return null;
  const cities = value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const city = String(entry.city ?? "").trim();
    const days = positiveInteger(entry.days, 15);
    return city && days ? [{ city, days }] : [];
  });
  if (cities.length !== value.length || cities.length === 0) return null;
  const total = cities.reduce((sum, city) => sum + city.days, 0);
  return total <= 30 ? cities : null;
}

function fitCitiesToTravelDays(cities: CityStay[], requestedDays: number): CityStay[] {
  const targetTotal = Math.max(cities.length, requestedDays);
  const currentTotal = cities.reduce((total, city) => total + city.days, 0);
  if (targetTotal === currentTotal) return cities;

  const weighted = cities.map((city) => {
    const exact = (city.days / currentTotal) * targetTotal;
    return { ...city, days: Math.max(1, Math.floor(exact)), remainder: exact - Math.floor(exact) };
  });
  let difference = targetTotal - weighted.reduce((total, city) => total + city.days, 0);
  const order = weighted
    .map((city, index) => ({ index, remainder: city.remainder }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (let cursor = 0; difference > 0; cursor += 1, difference -= 1) {
    weighted[order[cursor % order.length]!.index]!.days += 1;
  }
  while (difference < 0) {
    const candidate = weighted
      .map((city, index) => ({ index, days: city.days }))
      .filter((city) => city.days > 1)
      .sort((left, right) => right.days - left.days || left.index - right.index)[0];
    if (!candidate) break;
    weighted[candidate.index]!.days -= 1;
    difference += 1;
  }
  return weighted.map(({ city, days }) => ({ city, days }));
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyTripDraftPatch(
  draft: Record<string, unknown>,
  rawPatch: unknown,
  today: string,
): Record<string, unknown> | null {
  if (!isRecord(rawPatch)) return null;
  const patch = rawPatch;
  const updated = { ...draft };
  let recognized = false;

  const requestedCities = Object.hasOwn(patch, "cities") ? normalizeCities(patch.cities) : null;
  const requestedDays = Object.hasOwn(patch, "travel_days")
    ? positiveInteger(patch.travel_days, 30)
    : null;
  const requestedStartDate = Object.hasOwn(patch, "start_date") ? parseDate(patch.start_date) : null;
  const changesStructure = Boolean(requestedCities || requestedDays || requestedStartDate);
  if (changesStructure) {
    let cities = requestedCities ?? normalizeCities(draft.cities);
    if (!cities) return null;
    if (requestedDays) cities = fitCitiesToTravelDays(cities, requestedDays);
    const travelDays = cities.reduce((sum, city) => sum + city.days, 0);
    const startDate = requestedStartDate ?? parseDate(draft.start_date) ?? parseDate(today);
    if (!startDate) return null;
    updated.city = cities[0]!.city;
    updated.cities = cities;
    updated.start_date = startDate;
    updated.end_date = addDays(startDate, travelDays - 1);
    updated.travel_days = travelDays;
    recognized = true;
  }

  for (const field of ["traveler_count", "room_count"] as const) {
    if (!Object.hasOwn(patch, field)) continue;
    const value = positiveInteger(patch[field], 50);
    if (value !== null) {
      updated[field] = value;
      recognized = true;
    }
  }

  for (const field of ["transportation", "accommodation"] as const) {
    if (!Object.hasOwn(patch, field)) continue;
    const value = String(patch[field] ?? "").trim();
    if (value) {
      updated[field] = value;
      recognized = true;
    }
  }

  if (Object.hasOwn(patch, "budget_amount")) {
    const rawBudget = patch.budget_amount;
    const budget = rawBudget === null || rawBudget === "" ? null : Number(rawBudget);
    if (budget === null || (Number.isFinite(budget) && budget >= 0)) {
      updated.budget_amount = budget;
      recognized = true;
    }
  }
  if (patch.budget_basis === "per_person" || patch.budget_basis === "group_total") {
    updated.budget_basis = patch.budget_basis;
    recognized = true;
  }

  for (const field of ["preferences", "suggestions"] as const) {
    if (!Object.hasOwn(patch, field)) continue;
    const value = strings(patch[field]);
    if (value) {
      updated[field] = field === "suggestions" ? value.slice(0, 4) : value;
      recognized = true;
    }
  }
  if (Object.hasOwn(patch, "inferred_fields")) {
    const value = strings(patch.inferred_fields);
    if (value) {
      updated.inferred_fields = value.filter((field) => INFERRED_FIELDS.has(field));
      recognized = true;
    }
  }

  return recognized && !sameValue(updated, draft) ? updated : null;
}
