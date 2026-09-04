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

  createWebChallenge(): {
    challengeId: string;
    browserVerifier: string;
    expiresAt: string;
  } {
    const challengeId = this.randomHex(16);
    const browserVerifier = this.randomToken(32);
    const now = this.now();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + WEB_CHALLENGE_MS).toISOString();
    this.database.raw.transaction(() => {
      this.database.raw.query("DELETE FROM web_login_challenges WHERE expires_at <= ?")
        .run(createdAt);
      this.database.raw.query(`
        INSERT INTO web_login_challenges (
          challenge_id, verifier_hash, approval_token_hash, short_code_hash,
          created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        challengeId,
        sha256(browserVerifier),
        sha256(this.randomToken(32)),
        sha256(this.randomToken(32)),
        createdAt,
        expiresAt,
      );
    })();
    return { challengeId, browserVerifier, expiresAt };
  }

  claimWebChallenge(token: string, challengeId: string): void {
    const user = this.authenticateReady(token, "miniprogram");
    if (!user) throw new AuthenticationError("请先选择微信头像完成登录");
    this.database.raw.transaction(() => {
      const challenge = this.challenge(challengeId);
      if (!challenge || Date.parse(challenge.expires_at) <= this.now()) {
        throw new AuthenticationError("登录挑战已过期");
      }
      if (challenge.exchanged_at) throw new AuthenticationError("登录挑战已兑换");
      if (challenge.approved_user_id === user.user_id) return;
      if (challenge.approved_user_id) throw new AuthenticationError("登录挑战已由其他账号扫码");
      const claimed = this.database.raw.query(`
        UPDATE web_login_challenges SET approved_user_id = ?
        WHERE challenge_id = ? AND approved_user_id IS NULL
      `).run(user.user_id, challengeId.trim());
      if (claimed.changes === 0) throw new AuthenticationError("登录挑战已由其他账号扫码");
      this.audit("web_challenge_scan", "success", user.user_id, challengeId.trim());
    })();
  }

  approveWebChallenge(token: string, challengeId: string): void {
    const user = this.authenticateReady(token, "miniprogram");
    if (!user) throw new AuthenticationError("请先选择微信头像完成登录");
    this.database.raw.transaction(() => {
      const challenge = this.challenge(challengeId);
      if (!challenge || Date.parse(challenge.expires_at) <= this.now()) {
        throw new AuthenticationError("登录挑战已过期");
      }
      if (challenge.exchanged_at) throw new AuthenticationError("登录挑战已兑换");
      if (challenge.approved_user_id && challenge.approved_user_id !== user.user_id) {
        throw new AuthenticationError(challenge.approved_at
          ? "登录挑战已由其他账号确认"
          : "登录挑战已由其他账号扫码");
      }
      if (challenge.approved_at) return;
      this.database.raw.query(`
        UPDATE web_login_challenges
        SET approved_user_id = ?, approved_at = ?
        WHERE challenge_id = ? AND (approved_user_id IS NULL OR approved_user_id = ?)
      `).run(user.user_id, this.nowIso(), challengeId.trim(), user.user_id);
      this.audit("web_challenge_approve", "success", user.user_id, challengeId.trim());
    })();
  }

  getWebChallengeStatus(
    challengeId: string,
    browserVerifier: string,
  ): { status: "pending" | "scanned" | "approved" | "expired" | "exchanged" } {
    const challenge = this.verifiedChallenge(challengeId, browserVerifier);
    if (Date.parse(challenge.expires_at) <= this.now()) return { status: "expired" };
    if (challenge.exchanged_at) return { status: "exchanged" };
    if (challenge.approved_at) return { status: "approved" };
    return { status: challenge.approved_user_id ? "scanned" : "pending" };
  }

  exchangeWebChallenge(challengeId: string, browserVerifier: string): { user: UserRecord; token: string } {
    return this.database.raw.transaction(() => {
      const challenge = this.verifiedChallenge(challengeId, browserVerifier);
      if (Date.parse(challenge.expires_at) <= this.now()) throw new AuthenticationError("登录挑战已过期");
      if (challenge.exchanged_at) throw new AuthenticationError("登录挑战已兑换");
      if (!challenge.approved_user_id) throw new AuthenticationError("登录挑战尚未确认");
      const user = this.getUser(challenge.approved_user_id);
      if (!user?.profile_complete) throw new AuthenticationError("请先选择微信头像完成登录");
      this.database.raw.query(`
        UPDATE web_login_challenges SET exchanged_at = ?
        WHERE challenge_id = ? AND exchanged_at IS NULL
      `).run(this.nowIso(), challengeId.trim());
      const token = this.issueSession(user.user_id, "web");
      this.audit("web_challenge_exchange", "success", user.user_id, challengeId.trim());
      return { user, token };
    })();
  }

  loginMiniProgramIdentity(identity: {
    openid: string;
    unionid?: string;
  }): { user: UserRecord; token: string } {
    const openid = identity.openid.trim();
    const unionid = identity.unionid?.trim() ?? "";
    if (!openid) throw new AuthenticationError("微信登录凭证无效");
    const unionDigest = unionid ? this.unionIdentityDigest(unionid) : "";
    const legacyDigest = this.hmac("wechat", openid);
    const now = this.nowIso();
    const login = this.database.raw.transaction(() => {
      const unionIdentity = unionDigest ? this.identity(unionDigest) : null;
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
        userId = this.createWechatUser(now, { profileCompletedAt: now }).user_id;
      }
      if (unionDigest) this.attachIdentity(unionDigest, userId, now);
      this.attachIdentity(legacyDigest, userId, now);
      this.database.raw.query(`
        UPDATE users SET
          profile_completed_at = COALESCE(profile_completed_at, ?),
          last_login_at = ?
        WHERE user_id = ?
      `).run(now, now, userId);
      const token = this.issueSession(userId, "miniprogram");
      this.audit("wechat_login", "success", userId, (unionDigest || legacyDigest).slice(0, 16));
      return { user: this.getUser(userId)!, token };
    });
    return login();
  }

  loginNicknameIdentity(rawNickname: string): { user: UserRecord; token: string } {
    const nickname = this.normalizedLoginNickname(rawNickname);
    const nicknameKey = this.nicknameKey(nickname);
    const nicknameDigest = this.hmac("nickname-identity", nicknameKey);
    const now = this.nowIso();
    const login = this.database.raw.transaction(() => {
      const mapped = this.database.raw.query(
        "SELECT user_id FROM nickname_identities WHERE nickname_digest = ?",
      ).get(nicknameDigest) as { user_id: string } | null;
      let userId = mapped?.user_id;
      if (!userId) {
        const historicalUsers = this.database.raw.query(`
          SELECT u.user_id, u.nickname, u.avatar_file, u.profile_completed_at,
                 u.created_at, u.last_login_at
          FROM users u
          WHERE NOT EXISTS (
            SELECT 1 FROM wechat_identities w WHERE w.user_id = u.user_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM nickname_identities n WHERE n.user_id = u.user_id
          )
          ORDER BY u.created_at ASC, u.user_id ASC
        `).all() as StoredUser[];
        const historical = historicalUsers.find(user => this.nicknameKey(user.nickname) === nicknameKey);
        userId = historical?.user_id ?? this.createWechatUser(now, {
          nickname,
          profileCompletedAt: now,
        }).user_id;
        this.database.raw.query(`
          INSERT INTO nickname_identities (
            nickname_digest, user_id, created_at, last_login_at
          ) VALUES (?, ?, ?, ?)
        `).run(nicknameDigest, userId, now, now);
      } else {
        this.database.raw.query(
          "UPDATE nickname_identities SET last_login_at = ? WHERE nickname_digest = ?",
        ).run(now, nicknameDigest);
      }
      this.database.raw.query(`
        UPDATE users SET
          profile_completed_at = COALESCE(profile_completed_at, ?),
          last_login_at = ?
        WHERE user_id = ?
      `).run(now, now, userId);
      const token = this.issueSession(userId, "web");
      this.audit("nickname_web_login", "success", userId, nicknameDigest.slice(0, 16));
      return { user: this.getUser(userId)!, token };
    });
    return login();
  }

  authenticate(token: string, requiredClientType?: ClientType): UserRecord | undefined {
    const tokenHash = sha256(token.trim());
    if (!token.trim()) return undefined;
    const row = this.database.raw.query("SELECT * FROM auth_sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | null;
    if (!row || row.revoked_at || (requiredClientType && row.client_type !== requiredClientType)) return undefined;
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

  authenticateReady(token: string, requiredClientType?: ClientType): UserRecord | undefined {
    const user = this.authenticate(token, requiredClientType);
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

  private challenge(challengeId: string) {
    if (!/^[0-9a-f]{32}$/.test(challengeId.trim())) return null;
    return this.database.raw.query("SELECT * FROM web_login_challenges WHERE challenge_id = ?")
      .get(challengeId.trim()) as {
        challenge_id: string;
        verifier_hash: string;
        approved_user_id: string | null;
        expires_at: string;
        approved_at: string | null;
        exchanged_at: string | null;
      } | null;
  }

  private verifiedChallenge(challengeId: string, browserVerifier: string): NonNullable<ReturnType<AuthenticationService["challenge"]>> {
    const challenge = this.challenge(challengeId);
    if (!challenge || !this.secureEqual(challenge.verifier_hash, sha256(browserVerifier.trim()))) {
      throw new AuthenticationError("网页登录凭证无效或已过期");
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

  private normalizedLoginNickname(value: string): string {
    const nickname = String(value ?? "").trim().split(/\s+/u).filter(Boolean).join(" ");
    if (!nickname) throw new AuthenticationError("昵称不能为空");
    if (Array.from(nickname).length > 20) throw new AuthenticationError("昵称不能超过 20 个字符");
    return nickname;
  }

  private nicknameKey(nickname: string): string {
    return nickname.normalize("NFKC").toLocaleLowerCase("und");
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
