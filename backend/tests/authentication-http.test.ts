import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpRuntime, type HttpRuntime } from "../src/http/app.ts";
import { createTaskState } from "../src/domain/task-store.ts";
import type { UserMemoryService } from "../src/services/hermes-memory.ts";

let runtime: HttpRuntime | undefined;
let dataDir = "";

function createRuntime(
  memory?: UserMemoryService,
  options: { website?: boolean } = {},
) {
  dataDir = mkdtempSync(join(tmpdir(), "youban-auth-http-"));
  const website = options.website === false
    ? undefined
    : {
        appId: "wx-web-app",
        redirectUri: "https://youban.me/api/v2/auth/wechat-web/callback",
        exchangeCode: async (code: string) => {
          if (code === "provider-failure") {
            throw new Error("provider-secret temporary-code must not leak");
          }
          return {
            openid: `web-openid-for-${code}`,
            unionid: code === "identity-failure" ? "" : `unionid-for-${code}`,
            nickname: "网页用户",
            avatarUrl: "",
          };
        },
        importAvatar: async () => null,
      };
  runtime = createHttpRuntime({
    dataDir,
    authentication: {
      pepper: "http-test-pepper-with-at-least-32-bytes",
      exchangeWechatCode: async (code) => {
        if (code === "bad") throw new Error("invalid code");
        return {
          openid: `openid-for-${code}`,
          unionid: `unionid-for-${code}`,
        };
      },
      website,
    },
    memory,
  });
  return runtime;
}

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

async function post(app: HttpRuntime["app"], path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

async function uploadAvatar(app: HttpRuntime["app"], token: string) {
  const form = new FormData();
  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ));
  form.set("avatar", new File([png], "wechat-avatar.png", { type: "image/png" }));
  const response = await app.handle(new Request("http://localhost/api/account/profile/avatar", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  }));
  return { status: response.status, png, profile: await json(response) };
}

function cookiePair(response: Response, name: string): string {
  const values = response.headers.getSetCookie();
  const value = values.find(cookie => cookie.startsWith(`${name}=`));
  if (!value) throw new Error(`missing ${name} cookie`);
  return value.split(";", 1)[0]!;
}

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

describe("unified authentication HTTP", () => {
  it("logs in with a WeChat code, accepts Bearer, and rejects forged x-user-id", async () => {
    const { app } = createRuntime();
    const loginResponse = await post(app, "/api/auth/wechat/login", { code: "wx-code" });
    expect(loginResponse.status).toBe(200);
    const login = await json(loginResponse);
    expect(login.token).toEqual(expect.any(String));
    expect(JSON.stringify(login)).not.toContain("openid");
    expect(login.user).toMatchObject({ avatar_url: null, profile_complete: false });

    const forged = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { "x-user-id": login.user.user_id },
    }));
    expect(forged.status).toBe(401);

    const incompleteMe = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { authorization: `Bearer ${login.token}` },
    }));
    expect(incompleteMe.status).toBe(401);

    expect((await uploadAvatar(app, login.token)).status).toBe(200);
    const me = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { authorization: `Bearer ${login.token}` },
    }));
    expect(me.status).toBe(200);
    expect((await json(me)).user.user_id).toBe(login.user.user_id);
    const v2Me = await app.handle(new Request("http://localhost/api/v2/auth/me", {
      headers: { authorization: `Bearer ${login.token}` },
    }));
    expect(v2Me.status).toBe(200);
    expect((await json(v2Me)).user.user_id).toBe(login.user.user_id);

    const logout = await post(app, "/api/auth/logout", {}, { authorization: `Bearer ${login.token}` });
    expect(logout.status).toBe(200);
    const revoked = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { authorization: `Bearer ${login.token}` },
    }));
    expect(revoked.status).toBe(401);
  });

  it("logs the website into one historical nickname account with an HttpOnly cookie", async () => {
    const instance = createRuntime();
    const { app } = instance;
    instance.authentication!.database.raw.query(`
      INSERT INTO users (
        user_id, nickname, avatar_file, profile_completed_at, created_at, last_login_at
      ) VALUES (?, ?, NULL, NULL, ?, ?)
    `).run("legacy-user", "Neo User", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");

    const first = await post(app, "/api/v2/auth/nickname", { nickname: "  neo   user  " });
    expect(first.status).toBe(200);
    const firstBody = await json(first);
    expect(firstBody).toEqual({
      success: true,
      user: expect.objectContaining({
        user_id: "legacy-user",
        nickname: "Neo User",
        avatar_url: null,
        profile_complete: true,
      }),
    });
    expect(firstBody).not.toHaveProperty("token");
    expect(first.headers.get("set-cookie")).toContain("youban_session=");
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");

    const me = await app.handle(new Request("http://localhost/api/v2/auth/me", {
      headers: { cookie: cookiePair(first, "youban_session") },
    }));
    expect(me.status).toBe(200);
    expect((await json(me)).user.user_id).toBe("legacy-user");

    const repeated = await post(app, "/api/v2/auth/nickname", { nickname: "ＮＥＯ USER" });
    expect((await json(repeated)).user.user_id).toBe("legacy-user");
  });

  it("validates nickname login and keeps legacy account migration routes removed", async () => {
    const { app } = createRuntime();
    expect((await post(app, "/api/v2/auth/nickname", { nickname: "   " })).status).toBe(422);
    expect((await post(app, "/api/v2/auth/nickname", { nickname: "超过二十个字符的昵称不应该被网站登录接口接受" })).status).toBe(422);
    const login = await json(await post(app, "/api/auth/wechat/login", { code: "no-legacy" }));
    expect((await uploadAvatar(app, login.token)).status).toBe(200);
    const authorization = { authorization: `Bearer ${login.token}` };
    expect((await post(app, "/api/account/migration/claim", { code: "OLD-CODE" }, {
      ...authorization,
    })).status).toBe(404);
    expect((await post(app, "/api/admin/users/legacy-user/migration-code", {}, {
      "x-admin-token": "admin@123",
    })).status).toBe(404);
  });

  it("rejects forged identity on private collections while keeping public bootstrap routes open", async () => {
    const { app } = createRuntime();
    for (const path of ["/api/trip/history", "/api/conversations"]) {
      const response = await app.handle(new Request(`http://localhost${path}`, {
        headers: { "x-user-id": "forged-user" },
      }));
      expect(response.status).toBe(401);
      expect(await json(response)).toEqual({ detail: "登录已失效" });
    }

    expect((await app.handle(new Request("http://localhost/health"))).status).toBe(200);
    expect((await app.handle(new Request("http://localhost/api/settings"))).status).toBe(200);
    expect((await post(app, "/api/v2/auth/wechat-web/start", {})).status).toBe(200);
  });

  it("does not grant private API access to an avatar-incomplete mini-program session", async () => {
    const { app } = createRuntime();
    const login = await json(await post(app, "/api/auth/wechat/login", { code: "incomplete-user" }));
    const authorization = { authorization: `Bearer ${login.token}` };

    expect((await app.handle(new Request("http://localhost/api/trip/history", { headers: authorization }))).status)
      .toBe(401);
    expect((await app.handle(new Request("http://localhost/api/auth/me", { headers: authorization }))).status)
      .toBe(401);
    expect((await post(app, "/api/account/profile/skip-avatar", {}, authorization)).status).toBe(404);
  });

  it("stores a chosen WeChat avatar and returns it to every session for the same account", async () => {
    const { app } = createRuntime();
    const first = await json(await post(app, "/api/auth/wechat/login", { code: "avatar-user" }));
    const { status: uploadStatus, png, profile } = await uploadAvatar(app, first.token);
    expect(uploadStatus).toBe(200);
    expect(profile.user.avatar_url).toMatch(/^\/api\/avatars\/[a-f0-9]{32}\.png$/);
    expect(profile.user.profile_complete).toBe(true);

    const avatar = await app.handle(new Request(`http://localhost${profile.user.avatar_url}`));
    expect(avatar.status).toBe(200);
    expect(avatar.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await avatar.arrayBuffer())).toEqual(png);

    const second = await json(await post(app, "/api/auth/wechat/login", { code: "avatar-user" }));
    expect(second.user.avatar_url).toBe(profile.user.avatar_url);
    expect(second.user.profile_complete).toBe(true);
  });

  it("does not expose the old skip-avatar setup route", async () => {
    const { app } = createRuntime();
    const login = await json(await post(app, "/api/auth/wechat/login", { code: "avatar-skip" }));
    const skipped = await post(app, "/api/account/profile/skip-avatar", {}, {
      authorization: `Bearer ${login.token}`,
    });
    expect(skipped.status).toBe(404);
  });

  it("starts and completes browser-bound official WeChat website login", async () => {
    const { app } = createRuntime();
    const start = await post(app, "/api/v2/auth/wechat-web/start", {});
    const configuration = await json(start);

    expect(start.status).toBe(200);
    expect(configuration).toMatchObject({
      app_id: "wx-web-app",
      scope: "snsapi_login",
      redirect_uri: "https://youban.me/api/v2/auth/wechat-web/callback",
    });
    expect(configuration.state).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(configuration)).not.toContain("secret");
    const verifierCookie = cookiePair(start, "youban_wechat_oauth");
    expect(start.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(start.headers.get("set-cookie")).toContain("Path=/api/v2/auth/wechat-web");

    const callback = await app.handle(new Request(
      `http://localhost/api/v2/auth/wechat-web/callback?code=web-user&state=${encodeURIComponent(configuration.state)}`,
      { headers: { cookie: verifierCookie } },
    ));
    const html = await callback.text();
    const setCookies = callback.headers.getSetCookie().join("\n");
    expect(callback.status).toBe(200);
    expect(callback.headers.get("content-type")).toContain("text/html");
    expect(setCookies).toContain("youban_session=");
    expect(setCookies).toContain("youban_wechat_oauth=; HttpOnly; Secure; SameSite=Lax");
    expect(setCookies).toContain("Max-Age=0");
    expect(html).toContain("window.top.location.replace");
    expect(html).toContain("/#/pages/index/index");

    const sessionCookie = cookiePair(callback, "youban_session");
    const me = await app.handle(new Request("http://localhost/api/v2/auth/me", {
      headers: { cookie: sessionCookie },
    }));
    expect(me.status).toBe(200);
    expect((await json(me)).user).toMatchObject({
      nickname: "网页用户",
      avatar_url: null,
      profile_complete: true,
    });
  });

  it("rejects cross-browser, expired, and replayed website OAuth state", async () => {
    const instance = createRuntime();
    const { app } = instance;
    const start = await post(app, "/api/v2/auth/wechat-web/start", {});
    const configuration = await json(start);
    const verifierCookie = cookiePair(start, "youban_wechat_oauth");
    const callbackUrl =
      `http://localhost/api/v2/auth/wechat-web/callback?code=state-user&state=${encodeURIComponent(configuration.state)}`;

    const forged = await app.handle(new Request(callbackUrl, {
      headers: { cookie: "youban_wechat_oauth=wrong-browser" },
    }));
    expect(await forged.text()).toContain("wechat_error=expired");
    expect(forged.headers.getSetCookie().join("\n")).not.toContain("youban_session=");

    const accepted = await app.handle(new Request(callbackUrl, {
      headers: { cookie: verifierCookie },
    }));
    expect(await accepted.text()).toContain("/#/pages/index/index");

    const replayed = await app.handle(new Request(callbackUrl, {
      headers: { cookie: verifierCookie },
    }));
    expect(await replayed.text()).toContain("wechat_error=expired");
    expect(replayed.headers.getSetCookie().join("\n")).not.toContain("youban_session=");

    const expiringStart = await post(app, "/api/v2/auth/wechat-web/start", {});
    const expiring = await json(expiringStart);
    instance.authentication!.database.raw.query(
      "UPDATE wechat_web_oauth_states SET expires_at = ? WHERE consumed_at IS NULL",
    ).run("2000-01-01T00:00:00.000Z");
    const expired = await app.handle(new Request(
      `http://localhost/api/v2/auth/wechat-web/callback?code=expired-user&state=${encodeURIComponent(expiring.state)}`,
      { headers: { cookie: cookiePair(expiringStart, "youban_wechat_oauth") } },
    ));
    expect(await expired.text()).toContain("wechat_error=expired");
  });

  it("maps callback failures to fixed non-sensitive completion pages", async () => {
    const { app } = createRuntime();
    const start = await post(app, "/api/v2/auth/wechat-web/start", {});
    const configuration = await json(start);
    const verifierCookie = cookiePair(start, "youban_wechat_oauth");
    const provider = await app.handle(new Request(
      `http://localhost/api/v2/auth/wechat-web/callback?code=provider-failure&state=${encodeURIComponent(configuration.state)}`,
      { headers: { cookie: verifierCookie } },
    ));
    const providerHtml = await provider.text();
    expect(providerHtml).toContain("wechat_error=provider");
    expect(providerHtml).not.toContain("provider-secret");
    expect(providerHtml).not.toContain("temporary-code");

    const denied = await app.handle(new Request(
      "http://localhost/api/v2/auth/wechat-web/callback?state=%3Cscript%3Eraw%3C%2Fscript%3E",
    ));
    const deniedHtml = await denied.text();
    expect(deniedHtml).toContain("wechat_error=denied");
    expect(deniedHtml).not.toContain("<script>raw</script>");

    const identityStart = await post(app, "/api/v2/auth/wechat-web/start", {});
    const identityConfiguration = await json(identityStart);
    const identity = await app.handle(new Request(
      `http://localhost/api/v2/auth/wechat-web/callback?code=identity-failure&state=${encodeURIComponent(identityConfiguration.state)}`,
      { headers: { cookie: cookiePair(identityStart, "youban_wechat_oauth") } },
    ));
    expect(await identity.text()).toContain("wechat_error=identity");
  });

  it("returns a stable configuration error and retires every custom challenge route", async () => {
    const { app } = createRuntime(undefined, { website: false });
    const unavailable = await post(app, "/api/v2/auth/wechat-web/start", {});
    expect(unavailable.status).toBe(503);
    expect(await json(unavailable)).toEqual({ detail: "微信扫码登录尚未配置" });

    expect((await post(app, "/api/v2/auth/web/challenges", {})).status).toBe(404);
    expect((await app.handle(new Request(
      "http://localhost/api/v2/auth/web/challenges/challenge/status?verifier=value",
    ))).status).toBe(404);
    expect((await post(app, "/api/v2/auth/web/challenges/challenge/approve", {
      credential: "value",
    })).status).toBe(404);
    expect((await post(app, "/api/v2/auth/web/challenges/challenge/exchange", {
      verifier: "value",
    })).status).toBe(404);
  });

  it("lists and revokes device sessions without exposing token hashes", async () => {
    const { app } = createRuntime();
    const first = await json(await post(app, "/api/auth/wechat/login", { code: "device-user" }));
    const second = await json(await post(app, "/api/auth/wechat/login", { code: "device-user" }));
    expect((await uploadAvatar(app, second.token)).status).toBe(200);
    const response = await app.handle(new Request("http://localhost/api/auth/sessions", {
      headers: { authorization: `Bearer ${second.token}` },
    }));
    const sessions = await json(response);
    expect(response.status).toBe(200);
    expect(JSON.stringify(sessions)).not.toContain("token_hash");
    const previous = sessions.items.find((item: any) => !item.current);
    const revoked = await app.handle(new Request(`http://localhost/api/auth/sessions/${previous.session_id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${second.token}` },
    }));
    expect(revoked.status).toBe(200);
    const oldMe = await app.handle(new Request("http://localhost/api/auth/me", {
      headers: { authorization: `Bearer ${first.token}` },
    }));
    expect(oldMe.status).toBe(401);
  });

  it("hands a ready mini-program session to Web through a one-time clean redirect", async () => {
    const { app } = createRuntime();
    const mini = await json(await post(app, "/api/auth/wechat/login", { code: "webview-user" }));
    expect((await uploadAvatar(app, mini.token)).status).toBe(200);

    const missing = await post(app, "/api/auth/miniprogram/web-session", { path: "/" });
    expect(missing.status).toBe(401);
    const invalid = await post(app, "/api/auth/miniprogram/web-session", { path: "/admin" }, {
      authorization: `Bearer ${mini.token}`,
    });
    expect(invalid.status).toBe(422);

    const createdResponse = await post(app, "/api/auth/miniprogram/web-session", {
      path: "/plan/plan-123?section=weather",
    }, { authorization: `Bearer ${mini.token}` });
    expect(createdResponse.status).toBe(200);
    const created = await json(createdResponse);
    expect(created.exchange_url).toMatch(/^\/api\/auth\/miniprogram\/web-session\/exchange\?ticket=/);
    expect(created.exchange_url).not.toContain("plan-123");

    const exchange = await app.handle(new Request(`http://localhost${created.exchange_url}`));
    expect(exchange.status).toBe(303);
    expect(exchange.headers.get("location")).toBe("/plan/plan-123?host=miniprogram&section=weather");
    expect(exchange.headers.get("set-cookie")).toContain("youban_session=");
    expect(exchange.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(exchange.headers.get("clear-site-data")).toBe('"cache", "storage"');

    const repeated = await app.handle(new Request(`http://localhost${created.exchange_url}`));
    expect(repeated.status).toBe(422);
  });

  it("gives public mini-program WebViews a no-login cache-reset redirect", async () => {
    const { app } = createRuntime();
    const path = encodeURIComponent(`/share/${"a".repeat(32)}?host=miniprogram`);
    const response = await app.handle(new Request(
      `http://localhost/api/auth/miniprogram/web-session/public?path=${path}`,
    ));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/share/${"a".repeat(32)}?host=miniprogram`);
    expect(response.headers.get("clear-site-data")).toBe('"cache", "storage"');
    expect(response.headers.get("set-cookie")).toBeNull();

    for (const rejectedPath of ["/", "/plan/private-plan", "/admin", "https://evil.example/"]) {
      const rejected = await app.handle(new Request(
        `http://localhost/api/auth/miniprogram/web-session/public?path=${encodeURIComponent(rejectedPath)}`,
      ));
      expect(rejected.status).toBe(422);
    }
  });

  it("projects and protects generic native actions for share, calendar, and guide images", async () => {
    const instance = createRuntime();
    const { app, tasks } = instance;
    const owner = await json(await post(app, "/api/auth/wechat/login", { code: "action-owner" }));
    expect((await uploadAvatar(app, owner.token)).status).toBe(200);
    const intruder = await json(await post(app, "/api/auth/wechat/login", { code: "action-intruder" }));
    expect((await uploadAvatar(app, intruder.token)).status).toBe(200);
    tasks.save(createTaskState("plan-bridge", {
      status: "completed",
      stage: "completed",
      progress: 100,
      user_id: owner.user.user_id,
      result: {
        success: true,
        plan_id: "plan-bridge",
        data: {
          city: "乌鲁木齐",
          start_date: "2026-09-01",
          end_date: "2026-09-01",
          days: [{
            date: "2026-09-01",
            day_index: 0,
            city: "乌鲁木齐",
            description: "抵达并游览",
            attractions: [{
              name: "天山大峡谷",
              address: "乌鲁木齐县",
              description: "峡谷景观",
              start_time: "09:30",
              visit_duration: 120,
            }],
            meals: [],
          }],
          weather_info: [],
          overall_suggestions: "",
        },
      },
    }), { immediate: true });
    const ownerHeaders = { authorization: `Bearer ${owner.token}` };

    const calendarResponse = await post(app, "/api/miniprogram/actions", {
      type: "add_calendar",
      plan_id: "plan-bridge",
    }, ownerHeaders);
    expect(calendarResponse.status).toBe(200);
    const calendarTicket = await json(calendarResponse);
    const calendar = await app.handle(new Request(
      `http://localhost/api/miniprogram/actions/${calendarTicket.action_id}`,
      { headers: ownerHeaders },
    ));
    expect(await json(calendar)).toMatchObject({
      type: "add_calendar",
      payload: {
        title: "乌鲁木齐行程",
        events: [{ title: "天山大峡谷", location: "乌鲁木齐县" }],
      },
    });

    const denied = await app.handle(new Request(
      `http://localhost/api/miniprogram/actions/${calendarTicket.action_id}`,
      { headers: { authorization: `Bearer ${intruder.token}` } },
    ));
    expect(denied.status).toBe(403);

    const shareResponse = await post(app, "/api/miniprogram/actions", {
      type: "share",
      plan_id: "plan-bridge",
    }, ownerHeaders);
    const shareTicket = await json(shareResponse);
    const share = await json(await app.handle(new Request(
      `http://localhost/api/miniprogram/actions/${shareTicket.action_id}`,
      { headers: ownerHeaders },
    )));
    expect(share.payload.share_code).toMatch(/^[a-f0-9]{32}$/);

    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const guideResponse = await post(app, "/api/miniprogram/actions", {
      type: "save_guide",
      plan_id: "plan-bridge",
      title: "乌鲁木齐攻略",
      image_data_url: png,
    }, ownerHeaders);
    expect(guideResponse.status).toBe(200);
    const guideTicket = await json(guideResponse);
    const guide = await json(await app.handle(new Request(
      `http://localhost/api/miniprogram/actions/${guideTicket.action_id}`,
      { headers: ownerHeaders },
    )));
    const image = await app.handle(new Request(`http://localhost${guide.payload.download_url}`, {
      headers: ownerHeaders,
    }));
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");

    const completed = await post(app, `/api/miniprogram/actions/${guideTicket.action_id}/complete`, {}, ownerHeaders);
    expect(completed.status).toBe(200);
    const removed = await app.handle(new Request(`http://localhost${guide.payload.download_url}`, {
      headers: ownerHeaders,
    }));
    expect(removed.status).toBe(404);
  });

});
