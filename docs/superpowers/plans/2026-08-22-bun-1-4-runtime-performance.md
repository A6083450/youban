# Bun 1.4 Runtime Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and checkpoint the existing TypeScript/Bun backend rewrite, then add measured Bun 1.4 runtime memory, cancellation, shutdown, profiling, and test-speed improvements.

**Architecture:** Keep Elysia and the existing Pi SDK integration. Add lifecycle metadata directly to the persistent parent-agent pool, extract SSE response mechanics into a focused helper, and isolate process-signal behavior in a small runtime lifecycle module so it can be tested without importing the live server entrypoint.

**Tech Stack:** Bun 1.4.0, TypeScript, Elysia 1.4, `@earendil-works/pi-*` 0.84.2, `pi-subagents` 0.53.0, `bun:test`, Vue 3, Vite, Playwright.

## Global Constraints

- Local development, tests, benchmarks, profiles, and E2E run directly with Bun; do not build or start Docker for local acceptance.
- Keep Bun at 1.4.x and preserve the pinned Pi SDK and `pi-subagents` versions.
- Preserve existing snake_case HTTP contracts, `{detail}` errors, SSE `delta/final/error/[DONE]`, WebSocket behavior, ownership rules, SQLite recovery, and persisted Pi transcripts.
- Do not restore FlyAI or expose read/bash/edit/write/grep/find/ls to runtime agents.
- Do not enable experimental HTTP/3 or experimental HTTP/2/3 fetch.
- Do not add `Bun.Image` or JSONL business persistence without a measured hot path.
- Preserve unrelated worktree content; each commit stages only files named by its task.
- Mock benchmarks are local fast acceptance only, not proof of the real-model 30-day SLA or a production soak.

---

## File Map

- `backend-ts/src/config/settings.ts`: validate and expose parent-session pool knobs.
- `backend-ts/src/agents/default-parent-agent.ts`: pass runtime settings to the pool.
- `backend-ts/src/agents/persistent-parent-agent.ts`: own session metadata, TTL/limit eviction, temporary sessions, and pool snapshots.
- `backend-ts/src/http/sse.ts`: own SSE frame encoding, cancellation, and composed abort signals.
- `backend-ts/src/http/app.ts`: wire the SSE helper, runtime shutdown signal, and idle-resource release.
- `backend-ts/src/runtime/server-lifecycle.ts`: install one memory-pressure listener and implement bounded graceful shutdown.
- `backend-ts/src/index.ts`: compose the tested lifecycle helpers with the live Elysia server.
- `backend-ts/tests/*.test.ts`: focused behavior and contract coverage.
- `backend-ts/package.json`, `frontend/package.json`, `frontend/playwright.config.ts`: Bun profiling, parallel-test candidate, and Bun-native Playwright commands.
- `backend-ts/tests/timings.json`: Bun test-file timing data if parallel execution qualifies.
- `backend-ts/benchmarks/pi-subagents-p0.5.md`: record new local benchmark/profile evidence without claiming production SLA.
- `.gitignore`: ignore generated profile artifacts.

---

### Task 0: Checkpoint the Completed TypeScript Rewrite Baseline

**Files:**
- Stage: `Dockerfile.ts`
- Stage: `backend-ts/**` except generated `backend-ts/profiles/**`
- Stage: current `frontend/**` rewrite changes
- Do not stage: `docs/superpowers/**` (already committed separately)

**Interfaces:**
- Consumes: the completed but uncommitted P0-P8 implementation in the isolated worktree.
- Produces: a buildable `HEAD` containing the TypeScript backend, Pi SDK, `pi-subagents`, skills, frontend integration, and all current tests.

- [ ] **Step 1: Verify the rewrite contains no FlyAI runtime surface**

Run:

```sh
rg -n "FlyAI|flyai" backend-ts/src backend-ts/package.json Dockerfile.ts
```

Expected: no matches.

- [ ] **Step 2: Run the direct Bun backend baseline**

Run:

```sh
cd backend-ts
bun test
bun run typecheck
bun run audit:python-tests
bun run bench:pi-subagents
```

Expected: all Bun tests pass, TypeScript exits 0, Python disposition reports 242/242, and benchmark emits raw samples plus warm p50/p95.

- [ ] **Step 3: Run the direct Bun frontend baseline**

Run:

```sh
cd frontend
bun test src
bun run build
bun run test:e2e
```

Expected: unit tests, Vite build, and all Playwright tests pass with one worker.

- [ ] **Step 4: Audit the staged baseline**

Run:

```sh
git add Dockerfile.ts backend-ts frontend
git diff --cached --check
git diff --cached --name-only
```

Expected: only the completed rewrite implementation, tests, locks, benchmark report, and frontend integration are staged; no `data/`, profiles, credentials, or unrelated root files appear.

- [ ] **Step 5: Commit the baseline**

```sh
git commit -m "feat: complete TypeScript backend rewrite"
```

---

### Task 1: Add Validated Parent-Session Runtime Settings

**Files:**
- Modify: `backend-ts/src/config/settings.ts`
- Modify: `backend-ts/tests/config.test.ts`
- Modify: `backend-ts/src/agents/default-parent-agent.ts`

**Interfaces:**
- Consumes: existing runtime-settings precedence: non-empty JSON override > environment > default.
- Produces: `AppSettings.pi_parent_session_limit: number` and `AppSettings.pi_parent_session_idle_seconds: number`, passed as `sessionLimit` and `sessionIdleMs` to `PersistentPiParentAgent`.

- [ ] **Step 1: Write failing configuration tests**

Add `PI_PARENT_SESSION_LIMIT` and `PI_PARENT_SESSION_IDLE_SECONDS` to the isolated environment-key list and add tests equivalent to:

```ts
it("loads bounded Pi parent-session defaults and environment overrides", () => {
  expect(getSettings()).toMatchObject({
    pi_parent_session_limit: 64,
    pi_parent_session_idle_seconds: 1800,
  });

  process.env.PI_PARENT_SESSION_LIMIT = "8";
  process.env.PI_PARENT_SESSION_IDLE_SECONDS = "120";
  _resetSettingsForTest({ legacyRuntimeSettingsFile: null });
  expect(getSettings()).toMatchObject({
    pi_parent_session_limit: 8,
    pi_parent_session_idle_seconds: 120,
  });
});

it("ignores out-of-range parent-session overrides", () => {
  process.env.PI_PARENT_SESSION_LIMIT = "2048";
  process.env.PI_PARENT_SESSION_IDLE_SECONDS = "59";
  writeRuntimeFile(caseDir, {
    pi_parent_session_limit: 0,
    pi_parent_session_idle_seconds: 30,
  });
  expect(getSettings()).toMatchObject({
    pi_parent_session_limit: 64,
    pi_parent_session_idle_seconds: 1800,
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd backend-ts && bun test tests/config.test.ts`

Expected: FAIL because both settings are absent or invalid overrides are accepted.

- [ ] **Step 3: Implement exact bounds and wiring**

Add the runtime keys and use a key-specific range table:

```ts
const RUNTIME_NUMBER_RANGES = {
  pi_parent_session_limit: { min: 1, max: 1024, fallback: 64 },
  pi_parent_session_idle_seconds: { min: 60, max: 86400, fallback: 1800 },
} as const;
```

Environment values and JSON overrides must both pass the same integer bounds. In `createDefaultParentAgent`, pass:

```ts
sessionLimit: settings.pi_parent_session_limit,
sessionIdleMs: settings.pi_parent_session_idle_seconds * 1_000,
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```sh
cd backend-ts
bun test tests/config.test.ts tests/persistent-parent-agent.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add backend-ts/src/config/settings.ts backend-ts/tests/config.test.ts backend-ts/src/agents/default-parent-agent.ts
git commit -m "feat(backend-ts): configure parent session limits"
```

---

### Task 2: Bound and Reclaim Persistent Pi Parent Sessions

**Files:**
- Modify: `backend-ts/src/agents/persistent-parent-agent.ts`
- Modify: `backend-ts/tests/persistent-parent-agent.test.ts`

**Interfaces:**
- Consumes: `sessionLimit`, `sessionIdleMs`, existing scope hashing, session serialization, and persisted `SessionManager` directories.
- Produces:

```ts
export interface ParentSessionPoolSnapshot {
  persistent: number;
  temporary: number;
  busy: number;
  evicted: number;
}

export interface YoubanParentAgent {
  // existing methods remain unchanged
  releaseIdleResources?(reason: "ttl" | "limit" | "memory-pressure"): Promise<ParentSessionPoolSnapshot>;
}
```

- [ ] **Step 1: Write failing pool lifecycle tests**

Extend the real mock-Pi test with injected time and short pool settings:

```ts
let now = 1_000;
const parent = new PersistentPiParentAgent({
  ...options,
  sessionLimit: 1,
  sessionIdleMs: 100,
  sweepIntervalMs: 0,
  now: () => now,
});

await parent.inspect({ key: "user:a", userId: "a" });
now += 101;
expect(await parent.releaseIdleResources("ttl")).toMatchObject({
  persistent: 0,
  evicted: 1,
});
```

Add separate cases proving: a rejected creation is removed; a queued/busy scope is not evicted; a second scope becomes temporary when the only persistent scope is busy; same-scope calls reuse and serialize the temporary entry; temporary entries dispose after their queue drains; `close()` is idempotent.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd backend-ts && bun test tests/persistent-parent-agent.test.ts`

Expected: FAIL because options, metadata, snapshots, and eviction API do not exist.

- [ ] **Step 3: Implement session-entry metadata and cleanup**

Replace `Map<string, Promise<ParentSession>>` with entries that remain indexed during creation and queued work:

```ts
interface ParentSessionEntry {
  pending: Promise<ParentSession>;
  lastUsedAt: number;
  queuedOperations: number;
  persistent: boolean;
  disposing?: Promise<void>;
}
```

Increment `queuedOperations` before awaiting session creation or the previous tail. Decrement it only after releasing the serialization tail. Eviction may select only entries with `queuedOperations === 0`. A rejected `pending` removes itself only when it is still the indexed entry.

- [ ] **Step 4: Implement TTL, soft-limit, temporary-session, and close rules**

Use defaults `64`, `1_800_000 ms`, and `60_000 ms`. The sweep timer calls `unref()`. `releaseIdleResources("memory-pressure")` evicts every idle entry; `ttl` and `limit` use age and LRU. Host disposal is synchronous today but is wrapped in `Promise.resolve()` so all cleanup paths can aggregate failures.

- [ ] **Step 5: Run focused and neighboring tests**

Run:

```sh
cd backend-ts
bun test tests/persistent-parent-agent.test.ts tests/session-host.test.ts tests/trip-chat-http.test.ts
bun run typecheck
```

Expected: PASS with no leaked process or timer.

- [ ] **Step 6: Commit**

```sh
git add backend-ts/src/agents/persistent-parent-agent.ts backend-ts/tests/persistent-parent-agent.test.ts
git commit -m "feat(backend-ts): reclaim idle Pi parent sessions"
```

---

### Task 3: Propagate SSE Reader Cancellation Upstream

**Files:**
- Create: `backend-ts/src/http/sse.ts`
- Create: `backend-ts/tests/sse-response.test.ts`
- Modify: `backend-ts/src/http/app.ts`
- Modify: `backend-ts/tests/trip-assistant-http.test.ts`
- Modify: `backend-ts/tests/trip-chat-http.test.ts`

**Interfaces:**
- Consumes: standard `ReadableStream`, existing SSE frame contract, request signal, and runtime shutdown signal.
- Produces:

```ts
export type SseRun = (
  onDelta: (text: string) => void,
  signal: AbortSignal,
) => Promise<unknown>;

export function sseResponse(
  run: SseRun,
  signals?: readonly AbortSignal[],
): Response;
```

- [ ] **Step 1: Write failing helper tests**

Create tests for the exact frames and cancellation:

```ts
it("aborts upstream when the response reader is cancelled", async () => {
  let received: AbortSignal | undefined;
  const response = sseResponse((_onDelta, signal) => {
    received = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const reader = response.body!.getReader();
  await reader.cancel("client-left");
  expect(received?.aborted).toBeTrue();
});
```

Also assert normal `delta -> final -> [DONE]`, business `error -> [DONE]`, external-signal abort, and no frame enqueue after reader cancellation.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd backend-ts && bun test tests/sse-response.test.ts`

Expected: FAIL because `src/http/sse.ts` does not exist.

- [ ] **Step 3: Implement the standard-stream helper**

The stream `start()` must launch an internal async function without returning its long-running Promise. `cancel(reason)` sets a closed flag and aborts an internal controller. Compose supplied signals with `AbortSignal.any()`. `send()` must check both the closed flag and composed signal before `controller.enqueue()`.

- [ ] **Step 4: Wire all SSE routes to the composed signal**

Remove the private helper from `app.ts`. For parse, confirm, and chat edit streams, pass `request.signal` and the runtime shutdown signal to `sseResponse`, then pass the helper-provided signal to assistant/chat work. Do not continue using the uncomposed request signal inside the callback.

- [ ] **Step 5: Run SSE and HTTP contract tests**

Run:

```sh
cd backend-ts
bun test tests/sse-response.test.ts tests/trip-assistant-http.test.ts tests/trip-chat-http.test.ts tests/http-contract.test.ts
bun run typecheck
```

Expected: PASS and existing frame text remains byte-compatible.

- [ ] **Step 6: Commit**

```sh
git add backend-ts/src/http/sse.ts backend-ts/src/http/app.ts backend-ts/tests/sse-response.test.ts backend-ts/tests/trip-assistant-http.test.ts backend-ts/tests/trip-chat-http.test.ts
git commit -m "fix(backend-ts): cancel SSE work on disconnect"
```

---

### Task 4: Handle Bun Memory Pressure and Graceful Shutdown

**Files:**
- Create: `backend-ts/src/runtime/server-lifecycle.ts`
- Create: `backend-ts/tests/server-lifecycle.test.ts`
- Modify: `backend-ts/src/http/app.ts`
- Modify: `backend-ts/src/index.ts`

**Interfaces:**
- Consumes: optional `YoubanParentAgent.releaseIdleResources`, Elysia server `stop(false)`, and `HttpRuntime.close()`.
- Produces:

```ts
export interface IdleReleaseResult extends ParentSessionPoolSnapshot {}

export interface MemoryPressureProcess {
  on(event: "memoryPressure", listener: (level: unknown) => void): unknown;
  off(event: "memoryPressure", listener: (level: unknown) => void): unknown;
}

export function installMemoryPressureHandler(
  runtime: Pick<HttpRuntime, "releaseIdleResources">,
  processRef?: MemoryPressureProcess,
): () => void;

export async function shutdownServer(
  server: { stop(force?: boolean): void | Promise<void> },
  runtime: Pick<HttpRuntime, "close">,
  options?: { timeoutMs?: number; exit?: (code: number) => never },
): Promise<void>;
```

- [ ] **Step 1: Write failing runtime-resource and lifecycle tests**

Use a fake parent agent and an EventEmitter-compatible fake process. Assert one pressure event calls `releaseIdleResources("memory-pressure")`, cleanup removes the listener, release errors are logged but not thrown, `shutdownServer` awaits `stop(false)` before `runtime.close()`, and a short timeout calls the injected `exit(1)`.

```ts
expect(order).toEqual(["stop:start"]);
stop.resolve();
await Promise.resolve();
expect(order).toEqual(["stop:start", "stop:end", "runtime:close"]);
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd backend-ts && bun test tests/server-lifecycle.test.ts`

Expected: FAIL because lifecycle functions and runtime release API are absent.

- [ ] **Step 3: Expose idle-resource release from the HTTP runtime**

Add:

```ts
async releaseIdleResources(reason: "memory-pressure") {
  return parentAgent.releaseIdleResources?.(reason) ?? {
    persistent: 0,
    temporary: 0,
    busy: 0,
    evicted: 0,
  };
}
```

Do not clear `SqliteTaskStore` or close busy sessions.

- [ ] **Step 4: Implement lifecycle helpers and wire `index.ts`**

Register one memory-pressure listener only in `index.ts`. On SIGINT/SIGTERM, set a local stopping guard, remove the pressure listener, await `shutdownServer(server, runtime, { timeoutMs: 30_000, exit: process.exit.bind(process) })`, set `process.exitCode = 1` on non-timeout errors, and let normal completion exit naturally.

- [ ] **Step 5: Run lifecycle and full backend tests**

Run:

```sh
cd backend-ts
bun test tests/server-lifecycle.test.ts tests/persistent-parent-agent.test.ts tests/trip-planning-http.test.ts
bun run typecheck
bun test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add backend-ts/src/runtime/server-lifecycle.ts backend-ts/tests/server-lifecycle.test.ts backend-ts/src/http/app.ts backend-ts/src/index.ts
git commit -m "feat(backend-ts): handle Bun runtime pressure and shutdown"
```

---

### Task 5: Add Bun 1.4 Profiling, Timing, and Playwright Commands

**Files:**
- Modify: `.gitignore`
- Modify: `backend-ts/package.json`
- Modify: `frontend/package.json`
- Modify: `frontend/playwright.config.ts`
- Create conditionally: `backend-ts/tests/timings.json`

**Interfaces:**
- Consumes: existing benchmark script and Bun 1.4 CLI flags.
- Produces: `profile:cpu`, `profile:heap`, `test:parallel`, and Bun-native frontend test commands.

- [ ] **Step 1: Add command-contract tests before editing scripts**

Run a failing command-contract assertion before editing scripts:

```sh
cd backend-ts
bun -e 'const p=await Bun.file("package.json").json(); for(const k of ["test:parallel","profile:cpu","profile:heap"]) if(!p.scripts[k]) throw new Error(k)'
```

Expected: exit 1 with a missing script name.

- [ ] **Step 2: Add exact Bun scripts and profile ignore**

Use:

```json
{
  "test:parallel": "bun test --parallel=4 --isolate --timings=tests/timings.json --update-timings",
  "profile:cpu": "bun --cpu-prof-md --cpu-prof-dir=profiles scripts/benchmark-pi-subagents.ts",
  "profile:heap": "bun --heap-prof-md --heap-prof-dir=profiles scripts/benchmark-pi-subagents.ts"
}
```

Add `backend-ts/profiles/` to `.gitignore`. Change frontend E2E/layout scripts to `bunx playwright ...` and the Playwright web server command from `npm run dev` to `bun run dev`.

- [ ] **Step 3: Verify command definitions**

Run:

```sh
cd backend-ts
bun -e 'const p=await Bun.file("package.json").json(); for(const k of ["test:parallel","profile:cpu","profile:heap"]) if(!p.scripts[k]) throw new Error(k)'

cd ../frontend
bun -e 'const p=await Bun.file("package.json").json(); if(!p.scripts["test:e2e"].startsWith("bunx playwright")) throw new Error("e2e")'
```

Expected: exit 0.

- [ ] **Step 4: Measure serial and parallel backend tests**

Run each command three times with `/usr/bin/time -p`, recording real time:

```sh
cd backend-ts
/usr/bin/time -p bun test
/usr/bin/time -p bun test
/usr/bin/time -p bun test
/usr/bin/time -p bun run test:parallel
/usr/bin/time -p bun run test:parallel
/usr/bin/time -p bun run test:parallel
```

Expected: all six runs pass. If the parallel median is at least 20% lower, change `test` to the parallel command and keep `tests/timings.json`; otherwise leave `test` serial, keep `test:parallel` optional, and remove an empty or misleading timings file.

- [ ] **Step 5: Run direct Bun frontend tests**

Run:

```sh
cd frontend
bun test src
bun run build
bun run test:e2e
```

Expected: PASS; Playwright starts Vite through Bun and keeps one worker.

- [ ] **Step 6: Commit**

```sh
git add .gitignore backend-ts/package.json frontend/package.json frontend/playwright.config.ts
test ! -f backend-ts/tests/timings.json || git add backend-ts/tests/timings.json
git commit -m "chore: use Bun 1.4 profiling and test tooling"
```

---

### Task 6: Generate Profiles and Record Measured Evidence

**Files:**
- Modify: `backend-ts/benchmarks/pi-subagents-p0.5.md`
- Do not commit: `backend-ts/profiles/**`

**Interfaces:**
- Consumes: `profile:cpu`, `profile:heap`, and `bench:pi-subagents`.
- Produces: a dated local fast-acceptance record with raw latency samples and profile artifact validation.

- [ ] **Step 1: Generate CPU and heap Markdown profiles directly with Bun**

Run:

```sh
cd backend-ts
mkdir -p profiles
find profiles -maxdepth 1 -type f -name '*.md' -delete
bun run profile:cpu
bun run profile:heap
find profiles -type f -name '*.md' -size +0 -print
```

Expected: both commands pass and at least two non-empty Markdown files are printed. The targeted `rm` is limited to generated profile Markdown inside the ignored task-owned directory.

- [ ] **Step 2: Inspect profiles for usable summaries**

Run:

```sh
rg -n "CPU Profile|Self Time|Call Tree" profiles/*.md
rg -n "Heap Profile|Total Size|retained|Largest" profiles/*.md
```

Expected: CPU hot-function/call-tree and heap retained-object sections are present.

- [ ] **Step 3: Run the benchmark and update the report**

Run: `bun run bench:pi-subagents`

Append the date, Bun version, raw samples, cold time, warm p50/p95, and whether profiles were non-empty. Explicitly state that results use a local mock provider and are not real LLM latency or soak proof.

- [ ] **Step 4: Verify the benchmark report and ignore boundary**

Run:

```sh
git check-ignore -v backend-ts/profiles/*
git diff --check -- backend-ts/benchmarks/pi-subagents-p0.5.md
```

Expected: every generated profile is ignored and the report has no whitespace errors.

- [ ] **Step 5: Commit**

```sh
git add backend-ts/benchmarks/pi-subagents-p0.5.md
git commit -m "docs: record Bun 1.4 performance evidence"
```

---

### Task 7: Close the Original Rewrite Plan with Full Local Acceptance

**Files:**
- Verify: `.superpowers/plans/youban-backend-ts-rewrite.md`
- Verify: `backend-ts/tests/python-test-disposition.md`
- Verify: all implementation and frontend files
- Modify only if evidence changed: `backend-ts/tests/python-test-disposition.md`, `backend-ts/benchmarks/pi-subagents-p0.5.md`

**Interfaces:**
- Consumes: all previous task commits.
- Produces: a clean, reviewable branch with the original P0-P8 rewrite behavior and Bun 1.4 optimization plan complete under local acceptance.

- [ ] **Step 1: Run the complete direct Bun backend verification**

```sh
cd backend-ts
bun test
bun run typecheck
bun run audit:python-tests
bun run bench:pi-subagents
```

Expected: all pass; audit remains 242/242.

- [ ] **Step 2: Run the complete direct Bun frontend verification**

```sh
cd frontend
bun test src
bun run build
bun run test:e2e
```

Expected: all pass with Vite launched through Bun, no container involved.

- [ ] **Step 3: Audit runtime and contract boundaries**

Run:

```sh
rg -n "FlyAI|flyai" backend-ts/src backend-ts/package.json Dockerfile.ts
rg -n 'read|bash|edit|write|grep|find|ls' backend-ts/src/agents/session-host.ts backend-ts/src/agents/persistent-parent-agent.ts
git diff --check HEAD
git status --short
```

Expected: no FlyAI matches; coding tools appear only in explicit deny/block logic or tests; no whitespace errors; only intentionally ignored local profiles remain outside Git status.

- [ ] **Step 4: Review the original plan checklist against evidence**

Confirm: TypeScript backend and frontend contract suites pass; all 242 Python tests have a disposition; Pi SDK, `pi-subagents`, four approved skills, SQLite migration/export, SSE/WS, ownership, budget, recovery, and frontend integration exist; Docker was not used for local testing. Mark real external-provider 10-run SLA and production soak/deployment as external acceptance, not local completion evidence.

- [ ] **Step 5: Request final code review and address only verified findings**

Use `superpowers:requesting-code-review`, then `superpowers:receiving-code-review` for any findings. Re-run the focused test for each fix and the full direct Bun verification afterward.

- [ ] **Step 6: Commit any evidence-only follow-up**

If Task 7 changes tracked evidence files:

```sh
git add backend-ts/tests/python-test-disposition.md backend-ts/benchmarks/pi-subagents-p0.5.md
git commit -m "test: finalize TypeScript rewrite acceptance"
```

If no tracked file changed, do not create an empty commit.
