interface SmokeOptions {
  baseUrl: string;
  healthOnly: boolean;
  timeoutMs: number;
}

interface StepResult {
  step: string;
  elapsed_ms: number;
}

function optionsFromArgv(argv: string[]): SmokeOptions {
  const baseUrl = argv.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length)
    ?? process.env.YOUBAN_SMOKE_BASE_URL
    ?? "http://127.0.0.1:7860";
  const rawTimeout = Number(argv.find((arg) => arg.startsWith("--timeout-ms="))?.slice("--timeout-ms=".length) ?? 180_000);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    healthOnly: argv.includes("--health-only"),
    timeoutMs: Number.isFinite(rawTimeout) ? Math.max(5_000, rawTimeout) : 180_000,
  };
}

async function jsonRequest(
  options: SmokeOptions,
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
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status}: ${body.detail ?? JSON.stringify(body)}`);
  return body;
}

async function timed(results: StepResult[], step: string, run: () => Promise<void>): Promise<void> {
  const started = performance.now();
  await run();
  results.push({ step, elapsed_ms: Math.round(performance.now() - started) });
}

function waitForTerminal(options: SmokeOptions, wsPath: string, userId: string): Promise<Record<string, any>> {
  const url = new URL(wsPath, `${options.baseUrl}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("user_id", userId);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`WebSocket did not reach a terminal state within ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    socket.addEventListener("message", (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as Record<string, any>;
        if (frame.status === "failed") throw new Error(frame.error || frame.message || "planning failed");
        if (frame.status !== "completed") return;
        clearTimeout(timer);
        socket.close();
        resolve(frame);
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection failed"));
    });
  });
}

export async function runDeploymentSmoke(options: SmokeOptions): Promise<{ results: StepResult[]; plan_id?: string }> {
  const results: StepResult[] = [];
  await timed(results, "health", async () => {
    const health = await jsonRequest(options, "/health");
    if (health.status !== "healthy") throw new Error(`unexpected health payload: ${JSON.stringify(health)}`);
  });
  if (options.healthOnly) return { results };

  let userId = "";
  await timed(results, "login", async () => {
    const login = await jsonRequest(options, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ nickname: `smoke-${Date.now().toString(36)}` }),
    });
    userId = String(login.user?.user_id ?? "");
    if (!userId) throw new Error("login did not return user_id");
  });

  const today = new Date().toISOString().slice(0, 10);
  let draft: Record<string, any> = {};
  await timed(results, "parse", async () => {
    const parsed = await jsonRequest(options, "/api/trip/parse", {
      method: "POST",
      body: JSON.stringify({
        text: "明天去广州玩一天，1个人，公共交通，喜欢人文景点",
        language: "zh-CN",
        today,
        history: [],
      }),
    }, userId);
    draft = parsed.trip;
    if (!draft || !Array.isArray(draft.cities) || draft.cities.length === 0) {
      throw new Error(`parse did not return an executable trip: ${JSON.stringify(parsed)}`);
    }
  });

  let token = "";
  await timed(results, "confirm", async () => {
    const confirmed = await jsonRequest(options, "/api/trip/confirm-reply", {
      method: "POST",
      body: JSON.stringify({ text: "确认，立即按这个方案生成", draft, language: "zh-CN", today, history: [] }),
    }, userId);
    token = String(confirmed.execution_token ?? "");
    if (confirmed.action !== "confirm" || !token) {
      throw new Error(`confirmation was not authorized: ${JSON.stringify(confirmed)}`);
    }
  });

  let planId = "";
  let wsPath = "";
  await timed(results, "plan", async () => {
    const { inferred_fields: _inferred, suggestions: _suggestions, ...requestDraft } = draft;
    const accepted = await jsonRequest(options, "/api/trip/plan", {
      method: "POST",
      body: JSON.stringify({
        ...requestDraft,
        language: "zh-CN",
        conversation: [{ role: "user", content: "明天去广州玩一天" }],
        execution_token: token,
      }),
    }, userId);
    planId = String(accepted.plan_id ?? accepted.task_id ?? "");
    wsPath = String(accepted.ws_url ?? "");
    if (!planId || !wsPath) throw new Error(`plan was not accepted: ${JSON.stringify(accepted)}`);
  });

  await timed(results, "websocket", async () => {
    const terminal = await waitForTerminal(options, wsPath, userId);
    if (!terminal.result?.success) throw new Error(`terminal frame has no successful result: ${JSON.stringify(terminal)}`);
  });

  let shareCode = "";
  await timed(results, "share", async () => {
    const shared = await jsonRequest(options, `/api/trip/share/${encodeURIComponent(planId)}`, { method: "POST" }, userId);
    shareCode = String(shared.share_code ?? "");
    if (!/^[a-f0-9]{32}$/.test(shareCode)) throw new Error("share code is invalid");
    const publicPlan = await jsonRequest(options, `/api/trip/share/${shareCode}`);
    if (publicPlan.plan_id !== planId) throw new Error("public share points to a different plan");
  });

  await timed(results, "budget", async () => {
    const budget = await jsonRequest(options, `/api/trip/plan/${encodeURIComponent(planId)}/budget-items`, {}, userId);
    if (!Array.isArray(budget.items) || typeof budget.totals?.total !== "number") {
      throw new Error(`budget payload is invalid: ${JSON.stringify(budget)}`);
    }
  });
  return { results, plan_id: planId };
}

if (import.meta.main) {
  try {
    const report = await runDeploymentSmoke(optionsFromArgv(Bun.argv.slice(2)));
    console.log(JSON.stringify({ success: true, ...report }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
