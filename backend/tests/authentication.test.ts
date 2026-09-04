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
  it("binds each Web challenge to one browser and expires it after five minutes", () => {
    const { auth, advance } = fixture();
    const challenge = auth.createWebChallenge();

    const stored = JSON.stringify(auth.database.raw.query(
      "SELECT verifier_hash, approval_token_hash, short_code_hash FROM web_login_challenges",
    ).all());
    expect(stored).not.toContain(challenge.browserVerifier);
    expect(() => auth.getWebChallengeStatus(challenge.challengeId, "wrong-browser"))
      .toThrow("网页登录凭证无效或已过期");
    expect(auth.getWebChallengeStatus(challenge.challengeId, challenge.browserVerifier))
      .toEqual({ status: "pending" });

    advance(5 * 60 * 1_000);

    expect(auth.getWebChallengeStatus(challenge.challengeId, challenge.browserVerifier))
      .toEqual({ status: "expired" });
    auth.close();
  });

  it("approves idempotently for one ready user and exchanges exactly once", () => {
    const { auth } = fixture();
    const first = auth.loginMiniProgramIdentity({
      openid: "approver-openid",
      unionid: "approver-unionid",
    });
    auth.completeProfile(first.token, "11111111111111111111111111111111.png");
    const other = auth.loginMiniProgramIdentity({
      openid: "other-openid",
      unionid: "other-unionid",
    });
    auth.completeProfile(other.token, "22222222222222222222222222222222.png");
    const challenge = auth.createWebChallenge();

    expect(auth.approveWebChallenge(first.token, challenge.challengeId)).toBeUndefined();
    expect(auth.approveWebChallenge(first.token, challenge.challengeId)).toBeUndefined();
    expect(() => auth.approveWebChallenge(other.token, challenge.challengeId))
      .toThrow("登录挑战已由其他账号确认");
    expect(auth.getWebChallengeStatus(challenge.challengeId, challenge.browserVerifier))
      .toEqual({ status: "approved" });

    const exchanged = auth.exchangeWebChallenge(challenge.challengeId, challenge.browserVerifier);
    expect(exchanged.user.user_id).toBe(first.user.user_id);
    expect(auth.authenticate(exchanged.token)?.user_id).toBe(first.user.user_id);
    expect(auth.getWebChallengeStatus(challenge.challengeId, challenge.browserVerifier))
      .toEqual({ status: "exchanged" });
    expect(() => auth.exchangeWebChallenge(challenge.challengeId, challenge.browserVerifier))
      .toThrow("登录挑战已兑换");
    auth.close();
  });

  it("claims a Web challenge for the first ready mini-program user", () => {
    const { auth } = fixture();
    const first = auth.loginMiniProgramIdentity({ openid: "scanner-one" });
    const other = auth.loginMiniProgramIdentity({ openid: "scanner-two" });
    auth.completeProfile(first.token, "11111111111111111111111111111111.png");
    auth.completeProfile(other.token, "22222222222222222222222222222222.png");
    const challenge = auth.createWebChallenge();

    expect(auth.claimWebChallenge(first.token, challenge.challengeId)).toBeUndefined();
    expect(auth.claimWebChallenge(first.token, challenge.challengeId)).toBeUndefined();
    expect(auth.getWebChallengeStatus(challenge.challengeId, challenge.browserVerifier))
      .toEqual({ status: "scanned" });
    expect(() => auth.claimWebChallenge(other.token, challenge.challengeId))
      .toThrow("登录挑战已由其他账号扫码");

    auth.approveWebChallenge(first.token, challenge.challengeId);
    expect(auth.getWebChallengeStatus(challenge.challengeId, challenge.browserVerifier))
      .toEqual({ status: "approved" });
    auth.close();
  });

  it("allows a newly authenticated WeChat user to approve a Web challenge", () => {
    const { auth } = fixture();
    const user = auth.loginMiniProgramIdentity({
      openid: "ready-openid",
      unionid: "ready-unionid",
    });
    const challenge = auth.createWebChallenge();

    expect(() => auth.approveWebChallenge(user.token, challenge.challengeId)).not.toThrow();
    expect(auth.getWebChallengeStatus(challenge.challengeId, challenge.browserVerifier))
      .toEqual({ status: "approved" });
    auth.close();
  });

  it("reuses a normalized historical nickname account without merging a same-name WeChat identity", () => {
    const { auth } = fixture();
    const wechat = auth.loginMiniProgramIdentity({
      openid: "same-name-wechat-openid",
      unionid: "same-name-wechat-unionid",
    });
    auth.database.raw.query("UPDATE users SET nickname = ? WHERE user_id = ?")
      .run("Neo User", wechat.user.user_id);
    auth.database.raw.query(`
      INSERT INTO users (
        user_id, nickname, avatar_file, profile_completed_at, created_at, last_login_at
      ) VALUES (?, ?, NULL, NULL, ?, ?)
    `).run("legacy-nickname-user", "Ｎｅｏ User", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");

    const first = auth.loginNicknameIdentity("  neo   user  ");
    const repeated = auth.loginNicknameIdentity("NEO USER");

    expect(first.user).toMatchObject({
      user_id: "legacy-nickname-user",
      nickname: "Ｎｅｏ User",
      avatar_url: null,
      profile_complete: true,
    });
    expect(repeated.user.user_id).toBe(first.user.user_id);
    expect(first.user.user_id).not.toBe(wechat.user.user_id);
    expect(repeated.token).not.toBe(first.token);
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

  it("reuses an openid-only account and attaches UnionID when it becomes available", () => {
    const { auth } = fixture();
    const first = auth.loginMiniProgramIdentity({ openid: "openid-only" });
    const repeated = auth.loginMiniProgramIdentity({ openid: "openid-only" });

    expect(repeated.user.user_id).toBe(first.user.user_id);
    expect(auth.database.raw.query("SELECT count(*) AS count FROM wechat_identities").get())
      .toEqual({ count: 1 });

    const upgraded = auth.loginMiniProgramIdentity({
      openid: "openid-only",
      unionid: "later-unionid",
    });

    expect(upgraded.user.user_id).toBe(first.user.user_id);
    const identities = auth.database.raw.query(
      "SELECT subject_digest, user_id FROM wechat_identities ORDER BY subject_digest",
    ).all() as Array<{ subject_digest: string; user_id: string }>;
    expect(identities).toHaveLength(2);
    expect(new Set(identities.map(identity => identity.user_id))).toEqual(
      new Set([first.user.user_id]),
    );
    expect(JSON.stringify(identities)).not.toContain("openid-only");
    expect(JSON.stringify(identities)).not.toContain("later-unionid");
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

  it("completes new and legacy WeChat identities without requiring an avatar", () => {
    const { auth } = fixture();
    const identity = { openid: "openid-profile", unionid: "union-profile" };
    const first = auth.loginMiniProgramIdentity(identity);
    expect(first.user).toMatchObject({ avatar_url: null, profile_complete: true });
    auth.database.raw.query("UPDATE users SET profile_completed_at = NULL WHERE user_id = ?")
      .run(first.user.user_id);
    expect(auth.loginMiniProgramIdentity(identity).user)
      .toMatchObject({ avatar_url: null, profile_complete: true });
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
