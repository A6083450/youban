# Thinking Controls and Planning Deadlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-controlled model thinking and user-visible thought summaries, while guaranteeing a first usable 1-30 day trip plan within the approved 6/10/15 second deadlines through deterministic fast-plan publication and conflict-safe background enhancement.

**Architecture:** Extend the runtime-settings boundary with two booleans and pass one immutable settings snapshot into every new model/planner run. Add pure deadline and fast-plan domain modules, then coordinate the current `TripPlanner` promise against a local deadline without changing its checkpoint algorithm. Persist plan quality and enhancement state in the existing task payload, publish a complete fast plan when needed, and let the result page poll only while enhancement is non-terminal.

**Tech Stack:** Bun 1.4, TypeScript, Elysia, SQLite/Drizzle task payloads, Pi Agent/pi-ai, Vue 3, Ant Design Vue, vue-element-plus-x, Vue I18n, Bun Test, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-thinking-controls-and-planning-deadlines-design.md`

## Global Constraints

- Preserve unrelated dirty-worktree changes; stage only files named by the current task.
- Both thinking settings default to `false`; effective visibility is false whenever thinking is disabled.
- Never render raw chain-of-thought, reasoning protocol payloads, credentials, prompts, or unvalidated tool output.
- Measure the SLO from acceptance of `POST /api/trip/plan` until a complete persisted result is readable.
- Trigger fast publication at 5.5 seconds for 1-7 days, 9.5 seconds for 8-15 days, and 14.5 seconds for 16-30 days.
- A fast plan contains every requested day and performs no new model or network request.
- Background enhancement never overwrites a plan whose `planRevision()` changed after fast publication.
- Preserve existing snake_case payloads, `{detail}` errors, SSE event names, WebSocket terminal frames, task ids, ownership checks, and result shapes.
- Use browser-use for live page verification, reuse an existing tab, and close only test-created tabs.

---

### Task 1: Runtime Thinking Settings

**Files:**
- Modify: `backend-ts/src/config/settings.ts`
- Modify: `backend-ts/src/http/app.ts`
- Test: `backend-ts/tests/config.test.ts`
- Test: `backend-ts/tests/admin-http.test.ts`

**Interfaces:**
- Produces: `RuntimeSettings.llm_thinking_enabled: boolean`.
- Produces: `RuntimeSettings.llm_thinking_visible: boolean`.
- Produces: `effectiveThinkingVisible(settings): boolean`.
- Consumed by: Tasks 2, 3, and 4.

- [ ] **Step 1: Add failing configuration tests**

Add cases for defaults, valid overrides, invalid values, and the visibility dependency:

```ts
expect(getSettings()).toEqual(expect.objectContaining({
  llm_thinking_enabled: false,
  llm_thinking_visible: false,
}));
const updated = updateRuntimeSettings({
  llm_thinking_enabled: true,
  llm_thinking_visible: true,
});
expect(effectiveThinkingVisible(updated)).toBeTrue();
expect(effectiveThinkingVisible({
  llm_thinking_enabled: false,
  llm_thinking_visible: true,
})).toBeFalse();
```

Extend the administrator HTTP test so GET returns both booleans and PUT accepts them.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd backend-ts
bun test tests/config.test.ts tests/admin-http.test.ts
```

Expected: FAIL because the keys and helper do not exist.

- [ ] **Step 3: Implement validated runtime settings**

Add both keys to `RuntimeSettings`, `RUNTIME_BOOLEAN_KEYS`, and `buildSettings`:

```ts
llm_thinking_enabled: readEnvBool("LLM_THINKING_ENABLED", false),
llm_thinking_visible: readEnvBool("LLM_THINKING_VISIBLE", false),
```

Export:

```ts
export function effectiveThinkingVisible(
  settings: Pick<RuntimeSettings, "llm_thinking_enabled" | "llm_thinking_visible">,
): boolean {
  return settings.llm_thinking_enabled && settings.llm_thinking_visible;
}
```

Project the non-secret effective booleans through the current settings endpoints.

- [ ] **Step 4: Verify focused behavior and types**

```bash
cd backend-ts
bun test tests/config.test.ts tests/admin-http.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add backend-ts/src/config/settings.ts backend-ts/src/http/app.ts backend-ts/tests/config.test.ts backend-ts/tests/admin-http.test.ts
git commit -m "feat(settings): add model thinking controls"
```

---

### Task 2: Provider and Pi Agent Thinking Mode

**Files:**
- Modify: `backend-ts/src/agents/llm/providers.ts`
- Modify: `backend-ts/src/agents/default-parent-agent.ts`
- Modify: `backend-ts/src/agents/default-trip-chat-service.ts`
- Modify: `backend-ts/src/agents/default-trip-planner.ts`
- Modify: `backend-ts/src/agents/pi-subagent-runner.ts`
- Modify: `backend-ts/src/agents/trip-assistant.ts`
- Modify: `backend-ts/src/agents/conversation-title.ts`
- Test: `backend-ts/tests/pi-llm-client.test.ts`
- Test: `backend-ts/tests/default-agent-factories.test.ts`
- Test: `backend-ts/tests/default-trip-planner.test.ts`
- Test: `backend-ts/tests/trip-assistant-http.test.ts`

**Interfaces:**
- Consumes: `RuntimeSettings.llm_thinking_enabled`.
- Changes: `LlmRequestOptions.disableThinking` becomes `thinkingEnabled?: boolean`.
- Produces: explicit `thinking: { type: "enabled" | "disabled" }` provider payloads.

- [ ] **Step 1: Add failing provider and factory tests**

Parameterize the fake-provider request test:

```ts
for (const [thinkingEnabled, expected] of [
  [false, { type: "disabled" }],
  [true, { type: "enabled" }],
] as const) {
  await client.agentComplete("plan", { thinkingEnabled });
  expect(requests.at(-1)?.body.thinking).toEqual(expected);
}
```

Assert that parent, chat, and planner factories pass the settings snapshot. Update intake tests so calls do not hard-code `disableThinking: true`.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd backend-ts
bun test tests/pi-llm-client.test.ts tests/default-agent-factories.test.ts tests/default-trip-planner.test.ts tests/trip-assistant-http.test.ts
```

Expected: FAIL because `thinkingEnabled` is absent.

- [ ] **Step 3: Implement the shared provider option**

```ts
function thinkingSamplingParams(enabled: boolean | undefined): Record<string, unknown> {
  return { thinking: { type: enabled === true ? "enabled" : "disabled" } };
}
```

Merge it into direct `stream()` and `agentComplete()` requests. Pass the immutable factory setting into Pi runners and assistants; do not read global settings mid-request.

- [ ] **Step 4: Verify focused behavior and types**

```bash
cd backend-ts
bun test tests/pi-llm-client.test.ts tests/default-agent-factories.test.ts tests/default-trip-planner.test.ts tests/trip-assistant-http.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add backend-ts/src/agents/llm/providers.ts backend-ts/src/agents/default-parent-agent.ts backend-ts/src/agents/default-trip-chat-service.ts backend-ts/src/agents/default-trip-planner.ts backend-ts/src/agents/pi-subagent-runner.ts backend-ts/src/agents/trip-assistant.ts backend-ts/src/agents/conversation-title.ts backend-ts/tests/pi-llm-client.test.ts backend-ts/tests/default-agent-factories.test.ts backend-ts/tests/default-trip-planner.test.ts backend-ts/tests/trip-assistant-http.test.ts
git commit -m "feat(agents): honor runtime thinking mode"
```

---

### Task 3: Administrator Thinking Controls

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/components/admin/AdminRuntimeSettingsPanel.vue`
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Create: `frontend/src/components/admin/AdminRuntimeSettingsPanel.test.mjs`

**Interfaces:**
- Consumes: Task 1 runtime booleans.
- Produces: typed normalized booleans and two Ant Design switches.

- [ ] **Step 1: Add a failing component contract test**

```js
expect(source).toContain('v-model:checked="settingsForm.llm_thinking_enabled"')
expect(source).toContain('v-model:checked="settingsForm.llm_thinking_visible"')
expect(source).toContain(':disabled="!settingsForm.llm_thinking_enabled"')
expect(apiSource).toContain('llm_thinking_enabled: Boolean(')
expect(apiSource).toContain('llm_thinking_visible: Boolean(')
```

Parse all three locale files and assert labels and help descriptions exist.

- [ ] **Step 2: Run the test and verify RED**

```bash
cd frontend
bun test src/components/admin/AdminRuntimeSettingsPanel.test.mjs
```

Expected: FAIL because fields and switches are absent.

- [ ] **Step 3: Implement UI, normalization, and copy**

Add both booleans to frontend settings types, defaults, normalization, and save payloads. Add switches below the model field:

```vue
<a-form-item :label="t('settings.labels.thinkingEnabled')">
  <a-switch v-model:checked="settingsForm.llm_thinking_enabled" />
</a-form-item>
<a-form-item :label="t('settings.labels.thinkingVisible')">
  <a-switch
    v-model:checked="settingsForm.llm_thinking_visible"
    :disabled="!settingsForm.llm_thinking_enabled"
  />
</a-form-item>
```

When thinking turns off, set visibility false before saving.

- [ ] **Step 4: Verify focused behavior and build**

```bash
cd frontend
bun test src/components/admin/AdminRuntimeSettingsPanel.test.mjs
bun run build
```

Expected: both commands pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/components/admin/AdminRuntimeSettingsPanel.vue frontend/src/components/admin/AdminRuntimeSettingsPanel.test.mjs frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json
git commit -m "feat(admin): configure model thinking"
```

---

### Task 4: Sanitized Thought Summaries

**Files:**
- Create: `backend-ts/src/agents/thought-summary-policy.ts`
- Modify: `backend-ts/src/agents/pi-trip-planner.ts`
- Modify: `backend-ts/src/agents/trip-assistant.ts`
- Modify: `backend-ts/src/http/app.ts`
- Test: `backend-ts/tests/thought-summary-policy.test.ts`
- Test: `backend-ts/tests/pi-trip-planner.test.ts`
- Modify: `frontend/src/components/WorkProgress.vue`
- Create: `frontend/src/components/WorkProgress.test.mjs`

**Interfaces:**
- Consumes: `effectiveThinkingVisible()`.
- Produces: `visibleThoughtSummary(input: unknown, visible: boolean): string | null`.
- Produces: validated one-line `thinking` details no longer than 160 characters.

- [ ] **Step 1: Add failing sanitizer and visibility tests**

```ts
expect(visibleThoughtSummary("正在平衡亲子节奏", false)).toBeNull();
expect(visibleThoughtSummary("正在平衡亲子节奏", true)).toBe("正在平衡亲子节奏");
expect(visibleThoughtSummary("system prompt: secret\nAPI_KEY=abc", true)).toBeNull();
expect(visibleThoughtSummary("a".repeat(300), true)?.length).toBeLessThanOrEqual(160);
```

Add planner tests for hidden and visible states, plus a frontend source test that only reads normalized `TripTaskDetail` values.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd backend-ts
bun test tests/thought-summary-policy.test.ts tests/pi-trip-planner.test.ts
cd ../frontend
bun test src/components/WorkProgress.test.mjs
```

Expected: FAIL because the policy and visibility plumbing are absent.

- [ ] **Step 3: Implement deterministic safe summaries**

Reject secret/prompt/tool markers and multiline protocol content, strip Markdown/control characters, collapse whitespace, and truncate to 160 characters. Emit summaries from known stages, not raw reasoning:

```ts
const summary = visibleThoughtSummary(
  `正在为${city}筛选符合偏好的可信景点`,
  showThoughts,
);
if (summary) details.push({ type: "thinking", title: summary, timestamp: Date.now() });
```

Apply the same effective visibility rule to intake progress. Keep normal answer deltas unchanged.

- [ ] **Step 4: Verify focused backend/frontend behavior**

```bash
cd backend-ts
bun test tests/thought-summary-policy.test.ts tests/pi-trip-planner.test.ts tests/trip-assistant-http.test.ts
bun run typecheck
cd ../frontend
bun test src/components/WorkProgress.test.mjs
bun run build
```

Expected: all commands pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add backend-ts/src/agents/thought-summary-policy.ts backend-ts/src/agents/pi-trip-planner.ts backend-ts/src/agents/trip-assistant.ts backend-ts/src/http/app.ts backend-ts/tests/thought-summary-policy.test.ts backend-ts/tests/pi-trip-planner.test.ts frontend/src/components/WorkProgress.vue frontend/src/components/WorkProgress.test.mjs
git commit -m "feat(planning): show safe thought summaries"
```

---

### Task 5: Deadline Policy and Deterministic Fast Plan

**Files:**
- Create: `backend-ts/src/domain/planning-deadline.ts`
- Create: `backend-ts/src/domain/fast-trip-plan.ts`
- Create: `backend-ts/tests/planning-deadline.test.ts`
- Create: `backend-ts/tests/fast-trip-plan.test.ts`

**Interfaces:**
- Produces: `planningDeadlineMs(travelDays: number): number | null`.
- Produces: `fastPlanTriggerMs(travelDays: number): number | null`.
- Produces: `buildFastTripPlan(request, checkpoint): Record<string, unknown>`.
- Consumed by: Task 6.

- [ ] **Step 1: Add failing deadline and plan-shape tests**

```ts
expect([1, 7, 8, 15, 16, 30, 31].map(planningDeadlineMs))
  .toEqual([6_000, 6_000, 10_000, 10_000, 15_000, 15_000, null]);
expect([1, 7, 8, 15, 16, 30, 31].map(fastPlanTriggerMs))
  .toEqual([5_500, 5_500, 9_500, 9_500, 14_500, 14_500, null]);
```

Create 7-, 15-, and 30-day requests. Assert exact dates/day indices/cities, daily transportation/accommodation/meals, no duplicate trusted POI, no invented POI when the checkpoint is empty, and a normalized budget.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd backend-ts
bun test tests/planning-deadline.test.ts tests/fast-trip-plan.test.ts
```

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement pure deadline functions**

```ts
export function planningDeadlineMs(days: number): number | null {
  if (days >= 1 && days <= 7) return 6_000;
  if (days <= 15) return 10_000;
  if (days <= 30) return 15_000;
  return null;
}

export function fastPlanTriggerMs(days: number): number | null {
  const deadline = planningDeadlineMs(days);
  return deadline === null ? null : deadline - 500;
}
```

- [ ] **Step 4: Implement local fast-plan construction**

Build days from request cities/dates and trusted checkpoint entries. Reuse `buildWeatherInfo`, `buildBudget`, `adjustGeneratedDaysToBudget`, and `recommendVisitTimes`. Use honest generic guidance when no trusted POI exists and keep `attractions: []`; never invent ids or call research/agents.

- [ ] **Step 5: Verify focused behavior and types**

```bash
cd backend-ts
bun test tests/planning-deadline.test.ts tests/fast-trip-plan.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add backend-ts/src/domain/planning-deadline.ts backend-ts/src/domain/fast-trip-plan.ts backend-ts/tests/planning-deadline.test.ts backend-ts/tests/fast-trip-plan.test.ts
git commit -m "feat(planning): build deadline fast plans"
```

---

### Task 6: Deadline Publication and Background Enhancement

**Files:**
- Create: `backend-ts/src/services/plan-generation-coordinator.ts`
- Modify: `backend-ts/src/domain/task-store.ts`
- Modify: `backend-ts/src/http/app.ts`
- Modify: `backend-ts/src/domain/schemas.ts`
- Test: `backend-ts/tests/plan-generation-coordinator.test.ts`
- Test: `backend-ts/tests/task-store.test.ts`
- Test: `backend-ts/tests/trip-planning-http.test.ts`
- Test: `backend-ts/tests/ws-contract.test.ts`

**Interfaces:**
- Consumes: Task 5 deadline and fast-plan functions.
- Produces: `PlanQuality = "fast" | "enhanced"`.
- Produces: `EnhancementStatus = "pending" | "running" | "completed" | "failed" | "skipped"`.
- Adds optional-compatible task fields: `plan_quality`, `enhancement_status`, `deadline_seconds`, `generation_elapsed_ms`, `fast_plan_revision`.
- Produces: `startPlanGeneration(options): PlanGenerationRun` where `PlanGenerationRun` exposes `firstPublished`, `enhancementSettled`, and `cancel()`.

- [ ] **Step 1: Add failing race and HTTP tests**

Cover enhanced-before-trigger, fast-at-trigger, unchanged late upgrade, edit-conflict skip, and late failure retaining a completed plan. A representative fast-publication test uses a controllable timer and deferred enhanced result:

```ts
const clock = new ManualClock();
const enhanced = deferred<Record<string, unknown>>();
const publications: Array<{ quality: PlanQuality; result: Record<string, unknown> }> = [];
const enhancementStates: EnhancementStatus[] = [];
const run = startPlanGeneration({
  request: sevenDayRequest,
  signal: new AbortController().signal,
  enhanced: enhanced.promise,
  latestCheckpoint: () => emptyCheckpoint(),
  sleep: clock.sleep,
  publishFirst: async (quality, result) => { publications.push({ quality, result }); },
  readCurrent: () => publications.at(-1) ?? null,
  publishEnhancement: async (result) => { publications.push({ quality: "enhanced", result }); },
  updateEnhancement: async (status) => { enhancementStates.push(status); },
});
clock.advanceBy(5_500);
await run.firstPublished;
expect(publications[0]?.quality).toBe("fast");
expect(((publications[0]?.result.data as Record<string, unknown>).days as unknown[])).toHaveLength(7);
enhanced.resolve(enhancedResult);
await run.enhancementSettled;
expect(publications.at(-1)?.quality).toBe("enhanced");
expect(enhancementStates.at(-1)).toBe("completed");
```

Inject `now`, timer creation, and publication callbacks so tests advance virtual time. Add cases proving deletion/cancellation settles the enhancement without a late write, a retry starts a fresh deadline window while retaining the task id, and a 31-day task does not use the fast-plan timer. Extend HTTP and WebSocket tests to verify a slow 7-day request becomes readable at 5.5 seconds and emits the existing terminal frame.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd backend-ts
bun test tests/plan-generation-coordinator.test.ts tests/task-store.test.ts tests/trip-planning-http.test.ts tests/ws-contract.test.ts
```

Expected: FAIL because coordinator metadata and publication are absent.

- [ ] **Step 3: Extend task payload and restart recovery**

Initialize new task metadata to null, include non-null values in `buildTaskEvent`, and retain completed fast results on restart. Convert interrupted `pending` or `running` enhancement to `failed` without changing the plan result or completed task status.

- [ ] **Step 4: Implement the generation race**

```ts
const trigger = fastPlanTriggerMs(request.travel_days);
const enhanced = planner.plan(request, context);
const first = trigger === null
  ? await enhanced.then(result => ({ kind: "enhanced" as const, result }))
  : await Promise.race([
      enhanced.then(result => ({ kind: "enhanced" as const, result })),
      timer(trigger).then(() => ({
        kind: "fast" as const,
        result: buildFastTripPlan(request, latestCheckpoint()),
      })),
    ]);
```

Return a `PlanGenerationRun` immediately. Its `firstPublished` promise resolves after the winner is saved, while `enhancementSettled` resolves after a late enhancement reaches completed, failed, or skipped. Publish the winner atomically. After fast publication, apply `enhanced` only if the task exists, is still completed/fast, and `planRevision(current.data) === fast_plan_revision`. Failure updates only enhancement metadata and message.

- [ ] **Step 5: Integrate `runPlanning` safely**

Replace direct planner completion with the coordinator. Guard late progress/checkpoint writes so they cannot change completed status, progress 100, or the published result. Task deletion and global shutdown abort background enhancement.

- [ ] **Step 6: Verify focused behavior and types**

```bash
cd backend-ts
bun test tests/plan-generation-coordinator.test.ts tests/task-store.test.ts tests/trip-planning-http.test.ts tests/ws-contract.test.ts tests/conversation-records-http.test.ts
bun run typecheck
```

Expected: all commands pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add backend-ts/src/services/plan-generation-coordinator.ts backend-ts/src/domain/task-store.ts backend-ts/src/http/app.ts backend-ts/src/domain/schemas.ts backend-ts/tests/plan-generation-coordinator.test.ts backend-ts/tests/task-store.test.ts backend-ts/tests/trip-planning-http.test.ts backend-ts/tests/ws-contract.test.ts
git commit -m "feat(planning): enforce user-visible deadlines"
```

---

### Task 7: Friendly Result-Page Enhancement Status

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/components/PlanEnhancementNotice.vue`
- Create: `frontend/src/components/PlanEnhancementNotice.test.mjs`
- Modify: `frontend/src/views/Result.vue`
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Create: `frontend/src/views/Result.enhancement.test.mjs`

**Interfaces:**
- Consumes: Task 6 quality/enhancement metadata.
- Produces: notices for pending/running/completed/failed/skipped.
- Produces: one-second polling only while a fast plan's enhancement is non-terminal.

- [ ] **Step 1: Add failing notice and lifecycle tests**

```js
expect(noticeSource).toContain('为了减少等待，已先为你生成快速版计划')
expect(noticeSource).toContain('计划细节已补充完成')
expect(noticeSource).toContain('当前计划可以正常使用，部分实时信息暂未补充')
expect(noticeSource).toContain('已保留你的修改，后台补充内容没有覆盖当前计划')
expect(resultSource).toContain('startEnhancementPolling')
expect(resultSource).toContain('stopEnhancementPolling')
```

Assert terminal state, route change, and unmount clear the timer. Assert an enhanced result applies only while the result page owns the current `PlanOperation`.

- [ ] **Step 2: Run the tests and verify RED**

```bash
cd frontend
bun test src/components/PlanEnhancementNotice.test.mjs src/views/Result.enhancement.test.mjs
```

Expected: FAIL because metadata, notice, and polling are absent.

- [ ] **Step 3: Add typed metadata and notice component**

Extend `TripTaskEvent`/`TripPlanResponse` with optional fields. Render an unframed informational notice near the result header, show a compact spinner for pending/running, and allow dismissal only for terminal states.

- [ ] **Step 4: Add owned polling to `Result.vue`**

After restoring a fast plan, poll `pollTaskStatus(planId)` every second. Reuse current operation ownership checks before applying enhanced data. Stop on terminal state, route/plan change, readonly share mode, or unmount. Never set `loadingPlan` or disable editing during enhancement.

- [ ] **Step 5: Verify focused behavior and build**

```bash
cd frontend
bun test src/components/PlanEnhancementNotice.test.mjs src/views/Result.enhancement.test.mjs
bun run build
```

Expected: all commands pass.

- [ ] **Step 6: Commit Task 7**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/components/PlanEnhancementNotice.vue frontend/src/components/PlanEnhancementNotice.test.mjs frontend/src/views/Result.vue frontend/src/views/Result.enhancement.test.mjs frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json
git commit -m "feat(result): explain background plan enhancement"
```

---

### Task 8: Deadline Benchmarks and Browser Acceptance

**Files:**
- Create: `backend-ts/scripts/benchmark-planning-deadlines.ts`
- Modify: `backend-ts/package.json`
- Create: `frontend/e2e/planning-deadlines.spec.ts`
- Create: `docs/superpowers/reports/2026-08-24-thinking-controls-and-planning-deadlines-acceptance.md`

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces: `bun run bench:planning-deadlines` with JSON timing for 7, 15, and 30 days.
- Produces: browser acceptance evidence with actual request-to-readable-result times.

- [ ] **Step 1: Add a deterministic benchmark**

Run an in-process app with intentionally slow planner/research fakes. POST and poll each case, failing when the first complete result exceeds its limit:

```ts
const cases = [
  { days: 7, maxMs: 6_000 },
  { days: 15, maxMs: 10_000 },
  { days: 30, maxMs: 15_000 },
];
```

Print JSON containing `days`, `elapsed_ms`, `max_ms`, `plan_quality`, and `day_count`.

- [ ] **Step 2: Run benchmark and verify the deadline behavior**

```bash
cd backend-ts
bun run scripts/benchmark-planning-deadlines.ts
```

Expected before deadline integration: FAIL because slow planning exceeds the limit. Expected after integration: all cases pass with exact day counts.

- [ ] **Step 3: Add browser acceptance coverage**

Use Playwright fixtures for deterministic states and browser-use for the configured provider. Verify administrator persistence, disabled visibility, fast-plan navigation and notice, each terminal notice, and edit-conflict preservation. Record real elapsed time for 7-, 15-, and 30-day requests.

- [ ] **Step 4: Run complete automated verification**

```bash
cd backend-ts
bun test
bun run typecheck
bun run bench:planning-deadlines
cd ../frontend
bun test
bun run build
bunx playwright test e2e/planning-deadlines.spec.ts --workers=1
git diff --check
```

Expected: every command exits 0, suites have zero failures, and deadline cases stay within 6/10/15 seconds.

- [ ] **Step 5: Run live browser verification and write evidence**

Start the task-owned server on an unused port and use browser-use with the configured administrator session. Record accepted timestamp, first readable timestamp, elapsed milliseconds, first-render quality, terminal enhancement state, notice text, edit preservation, and recording/screenshot paths. Do not claim a deadline passed without the measured elapsed value.

- [ ] **Step 6: Commit Task 8**

```bash
git add backend-ts/scripts/benchmark-planning-deadlines.ts backend-ts/package.json frontend/e2e/planning-deadlines.spec.ts docs/superpowers/reports/2026-08-24-thinking-controls-and-planning-deadlines-acceptance.md
git commit -m "test(planning): verify deadline experience"
```

---

## Final Review Checklist

- [ ] Both administrator switches persist, hot-reload, and default off.
- [ ] Thinking enabled plus visibility off never emits or persists a thought summary.
- [ ] No raw provider reasoning reaches SSE, task details, logs, or rendered DOM.
- [ ] Fast plans contain exact requested dates and day counts for 7, 15, and 30 days.
- [ ] First readable results satisfy 6, 10, and 15 seconds in deterministic and live-browser measurements.
- [ ] Background enhancement cannot overwrite an edited plan.
- [ ] Restart, deletion, enhancement failure, and late progress cannot regress a completed fast plan.
- [ ] Backend/frontend suites, type checks, production build, focused E2E, and `git diff --check` pass.
