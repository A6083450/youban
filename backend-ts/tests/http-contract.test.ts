import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillRuntimeDiagnostics } from "../src/agents/skill-runtime-diagnostics.ts";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";
import { createTaskState } from "../src/domain/task-store.ts";

const runtimes: HttpRuntime[] = [];
const tempDirs: string[] = [];

function runtime(options: {
  frontend?: boolean;
  skillRuntimeDiagnostics?: SkillRuntimeDiagnostics;
  poiSearch?: Parameters<typeof createHttpRuntime>[0]["poiSearch"];
  imageFetch?: Parameters<typeof createHttpRuntime>[0]["imageFetch"];
} = {}): HttpRuntime {
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
  const value = createHttpRuntime({
    dataDir,
    frontendDist,
    skillRuntimeDiagnostics: options.skillRuntimeDiagnostics,
    poiSearch: options.poiSearch,
    imageFetch: options.imageFetch,
  });
  runtimes.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((value) => value.close()));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

describe("HTTP compatibility contract", () => {
  it("keeps the root and trip health endpoints available and exposes docs", async () => {
    const diagnostics = new SkillRuntimeDiagnostics();
    diagnostics.recordSuccess("persistent-parent-agent", 12);
    diagnostics.recordFailure("pi-subagent-runner", 13, "structured_host_rotation_failed");
    const { app } = runtime({ skillRuntimeDiagnostics: diagnostics });
    for (const path of ["/health", "/api/trip/health", "/api/v2/trip/health"]) {
      const health = await app.handle(new Request(`http://localhost${path}`));
      expect(health.status).toBe(200);
      const body = await json(health);
      expect(body).toEqual(expect.objectContaining({ status: "healthy" }));
      if (path === "/api/trip/health" || path === "/api/v2/trip/health") {
        expect(body.skills).toEqual({
          catalog_generation: expect.any(Number),
          runtime_components: [
            { component: "persistent-parent-agent", generation: 12, status: "success" },
            {
              component: "pi-subagent-runner",
              generation: 13,
              status: "failure",
              error_code: "structured_host_rotation_failed",
            },
          ],
        });
        const serialized = JSON.stringify(body.skills);
        expect(serialized).not.toContain("assignments");
        expect(serialized).not.toContain("content");
        expect(serialized).not.toContain("errorCode");
      }
    }

    const docs = await app.handle(new Request("http://localhost/docs"));
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
  });

  it("does not restore nickname login when the runtime uses a test identity seam", async () => {
    const { app } = runtime();
    const response = await app.handle(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "Neo User" }),
    }));
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ detail: expect.any(String) });
  });

  it("returns status-specific {detail} errors", async () => {
    const { app } = runtime();
    const missing = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { "X-User-Id": "ghost123" },
    }));
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ detail: "用户不存在,请重新登录" });
  });

  it("supports credentialed CORS and serves cached images safely", async () => {
    const value = runtime();
    writeFileSync(join(value.dataDir, "images", "spot.txt"), "image-body");
    const preflight = await value.app.handle(new Request("http://localhost/api/auth/wechat/login", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");
    const allowedMethods = preflight.headers.get("access-control-allow-methods") ?? "";
    expect(allowedMethods).not.toBe("*");
    expect(allowedMethods.split(/,\s*/)).toContain("PATCH");

    const image = await value.app.handle(new Request("http://localhost/api/images/spot.txt"));
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await image.text()).toBe("image-body");
    const traversal = await value.app.handle(new Request("http://localhost/api/images/%2e%2e%2fyouban.db"));
    expect(traversal.status).toBe(404);
  });

  it("resolves migrated attraction photos through the legacy cache key", async () => {
    const value = runtime({
      poiSearch: {
        searchPoi: async () => [],
      },
    });
    writeFileSync(join(value.dataDir, "images", "2cb2b9e654e5c06c.jpg"), "legacy-photo");

    const response = await value.app.handle(new Request(
      "http://localhost/api/poi/photo?name=%E8%A5%BF%E6%B9%96&city=%E6%9D%AD%E5%B7%9E",
    ));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      success: true,
      message: "获取图片成功",
      data: { name: "西湖", photo_url: "/api/images/2cb2b9e654e5c06c.jpg" },
    });
  });

  it("downloads a missing POI photo once and serves later requests from the local cache", async () => {
    const imageBody = new Uint8Array(2_048).fill(9);
    let photoLookups = 0;
    let imageDownloads = 0;
    const value = runtime({
      poiSearch: {
        searchPoi: async () => [],
        getPoiPhoto: async () => {
          photoLookups += 1;
          return "https://images.example/west-lake.jpg";
        },
      },
      imageFetch: async () => {
        imageDownloads += 1;
        return new Response(imageBody, { headers: { "content-type": "image/jpeg" } });
      },
    });
    const request = () => value.app.handle(new Request(
      "http://localhost/api/poi/photo?name=%E8%A5%BF%E6%B9%96&city=%E6%9D%AD%E5%B7%9E",
    ));

    const first = await json(await request());
    const second = await json(await request());
    const localUrl = first.data.photo_url as string;

    expect(localUrl).toMatch(/^\/api\/images\/[a-f0-9]{16}\.jpg$/);
    expect(second.data.photo_url).toBe(localUrl);
    expect(photoLookups).toBe(1);
    expect(imageDownloads).toBe(1);
    const cachedImage = await value.app.handle(new Request(`http://localhost${localUrl}`));
    expect(cachedImage.status).toBe(200);
    expect(new Uint8Array(await cachedImage.arrayBuffer())).toEqual(imageBody);
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

  it("serves the uni-app shell and refuses retired PWA entry files", async () => {
    const { app } = runtime({ frontend: true });
    const root = await app.handle(new Request("http://localhost/"));
    expect(root.status).toBe(200);
    expect(root.headers.get("cache-control")).toBe("no-cache");
    for (const path of ["/sw.js", "/registerSW.js", "/manifest.webmanifest"]) {
      expect((await app.handle(new Request(`http://localhost${path}`))).status).toBe(404);
    }
    const asset = await app.handle(new Request("http://localhost/assets/app.js"));
    expect(await asset.text()).toBe("app-bundle");
    expect(asset.headers.get("cache-control")).toBeNull();
    const fallback = await app.handle(new Request("http://localhost/result/task-1"));
    expect(await fallback.text()).toContain("youban-spa");
    expect(fallback.headers.get("cache-control")).toBe("no-cache");
  });

  it("redirects legacy browser routes to their uni-app hash equivalents", async () => {
    const { app } = runtime({ frontend: true });
    const shareCode = "a".repeat(32);
    const cases = [
      ["/login", "/#/pages/login/index"],
      ["/admin", "/#/pages/admin/index"],
      ["/privacy?host=miniprogram", "/#/pages/privacy/index?host=miniprogram"],
      [
        "/plan/plan-123?host=miniprogram&section=weather",
        "/#/pages/plan/index?id=plan-123&host=miniprogram&section=weather",
      ],
      [
        `/share/${shareCode}?host=miniprogram`,
        `/#/pages/share/index?code=${shareCode}&host=miniprogram`,
      ],
    ] as const;

    for (const [path, location] of cases) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(location);
    }
  });
});
