# Thinking Controls and Planning Deadlines Acceptance

Date: 2026-08-25 (Asia/Shanghai)

## Outcome

The deterministic deadline benchmark and the configured-provider browser measurements produced complete 7-, 15-, and 30-day plans within their respective accepted-to-readable limits. The first readable result was a fast plan in all three final measurements, followed by a completed enhanced plan.

An initial 15-day browser run exposed a delayed-timer race: an enhanced result delivered after the fast trigger could win `Promise.race` before the delayed timer callback ran. The regression was reproduced before implementation, fixed in commit `b6434bf`, and rechecked with the configured provider.

## Deterministic Benchmark

Command: `cd backend-ts && bun run bench:planning-deadlines`

```json
[{"days":7,"elapsed_ms":5500,"max_ms":6000,"plan_quality":"fast","day_count":7},{"days":15,"elapsed_ms":9500,"max_ms":10000,"plan_quality":"fast","day_count":15},{"days":30,"elapsed_ms":14500,"max_ms":15000,"plan_quality":"fast","day_count":30}]
```

The benchmark uses an in-process HTTP runtime, a controllable clock, and an intentionally non-completing enhanced planner. The elapsed value begins after `POST /api/trip/plan` is accepted and ends when `GET /api/trip/status/:id` returns a complete persisted plan.

## Configured-Provider Browser Measurements

Browser Use recording: `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/task8-planning-deadlines`

The browser used a task-owned service on `127.0.0.1:8192`. A temporary, test-only route outside the repository issued a confirmation token for a fixed, already-confirmed draft; no test route was added to the production application. Runtime provider settings were copied into a temporary data directory without printing credentials. The Browser Use tab was activated for the final measurements because Chrome throttled 50-100 ms polling in the hidden tab.

| Days | Task | Accepted to readable | Limit | Server elapsed | First quality | First state | Day count | Terminal elapsed | Terminal state |
| ---: | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- |
| 7 | `a5b8ff2d` | 5,938 ms | 6,000 ms | 5,503 ms | fast | running | 7 | 10,940 ms | enhanced / completed |
| 15 | `dbd5c5b0` | 9,526 ms | 10,000 ms | 9,501 ms | fast | running | 15 | 16,582 ms | enhanced / completed |
| 30 | `d07bd0cc` | 14,514 ms | 15,000 ms | 14,504 ms | fast | running | 30 | 16,509 ms | enhanced / completed |

Each browser value is the page's `performance.now()` difference from the successful POST response to the first status response containing a complete exact-length plan. Provider intake time is deliberately excluded from this planning SLO.

## Browser Behavior

- Settings persistence, visibility-off behavior, fast-plan navigation, all three terminal notices, and edit-conflict preservation passed in `frontend/e2e/planning-deadlines.spec.ts` (7/7).
- A live fast plan was edited from the browser by deleting attraction `itm_b8e2ff4f` (`HTTP 200`). Task `c0635a04` settled as fast / skipped at 15,076 ms, and the deleted item remained absent.
- Completed notice evidence: `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/task8-planning-deadlines/live-15-enhanced.png`.
- Skipped/edit-protection notice evidence: `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/task8-planning-deadlines/live-7-skipped.png`.
- The initial provider-backed 30-day intake emitted a conversational delta but no final confirmation within about 60 seconds. The accepted-to-readable 30-day measurement therefore used the test-only confirmed-draft boundary described above; no elapsed value was fabricated for the stalled intake.
- A configured administrator session was not available on the task-owned origin without entering a password during recording. Administrator persistence is therefore covered deterministically by Playwright, not claimed as a live administrator-session pass.

## Delayed-Timer Regression

RED: `bun test tests/plan-generation-coordinator.test.ts` produced 6 passes and 1 failure because a late enhanced result was published first instead of `["fast", "enhanced"]`.

GREEN: after checking elapsed time when enhanced wins the race, the same test file passed 7/7 and backend typecheck passed. Normal enhanced-before-trigger behavior remains covered. Fix commit: `b6434bf` (`fix(planning): honor elapsed deadline after timer delay`).

## Automated Verification

| Command | Result |
| --- | --- |
| `cd backend-ts && bun test` | PASS: 507 tests, 0 failures |
| `cd backend-ts && bun run typecheck` | PASS |
| `cd backend-ts && bun run bench:planning-deadlines` | PASS: 5,500 / 9,500 / 14,500 ms, exact day counts |
| `cd frontend && bun test src` | PASS: 188 tests, 0 failures |
| `cd frontend && bun run build` | PASS; existing unresolved legacy asset and large-chunk warnings remain |
| `cd frontend && bunx playwright test e2e/planning-deadlines.spec.ts --workers=1` | PASS: 7 tests |
| `git diff --check` | PASS |

`cd frontend && bun test` is not green: Bun discovers all 12 Playwright specs and reports 12 runner-context errors (`Playwright Test did not expect test() to be called here`) after the 188 source tests pass. Eleven tracked E2E specs predate Task 8; the new Task 8 spec is the twelfth. This repository-wide test-discovery configuration gap is not hidden by the green `bun test src` and focused Playwright results.

## Process Hygiene

Task-owned ports `8191` and `8192` were stopped after evidence collection. The pre-existing process on port `7860` was not stopped or replaced. Only the two browser tabs created for this task were closed.
