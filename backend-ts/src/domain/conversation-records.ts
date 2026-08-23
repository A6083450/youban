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

function projectSession(session: ConversationSession, plan?: TripHistoryItem): ConversationRecord {
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
    user_deleted_at: session.deletedAt,
  };
}

function projectLegacyPlan(plan: TripHistoryItem): ConversationRecord {
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
    user_deleted_at: null,
  };
}

export class ConversationRecordService {
  constructor(
    private readonly sessions: ConversationSessionRepository,
    private readonly tasks: SqliteTaskStore,
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
      ...history.filter((plan) => !linkedPlanIds.has(plan.plan_id)).map(projectLegacyPlan),
    ]
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

  softDeleteSession(sessionId: string, userId: string): boolean {
    if (!this.sessions.getOwned(sessionId, userId)) return false;
    return this.sessions.softDelete(sessionId, userId);
  }

  softDeletePlan(planId: string, userId: string): boolean {
    const task = this.tasks.all().find((item) => item.plan_id === planId && item.user_id === userId);
    if (!task) return false;
    const linked = this.sessions.getByPlanId(planId);
    if (linked?.userId === userId) this.sessions.softDelete(linked.sessionId, userId);
    return this.tasks.softDelete(task.task_id);
  }

  close(): void {
    this.sessions.close();
  }

  private ownerHistory(userId: string): TripHistoryItem[] {
    return this.tasks.listHistory({ userId, limit: Number.MAX_SAFE_INTEGER });
  }
}
