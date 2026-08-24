import { planRevision } from "../agents/trip-chat-service.ts";
import { buildFastTripPlan } from "../domain/fast-trip-plan.ts";
import { ensurePlanItemIds } from "../domain/plan-items.ts";
import { fastPlanTriggerMs, planningDeadlineMs } from "../domain/planning-deadline.ts";
import type { TripPlanningRequest } from "../domain/orchestrator.ts";
import type { EnhancementStatus, PlanQuality } from "../domain/task-store.ts";

export type { EnhancementStatus, PlanQuality } from "../domain/task-store.ts";

export interface PlanGenerationMetadata {
  deadlineSeconds: number | null;
  elapsedMs: number;
  fastPlanRevision: string | null;
  enhancementStatus: EnhancementStatus;
}

export interface PlanGenerationCurrent {
  status: "processing" | "completed" | "failed";
  quality: PlanQuality | null;
  result: Record<string, unknown> | null;
  fastPlanRevision: string | null;
}

type MaybePromise<T> = T | Promise<T>;

export interface StartPlanGenerationOptions {
  request: TripPlanningRequest;
  signal: AbortSignal;
  enhanced: Promise<Record<string, unknown>>;
  latestCheckpoint(): unknown;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  publishFirst(
    quality: PlanQuality,
    result: Record<string, unknown>,
    metadata: PlanGenerationMetadata,
  ): MaybePromise<boolean | void>;
  readCurrent(): MaybePromise<PlanGenerationCurrent | null>;
  publishEnhancement(
    result: Record<string, unknown>,
    expectedFastRevision: string,
    metadata: PlanGenerationMetadata,
  ): MaybePromise<boolean>;
  updateEnhancement(
    status: Exclude<EnhancementStatus, "pending" | "running" | "completed">,
    message: string | null,
    elapsedMs: number,
  ): MaybePromise<boolean | void>;
}

export interface PlanGenerationRun {
  firstPublished: Promise<void>;
  enhancementSettled: Promise<void>;
  cancel(): void;
}

type EnhancedOutcome =
  | { kind: "enhanced"; result: Record<string, unknown> }
  | { kind: "error"; error: unknown };

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function resultPlan(result: Record<string, unknown> | null): unknown {
  const data = result?.data;
  return data !== null && typeof data === "object" && !Array.isArray(data) ? data : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function startPlanGeneration(options: StartPlanGenerationOptions): PlanGenerationRun {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const deadline = planningDeadlineMs(options.request.travel_days);
  const trigger = fastPlanTriggerMs(options.request.travel_days);
  const runAbort = new AbortController();
  const timerAbort = new AbortController();
  let expectedFastRevision: string | null = null;
  let resolveCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => { resolveCancelled = resolve; });

  const cancel = (): void => {
    if (!runAbort.signal.aborted) {
      runAbort.abort(new Error("plan generation cancelled"));
      resolveCancelled();
    }
    if (!timerAbort.signal.aborted) timerAbort.abort(runAbort.signal.reason);
  };
  const onParentAbort = () => cancel();
  if (options.signal.aborted) cancel();
  else options.signal.addEventListener("abort", onParentAbort, { once: true });

  const enhancedOutcome: Promise<EnhancedOutcome> = options.enhanced.then(
    (result) => ({ kind: "enhanced", result }),
    (error) => ({ kind: "error", error }),
  );
  const cancellationOutcome = cancelled.then(() => ({ kind: "cancelled" as const }));
  const timerOutcome = trigger === null
    ? null
    : sleep(trigger, timerAbort.signal).then(
      () => ({ kind: "timer" as const }),
      (error) => timerAbort.signal.aborted
        ? ({ kind: "cancelled" as const })
        : ({ kind: "timer-error" as const, error }),
    );

  const metadata = (
    enhancementStatus: EnhancementStatus,
    fastPlanRevision: string | null,
  ): PlanGenerationMetadata => ({
    deadlineSeconds: deadline === null ? null : deadline / 1_000,
    elapsedMs: Math.max(0, now() - startedAt),
    fastPlanRevision,
    enhancementStatus,
  });

  const firstPublished = (async (): Promise<void> => {
    const winner = await Promise.race([
      enhancedOutcome,
      cancellationOutcome,
      ...(timerOutcome ? [timerOutcome] : []),
    ]);
    if (winner.kind === "cancelled") return;
    if (winner.kind === "timer-error") {
      cancel();
      throw winner.error;
    }
    if (winner.kind === "error") {
      if (!timerAbort.signal.aborted) timerAbort.abort(winner.error);
      throw winner.error;
    }
    if (winner.kind === "enhanced") {
      if (!timerAbort.signal.aborted) timerAbort.abort();
      if (runAbort.signal.aborted) return;
      const published = await options.publishFirst(
        "enhanced",
        winner.result,
        metadata("completed", null),
      );
      if (published === false) cancel();
      return;
    }

    if (runAbort.signal.aborted) return;
    const fast = buildFastTripPlan(options.request, options.latestCheckpoint());
    ensurePlanItemIds(fast);
    expectedFastRevision = planRevision(resultPlan(fast));
    const published = await options.publishFirst(
      "fast",
      fast,
      metadata("running", expectedFastRevision),
    );
    if (published === false) cancel();
  })();

  const currentFastState = async (): Promise<{
    current: PlanGenerationCurrent;
    revisionMatches: boolean;
  } | null> => {
    if (!expectedFastRevision || runAbort.signal.aborted) return null;
    const current = await options.readCurrent();
    if (!current
      || current.status !== "completed"
      || current.quality !== "fast"
      || current.fastPlanRevision !== expectedFastRevision) return null;
    return {
      current,
      revisionMatches: planRevision(resultPlan(current.result)) === expectedFastRevision,
    };
  };

  const safeUpdate = async (
    status: "failed" | "skipped",
    message: string | null,
  ): Promise<void> => {
    if (runAbort.signal.aborted) return;
    try {
      await options.updateEnhancement(status, message, Math.max(0, now() - startedAt));
    } catch {
      // A usable fast plan is already persisted; metadata failure must not reject in the background.
    }
  };

  const enhancementSettled = (async (): Promise<void> => {
    try {
      try {
        await firstPublished;
      } catch {
        return;
      }
      if (!expectedFastRevision || runAbort.signal.aborted) return;
      const outcome = await Promise.race([enhancedOutcome, cancellationOutcome]);
      if (outcome.kind === "cancelled" || runAbort.signal.aborted) return;
      const snapshot = await currentFastState();
      if (!snapshot) return;
      if (!snapshot.revisionMatches) {
        await safeUpdate("skipped", null);
        return;
      }
      if (outcome.kind === "error") {
        await safeUpdate("failed", errorMessage(outcome.error));
        return;
      }
      try {
        const applied = await options.publishEnhancement(
          outcome.result,
          expectedFastRevision,
          metadata("completed", expectedFastRevision),
        );
        if (!applied) await safeUpdate("skipped", null);
      } catch (error) {
        await safeUpdate("failed", errorMessage(error));
      }
    } finally {
      options.signal.removeEventListener("abort", onParentAbort);
      if (!timerAbort.signal.aborted) timerAbort.abort();
    }
  })();

  return { firstPublished, enhancementSettled, cancel };
}
