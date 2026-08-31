import { afterEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthenticationService } from "../src/domain/authentication.ts";

const directories: string[] = [];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "youban-auth-"));
  directories.push(directory);
  let now = Date.parse("2026-08-26T00:00:00.000Z");
  let sequence = 0;
  const auth = new AuthenticationService(join(directory, "youban.db"), {
    pepper: "test-pepper-with-at-least-32-bytes",
    now: () => now,
    randomBytes: (length) => Buffer.alloc(length, ++sequence),
  });
  return {
    auth,
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("AuthenticationService", () => {
  it("binds each website OAuth state to one browser and consumes it once", () => {
    const { auth } = fixture();
    const challenge = auth.createWechatWebOauthState();

    const stored = JSON.stringify(auth.database.raw.query(
      "SELECT state_hash, browser_verifier_hash FROM wechat_web_oauth_states",
    ).all());
    expect(stored).not.toContain(challenge.state);
    expect(stored).not.toContain(challenge.browserVerifier);
    expect(() => auth.consumeWechatWebOauthState(challenge.state, "wrong-browser"))
      .toThrow("网页登录凭证无效或已过期");
    expect(auth.consumeWechatWebOauthState(
      challenge.state,
      challenge.browserVerifier,
    )).toBeUndefined();
    expect(() => auth.consumeWechatWebOauthState(
      challenge.state,
      challenge.browserVerifier,
    )).toThrow("网页登录凭证无效或已过期");
    auth.close();
  });

  it("expires website OAuth state at the exact five-minute boundary", () => {
    const { auth, advance } = fixture();
    const challenge = auth.createWechatWebOauthState();

    advance(5 * 60 * 1_000);

    expect(() => auth.consumeWechatWebOauthState(
      challenge.state,
      challenge.browserVerifier,
    )).toThrow("网页登录凭证无效或已过期");
    auth.close();
  });

  it("registers a website profile and resolves mini-program login by shared UnionID", () => {
    const { auth } = fixture();
    const website = auth.loginWebsiteIdentity({
      unionid: "shared-unionid",
      nickname: "旅行者",
      avatarFile: null,
    });
    const repeated = auth.loginWebsiteIdentity({
      unionid: "shared-unionid",
      nickname: "旅行者",
      avatarFile: null,
    });
    const mini = auth.loginMiniProgramIdentity({
      openid: "mini-openid",
      unionid: "shared-unionid",
    });

    expect(website.user).toMatchObject({
      nickname: "旅行者",
      avatar_url: null,
      profile_complete: true,
    });
    expect(repeated.user.user_id).toBe(website.user.user_id);
    expect(repeated.token).not.toBe(website.token);
    expect(mini.user.user_id).toBe(website.user.user_id);
    expect(auth.authenticateReady(website.token)?.user_id).toBe(website.user.user_id);
    const stored = JSON.stringify(auth.database.raw.query("SELECT * FROM wechat_identities").all());
    expect(stored).not.toContain("shared-unionid");
    expect(stored).not.toContain("mini-openid");
    auth.close();
  });

  it("uses a fixed fallback for an empty website nickname", () => {
    const { auth } = fixture();

    const website = auth.loginWebsiteIdentity({
      unionid: "website-only-unionid",
      nickname: "   ",
      avatarFile: null,
    });

    expect(website.user).toMatchObject({
      nickname: "微信用户",
      avatar_url: null,
      profile_complete: true,
    });
    auth.close();
  });

  it("upgrades a legacy openid digest during the next mini-program login", () => {
    const { auth } = fixture();
    const legacy = auth.loginMiniProgramIdentity({
      openid: "legacy-openid",
      unionid: "temporary-unionid",
    });
    const unionDigest = createHmac("sha256", "test-pepper-with-at-least-32-bytes")
      .update("wechat-identity\0wechat:unionid:temporary-unionid")
      .digest("hex");
    auth.database.raw.query("DELETE FROM wechat_identities WHERE subject_digest = ?")
      .run(unionDigest);

    const upgraded = auth.loginMiniProgramIdentity({
      openid: "legacy-openid",
      unionid: "upgraded-unionid",
    });

    expect(upgraded.user.user_id).toBe(legacy.user.user_id);
    const identities = auth.database.raw.query(
      "SELECT subject_digest, user_id FROM wechat_identities ORDER BY subject_digest",
    ).all() as Array<{ subject_digest: string; user_id: string }>;
    expect(identities).toHaveLength(2);
    expect(new Set(identities.map(identity => identity.user_id))).toEqual(
      new Set([legacy.user.user_id]),
    );
    expect(JSON.stringify(identities)).not.toContain("legacy-openid");
    expect(JSON.stringify(identities)).not.toContain("upgraded-unionid");
    auth.close();
  });

  it("maps repeated WeChat logins to one user without persisting the raw subject", () => {
    const { auth } = fixture();
    const identity = { openid: "openid-sensitive-value", unionid: "union-sensitive-value" };
    const first = auth.loginMiniProgramIdentity(identity);
    const second = auth.loginMiniProgramIdentity(identity);

    expect(second.user.user_id).toBe(first.user.user_id);
    expect(second.token).not.toBe(first.token);
    const stored = JSON.stringify(auth.database.raw.query("SELECT * FROM wechat_identities").all());
    expect(stored).not.toContain("openid-sensitive-value");
    expect(stored).not.toContain("union-sensitive-value");
    expect(auth.authenticate(second.token)?.user_id).toBe(first.user.user_id);
    auth.close();
  });

  it("slides mini-program sessions, caps them at 90 days, and rejects revoked or expired tokens", () => {
    const { auth, advance } = fixture();
    const identity = { openid: "openid-one", unionid: "union-one" };
    const login = auth.loginMiniProgramIdentity(identity);
    advance(29 * 24 * 60 * 60 * 1_000);
    expect(auth.authenticate(login.token)?.user_id).toBe(login.user.user_id);
    advance(31 * 24 * 60 * 60 * 1_000);
    expect(auth.authenticate(login.token)).toBeUndefined();

    const replacement = auth.loginMiniProgramIdentity(identity);
    expect(auth.logout(replacement.token)).toBe(true);
    expect(auth.authenticate(replacement.token)).toBeUndefined();
    auth.close();
  });

  it("persists first-login profile completion for every session of the WeChat account", () => {
    const { auth } = fixture();
    const identity = { openid: "openid-profile", unionid: "union-profile" };
    const first = auth.loginMiniProgramIdentity(identity);
    expect(first.user).toMatchObject({ avatar_url: null, profile_complete: false });

    const completed = auth.completeProfile(first.token, "0123456789abcdef0123456789abcdef.png");
    expect(completed).toMatchObject({
      avatar_url: "/api/avatars/0123456789abcdef0123456789abcdef.png",
      profile_complete: true,
    });
    expect(auth.loginMiniProgramIdentity(identity).user).toMatchObject(completed);
    auth.close();
  });

  it("lists opaque device sessions and revokes only another session owned by the user", () => {
    const { auth } = fixture();
    const identity = { openid: "openid-sessions", unionid: "union-sessions" };
    const first = auth.loginMiniProgramIdentity(identity);
    const second = auth.loginMiniProgramIdentity(identity);
    const other = auth.loginMiniProgramIdentity({
      openid: "openid-other-user",
      unionid: "union-other-user",
    });
    auth.completeProfile(second.token, "33333333333333333333333333333333.png");
    auth.completeProfile(other.token, "44444444444444444444444444444444.png");

    const sessions = auth.listSessions(second.token);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((item) => item.current)).toEqual(expect.objectContaining({ client_type: "miniprogram" }));
    expect(JSON.stringify(sessions)).not.toContain("token_hash");
    const firstSession = sessions.find((item) => !item.current)!;
    expect(auth.revokeSession(second.token, firstSession.session_id)).toBe(true);
    expect(auth.authenticate(first.token)).toBeUndefined();
    expect(auth.revokeSession(second.token, auth.listSessions(other.token)[0]!.session_id)).toBe(false);
    auth.close();
  });
});
