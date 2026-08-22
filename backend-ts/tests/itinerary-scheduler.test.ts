import { describe, expect, it } from "bun:test";
import { recommendVisitTimes } from "../src/domain/itinerary-scheduler.ts";
import type { DayPlan } from "../src/domain/orchestrator.ts";

function attraction(name: string, visitDuration = 120, overrides: Record<string, unknown> = {}) {
  return {
    name,
    address: "测试地址",
    location: { longitude: 113.26, latitude: 23.14 },
    visit_duration: visitDuration,
    description: "户外漫步",
    ...overrides,
  };
}

function day(attractions: Array<Record<string, unknown>>, values: Partial<DayPlan> = {}): DayPlan {
  return {
    date: "2026-09-10",
    day_index: 0,
    city: "广州",
    description: "全天游览",
    transportation: "公共交通",
    accommodation: "经济型酒店",
    attractions,
    meals: [],
    ...values,
  } as DayPlan;
}

describe("itinerary scheduler", () => {
  it("fills missing times and marks non-live sources", () => {
    const result = recommendVisitTimes([day([
      attraction("越秀公园"),
      attraction("沙面岛", 150),
    ], { description: "抵达广州，下午游览越秀公园，傍晚前往沙面岛" })])[0]!;

    expect(result.attractions[0]).toEqual(expect.objectContaining({
      start_time: "15:30",
      end_time: "17:30",
      time_recommendation_basis: "seasonal",
      crowd_recommendation_basis: "heuristic",
    }));
    expect(result.attractions[1]).toEqual(expect.objectContaining({
      start_time: "18:00",
      end_time: "20:30",
    }));
  });

  it("uses forecast basis and avoids hot afternoon for the first outdoor stop", () => {
    const result = recommendVisitTimes([day([attraction("越秀公园")])], [{
      date: "2026-09-10",
      city: "广州",
      day_weather: "晴",
      night_weather: "多云",
      day_temp: 34,
      night_temp: 27,
    }])[0]!.attractions[0]!;

    expect(result.start_time).toBe("08:00");
    expect(result.time_recommendation_basis).toBe("weather");
  });

  it("preserves a user time and only derives its missing end", () => {
    const result = recommendVisitTimes([day([
      attraction("越秀公园", 120, { start_time: "10:00" }),
    ])])[0]!.attractions[0]!;

    expect(result.start_time).toBe("10:00");
    expect(result.end_time).toBe("12:00");
    expect(result.time_recommendation_basis).toBeUndefined();
    expect(result.crowd_recommendation_basis).toBeUndefined();
  });

  it("schedules missing meals around attractions", () => {
    const result = recommendVisitTimes([day([
      attraction("越秀公园"),
      attraction("沙面岛", 150),
    ], {
      description: "抵达广州，下午游览越秀公园，傍晚前往沙面岛",
      meals: [
        { type: "lunch", name: "午餐", estimated_cost: 50 },
        { type: "dinner", name: "晚餐", estimated_cost: 80 },
      ],
    })])[0]!;

    expect(result.meals[0]).toEqual(expect.objectContaining({ time: "12:30" }));
    expect(result.meals[1]).toEqual(expect.objectContaining({
      time: "21:00",
      time_recommendation_basis: "schedule",
    }));
  });
});
