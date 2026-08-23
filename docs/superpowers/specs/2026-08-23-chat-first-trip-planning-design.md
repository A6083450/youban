# Chat-First Trip Planning Design

**Date:** 2026-08-23

## Goal

Turn initial trip intake into a fast, conversational flow. A vague request such as `我想去北京` must receive streamed conversational text quickly, must not immediately display a large confirmation card, and must not start detailed multi-agent planning until the traveler explicitly confirms a sufficiently complete draft.

## Current Problems

1. The parse SSE connection opens immediately, but the first readable model delta on a cold parent session was measured at 8.7 seconds.
2. The current parse path uses the full persistent parent Agent, including Skills, business tools, and the subagent capability, for simple intake questions.
3. Any parse result containing a trip draft becomes a large confirmation card, even when `ready_to_generate` is false and the assistant is still asking for missing information.
4. The card interrupts the conversation and exposes inferred defaults before the traveler has supplied essential constraints.

## Approved Experience

### Conversational intake

- The first response remains an ordinary assistant chat bubble and streams as text.
- When essential information is missing, the assistant asks a focused follow-up question. It does not show confirmation controls.
- The hidden structured draft is retained across turns so later answers refine the same trip.
- The assistant can discuss or revise the draft through normal text input.

### Ready draft

- Once the Agent reports `ready_to_generate`, the assistant posts a normal chat message containing a concise route draft and the assumptions that matter.
- Two actions remain visible directly below that message: `生成详细行程` and `继续调整`.
- This is not a modal, dialog, or standalone card. The summary and actions live inside the assistant bubble.
- The traveler may also type a clear affirmative reply such as `确认` or `确定`.

### Detailed planning

- Only a signed explicit confirmation starts `/api/trip/plan`.
- Detailed generation continues to use the existing Pi multi-agent planner: destination research, bounded segment planners, summary, and itinerary review.
- Progress and completion remain visible in the conversation. Existing task persistence, retry, ownership, and navigation behavior remain intact.

## Architecture

### Lightweight Pi intake Agent

Add a lightweight `Agent` turn to the existing Pi LLM client. It uses `@earendil-works/pi-agent-core`, a small intake-only system prompt, no tools, no Skills, and no subagents. The turn accepts the same abort signal and streams raw deltas.

`TripAssistant` uses this lightweight Pi Agent for parse and confirmation JSON. The full persistent parent Agent remains available to plan chat/edit workflows that need business tools, while `PiTripPlanner` and `PiSubagentRunner` remain unchanged for detailed generation.

This removes planning-scale prompt overhead from the first chat turn without replacing Pi with an ad hoc direct model call.

### Chat draft state

The frontend keeps `pendingDraft` as hidden state while `ready_to_generate` is false. A pending draft does not imply a visible confirmation message.

When ready, a `draft` chat item contains the human-readable Markdown summary and visible actions. Legacy persisted `confirm` items are migrated to `draft` items on restore so old local sessions do not render blank content.

### Confirmation contract

The confirm response includes `ready_to_generate`. An update can therefore either continue asking questions or publish the ready draft summary. A short affirmative is accepted only when a non-empty draft is present; negated or modifying phrases remain non-authorizing.

## Performance Acceptance

- The SSE connection must still deliver its connected frame immediately.
- With the configured local DeepSeek provider, a cold `我想去北京` parse should emit the first actual reply delta in no more than 2.5 seconds during acceptance testing.
- A warm repeat should remain below 1.5 seconds.
- These are local acceptance measurements, not a guarantee for every external provider or network condition.

## Compatibility And Safety

- Chinese and English remain the only product languages.
- No model key, prompt, or internal path is exposed to the browser.
- Existing confirmation ledger signing and one-time token consumption remain mandatory.
- Existing migrated plans, conversations, images, and active task recovery are not rewritten.
- No change is made to the multi-agent planner's trusted POI, budget, checkpoint, retry, or concurrency boundaries.

## Verification

- Backend unit/integration tests cover lightweight Pi Agent streaming, abort, parse readiness, short affirmative confirmation, negation, and SSE ordering.
- Frontend unit tests cover draft Markdown, action availability, incomplete-draft suppression, and legacy session migration.
- Focused backend and frontend suites, typecheck, and frontend build must pass.
- Browser verification must use `browser-use`, reuse the existing local tab, and confirm both the vague first turn and the ready-draft action flow.
- A real local timing probe records connected, first delta, and final payload times.
