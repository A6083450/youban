import { describe, expect, it } from "bun:test";
import { FliggyHotelPriceSource } from "../src/services/fliggy-hotel-price-source.ts";

const REQUEST = {
  hotelName: "上海外滩华尔道夫",
  city: "上海",
  checkIn: "2026-09-10",
  checkOut: "2026-09-11",
  adults: 2,
};

function hotelResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    data: {
      itemList: [{
        name: "上海外滩华尔道夫酒店",
        price: "¥2,480",
        detailUrl: "https://router.feizhu.com/hotel/1",
        ...overrides,
      }],
    },
  });
}

describe("FliggyHotelPriceSource", () => {
  it("returns a normalized exact Fliggy nightly quote", async () => {
    let body: Record<string, unknown> = {};
    let token = "";
    const source = new FliggyHotelPriceSource({
      token: "test-token",
      now: () => new Date("2026-08-26T03:00:00.000Z"),
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        token = new Headers(init?.headers).get("X-Proxy-Token") ?? "";
        return hotelResponse();
      },
    });

    expect(await source.quote(REQUEST)).toEqual({
      provider: "fliggy",
      hotel_name: "上海外滩华尔道夫酒店",
      nightly_price: 2480,
      currency: "CNY",
      source_url: "https://router.feizhu.com/hotel/1",
      checked_at: "2026-08-26T03:00:00.000Z",
      method: "lowest_nightly_browse",
    });
    expect(token).toBe("test-token");
    expect(body).toEqual({
      type: "search_hotels",
      params: {
        destName: "上海",
        checkInDate: "2026-09-10",
        checkOutDate: "2026-09-11",
        keyWords: "上海外滩华尔道夫",
        adultCount: 2,
      },
    });
  });

  it("chooses the lowest valid matching nightly price", async () => {
    const source = new FliggyHotelPriceSource({
      token: "test-token",
      fetch: async () => Response.json({ data: { itemList: [
        {
          name: "上海外滩华尔道夫酒店",
          price: "¥2,680",
          detailUrl: "https://router.feizhu.com/hotel/expensive",
        },
        {
          name: "上海外滩华尔道夫大酒店",
          price: "¥2,480",
          detailUrl: "https://router.feizhu.com/hotel/lowest",
        },
      ] } }),
    });

    expect((await source.quote(REQUEST))?.nightly_price).toBe(2480);
  });

  it("returns null without making a request when the token is missing", async () => {
    let calls = 0;
    const source = new FliggyHotelPriceSource({
      token: "",
      fetch: async () => {
        calls += 1;
        return hotelResponse();
      },
    });

    expect(await source.quote(REQUEST)).toBeNull();
    expect(calls).toBe(0);
  });

  for (const [name, response] of [
    ["zero price", hotelResponse({ price: "¥0" })],
    ["non-numeric price", hotelResponse({ price: "待定" })],
    ["non-HTTPS detail link", hotelResponse({ detailUrl: "http://router.feizhu.com/hotel/1" })],
    ["low-similarity hotel name", hotelResponse({ name: "上海浦东机场快捷酒店" })],
    ["malformed payload", Response.json({ data: { itemList: "invalid" } })],
  ] as const) {
    it(`rejects a ${name}`, async () => {
      const source = new FliggyHotelPriceSource({
        token: "test-token",
        fetch: async () => response.clone(),
      });

      expect(await source.quote(REQUEST)).toBeNull();
    });
  }

  it("degrades HTTP, JSON, and timeout failures to no quote", async () => {
    const failures: Array<() => Promise<Response>> = [
      async () => new Response("upstream failure", { status: 503 }),
      async () => new Response("not-json", { status: 200 }),
      async () => { throw new DOMException("timed out", "AbortError"); },
    ];

    for (const fetchFailure of failures) {
      const source = new FliggyHotelPriceSource({ token: "test-token", fetch: fetchFailure });
      expect(await source.quote(REQUEST)).toBeNull();
    }
  });

  it("caches both successful and unavailable lookups", async () => {
    let successCalls = 0;
    const success = new FliggyHotelPriceSource({
      token: "test-token",
      fetch: async () => {
        successCalls += 1;
        return hotelResponse();
      },
    });
    await success.quote(REQUEST);
    await success.quote(REQUEST);
    expect(successCalls).toBe(1);

    let unavailableCalls = 0;
    const unavailable = new FliggyHotelPriceSource({
      token: "test-token",
      fetch: async () => {
        unavailableCalls += 1;
        return new Response("upstream failure", { status: 503 });
      },
    });
    await unavailable.quote(REQUEST);
    await unavailable.quote(REQUEST);
    expect(unavailableCalls).toBe(1);
  });

  it("expires cache entries after the configured TTL", async () => {
    let now = new Date("2026-08-26T03:00:00.000Z");
    let calls = 0;
    const source = new FliggyHotelPriceSource({
      token: "test-token",
      cacheTtlMs: 1_000,
      now: () => now,
      fetch: async () => {
        calls += 1;
        return hotelResponse();
      },
    });

    await source.quote(REQUEST);
    now = new Date("2026-08-26T03:00:02.000Z");
    await source.quote(REQUEST);
    expect(calls).toBe(2);
  });
});
