# Thinking Controls and Planning Deadlines Acceptance

Date: 2026-08-25 (Asia/Shanghai)

## Outcome

The deterministic deadline benchmark and the configured-provider browser measurements produced complete 7-, 15-, and 30-day plans within their respective accepted-to-readable limits. The first readable result was a fast plan in all three final measurements.

Fix round 1 moved the generation start marker to the server acceptance boundary. The marker is kept only on the active run, refreshed on retry, and passed into the coordinator so startup delay reduces the remaining fast-plan budget. It also replaced the visibility-off browser mock with a real in-process HTTP runtime whose assistant attempts the known intake-stage summary while visibility is disabled; the upstream SSE, DOM, and persisted conversation response are all checked for absence.

An initial 15-day browser run exposed a delayed-timer race: an enhanced result delivered after the fast trigger could win `Promise.race` before the delayed timer callback ran. The regression was reproduced before implementation, fixed in commit `b6434bf`, and rechecked with the configured provider.

## Deterministic Benchmark

Command: `cd backend-ts && bun run bench:planning-deadlines`

```json
[{"days":7,"elapsed_ms":5500,"max_ms":6000,"plan_quality":"fast","day_count":7},{"days":15,"elapsed_ms":9500,"max_ms":10000,"plan_quality":"fast","day_count":15},{"days":30,"elapsed_ms":14500,"max_ms":15000,"plan_quality":"fast","day_count":30}]
```

The benchmark uses an in-process HTTP runtime, a controllable clock, and an intentionally non-completing enhanced planner. The elapsed value begins after `POST /api/trip/plan` is accepted and ends when `GET /api/trip/status/:id` returns a complete persisted plan.

## Configured-Provider Browser Measurements

Initial Browser Use recording: `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/task8-planning-deadlines`

Fix round 1 recording: `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/task8-planning-deadlines-fix1` (32 frames)

The fix-round browser used a task-owned service on `127.0.0.1:8193`. A temporary, test-only route outside the repository issued a confirmation token for a fixed, already-confirmed draft; no test route was added to the production application. Runtime provider settings were copied into a temporary data directory without printing credentials. The Browser Use tab was activated for the final measurements because Chrome throttled polling in a hidden tab.

| Days | Task | Browser POST to readable DOM | Limit | Server accepted to persisted | First quality | First state | Day count | Terminal elapsed | Terminal state |
| ---: | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- |
| 7 | `3fac44c3` | 5,642 ms | 6,000 ms | 5,504 ms | fast | running | 7 | 13,831 ms | fast / skipped |
| 15 | `c87e7475` | 9,665 ms | 10,000 ms | 9,501 ms | fast | running | 15 | 15,022 ms | fast / skipped |
| 30 | `a57f6285` | 14,651 ms | 15,000 ms | 14,504 ms | fast | running | 30 | 14,778 ms | enhanced / completed |

`generation_elapsed_ms` is measured by the server from the accepted marker captured before the task is persisted through the first complete persisted result. The browser measurement starts immediately before the plan POST and ends when a new-document `MutationObserver` first sees readable result-page content. Provider intake time is deliberately excluded from both planning measurements. The browser value therefore includes request transport, status polling, navigation, and rendering in addition to the server duration.

## Browser Behavior

- Settings persistence, real-backend visibility-off behavior, fast-plan navigation, all three terminal notices, and edit-conflict preservation passed in `frontend/e2e/planning-deadlines.spec.ts` (7/7).
- The visibility-off test forwards the browser request to a real in-process HTTP runtime configured with `thinkingVisible: false`. The assistant attempts the deterministic intake-stage summary, while the captured upstream SSE, visible DOM, and conversation response contain no thinking event or summary.
- In the fix-round live run, opening the 7- and 15-day fast result pages was followed by a protected `skipped` terminal state; the 30-day run completed its enhancement. The report does not claim an enhanced terminal result for the two skipped runs.
- A live fast plan was edited from the browser by deleting attraction `itm_b8e2ff4f` (`HTTP 200`). Task `c0635a04` settled as fast / skipped at 15,076 ms, and the deleted item remained absent.
- Completed notice evidence: `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/task8-planning-deadlines/live-15-enhanced.png`.
- Skipped/edit-protection notice evidence: `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/task8-planning-deadlines/live-7-skipped.png`.
- The initial provider-backed 30-day intake emitted a conversational delta but no final confirmation within about 60 seconds. The accepted-to-readable 30-day measurement therefore used the test-only confirmed-draft boundary described above; no elapsed value was fabricated for the stalled intake.
- A configured administrator session was not available on the task-owned origin without entering a password during recording. Administrator persistence is therefore covered deterministically by Playwright, not claimed as a live administrator-session pass.

## Delayed-Timer Regression

RED: `bun test tests/plan-generation-coordinator.test.ts` produced 6 passes and 1 failure because a late enhanced result was published first instead of `["fast", "enhanced"]`.

GREEN: after checking elapsed time when enhanced wins the race, the same test file passed 7/7 and backend typecheck passed. Normal enhanced-before-trigger behavior remains covered. Fix commit: `b6434bf` (`fix(planning): honor elapsed deadline after timer delay`).

## Fix Round 1 RED / GREEN

- Accepted-boundary RED: the coordinator test reached 5,500 ms from the supplied accepted marker without publishing fast, and the HTTP startup-delay test timed out because elapsed time began in `runPlanning`.
- Accepted-boundary GREEN: the accepted marker is captured before initial task persistence, refreshed before retry persistence, carried only by the active run, and used for timer remaining time plus metadata. Coordinator and HTTP lifecycle tests passed 22/22, including the existing retry-window test.
- Visibility RED: once the old Playwright fixture included a `thinking` SSE event, its new network assertion failed even though the DOM assertion still passed, proving the old DOM-only fixture was insufficient.
- Visibility GREEN: the Playwright test now forwards to the real test-only HTTP fixture and passed its SSE, DOM, and conversation-persistence absence assertions.

## Automated Verification

| Command | Result |
| --- | --- |
| `cd backend-ts && bun test` | PASS: 509 tests, 0 failures |
| `cd backend-ts && bun run typecheck` | PASS |
| `cd backend-ts && bun run bench:planning-deadlines` | PASS: 5,500 / 9,500 / 14,500 ms, exact day counts |
| `cd frontend && bun test src` | PASS: 188 tests, 0 failures |
| `cd frontend && bun run build` | PASS; existing unresolved legacy asset and large-chunk warnings remain |
| `cd frontend && bunx playwright test e2e/planning-deadlines.spec.ts --workers=1` | PASS: 7 tests |
| `git diff --check` | PASS |

`cd frontend && bun test` is not green: Bun discovers all 12 Playwright specs and reports runner-context errors (`Playwright Test did not expect test() to be called here`) after the source tests. A detached `698a20f` baseline reproduced the same error in its 8 tracked E2E specs. The current 12 comprise those 8 baseline specs, 3 unrelated user-untracked specs, and the Task 8 spec. This repository-wide test-discovery configuration gap is not hidden by the green `bun test src` and focused Playwright results.

## Process Hygiene

Task-owned ports `8191`, `8192`, and fix-round port `8193` were stopped after evidence collection. The fix-round temporary data directory was moved to the system Trash so its provider-settings copy was not left in `/tmp`. The pre-existing process on port `7860` was not stopped or replaced. Only tabs created for this task were closed.
