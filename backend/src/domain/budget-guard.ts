import type { BudgetLedgerItem, BudgetTotals } from "./budget-ledger.ts";
import type { DayPlan, TripPlanningRequest } from "./orchestrator.ts";

const TRANSPORT_BUFFER_PER_PERSON = 50;
const HOTEL_BUFFER_PER_ROOM_NIGHT = 300;
const PENDING_BUFFER_PER_PERSON = { attraction: 100, meal: 80, transport: 50, other: 100 } as const;
const MEAL_FLOOR_PER_PERSON: Record<string, number> = { breakfast: 15, lunch: 30, dinner: 40, snack: 15 };

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function positiveCount(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.trunc(numeric)) : fallback;
}

export function groupBudgetLimit(
  budgetAmount: unknown,
  budgetBasis: unknown,
  travelerCount: number,
): number | null {
  if (budgetAmount === null || budgetAmount === undefined || budgetAmount === "") return null;
  const amount = Number(budgetAmount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return rounded(amount * (budgetBasis === "per_person" ? positiveCount(travelerCount) : 1));
}

export function pendingBudgetBuffer(items: BudgetLedgerItem[], travelerCount: number): number {
  const travelers = positiveCount(travelerCount);
  return rounded(items.reduce((total, item) => {
    if (item.deleted || item.amount !== null) return total;
    if (item.type === "hotel") {
      return total + HOTEL_BUFFER_PER_ROOM_NIGHT
        * positiveCount(item.room_count)
        * positiveCount(item.nights);
    }
    return total + (PENDING_BUFFER_PER_PERSON[item.type as keyof typeof PENDING_BUFFER_PER_PERSON] ?? 100)
      * travelers;
  }, 0));
}

export function calculateBudgetStatus(
  totals: Pick<BudgetTotals, "total">,
  items: BudgetLedgerItem[],
  travelerCount: number,
  budgetAmount: unknown,
  budgetBasis: unknown,
  adjustment = { applied: false, note: "" },
): Record<string, number | boolean | string | null> {
  const limit = groupBudgetLimit(budgetAmount, budgetBasis, travelerCount);
  const quotedTotal = rounded(Number(totals.total || 0));
  const pendingBuffer = pendingBudgetBuffer(items, travelerCount);
  const projectedTotal = rounded(quotedTotal + pendingBuffer);
  return {
    budget_limit: limit,
    quoted_total: quotedTotal,
    over_budget_amount: limit === null ? 0 : rounded(Math.max(0, quotedTotal - limit)),
    pending_buffer: pendingBuffer,
    projected_total: projectedTotal,
    projected_over_budget_amount: limit === null ? 0 : rounded(Math.max(0, projectedTotal - limit)),
    adjustment_applied: adjustment.applied,
    adjustment_note: adjustment.note,
  };
}

function knownTotal(days: DayPlan[], travelers: number, rooms: number): number {
  return rounded(days.reduce((total, day) => total
    + day.attractions.reduce((sum, attraction) => sum + Math.max(0, Number(attraction.ticket_price ?? 0)) * travelers, 0)
    + day.meals.reduce((sum, meal) => sum + Math.max(0, Number(meal.estimated_cost ?? 0)) * travelers, 0)
    + (day.hotel && String(day.hotel.price_status ?? "") !== "unavailable"
      ? Math.max(0, Number(day.hotel.estimated_cost ?? 0)) * rooms
      : 0), 0));
}

function planPendingBuffer(days: DayPlan[], travelers: number, rooms: number): number {
  const transportRows = days.filter((day) => day.transportation.trim()).length;
  const unavailableHotels = days.filter((day) => day.hotel && day.hotel.price_status === "unavailable").length;
  return rounded(transportRows * TRANSPORT_BUFFER_PER_PERSON * travelers
    + unavailableHotels * HOTEL_BUFFER_PER_ROOM_NIGHT * rooms);
}

function adjustmentNote(language: unknown, reduction: number, buffer: number): string {
  const code = String(language ?? "zh").trim().toLocaleLowerCase("und").split("-")[0];
  if (code === "en") return `Meal estimates were reduced by ¥${reduction} to respect the budget, with ¥${buffer} reserved for unquoted items.`;
  if (code === "fr") return `Les estimations des repas ont été réduites de ¥${reduction} pour respecter le budget, avec ¥${buffer} réservés aux éléments sans tarif.`;
  return `已根据总预算将餐饮预估下调 ¥${reduction}，并为待报价项目预留 ¥${buffer}。`;
}

export function adjustGeneratedDaysToBudget(request: TripPlanningRequest, sourceDays: DayPlan[]): {
  days: DayPlan[];
  budget_adjustment_applied: boolean;
  budget_adjustment_note: string;
} {
  const days = structuredClone(sourceDays);
  const travelers = positiveCount(request.traveler_count);
  const rooms = positiveCount(request.room_count, Math.ceil(travelers / 2));
  const limit = groupBudgetLimit(request.budget_amount, request.budget_basis, travelers);
  const buffer = planPendingBuffer(days, travelers, rooms);
  const originalTotal = knownTotal(days, travelers, rooms);
  if (limit === null || originalTotal + buffer <= limit) {
    return { days, budget_adjustment_applied: false, budget_adjustment_note: "" };
  }

  let remaining = originalTotal + buffer - limit;
  const meals = days.flatMap((day) => day.meals).sort((left, right) => {
    const leftCost = Number(left.estimated_cost ?? 0);
    const rightCost = Number(right.estimated_cost ?? 0);
    const leftFloor = MEAL_FLOOR_PER_PERSON[left.type.toLocaleLowerCase("und")] ?? 20;
    const rightFloor = MEAL_FLOOR_PER_PERSON[right.type.toLocaleLowerCase("und")] ?? 20;
    return (rightCost - rightFloor) - (leftCost - leftFloor) || rightCost - leftCost;
  });
  for (const meal of meals) {
    if (remaining <= 0) break;
    const floor = MEAL_FLOOR_PER_PERSON[meal.type.toLocaleLowerCase("und")] ?? 20;
    const current = Number(meal.estimated_cost ?? 0);
    const reducible = Math.max(0, current - floor);
    const reductionPerPerson = Math.min(reducible, Math.ceil(remaining / travelers));
    if (reductionPerPerson <= 0) continue;
    meal.estimated_cost = current - reductionPerPerson;
    remaining = Math.max(0, remaining - reductionPerPerson * travelers);
  }
  const reduction = rounded(Math.max(0, originalTotal - knownTotal(days, travelers, rooms)));
  const applied = reduction > 0;
  return {
    days,
    budget_adjustment_applied: applied,
    budget_adjustment_note: applied ? adjustmentNote(request.language, reduction, buffer) : "",
  };
}
