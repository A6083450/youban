import { describe, expect, it } from "bun:test";
import { applyTripDraftPatch } from "../src/domain/trip-draft-patch.ts";

const draft = {
  city: "大理",
  cities: [
    { city: "大理", days: 2 },
    { city: "丽江", days: 3 },
  ],
  start_date: "2026-10-01",
  end_date: "2026-10-05",
  travel_days: 5,
  transportation: "公共交通",
  accommodation: "经济型酒店",
  traveler_count: 1,
  room_count: 1,
  preferences: ["自然风光"],
};

describe("applyTripDraftPatch", () => {
  it("changes only the explicitly patched traveler field", () => {
    const updated = applyTripDraftPatch(draft, { traveler_count: 2 }, "2026-08-25");

    expect(updated).toEqual({ ...draft, traveler_count: 2 });
    expect(updated?.room_count).toBe(1);
  });

  it("rebalances city stays and derived dates when total days changes", () => {
    const updated = applyTripDraftPatch(draft, { travel_days: 7 }, "2026-08-25");

    expect(updated).toEqual(expect.objectContaining({
      travel_days: 7,
      start_date: "2026-10-01",
      end_date: "2026-10-07",
    }));
    expect((updated?.cities as Array<{ days: number }>).reduce((sum, city) => sum + city.days, 0)).toBe(7);
    expect(updated?.traveler_count).toBe(1);
  });

  it("applies multiple independent fields in one Agent decision", () => {
    const updated = applyTripDraftPatch(draft, {
      traveler_count: 2,
      room_count: 1,
      transportation: "自驾",
      preferences: ["自然风光", "摄影"],
    }, "2026-08-25");

    expect(updated).toEqual(expect.objectContaining({
      traveler_count: 2,
      room_count: 1,
      transportation: "自驾",
      preferences: ["自然风光", "摄影"],
    }));
  });

  it("rejects empty, invalid, and no-op patches", () => {
    expect(applyTripDraftPatch(draft, {}, "2026-08-25")).toBeNull();
    expect(applyTripDraftPatch(draft, { traveler_count: 0 }, "2026-08-25")).toBeNull();
    expect(applyTripDraftPatch(draft, { traveler_count: 1 }, "2026-08-25")).toBeNull();
  });
});
