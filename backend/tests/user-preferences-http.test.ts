import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";

let runtime: HttpRuntime | undefined;
let dataDir = "";

function createRuntime(): HttpRuntime {
  dataDir = mkdtempSync(join(tmpdir(), "youban-preferences-http-"));
  runtime = createHttpRuntime({
    dataDir,
    authentication: {
      pepper: "preference-test-pepper-with-at-least-32-bytes",
      exchangeWechatCode: async (code) => ({
        openid: `openid-for-${code}`,
        unionid: `unionid-for-${code}`,
      }),
      createMiniProgramCode: async scene => `data:image/png;base64,${Buffer.from(scene).toString("base64")}`,
    },
  });
  return runtime;
}

async function requestJson(
  app: HttpRuntime["app"],
  path: string,
  options: { method?: string; body?: unknown; token?: string; cookie?: string } = {},
): Promise<{ response: Response; body: Record<string, any> }> {
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }));
  return { response, body: await response.json() as Record<string, any> };
}

async function login(app: HttpRuntime["app"], code: string): Promise<Record<string, any>> {
  const session = (await requestJson(app, "/api/auth/wechat/login", {
    method: "POST",
    body: { code },
  })).body;
  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ));
  const form = new FormData();
  form.set("avatar", new File([png], "wechat-avatar.png", { type: "image/png" }));
  const uploaded = await app.handle(new Request("http://localhost/api/account/profile/avatar", {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: form,
  }));
  expect(uploaded.status).toBe(200);
  return session;
}

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

describe("authenticated user preferences", () => {
  it("requires a trusted session and exposes an uninitialized default", async () => {
    const { app } = createRuntime();
    const unauthenticated = await requestJson(app, "/api/auth/preferences");
    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.body).toEqual({ detail: "登录已失效" });

    const session = await login(app, "first-user");
    const initial = await requestJson(app, "/api/auth/preferences", { token: session.token });
    expect(initial.response.status).toBe(200);
    expect(initial.body).toEqual({
      skin: "default",
      locale: "zh-CN",
      initialized: false,
      updated_at: null,
    });
  });

  it("patches fields independently and isolates preferences by user", async () => {
    const { app } = createRuntime();
    const first = await login(app, "first-user");
    const second = await login(app, "second-user");

    const localeUpdate = await requestJson(app, "/api/auth/preferences", {
      method: "PATCH",
      token: first.token,
      body: { locale: "fr-FR" },
    });
    expect(localeUpdate.body).toEqual({
      skin: "default",
      locale: "fr-FR",
      initialized: true,
      updated_at: expect.any(String),
    });

    const skinUpdate = await requestJson(app, "/api/auth/preferences", {
      method: "PATCH",
      token: first.token,
      body: { skin: "google" },
    });
    expect(skinUpdate.body).toEqual({
      skin: "google",
      locale: "fr-FR",
      initialized: true,
      updated_at: expect.any(String),
    });

    const isolated = await requestJson(app, "/api/auth/preferences", { token: second.token });
    expect(isolated.body).toEqual({
      skin: "default",
      locale: "zh-CN",
      initialized: false,
      updated_at: null,
    });
  });

  it("shares one account preference record between mini-program Bearer and web Cookie sessions", async () => {
    const { app } = createRuntime();
    const mini = await login(app, "cross-client-user");
    await requestJson(app, "/api/auth/preferences", {
      method: "PATCH",
      token: mini.token,
      body: { skin: "google", locale: "fr-FR" },
    });

    const started = await requestJson(app, "/api/v2/auth/web/challenges", {
      method: "POST",
      body: {},
    });
    expect(started.response.status).toBe(200);
    const verifierCookie = started.response.headers.getSetCookie()
      .find(value => value.startsWith("youban_web_login="))
      ?.split(";", 1)[0];
    expect(verifierCookie).toEqual(expect.any(String));
    const approved = await requestJson(
      app,
      `/api/v2/auth/web/challenges/${started.body.challenge_id}/approve`,
      { method: "POST", token: mini.token, body: {} },
    );
    expect(approved.response.status).toBe(200);
    const exchanged = (await requestJson(
      app,
      `/api/v2/auth/web/challenges/${started.body.challenge_id}/exchange`,
      { method: "POST", cookie: verifierCookie, body: {} },
    )).response;
    expect(exchanged.status).toBe(200);
    const cookie = exchanged.headers.getSetCookie()
      .find(value => value.startsWith("youban_session="))
      ?.split(";", 1)[0];
    expect(cookie).toEqual(expect.any(String));

    const webRead = await requestJson(app, "/api/auth/preferences", { cookie });
    expect(webRead.body).toMatchObject({ skin: "google", locale: "fr-FR", initialized: true });
    await requestJson(app, "/api/auth/preferences", {
      method: "PATCH",
      cookie,
      body: { skin: "default", locale: "zh-CN" },
    });

    const miniRead = await requestJson(app, "/api/auth/preferences", { token: mini.token });
    expect(miniRead.body).toMatchObject({ skin: "default", locale: "zh-CN", initialized: true });
  });

  it("rejects empty and unsupported preference patches", async () => {
    const { app } = createRuntime();
    const session = await login(app, "validation-user");
    for (const body of [{}, { skin: "blue" }, { locale: "ja-JP" }]) {
      const invalid = await requestJson(app, "/api/auth/preferences", {
        method: "PATCH",
        token: session.token,
        body,
      });
      expect(invalid.response.status).toBe(422);
      expect(invalid.body.detail).toEqual(expect.any(String));
    }
  });
});
