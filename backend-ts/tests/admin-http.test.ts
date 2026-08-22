import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ParentAgentCompletion,
  ParentAgentScope,
  YoubanParentAgent,
} from "../src/agents/persistent-parent-agent.ts";
import type { StructuredAgentRequest } from "../src/agents/pi-trip-planner.ts";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import { _resetSettingsForTest, getSettings } from "../src/config/settings.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

class NoopPlanner implements TripPlanner {
  async plan(request: TripPlanningRequest, _context: PlannerRunContext) { return { success: true, data: request }; }
}

class ClosableParent implements YoubanParentAgent {
  closed = false;

  async complete(_input: ParentAgentCompletion): Promise<string> { return ""; }
  async delegate(_scope: ParentAgentScope, _request: StructuredAgentRequest): Promise<unknown> { return {}; }
  async recordExchange(): Promise<void> {}
  async close(): Promise<void> { this.closed = true; }
}

let previousDataDir: string | undefined;
let dataDir = "";
let runtime: HttpRuntime;

beforeEach(() => {
  previousDataDir = process.env.DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), "youban-admin-"));
  process.env.DATA_DIR = dataDir;
  _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
  runtime = createHttpRuntime({ dataDir, planner: new NoopPlanner() });
  const alice = runtime.users.login("小艾");
  runtime.tasks.save(createTaskState("alice-trip", {
    user_id: alice.user_id,
    status: "completed",
    stage: "completed",
    progress: 100,
    request_payload: {
      city: "北京", cities: [{ city: "北京", days: 3 }], start_date: "2026-08-01",
      end_date: "2026-08-03", travel_days: 3,
    },
    result: { success: true, data: { city: "北京", days: [], overall_suggestions: "" } },
  }), { immediate: true });
});

afterEach(() => {
  runtime.close();
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
});

function call(method: string, path: string, body?: unknown, token?: string) {
  return runtime.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-admin-token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

describe("admin HTTP", () => {
  it("creates the password file and rereads it on every request", async () => {
    expect(readFileSync(join(dataDir, "admin_password.txt"), "utf8").trim()).toBe("admin@123");
    expect((await call("POST", "/api/admin/login", { password: "wrong" })).status).toBe(401);
    expect((await call("POST", "/api/admin/login", { password: "admin@123" })).status).toBe(200);
    writeFileSync(join(dataDir, "admin_password.txt"), "new-secret\n", "utf8");
    expect((await call("GET", "/api/admin/trips", undefined, "admin@123")).status).toBe(401);
    expect((await call("GET", "/api/admin/trips", undefined, "new-secret")).status).toBe(200);
  });

  it("lists all users with nicknames and lets an admin delete a completed trip", async () => {
    const response = await call("GET", "/api/admin/trips", undefined, "admin@123");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual(expect.objectContaining({
      task_id: "alice-trip", city: "北京", nickname: "小艾",
    }));
    expect((await call("DELETE", "/api/admin/trips/alice-trip", undefined, "admin@123")).status).toBe(200);
    expect(runtime.tasks.get("alice-trip")).toBeUndefined();
  });

  it("lets a live admin token cross owner guards and rejects an invalid token", async () => {
    const allowed = await call("GET", "/api/trip/status/alice-trip", undefined, "admin@123");
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual(expect.objectContaining({ task_id: "alice-trip", status: "completed" }));
    const conversation = await call("GET", "/api/trip/plan/alice-trip/conversation", undefined, "admin@123");
    expect(conversation.status).toBe(200);
    const rejected = await call("GET", "/api/trip/status/alice-trip", undefined, "wrong-secret");
    expect(rejected.status).toBe(403);
  });

  it("reads and persists filtered runtime settings", async () => {
    const getResponse = await call("GET", "/api/admin/settings", undefined, "admin@123");
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ openai_model: expect.any(String) }),
    }));
    const draft = { city: "北京", travel_days: 3 };
    const pendingToken = runtime.assistant.ledger.register(draft, 0.95).token;
    const update = await call("PUT", "/api/admin/settings", {
      openai_model: "admin-model",
      unknown_key: "ignored",
    }, "admin@123");
    expect(update.status).toBe(200);
    expect((await update.json() as Record<string, any>).data.openai_model).toBe("admin-model");
    expect(runtime.assistant.ledger.validate(pendingToken, draft)).toEqual({ valid: true, reason: "ok" });
    const persisted = JSON.parse(readFileSync(join(dataDir, "runtime_settings.json"), "utf8"));
    expect(persisted).toEqual({ openai_model: "admin-model" });
  });

  it("keeps the active settings and services when a replacement generation cannot be built", async () => {
    await runtime.close();
    const initialPlanner = new NoopPlanner();
    const initialParent = new ClosableParent();
    const candidateParent = new ClosableParent();
    const parents = [initialParent, candidateParent];
    let plannerBuilds = 0;
    runtime = createHttpRuntime({
      dataDir,
      serviceFactories: {
        parentAgent: () => parents.shift()!,
        planner() {
          plannerBuilds += 1;
          if (plannerBuilds === 1) return initialPlanner;
          throw new Error("candidate planner failed");
        },
      },
    });
    const previousModel = getSettings().openai_model;

    const response = await call("PUT", "/api/admin/settings", {
      openai_model: "must-not-commit",
    }, "admin@123");

    expect(response.status).toBe(500);
    expect(getSettings().openai_model).toBe(previousModel);
    expect(runtime.parentAgent).toBe(initialParent);
    expect(runtime.planner).toBe(initialPlanner);
    expect(initialParent.closed).toBe(false);
    expect(candidateParent.closed).toBe(true);
    expect(existsSync(join(dataDir, "runtime_settings.json"))).toBe(false);
  });
});
