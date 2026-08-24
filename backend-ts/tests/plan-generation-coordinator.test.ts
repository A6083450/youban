import { describe, expect, it } from "bun:test";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import {
  startPlanGeneration,
  type EnhancementStatus,
  type PlanGenerationCurrent,
  type PlanGenerationMetadata,
  type PlanQuality,
} from "../src/services/plan-generation-coordinator.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ManualClock {
  private time = 0;
  private nextId = 0;
  private sleepers: Array<{
    id: number;
    due: number;
    resolve: () => void;
    reject: (reason?: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }> = [];

  readonly now = () => this.time;

  readonly sleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const id = ++this.nextId;
      const abort = () => {
        this.remove(id);
        reject(signal.reason);
      };
      this.sleepers.push({
        id,
        due: this.time + milliseconds,
        resolve,
        reject,
        signal,
        abort,
      });
      signal.addEventListener("abort", abort, { once: true });
    });

  get pendingCount(): number {
    return this.sleepers.length;
  }

  elapseBy(milliseconds: number): void {
    this.time += milliseconds;
  }

  advanceBy(milliseconds: number): void {
    const target = this.time + milliseconds;
    const ready = this.sleepers
      .filter((entry) => entry.due <= target)
      .sort((left, right) => left.due - right.due);
    for (const entry of ready) {
      this.time = entry.due;
      this.remove(entry.id);
      entry.signal.removeEventListener("abort", entry.abort);
      entry.resolve();
    }
    this.time = target;
  }

  private remove(id: number): void {
    this.sleepers = this.sleepers.filter((entry) => entry.id !== id);
  }
}

function request(days: number): TripPlanningRequest {
  const end = new Date("2026-10-01T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + days - 1);
  return {
    city: "大理",
    cities: [{ city: "大理", days }],
    start_date: "2026-10-01",
    end_date: end.toISOString().slice(0, 10),
    travel_days: days,
    transportation: "公共交通",
    accommodation: "舒适型酒店",
    preferences: ["自然风光"],
    traveler_count: 2,
    room_count: 1,
    budget_amount: 8_000,
    budget_basis: "group_total",
    language: "zh-CN",
  };
}

function enhancedResult(input: TripPlanningRequest, marker = "enhanced") {
  return {
    success: true,
    data: {
      ...input,
      marker,
      days: Array.from({ length: input.travel_days }, (_, dayIndex) => ({
        date: new Date(Date.parse(`${input.start_date}T00:00:00Z`) + dayIndex * 86_400_000)
          .toISOString().slice(0, 10),
        day_index: dayIndex,
        city: input.city,
        attractions: [],
      })),
    },
  };
}

function harness(input: TripPlanningRequest, enhanced: Promise<Record<string, unknown>>, clock: ManualClock) {
  let current: PlanGenerationCurrent | null = null;
  const publications: Array<{ quality: PlanQuality; result: Record<string, unknown> }> = [];
  const statuses: EnhancementStatus[] = [];
  const controller = new AbortController();
  const run = startPlanGeneration({
    request: input,
    signal: controller.signal,
    enhanced,
    latestCheckpoint: () => ({}),
    now: clock.now,
    sleep: clock.sleep,
    publishFirst(quality, result, metadata: PlanGenerationMetadata) {
      publications.push({ quality, result: structuredClone(result) });
      current = {
        status: "completed",
        quality,
        result: structuredClone(result),
        fastPlanRevision: metadata.fastPlanRevision,
      };
      statuses.push(metadata.enhancementStatus);
      return true;
    },
    readCurrent: () => current && structuredClone(current),
    publishEnhancement(result) {
      if (!current) return false;
      publications.push({ quality: "enhanced", result: structuredClone(result) });
      current = {
        ...current,
        quality: "enhanced",
        result: structuredClone(result),
      };
      statuses.push("completed");
      return true;
    },
    updateEnhancement(status) {
      if (!current) return false;
      statuses.push(status);
      return true;
    },
  });
  return {
    run,
    controller,
    publications,
    statuses,
    current: () => current && structuredClone(current),
    replaceCurrent: (value: PlanGenerationCurrent | null) => { current = value; },
  };
}

describe("plan generation coordinator", () => {
  it("publishes an enhanced result that completes before the fast trigger", async () => {
    const clock = new ManualClock();
    const enhanced = deferred<Record<string, unknown>>();
    const input = request(7);
    const state = harness(input, enhanced.promise, clock);

    enhanced.resolve(enhancedResult(input));
    await state.run.firstPublished;
    await state.run.enhancementSettled;

    expect(state.publications).toEqual([{ quality: "enhanced", result: enhancedResult(input) }]);
    expect(state.statuses).toEqual(["completed"]);
    expect(clock.pendingCount).toBe(0);
  });

  it("publishes fast when an enhanced result is delivered after a delayed timer threshold", async () => {
    const clock = new ManualClock();
    const enhanced = deferred<Record<string, unknown>>();
    const input = request(15);
    const state = harness(input, enhanced.promise, clock);

    clock.elapseBy(9_500);
    enhanced.resolve(enhancedResult(input));
    await state.run.firstPublished;
    await state.run.enhancementSettled;

    expect(state.publications.map(({ quality }) => quality)).toEqual(["fast", "enhanced"]);
    expect(state.statuses).toEqual(["running", "completed"]);
    expect(clock.pendingCount).toBe(0);
  });

  it("publishes a complete fast plan at 5.5 seconds then upgrades an unchanged plan", async () => {
    const clock = new ManualClock();
    const enhanced = deferred<Record<string, unknown>>();
    const input = request(7);
    const state = harness(input, enhanced.promise, clock);
    let published = false;
    void state.run.firstPublished.then(() => { published = true; });

    clock.advanceBy(5_499);
    await Promise.resolve();
    expect(published).toBe(false);
    clock.advanceBy(1);
    await state.run.firstPublished;

    expect(state.publications[0]?.quality).toBe("fast");
    expect(((state.publications[0]?.result.data as Record<string, unknown>).days as unknown[])).toHaveLength(7);
    expect(state.statuses).toEqual(["running"]);

    enhanced.resolve(enhancedResult(input));
    await state.run.enhancementSettled;
    expect(state.publications.at(-1)).toEqual({ quality: "enhanced", result: enhancedResult(input) });
    expect(state.statuses.at(-1)).toBe("completed");
    expect(clock.pendingCount).toBe(0);
  });

  it("skips a late enhancement when the fast plan revision changed", async () => {
    const clock = new ManualClock();
    const enhanced = deferred<Record<string, unknown>>();
    const input = request(7);
    const state = harness(input, enhanced.promise, clock);
    clock.advanceBy(5_500);
    await state.run.firstPublished;
    const edited = state.current()!;
    const result = structuredClone(edited.result) as Record<string, any>;
    result.data.days[0].description = "用户保留的修改";
    state.replaceCurrent({ ...edited, result });

    enhanced.resolve(enhancedResult(input));
    await state.run.enhancementSettled;

    expect(state.current()?.quality).toBe("fast");
    expect((state.current()?.result as Record<string, any>).data.days[0].description).toBe("用户保留的修改");
    expect(state.statuses.at(-1)).toBe("skipped");
  });

  it("retains a completed fast plan when background enhancement fails", async () => {
    const clock = new ManualClock();
    const enhanced = deferred<Record<string, unknown>>();
    const input = request(7);
    const state = harness(input, enhanced.promise, clock);
    clock.advanceBy(5_500);
    await state.run.firstPublished;
    const fast = state.current();

    enhanced.reject(new Error("enhanced unavailable"));
    await state.run.enhancementSettled;

    expect(state.current()).toEqual(fast);
    expect(state.statuses.at(-1)).toBe("failed");
  });

  it("settles cancellation without a late publication or timer leak", async () => {
    const clock = new ManualClock();
    const enhanced = deferred<Record<string, unknown>>();
    const input = request(7);
    const state = harness(input, enhanced.promise, clock);

    state.run.cancel();
    enhanced.resolve(enhancedResult(input));
    clock.advanceBy(10_000);
    await state.run.firstPublished;
    await state.run.enhancementSettled;

    expect(state.publications).toEqual([]);
    expect(state.statuses).toEqual([]);
    expect(clock.pendingCount).toBe(0);
  });

  it("does not schedule a fast timer for a 31-day request", async () => {
    const clock = new ManualClock();
    const enhanced = deferred<Record<string, unknown>>();
    const input = request(31);
    const state = harness(input, enhanced.promise, clock);

    expect(clock.pendingCount).toBe(0);
    clock.advanceBy(30_000);
    expect(state.publications).toEqual([]);
    enhanced.resolve(enhancedResult(input));
    await state.run.firstPublished;
    await state.run.enhancementSettled;

    expect(state.publications[0]?.quality).toBe("enhanced");
    expect(clock.pendingCount).toBe(0);
  });
});
