import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { authSessionsTable, usersTable } from "./db-schema.ts";
import { YoubanDatabase } from "./database.ts";
import type { UserRecord } from "./users.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MINI_IDLE_MS = 30 * DAY_MS;
const MINI_ABSOLUTE_MS = 90 * DAY_MS;
const WEB_SESSION_MS = 7 * DAY_MS;
const WECHAT_WEB_OAUTH_MS = 5 * 60 * 1_000;

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

  createWechatWebOauthState(): {
    state: string;
    browserVerifier: string;
    expiresAt: string;
  } {
    const state = this.randomToken(32);
    const browserVerifier = this.randomToken(32);
    const now = this.now();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + WECHAT_WEB_OAUTH_MS).toISOString();
    this.database.raw.transaction(() => {
      this.database.raw.query("DELETE FROM wechat_web_oauth_states WHERE expires_at <= ?")
        .run(createdAt);
      this.database.raw.query(`
        INSERT INTO wechat_web_oauth_states (
          state_hash, browser_verifier_hash, created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, NULL)
      `).run(sha256(state), sha256(browserVerifier), createdAt, expiresAt);
    })();
    return { state, browserVerifier, expiresAt };
  }

  consumeWechatWebOauthState(state: string, browserVerifier: string): void {
    const stateHash = sha256(state.trim());
    const browserVerifierHash = sha256(browserVerifier.trim());
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const consume = this.database.raw.transaction(() => {
      const row = this.database.raw.query(`
        SELECT state_hash, browser_verifier_hash, expires_at, consumed_at
        FROM wechat_web_oauth_states WHERE state_hash = ?
      `).get(stateHash) as {
        state_hash: string;
        browser_verifier_hash: string;
        expires_at: string;
        consumed_at: string | null;
      } | null;
      if (
        !row
        || row.consumed_at
        || Date.parse(row.expires_at) <= now
        || !this.secureEqual(row.state_hash, stateHash)
        || !this.secureEqual(row.browser_verifier_hash, browserVerifierHash)
      ) {
        throw new AuthenticationError("网页登录凭证无效或已过期");
      }
      const result = this.database.raw.query(`
        UPDATE wechat_web_oauth_states SET consumed_at = ?
        WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?
      `).run(nowIso, stateHash, nowIso);
      if (result.changes !== 1) {
        throw new AuthenticationError("网页登录凭证无效或已过期");
      }
    });
    consume();
  }

  loginMiniProgramIdentity(identity: {
    openid: string;
    unionid: string;
  }): { user: UserRecord; token: string } {
    const openid = identity.openid.trim();
    const unionid = identity.unionid.trim();
    if (!openid || !unionid) throw new AuthenticationError("微信登录凭证无效");
    const unionDigest = this.unionIdentityDigest(unionid);
    const legacyDigest = this.hmac("wechat", openid);
    const now = this.nowIso();
    const login = this.database.raw.transaction(() => {
      const unionIdentity = this.identity(unionDigest);
      const legacyIdentity = this.identity(legacyDigest);
      if (
        unionIdentity
        && legacyIdentity
        && unionIdentity.user_id !== legacyIdentity.user_id
      ) {
        throw new AuthenticationError("微信账号关联冲突");
      }
      let userId = unionIdentity?.user_id ?? legacyIdentity?.user_id;
      if (!userId) {
        userId = this.createWechatUser(now).user_id;
      }
      this.attachIdentity(unionDigest, userId, now);
      this.attachIdentity(legacyDigest, userId, now);
      this.database.raw.query("UPDATE users SET last_login_at = ? WHERE user_id = ?")
        .run(now, userId);
      const token = this.issueSession(userId, "miniprogram");
      this.audit("wechat_login", "success", userId, unionDigest.slice(0, 16));
      return { user: this.getUser(userId)!, token };
    });
    return login();
  }

  loginWebsiteIdentity(profile: {
    unionid: string;
    nickname: string;
    avatarFile: string | null;
  }): { user: UserRecord; token: string } {
    const unionid = profile.unionid.trim();
    if (!unionid) throw new AuthenticationError("无法确认微信账号");
    const nickname = this.normalizedNickname(profile.nickname);
    const avatarFile = profile.avatarFile?.trim() || null;
    const unionDigest = this.unionIdentityDigest(unionid);
    const now = this.nowIso();
    const login = this.database.raw.transaction(() => {
      const identity = this.identity(unionDigest);
      let userId = identity?.user_id;
      if (!userId) {
        userId = this.createWechatUser(now, {
          nickname,
          avatarFile,
          profileCompletedAt: now,
        }).user_id;
        this.attachIdentity(unionDigest, userId, now);
      } else {
        this.database.raw.query(`
          UPDATE users SET
            nickname = ?,
            avatar_file = COALESCE(?, avatar_file),
            profile_completed_at = COALESCE(profile_completed_at, ?),
            last_login_at = ?
          WHERE user_id = ?
        `).run(nickname, avatarFile, now, now, userId);
        this.database.raw.query(
          "UPDATE wechat_identities SET last_login_at = ? WHERE subject_digest = ?",
        ).run(now, unionDigest);
      }
      const token = this.issueSession(userId, "web");
      this.audit("wechat_web_login", "success", userId, unionDigest.slice(0, 16));
      return { user: this.getUser(userId)!, token };
    });
    return login();
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
    return user?.profile_complete ? user : undefined;
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

  issueWebSessionForUser(userId: string): { user: UserRecord; token: string } {
    const user = this.getUser(userId);
    if (!user?.profile_complete) {
      throw new AuthenticationError("请先选择微信头像完成登录");
    }
    const token = this.issueSession(user.user_id, "web");
    this.audit("miniprogram_web_session_exchange", "success", user.user_id, "webview");
    return { user, token };
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

  private createWechatUser(
    now: string,
    profile: {
      nickname?: string;
      avatarFile?: string | null;
      profileCompletedAt?: string | null;
    } = {},
  ): UserRecord {
    const userId = this.randomHex(8);
    this.database.orm.insert(usersTable).values({
      userId,
      nickname: profile.nickname ?? "微信用户",
      avatarFile: profile.avatarFile ?? null,
      profileCompletedAt: profile.profileCompletedAt ?? null,
      createdAt: now,
      lastLoginAt: now,
    }).run();
    return this.getUser(userId)!;
  }

  private identity(subjectDigest: string): { user_id: string } | null {
    return this.database.raw.query(
      "SELECT user_id FROM wechat_identities WHERE subject_digest = ?",
    ).get(subjectDigest) as { user_id: string } | null;
  }

  private attachIdentity(subjectDigest: string, userId: string, now: string): void {
    const existing = this.identity(subjectDigest);
    if (existing) {
      if (existing.user_id !== userId) throw new AuthenticationError("微信账号关联冲突");
      this.database.raw.query(
        "UPDATE wechat_identities SET last_login_at = ? WHERE subject_digest = ?",
      ).run(now, subjectDigest);
      return;
    }
    this.database.raw.query(`
      INSERT INTO wechat_identities (subject_digest, user_id, created_at, last_login_at)
      VALUES (?, ?, ?, ?)
    `).run(subjectDigest, userId, now, now);
  }

  private unionIdentityDigest(unionid: string): string {
    return this.hmac("wechat-identity", `wechat:unionid:${unionid}`);
  }

  private normalizedNickname(nickname: string): string {
    const normalized = Array.from(nickname.normalize("NFKC").trim()).slice(0, 64).join("");
    return normalized || "微信用户";
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
