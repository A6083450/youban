# Conversation Record Lifecycle Design

## Goal

Create a durable conversation record when a user sends the first message, let the user reopen and continue unfinished conversations from the sidebar, and upgrade the same record into a trip plan after generation completes. User-side deletion is reversible data hiding; only an administrator may permanently delete records and unreferenced images.

## Product Behavior

### Sidebar identity and sections

- The first non-empty user message creates exactly one conversation record before the assistant response is requested.
- The sidebar shows the record immediately under `对话记录` / `Conversations` with a temporary `新对话` / `New conversation` title.
- Unfinished records remain under the conversation section. A generating record shows the existing generating state; a failed generation returns to the conversation section and remains resumable.
- When detailed trip generation completes, the same record changes to `planned`, moves to `游玩计划` / `Trip plans`, and displays the generated city route and dates. It must not create a second sidebar item.
- Clicking an unfinished record restores its complete stable chat snapshot, pending draft, readiness token, and pending confirmation state so the user can continue.
- Clicking a planned record opens the existing plan result route.
- Both sections are ordered by most recent activity and support deletion.

### Model-generated title

- Conversation creation must not wait for title generation. The placeholder appears immediately and the regular Pi-backed assistant request starts without delay.
- After creation, the backend uses the currently configured runtime model through the existing Pi LLM boundary to infer the intent of the first user message.
- The model receives only the first user message and a narrow title prompt. It returns one plain title: 8-18 Chinese characters or 3-8 English words, without quotes, sentence-ending punctuation, or implementation labels.
- Title inference runs independently from trip parsing. Success updates the sidebar automatically; a timeout, provider failure, invalid output, or empty output falls back to a normalized truncation of the first message.
- Title inference never changes an existing non-placeholder title and is idempotent for retries.

## Data Model

Add schema version 3 with a `conversation_sessions` table:

| Column | Purpose |
| --- | --- |
| `session_id` | Stable UUID primary key used by sidebar and restore routes |
| `user_id` | Owner boundary |
| `title` | Placeholder, inferred title, or deterministic fallback |
| `title_status` | `pending`, `generated`, or `fallback` |
| `state` | `chatting`, `generating`, or `planned` |
| `plan_id` | Nullable linked task/plan id; unique when present |
| `snapshot` | Versioned JSON chat snapshot required for exact restore |
| `first_message` | Immutable normalized first user message used for title inference |
| `revision` | Monotonic integer used to reject stale snapshot writes |
| `created_at` | Creation timestamp |
| `updated_at` | Last meaningful activity timestamp |
| `deleted_at` | Nullable user-side soft-delete timestamp |

Add nullable `user_deleted_at` to existing task storage so legacy plans that do not yet have a session can use the same user-side soft-delete contract. Task history excludes soft-deleted tasks for normal users and includes them for administrators.

Existing `conversations` rows remain the compatibility store for plan-linked plain message history. New planned sessions retain their richer snapshot in `conversation_sessions` and continue writing the existing plan conversation representation for result-page editing. The migration is additive and does not rebuild or discard the existing tasks or conversations tables.

## API Contract

### User endpoints

- `POST /api/conversations` creates a session from the first message and initial snapshot, returns the placeholder record immediately, and starts idempotent title inference.
- `GET /api/conversations` returns non-deleted conversation records and visible trip plans as one ordered, de-duplicated collection with `kind: conversation | plan`.
- `GET /api/conversations/:sessionId` verifies ownership and returns the complete session snapshot.
- `PUT /api/conversations/:sessionId` verifies ownership and replaces the versioned stable snapshot while updating `updated_at`.
- `POST /api/conversations/:sessionId/generation` links a signed, ready trip submission to the session and changes state to `generating`.
- Task completion changes the linked session to `planned`; task failure changes it back to `chatting`.
- `DELETE /api/conversations/:sessionId` sets `deleted_at` only.
- Existing `DELETE /api/trip/plan/:planId` becomes a soft delete for the owner and soft-deletes the linked session when one exists.

Every endpoint uses the existing `x-user-id` ownership boundary. A user cannot read, mutate, link, or delete another user's session.

### Administrator endpoints

- `GET /api/admin/records?visibility=all|active|user_deleted` returns conversations and plans, including owner nickname and user-deletion status.
- `DELETE /api/admin/records/:recordId` permanently deletes a pure conversation or a linked plan record.
- Permanent plan deletion removes the task, the linked session, the legacy plan conversation, and image files only when no remaining task references them.
- The existing admin trip endpoint remains compatible during the transition and delegates physical plan deletion to the same domain service.
- Processing/generating records cannot be permanently deleted until generation completes or fails, preserving the current task-safety rule.

## Frontend Data Flow

1. `ChatHome` receives the first non-empty message.
2. It creates the local user bubble, constructs the initial stable snapshot, and calls session creation before starting parse orchestration.
3. The returned `session_id` becomes the current chat identity. The global record store refreshes immediately, so the sidebar appears without waiting for the model.
4. Title inference resolves independently and triggers a record refresh. Chat parsing and streaming continue in parallel.
5. Stable chat changes are saved with a short debounce. Transient typing, streaming, and progress items are excluded exactly as in the current local snapshot logic.
6. A sidebar conversation click navigates to `/?conversation=<session_id>` and restores the server snapshot. New-plan clears only the active identity; it does not delete old records.
7. Confirmed generation includes `session_id`. The state becomes `generating`, and completion converts the same list item to a plan.
8. The current browser-local snapshot is imported once when no server session identity exists, then marked as migrated locally. This preserves an unfinished pre-upgrade conversation without duplicating future sessions.

## User and Admin Deletion

User deletion is a logical delete:

- the record disappears from the user sidebar immediately;
- chat snapshots, plan/task payloads, plan conversations, and images remain on disk;
- deleting a planned record marks both the linked session and task as user-deleted;
- a stale direct URL returns not found to the owner after soft deletion.

Administrator deletion is permanent:

- the admin list defaults to all records and offers `全部 / 正常 / 用户已删除` filters;
- user-deleted rows show a `用户已删除` badge;
- a destructive confirmation names the permanent nature of the action;
- pure conversations delete only the session row;
- plans delete the linked session, task, legacy conversation, and only unreferenced cached images.

## Error Handling and Concurrency

- Session creation failure does not silently lose the first message. The UI keeps the current local snapshot, reports that history could not be saved, and allows retry without creating duplicates through a client-generated session UUID.
- Snapshot writes use the session `updated_at` revision to reject stale overwrites. The active tab reloads the current record when it receives a conflict.
- Repeated title requests, repeated generation linking, and repeated soft deletion are idempotent.
- A completed task is authoritative over a late failure callback: session state cannot regress from `planned`.
- A soft-deleted record is excluded from all owner list/detail/update routes even if a stale browser still has its id.
- Permanent deletion is transactional for database rows. Image removal remains post-transaction best effort and is reference checked.

## Compatibility and Migration

- Schema version 3 only adds structures and columns; it never rewrites existing payload JSON.
- Existing generated tasks without session rows continue to appear as plans through a legacy projection.
- The first time a legacy plan is user-deleted, its task tombstone is sufficient; no synthetic session is required.
- New generated sessions are de-duplicated against task history by `plan_id`.
- Existing plan conversation retrieval stays available and preserves migrated data.
- No migration deletes or relocates image files.

## Verification

- Repository tests cover schema migration from version 2, session CRUD, ownership, title generation and fallback, optimistic snapshot writes, state transitions, soft deletion, admin filters, permanent deletion, legacy projection, de-duplication, and image reference preservation.
- Frontend tests cover immediate sidebar insertion, title replacement, section transitions, restoring unfinished conversations, one-time local snapshot import, user soft deletion, admin filtering, and permanent-delete confirmation.
- Existing backend and frontend suites must remain green.
- Browser verification uses `browser-use` against the task-owned local server and covers: first-message immediate record, generated model title, reload/continue, successful plan upgrade without duplication, user deletion, and admin visibility/permanent deletion.
