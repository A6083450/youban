import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import type { TrustedPoi } from "../src/services/amap-research-sources.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class NoopPlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) { return { success: true, data: request }; }
}

class FakePoiSearch {
  readonly calls: Array<{ keywords: string; city: string; types: string }> = [];
  waitForSearch: Promise<void> | null = null;
  results: TrustedPoi[] = [{
    poi_id: "B0NEWPOI",
    name: "广州塔",
    address: "广州市海珠区阅江西路222号",
    type: "风景名胜;旅游景点",
    location: { longitude: 113.3307, latitude: 23.1135 },
  }];

  async searchPoi(keywords: string, city: string, types = "110000") {
    this.calls.push({ keywords, city, types });
    if (this.waitForSearch) await this.waitForSearch;
    return this.results;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

function completedPlan() {
  return {
    success: true,
    data: {
      city: "广州",
      traveler_count: 2,
      room_count: 1,
      budget: {},
      blueprint: {
        title: "广州两日游",
        stages: [
          { day_indices: [0], highlights: ["陈家祠"] },
          { day_indices: [1], highlights: [] },
        ],
      },
      days: [
        {
          day_index: 0, city: "广州", transportation: "地铁", hotel: null, meals: [],
          attractions: [{
            id: "itm_attr0001", poi_id: "B0CHEN", name: "陈家祠", ticket_price: 20,
            start_time: "09:00", end_time: "10:30",
          }],
        },
        { day_index: 1, city: "广州", transportation: "地铁", hotel: null, meals: [], attractions: [] },
      ],
    },
  };
}

const runtimes: HttpRuntime[] = [];
const dirs: string[] = [];
function runtime() {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-attraction-"));
  dirs.push(dataDir);
  const poiSearch = new FakePoiSearch();
  const value = createHttpRuntime({ dataDir, planner: new NoopPlanner(), poiSearch });
  value.tasks.save(createTaskState("plan-1", {
    user_id: "owner-1", status: "completed", stage: "completed", progress: 100,
    result: completedPlan(), request_payload: { traveler_count: 2, room_count: 1 },
    execution: { itm_attr0001: { status: "done" } },
  }), { immediate: true });
  runtimes.push(value);
  return { ...value, poiSearch };
}

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function request(app: HttpRuntime["app"], method: string, path: string, body?: unknown, user = "owner-1") {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    day_index: 1,
    poi_id: "B0NEWPOI",
    name: "客户端伪造名称",
    address: "客户端地址",
    location: { longitude: 0, latitude: 0 },
    visit_duration: 120,
    description: "登塔俯瞰城市",
    ticket_price: 20,
    start_time: "16:30",
    reservation_required: false,
    reservation_tips: "",
    ...overrides,
  };
}

describe("trip attraction HTTP", () => {
  it("searches AMap through the server adapter", async () => {
    const value = runtime();
    const response = await request(value.app, "GET", "/api/poi/search?keywords=%E5%B9%BF%E5%B7%9E%E5%A1%94&city=%E5%B9%BF%E5%B7%9E&types=110000");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      success: true,
      data: [expect.objectContaining({ id: "B0NEWPOI", name: "广州塔" })],
    }));
    expect(value.poiSearch.calls[0]).toEqual({ keywords: "广州塔", city: "广州", types: "110000" });
  });

  it("creates a server-verified POI and updates budget and blueprint", async () => {
    const value = runtime();
    const response = await request(value.app, "POST", "/api/trip/plan/plan-1/attractions", payload());
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    const created = body.plan.days[1].attractions[0];
    expect(created).toEqual(expect.objectContaining({
      poi_id: "B0NEWPOI", name: "广州塔", address: "广州市海珠区阅江西路222号",
      start_time: "16:30", end_time: "18:30",
    }));
    expect(created.id).toMatch(/^itm_[a-f0-9]{8}$/);
    expect(body.items.find((item: any) => item.linked_item_id === created.id)).toEqual(expect.objectContaining({
      day_index: 1, per_person_amount: 20, entity_source: "amap",
    }));
    expect(body.totals.total_attractions).toBe(80);
    expect(body.plan.blueprint.stages[1].highlights).toEqual(["广州塔"]);
  });

  it("moves an attraction while preserving its stable id", async () => {
    const value = runtime();
    value.poiSearch.results = [{
      poi_id: "B0CHEN", name: "陈家祠", address: "中山七路恩龙里34号", type: "景点",
      location: { longitude: 113.245, latitude: 23.129 },
    }];
    const response = await request(value.app, "PUT", "/api/trip/plan/plan-1/attractions/itm_attr0001", payload({
      poi_id: "B0CHEN", name: "陈家祠", day_index: 1, ticket_price: 25,
      start_time: "10:00", visit_duration: 90,
    }));
    const body = await response.json() as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.plan.days[0].attractions).toEqual([]);
    expect(body.plan.days[1].attractions[0]).toEqual(expect.objectContaining({
      id: "itm_attr0001", start_time: "10:00", end_time: "11:30",
    }));
    expect(body.plan.blueprint.stages[0].highlights).toEqual([]);
    expect(body.plan.blueprint.stages[1].highlights).toEqual(["陈家祠"]);
  });

  it("rejects a create when enhancement changes the plan during POI verification", async () => {
    const value = runtime();
    const gate = deferred();
    value.poiSearch.waitForSearch = gate.promise;
    const pending = request(value.app, "POST", "/api/trip/plan/plan-1/attractions", payload());
    await waitFor(() => value.poiSearch.calls.length === 1);
    const current = value.tasks.get("plan-1")!;
    const enhancedResult = completedPlan();
    enhancedResult.data.blueprint.title = "增强版广州两日游";
    value.tasks.save({
      ...current,
      result: enhancedResult,
      plan_quality: "enhanced",
      enhancement_status: "completed",
    }, { immediate: true });

    gate.resolve();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(value.tasks.get("plan-1")).toEqual(expect.objectContaining({
      result: enhancedResult,
      plan_quality: "enhanced",
      enhancement_status: "completed",
    }));
  });

  it("rejects an update when enhancement changes the plan during POI verification", async () => {
    const value = runtime();
    value.poiSearch.results = [{
      poi_id: "B0CHEN", name: "陈家祠", address: "中山七路恩龙里34号", type: "景点",
      location: { longitude: 113.245, latitude: 23.129 },
    }];
    const gate = deferred();
    value.poiSearch.waitForSearch = gate.promise;
    const pending = request(
      value.app,
      "PUT",
      "/api/trip/plan/plan-1/attractions/itm_attr0001",
      payload({ poi_id: "B0CHEN", name: "陈家祠", day_index: 1 }),
    );
    await waitFor(() => value.poiSearch.calls.length === 1);
    const current = value.tasks.get("plan-1")!;
    const enhancedResult = completedPlan();
    enhancedResult.data.blueprint.title = "增强版广州两日游";
    value.tasks.save({
      ...current,
      result: enhancedResult,
      plan_quality: "enhanced",
      enhancement_status: "completed",
    }, { immediate: true });

    gate.resolve();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(value.tasks.get("plan-1")).toEqual(expect.objectContaining({
      result: enhancedResult,
      plan_quality: "enhanced",
      enhancement_status: "completed",
    }));
  });

  it("rejects same-day duplicates and unverified POIs", async () => {
    const value = runtime();
    expect((await request(value.app, "POST", "/api/trip/plan/plan-1/attractions", payload())).status).toBe(200);
    expect((await request(value.app, "POST", "/api/trip/plan/plan-1/attractions", payload())).status).toBe(409);
    value.poiSearch.results = [];
    expect((await request(value.app, "POST", "/api/trip/plan/plan-1/attractions", payload({ poi_id: "NOT-AMAP" }))).status).toBe(422);
  });

  it("deletes itinerary, execution, budget and blueprint references together", async () => {
    const value = runtime();
    const response = await request(value.app, "DELETE", "/api/trip/plan/plan-1/attractions/itm_attr0001");
    const body = await response.json() as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.plan.days[0].attractions).toEqual([]);
    expect(body.items.some((item: any) => item.linked_item_id === "itm_attr0001")).toBe(false);
    expect(body.plan.blueprint.stages[0].highlights).toEqual([]);
    expect(value.tasks.get("plan-1")?.execution.itm_attr0001).toBeUndefined();
  });
});
