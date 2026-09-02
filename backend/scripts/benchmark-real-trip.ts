import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_BENCHMARK_INPUT = "国庆新疆玩一个月帮我计划下";

export interface BenchmarkOptions {
  baseUrl: string;
  input: string;
  runs: number;
  generationTimeoutMs: number;
  requestTimeoutMs: number;
  p50LimitMs: number;
  p95LimitMs: number;
  outputPath: string;
}

export interface BenchmarkSample {
  run: number;
  success: boolean;
  generation_ms?: number;
  end_to_end_ms: number;
  parse_ms?: number;
  confirm_ms?: number;
  clarification_turns?: number;
  stage_ms?: Record<string, number>;
  plan_id?: string;
  travel_days?: number;
  cities?: string[];
  quality_errors: string[];
  error?: string;
}

interface ConversationItem {
  role: "user" | "assistant";
  content: string;
}

type ParseTurn = (
  text: string,
  history: ConversationItem[],
) => Promise<Record<string, any>>;

interface ThresholdOptions {
  p50LimitMs: number;
  p95LimitMs: number;
}

function argument(argv: string[], name: string): string | undefined {
  return argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function positiveInteger(value: string | undefined, fallback: number, minimum = 1): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

export function benchmarkNickname(run: number, timestamp = Date.now()): string {
  return `bench-${timestamp.toString(36).slice(-8)}-${run}`.slice(0, 20);
}

export function benchmarkOptionsFromArgv(argv: string[]): BenchmarkOptions {
  return {
    baseUrl: (argument(argv, "base-url") ?? process.env.YOUBAN_BENCH_BASE_URL ?? "http://127.0.0.1:7860")
      .replace(/\/+$/, ""),
    input: argument(argv, "input") ?? DEFAULT_BENCHMARK_INPUT,
    runs: positiveInteger(argument(argv, "runs"), 10),
    generationTimeoutMs: positiveInteger(argument(argv, "generation-timeout-ms"), 45_000, 1_000),
    requestTimeoutMs: positiveInteger(argument(argv, "request-timeout-ms"), 120_000, 1_000),
    p50LimitMs: positiveInteger(argument(argv, "p50-limit-ms"), 30_000, 1_000),
    p95LimitMs: positiveInteger(argument(argv, "p95-limit-ms"), 35_000, 1_000),
    outputPath: argument(argv, "output") ?? "",
  };
}

export function nearestRankPercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new Error("percentile 必须在 (0, 1] 范围内");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

export function recordStageOffset(
  stages: Record<string, number>,
  frame: Record<string, any>,
  elapsedMs: number,
): void {
  const stage = String(frame.stage ?? "").trim();
  if (stage && stages[stage] === undefined) stages[stage] = Math.round(elapsedMs);
}

function clarificationAnswer(today: string): string {
  const year = /^\d{4}-/.test(today) ? today.slice(0, 4) : String(new Date().getFullYear());
  return `按合理默认值继续：${year}年10月1日出发，10月30日返程，1人，预算暂不限制，南北疆都安排，公共交通结合当地包车，舒适型住宿。请直接给出可执行草稿，不再追问。`;
}

export async function resolveTripDraft(
  input: string,
  today: string,
  parseTurn: ParseTurn,
): Promise<{ draft: Record<string, any>; clarification_turns: number }> {
  const history: ConversationItem[] = [];
  let text = input;
  for (let turn = 0; turn < 2; turn += 1) {
    const parsed = await parseTurn(text, history);
    const draft = parsed.trip;
    if (record(draft) && Array.isArray(draft.cities) && draft.cities.length > 0) {
      return { draft, clarification_turns: turn };
    }
    if (turn > 0 || !["clarify", "recommend"].includes(String(parsed.action))) {
      throw new Error(`第 ${turn + 1} 轮理解未返回可执行草稿，action=${String(parsed.action ?? "unknown")}`);
    }
    history.push(
      { role: "user", content: text },
      { role: "assistant", content: String(parsed.reply ?? parsed.clarify_question ?? "请补充行程信息") },
    );
    text = clarificationAnswer(today);
  }
  throw new Error("行程理解未返回可执行草稿");
}

export function buildPlanPayload(
  draft: Record<string, any>,
  executionToken: string,
  input: string,
): Record<string, any> {
  const { inferred_fields: _inferred, suggestions: _suggestions, ...requestDraft } = draft;
  return {
    ...requestDraft,
    language: "zh-CN",
    conversation: [{ role: "user", content: input }],
    execution_token: executionToken,
  };
}

function timingSummary(samples: BenchmarkSample[], field: "generation_ms" | "end_to_end_ms") {
  const values = samples.map((sample) => sample[field]).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value));
  return {
    p50: nearestRankPercentile(values, 0.5),
    p95: nearestRankPercentile(values, 0.95),
    max: values.length > 0 ? Math.max(...values) : 0,
  };
}

export function summarizeBenchmark(samples: BenchmarkSample[], thresholds: ThresholdOptions) {
  const successfulRuns = samples.filter((sample) => sample.success).length;
  const generation = timingSummary(samples, "generation_ms");
  return {
    run_count: samples.length,
    successful_runs: successfulRuns,
    success_rate: samples.length === 0 ? 0 : successfulRuns / samples.length,
    generation_ms: generation,
    end_to_end_ms: timingSummary(samples, "end_to_end_ms"),
    thresholds: {
      p50_ms: thresholds.p50LimitMs,
      p95_ms: thresholds.p95LimitMs,
    },
    passed: samples.length > 0
      && successfulRuns === samples.length
      && generation.p50 <= thresholds.p50LimitMs
      && generation.p95 <= thresholds.p95LimitMs,
  };
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorSummary(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try { return errorSummary(JSON.parse(text)); } catch { /* use the bounded text below */ }
    }
    return text.slice(0, 300);
  }
  if (!record(value)) return "request failed";
  for (const field of [value.summary, value.message, value.error]) {
    if (typeof field === "string" && field.trim()) return field.trim().slice(0, 300);
  }
  if (Array.isArray(value.errors) && value.errors.length > 0) return errorSummary(value.errors[0]);
  return "request failed";
}

export function formatHttpError(
  method: string,
  path: string,
  status: number,
  body: Record<string, any>,
): string {
  return `${method} ${path} -> ${status}: ${errorSummary(body.detail ?? body)}`;
}

function addDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function validateTripQuality(
  rawDraft: unknown,
  rawResult: unknown,
  rawBudget: unknown,
): string[] {
  const errors: string[] = [];
  const draft = record(rawDraft) ? rawDraft : {};
  const result = record(rawResult) ? rawResult : {};
  const data = record(result.data) ? result.data : {};
  const days = Array.isArray(data.days) ? data.days : [];
  const travelDays = Number(draft.travel_days);
  if (result.success !== true) errors.push("生成结果 success 不为 true");
  if (!Number.isInteger(travelDays) || travelDays < 1) {
    errors.push("草稿 travel_days 不是正整数");
  } else if (days.length !== travelDays) {
    errors.push(`行程天数 ${days.length} 与草稿 ${travelDays} 不一致`);
  }

  const cities = Array.isArray(draft.cities) ? draft.cities : [];
  const expectedCities = cities.flatMap((entry) => {
    if (!record(entry)) return [];
    const count = Number(entry.days);
    return Number.isInteger(count) && count > 0
      ? Array.from({ length: count }, () => String(entry.city ?? ""))
      : [];
  });
  const startDate = String(draft.start_date ?? "");
  days.forEach((rawDay, index) => {
    const day = record(rawDay) ? rawDay : {};
    if (day.day_index !== index) {
      errors.push(`第 ${index + 1} 天 day_index 应为 ${index}，实际为 ${String(day.day_index)}`);
    }
    const expectedDate = addDays(startDate, index);
    if (day.date !== expectedDate) {
      errors.push(`第 ${index + 1} 天日期应为 ${expectedDate}，实际为 ${String(day.date)}`);
    }
    if (expectedCities[index] !== undefined && day.city !== expectedCities[index]) {
      errors.push(`第 ${index + 1} 天城市应为 ${expectedCities[index]}，实际为 ${String(day.city)}`);
    }
  });
  if (expectedCities.length !== travelDays) errors.push("草稿城市天数总和与 travel_days 不一致");

  const budget = record(rawBudget) ? rawBudget : {};
  const totals = record(budget.totals) ? budget.totals : {};
  const total = Number(totals.total);
  if (!Number.isFinite(total) || total < 0) errors.push("预算总额必须是非负有限数值");
  return errors;
}

export function validateApprovedInputDraft(rawDraft: unknown): string[] {
  const draft = record(rawDraft) ? rawDraft : {};
  const errors: string[] = [];
  const travelDays = Number(draft.travel_days);
  if (travelDays !== 30) {
    errors.push(`一个月行程必须为 30 天，实际为 ${String(draft.travel_days)} 天`);
  }
  const cities = Array.isArray(draft.cities) ? draft.cities : [];
  const concreteCities = cities.filter((entry) => {
    if (!record(entry)) return false;
    return !/^(新疆|新疆维吾尔自治区)$/.test(String(entry.city ?? "").trim());
  });
  if (concreteCities.length < 2) {
    errors.push("新疆行程必须拆分为至少两个具体目的地");
  }
  const startDate = String(draft.start_date ?? "");
  const expectedEndDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? addDays(startDate, 29) : "";
  if (!expectedEndDate) {
    errors.push(`行程开始日期无效，实际为 ${startDate || "空"}`);
  } else if (draft.end_date !== expectedEndDate) {
    errors.push(`行程结束日期必须为 ${expectedEndDate}，实际为 ${String(draft.end_date ?? "空")}`);
  }
  return errors;
}

async function jsonRequest(
  options: BenchmarkOptions,
  path: string,
  init: RequestInit = {},
  userId = "",
): Promise<Record<string, any>> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (userId) headers.set("x-user-id", userId);
  const response = await fetch(`${options.baseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(options.requestTimeoutMs),
  });
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    throw new Error(formatHttpError(init.method ?? "GET", path, response.status, body));
  }
  return body;
}

function waitForTerminal(
  options: BenchmarkOptions,
  wsPath: string,
  userId: string,
  generationStarted: number,
): Promise<{ frame: Record<string, any>; stage_ms: Record<string, number> }> {
  const url = new URL(wsPath, `${options.baseUrl}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("user_id", userId);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const stageMs: Record<string, number> = {};
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`行程生成超过 ${options.generationTimeoutMs}ms`));
    }, options.generationTimeoutMs);
    socket.addEventListener("message", (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as Record<string, any>;
        recordStageOffset(stageMs, frame, performance.now() - generationStarted);
        if (frame.status === "failed") throw new Error(frame.error || frame.message || "行程生成失败");
        if (frame.status !== "completed") return;
        clearTimeout(timer);
        socket.close();
        resolve({ frame, stage_ms: stageMs });
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket 连接失败"));
    });
  });
}

async function runSample(options: BenchmarkOptions, run: number): Promise<BenchmarkSample> {
  const started = performance.now();
  let generationStarted = 0;
  let parseMs: number | undefined;
  let confirmMs: number | undefined;
  let clarificationTurns: number | undefined;
  let planId = "";
  try {
    const login = await jsonRequest(options, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ nickname: benchmarkNickname(run) }),
    });
    const userId = String(login.user?.user_id ?? "");
    if (!userId) throw new Error("登录未返回 user_id");

    const today = new Date().toISOString().slice(0, 10);
    const parseStarted = performance.now();
    const resolved = await resolveTripDraft(options.input, today, (text, history) =>
      jsonRequest(options, "/api/trip/parse", {
        method: "POST",
        body: JSON.stringify({ text, language: "zh-CN", today, history }),
      }, userId));
    parseMs = Math.round(performance.now() - parseStarted);
    const draft = resolved.draft;
    clarificationTurns = resolved.clarification_turns;

    const confirmStarted = performance.now();
    const confirmed = await jsonRequest(options, "/api/trip/confirm-reply", {
      method: "POST",
      body: JSON.stringify({
        text: "确认，立即按这个方案生成",
        draft,
        language: "zh-CN",
        today,
        history: [{ role: "user", content: options.input }],
      }),
    }, userId);
    confirmMs = Math.round(performance.now() - confirmStarted);
    const token = String(confirmed.execution_token ?? "");
    if (confirmed.action !== "confirm" || !token) throw new Error("Agent 未授权执行行程");

    generationStarted = performance.now();
    const accepted = await jsonRequest(options, "/api/trip/plan", {
      method: "POST",
      body: JSON.stringify(buildPlanPayload(draft, token, options.input)),
    }, userId);
    planId = String(accepted.plan_id ?? accepted.task_id ?? "");
    const wsPath = String(accepted.ws_url ?? "");
    if (!planId || !wsPath) throw new Error("行程任务未返回 plan_id 或 ws_url");
    const terminal = await waitForTerminal(options, wsPath, userId, generationStarted);
    const generationMs = Math.round(performance.now() - generationStarted);
    const budget = await jsonRequest(
      options,
      `/api/trip/plan/${encodeURIComponent(planId)}/budget-items`,
      {},
      userId,
    );
    const qualityErrors = [
      ...validateApprovedInputDraft(draft),
      ...validateTripQuality(draft, terminal.frame.result, budget),
    ];
    return {
      run,
      success: qualityErrors.length === 0,
      generation_ms: generationMs,
      end_to_end_ms: Math.round(performance.now() - started),
      parse_ms: parseMs,
      confirm_ms: confirmMs,
      clarification_turns: clarificationTurns,
      stage_ms: terminal.stage_ms,
      plan_id: planId,
      travel_days: Number(draft.travel_days),
      cities: draft.cities.map((entry: Record<string, unknown>) => String(entry.city ?? "")),
      quality_errors: qualityErrors,
      ...(qualityErrors.length > 0 ? { error: qualityErrors.join("；") } : {}),
    };
  } catch (error) {
    return {
      run,
      success: false,
      ...(generationStarted > 0
        ? { generation_ms: Math.round(performance.now() - generationStarted) }
        : {}),
      end_to_end_ms: Math.round(performance.now() - started),
      ...(parseMs === undefined ? {} : { parse_ms: parseMs }),
      ...(confirmMs === undefined ? {} : { confirm_ms: confirmMs }),
      ...(clarificationTurns === undefined ? {} : { clarification_turns: clarificationTurns }),
      ...(planId ? { plan_id: planId } : {}),
      quality_errors: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runRealTripBenchmark(options: BenchmarkOptions) {
  const health = await jsonRequest(options, "/health");
  if (health.status !== "healthy") throw new Error(`健康检查失败: ${JSON.stringify(health)}`);
  const samples: BenchmarkSample[] = [];
  for (let run = 1; run <= options.runs; run += 1) {
    const sample = await runSample(options, run);
    samples.push(sample);
    console.error(JSON.stringify({ event: "benchmark_run", ...sample }));
  }
  const summary = summarizeBenchmark(samples, options);
  return {
    benchmark: "real-trip-generation",
    input: options.input,
    base_url: options.baseUrl,
    percentile_method: "nearest-rank",
    generated_at: new Date().toISOString(),
    samples,
    summary,
  };
}

if (import.meta.main) {
  const options = benchmarkOptionsFromArgv(Bun.argv.slice(2));
  try {
    const report = await runRealTripBenchmark(options);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.outputPath) {
      const output = resolve(options.outputPath);
      mkdirSync(dirname(output), { recursive: true });
      await Bun.write(output, json);
      console.error(JSON.stringify({ event: "benchmark_report", output }));
    }
    console.log(json.trimEnd());
    if (!report.summary.passed) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  }
}
