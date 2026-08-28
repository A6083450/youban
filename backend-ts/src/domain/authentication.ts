import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { authSessionsTable, usersTable } from "./db-schema.ts";
import { YoubanDatabase } from "./database.ts";
import type { UserRecord } from "./users.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MINI_IDLE_MS = 30 * DAY_MS;
const MINI_ABSOLUTE_MS = 90 * DAY_MS;
const WEB_SESSION_MS = 7 * DAY_MS;
const WEB_CHALLENGE_MS = 5 * 60 * 1_000;

type ClientType = "miniprogram" | "web";

interface AuthenticationOptions {
  pepper: string;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

interface StoredUser {
  user_id: string;
  nickname: string;
  avatar_file: string | null;
  profile_completed_at: string | null;
  created_at: string;
  last_login_at: string;
}

interface SessionRow {
  session_id: string;
  token_hash: string;
  user_id: string;
  client_type: ClientType;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

export class AuthenticationError extends Error {}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toUser(row: StoredUser): UserRecord {
  return {
    user_id: row.user_id,
    nickname: row.nickname,
    avatar_url: row.avatar_file ? `/api/avatars/${row.avatar_file}` : null,
    profile_complete: Boolean(row.profile_completed_at),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

export class AuthenticationService {
  readonly database: YoubanDatabase;
  private readonly now: () => number;
  private readonly getRandomBytes: (length: number) => Uint8Array;

  constructor(path: string, private readonly options: AuthenticationOptions) {
    if (Buffer.byteLength(options.pepper, "utf8") < 32) {
      throw new Error("authentication pepper must contain at least 32 bytes");
    }
    this.database = new YoubanDatabase(path);
    this.now = options.now ?? Date.now;
    this.getRandomBytes = options.randomBytes ?? ((length) => crypto.getRandomValues(new Uint8Array(length)));
  }

  loginWechat(subject: string): { user: UserRecord; token: string } {
    const normalized = subject.trim();
    if (!normalized) throw new AuthenticationError("微信登录凭证无效");
    const digest = this.hmac("wechat", normalized);
    const now = this.nowIso();
    const transaction = this.database.raw.transaction(() => {
      const identity = this.database.raw.query(
        "SELECT user_id FROM wechat_identities WHERE subject_digest = ?",
      ).get(digest) as { user_id: string } | null;
      let user: UserRecord;
      if (identity) {
        this.database.raw.query("UPDATE wechat_identities SET last_login_at = ? WHERE subject_digest = ?")
          .run(now, digest);
        this.database.raw.query("UPDATE users SET last_login_at = ? WHERE user_id = ?")
          .run(now, identity.user_id);
        user = this.getUser(identity.user_id)!;
      } else {
        user = this.createWechatUser(digest, now);
        this.database.raw.query(`
          INSERT INTO wechat_identities (subject_digest, user_id, created_at, last_login_at)
          VALUES (?, ?, ?, ?)
        `).run(digest, user.user_id, now, now);
      }
      const token = this.issueSession(user.user_id, "miniprogram");
      this.audit("wechat_login", "success", user.user_id, digest.slice(0, 16));
      return { user: this.getUser(user.user_id)!, token };
    });
    return transaction();
  }

  authenticate(token: string): UserRecord | undefined {
    const tokenHash = sha256(token.trim());
    if (!token.trim()) return undefined;
    const row = this.database.raw.query("SELECT * FROM auth_sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | null;
    if (!row || row.revoked_at) return undefined;
    const now = this.now();
    if (Date.parse(row.idle_expires_at) <= now || Date.parse(row.absolute_expires_at) <= now) return undefined;
    const absolute = Date.parse(row.absolute_expires_at);
    const idleWindow = row.client_type === "miniprogram" ? MINI_IDLE_MS : WEB_SESSION_MS;
    const idleExpiresAt = new Date(Math.min(now + idleWindow, absolute)).toISOString();
    this.database.raw.query(`
      UPDATE auth_sessions SET last_used_at = ?, idle_expires_at = ? WHERE token_hash = ?
    `).run(new Date(now).toISOString(), idleExpiresAt, tokenHash);
    return this.getUser(row.user_id);
  }

  authenticateReady(token: string): UserRecord | undefined {
    const user = this.authenticate(token);
    return user?.profile_complete && Boolean(user.avatar_url) ? user : undefined;
  }

  logout(token: string): boolean {
    if (!token.trim()) return false;
    const result = this.database.raw.query(`
      UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL
    `).run(this.nowIso(), sha256(token.trim()));
    return result.changes > 0;
  }

  listSessions(token: string): Array<{
    session_id: string;
    client_type: ClientType;
    created_at: string;
    last_used_at: string;
    current: boolean;
  }> {
    const user = this.authenticateReady(token);
    if (!user) throw new AuthenticationError("请先选择微信头像完成登录");
    const currentHash = sha256(token.trim());
    return (this.database.raw.query(`
      SELECT session_id, token_hash, client_type, created_at, last_used_at
      FROM auth_sessions
      WHERE user_id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?
      ORDER BY last_used_at DESC
    `).all(user.user_id, this.nowIso(), this.nowIso()) as Array<{
      session_id: string;
      token_hash: string;
      client_type: ClientType;
      created_at: string;
      last_used_at: string;
    }>).map((row) => ({
      session_id: row.session_id,
      client_type: row.client_type,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      current: row.token_hash === currentHash,
    }));
  }

  revokeSession(token: string, sessionId: string): boolean {
    const user = this.authenticateReady(token);
    if (!user) throw new AuthenticationError("请先选择微信头像完成登录");
    const currentHash = sha256(token.trim());
    const result = this.database.raw.query(`
      UPDATE auth_sessions SET revoked_at = ?
      WHERE session_id = ? AND user_id = ? AND token_hash <> ? AND revoked_at IS NULL
    `).run(this.nowIso(), sessionId.trim(), user.user_id, currentHash);
    if (result.changes > 0) this.audit("session_revoke", "success", user.user_id, sessionId.trim());
    return result.changes > 0;
  }

  completeProfile(token: string, avatarFile: string): UserRecord {
    const user = this.authenticate(token);
    if (!user) throw new AuthenticationError("登录已失效");
    const normalizedAvatar = avatarFile.trim();
    if (!normalizedAvatar) throw new AuthenticationError("请选择微信头像完成登录");
    const completedAt = this.nowIso();
    this.database.raw.query(`
      UPDATE users SET avatar_file = ?, profile_completed_at = ? WHERE user_id = ?
    `).run(normalizedAvatar, completedAt, user.user_id);
    this.audit("profile_complete", "success", user.user_id, "avatar");
    return this.getUser(user.user_id)!;
  }

  createWebChallenge(): {
    challenge_id: string;
    challenge_token: string;
    verifier: string;
    short_code: string;
    expires_at: string;
  } {
    const challengeId = this.randomHex(16);
    const challengeToken = this.randomToken(32);
    const verifier = this.randomToken(32);
    const shortCode = String(this.getRandomBytes(4).reduce((value, byte) => (value * 256 + byte) % 1_000_000, 0))
      .padStart(6, "0");
    const now = this.now();
    const expiresAt = new Date(now + WEB_CHALLENGE_MS).toISOString();
    this.database.raw.query(`
      INSERT INTO web_login_challenges (
        challenge_id, verifier_hash, approval_token_hash, short_code_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      challengeId,
      sha256(verifier),
      this.hmac("web-approval", `${challengeId}:${challengeToken}`),
      this.hmac("web-short-code", `${challengeId}:${shortCode}`),
      new Date(now).toISOString(),
      expiresAt,
    );
    return {
      challenge_id: challengeId,
      challenge_token: challengeToken,
      verifier,
      short_code: shortCode,
      expires_at: expiresAt,
    };
  }

  approveWebChallenge(token: string, challengeId: string, approvalCredential: string): void {
    const user = this.authenticateReady(token);
    if (!user) throw new AuthenticationError("请先选择微信头像完成登录");
    const challenge = this.challenge(challengeId);
    if (!challenge || Date.parse(challenge.expires_at) <= this.now()) throw new AuthenticationError("登录挑战已过期");
    if (challenge.approved_at) throw new AuthenticationError("登录挑战已确认");
    const tokenHash = this.hmac("web-approval", `${challengeId}:${approvalCredential}`);
    const shortCodeHash = this.hmac("web-short-code", `${challengeId}:${approvalCredential}`);
    if (!this.secureEqual(challenge.approval_token_hash, tokenHash)
      && !this.secureEqual(challenge.short_code_hash, shortCodeHash)) {
      throw new AuthenticationError("登录挑战凭证无效");
    }
    this.database.raw.query(`
      UPDATE web_login_challenges SET approved_user_id = ?, approved_at = ? WHERE challenge_id = ?
    `).run(user.user_id, this.nowIso(), challengeId);
    this.audit("web_challenge_approve", "success", user.user_id, challengeId);
  }

  getWebChallengeStatus(challengeId: string, verifier: string): { status: "pending" | "approved" | "expired" | "exchanged" } {
    const challenge = this.verifiedChallenge(challengeId, verifier);
    if (Date.parse(challenge.expires_at) <= this.now()) return { status: "expired" };
    if (challenge.exchanged_at) return { status: "exchanged" };
    return { status: challenge.approved_at ? "approved" : "pending" };
  }

  exchangeWebChallenge(challengeId: string, verifier: string): { user: UserRecord; token: string } {
    const transaction = this.database.raw.transaction(() => {
      const challenge = this.verifiedChallenge(challengeId, verifier);
      if (Date.parse(challenge.expires_at) <= this.now()) throw new AuthenticationError("登录挑战已过期");
      if (challenge.exchanged_at) throw new AuthenticationError("登录挑战已兑换");
      if (!challenge.approved_user_id) throw new AuthenticationError("登录挑战尚未确认");
      const user = this.getUser(challenge.approved_user_id);
      if (!user?.profile_complete || !user.avatar_url) {
        throw new AuthenticationError("请先选择微信头像完成登录");
      }
      this.database.raw.query("UPDATE web_login_challenges SET exchanged_at = ? WHERE challenge_id = ?")
        .run(this.nowIso(), challengeId);
      const token = this.issueSession(challenge.approved_user_id, "web");
      this.audit("web_challenge_exchange", "success", challenge.approved_user_id, challengeId);
      return { user, token };
    });
    return transaction();
  }

  issueWebSessionForUser(userId: string): { user: UserRecord; token: string } {
    const user = this.getUser(userId);
    if (!user?.profile_complete || !user.avatar_url) {
      throw new AuthenticationError("请先选择微信头像完成登录");
    }
    const token = this.issueSession(user.user_id, "web");
    this.audit("miniprogram_web_session_exchange", "success", user.user_id, "webview");
    return { user, token };
  }

  private challenge(challengeId: string) {
    return this.database.raw.query("SELECT * FROM web_login_challenges WHERE challenge_id = ?")
      .get(challengeId.trim()) as {
        challenge_id: string;
        verifier_hash: string;
        approval_token_hash: string;
        short_code_hash: string;
        approved_user_id: string | null;
        expires_at: string;
        approved_at: string | null;
        exchanged_at: string | null;
      } | null;
  }

  private verifiedChallenge(challengeId: string, verifier: string): NonNullable<ReturnType<AuthenticationService["challenge"]>> {
    const challenge = this.challenge(challengeId);
    if (!challenge || !this.secureEqual(challenge.verifier_hash, sha256(verifier.trim()))) {
      throw new AuthenticationError("登录挑战凭证无效");
    }
    return challenge;
  }

  private issueSession(userId: string, clientType: ClientType): string {
    const token = this.randomToken(32);
    const now = this.now();
    const absoluteWindow = clientType === "miniprogram" ? MINI_ABSOLUTE_MS : WEB_SESSION_MS;
    const idleWindow = clientType === "miniprogram" ? MINI_IDLE_MS : WEB_SESSION_MS;
    this.database.orm.insert(authSessionsTable).values({
      sessionId: this.randomHex(16),
      tokenHash: sha256(token),
      userId,
      clientType,
      createdAt: new Date(now).toISOString(),
      lastUsedAt: new Date(now).toISOString(),
      idleExpiresAt: new Date(now + idleWindow).toISOString(),
      absoluteExpiresAt: new Date(now + absoluteWindow).toISOString(),
      revokedAt: null,
    }).run();
    return token;
  }

  private createWechatUser(digest: string, now: string): UserRecord {
    const userId = this.randomHex(8);
    this.database.orm.insert(usersTable).values({
      userId,
      nickname: "微信用户",
      avatarFile: null,
      profileCompletedAt: null,
      createdAt: now,
      lastLoginAt: now,
    }).run();
    return this.getUser(userId)!;
  }

  private getUser(userId: string): UserRecord | undefined {
    const row = this.database.raw.query(`
      SELECT user_id, nickname, avatar_file, profile_completed_at, created_at, last_login_at
      FROM users WHERE user_id = ?
    `).get(userId.trim()) as StoredUser | null;
    return row ? toUser(row) : undefined;
  }

  private audit(operation: string, result: "success" | "failure", userId: string | null, subject: string): void {
    this.database.raw.query(`
      INSERT INTO auth_audit_events (id, user_id, operation, result, subject, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(this.randomHex(16), userId, operation, result, subject, this.nowIso());
  }

  private hmac(domain: string, value: string): string {
    return createHmac("sha256", this.options.pepper).update(`${domain}\0${value}`).digest("hex");
  }

  private secureEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }

  private randomToken(length: number): string {
    return Buffer.from(this.getRandomBytes(length)).toString("base64url");
  }

  private randomHex(bytes: number): string {
    return Buffer.from(this.getRandomBytes(bytes)).toString("hex");
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  close(): void {
    this.database.close();
  }
}
