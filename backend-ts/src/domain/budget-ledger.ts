export type BudgetItemType = "attraction" | "hotel" | "meal" | "transport" | "other";
export type AmountBasis = "group_total" | "per_person";

export interface BudgetLedgerItem {
  id: string;
  type: BudgetItemType;
  day_index: number | null;
  day_end_index: number | null;
  name: string;
  amount: number | null;
  amount_basis: AmountBasis;
  traveler_count: number;
  per_person_amount: number | null;
  calculation_summary: string;
  unit_amount: number | null;
  room_count: number | null;
  nights: number | null;
  origin: "itinerary" | "user";
  price_source: "unavailable" | "estimated" | "live" | "user";
  price_provider: string;
  linked_item_id: string;
  entity_source: string;
  source_url: string;
  price_checked_at: string;
  note: string;
  user_locked: boolean;
  deleted: boolean;
}

export interface BudgetTotals {
  total_attractions: number;
  total_hotels: number;
  total_meals: number;
  total_transportation: number;
  total_inter_city_transport: number;
  total_other: number;
  total: number;
}

const TYPE_ORDER: Record<BudgetItemType, number> = {
  attraction: 0,
  hotel: 1,
  meal: 2,
  transport: 3,
  other: 4,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function amount(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round(Math.max(0, numeric) * 100) / 100 : 0;
}

function count(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.trunc(numeric)) : fallback;
}

function perPerson(value: number | null, travelers: number): number | null {
  return value === null ? null : Math.round(value / count(travelers) * 100) / 100;
}

function baseItem(values: Partial<BudgetLedgerItem> & Pick<BudgetLedgerItem, "id" | "type" | "name">): BudgetLedgerItem {
  return {
    id: values.id,
    type: values.type,
    day_index: values.day_index ?? null,
    day_end_index: values.day_end_index ?? null,
    name: values.name,
    amount: values.amount ?? null,
    amount_basis: values.amount_basis ?? "group_total",
    traveler_count: values.traveler_count ?? 1,
    per_person_amount: values.per_person_amount ?? null,
    calculation_summary: values.calculation_summary ?? "",
    unit_amount: values.unit_amount ?? null,
    room_count: values.room_count ?? null,
    nights: values.nights ?? null,
    origin: values.origin ?? "itinerary",
    price_source: values.price_source ?? "unavailable",
    price_provider: values.price_provider ?? "",
    linked_item_id: values.linked_item_id ?? "",
    entity_source: values.entity_source ?? "",
    source_url: values.source_url ?? "",
    price_checked_at: values.price_checked_at ?? "",
    note: values.note ?? "",
    user_locked: values.user_locked ?? false,
    deleted: values.deleted ?? false,
  };
}

export function toGroupTotal(
  value: number | null,
  basis: AmountBasis,
  travelerCount: number,
): number | null {
  if (value === null) return null;
  const normalized = amount(value) * (basis === "per_person" ? count(travelerCount) : 1);
  return Math.round(normalized * 100) / 100;
}

function deriveHotelItems(days: unknown[], travelers: number, rooms: number): BudgetLedgerItem[] {
  const items: BudgetLedgerItem[] = [];
  let group: {
    identity: string;
    hotel: Record<string, unknown>;
    start: number;
    end: number;
    nights: number;
  } | null = null;
  const dayIndices = days.map((day, index) => count(record(day)?.day_index ?? index, index || 1) - (index === 0 ? 1 : 0));
  const finalDayIndex = dayIndices.length ? Math.max(...dayIndices) : 0;

  const flush = () => {
    if (!group) return;
    const current = group;
    const priceStatus = String(current.hotel.price_status ?? "unavailable");
    const rawUnit = amount(current.hotel.estimated_cost);
    const unit = priceStatus === "unavailable" || rawUnit === 0 ? null : rawUnit;
    const total = unit === null ? null : Math.round(unit * rooms * current.nights * 100) / 100;
    items.push(baseItem({
      id: `itinerary:hotel:${current.start}`,
      type: "hotel",
      day_index: current.start,
      day_end_index: Math.min(current.end + 1, finalDayIndex),
      name: String(current.hotel.name || "未命名酒店"),
      amount: total,
      amount_basis: "group_total",
      traveler_count: travelers,
      per_person_amount: perPerson(total, travelers),
      unit_amount: unit,
      room_count: rooms,
      nights: current.nights,
      calculation_summary: "room_night",
      price_source: priceStatus === "live" || priceStatus === "estimated" ? priceStatus : "unavailable",
      price_provider: String(current.hotel.price_source ?? ""),
      linked_item_id: String(current.hotel.source_hotel_id ?? ""),
      entity_source: String(current.hotel.source ?? ""),
      source_url: String(current.hotel.source_url ?? ""),
      price_checked_at: String(current.hotel.price_checked_at ?? ""),
    }));
    group = null;
  };

  days.forEach((rawDay, position) => {
    const day = record(rawDay) ?? {};
    const dayIndex = Number.isInteger(Number(day.day_index)) ? Number(day.day_index) : position;
    const hotel = record(day.hotel);
    if (!hotel) {
      flush();
      return;
    }
    const identity = JSON.stringify([
      hotel.source ?? "",
      hotel.source_hotel_id ?? "",
      hotel.name ?? "",
      amount(hotel.estimated_cost),
    ]);
    if (group && group.identity === identity && group.end + 1 === dayIndex) {
      group.end = dayIndex;
      group.nights += 1;
      return;
    }
    flush();
    group = { identity, hotel, start: dayIndex, end: dayIndex, nights: 1 };
  });
  flush();
  return items;
}

export function deriveBudgetItems(
  result: unknown,
  travelerCount?: number,
  roomCount?: number,
): BudgetLedgerItem[] {
  const plan = record(record(result)?.data);
  if (!plan) return [];
  const travelers = count(travelerCount ?? plan.traveler_count);
  const rooms = count(roomCount ?? plan.room_count, Math.ceil(travelers / 2));
  const days = Array.isArray(plan.days) ? plan.days : [];
  const budget = record(plan.budget) ?? {};
  const transportTotal = amount(budget.total_transportation);
  const transportDays = days.filter((rawDay) => String(record(rawDay)?.transportation ?? "").trim());
  const transportShare = transportDays.length ? Math.round(transportTotal / transportDays.length * 100) / 100 : 0;
  let transportRemaining = transportTotal;
  const items: BudgetLedgerItem[] = [];

  days.forEach((rawDay, dayPosition) => {
    const day = record(rawDay) ?? {};
    const dayIndex = Number.isInteger(Number(day.day_index)) ? Number(day.day_index) : dayPosition;
    const attractions = Array.isArray(day.attractions) ? day.attractions : [];
    attractions.forEach((rawAttraction, itemPosition) => {
      const attraction = record(rawAttraction) ?? {};
      const linkedId = String(attraction.id || `${dayIndex}-${itemPosition}`);
      const unit = amount(attraction.ticket_price);
      const total = Math.round(unit * travelers * 100) / 100;
      items.push(baseItem({
        id: `itinerary:attraction:${linkedId}`,
        type: "attraction",
        day_index: dayIndex,
        name: String(attraction.name || "未命名景点"),
        amount: total,
        amount_basis: "per_person",
        traveler_count: travelers,
        per_person_amount: unit,
        unit_amount: unit,
        calculation_summary: "per_person",
        price_source: "estimated",
        linked_item_id: linkedId,
        entity_source: attraction.poi_id ? "amap" : "",
      }));
    });

    const meals = Array.isArray(day.meals) ? day.meals : [];
    meals.forEach((rawMeal, itemPosition) => {
      const meal = record(rawMeal) ?? {};
      const linkedId = String(meal.id || `${dayIndex}-${itemPosition}`);
      const unit = amount(meal.estimated_cost);
      const total = Math.round(unit * travelers * 100) / 100;
      items.push(baseItem({
        id: `itinerary:meal:${linkedId}`,
        type: "meal",
        day_index: dayIndex,
        name: String(meal.name || "未命名餐饮"),
        amount: total,
        amount_basis: "per_person",
        traveler_count: travelers,
        per_person_amount: unit,
        unit_amount: unit,
        calculation_summary: "per_person",
        price_source: "estimated",
        linked_item_id: linkedId,
      }));
    });

    const transportation = String(day.transportation ?? "").trim();
    if (transportation) {
      const isLast = transportDays.at(-1) === rawDay;
      const share = isLast ? transportRemaining : Math.min(transportShare, transportRemaining);
      transportRemaining = Math.round(Math.max(0, transportRemaining - share) * 100) / 100;
      const total = transportTotal > 0 ? Math.round(share * 100) / 100 : null;
      items.push(baseItem({
        id: `itinerary:transport:${dayIndex}`,
        type: "transport",
        day_index: dayIndex,
        name: transportation,
        amount: total,
        traveler_count: travelers,
        per_person_amount: perPerson(total, travelers),
        calculation_summary: "shared_total",
        price_source: total === null ? "unavailable" : "estimated",
        linked_item_id: `day:${dayIndex}:transport`,
      }));
    }
  });

  items.push(...deriveHotelItems(days, travelers, rooms));
  return items;
}

function validSavedItem(value: unknown): value is BudgetLedgerItem {
  const item = record(value);
  return Boolean(item && typeof item.id === "string" && item.id && typeof item.name === "string"
    && ["attraction", "hotel", "meal", "transport", "other"].includes(String(item.type)));
}

export function syncBudgetItems(
  result: unknown,
  savedItems: unknown[] | null,
  travelerCount?: number,
  roomCount?: number,
): BudgetLedgerItem[] {
  const plan = record(record(result)?.data);
  const travelers = count(travelerCount ?? plan?.traveler_count);
  const saved = (savedItems ?? []).filter(validSavedItem).map((item) => ({
    ...structuredClone(item),
    price_provider: String(item.price_provider ?? ""),
  }));
  const byId = new Map(saved.map((item) => [item.id, item]));
  const derived = deriveBudgetItems(result, travelers, roomCount);
  const derivedIds = new Set(derived.map((item) => item.id));
  const merged = derived.map((item) => {
    const previous = byId.get(item.id);
    if (!previous?.user_locked) return item;
    previous.traveler_count = travelers;
    previous.per_person_amount = perPerson(previous.amount, travelers);
    previous.day_end_index = item.day_end_index;
    previous.room_count = item.room_count;
    previous.nights = item.nights;
    if (previous.price_source !== "user") {
      previous.unit_amount = item.unit_amount;
      previous.calculation_summary = item.calculation_summary;
    }
    return previous;
  });
  for (const item of saved) {
    if (!derivedIds.has(item.id) && (item.origin === "user" || item.user_locked)) {
      item.traveler_count = travelers;
      item.per_person_amount = perPerson(item.amount, travelers);
      merged.push(item);
    }
  }
  return merged.sort((left, right) => Number(left.deleted) - Number(right.deleted)
    || (left.day_index ?? 10_000) - (right.day_index ?? 10_000)
    || TYPE_ORDER[left.type] - TYPE_ORDER[right.type]
    || left.id.localeCompare(right.id));
}

export function calculateBudgetTotals(items: BudgetLedgerItem[]): BudgetTotals {
  const totals: BudgetTotals = {
    total_attractions: 0,
    total_hotels: 0,
    total_meals: 0,
    total_transportation: 0,
    total_inter_city_transport: 0,
    total_other: 0,
    total: 0,
  };
  const target: Record<BudgetItemType, keyof BudgetTotals> = {
    attraction: "total_attractions",
    hotel: "total_hotels",
    meal: "total_meals",
    transport: "total_transportation",
    other: "total_other",
  };
  for (const item of items) {
    if (item.deleted || item.amount === null) continue;
    const value = amount(item.amount);
    totals[target[item.type]] += value;
    totals.total += value;
  }
  for (const key of Object.keys(totals) as Array<keyof BudgetTotals>) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }
  return totals;
}

export function budgetLedgerResponse(planId: string, task: {
  result: unknown;
  request_payload: Record<string, unknown> | null;
  budget_items: unknown[] | null;
}): Record<string, unknown> {
  const plan = record(record(task.result)?.data) ?? {};
  const request = task.request_payload ?? {};
  const travelers = count(request.traveler_count ?? plan.traveler_count);
  const rooms = count(request.room_count ?? plan.room_count, Math.ceil(travelers / 2));
  const items = syncBudgetItems(task.result, task.budget_items, travelers, rooms);
  task.budget_items = items;
  const totals = calculateBudgetTotals(items);
  plan.budget = { ...(record(plan.budget) ?? {}), ...totals };
  const perPersonTotals = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, Math.round(value / travelers * 100) / 100]),
  );
  const rawLimit = Number(request.budget_amount ?? plan.budget_amount);
  const validLimit = Number.isFinite(rawLimit) && rawLimit > 0;
  const budgetLimit = validLimit
    ? Math.round(rawLimit * (String(request.budget_basis ?? plan.budget_basis) === "per_person" ? travelers : 1) * 100) / 100
    : null;
  const pending = items.filter((item) => !item.deleted && item.amount === null);
  const pendingBuffer = pending.reduce((sum, item) => {
    if (item.type === "hotel") return sum + 300 * (item.room_count ?? 1) * (item.nights ?? 1);
    const perTraveler = item.type === "meal" ? 80 : item.type === "transport" ? 50 : 100;
    return sum + perTraveler * travelers;
  }, 0);
  const quotedTotal = totals.total;
  const projectedTotal = Math.round((quotedTotal + pendingBuffer) * 100) / 100;
  return {
    plan_id: planId,
    items,
    totals,
    per_person_totals: perPersonTotals,
    traveler_count: travelers,
    room_count: rooms,
    pending_count: pending.length,
    budget_limit: budgetLimit,
    quoted_total: quotedTotal,
    over_budget_amount: budgetLimit === null ? 0 : Math.round(Math.max(0, quotedTotal - budgetLimit) * 100) / 100,
    pending_buffer: pendingBuffer,
    projected_total: projectedTotal,
    projected_over_budget_amount: budgetLimit === null ? 0 : Math.round(Math.max(0, projectedTotal - budgetLimit) * 100) / 100,
    adjustment_applied: Boolean(plan.budget_adjustment_applied),
    adjustment_note: String(plan.budget_adjustment_note ?? ""),
  };
}
