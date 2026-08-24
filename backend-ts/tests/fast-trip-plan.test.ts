import { describe, expect, it } from "bun:test";
import { buildFastTripPlan } from "../src/domain/fast-trip-plan.ts";
import { emptyCheckpoint, type PlanningCheckpoint, type TripPlanningRequest } from "../src/domain/orchestrator.ts";

type FastPlanData = {
  days: Array<Record<string, any>>;
  weather_info: Array<Record<string, unknown>>;
  budget: Record<string, number>;
};

function request(
  cities: Array<{ city: string; days: number }>,
  startDate: string,
): TripPlanningRequest {
  const travelDays = cities.reduce((total, city) => total + city.days, 0);
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + travelDays - 1);
  return {
    city: cities[0]!.city,
    cities,
    start_date: startDate,
    end_date: end.toISOString().slice(0, 10),
    travel_days: travelDays,
    transportation: "公共交通",
    accommodation: "经济型酒店",
    traveler_count: 2,
    room_count: 1,
    preferences: ["历史文化"],
  };
}

function trustedCheckpoint(): PlanningCheckpoint {
  const checkpoint = emptyCheckpoint();
  checkpoint.search.attractions["北京"] = [
    {
      poi_id: "BJ-1",
      name: "故宫博物院",
      address: "北京市东城区景山前街4号",
      location: { longitude: 116.397, latitude: 39.918 },
      ticket_price: 60,
      visit_duration: 180,
    },
    {
      poi_id: "BJ-1",
      name: "重复故宫",
      address: "北京市东城区景山前街4号",
      location: { longitude: 116.397, latitude: 39.918 },
      ticket_price: 60,
    },
    {
      poi_id: "BJ-2",
      name: "景山公园",
      address: "北京市西城区景山西街44号",
      location: { longitude: 116.403, latitude: 39.924 },
      ticket_price: 2,
      visit_duration: 90,
    },
  ];
  checkpoint.search.attractions["西安"] = [{
    poi_id: "XA-1",
    name: "西安城墙",
    address: "西安市碑林区南大街2号",
    location: { longitude: 108.948, latitude: 34.258 },
    ticket_price: 54,
    visit_duration: 120,
  }];
  checkpoint.search.weather["北京"] = [
    { date: "2026-02-25", city: "北京", day_weather: "晴", day_temp: 8 },
  ];
  return checkpoint;
}

function dataFor(request: TripPlanningRequest, checkpoint: unknown): FastPlanData {
  return (buildFastTripPlan(request, checkpoint).data as FastPlanData);
}

function expectDailyBasics(data: FastPlanData) {
  for (const day of data.days) {
    expect(day.transportation).toBe("公共交通");
    expect(day.accommodation).toBe("经济型酒店");
    expect(day.meals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "breakfast" }),
      expect.objectContaining({ type: "lunch" }),
      expect.objectContaining({ type: "dinner" }),
    ]));
  }
}

describe("deterministic fast trip plan", () => {
  it("builds exact 7-day dates, indices, and city stays from trusted facts", () => {
    const plan = dataFor(request([
      { city: "北京", days: 3 },
      { city: "西安", days: 4 },
    ], "2026-02-25"), trustedCheckpoint());

    expect(plan.days.map(({ day_index, date, city }) => ({ day_index, date, city }))).toEqual([
      { day_index: 0, date: "2026-02-25", city: "北京" },
      { day_index: 1, date: "2026-02-26", city: "北京" },
      { day_index: 2, date: "2026-02-27", city: "北京" },
      { day_index: 3, date: "2026-02-28", city: "西安" },
      { day_index: 4, date: "2026-03-01", city: "西安" },
      { day_index: 5, date: "2026-03-02", city: "西安" },
      { day_index: 6, date: "2026-03-03", city: "西安" },
    ]);
    expectDailyBasics(plan);
    const poiIds = plan.days.flatMap((day) => day.attractions.map((item: { poi_id: string }) => item.poi_id));
    expect(poiIds).toEqual(["BJ-1", "BJ-2", "XA-1"]);
    expect(new Set(poiIds).size).toBe(poiIds.length);
    expect(plan.weather_info).toEqual([
      { date: "2026-02-25", city: "北京", day_weather: "晴", day_temp: 8 },
    ]);
    expect(plan.budget).toEqual({
      total_attractions: 232,
      total_hotels: 0,
      total_meals: 0,
      total_transportation: 0,
      total_inter_city_transport: 0,
      total: 232,
    });
  });

  it("builds exact 15-day dates, indices, and city stays without checkpoint facts", () => {
    const plan = dataFor(request([
      { city: "杭州", days: 7 },
      { city: "苏州", days: 8 },
    ], "2026-04-01"), emptyCheckpoint());

    expect(plan.days.map(({ day_index, date, city }) => ({ day_index, date, city }))).toEqual([
      { day_index: 0, date: "2026-04-01", city: "杭州" }, { day_index: 1, date: "2026-04-02", city: "杭州" },
      { day_index: 2, date: "2026-04-03", city: "杭州" }, { day_index: 3, date: "2026-04-04", city: "杭州" },
      { day_index: 4, date: "2026-04-05", city: "杭州" }, { day_index: 5, date: "2026-04-06", city: "杭州" },
      { day_index: 6, date: "2026-04-07", city: "杭州" }, { day_index: 7, date: "2026-04-08", city: "苏州" },
      { day_index: 8, date: "2026-04-09", city: "苏州" }, { day_index: 9, date: "2026-04-10", city: "苏州" },
      { day_index: 10, date: "2026-04-11", city: "苏州" }, { day_index: 11, date: "2026-04-12", city: "苏州" },
      { day_index: 12, date: "2026-04-13", city: "苏州" }, { day_index: 13, date: "2026-04-14", city: "苏州" },
      { day_index: 14, date: "2026-04-15", city: "苏州" },
    ]);
    expectDailyBasics(plan);
    expect(plan.days.every((day) => day.attractions.length === 0)).toBeTrue();
    expect(plan.weather_info).toEqual([]);
    expect(plan.budget.total).toBe(0);
  });

  it("builds exact 30-day dates, indices, and city stays without inventing facts", () => {
    const plan = dataFor(request([
      { city: "昆明", days: 15 },
      { city: "大理", days: 15 },
    ], "2026-06-01"), emptyCheckpoint());

    expect(plan.days.map(({ day_index, date, city }) => ({ day_index, date, city }))).toEqual([
      { day_index: 0, date: "2026-06-01", city: "昆明" }, { day_index: 1, date: "2026-06-02", city: "昆明" },
      { day_index: 2, date: "2026-06-03", city: "昆明" }, { day_index: 3, date: "2026-06-04", city: "昆明" },
      { day_index: 4, date: "2026-06-05", city: "昆明" }, { day_index: 5, date: "2026-06-06", city: "昆明" },
      { day_index: 6, date: "2026-06-07", city: "昆明" }, { day_index: 7, date: "2026-06-08", city: "昆明" },
      { day_index: 8, date: "2026-06-09", city: "昆明" }, { day_index: 9, date: "2026-06-10", city: "昆明" },
      { day_index: 10, date: "2026-06-11", city: "昆明" }, { day_index: 11, date: "2026-06-12", city: "昆明" },
      { day_index: 12, date: "2026-06-13", city: "昆明" }, { day_index: 13, date: "2026-06-14", city: "昆明" },
      { day_index: 14, date: "2026-06-15", city: "昆明" }, { day_index: 15, date: "2026-06-16", city: "大理" },
      { day_index: 16, date: "2026-06-17", city: "大理" }, { day_index: 17, date: "2026-06-18", city: "大理" },
      { day_index: 18, date: "2026-06-19", city: "大理" }, { day_index: 19, date: "2026-06-20", city: "大理" },
      { day_index: 20, date: "2026-06-21", city: "大理" }, { day_index: 21, date: "2026-06-22", city: "大理" },
      { day_index: 22, date: "2026-06-23", city: "大理" }, { day_index: 23, date: "2026-06-24", city: "大理" },
      { day_index: 24, date: "2026-06-25", city: "大理" }, { day_index: 25, date: "2026-06-26", city: "大理" },
      { day_index: 26, date: "2026-06-27", city: "大理" }, { day_index: 27, date: "2026-06-28", city: "大理" },
      { day_index: 28, date: "2026-06-29", city: "大理" }, { day_index: 29, date: "2026-06-30", city: "大理" },
    ]);
    expectDailyBasics(plan);
    expect(plan.days.every((day) => day.attractions.length === 0)).toBeTrue();
    expect(plan.days.flatMap((day) => day.meals).every((meal) => meal.estimated_cost === undefined)).toBeTrue();
    expect(plan.weather_info).toEqual([]);
    expect(plan.budget).toEqual({
      total_attractions: 0,
      total_hotels: 0,
      total_meals: 0,
      total_transportation: 0,
      total_inter_city_transport: 0,
      total: 0,
    });
  });
});
