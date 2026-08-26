# Fliggy Hotel Reference Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side Fliggy nightly reference prices to trusted AMap hotel recommendations without allowing price failures or agent hallucinations to block trip generation.

**Architecture:** Keep AMap as the hotel identity and geospatial source. Add a replaceable `HotelPriceSource` boundary with a Fliggy proxy adapter, validate every agent-selected hotel against AMap candidates, then enrich contiguous hotel stays after segment planning and before budget calculation. Expose the quote as an estimated nightly reference with explicit provider and disclaimer metadata.

**Tech Stack:** Bun 1.4, TypeScript, Elysia, Vue 3, Vue I18n, Bun test, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-fliggy-hotel-reference-pricing-design.md`

## Global Constraints

- AMap remains authoritative for hotel identity, address, and coordinates.
- Fliggy is an estimated lowest nightly browse price, never a locked booking total.
- `FLIGGY_PROXY_TOKEN` remains server-only and must never enter runtime settings responses, logs, frontend assets, or committed source.
- The provider timeout defaults to `3000ms`; every provider failure degrades to no quote and never rejects trip generation.
- Only positive finite CNY prices, HTTPS links, and normalized hotel-name matches with score at least `0.75` are accepted.
- Cache identical successful and unavailable lookups for `300s` by hotel, city, dates, and adults.
- Preserve all current uncommitted work in overlapping files. This checkout already contains user-owned changes in several target files, so implementation execution must leave all business-code changes unstaged and uncommitted unless the user later requests a commit after reviewing the combined diff. The documentation commits are the only commits created while planning.

---

### Task 1: Isolated Fliggy Quote Adapter

**Files:**
- Create: `backend-ts/src/services/hotel-price-source.ts`
- Create: `backend-ts/src/services/fliggy-hotel-price-source.ts`
- Create: `backend-ts/tests/fliggy-hotel-price-source.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `HotelPriceRequest`, `HotelPriceQuote`, and `HotelPriceSource.quote(request): Promise<HotelPriceQuote | null>`.
- Produces: `FliggyHotelPriceSource` accepting `{ token, baseUrl?, timeoutMs?, cacheTtlMs?, fetch?, now? }`.
- The adapter sends `type=search_hotels` with `destName`, `checkInDate`, `checkOutDate`, `keyWords`, and `adultCount`.

- [ ] **Step 1: Write failing adapter contract tests**

```ts
import { describe, expect, it } from "bun:test";
import { FliggyHotelPriceSource } from "../src/services/fliggy-hotel-price-source.ts";

const REQUEST = {
  hotelName: "上海外滩华尔道夫",
  city: "上海",
  checkIn: "2026-09-10",
  checkOut: "2026-09-11",
  adults: 2,
};

it("returns a normalized exact Fliggy nightly quote", async () => {
  let body: Record<string, any> = {};
  const source = new FliggyHotelPriceSource({
    token: "test-token",
    now: () => new Date("2026-08-26T03:00:00.000Z"),
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ data: { itemList: [{
        name: "上海外滩华尔道夫酒店",
        price: "¥2,480",
        detailUrl: "https://router.feizhu.com/hotel/1",
      }] } });
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
  expect(body).toEqual({ type: "search_hotels", params: {
    destName: "上海",
    checkInDate: "2026-09-10",
    checkOutDate: "2026-09-11",
    keyWords: "上海外滩华尔道夫",
    adultCount: 2,
  } });
});
```

Add separate cases that expect `null` for a missing token, zero/NaN price, HTTP failure, malformed JSON, non-HTTPS URL, low-similarity name, and an aborted fetch. Add a cache test that calls `quote()` twice and asserts one fetch for both a successful result and a `null` result.

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd backend-ts && bun test tests/fliggy-hotel-price-source.test.ts`

Expected: FAIL because `FliggyHotelPriceSource` and its contract do not exist.

- [ ] **Step 3: Add the provider contract**

```ts
export interface HotelPriceRequest {
  hotelName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}

export interface HotelPriceQuote {
  provider: "fliggy";
  hotel_name: string;
  nightly_price: number;
  currency: "CNY";
  source_url: string;
  checked_at: string;
  method: "lowest_nightly_browse";
}

export interface HotelPriceSource {
  quote(request: HotelPriceRequest): Promise<HotelPriceQuote | null>;
}
```

- [ ] **Step 4: Implement the minimal Fliggy adapter**

Implement strict response parsing, hotel-name normalization and matching in `fliggy-hotel-price-source.ts`. Use an internal `Map<string, { expiresAt: number; value: HotelPriceQuote | null }>` keyed by normalized request fields. Use `AbortSignal.timeout(timeoutMs)` and catch all provider exceptions at the adapter boundary. Do not log request bodies or headers.

Name matching is deterministic: normalize with NFKC, remove whitespace/punctuation and generic suffixes `酒店|大酒店|宾馆`; return `1` for equality. Otherwise compute character-set Jaccard similarity. When both names contain the same brand from the provider's maintained brand list, score `0.6 + 0.4 * jaccard`; otherwise use `jaccard`. Reject scores below `0.75`.

Append empty documented keys to `.env.example`:

```dotenv
# 飞猪酒店参考价（服务端可选）
FLIGGY_PROXY_TOKEN=
FLIGGY_PROXY_URL=https://1439498936-6sysdjjt99.ap-guangzhou.tencentscf.com
FLIGGY_PRICE_TIMEOUT_MS=3000
FLIGGY_PRICE_CACHE_TTL_SECONDS=300
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `cd backend-ts && bun test tests/fliggy-hotel-price-source.test.ts && bun run typecheck`

Expected: all adapter tests PASS and TypeScript exits `0`.

- [ ] **Step 6: Record the Task 1 checkpoint without staging**

```bash
git diff --check -- .env.example backend-ts/src/services/hotel-price-source.ts backend-ts/src/services/fliggy-hotel-price-source.ts backend-ts/tests/fliggy-hotel-price-source.test.ts
git status --short -- .env.example backend-ts/src/services/hotel-price-source.ts backend-ts/src/services/fliggy-hotel-price-source.ts backend-ts/tests/fliggy-hotel-price-source.test.ts
```

Expected: no whitespace errors; only the listed Task 1 paths are reported. Do not run `git add` in the dirty checkout.

---

### Task 2: Enforce Trusted Hotel Selection

**Files:**
- Modify: `backend-ts/src/agents/pi-trip-planner.ts`
- Modify: `backend-ts/tests/pi-trip-planner.test.ts`

**Interfaces:**
- Consumes: `TrustedPoi[]` returned by `TripResearchSources.searchHotels`.
- Produces: every non-null `DayPlan.hotel` restored from a trusted candidate and tagged with `source: "amap"`, `source_hotel_id`, and `price_status: "unavailable"`.

- [ ] **Step 1: Add failing hotel trust tests**

Update the fake segment Agent so a test can return `hotel: { poi_id: "H1", name: "模型改名", estimated_cost: 1 }` and another can return `poi_id: "FAKE"`.

```ts
it("restores selected hotels from trusted AMap candidates", async () => {
  const agents = new FakeAgents();
  agents.hotelPoiId = "H1";
  const result = await new PiTripPlanner({ research: new FakeResearch(), agents })
    .plan(REQUEST, context().value);
  const hotel = (result.data as any).days[0].hotel;
  expect(hotel).toEqual(expect.objectContaining({
    name: "湖景酒店",
    source: "amap",
    source_hotel_id: "H1",
    price_status: "unavailable",
  }));
  expect(hotel.estimated_cost).toBeUndefined();
});

it("rejects an agent-selected hotel outside trusted candidates", async () => {
  const agents = new FakeAgents();
  agents.hotelPoiId = "FAKE";
  const result = await new PiTripPlanner({ research: new FakeResearch(), agents })
    .plan(REQUEST, context().value);
  expect((result.data as any).days.every((day: any) => day.hotel === null)).toBeTrue();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd backend-ts && bun test tests/pi-trip-planner.test.ts`

Expected: FAIL because model-provided hotels are currently copied without candidate validation.

- [ ] **Step 3: Tighten the segment schema and validation**

Change `segmentSchema` to accept both attraction and hotel candidates. The hotel object must require `poi_id`, and the schema must restrict it to `hotelCandidates.map(candidate => candidate.poi_id)`.

Change `validateSegmentOutput` to accept `trustedHotels`. For each day, resolve `value.hotel.poi_id` through a map. Return `null` for missing or unknown IDs; otherwise return a clone of the trusted candidate with:

```ts
{
  ...candidate,
  name: candidate.name,
  poi_id: candidate.poi_id,
  source: "amap",
  source_hotel_id: candidate.poi_id,
  price_status: "unavailable",
}
```

Pass `hotels` into both `segmentSchema(...)` and `validateSegmentOutput(...)`. Preserve the existing uncommitted sparse-attraction rebalancing change.

After merged days are finalized, force the day whose date equals `request.end_date` to `hotel: null`; it is the departure day and must not create an extra room night. Add a regression assertion that a four-day trip contains exactly three hotel nights.

- [ ] **Step 4: Run planner tests and typecheck**

Run: `cd backend-ts && bun test tests/pi-trip-planner.test.ts && bun run typecheck`

Expected: planner tests PASS, including existing concurrency, checkpoint and sparse-day behavior.

- [ ] **Step 5: Record the trusted-selection checkpoint without staging**

```bash
git diff --check -- backend-ts/src/agents/pi-trip-planner.ts backend-ts/tests/pi-trip-planner.test.ts
git status --short -- backend-ts/src/agents/pi-trip-planner.ts backend-ts/tests/pi-trip-planner.test.ts
```

Expected: no whitespace errors. Review the diff against the pre-task snapshot and verify the existing sparse-attraction work is intact; do not stage either overlapping file.

---

### Task 3: Enrich Contiguous Hotel Stays

**Files:**
- Create: `backend-ts/src/services/hotel-price-enrichment.ts`
- Create: `backend-ts/tests/hotel-price-enrichment.test.ts`
- Modify: `backend-ts/src/agents/pi-trip-planner.ts`
- Modify: `backend-ts/tests/pi-trip-planner.test.ts`

**Interfaces:**
- Consumes: `HotelPriceSource` from Task 1 and trusted `DayPlan.hotel` values from Task 2.
- Produces: `enrichHotelPrices(days, request, source?: HotelPriceSource): Promise<DayPlan[]>`.
- Adds optional `hotelPrices?: HotelPriceSource` to `PiTripPlannerOptions`.

- [ ] **Step 1: Write failing stay grouping and enrichment tests**

```ts
it("quotes one contiguous stay and applies its nightly reference to every night", async () => {
  const calls: HotelPriceRequest[] = [];
  const days = [0, 1, 2].map((day_index) => ({
    date: `2026-10-0${day_index + 1}`,
    day_index,
    city: "大理",
    description: "",
    transportation: "",
    accommodation: "舒适型酒店",
    hotel: { name: "湖景酒店", source: "amap", source_hotel_id: "H1", price_status: "unavailable" },
    attractions: [],
    meals: [],
  }));
  const enriched = await enrichHotelPrices(days, REQUEST, {
    async quote(request) {
      calls.push(request);
      return {
        provider: "fliggy", hotel_name: "湖景酒店", nightly_price: 420,
        currency: "CNY", source_url: "https://router.feizhu.com/h/1",
        checked_at: "2026-08-26T03:00:00.000Z", method: "lowest_nightly_browse",
      };
    },
  });
  expect(calls).toEqual([expect.objectContaining({
    checkIn: "2026-10-01", checkOut: "2026-10-04", adults: 2,
  })]);
  expect(enriched.every((day) => day.hotel?.estimated_cost === 420)).toBeTrue();
  expect(enriched[0]!.hotel).toEqual(expect.objectContaining({
    source: "amap",
    price_source: "fliggy",
    price_status: "estimated",
    price_method: "lowest_nightly_browse",
  }));
});
```

Add tests for different hotels/cities creating separate stays, a `null` quote preserving hotel identity and `unavailable`, quote rejection preserving the plan, deduplication of identical requests, and no quote for a final departure day with `hotel: null`.

- [ ] **Step 2: Run enrichment tests and verify RED**

Run: `cd backend-ts && bun test tests/hotel-price-enrichment.test.ts`

Expected: FAIL because the enrichment module does not exist.

- [ ] **Step 3: Implement deterministic stay grouping**

Group adjacent days only when `city`, `hotel.source`, and `hotel.source_hotel_id` are equal. Use the first day as `checkIn` and one UTC day after the last grouped day as `checkOut`. Clamp adults to a positive integer from `request.traveler_count ?? 1`. Run unique quote requests with concurrency `3`, catch source errors, and return cloned days rather than mutating checkpoint state.

On a quote, merge only these pricing fields:

```ts
{
  estimated_cost: quote.nightly_price,
  price_source: quote.provider,
  source_url: quote.source_url,
  price_checked_at: quote.checked_at,
  price_method: quote.method,
  price_status: "estimated",
}
```

- [ ] **Step 4: Integrate enrichment before budget and summary output**

In `PiTripPlanner.plan`, after review/repair produces final `days` and before `adjustGeneratedDaysToBudget`, call:

```ts
days = await enrichHotelPrices(days, request, this.options.hotelPrices);
```

Use a no-op source when `hotelPrices` is omitted so existing tests and deployments retain current behavior. Report no extra user-visible progress stage because quote latency is bounded inside the existing hotel workflow.

- [ ] **Step 5: Run focused backend tests**

Run: `cd backend-ts && bun test tests/hotel-price-enrichment.test.ts tests/pi-trip-planner.test.ts tests/budget-guard.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 6: Record the enrichment checkpoint without staging**

```bash
git diff --check -- backend-ts/src/services/hotel-price-enrichment.ts backend-ts/tests/hotel-price-enrichment.test.ts backend-ts/src/agents/pi-trip-planner.ts backend-ts/tests/pi-trip-planner.test.ts
git status --short -- backend-ts/src/services/hotel-price-enrichment.ts backend-ts/tests/hotel-price-enrichment.test.ts backend-ts/src/agents/pi-trip-planner.ts backend-ts/tests/pi-trip-planner.test.ts
```

Expected: no whitespace errors and no previously existing planner changes removed. Keep all implementation changes unstaged.

---

### Task 4: Configuration, Wiring, and Budget Provenance

**Files:**
- Modify: `backend-ts/src/config/settings.ts`
- Modify: `backend-ts/tests/config.test.ts`
- Modify: `backend-ts/src/agents/default-trip-planner.ts`
- Modify: `backend-ts/tests/default-trip-planner.test.ts`
- Modify: `backend-ts/src/domain/budget-ledger.ts`
- Modify: `backend-ts/tests/budget-http.test.ts`
- Modify: `backend-ts/src/http/app.ts`
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Produces matching `AppSettings` and `DefaultTripPlannerSettings` fields `fliggy_proxy_token`, `fliggy_proxy_url`, `fliggy_price_timeout_ms`, and `fliggy_price_cache_ttl_seconds` from env only.
- Produces `BudgetLedgerItem.price_provider: string` while preserving `price_source` as availability class (`estimated`, `live`, etc.).

- [ ] **Step 1: Add failing configuration tests**

Extend the test env snapshot with all four `FLIGGY_*` names. Test defaults, valid bounds, invalid bounds falling back, and verify `RuntimeSettings`/runtime JSON updates cannot expose or overwrite the token.

```ts
expect(getSettings()).toEqual(expect.objectContaining({
  fliggy_proxy_token: "",
  fliggy_proxy_url: "https://1439498936-6sysdjjt99.ap-guangzhou.tencentscf.com",
  fliggy_price_timeout_ms: 3000,
  fliggy_price_cache_ttl_seconds: 300,
}));
```

- [ ] **Step 2: Add failing wiring and budget provenance tests**

In `default-trip-planner.test.ts`, inject settings with a fake token and assert the constructed planner owns a `FliggyHotelPriceSource` without placing the token in `models.json`.

In `budget-http.test.ts`, provide a hotel with `source: "amap"`, `price_source: "fliggy"`, and `price_status: "estimated"`; assert:

```ts
expect(hotel.entity_source).toBe("amap");
expect(hotel.price_provider).toBe("fliggy");
expect(hotel.price_source).toBe("estimated");
```

- [ ] **Step 3: Run tests and verify RED**

Run: `cd backend-ts && bun test tests/config.test.ts tests/default-trip-planner.test.ts tests/budget-http.test.ts`

Expected: FAIL on missing Fliggy settings, wiring, and `price_provider`.

- [ ] **Step 4: Implement env-only settings and default wiring**

Add Fliggy fields to `AppSettings` and the same four fields to `DefaultTripPlannerSettings`, but not to `RuntimeSettings`, `RUNTIME_STRING_KEYS`, or admin update schemas. Parse bounded integers with defaults from the spec. In `createDefaultTripPlanner`, construct `FliggyHotelPriceSource` from settings and pass it as `hotelPrices`.

- [ ] **Step 5: Preserve entity and price provenance in the budget ledger**

Add `price_provider` to `BudgetLedgerItem` and `baseItem`. In `deriveHotelItems`, keep `entity_source` from `hotel.source`, set `price_provider` from `hotel.price_source`, and keep `price_source` based on `price_status`. Set `price_provider: ""` for user-created budget rows in `http/app.ts`. Update the frontend type exactly.

- [ ] **Step 6: Run focused tests and typechecks**

Run:

```bash
cd backend-ts && bun test tests/config.test.ts tests/default-trip-planner.test.ts tests/budget-http.test.ts && bun run typecheck
cd ../frontend && bun run build
```

Expected: all focused tests PASS; both typechecks/builds exit `0`; token text is absent from frontend `dist` and backend `models.json`.

- [ ] **Step 7: Record the wiring checkpoint without staging**

```bash
git diff --check -- backend-ts/src/config/settings.ts backend-ts/tests/config.test.ts backend-ts/src/agents/default-trip-planner.ts backend-ts/tests/default-trip-planner.test.ts backend-ts/src/domain/budget-ledger.ts backend-ts/tests/budget-http.test.ts backend-ts/src/http/app.ts frontend/src/types/index.ts
git status --short -- backend-ts/src/config/settings.ts backend-ts/tests/config.test.ts backend-ts/src/agents/default-trip-planner.ts backend-ts/tests/default-trip-planner.test.ts backend-ts/src/domain/budget-ledger.ts backend-ts/tests/budget-http.test.ts backend-ts/src/http/app.ts frontend/src/types/index.ts
```

Expected: no whitespace errors. Confirm the pre-existing `http/app.ts` and frontend type changes remain present; do not stage the combined files.

---

### Task 5: User-Facing Reference Price and Live Acceptance

**Files:**
- Modify: `frontend/src/components/DailyItinerary.vue`
- Modify: `frontend/src/views/Result.vue`
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/fr.json`
- Create: `frontend/src/components/DailyItinerary.hotel-pricing.test.mjs`
- Create: `frontend/e2e/hotel-reference-price.spec.ts`
- Modify locally only: `.env`

**Interfaces:**
- Consumes: hotel fields `price_source`, `price_status`, `estimated_cost`, `source_url`, and `price_checked_at`.
- Renders: provider label, `¥X/晚`, safe external link, and fixed browse-price disclaimer.

- [ ] **Step 1: Add failing presentation tests**

The component source test must assert that Fliggy rendering is gated by `price_source === 'fliggy'`, displays `estimated_cost`, uses `rel="noopener noreferrer"`, and calls the three new i18n keys. Extend locale completeness expectations with:

```json
{
  "hotelFliggyReferencePrice": "飞猪参考价 ¥{price}/晚",
  "hotelFliggyView": "去飞猪查看",
  "hotelFliggyDisclaimer": "房型、税费、库存及退改规则以飞猪页面为准"
}
```

Provide equivalent English and French values. The Playwright test should fulfill the plan-task API with a hotel containing the Fliggy fields, open the daily itinerary, and assert the reference label, disclaimer, and HTTPS link target.

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `cd frontend && bun test src/components/DailyItinerary.hotel-pricing.test.mjs src/i18n/locale.test.ts`

Expected: FAIL because the Fliggy-specific presentation and locale keys do not exist.

- [ ] **Step 3: Implement the price presentation**

In `DailyItinerary.vue`, show the Fliggy reference price only for a positive finite amount and `price_status === 'estimated'`. Render the link only for an HTTPS `source_url`; otherwise retain the price and disclaimer without a link. Keep the existing AMap verification label.

In `Result.vue`, update `formatBudgetSource` to prefer `item.price_provider === 'fliggy'` for the checked-price provider while independently retaining AMap as the entity source. Do not overwrite the user's existing carousel, French-language, or theme work.

- [ ] **Step 4: Run frontend unit, build, and browser tests**

Run:

```bash
cd frontend
bun test src/components/DailyItinerary.hotel-pricing.test.mjs src/i18n/locale.test.ts
bun run build
bunx playwright test e2e/hotel-reference-price.spec.ts --workers=1
```

Expected: unit and browser tests PASS, desktop and mobile layouts contain no overlap, and the external link is HTTPS.

- [ ] **Step 5: Configure the tested community proxy locally**

Read the public default `PROXY_TOKEN` from the inspected v1.1.5 source URL `https://hub.openclaw.ai/api/v1/packages/hotel-price-monitor/file?path=scripts%2Fcompare.py&preview=1&version=1.1.5`, then use `apply_patch` to add its value to the ignored root `.env` as `FLIGGY_PROXY_TOKEN`, preserving every existing line. Do not add the token value to `.env.example`, docs, logs, commits, or frontend environment variables.

- [ ] **Step 6: Run full verification before live acceptance**

Run sequentially because backend browser fixtures require the current frontend build:

```bash
cd frontend && bun test src && bun run build
cd ../backend-ts && bun run typecheck && bun test
```

Expected: all frontend tests/build and all backend tests/typecheck PASS. If a known baseline failure remains, record the exact failing test separately and prove all feature-focused tests pass.

- [ ] **Step 7: Restart only the port 7860 test environment**

Resolve the current process bound to `7860`, verify its command belongs to this YouBan checkout, stop only that process, then start `cd backend-ts && PORT=7860 bun run src/index.ts` while retaining the root `.env` and existing `DATA_DIR`. Do not start legacy Python services or clear browser/PWA data.

- [ ] **Step 8: Perform real browser acceptance**

Generate or retry a plan containing Shanghai for public dates, then verify through the live API and browser:

- selected hotel identity remains AMap-backed;
- 上海外滩华尔道夫酒店 contains `price_source=fliggy`, positive `estimated_cost`, HTTPS `source_url`, and `price_checked_at`;
- the page says “飞猪参考价” and the disclaimer, not “实时价” or “最终价”;
- proxy work completes within `3000ms`, or degrades without blocking the usable plan;
- refresh preserves the returned price fields from persisted task data.

- [ ] **Step 9: Record the user-facing checkpoint without staging**

```bash
git diff --check -- frontend/src/components/DailyItinerary.vue frontend/src/views/Result.vue frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/fr.json frontend/src/components/DailyItinerary.hotel-pricing.test.mjs frontend/e2e/hotel-reference-price.spec.ts
git status --short -- frontend/src/components/DailyItinerary.vue frontend/src/views/Result.vue frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/fr.json frontend/src/components/DailyItinerary.hotel-pricing.test.mjs frontend/e2e/hotel-reference-price.spec.ts
```

Expected: no whitespace errors. Confirm carousel, French-language, and theme changes remain in the combined diff; keep the implementation unstaged.

- [ ] **Step 10: Final audit**

Run `git status --short`, compare every touched path with the pre-task status snapshot, verify `.env` remains ignored, and run `rg -n 'tp_[A-Za-z0-9]+' --glob '!node_modules' --glob '!dist' --glob '!.env' .` to prove the proxy token is absent from tracked artifacts. Report the exact unstaged feature paths plus focused, full-suite, live API, and browser evidence separately. Do not claim the implementation is committed.
