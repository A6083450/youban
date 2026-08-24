import { desc, eq } from "drizzle-orm";
import { tasksTable } from "./db-schema.ts";
import { YoubanDatabase } from "./database.ts";
import { ensurePlanItemIds } from "./plan-items.ts";

export type TripTaskStatus = "processing" | "completed" | "failed";
export type TripTaskStage =
  | "submitted"
  | "initializing"
  | "attraction_search"
  | "weather_search"
  | "hotel_search"
  | "planning"
  | "reviewing"
  | "graph_building"
  | "completed"
  | "failed";

export interface TripTaskDetail {
  type: "thinking" | "searching" | "found" | "planning" | "tool_call" | "info";
  title: string;
  content?: string;
  timestamp?: number;
}

export interface TripTaskState {
  task_id: string;
  plan_id: string;
  status: TripTaskStatus;
  stage: TripTaskStage;
  progress: number;
  message: string;
  details: TripTaskDetail[];
  result: unknown | null;
  error: string | null;
  user_id: string;
  share_token: string;
  request_payload: Record<string, unknown> | null;
  checkpoint: Record<string, unknown>;
  execution: Record<string, unknown>;
  budget_items: unknown[] | null;
}

export interface TripHistoryItem {
  plan_id: string;
  task_id: string;
  status: TripTaskStatus;
  user_id: string;
  city: string;
  cities: unknown[];
  start_date: string;
  end_date: string;
  travel_days: number;
  updated_at: string;
  overall_suggestions: string;
}

const RESTART_ERROR = "服务已重启，未完成的旅行规划任务无法恢复，请重新生成。";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createTaskState(
  taskId: string,
  overrides: Partial<Omit<TripTaskState, "task_id" | "plan_id">> & { plan_id?: string } = {},
): TripTaskState {
  return {
    task_id: taskId,
    plan_id: overrides.plan_id ?? taskId,
    status: "processing",
    stage: "submitted",
    progress: 0,
    message: "任务已提交，等待执行...",
    details: [],
    result: null,
    error: null,
    user_id: "",
    share_token: "",
    request_payload: null,
    checkpoint: {},
    execution: {},
    budget_items: null,
    ...overrides,
  };
}

export function buildTaskEvent(task: TripTaskState, includeResult = true): Record<string, unknown> {
  const event: Record<string, unknown> = {
    task_id: task.task_id,
    plan_id: task.plan_id,
    status: task.status,
    stage: task.stage,
    progress: task.progress,
    message: task.message,
  };
  if (task.details.length > 0) event.details = clone(task.details);
  const checkpointSummary = buildCheckpointSummary(task.checkpoint);
  if (checkpointSummary) event.checkpoint_summary = checkpointSummary;
  if (task.error) event.error = task.error;
  if (task.status === "failed" && task.request_payload) {
    event.request_payload = clone(task.request_payload);
  }
  if (includeResult && task.result !== null) event.result = clone(task.result);
  return event;
}

export function buildCheckpointSummary(checkpoint: unknown): {
  completed_segments: number;
  total_segments: number;
  last_successful_stage: string;
} | null {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)
    || Object.keys(checkpoint).length === 0) return null;
  const value = checkpoint as Record<string, unknown>;
  const segments = value.segments && typeof value.segments === "object" && !Array.isArray(value.segments)
    ? value.segments as Record<string, unknown>
    : {};
  const completedSegments = Object.values(segments).filter((segment) =>
    segment && typeof segment === "object" && !Array.isArray(segment)
      && (segment as Record<string, unknown>).status === "completed"
  ).length;
  let lastStage = "";
  const search = value.search;
  if (search && typeof search === "object" && !Array.isArray(search)
    && Object.values(search as Record<string, unknown>).some((entries) =>
      entries && typeof entries === "object" && !Array.isArray(entries) && Object.keys(entries).length > 0
    )) lastStage = "search";
  if (completedSegments > 0) lastStage = "segments";
  for (const stage of ["summary", "review"] as const) {
    const entry = value[stage];
    if (entry && typeof entry === "object" && !Array.isArray(entry)
      && (entry as Record<string, unknown>).status === "completed") lastStage = stage;
  }
  return {
    completed_segments: completedSegments,
    total_segments: Object.keys(segments).length,
    last_successful_stage: lastStage,
  };
}

export interface SaveOptions {
  immediate?: boolean;
}

export class SqliteTaskStore {
  readonly database: YoubanDatabase;
  private readonly cache = new Map<string, TripTaskState>();
  private readonly updatedAt = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscribers = new Map<string, Set<(event: Record<string, unknown>) => void>>();
  private readonly flushDelayMs: number;
  private closed = false;

  constructor(path: string, options: { flushDelayMs?: number } = {}) {
    this.flushDelayMs = options.flushDelayMs ?? 75;
    this.database = new YoubanDatabase(path);
    this.loadAndRecover();
  }

  private loadAndRecover(): void {
    const rows = this.database.orm.select().from(tasksTable).all();
    for (const row of rows) {
      const task = JSON.parse(row.payload) as TripTaskState;
      const itemIdsAdded = ensurePlanItemIds(task.result);
      this.cache.set(task.task_id, task);
      this.updatedAt.set(task.task_id, row.updatedAt);
      if (task.status !== "completed" && task.status !== "failed") {
        task.status = "failed";
        task.stage = "failed";
        task.progress = 100;
        task.error = RESTART_ERROR;
        task.message = RESTART_ERROR;
        this.write(task);
      } else if (itemIdsAdded) {
        this.write(task);
      }
    }
  }

  get(taskId: string): TripTaskState | undefined {
    const task = this.cache.get(taskId);
    return task ? clone(task) : undefined;
  }

  all(): TripTaskState[] {
    return [...this.cache.values()].map(clone);
  }

  delete(taskId: string): boolean {
    if (this.closed) throw new Error("task store is closed");
    const timer = this.timers.get(taskId);
    if (timer) clearTimeout(timer);
    this.timers.delete(taskId);
    this.updatedAt.delete(taskId);
    this.subscribers.delete(taskId);
    const existed = this.cache.delete(taskId);
    this.database.orm.delete(tasksTable).where(eq(tasksTable.taskId, taskId)).run();
    return existed;
  }

  softDelete(taskId: string): boolean {
    if (this.closed) throw new Error("task store is closed");
    this.flush(taskId);
    const result = this.database.raw.query(`
      UPDATE tasks
      SET user_deleted_at = COALESCE(user_deleted_at, ?)
      WHERE task_id = ?
    `).run(nowIso(), taskId);
    return result.changes === 1;
  }

  isUserDeleted(taskId: string): boolean {
    this.flush(taskId);
    const row = this.database.orm
      .select({ userDeletedAt: tasksTable.userDeletedAt })
      .from(tasksTable)
      .where(eq(tasksTable.taskId, taskId))
      .get();
    return row?.userDeletedAt !== null && row?.userDeletedAt !== undefined;
  }

  save(task: TripTaskState, options: SaveOptions = {}): void {
    if (this.closed) throw new Error("task store is closed");
    const snapshot = clone(task);
    ensurePlanItemIds(snapshot.result);
    this.cache.set(snapshot.task_id, snapshot);
    this.updatedAt.set(snapshot.task_id, nowIso());
    this.emit(snapshot);
    if (options.immediate || snapshot.status === "completed" || snapshot.status === "failed") {
      this.flush(snapshot.task_id);
      return;
    }
    const existing = this.timers.get(snapshot.task_id);
    if (existing) clearTimeout(existing);
    this.timers.set(snapshot.task_id, setTimeout(() => this.flush(snapshot.task_id), this.flushDelayMs));
  }

  flush(taskId?: string): void {
    if (taskId) {
      const timer = this.timers.get(taskId);
      if (timer) clearTimeout(timer);
      this.timers.delete(taskId);
      const task = this.cache.get(taskId);
      if (task) this.write(task);
      return;
    }
    for (const id of [...this.timers.keys()]) this.flush(id);
    for (const [id, task] of this.cache) {
      if (!this.timers.has(id)) this.write(task);
    }
  }

  private write(task: TripTaskState): void {
    const previous = this.database.orm
      .select({ createdAt: tasksTable.createdAt })
      .from(tasksTable)
      .where(eq(tasksTable.taskId, task.task_id))
      .get();
    const timestamp = this.updatedAt.get(task.task_id) ?? nowIso();
    this.database.orm
      .insert(tasksTable)
      .values({
        taskId: task.task_id,
        planId: task.plan_id,
        userId: task.user_id,
        status: task.status,
        shareToken: task.share_token,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        payload: JSON.stringify(task),
      })
      .onConflictDoUpdate({
        target: tasksTable.taskId,
        set: {
          planId: task.plan_id,
          userId: task.user_id,
          status: task.status,
          shareToken: task.share_token,
          updatedAt: timestamp,
          payload: JSON.stringify(task),
        },
      })
      .run();
  }

  subscribe(taskId: string, listener: (event: Record<string, unknown>) => void): () => void {
    const listeners = this.subscribers.get(taskId) ?? new Set();
    listeners.add(listener);
    this.subscribers.set(taskId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.subscribers.delete(taskId);
    };
  }

  private emit(task: TripTaskState): void {
    const event = buildTaskEvent(task, true);
    for (const listener of this.subscribers.get(task.task_id) ?? []) listener(event);
  }

  listHistory(options: {
    userId: string;
    limit: number;
    allUsers?: boolean;
    includeUserDeleted?: boolean;
  }): TripHistoryItem[] {
    this.flush();
    const rows = this.database.orm.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt)).all();
    const items: TripHistoryItem[] = [];
    const includeUserDeleted = options.includeUserDeleted ?? options.allUsers === true;
    for (const row of rows) {
      if (!options.allUsers && row.userId !== options.userId) continue;
      if (!includeUserDeleted && row.userDeletedAt !== null) continue;
      const task = JSON.parse(row.payload) as TripTaskState;
      const item = historyItem(task, row.updatedAt);
      if (item) items.push(item);
      if (items.length >= options.limit) break;
    }
    return items;
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.subscribers.clear();
    this.database.close();
  }
}

function historyItem(task: TripTaskState, updatedAt: string): TripHistoryItem | null {
  const request = task.request_payload ?? {};
  const result = (task.result ?? {}) as Record<string, unknown>;
  const plan = (result.data ?? {}) as Record<string, unknown>;
  const rawCities = (plan.cities ?? request.cities ?? []) as unknown[];
  const cityNames = rawCities.map((entry) =>
    typeof entry === "string" ? entry : String((entry as Record<string, unknown>)?.city ?? ""),
  ).filter(Boolean);
  const city = String(plan.city ?? request.city ?? "");
  if (!city && cityNames.length === 0) return null;
  const days = Array.isArray(plan.days) ? plan.days : [];
  return {
    plan_id: task.plan_id,
    task_id: task.task_id,
    status: task.status,
    user_id: task.user_id,
    city: cityNames.length > 1 ? cityNames.join(" → ") : city || cityNames[0] || "",
    cities: rawCities,
    start_date: String(plan.start_date ?? request.start_date ?? ""),
    end_date: String(plan.end_date ?? request.end_date ?? ""),
    travel_days: Number(request.travel_days ?? days.length ?? 0),
    updated_at: updatedAt,
    overall_suggestions: String(plan.overall_suggestions ?? result.message ?? ""),
  };
}
