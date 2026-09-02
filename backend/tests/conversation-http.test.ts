import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class ImmediatePlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) {
    return { success: true, data: { ...request, days: [] } };
  }
}

const runtimes: HttpRuntime[] = [];
const dirs: string[] = [];
const DRAFT = {
  city: "哈尔滨",
  cities: [{ city: "哈尔滨", days: 3 }],
  start_date: "2026-02-15",
  end_date: "2026-02-17",
  travel_days: 3,
  transportation: "公共交通",
  accommodation: "舒适型酒店",
  preferences: ["冰雪"],
  free_text_input: "春节看冰雪大世界",
  origin_text: "春节去哈尔滨看冰雪大世界3天",
  language: "zh-CN",
};

function runtime() {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-conversation-"));
  dirs.push(dataDir);
  const value = createHttpRuntime({ dataDir, planner: new ImmediatePlanner() });
  runtimes.push(value);
  return value;
}

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function call(app: HttpRuntime["app"], method: string, path: string, body?: unknown, user = "user-1") {
  return app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe("plan conversation persistence", () => {
  it("archives the full creation conversation and returns it to the owner", async () => {
    const value = runtime();
    const conversation = [
      { role: "user", content: "春节去哈尔滨看冰雪大世界3天" },
      { role: "assistant", content: "我先帮你整理一下。" },
      { role: "user", content: "好的" },
    ];
    const token = value.assistant.ledger.register(DRAFT, 0.95).token;
    const accepted = await (await call(value.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      conversation,
      execution_token: token,
    })).json() as Record<string, any>;
    const response = await call(value.app, "GET", `/api/trip/plan/${accepted.plan_id}/conversation`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan_id: accepted.plan_id, messages: conversation });

    const forbidden = await call(
      value.app,
      "GET",
      `/api/trip/plan/${accepted.plan_id}/conversation`,
      undefined,
      "other-user",
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ detail: "无权访问该计划对话" });
  });

  it("creates a stable fallback archive for legacy clients", async () => {
    const value = runtime();
    const token = value.assistant.ledger.register(DRAFT, 0.95).token;
    const accepted = await (await call(value.app, "POST", "/api/trip/plan", {
      ...DRAFT,
      execution_token: token,
    })).json() as Record<string, any>;
    const response = await call(value.app, "GET", `/api/trip/plan/${accepted.plan_id}/conversation`);
    expect(await response.json()).toEqual({
      plan_id: accepted.plan_id,
      messages: [
        { role: "user", content: DRAFT.origin_text },
        { role: "assistant", content: "已确认行程：哈尔滨，2026-02-15 至 2026-02-17，共 3 天。" },
      ],
    });
  });
});
