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

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AmapOptions {
  apiKey: string;
  fetch?: Fetch;
  baseUrl?: string;
  timeoutMs?: number;
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

  constructor(options: AmapOptions) {
    this.apiKey = options.apiKey.trim();
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? "https://restapi.amap.com").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  async searchAttractions(city: string, preferences: string[]): Promise<TrustedPoi[]> {
    const preferenceText = preferences.map((item) => item.trim()).filter(Boolean).slice(0, 4).join(" ");
    return this.searchPoi(preferenceText ? `热门景点 ${preferenceText}` : "热门景点", city, "110000");
  }

  async searchHotels(city: string, accommodation: string): Promise<TrustedPoi[]> {
    return this.searchPoi(accommodation.trim() || "酒店", city, "100000");
  }

  async searchPoi(keywords: string, city: string, types = "110000"): Promise<TrustedPoi[]> {
    if (!this.apiKey || !city.trim() || !keywords.trim()) return [];
    const payload = await this.getJson("/v5/place/text", {
      key: this.apiKey,
      keywords: keywords.trim(),
      region: city.trim(),
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

  async getWeather(city: string): Promise<WeatherForecast[]> {
    if (!this.apiKey || !city.trim()) return [];
    const district = await this.getJson("/v3/config/district", {
      key: this.apiKey,
      keywords: city.trim(),
      subdistrict: "0",
      extensions: "base",
    });
    if (!district || stringValue(district.status) !== "1" || !Array.isArray(district.districts)) return [];
    const match = district.districts.find(record);
    const adcode = match ? stringValue(match.adcode) : "";
    if (!adcode) return [];
    const payload = await this.getJson("/v3/weather/weatherInfo", {
      key: this.apiKey,
      city: adcode,
      extensions: "all",
      output: "JSON",
    });
    if (!payload || stringValue(payload.status) !== "1" || !Array.isArray(payload.forecasts)) return [];
    const forecast = payload.forecasts.find(record);
    if (!forecast || !Array.isArray(forecast.casts)) return [];
    return forecast.casts.flatMap((raw): WeatherForecast[] => {
      if (!record(raw) || !/^\d{4}-\d{2}-\d{2}$/.test(stringValue(raw.date))) return [];
      return [{
        city: stringValue(forecast.city) || city.trim(),
        adcode: stringValue(forecast.adcode) || adcode,
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
    try {
      const response = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      return record(payload) ? payload : null;
    } catch {
      return null;
    }
  }
}
