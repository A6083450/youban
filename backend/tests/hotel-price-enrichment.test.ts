import { describe, expect, it } from "bun:test";
import type { DayPlan, TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { enrichHotelPrices } from "../src/services/hotel-price-enrichment.ts";
import type { HotelPriceQuote, HotelPriceRequest, HotelPriceSource } from "../src/services/hotel-price-source.ts";

const REQUEST: TripPlanningRequest = {
  city: "大理",
  cities: [{ city: "大理", days: 4 }],
  start_date: "2026-10-01",
  end_date: "2026-10-04",
  travel_days: 4,
  transportation: "公共交通",
  accommodation: "舒适型酒店",
  traveler_count: 2,
  room_count: 1,
  preferences: ["自然风光"],
};

const QUOTE: HotelPriceQuote = {
  provider: "fliggy",
  hotel_name: "湖景酒店",
  nightly_price: 420,
  currency: "CNY",
  source_url: "https://router.feizhu.com/h/1",
  checked_at: "2026-08-26T03:00:00.000Z",
  method: "lowest_nightly_browse",
};

function day(date: string, dayIndex: number, city = "大理", hotelId: string | null = "H1"): DayPlan {
  return {
    date,
    day_index: dayIndex,
    city,
    description: "",
    transportation: "",
    accommodation: "舒适型酒店",
    hotel: hotelId === null ? null : {
      name: hotelId === "H1" ? "湖景酒店" : "古城酒店",
      poi_id: hotelId,
      source: "amap",
      source_hotel_id: hotelId,
      price_status: "unavailable",
    },
    attractions: [],
    meals: [],
  };
}

describe("enrichHotelPrices", () => {
  it("quotes one contiguous stay and applies its nightly reference to every night", async () => {
    const calls: HotelPriceRequest[] = [];
    const days = [
      day("2026-10-01", 0),
      day("2026-10-02", 1),
      day("2026-10-03", 2),
      day("2026-10-04", 3, "大理", null),
    ];
    const source: HotelPriceSource = {
      async quote(request) {
        calls.push(request);
        return QUOTE;
      },
    };

    const enriched = await enrichHotelPrices(days, REQUEST, source);

    expect(calls).toEqual([{
      hotelName: "湖景酒店",
      city: "大理",
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
      adults: 2,
    }]);
    expect(enriched.slice(0, 3).every((item) => item.hotel?.estimated_cost === 420)).toBeTrue();
    expect(enriched[0]!.hotel).toEqual(expect.objectContaining({
      source: "amap",
      source_hotel_id: "H1",
      price_source: "fliggy",
      price_status: "estimated",
      price_method: "lowest_nightly_browse",
      price_checked_at: "2026-08-26T03:00:00.000Z",
    }));
    expect(enriched[3]!.hotel).toBeNull();
    expect(days[0]!.hotel?.estimated_cost).toBeUndefined();
    expect(enriched[0]).not.toBe(days[0]);
  });

  it("quotes different hotel and city stays separately", async () => {
    const calls: HotelPriceRequest[] = [];
    const source: HotelPriceSource = {
      async quote(request) {
        calls.push(request);
        return { ...QUOTE, hotel_name: request.hotelName };
      },
    };
    const days = [
      day("2026-10-01", 0),
      day("2026-10-02", 1, "大理", "H2"),
      day("2026-10-03", 2, "丽江", "H2"),
      day("2026-10-04", 3, "丽江", null),
    ];

    await enrichHotelPrices(days, REQUEST, source);

    expect(calls).toHaveLength(3);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ hotelName: "湖景酒店", city: "大理", checkIn: "2026-10-01", checkOut: "2026-10-02" }),
      expect.objectContaining({ hotelName: "古城酒店", city: "大理", checkIn: "2026-10-02", checkOut: "2026-10-03" }),
      expect.objectContaining({ hotelName: "古城酒店", city: "丽江", checkIn: "2026-10-03", checkOut: "2026-10-04" }),
    ]));
  });

  it("preserves trusted hotel identity when the quote is unavailable or rejects", async () => {
    for (const source of [
      { async quote() { return null; } },
      { async quote() { throw new Error("provider unavailable"); } },
    ] satisfies HotelPriceSource[]) {
      const original = [day("2026-10-01", 0), day("2026-10-02", 1, "大理", null)];
      const enriched = await enrichHotelPrices(original, { ...REQUEST, traveler_count: 0 }, source);

      expect(enriched[0]!.hotel).toEqual(expect.objectContaining({
        name: "湖景酒店",
        source: "amap",
        source_hotel_id: "H1",
        price_status: "unavailable",
      }));
      expect(enriched[0]!.hotel?.price_source).toBeUndefined();
    }
  });

  it("does not call a source for departure days or when no source is configured", async () => {
    let calls = 0;
    const departure = [day("2026-10-04", 0, "大理", null)];
    const source: HotelPriceSource = {
      async quote() {
        calls += 1;
        return QUOTE;
      },
    };

    expect(await enrichHotelPrices(departure, REQUEST, source)).toEqual(departure);
    expect(await enrichHotelPrices([day("2026-10-01", 0)], REQUEST)).toEqual([day("2026-10-01", 0)]);
    expect(calls).toBe(0);
  });
});
