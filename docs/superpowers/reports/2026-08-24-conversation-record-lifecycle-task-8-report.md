# Conversation Record Lifecycle Task 8 Acceptance Report

Date: 2026-08-24

## Integration Baseline

- Acceptance branch: `codex/conversation-record-lifecycle-integration`
- Feature baseline: `7e4494d`
- Merged `main` baseline: `81d0661`
- Integration merge: `24df2cf`
- Runtime data: repository `data/` directory
- Task-owned servers: `127.0.0.1:7860` and the cache-isolated acceptance origin `127.0.0.1:7861`

## Automated Verification

- Backend: `bun run test && bun run typecheck`
  - 460 tests passed, 0 failed, 1912 assertions.
  - TypeScript completed with no errors.
- Frontend: `bun test src && bun run build`
  - 170 tests passed, 0 failed, 536 assertions.
  - `vue-tsc` and the Vite production build completed successfully.
  - Vite emitted only the repository's existing unresolved static-asset and chunk-size warnings.

## User Browser Acceptance

The primary flow used the required prompt `国庆新疆玩一个月帮我计划下` with user `task8-0824`.

- The sidebar inserted `新对话` immediately while the assistant was already responding.
- The model-generated title `新疆国庆一月游计划` replaced the placeholder independently.
- The durable session id was `fe01b4f5-cc97-4cda-b1fd-cac15e064f4b`.
- A hard reload restored the complete chat, readiness token, and pending draft.
- Generation completed as plan `fd6a5ce1`; the same record moved from `对话记录` to `游玩计划` without a second row.
- User deletion removed the plan from the owner list while its already cached image URLs continued to return `200`.

A cache-isolated regression flow ran against the repaired build on `127.0.0.1:7861` with user `task8-fix-0824`:

- The page loaded `ChatHome-Bm2318eH.js`.
- Session `d136df06-016b-4f9e-9eae-11dcf4783e3b` upgraded in place to plan `5848e709`.
- After user deletion, the owner list was empty immediately and remained empty after a wait plus forced reload.
- No replacement conversation or generation task appeared.
- The soft-deleted plan status endpoint returns `404` to the owner after the backend repair.

Recordings:

- `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/youban-task8-conversation-record-lifecycle`
- `/Users/liangjiaquan/.config/browser-harness/agent-workspace/recordings/youban-task8-conversation-record-lifecycle-resume`

## Acceptance Defects Repaired

### Completed chat resurrection

`ChatHome` suppressed persistence after successful generation, but its unmount hook unconditionally captured the old in-memory chat after the durable identity had been cleared. Returning home imported that raw fallback as a new conversation and could start a duplicate generation.

The unmount path now flushes the already queued durable capture without scheduling a suppressed fallback. The regression test proves that a completed plan cannot recreate the raw local snapshot.

### Soft-deleted plan detail remained visible

The task soft-delete marker is stored outside the cached task payload. Owner detail and mutation routes therefore passed the in-memory ownership check and could still return the deleted task.

Task access now checks the persisted tombstone before owner authorization. User detail, retry, edit, budget, item mutation, share creation, and WebSocket entry points return `404` for a user-deleted plan, while a valid administrator token retains access. The delete route keeps its separate ownership-only guard so repeated soft deletion remains idempotent.

The protocol checks happen before a streaming response or upgraded connection is established. The HTTP regression test verifies owner status/conversation denial, an edit-stream JSON `404`, administrator status access, and repeated deletion. The WebSocket regression test reads the handshake status line as `404` and independently proves that the client never reaches `open`.

## Admin Browser Acceptance

- The authenticated record-management route opened in the default all-record view with 31 records.
- The `正常` filter showed 28 active records and excluded user-deleted rows.
- The `用户已删除` filter showed the three tombstoned records and their visible `用户已删除` badges.
- The destructive confirmation stated that conversations, plans, and unreferenced images would be permanently removed and could not be recovered.
- A unique task-owned image reference was attached to the short acceptance plan solely to verify real cleanup without touching existing user images. It returned `200` before deletion.
- Permanently deleting the short acceptance plan removed its task, linked session, legacy conversation, and unique image. The three database row counts became zero and the image returned `404`.
- Refresh plus the all-record filter confirmed that the fixture no longer existed in any visibility view.
- The original long-flow record, the invalid-model fallback conversation, and the duplicate plan produced by the repaired resurrection defect were also permanently removed. No `jason` or historical anonymous-user record was deleted.

## Final State

- All Task 8 browser and automated acceptance checks passed.
- All task-created database fixtures were permanently removed after verification.
- The task-owned servers remain available for final integration verification.
