import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class NoopPlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) { return { success: true, data: request }; }
}

function completedPlan() {
  return {
    success: true,
    data: {
      city: "广州",
      start_date: "2026-08-18",
      end_date: "2026-08-19",
      traveler_count: 2,
      room_count: 1,
      overall_suggestions: "s",
      budget: {
        total_attractions: 60,
        total_hotels: 0,
        total_meals: 10,
        total_transportation: 0,
        total: 70,
      },
      days: [
        {
          date: "2026-08-18", day_index: 0, description: "d1", transportation: "地铁", accommodation: "酒店",
          hotel: { name: "高德酒店", estimated_cost: 0, source: "amap", source_hotel_id: "amap-1", price_status: "unavailable" },
          attractions: [{ id: "itm_attr0001", name: "陈家祠", ticket_price: 60 }],
          meals: [{ id: "itm_meal0001", type: "lunch", name: "早茶", estimated_cost: 10 }],
        },
        {
          date: "2026-08-19", day_index: 1, description: "d2", transportation: "公交", accommodation: "无需住宿",
          hotel: null, attractions: [], meals: [],
        },
      ],
    },
  };
}

const runtimes: HttpRuntime[] = [];
const dirs: string[] = [];
function runtime(result: Record<string, unknown> = completedPlan()) {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-budget-"));
  dirs.push(dataDir);
  const value = createHttpRuntime({ dataDir, planner: new NoopPlanner() });
  value.tasks.save(createTaskState("plan-1", {
    user_id: "owner-1", status: "completed", stage: "completed", progress: 100,
    result,
    request_payload: { traveler_count: 2, room_count: 1, budget_amount: 50, budget_basis: "group_total" },
  }), { immediate: true });
  runtimes.push(value);
  return value;
}
afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function call(app: HttpRuntime["app"], method: string, path: string, body?: unknown, user = "owner-1") {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe("budget ledger HTTP", () => {
  it("derives group totals and keeps unquoted rows separate", async () => {
    const value = runtime();
    const response = await call(value.app, "GET", "/api/trip/plan/plan-1/budget-items");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    const hotel = body.items.find((item: any) => item.type === "hotel");
    expect(hotel.amount).toBeNull();
    expect(hotel.entity_source).toBe("amap");
    expect(body.totals.total).toBe(140);
    expect(body.per_person_totals.total).toBe(70);
    expect(body.pending_count).toBe(3);
    expect(body.budget_limit).toBe(50);
    expect(body.over_budget_amount).toBe(90);
    expect(body.projected_total).toBe(body.quoted_total + body.pending_buffer);
  });

  it("keeps AMap hotel identity separate from the Fliggy price provider", async () => {
    const plan = completedPlan();
    const hotel = (plan.data.days[0] as Record<string, any>).hotel;
    Object.assign(hotel, {
      estimated_cost: 420,
      price_source: "fliggy",
      price_status: "estimated",
      source_url: "https://router.feizhu.com/h/1",
      price_checked_at: "2026-08-26T03:00:00.000Z",
    });
    const value = runtime(plan);

    const body = await (await call(value.app, "GET", "/api/trip/plan/plan-1/budget-items")).json() as Record<string, any>;
    const item = body.items.find((entry: any) => entry.type === "hotel");

    expect(item.entity_source).toBe("amap");
    expect(item.price_provider).toBe("fliggy");
    expect(item.price_source).toBe("estimated");
    expect(item.amount).toBe(420);
  });

  it("converts per-person custom input to a canonical group total", async () => {
    const value = runtime();
    const response = await call(value.app, "POST", "/api/trip/plan/plan-1/budget-items", {
      type: "other", day_index: null, name: "人均 DIY", amount: 125, amount_basis: "per_person",
    });
    const body = await response.json() as Record<string, any>;
    const item = body.items.find((entry: any) => entry.name === "人均 DIY");
    expect(item.amount).toBe(250);
    expect(item.per_person_amount).toBe(125);
    expect(item.price_provider).toBe("");
    expect(body.totals.total_other).toBe(250);
  });

  it("updates, soft deletes, and restores a user item", async () => {
    const value = runtime();
    const created = await (await call(value.app, "POST", "/api/trip/plan/plan-1/budget-items", {
      type: "other", day_index: null, name: "伴手礼", amount: 125.5, amount_basis: "group_total",
    })).json() as Record<string, any>;
    const item = created.items.find((entry: any) => entry.origin === "user");
    const updated = await (await call(value.app, "PATCH", `/api/trip/plan/plan-1/budget-items/${item.id}`, {
      type: "transport", day_index: 1, name: "返程打车", amount: 88,
    })).json() as Record<string, any>;
    expect(updated.items.find((entry: any) => entry.id === item.id)).toEqual(expect.objectContaining({
      type: "transport", day_index: 1, name: "返程打车", amount: 88, user_locked: true,
    }));
    const deleted = await (await call(value.app, "DELETE", `/api/trip/plan/plan-1/budget-items/${item.id}`)).json() as Record<string, any>;
    expect(deleted.items.find((entry: any) => entry.id === item.id).deleted).toBe(true);
    const restored = await (await call(value.app, "PATCH", `/api/trip/plan/plan-1/budget-items/${item.id}`, {
      deleted: false,
    })).json() as Record<string, any>;
    expect(restored.items.find((entry: any) => entry.id === item.id).deleted).toBe(false);
  });

  it("rejects itinerary attraction overrides, invalid days, and non-owners", async () => {
    const value = runtime();
    const current = await (await call(value.app, "GET", "/api/trip/plan/plan-1/budget-items")).json() as Record<string, any>;
    const attraction = current.items.find((item: any) => item.type === "attraction");
    expect((await call(value.app, "PATCH", `/api/trip/plan/plan-1/budget-items/${attraction.id}`, {
      amount: 35,
    })).status).toBe(409);
    expect((await call(value.app, "POST", "/api/trip/plan/plan-1/budget-items", {
      type: "other", day_index: 9, name: "错误", amount: null, amount_basis: "group_total",
    })).status).toBe(422);
    expect((await call(value.app, "GET", "/api/trip/plan/plan-1/budget-items", undefined, "other")).status).toBe(403);
  });
});
