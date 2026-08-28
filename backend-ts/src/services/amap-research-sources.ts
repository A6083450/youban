export interface GeoLocation {
  longitude: number;
  latitude: number;
}

export interface TrustedPoi {
  poi_id: string;
  name: string;
  address: string;
  type: string;
  location: GeoLocation;
  rating?: number;
  estimated_cost?: number;
}

export interface WeatherForecast {
  city: string;
  adcode: string;
  date: string;
  week: string;
  day_weather: string;
  night_weather: string;
  day_temp: number | null;
  night_temp: number | null;
  day_wind: string;
  night_wind: string;
  day_power: string;
  night_power: string;
  report_time: string;
}

interface ResolvedDistrict {
  name: string;
  adcode: string;
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AmapOptions {
  apiKey: string;
  fetch?: Fetch;
  baseUrl?: string;
  timeoutMs?: number;
  minimumRequestIntervalMs?: number;
  rateLimitRetryMs?: number;
  rateLimitRetries?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).join(",");
  return String(value ?? "").trim();
}

function finite(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseLocation(value: unknown): GeoLocation | undefined {
  const [longitude, latitude, extra] = stringValue(value).split(",");
  if (!longitude || !latitude || extra !== undefined) return undefined;
  const parsed = { longitude: Number(longitude), latitude: Number(latitude) };
  return Number.isFinite(parsed.longitude) && Number.isFinite(parsed.latitude) ? parsed : undefined;
}

export class AmapResearchSources {
  private readonly apiKey: string;
  private readonly fetch: Fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly minimumRequestIntervalMs: number;
  private readonly rateLimitRetryMs: number;
  private readonly rateLimitRetries: number;
  private requestStartQueue = Promise.resolve();
  private nextRequestAt = 0;
  private readonly districtCache = new Map<string, Promise<ResolvedDistrict | null>>();

  constructor(options: AmapOptions) {
    this.apiKey = options.apiKey.trim();
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? "https://restapi.amap.com").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.minimumRequestIntervalMs = Math.max(0, options.minimumRequestIntervalMs ?? 125);
    this.rateLimitRetryMs = Math.max(0, options.rateLimitRetryMs ?? 250);
    this.rateLimitRetries = Math.max(0, Math.floor(options.rateLimitRetries ?? 2));
  }

  async searchAttractions(city: string, preferences: string[]): Promise<TrustedPoi[]> {
    const preferenceText = preferences.map((item) => item.trim()).filter(Boolean).slice(0, 4).join(" ");
    const focusedPreferences = preferences
      .map((item) => item.trim().replace(/^(?:想去|想看|去看|看|参观|游览|喜欢|体验)\s*/u, ""))
      .filter(Boolean)
      .slice(0, 4);
    const queries = [...new Set([
      preferenceText ? `热门景点 ${preferenceText}` : "热门景点",
      ...focusedPreferences,
      "热门景点",
    ])];
    for (const query of queries) {
      const matches = await this.searchPoi(query, city, "110000");
      if (matches.length > 0) return matches;
    }
    return [];
  }

  async searchHotels(city: string, accommodation: string): Promise<TrustedPoi[]> {
    return this.searchPoi(accommodation.trim() || "酒店", city, "100000");
  }

  async searchPoi(keywords: string, city: string, types = "110000"): Promise<TrustedPoi[]> {
    if (!this.apiKey || !city.trim() || !keywords.trim()) return [];
    const district = await this.resolveDistrict(city);
    if (!district) return [];
    const payload = await this.getJson("/v5/place/text", {
      key: this.apiKey,
      keywords: keywords.trim(),
      region: district.adcode,
      city_limit: "true",
      types,
      page_size: "20",
      page_num: "1",
      show_fields: "business",
    });
    if (!payload || stringValue(payload.status) !== "1" || !Array.isArray(payload.pois)) return [];
    return payload.pois.slice(0, 20).flatMap((raw): TrustedPoi[] => {
      if (!record(raw)) return [];
      const poiId = stringValue(raw.id);
      const name = stringValue(raw.name);
      const point = parseLocation(raw.location);
      if (!poiId || !name || !point) return [];
      const poi: TrustedPoi = {
        poi_id: poiId,
        name,
        address: stringValue(raw.address),
        type: stringValue(raw.type),
        location: point,
      };
      const business = record(raw.business) ? raw.business : {};
      const rating = finite(business.rating);
      const cost = finite(business.cost);
      if (rating !== undefined) poi.rating = rating;
      if (cost !== undefined && cost >= 0) poi.estimated_cost = cost;
      return [poi];
    });
  }

  async getPoiPhoto(name: string, city = ""): Promise<string> {
    if (!this.apiKey || !name.trim()) return "";
    const payload = await this.getJson("/v5/place/text", {
      key: this.apiKey,
      keywords: name.trim(),
      ...(city.trim() ? { region: city.trim(), city_limit: "true" } : {}),
      page_size: "10",
      page_num: "1",
      show_fields: "photos",
    });
    if (!payload || stringValue(payload.status) !== "1" || !Array.isArray(payload.pois)) return "";
    for (const rawPoi of payload.pois) {
      if (!record(rawPoi) || !Array.isArray(rawPoi.photos)) continue;
      for (const rawPhoto of rawPoi.photos) {
        if (!record(rawPhoto)) continue;
        const url = stringValue(rawPhoto.url);
        if (/^https?:\/\//i.test(url)) return url;
      }
    }
    return "";
  }

  async getWeather(city: string): Promise<WeatherForecast[]> {
    if (!this.apiKey || !city.trim()) return [];
    const district = await this.resolveDistrict(city);
    if (!district) return [];
    const payload = await this.getJson("/v3/weather/weatherInfo", {
      key: this.apiKey,
      city: district.adcode,
      extensions: "all",
      output: "JSON",
    });
    if (!payload || stringValue(payload.status) !== "1" || !Array.isArray(payload.forecasts)) return [];
    const forecast = payload.forecasts.find(record);
    if (!forecast || !Array.isArray(forecast.casts)) return [];
    return forecast.casts.flatMap((raw): WeatherForecast[] => {
      if (!record(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(stringValue(raw.date))) return [];
      return [{
        city: stringValue(forecast.city) || district.name,
        adcode: stringValue(forecast.adcode) || district.adcode,
        date: stringValue(raw.date),
        week: stringValue(raw.week),
        day_weather: stringValue(raw.dayweather),
        night_weather: stringValue(raw.nightweather),
        day_temp: finite(raw.daytemp) ?? null,
        night_temp: finite(raw.nighttemp) ?? null,
        day_wind: stringValue(raw.daywind),
        night_wind: stringValue(raw.nightwind),
        day_power: stringValue(raw.daypower),
        night_power: stringValue(raw.nightpower),
        report_time: stringValue(forecast.reporttime),
      }];
    });
  }

  private async getJson(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    for (let attempt = 0; attempt <= this.rateLimitRetries; attempt += 1) {
      await this.waitForRequestSlot();
      try {
        const response = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        if (!record(payload)) return null;
        if (stringValue(payload.infocode) !== "10021") return payload;
      } catch {
        return null;
      }
      if (attempt < this.rateLimitRetries) {
        await new Promise((resolve) => setTimeout(resolve, this.rateLimitRetryMs * (attempt + 1)));
      }
    }
    return null;
  }

  private resolveDistrict(city: string): Promise<ResolvedDistrict | null> {
    const key = city.trim();
    const cached = this.districtCache.get(key);
    if (cached) return cached;
    const resolving = this.findDistrict(key);
    this.districtCache.set(key, resolving);
    return resolving;
  }

  private async findDistrict(city: string): Promise<ResolvedDistrict | null> {
    const ignored = new Set(["机动缓冲", "跨城", "天气", "休整", "返程", "转场", "缓冲"]);
    const aliases = new Map([
      ["帕米尔", "塔什库尔干"],
      ["帕米尔高原", "塔什库尔干"],
      ["塔县", "塔什库尔干"],
    ]);
    const keywords = [...new Set(city.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [])]
      .map((value) => value.trim())
      .filter((value) => value.length >= 2 && !ignored.has(value));
    for (const keyword of [...new Set(keywords.map((value) => aliases.get(value) ?? value))]) {
      const payload = await this.getJson("/v3/config/district", {
        key: this.apiKey,
        keywords: keyword,
        subdistrict: "0",
        extensions: "base",
      });
      if (!payload || stringValue(payload.status) !== "1" || !Array.isArray(payload.districts)) continue;
      const match = payload.districts.find((entry) => record(entry) && stringValue(entry.adcode));
      if (!record(match)) continue;
      return { name: stringValue(match.name) || keyword, adcode: stringValue(match.adcode) };
    }
    return null;
  }

  private waitForRequestSlot(): Promise<void> {
    const turn = this.requestStartQueue.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - performance.now());
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.nextRequestAt = performance.now() + this.minimumRequestIntervalMs;
    });
    this.requestStartQueue = turn.catch(() => {});
    return turn;
  }
}
