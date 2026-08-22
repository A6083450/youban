import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";
import { createTaskState } from "../src/domain/task-store.ts";

const runtimes: HttpRuntime[] = [];
const tempDirs: string[] = [];

function runtime(options: { frontend?: boolean } = {}): HttpRuntime {
  const dataDir = mkdtempSync(join(tmpdir(), "youban-http-"));
  tempDirs.push(dataDir);
  mkdirSync(join(dataDir, "images"), { recursive: true });
  let frontendDist: string | undefined;
  if (options.frontend) {
    frontendDist = join(dataDir, "frontend-dist");
    mkdirSync(join(frontendDist, "assets"), { recursive: true });
    writeFileSync(join(frontendDist, "index.html"), "<main>youban-spa</main>");
    writeFileSync(join(frontendDist, "sw.js"), "service-worker");
    writeFileSync(join(frontendDist, "registerSW.js"), "register-worker");
    writeFileSync(join(frontendDist, "manifest.webmanifest"), "{}");
    writeFileSync(join(frontendDist, "assets", "app.js"), "app-bundle");
  }
  const value = createHttpRuntime({ dataDir, frontendDist });
  runtimes.push(value);
  return value;
}

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

describe("HTTP compatibility contract", () => {
  it("keeps the root and trip health endpoints available and exposes docs", async () => {
    const { app } = runtime();
    for (const path of ["/health", "/api/trip/health"]) {
      const health = await app.handle(new Request(`http://localhost${path}`));
      expect(health.status).toBe(200);
      expect(await json(health)).toEqual(expect.objectContaining({ status: "healthy" }));
    }

    const docs = await app.handle(new Request("http://localhost/docs"));
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
  });

  it("logs in by normalized nickname and reuses case-insensitive identity", async () => {
    const { app } = runtime();
    const login = (nickname: string, path = "/api/auth/login") => app.handle(new Request(
      `http://localhost${path}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname }) },
    ));

    const first = await json(await login("  Neo   User  "));
    const second = await json(await login("neo user", "/deployment-id/api/auth/login"));
    expect(first.success).toBe(true);
    expect(first.user.nickname).toBe("Neo User");
    expect(second.user.user_id).toBe(first.user.user_id);

    const me = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { "X-User-Id": first.user.user_id },
    }));
    expect(await json(me)).toEqual({ success: true, user: expect.objectContaining({ user_id: first.user.user_id }) });
  });

  it("returns status-specific {detail} errors", async () => {
    const { app } = runtime();
    const blank = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "   " }),
    }));
    expect(blank.status).toBe(422);
    expect(await json(blank)).toEqual({ detail: "昵称不能为空" });

    const missing = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { "X-User-Id": "ghost123" },
    }));
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ detail: "用户不存在,请重新登录" });
  });

  it("supports credentialed CORS and serves cached images safely", async () => {
    const value = runtime();
    writeFileSync(join(value.dataDir, "images", "spot.txt"), "image-body");
    const preflight = await value.app.handle(new Request("http://localhost/api/auth/login", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const image = await value.app.handle(new Request("http://localhost/api/images/spot.txt"));
    expect(image.status).toBe(200);
    expect(await image.text()).toBe("image-body");
    const traversal = await value.app.handle(new Request("http://localhost/api/images/%2e%2e%2fyouban.db"));
    expect(traversal.status).toBe(404);
  });

  it("filters trip history by X-User-Id", async () => {
    const value = runtime();
    value.tasks.save(createTaskState("mine", {
      user_id: "owner-1",
      request_payload: { city: "上海", travel_days: 2 },
    }), { immediate: true });
    value.tasks.save(createTaskState("other", {
      user_id: "owner-2",
      request_payload: { city: "杭州", travel_days: 2 },
    }), { immediate: true });

    const response = await value.app.handle(new Request("http://localhost/api/trip/history?limit=8", {
      headers: { "X-User-Id": "owner-1" },
    }));
    expect(await json(response)).toEqual({
      items: [expect.objectContaining({ task_id: "mine", city: "上海" })],
    });
  });

  it("serves SPA assets and applies no-cache only to mutable shell files", async () => {
    const { app } = runtime({ frontend: true });
    for (const path of ["/", "/sw.js", "/registerSW.js", "/manifest.webmanifest"]) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
    }
    const asset = await app.handle(new Request("http://localhost/assets/app.js"));
    expect(await asset.text()).toBe("app-bundle");
    expect(asset.headers.get("cache-control")).toBeNull();
    const fallback = await app.handle(new Request("http://localhost/result/task-1"));
    expect(await fallback.text()).toContain("youban-spa");
    expect(fallback.headers.get("cache-control")).toBe("no-cache");
  });
});
