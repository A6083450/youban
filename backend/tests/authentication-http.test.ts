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
  options: { miniProgramCode?: boolean } = {},
) {
  dataDir = mkdtempSync(join(tmpdir(), "youban-auth-http-"));
  runtime = createHttpRuntime({
    dataDir,
    authentication: {
      pepper: "http-test-pepper-with-at-least-32-bytes",
      exchangeWechatCode: async (code) => {
        if (code === "bad") throw new Error("invalid code");
        return {
          openid: `openid-for-${code}`,
          ...(code === "openid-only" ? {} : { unionid: `unionid-for-${code}` }),
        };
      },
      createMiniProgramCode: options.miniProgramCode === false
        ? undefined
        : async scene => `data:image/png;base64,${Buffer.from(scene).toString("base64")}`,
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

  it("logs in repeatedly when WeChat returns only openid", async () => {
    const { app } = createRuntime();

    const firstResponse = await post(app, "/api/v2/auth/wechat/login", { code: "openid-only" });
    const secondResponse = await post(app, "/api/v2/auth/wechat/login", { code: "openid-only" });
    const first = await json(firstResponse);
    const second = await json(secondResponse);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(second.user.user_id).toBe(first.user.user_id);
    expect(second.token).not.toBe(first.token);
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
    expect((await post(app, "/api/v2/auth/web/challenges", {})).status).toBe(200);
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

  it("creates, approves, and exchanges a browser-bound mini-program Web login", async () => {
    const { app } = createRuntime();
    const createdResponse = await post(app, "/api/v2/auth/web/challenges", {});
    const created = await json(createdResponse);

    expect(createdResponse.status).toBe(200);
    expect(created.challenge_id).toMatch(/^[0-9a-f]{32}$/);
    expect(created.expires_at).toEqual(expect.any(String));
    expect(created.qr_code_data_url).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(created)).not.toContain("verifier");
    const verifierCookie = cookiePair(createdResponse, "youban_web_login");
    expect(createdResponse.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(createdResponse.headers.get("set-cookie")).toContain("Path=/api/v2/auth/web/challenges");

    const mini = await json(await post(app, "/api/auth/wechat/login", { code: "web-user" }));
    expect((await uploadAvatar(app, mini.token)).status).toBe(200);
    const approved = await post(
      app,
      `/api/v2/auth/web/challenges/${created.challenge_id}/approve`,
      {},
      { authorization: `Bearer ${mini.token}` },
    );
    expect(approved.status).toBe(200);
    expect(await json(approved)).toEqual({ success: true });

    const statusResponse = await app.handle(new Request(
      `http://localhost/api/v2/auth/web/challenges/${created.challenge_id}/status`,
      { headers: { cookie: verifierCookie } },
    ));
    expect(statusResponse.status).toBe(200);
    expect(await json(statusResponse)).toEqual({ status: "approved" });

    const exchanged = await post(
      app,
      `/api/v2/auth/web/challenges/${created.challenge_id}/exchange`,
      {},
      { cookie: verifierCookie },
    );
    const exchangeBody = await json(exchanged);
    const setCookies = exchanged.headers.getSetCookie().join("\n");
    expect(exchanged.status).toBe(200);
    expect(setCookies).toContain("youban_session=");
    expect(setCookies).toContain("youban_web_login=; HttpOnly; Secure; SameSite=Lax");
    expect(setCookies).toContain("Max-Age=0");
    expect(exchangeBody).toMatchObject({ success: true, user: { user_id: mini.user.user_id } });
    expect(exchangeBody.token).toBeUndefined();

    const sessionCookie = cookiePair(exchanged, "youban_session");
    const me = await app.handle(new Request("http://localhost/api/v2/auth/me", {
      headers: { cookie: sessionCookie },
    }));
    expect(me.status).toBe(200);
    expect((await json(me)).user.user_id).toBe(mini.user.user_id);

    const nextChallenge = await json(await post(app, "/api/v2/auth/web/challenges", {}));
    const webApproval = await post(
      app,
      `/api/v2/auth/web/challenges/${nextChallenge.challenge_id}/approve`,
      {},
      { cookie: sessionCookie },
    );
    expect(webApproval.status).toBe(401);
    expect(await json(webApproval)).toEqual({ detail: "请先选择微信头像完成登录" });

    const replayed = await post(
      app,
      `/api/v2/auth/web/challenges/${created.challenge_id}/exchange`,
      {},
      { cookie: verifierCookie },
    );
    expect(replayed.status).toBe(422);
  });

  it("rejects wrong browsers, incomplete users, conflicting approvers, and expired challenges", async () => {
    const instance = createRuntime();
    const { app } = instance;
    const createdResponse = await post(app, "/api/v2/auth/web/challenges", {});
    const created = await json(createdResponse);
    const statusUrl = `http://localhost/api/v2/auth/web/challenges/${created.challenge_id}/status`;
    const forged = await app.handle(new Request(statusUrl, {
      headers: { cookie: "youban_web_login=wrong-browser" },
    }));
    expect(forged.status).toBe(422);
    expect(await json(forged)).toEqual({ detail: "网页登录凭证无效或已过期" });

    const incomplete = await json(await post(app, "/api/auth/wechat/login", { code: "incomplete-web" }));
    const rejectedApproval = await post(
      app,
      `/api/v2/auth/web/challenges/${created.challenge_id}/approve`,
      {},
      { authorization: `Bearer ${incomplete.token}` },
    );
    expect(rejectedApproval.status).toBe(401);
    expect(await json(rejectedApproval)).toEqual({ detail: "请先选择微信头像完成登录" });

    const first = await json(await post(app, "/api/auth/wechat/login", { code: "first-approver" }));
    const second = await json(await post(app, "/api/auth/wechat/login", { code: "second-approver" }));
    expect((await uploadAvatar(app, first.token)).status).toBe(200);
    expect((await uploadAvatar(app, second.token)).status).toBe(200);
    expect((await post(
      app,
      `/api/v2/auth/web/challenges/${created.challenge_id}/approve`,
      {},
      { authorization: `Bearer ${first.token}` },
    )).status).toBe(200);
    const conflict = await post(
      app,
      `/api/v2/auth/web/challenges/${created.challenge_id}/approve`,
      {},
      { authorization: `Bearer ${second.token}` },
    );
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toEqual({ detail: "登录挑战已由其他账号确认" });

    instance.authentication!.database.raw.query(
      "UPDATE web_login_challenges SET expires_at = ? WHERE challenge_id = ?",
    ).run("2000-01-01T00:00:00.000Z", created.challenge_id);
    const verifierCookie = cookiePair(createdResponse, "youban_web_login");
    const expired = await app.handle(new Request(statusUrl, { headers: { cookie: verifierCookie } }));
    expect(expired.status).toBe(200);
    expect(await json(expired)).toEqual({ status: "expired" });
    const expiredExchange = await post(
      app,
      `/api/v2/auth/web/challenges/${created.challenge_id}/exchange`,
      {},
      { cookie: verifierCookie },
    );
    expect(expiredExchange.status).toBe(422);
  });

  it("returns a stable provider error and retires Website OAuth routes", async () => {
    const { app } = createRuntime(undefined, { miniProgramCode: false });
    const unavailable = await post(app, "/api/v2/auth/web/challenges", {});
    expect(unavailable.status).toBe(503);
    expect(await json(unavailable)).toEqual({ detail: "微信扫码登录暂不可用" });
    expect((await post(app, "/api/v2/auth/wechat-web/start", {})).status).toBe(404);
    expect((await app.handle(new Request(
      "http://localhost/api/v2/auth/wechat-web/callback?code=value&state=value",
    ))).status).toBe(404);
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
