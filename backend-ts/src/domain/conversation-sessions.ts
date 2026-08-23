import { YoubanDatabase } from "./database.ts";

export type ConversationSessionTitleStatus = "pending" | "generated" | "fallback";
export type ConversationSessionState = "chatting" | "generating" | "planned";

export interface ConversationSessionSnapshot {
  version: number;
  [key: string]: unknown;
}

export interface ConversationSession {
  sessionId: string;
  userId: string;
  title: string;
  titleStatus: ConversationSessionTitleStatus;
  state: ConversationSessionState;
  planId: string | null;
  snapshot: ConversationSessionSnapshot;
  firstMessage: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export class SessionRevisionConflictError extends Error {
  constructor(readonly sessionId: string) {
    super(`conversation session revision conflict: ${sessionId}`);
    this.name = "SessionRevisionConflictError";
  }
}

interface ConversationSessionRow {
  session_id: string;
  user_id: string;
  title: string;
  title_status: string;
  state: string;
  plan_id: string | null;
  snapshot: string;
  first_message: string;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function normalizeRequired(value: string, name: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeFirstMessage(value: string): string {
  const normalized = String(value ?? "").trim().split(/\s+/u).filter(Boolean).join(" ");
  if (!normalized) throw new Error("first message is required");
  return normalized;
}

function normalizeSnapshot(value: unknown): ConversationSessionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { version: 1, items: [] };
  const snapshot = structuredClone(value) as Record<string, unknown>;
  const rawVersion = Number(snapshot.version);
  return {
    ...snapshot,
    version: Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : 1,
  };
}

function parseSnapshot(value: string): ConversationSessionSnapshot {
  try {
    return normalizeSnapshot(JSON.parse(value));
  } catch {
    return { version: 1, items: [] };
  }
}

function normalizeTitleStatus(value: string): ConversationSessionTitleStatus {
  return value === "generated" || value === "fallback" ? value : "pending";
}

function normalizeState(value: string): ConversationSessionState {
  return value === "generating" || value === "planned" ? value : "chatting";
}

function toSession(row: ConversationSessionRow): ConversationSession {
  return {
    sessionId: String(row.session_id),
    userId: String(row.user_id),
    title: String(row.title),
    titleStatus: normalizeTitleStatus(row.title_status),
    state: normalizeState(row.state),
    planId: row.plan_id === null ? null : String(row.plan_id),
    snapshot: parseSnapshot(row.snapshot),
    firstMessage: String(row.first_message),
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at === null ? null : String(row.deleted_at),
  };
}

export class ConversationSessionRepository {
  readonly database: YoubanDatabase;

  constructor(path: string) {
    this.database = new YoubanDatabase(path);
  }

  create(input: {
    sessionId: string;
    userId: string;
    firstMessage: string;
    snapshot: unknown;
  }): ConversationSession {
    const sessionId = normalizeRequired(input.sessionId, "session id");
    const userId = normalizeRequired(input.userId, "user id");
    const firstMessage = normalizeFirstMessage(input.firstMessage);
    const snapshot = normalizeSnapshot(input.snapshot);
    return this.transaction(() => {
      const existing = this.getBySessionId(sessionId, false);
      if (existing) {
        if (existing.userId !== userId) throw new Error("session is owned by another user");
        return existing;
      }
      const timestamp = now();
      this.database.raw.query(`
        INSERT INTO conversation_sessions (
          session_id, user_id, title, title_status, state, plan_id, snapshot,
          first_message, revision, created_at, updated_at, deleted_at
        ) VALUES (?, ?, '新对话', 'pending', 'chatting', NULL, ?, ?, 0, ?, ?, NULL)
      `).run(sessionId, userId, JSON.stringify(snapshot), firstMessage, timestamp, timestamp);
      return this.getBySessionId(sessionId, false)!;
    });
  }

  getOwned(sessionId: string, userId: string): ConversationSession | undefined {
    return this.getBySessionId(normalizeRequired(sessionId, "session id"), true, userId);
  }

  listOwned(userId: string): ConversationSession[] {
    const rows = this.database.raw.query(`
      SELECT * FROM conversation_sessions
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC
    `).all(normalizeRequired(userId, "user id")) as ConversationSessionRow[];
    return rows.map(toSession);
  }

  listAll(): ConversationSession[] {
    const rows = this.database.raw.query(`
      SELECT * FROM conversation_sessions
      ORDER BY updated_at DESC
    `).all() as ConversationSessionRow[];
    return rows.map(toSession);
  }

  replaceSnapshot(
    sessionId: string,
    userId: string,
    expectedRevision: number,
    snapshot: unknown,
  ): ConversationSession {
    const normalizedSessionId = normalizeRequired(sessionId, "session id");
    const normalizedUserId = normalizeRequired(userId, "user id");
    const normalizedSnapshot = normalizeSnapshot(snapshot);
    const revision = Number(expectedRevision);
    return this.transaction(() => {
      const result = this.database.raw.query(`
        UPDATE conversation_sessions
        SET snapshot = ?, revision = revision + 1, updated_at = ?
        WHERE session_id = ? AND user_id = ? AND deleted_at IS NULL AND revision = ?
      `).run(JSON.stringify(normalizedSnapshot), now(), normalizedSessionId, normalizedUserId, revision);
      if (result.changes !== 1) throw new SessionRevisionConflictError(normalizedSessionId);
      return this.getBySessionId(normalizedSessionId, true, normalizedUserId)!;
    });
  }

  setTitle(
    sessionId: string,
    userId: string,
    title: string,
    titleStatus: Exclude<ConversationSessionTitleStatus, "pending">,
  ): ConversationSession | undefined {
    const normalizedSessionId = normalizeRequired(sessionId, "session id");
    const normalizedUserId = normalizeRequired(userId, "user id");
    const normalizedTitle = normalizeRequired(title, "title");
    return this.transaction(() => {
      this.database.raw.query(`
        UPDATE conversation_sessions
        SET title = ?, title_status = ?, updated_at = ?
        WHERE session_id = ? AND user_id = ? AND deleted_at IS NULL AND title_status = 'pending'
      `).run(normalizedTitle, titleStatus, now(), normalizedSessionId, normalizedUserId);
      return this.getBySessionId(normalizedSessionId, true, normalizedUserId);
    });
  }

  linkPlan(sessionId: string, userId: string, planId: string): ConversationSession | undefined {
    const normalizedSessionId = normalizeRequired(sessionId, "session id");
    const normalizedUserId = normalizeRequired(userId, "user id");
    const normalizedPlanId = normalizeRequired(planId, "plan id");
    return this.transaction(() => {
      const existing = this.getBySessionId(normalizedSessionId, true, normalizedUserId);
      if (!existing || (existing.planId !== null && existing.planId !== normalizedPlanId)) return undefined;
      this.database.raw.query(`
        UPDATE conversation_sessions
        SET plan_id = ?, state = CASE WHEN state = 'planned' THEN state ELSE 'generating' END, updated_at = ?
        WHERE session_id = ? AND user_id = ? AND deleted_at IS NULL
          AND (plan_id IS NULL OR plan_id = ?)
      `).run(normalizedPlanId, now(), normalizedSessionId, normalizedUserId, normalizedPlanId);
      return this.getBySessionId(normalizedSessionId, true, normalizedUserId);
    });
  }

  markPlanned(
    sessionId: string,
    options: { includeDeleted?: boolean } = {},
  ): ConversationSession | undefined {
    const normalizedSessionId = normalizeRequired(sessionId, "session id");
    const visibility = options.includeDeleted ? "" : " AND deleted_at IS NULL";
    return this.transaction(() => {
      this.database.raw.query(`
        UPDATE conversation_sessions
        SET state = 'planned', updated_at = ?
        WHERE session_id = ? AND plan_id IS NOT NULL${visibility}
      `).run(now(), normalizedSessionId);
      return this.getBySessionId(normalizedSessionId, !options.includeDeleted);
    });
  }

  markGenerationFailed(
    sessionId: string,
    options: { includeDeleted?: boolean } = {},
  ): ConversationSession | undefined {
    const normalizedSessionId = normalizeRequired(sessionId, "session id");
    const visibility = options.includeDeleted ? "" : " AND deleted_at IS NULL";
    return this.transaction(() => {
      this.database.raw.query(`
        UPDATE conversation_sessions
        SET state = 'chatting', updated_at = ?
        WHERE session_id = ?${visibility} AND state <> 'planned'
      `).run(now(), normalizedSessionId);
      return this.getBySessionId(normalizedSessionId, !options.includeDeleted);
    });
  }

  softDelete(sessionId: string, userId: string): boolean {
    const normalizedSessionId = normalizeRequired(sessionId, "session id");
    const normalizedUserId = normalizeRequired(userId, "user id");
    return this.transaction(() => this.database.raw.query(`
      UPDATE conversation_sessions
      SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
      WHERE session_id = ? AND user_id = ?
    `).run(now(), now(), normalizedSessionId, normalizedUserId).changes === 1);
  }

  hardDelete(sessionId: string): boolean {
    const normalizedSessionId = normalizeRequired(sessionId, "session id");
    return this.transaction(() => this.database.raw.query(
      "DELETE FROM conversation_sessions WHERE session_id = ?",
    ).run(normalizedSessionId).changes === 1);
  }

  getByPlanId(planId: string, options: { includeDeleted?: boolean } = {}): ConversationSession | undefined {
    const visibility = options.includeDeleted ? "" : " AND deleted_at IS NULL";
    const row = this.database.raw.query(
      `SELECT * FROM conversation_sessions WHERE plan_id = ?${visibility}`,
    ).get(normalizeRequired(planId, "plan id")) as ConversationSessionRow | null;
    return row ? toSession(row) : undefined;
  }

  close(): void {
    this.database.close();
  }

  private transaction<T>(operation: () => T): T {
    return this.database.raw.transaction(operation)();
  }

  private getBySessionId(
    sessionId: string,
    visibleOnly: boolean,
    userId?: string,
  ): ConversationSession | undefined {
    const clauses = ["session_id = ?"];
    const values: string[] = [sessionId];
    if (userId) {
      clauses.push("user_id = ?");
      values.push(userId);
    }
    if (visibleOnly) clauses.push("deleted_at IS NULL");
    const row = this.database.raw.query(
      `SELECT * FROM conversation_sessions WHERE ${clauses.join(" AND ")}`,
    ).get(...values) as ConversationSessionRow | null;
    return row ? toSession(row) : undefined;
  }
}
