import { existsSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { ConversationTitle } from "../agents/conversation-title.ts";
import {
  ConversationSessionRepository,
  type ConversationSession,
  type ConversationSessionSnapshot,
  type ConversationSessionState,
  type ConversationSessionTitleStatus,
} from "./conversation-sessions.ts";
import type { SqliteTaskStore, TripHistoryItem, TripTaskStatus } from "./task-store.ts";

export type ConversationRecordKind = "conversation" | "plan";
export type ConversationRecordVisibility = "all" | "active" | "user_deleted";

export type PermanentDeleteResult =
  | { status: "deleted"; removedImages: number }
  | { status: "not_found" }
  | { status: "conflict" };

export interface ConversationRecord {
  record_id: string;
  kind: ConversationRecordKind;
  session_id: string | null;
  plan_id: string | null;
  task_id: string | null;
  title: string;
  title_status: ConversationSessionTitleStatus;
  state: ConversationSessionState;
  revision: number;
  status: TripTaskStatus | null;
  user_id: string;
  city: string;
  cities: unknown[];
  start_date: string;
  end_date: string;
  travel_days: number;
  updated_at: string;
  overall_suggestions: string;
  user_deleted_at: string | null;
}

export interface ConversationSessionDetail extends ConversationRecord {
  snapshot: ConversationSessionSnapshot;
}

function emptyPlanMetadata() {
  return {
    status: null,
    city: "",
    cities: [] as unknown[],
    start_date: "",
    end_date: "",
    travel_days: 0,
    overall_suggestions: "",
  };
}

function projectSession(
  session: ConversationSession,
  plan?: TripHistoryItem,
  taskDeletedAt: string | null = null,
): ConversationRecord {
  const metadata = plan ?? emptyPlanMetadata();
  return {
    record_id: session.sessionId,
    kind: session.state === "planned" ? "plan" : "conversation",
    session_id: session.sessionId,
    plan_id: session.planId,
    task_id: plan?.task_id ?? null,
    title: session.title,
    title_status: session.titleStatus,
    state: session.state,
    revision: session.revision,
    status: metadata.status,
    user_id: session.userId,
    city: metadata.city,
    cities: structuredClone(metadata.cities),
    start_date: metadata.start_date,
    end_date: metadata.end_date,
    travel_days: metadata.travel_days,
    updated_at: session.updatedAt,
    overall_suggestions: metadata.overall_suggestions,
    user_deleted_at: session.deletedAt ?? taskDeletedAt,
  };
}

function projectLegacyPlan(plan: TripHistoryItem, userDeletedAt: string | null = null): ConversationRecord {
  return {
    record_id: plan.plan_id,
    kind: "plan",
    session_id: null,
    plan_id: plan.plan_id,
    task_id: plan.task_id,
    title: plan.city || "游玩计划",
    title_status: "fallback",
    state: "planned",
    revision: 0,
    status: plan.status,
    user_id: plan.user_id,
    city: plan.city,
    cities: structuredClone(plan.cities),
    start_date: plan.start_date,
    end_date: plan.end_date,
    travel_days: plan.travel_days,
    updated_at: plan.updated_at,
    overall_suggestions: plan.overall_suggestions,
    user_deleted_at: userDeletedAt,
  };
}

export class ConversationRecordService {
  constructor(
    private readonly sessions: ConversationSessionRepository,
    private readonly tasks: SqliteTaskStore,
    private readonly imagesDir: string,
  ) {}

  listOwner(userId: string, limit: number): ConversationRecord[] {
    const sessions = this.sessions.listOwned(userId);
    const history = this.tasks.listHistory({ userId, limit: limit + sessions.length });
    const plansById = new Map(history.map((item) => [item.plan_id, item]));
    const linkedPlanIds = new Set(sessions.flatMap((session) => session.planId ? [session.planId] : []));
    return [
      ...sessions.map((session) => projectSession(
        session,
        session.planId ? plansById.get(session.planId) : undefined,
      )),
      ...history
        .filter((plan) => !linkedPlanIds.has(plan.plan_id))
        .map((plan) => projectLegacyPlan(plan)),
    ]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, limit);
  }

  listAdmin(visibility: ConversationRecordVisibility, limit: number): ConversationRecord[] {
    const sessions = this.sessions.listAll();
    const history = this.tasks.listHistory({
      userId: "",
      limit: Number.MAX_SAFE_INTEGER,
      allUsers: true,
      includeUserDeleted: true,
    });
    const deletedRows = this.tasks.database.raw.query(
      "SELECT task_id, user_deleted_at FROM tasks",
    ).all() as Array<{ task_id: string; user_deleted_at: string | null }>;
    const deletedByTaskId = new Map(deletedRows.map((row) => [row.task_id, row.user_deleted_at]));
    const plansById = new Map(history.map((item) => [item.plan_id, item]));
    const linkedPlanIds = new Set(sessions.flatMap((session) => session.planId ? [session.planId] : []));
    const records = [
      ...sessions.map((session) => {
        const plan = session.planId ? plansById.get(session.planId) : undefined;
        return {
          ...projectSession(session, plan, plan ? deletedByTaskId.get(plan.task_id) ?? null : null),
          record_id: `session:${session.sessionId}`,
        };
      }),
      ...history
        .filter((plan) => !linkedPlanIds.has(plan.plan_id))
        .map((plan) => ({
          ...projectLegacyPlan(plan, deletedByTaskId.get(plan.task_id) ?? null),
          record_id: `task:${plan.task_id}`,
        })),
    ];
    return records
      .filter((record) => visibility === "all"
        || (visibility === "active" ? record.user_deleted_at === null : record.user_deleted_at !== null))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, limit);
  }

  create(input: {
    sessionId: string;
    userId: string;
    firstMessage: string;
    snapshot: unknown;
  }): ConversationRecord | undefined {
    let session: ConversationSession;
    try {
      session = this.sessions.create(input);
    } catch (error) {
      if (error instanceof Error && error.message === "session is owned by another user") return undefined;
      throw error;
    }
    return session.deletedAt === null ? projectSession(session) : undefined;
  }

  detail(sessionId: string, userId: string): ConversationSessionDetail | undefined {
    const session = this.sessions.getOwned(sessionId, userId);
    if (!session) return undefined;
    const plan = session.planId
      ? this.ownerHistory(userId).find((item) => item.plan_id === session.planId)
      : undefined;
    return { ...projectSession(session, plan), snapshot: structuredClone(session.snapshot) };
  }

  replaceSnapshot(
    sessionId: string,
    userId: string,
    expectedRevision: number,
    snapshot: unknown,
  ): ConversationSessionDetail | undefined {
    if (!this.sessions.getOwned(sessionId, userId)) return undefined;
    const session = this.sessions.replaceSnapshot(sessionId, userId, expectedRevision, snapshot);
    const plan = session.planId
      ? this.ownerHistory(userId).find((item) => item.plan_id === session.planId)
      : undefined;
    return { ...projectSession(session, plan), snapshot: structuredClone(session.snapshot) };
  }

  setTitle(sessionId: string, userId: string, title: ConversationTitle): ConversationRecord | undefined {
    const session = this.sessions.setTitle(sessionId, userId, title.title, title.status);
    return session ? projectSession(session) : undefined;
  }

  pendingTitleInput(
    sessionId: string,
    userId: string,
  ): { firstMessage: string; titleStatus: ConversationSessionTitleStatus } | undefined {
    const session = this.sessions.getOwned(sessionId, userId);
    return session ? { firstMessage: session.firstMessage, titleStatus: session.titleStatus } : undefined;
  }

  canStartGeneration(sessionId: string, userId: string): boolean {
    const session = this.sessions.getOwned(sessionId, userId);
    return Boolean(session && session.planId === null);
  }

  linkGeneration(sessionId: string, userId: string, taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.user_id !== userId || task.status !== "processing") return false;
    const linked = this.sessions.linkPlan(sessionId, userId, task.plan_id);
    return linked?.planId === task.plan_id;
  }

  markGenerating(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "processing") return false;
    const session = this.sessions.getByPlanId(task.plan_id);
    if (!session || session.userId !== task.user_id) return false;
    return this.sessions.linkPlan(session.sessionId, session.userId, task.plan_id)?.state === "generating";
  }

  markCompleted(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "completed") return false;
    const session = this.sessions.getByPlanId(task.plan_id, { includeDeleted: true });
    if (!session || session.userId !== task.user_id) return false;
    return this.sessions.markPlanned(session.sessionId, { includeDeleted: true })?.state === "planned";
  }

  markFailed(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "failed") return false;
    const session = this.sessions.getByPlanId(task.plan_id, { includeDeleted: true });
    if (!session || session.userId !== task.user_id) return false;
    return this.sessions.markGenerationFailed(session.sessionId, { includeDeleted: true })?.state !== "generating";
  }

  softDeleteSession(sessionId: string, userId: string): boolean {
    const session = this.sessions.getOwned(sessionId, userId);
    if (!session) return false;
    if (!session.planId) return this.tombstone(session, undefined);
    const linkedTasks = this.tasks.all().filter((task) => task.plan_id === session.planId);
    if (linkedTasks.length !== 1 || linkedTasks[0]!.user_id !== userId) return false;
    return this.tombstone(session, linkedTasks[0]!);
  }

  softDeletePlan(planId: string, userId: string): boolean {
    const matching = this.tasks.all().filter((item) => item.plan_id === planId && item.user_id === userId);
    if (matching.length !== 1) return false;
    const linked = this.sessions.getByPlanId(planId, { includeDeleted: true });
    if (linked && linked.userId !== userId) return false;
    return this.tombstone(linked, matching[0]!);
  }

  permanentlyDeleteRecord(recordId: string): PermanentDeleteResult {
    if (recordId.startsWith("session:")) {
      const sessionId = recordId.slice("session:".length);
      const session = this.sessions.listAll().find((candidate) => candidate.sessionId === sessionId);
      if (!session) return { status: "not_found" };
      const task = session.planId ? this.uniqueTaskForPlan(session.planId) : undefined;
      if (session.planId && !task) return { status: "not_found" };
      return this.deleteAggregate(session, task);
    }
    if (recordId.startsWith("task:")) {
      return this.permanentlyDeleteTask(recordId.slice("task:".length));
    }
    return { status: "not_found" };
  }

  permanentlyDeleteTask(taskId: string): PermanentDeleteResult {
    const task = this.tasks.get(taskId);
    if (!task) return { status: "not_found" };
    const session = this.sessions.getByPlanId(task.plan_id, { includeDeleted: true });
    return this.deleteAggregate(session, task);
  }

  private deleteAggregate(
    linkedSession: ConversationSession | undefined,
    task: ReturnType<SqliteTaskStore["get"]>,
  ): PermanentDeleteResult {
    if (task?.status === "processing" || linkedSession?.state === "generating") {
      return { status: "conflict" };
    }

    if (task) this.tasks.flush(task.task_id);
    const referencedImages = task ? this.imageReferences(task) : new Set<string>();
    const conversationPlanIds = new Set<string>();
    if (task) {
      conversationPlanIds.add(task.task_id);
      conversationPlanIds.add(task.plan_id);
    } else if (linkedSession?.planId) {
      conversationPlanIds.add(linkedSession.planId);
    }

    this.sessions.database.raw.transaction(() => {
      if (linkedSession) {
        const removed = this.sessions.database.raw.query(
          "DELETE FROM conversation_sessions WHERE session_id = ?",
        ).run(linkedSession.sessionId);
        if (removed.changes !== 1) throw new Error("conversation session disappeared during deletion");
      }
      for (const planId of conversationPlanIds) {
        this.sessions.database.raw.query("DELETE FROM conversations WHERE plan_id = ?").run(planId);
      }
      if (task) {
        const removed = this.sessions.database.raw.query(
          "DELETE FROM tasks WHERE task_id = ?",
        ).run(task.task_id);
        if (removed.changes !== 1) throw new Error("trip task disappeared during deletion");
      }
    })();

    if (task) this.tasks.delete(task.task_id);
    return { status: "deleted", removedImages: this.cleanupImages(referencedImages) };
  }

  close(): void {
    this.sessions.close();
  }

  private ownerHistory(userId: string): TripHistoryItem[] {
    return this.tasks.listHistory({ userId, limit: Number.MAX_SAFE_INTEGER });
  }

  private tombstone(session: ConversationSession | undefined, task: ReturnType<SqliteTaskStore["get"]>): boolean {
    if (!session && !task) return false;
    if (task) this.tasks.flush(task.task_id);
    const timestamp = new Date().toISOString();
    return this.sessions.database.raw.transaction(() => {
      if (task) {
        const taskResult = this.sessions.database.raw.query(`
          UPDATE tasks
          SET user_deleted_at = COALESCE(user_deleted_at, ?)
          WHERE task_id = ? AND user_id = ?
        `).run(timestamp, task.task_id, task.user_id);
        if (taskResult.changes !== 1) throw new Error("trip task disappeared during soft deletion");
      }
      if (session) {
        const sessionResult = this.sessions.database.raw.query(`
          UPDATE conversation_sessions
          SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
          WHERE session_id = ? AND user_id = ?
        `).run(timestamp, timestamp, session.sessionId, session.userId);
        if (sessionResult.changes !== 1) throw new Error("conversation session disappeared during soft deletion");
      }
      return true;
    })();
  }

  private uniqueTaskForPlan(planId: string) {
    const matches = this.tasks.all().filter((candidate) => candidate.plan_id === planId);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private imageReferences(task: NonNullable<ReturnType<SqliteTaskStore["get"]>>): Set<string> {
    const referenced = new Set<string>();
    for (const match of JSON.stringify(task).matchAll(/\/api\/images\/([^\s"')?]+)/g)) {
      const name = decodeURIComponent(match[1] ?? "");
      if (name && basename(name) === name) referenced.add(name);
    }
    return referenced;
  }

  private cleanupImages(referenced: Set<string>): number {
    const remaining = new Set<string>();
    for (const task of this.tasks.all()) {
      for (const name of this.imageReferences(task)) remaining.add(name);
    }
    let removedImages = 0;
    for (const name of referenced) {
      if (remaining.has(name)) continue;
      const path = join(this.imagesDir, name);
      try {
        if (existsSync(path)) {
          unlinkSync(path);
          removedImages += 1;
        }
      } catch {
        // Image cleanup is best effort after the database transaction commits.
      }
    }
    return removedImages;
  }
}
