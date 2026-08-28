import type { HotelPriceQuote, HotelPriceRequest, HotelPriceSource } from "./hotel-price-source.ts";

const DEFAULT_BASE_URL = "https://1439498936-6sysdjjt99.ap-guangzhou.tencentscf.com";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 300_000;
const MIN_NAME_MATCH_SCORE = 0.75;
const HOTEL_SUFFIXES = /(?:大酒店|酒店|宾馆)+$/u;
const HOTEL_BRANDS = [
  "华尔道夫",
  "希尔顿",
  "万豪",
  "喜来登",
  "香格里拉",
  "洲际",
  "凯悦",
  "丽思卡尔顿",
  "四季",
  "威斯汀",
  "雅高",
  "温德姆",
  "锦江",
] as const;

interface FetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<FetchResponse>;

interface FliggyHotelPriceSourceOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetch?: FetchLike;
  now?: () => Date;
}

interface CacheEntry {
  expiresAt: number;
  value: HotelPriceQuote | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)));
}

function normalizeHotelName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .replace(HOTEL_SUFFIXES, "");
}

function characterSet(value: string): Set<string> {
  return new Set(Array.from(value));
}

function hotelNameMatchScore(expected: string, candidate: string): number {
  const left = normalizeHotelName(expected);
  const right = normalizeHotelName(candidate);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftSet = characterSet(left);
  const rightSet = characterSet(right);
  const intersection = [...leftSet].filter((character) => rightSet.has(character)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union === 0 ? 0 : intersection / union;
  const sharedBrand = HOTEL_BRANDS.some((brand) => left.includes(brand) && right.includes(brand));
  return sharedBrand ? 0.6 + 0.4 * jaccard : jaccard;
}

function parsePrice(value: unknown): number | null {
  const normalized = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] ?? Number.NaN);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function parseHttpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function quoteCandidates(payload: unknown): Record<string, unknown>[] {
  if (!record(payload) || !record(payload.data) || !Array.isArray(payload.data.itemList)) return [];
  return payload.data.itemList.filter(record);
}

function cacheKey(request: HotelPriceRequest): string {
  return JSON.stringify([
    normalizeHotelName(request.hotelName),
    request.city.trim(),
    request.checkIn,
    request.checkOut,
    Math.max(1, Math.floor(request.adults)),
  ]);
}

export class FliggyHotelPriceSource implements HotelPriceSource {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetchFn: FetchLike;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: FliggyHotelPriceSourceOptions) {
    this.token = options.token.trim();
    this.baseUrl = (options.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 500, 5_000);
    this.cacheTtlMs = clampInteger(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS, 0, 1_800_000);
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async quote(request: HotelPriceRequest): Promise<HotelPriceQuote | null> {
    if (!this.token) return null;
    const key = cacheKey(request);
    const nowMs = this.now().getTime();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > nowMs) return cached.value ? structuredClone(cached.value) : null;

    const value = await this.fetchQuote(request).catch(() => null);
    if (this.cacheTtlMs > 0) {
      this.cache.set(key, { expiresAt: nowMs + this.cacheTtlMs, value: value ? structuredClone(value) : null });
    }
    return value;
  }

  private async fetchQuote(request: HotelPriceRequest): Promise<HotelPriceQuote | null> {
    const response = await this.fetchFn(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Token": this.token,
      },
      body: JSON.stringify({
        type: "search_hotels",
        params: {
          destName: request.city,
          checkInDate: request.checkIn,
          checkOutDate: request.checkOut,
          keyWords: request.hotelName,
          adultCount: Math.max(1, Math.floor(request.adults)),
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const checkedAt = this.now().toISOString();
    const matches = quoteCandidates(payload).flatMap((candidate): HotelPriceQuote[] => {
      const hotelName = String(candidate.name ?? candidate.hotelName ?? "").trim();
      const price = parsePrice(candidate.price ?? candidate.minPrice ?? candidate.currentPrice);
      const sourceUrl = parseHttpsUrl(candidate.detailUrl ?? candidate.url ?? candidate.link);
      if (
        !hotelName
        || price === null
        || sourceUrl === null
        || hotelNameMatchScore(request.hotelName, hotelName) < MIN_NAME_MATCH_SCORE
      ) return [];
      return [{
        provider: "fliggy",
        hotel_name: hotelName,
        nightly_price: price,
        currency: "CNY",
        source_url: sourceUrl,
        checked_at: checkedAt,
        method: "lowest_nightly_browse",
      }];
    });
    return matches.sort((left, right) => left.nightly_price - right.nightly_price)[0] ?? null;
  }
}
