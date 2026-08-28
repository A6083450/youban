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
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname === "/v3/config/district") {
          return jsonResponse({ status: "1", districts: [{ name: "北京市", adcode: "110000" }] });
        }
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
    expect(urls.at(-1)?.pathname).toBe("/v5/place/text");
    expect(urls.at(-1)?.searchParams.get("region")).toBe("110000");
    expect(urls.at(-1)?.searchParams.get("city_limit")).toBe("true");
    expect(urls.at(-1)?.searchParams.get("types")).toBe("110000");
  });

  it("falls back to a focused preference query when the combined attraction query is empty", async () => {
    const placeQueries: string[] = [];
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      minimumRequestIntervalMs: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/v3/config/district") {
          return jsonResponse({ status: "1", districts: [{ name: "成都市", adcode: "510100" }] });
        }
        const keywords = url.searchParams.get("keywords") ?? "";
        placeQueries.push(keywords);
        if (keywords !== "大熊猫") return jsonResponse({ status: "1", pois: [] });
        return jsonResponse({
          status: "1",
          pois: [{
            id: "B0PANDA",
            name: "成都大熊猫繁育研究基地",
            address: "熊猫大道1375号",
            location: "104.145,30.740",
            type: "风景名胜",
          }],
        });
      },
    });

    expect(await sources.searchAttractions("成都", ["看大熊猫"])).toEqual([{
      poi_id: "B0PANDA",
      name: "成都大熊猫繁育研究基地",
      address: "熊猫大道1375号",
      type: "风景名胜",
      location: { longitude: 104.145, latitude: 30.74 },
    }]);
    expect(placeQueries).toEqual(["热门景点 看大熊猫", "大熊猫"]);
  });

  it("searches hotels without inventing prices", async () => {
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      fetch: async (input) => new URL(String(input)).pathname === "/v3/config/district"
        ? jsonResponse({ status: "1", districts: [{ name: "成都市", adcode: "510100" }] })
        : jsonResponse({
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

  it("retries a QPS-limited response instead of treating it as an empty candidate set", async () => {
    let placeAttempt = 0;
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      minimumRequestIntervalMs: 0,
      rateLimitRetryMs: 0,
      fetch: async (input) => {
        if (new URL(String(input)).pathname === "/v3/config/district") {
          return jsonResponse({ status: "1", districts: [{ name: "乌鲁木齐市", adcode: "650100" }] });
        }
        placeAttempt += 1;
        if (placeAttempt === 1) {
          return jsonResponse({ status: "0", infocode: "10021", info: "CUQPS_HAS_EXCEEDED_THE_LIMIT" });
        }
        return jsonResponse({
          status: "1",
          pois: [{
            id: "B001",
            name: "天山大峡谷",
            address: "乌鲁木齐县",
            location: "87.45,43.42",
            type: "风景名胜",
          }],
        });
      },
    });

    expect(await sources.searchAttractions("乌鲁木齐", [])).toEqual([expect.objectContaining({
      poi_id: "B001",
      name: "天山大峡谷",
    })]);
  });

  it("resolves a decorated destination to an administrative adcode before POI search", async () => {
    const urls: URL[] = [];
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      minimumRequestIntervalMs: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname === "/v3/config/district") {
          const keyword = url.searchParams.get("keywords");
          return jsonResponse({
            status: "1",
            districts: keyword === "伊犁" ? [{ name: "伊犁哈萨克自治州", adcode: "654000" }] : [],
          });
        }
        return jsonResponse({
          status: "1",
          pois: [{ id: "Y001", name: "伊犁河风景区", location: "81.29,43.92", type: "风景名胜" }],
        });
      },
    });

    expect(await sources.searchAttractions("伊犁(伊宁)", [])).toEqual([expect.objectContaining({ poi_id: "Y001" })]);
    expect(urls.at(-1)?.pathname).toBe("/v5/place/text");
    expect(urls.at(-1)?.searchParams.get("region")).toBe("654000");
  });

  it("does not issue a nationwide POI search when no destination district can be resolved", async () => {
    const urls: URL[] = [];
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      minimumRequestIntervalMs: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        return jsonResponse({ status: "1", districts: [] });
      },
    });

    expect(await sources.searchAttractions("机动缓冲(跨城/天气/休整)", [])).toEqual([]);
    expect(urls.every((url) => url.pathname === "/v3/config/district")).toBeTrue();
  });

  it("expands the Xinjiang 塔县 alias instead of accepting Gansu 金塔县", async () => {
    const urls: URL[] = [];
    const sources = new AmapResearchSources({
      apiKey: "web-key",
      minimumRequestIntervalMs: 0,
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname === "/v3/config/district") {
          const keyword = url.searchParams.get("keywords");
          return jsonResponse({
            status: "1",
            districts: keyword === "塔什库尔干"
              ? [{ name: "塔什库尔干塔吉克自治县", adcode: "653131" }]
              : [{ name: "金塔县", adcode: "620921" }],
          });
        }
        return jsonResponse({ status: "1", pois: [] });
      },
    });

    await sources.searchAttractions("帕米尔/塔县", []);
    expect(urls[0]?.searchParams.get("keywords")).toBe("塔什库尔干");
    expect(urls.at(-1)?.searchParams.get("region")).toBe("653131");
  });
});
