import { describe, expect, it } from "bun:test";
import { AmapResearchSources } from "../src/services/amap-research-sources.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AmapResearchSources", () => {
  it("degrades to empty results without a Web service key", async () => {
    let calls = 0;
    const sources = new AmapResearchSources({
      apiKey: "",
      fetch: async () => {
        calls += 1;
        return jsonResponse({ status: "1" });
      },
    });
    expect(await sources.searchAttractions("北京", ["人文"])).toEqual([]);
    expect(await sources.searchHotels("北京", "舒适型酒店")).toEqual([]);
    expect(await sources.getWeather("北京")).toEqual([]);
    expect(calls).toBe(0);
  });

  it("returns only trusted POIs with valid ids and coordinates", async () => {
    const urls: URL[] = [];
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return jsonResponse({
          status: "1",
          pois: [
            { id: "B001", name: "故宫博物院", address: "景山前街4号", location: "116.397,39.918", type: "风景名胜" },
            { id: "", name: "无来源景点", location: "116.3,39.9" },
            { id: "B003", name: "坏坐标", location: [] },
          ],
        });
      },
    });
    expect(await sources.searchAttractions("北京", ["历史", "博物馆"])).toEqual([{
      poi_id: "B001",
      name: "故宫博物院",
      address: "景山前街4号",
      type: "风景名胜",
      location: { longitude: 116.397, latitude: 39.918 },
    }]);
    expect(urls[0]?.pathname).toBe("/v5/place/text");
    expect(urls[0]?.searchParams.get("region")).toBe("北京");
    expect(urls[0]?.searchParams.get("city_limit")).toBe("true");
    expect(urls[0]?.searchParams.get("types")).toBe("110000");
  });

  it("searches hotels without inventing prices", async () => {
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      fetch: async () => jsonResponse({
        status: "1",
        pois: [{
          id: "H001",
          name: "城景酒店",
          address: "东路1号",
          location: "104.06,30.67",
          type: "住宿服务;宾馆酒店",
          business: { rating: "4.7", cost: "" },
        }],
      }),
    });
    expect(await sources.searchHotels("成都", "舒适型酒店")).toEqual([{
      poi_id: "H001",
      name: "城景酒店",
      address: "东路1号",
      type: "住宿服务;宾馆酒店",
      rating: 4.7,
      location: { longitude: 104.06, latitude: 30.67 },
    }]);
  });

  it("returns the first valid POI photo from the place detail fields", async () => {
    const urls: URL[] = [];
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      fetch: async (input) => {
        urls.push(new URL(String(input)));
        return jsonResponse({
          status: "1",
          pois: [{
            id: "B001",
            name: "西湖",
            photos: [
              { url: "" },
              { url: "https://example.com/west-lake.jpg" },
            ],
          }],
        });
      },
    });

    expect(await sources.getPoiPhoto("西湖", "杭州")).toBe("https://example.com/west-lake.jpg");
    expect(urls[0]?.pathname).toBe("/v5/place/text");
    expect(urls[0]?.searchParams.get("show_fields")).toBe("photos");
  });

  it("resolves an adcode before requesting forecast weather", async () => {
    const urls: URL[] = [];
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname === "/v3/config/district") {
          return jsonResponse({ status: "1", districts: [{ name: "北京市", adcode: "110000" }] });
        }
        return jsonResponse({
          status: "1",
          forecasts: [{
            city: "北京市",
            adcode: "110000",
            reporttime: "2026-08-21 11:00:00",
            casts: [{
              date: "2026-08-22",
              week: "6",
              dayweather: "晴",
              nightweather: "多云",
              daytemp: "31",
              nighttemp: "22",
              daywind: "南",
              nightwind: "南",
              daypower: "3",
              nightpower: "2",
            }],
          }],
        });
      },
    });
    expect(await sources.getWeather("北京")).toEqual([{
      city: "北京市",
      adcode: "110000",
      date: "2026-08-22",
      week: "6",
      day_weather: "晴",
      night_weather: "多云",
      day_temp: 31,
      night_temp: 22,
      day_wind: "南",
      night_wind: "南",
      day_power: "3",
      night_power: "2",
      report_time: "2026-08-21 11:00:00",
    }]);
    expect(urls.map((url) => url.pathname)).toEqual([
      "/v3/config/district",
      "/v3/weather/weatherInfo",
    ]);
    expect(urls[1]?.searchParams.get("city")).toBe("110000");
    expect(urls[1]?.searchParams.get("extensions")).toBe("all");
  });

  it("degrades transport, non-json, and upstream errors to empty results", async () => {
    const failing = new AmapResearchSources({
      apiKey: "web-key",
      fetch: async () => { throw new Error("offline"); },
    });
    expect(await failing.searchAttractions("西安", [])).toEqual([]);

    const rejected = new AmapResearchSources({
      apiKey: "web-key",
      fetch: async () => jsonResponse({ status: "0", info: "INVALID_USER_KEY" }, 200),
    });
    expect(await rejected.searchHotels("西安", "酒店")).toEqual([]);
    expect(await rejected.getWeather("西安")).toEqual([]);
  });
});
