import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthenticationError, AuthenticationService } from "../src/domain/authentication.ts";

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
  it("maps repeated WeChat logins to one user without persisting the raw subject", () => {
    const { auth } = fixture();
    const first = auth.loginWechat("openid-sensitive-value");
    const second = auth.loginWechat("openid-sensitive-value");

    expect(second.user.user_id).toBe(first.user.user_id);
    expect(second.token).not.toBe(first.token);
    const stored = JSON.stringify(auth.database.raw.query("SELECT * FROM wechat_identities").all());
    expect(stored).not.toContain("openid-sensitive-value");
    expect(auth.authenticate(second.token)?.user_id).toBe(first.user.user_id);
    auth.close();
  });

  it("slides mini-program sessions, caps them at 90 days, and rejects revoked or expired tokens", () => {
    const { auth, advance } = fixture();
    const login = auth.loginWechat("openid-one");
    advance(29 * 24 * 60 * 60 * 1_000);
    expect(auth.authenticate(login.token)?.user_id).toBe(login.user.user_id);
    advance(31 * 24 * 60 * 60 * 1_000);
    expect(auth.authenticate(login.token)).toBeUndefined();

    const replacement = auth.loginWechat("openid-one");
    expect(auth.logout(replacement.token)).toBe(true);
    expect(auth.authenticate(replacement.token)).toBeUndefined();
    auth.close();
  });

  it("persists first-login profile completion for every session of the WeChat account", () => {
    const { auth } = fixture();
    const first = auth.loginWechat("openid-profile");
    expect(first.user).toMatchObject({ avatar_url: null, profile_complete: false });

    const completed = auth.completeProfile(first.token, "0123456789abcdef0123456789abcdef.png");
    expect(completed).toMatchObject({
      avatar_url: "/api/avatars/0123456789abcdef0123456789abcdef.png",
      profile_complete: true,
    });
    expect(auth.loginWechat("openid-profile").user).toMatchObject(completed);
    auth.close();
  });

  it("requires the independent verifier to inspect and exchange an approved web challenge", () => {
    const { auth, advance } = fixture();
    const mini = auth.loginWechat("openid-web-login");
    auth.completeProfile(mini.token, "11111111111111111111111111111111.png");
    const challenge = auth.createWebChallenge();

    expect(() => auth.getWebChallengeStatus(challenge.challenge_id, "wrong-verifier"))
      .toThrow(AuthenticationError);
    auth.approveWebChallenge(mini.token, challenge.challenge_id, challenge.challenge_token);
    expect(auth.getWebChallengeStatus(challenge.challenge_id, challenge.verifier).status).toBe("approved");
    const web = auth.exchangeWebChallenge(challenge.challenge_id, challenge.verifier);
    expect(auth.authenticate(web.token)?.user_id).toBe(mini.user.user_id);
    expect(() => auth.exchangeWebChallenge(challenge.challenge_id, challenge.verifier))
      .toThrow("登录挑战已兑换");

    const expired = auth.createWebChallenge();
    advance(5 * 60 * 1_000 + 1);
    expect(auth.getWebChallengeStatus(expired.challenge_id, expired.verifier).status).toBe("expired");
    auth.close();
  });

  it("does not let a WeChat session approve Web login before an avatar is stored", () => {
    const { auth } = fixture();
    const mini = auth.loginWechat("openid-incomplete-web-login");
    const challenge = auth.createWebChallenge();

    expect(() => auth.approveWebChallenge(mini.token, challenge.challenge_id, challenge.challenge_token))
      .toThrow("请先选择微信头像完成登录");
    expect(auth.getWebChallengeStatus(challenge.challenge_id, challenge.verifier).status).toBe("pending");
    auth.close();
  });

  it("accepts the challenge short code without storing it in plaintext", () => {
    const { auth } = fixture();
    const mini = auth.loginWechat("openid-short-code");
    auth.completeProfile(mini.token, "22222222222222222222222222222222.png");
    const challenge = auth.createWebChallenge();
    const stored = JSON.stringify(auth.database.raw.query(
      "SELECT approval_token_hash, short_code_hash FROM web_login_challenges",
    ).get());
    expect(stored).not.toContain(challenge.challenge_token);
    expect(stored).not.toContain(challenge.short_code);
    auth.approveWebChallenge(mini.token, challenge.challenge_id, challenge.short_code);
    expect(auth.getWebChallengeStatus(challenge.challenge_id, challenge.verifier).status).toBe("approved");
    auth.close();
  });

  it("lists opaque device sessions and revokes only another session owned by the user", () => {
    const { auth } = fixture();
    const first = auth.loginWechat("openid-sessions");
    const second = auth.loginWechat("openid-sessions");
    const other = auth.loginWechat("openid-other-user");
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
