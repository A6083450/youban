import { describe, expect, it } from "bun:test";
import {
  allocateSegmentCandidates,
  buildBudget,
  buildSegments,
  buildWeatherInfo,
  duplicateAttractionIssues,
  emptyCheckpoint,
  mergeSegmentDays,
  normalizeCheckpoint,
  type DayPlan,
  type TripPlanningRequest,
} from "../src/domain/orchestrator.ts";

function request(days: number, cities = [{ city: "北京", days }]): TripPlanningRequest {
  const start = new Date("2026-08-01T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days - 1);
  return {
    city: cities[0]!.city,
    cities,
    start_date: "2026-08-01",
    end_date: end.toISOString().slice(0, 10),
    travel_days: days,
    transportation: "公共交通",
    accommodation: "经济型酒店",
    traveler_count: 1,
    room_count: 1,
    preferences: [],
  };
}

function day(dayIndex: number, city = "北京"): DayPlan {
  return {
    date: `2026-08-${String(dayIndex + 1).padStart(2, "0")}`,
    day_index: dayIndex,
    city,
    description: "当日行程",
    transportation: "公共交通",
    accommodation: "经济型酒店",
    hotel: { name: "测试酒店", estimated_cost: 300 },
    attractions: [{ name: `景点${dayIndex}`, poi_id: `poi-${dayIndex}`, ticket_price: 20 }],
    meals: [{ type: "lunch", name: "测试餐厅", estimated_cost: 80 }],
  };
}

describe("deterministic trip orchestrator", () => {
  it("partitions days into balanced configurable segments without crossing city boundaries", () => {
    expect(buildSegments(request(1)).map((segment) => segment.day_indices.length)).toEqual([1]);
    expect(buildSegments(request(4)).map((segment) => segment.day_indices.length)).toEqual([4]);
    expect(buildSegments(request(7)).map((segment) => segment.day_indices.length)).toEqual([4, 3]);
    expect(buildSegments(request(7), 3).map((segment) => segment.day_indices.length)).toEqual([3, 2, 2]);
    const multi = buildSegments(request(7, [{ city: "北京", days: 3 }, { city: "西安", days: 4 }]));
    expect(multi.map((segment) => segment.city)).toEqual(["北京", "西安"]);
    expect(multi.map((segment) => segment.day_indices)).toEqual([[0, 1, 2], [3, 4, 5, 6]]);
    expect(() => buildSegments(request(3, [{ city: "北京", days: 2 }]))).toThrow("travel_days");
  });

  it("allocates disjoint weighted candidate pools to parallel city segments", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      poi_id: `poi-${index}`,
      name: `景点${index}`,
      address: "北京",
      location: { longitude: 116 + index / 1000, latitude: 39.9 },
    }));
    const allocated = allocateSegmentCandidates(buildSegments(request(7), 3), { 北京: candidates });
    const pools = allocated.map((segment) => segment.attraction_candidate_ids ?? []);
    expect(pools.map((pool) => pool.length)).toEqual([5, 4, 3]);
    expect(new Set(pools.flat()).size).toBe(12);
  });

  it("normalizes interrupted checkpoints and rejects shape drift", () => {
    const checkpoint = emptyCheckpoint();
    checkpoint.segments["seg-01"] = {
      day_indices: [0],
      status: "processing",
      output: [],
      attempts: 2,
      error: "interrupted",
    };
    expect(normalizeCheckpoint(checkpoint).segments["seg-01"]?.status).toBe("pending");
    expect(normalizeCheckpoint({ ...checkpoint, version: 2 })).toEqual(emptyCheckpoint());
    expect(normalizeCheckpoint({ ...checkpoint, future: true })).toEqual(emptyCheckpoint());
  });

  it("merges completed segment output in day order and validates date/city coverage", () => {
    const trip = request(2, [{ city: "北京", days: 1 }, { city: "西安", days: 1 }]);
    const segments = buildSegments(trip);
    const checkpoint = emptyCheckpoint();
    checkpoint.segments["seg-02"] = { day_indices: [1], status: "completed", output: [day(1, "西安")], attempts: 1, error: "" };
    checkpoint.segments["seg-01"] = { day_indices: [0], status: "completed", output: [day(0)], attempts: 1, error: "" };
    expect(mergeSegmentDays(trip, segments, checkpoint).map((entry) => entry.day_index)).toEqual([0, 1]);

    checkpoint.segments["seg-02"]!.output[0] = { ...day(1), city: "北京" };
    expect(() => mergeSegmentDays(trip, segments, checkpoint)).toThrow("城市");
  });

  it("marks only later duplicate POIs for repair", () => {
    const trip = request(4);
    const days = [day(0), day(1), day(2), day(3)];
    days[0]!.attractions[0] = { name: "莫高窟", poi_id: "amap-mogao", ticket_price: 0 };
    days[2]!.attractions[0] = { name: "莫高窟景区", poi_id: "amap-mogao", ticket_price: 0 };
    const issues = duplicateAttractionIssues(days, buildSegments(trip, 3));
    expect(Object.keys(issues)).toEqual(["seg-02"]);
    expect(issues["seg-02"]?.[0]).toContain("D3");
    expect(issues["seg-02"]?.[0]).toContain("D1");
  });

  it("computes only modeled costs and filters weather to the trip range", () => {
    const budget = buildBudget([day(0)], 2, 1);
    expect(budget).toEqual({
      total_attractions: 40,
      total_hotels: 300,
      total_meals: 160,
      total_transportation: 0,
      total_inter_city_transport: 0,
      total: 500,
    });
    expect(buildWeatherInfo(request(2), {
      北京: [
        { date: "2026-08-02", city: "北京", day_weather: "晴" },
        { date: "2026-08-01", city: "北京", day_temp: "30°C" },
        { date: "2026-08-01", city: "重复" },
        { date: "2026-08-10", city: "越界" },
        { broken: true },
      ],
    })).toEqual([
      { date: "2026-08-01", city: "北京", day_temp: "30°C" },
      { date: "2026-08-02", city: "北京", day_weather: "晴" },
    ]);
  });
});
