import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlannerRunContext, TripPlanner } from "../src/agents/trip-planner.ts";
import type { TripPlanningRequest } from "../src/domain/orchestrator.ts";
import { createHttpRuntime } from "../src/http/app.ts";

interface BenchmarkCase {
  days: number;
  maxMs: number;
}

interface BenchmarkResult {
  days: number;
  elapsed_ms: number;
  max_ms: number;
  plan_quality: string;
  day_count: number;
}

class ManualClock {
  private time = 0;
  private sleepers: Array<{
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
      const entry = {
        due: this.time + milliseconds,
        resolve,
        reject,
        signal,
        abort: () => undefined,
      };
      entry.abort = () => {
        this.sleepers = this.sleepers.filter((candidate) => candidate !== entry);
        reject(signal.reason);
      };
      this.sleepers.push(entry);
      signal.addEventListener("abort", entry.abort, { once: true });
    });

  advanceBy(milliseconds: number): void {
    const target = this.time + milliseconds;
    const ready = this.sleepers
      .filter((entry) => entry.due <= target)
      .sort((left, right) => left.due - right.due);
    for (const entry of ready) {
      this.time = entry.due;
      this.sleepers = this.sleepers.filter((candidate) => candidate !== entry);
      entry.signal.removeEventListener("abort", entry.abort);
      entry.resolve();
    }
    this.time = target;
  }
}

class SlowPlanner implements TripPlanner {
  started = false;

  plan(_request: TripPlanningRequest, context: PlannerRunContext): Promise<Record<string, unknown>> {
    this.started = true;
    return new Promise((_, reject) => {
      if (context.signal.aborted) return reject(context.signal.reason);
      context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    });
  }
}

const cases: BenchmarkCase[] = [
  { days: 7, maxMs: 6_000 },
  { days: 15, maxMs: 10_000 },
  { days: 30, maxMs: 15_000 },
];

function dateAfter(startDate: string, offset: number): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function draft(days: number) {
  const startDate = "2026-10-01";
  const cities = days > 15
    ? [{ city: "大理", days: 15 }, { city: "丽江", days: days - 15 }]
    : [{ city: "大理", days }];
  return {
    city: cities.map((stay) => stay.city).join(" → "),
    cities,
    start_date: startDate,
    end_date: dateAfter(startDate, days - 1),
    travel_days: days,
    transportation: "公共交通",
    accommodation: "舒适型酒店",
    preferences: ["自然风光"],
    traveler_count: 2,
    room_count: 1,
    budget_amount: 20_000,
    budget_basis: "group_total" as const,
    free_text_input: `大理 ${days} 天旅行`,
    origin_text: `大理 ${days} 天旅行`,
    language: "zh-CN",
  };
}

async function benchmarkCase(input: BenchmarkCase): Promise<BenchmarkResult> {
  const dataDir = mkdtempSync(join(tmpdir(), `youban-planning-benchmark-${input.days}-`));
  const clock = new ManualClock();
  const planner = new SlowPlanner();
  const runtime = createHttpRuntime({
    dataDir,
    planner,
    planningClock: { now: clock.now, sleep: clock.sleep },
  });
  const request = draft(input.days);
  try {
    const token = runtime.assistant.ledger.register(request, 0.95).token;
    const acceptedResponse = await runtime.app.handle(new Request("http://localhost/api/trip/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "benchmark-user" },
      body: JSON.stringify({ ...request, execution_token: token }),
    }));
    if (!acceptedResponse.ok) throw new Error(`case ${input.days}: POST failed with ${acceptedResponse.status}`);
    const accepted = await acceptedResponse.json() as { task_id?: string };
    if (!accepted.task_id) throw new Error(`case ${input.days}: missing task_id`);
    while (!planner.started) await Bun.sleep(0);
    const acceptedAt = clock.now();
    let payload: Record<string, any> | null = null;

    while (clock.now() - acceptedAt <= input.maxMs) {
      clock.advanceBy(50);
      await Bun.sleep(0);
      const response = await runtime.app.handle(new Request(
        `http://localhost/api/trip/status/${accepted.task_id}`,
        { headers: { "x-user-id": "benchmark-user" } },
      ));
      if (!response.ok) throw new Error(`case ${input.days}: status failed with ${response.status}`);
      const current = await response.json() as Record<string, any>;
      if (current.status === "completed" && Array.isArray(current.result?.data?.days)) {
        payload = current;
        break;
      }
    }

    if (!payload) throw new Error(`case ${input.days}: no readable plan by ${input.maxMs}ms`);
    const elapsed = clock.now() - acceptedAt;
    const dayCount = payload.result.data.days.length;
    const quality = String(payload.plan_quality ?? "");
    if (elapsed > input.maxMs) throw new Error(`case ${input.days}: ${elapsed}ms exceeds ${input.maxMs}ms`);
    if (dayCount !== input.days) throw new Error(`case ${input.days}: expected ${input.days} days, got ${dayCount}`);
    if (quality !== "fast" && quality !== "enhanced") {
      throw new Error(`case ${input.days}: unexpected plan quality ${quality || "missing"}`);
    }
    return {
      days: input.days,
      elapsed_ms: elapsed,
      max_ms: input.maxMs,
      plan_quality: quality,
      day_count: dayCount,
    };
  } finally {
    await runtime.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const results: BenchmarkResult[] = [];
for (const input of cases) results.push(await benchmarkCase(input));
console.log(JSON.stringify(results));
