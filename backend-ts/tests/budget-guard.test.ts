import { describe, expect, it } from "bun:test";
import {
  adjustGeneratedDaysToBudget,
  calculateBudgetStatus,
  groupBudgetLimit,
} from "../src/domain/budget-guard.ts";
import type { BudgetLedgerItem } from "../src/domain/budget-ledger.ts";
import type { DayPlan, TripPlanningRequest } from "../src/domain/orchestrator.ts";

function request(budgetAmount = 1_000): TripPlanningRequest {
  return {
    city: "西安",
    cities: [{ city: "西安", days: 2 }],
    start_date: "2026-10-01",
    end_date: "2026-10-02",
    travel_days: 2,
    transportation: "公共交通",
    accommodation: "舒适商务",
    traveler_count: 2,
    room_count: 1,
    budget_amount: budgetAmount,
    budget_basis: "group_total",
    language: "zh",
    preferences: [],
  };
}

function day(index: number, mealCost = 100): DayPlan {
  return {
    date: `2026-10-0${index + 1}`,
    day_index: index,
    city: "西安",
    description: "测试",
    transportation: "地铁",
    accommodation: "舒适商务",
    hotel: null,
    attractions: [],
    meals: [
      { type: "lunch", name: "午餐", estimated_cost: mealCost },
      { type: "dinner", name: "晚餐", estimated_cost: mealCost },
    ],
  };
}

describe("budget guard", () => {
  it("normalizes group and per-person limits", () => {
    expect(groupBudgetLimit(1_200, "group_total", 3)).toBe(1_200);
    expect(groupBudgetLimit(1_200, "per_person", 3)).toBe(3_600);
    expect(groupBudgetLimit(null, "group_total", 3)).toBeNull();
  });

  it("separates current overage from pending buffer", () => {
    const item = {
      type: "transport",
      amount: null,
      deleted: false,
    } as BudgetLedgerItem;
    expect(calculateBudgetStatus(
      { total: 10_690 },
      [item],
      3,
      10_000,
      "group_total",
    )).toEqual(expect.objectContaining({
      over_budget_amount: 690,
      pending_buffer: 150,
      projected_total: 10_840,
      projected_over_budget_amount: 840,
    }));
  });

  it("reduces only meal estimates and reports the adjustment", () => {
    const days = [day(0), day(1)];
    const result = adjustGeneratedDaysToBudget(request(700), days);
    const before = days.flatMap((entry) => entry.meals).reduce((sum, meal) => sum + Number(meal.estimated_cost), 0);
    const after = result.days.flatMap((entry) => entry.meals).reduce((sum, meal) => sum + Number(meal.estimated_cost), 0);

    expect(result.budget_adjustment_applied).toBeTrue();
    expect(result.budget_adjustment_note).toContain("待报价项目预留");
    expect(after).toBeLessThan(before);
    expect(before).toBe(400);
    expect(days.flatMap((entry) => entry.meals).reduce((sum, meal) => sum + Number(meal.estimated_cost), 0)).toBe(400);
  });

  it("reports budget adjustments in French", () => {
    const frenchRequest = request(700);
    frenchRequest.language = "fr-FR";

    expect(adjustGeneratedDaysToBudget(frenchRequest, [day(0), day(1)]).budget_adjustment_note).toBe(
      "Les estimations des repas ont été réduites de ¥300 pour respecter le budget, avec ¥200 réservés aux éléments sans tarif.",
    );
  });

  it("falls an unsupported persisted locale back to Chinese", () => {
    const legacyRequest = request(700);
    legacyRequest.language = "xx-XX";

    expect(adjustGeneratedDaysToBudget(legacyRequest, [day(0), day(1)]).budget_adjustment_note).toBe(
      "已根据总预算将餐饮预估下调 ¥300，并为待报价项目预留 ¥200。",
    );
  });
});
