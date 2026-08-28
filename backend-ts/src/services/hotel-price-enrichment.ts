import type { DayPlan, TripPlanningRequest } from "../domain/orchestrator.ts";
import type { HotelPriceQuote, HotelPriceRequest, HotelPriceSource } from "./hotel-price-source.ts";

interface HotelStay {
  indices: number[];
  request: HotelPriceRequest;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addUtcDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function hotelIdentity(day: DayPlan): string | null {
  if (!record(day.hotel)) return null;
  const source = String(day.hotel.source ?? "").trim();
  const sourceHotelId = String(day.hotel.source_hotel_id ?? "").trim();
  return source && sourceHotelId ? `${day.city}\u0000${source}\u0000${sourceHotelId}` : null;
}

function buildStays(days: DayPlan[], request: TripPlanningRequest): HotelStay[] {
  const stays: HotelStay[] = [];
  const adults = Math.max(1, Math.floor(Number(request.traveler_count) || 1));
  let index = 0;
  while (index < days.length) {
    const first = days[index]!;
    const identity = hotelIdentity(first);
    if (!identity || !record(first.hotel)) {
      index += 1;
      continue;
    }
    const indices = [index];
    let last = index;
    while (
      last + 1 < days.length
      && hotelIdentity(days[last + 1]!) === identity
      && days[last + 1]!.date === addUtcDay(days[last]!.date)
    ) {
      last += 1;
      indices.push(last);
    }
    stays.push({
      indices,
      request: {
        hotelName: String(first.hotel.name ?? "").trim(),
        city: first.city,
        checkIn: first.date,
        checkOut: addUtcDay(days[last]!.date),
        adults,
      },
    });
    index = last + 1;
  }
  return stays.filter((stay) => stay.request.hotelName.length > 0);
}

function requestKey(request: HotelPriceRequest): string {
  return JSON.stringify(request);
}

async function quoteStays(
  stays: HotelStay[],
  source: HotelPriceSource,
): Promise<Map<string, HotelPriceQuote | null>> {
  const unique = new Map(stays.map((stay) => [requestKey(stay.request), stay.request]));
  const entries = [...unique.entries()];
  const results = new Map<string, HotelPriceQuote | null>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
    while (cursor < entries.length) {
      const [key, request] = entries[cursor++]!;
      const quote = await source.quote(request).catch(() => null);
      results.set(key, quote);
    }
  }));
  return results;
}

export async function enrichHotelPrices(
  days: DayPlan[],
  request: TripPlanningRequest,
  source?: HotelPriceSource,
): Promise<DayPlan[]> {
  const enriched = structuredClone(days);
  if (!source) return enriched;
  const stays = buildStays(enriched, request);
  if (stays.length === 0) return enriched;
  const quotes = await quoteStays(stays, source);
  for (const stay of stays) {
    const quote = quotes.get(requestKey(stay.request));
    if (!quote) continue;
    for (const index of stay.indices) {
      const hotel = enriched[index]!.hotel;
      if (!record(hotel)) continue;
      Object.assign(hotel, {
        estimated_cost: quote.nightly_price,
        price_source: quote.provider,
        source_url: quote.source_url,
        price_checked_at: quote.checked_at,
        price_method: quote.method,
        price_status: "estimated",
      });
    }
  }
  return enriched;
}
