# Thinking Controls and Planning Deadlines Design

## Goal

Let administrators independently control whether the configured model uses thinking mode and whether users see planning-thought summaries. Make the first usable trip plan available within a day-count service level objective: 1-7 days within 6 seconds, 8-15 days within 10 seconds, and 16-30 days within 15 seconds. Slow providers must not leave the user waiting indefinitely.

## Product Behavior

### Administrator controls

The runtime settings page adds two switches under the model settings:

- `启用模型思考模式`: sends an explicit provider-compatible thinking setting for every conversational and planning model call.
- `向用户展示思考摘要`: shows concise planning summaries while the assistant or planner is working. This switch is disabled when thinking mode is off.

Both settings default to off to preserve the current low-latency behavior. Turning thinking mode on does not automatically expose thought content. The visibility setting controls only user-facing summaries; raw hidden chain-of-thought and provider protocol events are never rendered.

Settings remain hot-reloadable through the existing administrator settings endpoint. Saving either switch rebuilds model-backed services through the current settings refresh boundary without restarting the server.

### Planning deadlines

The deadline is measured from successful acceptance of `POST /api/trip/plan` until the persisted plan can be read from the result endpoint with every requested day present:

| Requested trip length | User-visible deadline | Fast-plan trigger |
| --- | ---: | ---: |
| 1-7 days | 6 seconds | 5.5 seconds |
| 8-15 days | 10 seconds | 9.5 seconds |
| 16-30 days | 15 seconds | 14.5 seconds |

The 500 ms margin is reserved for local finalization, persistence, WebSocket delivery, and result-page navigation. Trips longer than 30 days remain outside this service-level contract and continue using the configured planner timeout.

If the enhanced planner completes before the trigger, its result is published normally. Otherwise, the system atomically publishes a deterministic fast plan and lets the enhanced planner continue in the background.

## Fast Plan Contract

A fast plan is a complete, usable itinerary rather than a loading placeholder. It must:

- contain exactly the requested dates and day count;
- preserve destinations, traveler count, rooms, budget, preferences, and accommodation level;
- use trusted attraction, hotel, and weather results already available at the trigger time;
- distribute available attractions without duplicate scheduling;
- provide a daily theme, transportation guidance, accommodation guidance, meal suggestions, and a budget summary;
- pass the same normalization, scheduling, budget, and schema boundaries as an enhanced plan;
- remain valid when no external research request has returned.

The fast plan is produced locally without another model or network request. Missing live data is represented with honest generic guidance rather than invented POI identifiers, weather, prices, or opening hours.

## Background Enhancement

Publishing a fast plan changes the task to `completed` so the user can open the result immediately. The persisted result also contains:

- `plan_quality: "fast" | "enhanced"`;
- `enhancement_status: "pending" | "running" | "completed" | "failed" | "skipped"`;
- `deadline_seconds` and `generation_elapsed_ms`;
- the result revision present when the fast plan was published.

The original planner continues with its existing checkpoint and cancellation boundaries. If it succeeds, the enhanced result replaces the fast result only when the plan revision is still the fast-plan revision. Any user edit, add, delete, reorder, or chat-driven plan mutation changes the revision and causes automatic enhancement application to be skipped. This favors preserving user work over silently replacing it.

An enhancement failure does not change the task back to failed because the fast plan remains usable. Restart recovery marks interrupted enhancement work as failed while retaining the completed fast plan.

## User-Facing Status

When a fast plan is published, the result page shows a calm informational banner:

> 为了减少等待，已先为你生成快速版计划。你可以立即查看，游伴正在补充更详细的信息。

While enhancement is pending or running, the page refreshes enhancement state through the existing authenticated plan status boundary. It does not block editing.

When enhancement is applied, the banner changes to:

> 计划细节已补充完成。

When enhancement fails, it changes to:

> 当前计划可以正常使用，部分实时信息暂未补充，你可以稍后重试。

When enhancement is skipped because the user edited the plan, it changes to:

> 已保留你的修改，后台补充内容没有覆盖当前计划。

The banner is visually informational, not an error alert. It may be dismissed after reaching a terminal enhancement state. Chinese, English, and Japanese copy use the existing localization system.

## Thinking Summary Flow

The runtime model boundary receives an explicit thinking mode for both direct LLM calls and Pi subagent calls. Provider adapters translate the shared boolean into the provider-supported request shape. Unsupported providers ignore only the provider-specific field while retaining the shared application setting.

When summary visibility is off, reasoning protocol events and internal agent reasoning are filtered before task details or SSE payloads are persisted. Existing stage names, tool outcomes, and progress percentages remain visible.

When visibility is on, the backend emits short, sanitized summaries derived from planning stages and validated agent outcomes, such as selecting suitable attractions or balancing daily pace. It never forwards raw reasoning tokens, hidden prompts, credentials, tool payloads, or unvalidated model text. No extra model call is introduced solely to generate these summaries, so enabling visibility does not consume the planning deadline.

The frontend renders these summaries through the existing `Thinking` and `ThoughtChain` components. Conversation parsing and confirmation use the same visibility rule, while ordinary assistant answers continue streaming normally.

## Data and API Changes

Runtime settings add:

- `llm_thinking_enabled: boolean`, default `false`;
- `llm_thinking_visible: boolean`, default `false`.

The public settings endpoint may expose the effective booleans because they contain no secret. The administrator endpoint reads and writes them through the existing validated runtime-settings contract. An effective visible value is always false when thinking is disabled, even if a stale persisted override says otherwise.

Task result and status responses add the quality and enhancement fields without removing or renaming current fields. Existing clients that ignore the new fields remain compatible. The WebSocket terminal frame remains valid when a fast plan is published; result-page enhancement refresh uses authenticated status polling so the existing terminal socket lifecycle does not need to stay open.

## Error Handling and Concurrency

- Exactly one publication wins: enhanced-before-deadline or fast-at-deadline.
- A late enhanced result may upgrade a fast plan but may never regress an enhanced result.
- Task deletion or server shutdown aborts the associated enhancement work.
- A retry starts a new deadline window and preserves the existing task identifier contract.
- Fast-plan construction failure is treated as an internal invariant violation and falls back to the normal task failure response; automated tests must make this path unreachable for valid requests.
- Progress writes after fast publication cannot overwrite the completed task state or its persisted result.
- Runtime settings changes affect new calls and new planning tasks; an already-running task retains the settings snapshot with which it started.

## Verification

Backend tests must cover:

- settings defaults, validation, persistence, hot reload, and the dependency between the two switches;
- explicit thinking-enabled and thinking-disabled provider request payloads;
- filtering and emitting user-visible thought summaries;
- deadline selection at 1, 7, 8, 15, 16, and 30 days;
- enhanced completion before the trigger;
- deterministic fast publication with slow model and map fakes;
- exact day counts and valid result schemas for 7-, 15-, and 30-day fast plans;
- late enhancement application, failure, restart recovery, deletion, and revision-conflict skipping;
- no completed-to-failed or enhanced-to-fast state regression.

Frontend tests must cover switch state, disabled visibility control, persistence payloads, every enhancement banner state, polling cleanup, and protection of active edits.

Browser verification uses the task-owned local server and covers administrator switch changes plus authenticated 7-, 15-, and 30-day generation. Timing is measured from the plan POST to the first successful readable result. Each representative run must satisfy 6, 10, and 15 seconds respectively, display the fast-plan notice when degradation occurs, and later show the correct enhancement outcome without overwriting a user edit.

The complete backend and frontend suites, TypeScript checks, production build, and `git diff --check` must remain green.
