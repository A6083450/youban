# Conversation Record Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each first-message conversation in the sidebar, infer its title with the configured Pi-backed model, upgrade the same record into a trip plan, and enforce user soft deletion versus administrator permanent deletion.

**Architecture:** Add an additive schema-v3 `conversation_sessions` aggregate beside the existing task and plan-conversation stores. A small domain service owns session state, unified list projection, soft deletion, and permanent deletion; HTTP routes expose that service while the Vue record store renders conversations and plans as two views of one identity. Title inference is an independent Pi LLM call and never blocks the trip assistant stream.

**Tech Stack:** Bun 1.4, TypeScript, Elysia, Drizzle ORM with SQLite, Pi agent/LLM client, Vue 3 Composition API, Vue Router, Ant Design Vue, bun:test.

**Spec:** `docs/superpowers/specs/2026-08-23-conversation-record-lifecycle-design.md`

## Global Constraints

- The first non-empty user message creates exactly one visible conversation record before the assistant reply is requested.
- Title inference uses the current runtime model through the existing Pi LLM boundary and must not delay trip parsing or streaming.
- The model sees only the first user message; invalid or failed output uses a deterministic normalized fallback.
- A successful plan upgrades the same session and must not create a duplicate sidebar item.
- User deletion is logical only; administrator deletion is the only physical deletion path.
- Existing tasks, plan conversations, and image files must survive schema migration unchanged.
- Existing plans without sessions remain visible through a legacy projection.
- Page interaction and visual verification use `browser-use` only, with the Chrome ChatGPT plugin as the documented fallback.

---

### Task 1: Schema-v3 Session Repository

**Files:**
- Modify: `backend-ts/src/domain/db-schema.ts`
- Modify: `backend-ts/src/domain/database.ts`
- Modify: `backend-ts/src/domain/task-store.ts`
- Create: `backend-ts/src/domain/conversation-sessions.ts`
- Modify: `backend-ts/tests/task-store.test.ts`
- Create: `backend-ts/tests/conversation-sessions.test.ts`

**Interfaces:**
- Produces: `ConversationSessionRepository` with `create`, `getOwned`, `listOwned`, `replaceSnapshot`, `setTitle`, `linkPlan`, `markPlanned`, `markGenerationFailed`, `softDelete`, `hardDelete`, `getByPlanId`, and `close`.
- Produces: `ConversationSession`, `ConversationSessionSnapshot`, and `SessionRevisionConflictError` types.
- Extends: `SqliteTaskStore.listHistory({ userId, limit, allUsers?, includeUserDeleted? })`, `softDelete(taskId)`, and existing `delete(taskId)` as the physical operation.

- [ ] **Step 1: Write the failing migration and repository tests**

Add assertions that a version-2 database migrates to version 3 without losing a seeded task, contains `conversation_sessions`, and adds `tasks.user_deleted_at`. Add repository cases for idempotent client-provided `session_id`, owner isolation, monotonic revisions, stale revision rejection, plan linking, one-way `planned` state, and soft-delete exclusion.

```ts
const created = repository.create({
  sessionId: "session-1",
  userId: "user-1",
  firstMessage: "国庆新疆玩一个月帮我计划下",
  snapshot: { version: 1, items: [] },
});
expect(created.titleStatus).toBe("pending");
expect(repository.replaceSnapshot("session-1", "user-1", 0, { version: 1, items: [{ id: 1 }] }).revision).toBe(1);
expect(() => repository.replaceSnapshot("session-1", "user-1", 0, { version: 1, items: [] }))
  .toThrow(SessionRevisionConflictError);
```

- [ ] **Step 2: Run the focused tests and verify the intended failures**

Run: `cd backend-ts && bun test tests/task-store.test.ts tests/conversation-sessions.test.ts`

Expected: FAIL because schema version 3, `conversation_sessions`, task tombstones, and `ConversationSessionRepository` do not exist.

- [ ] **Step 3: Add the additive migration and repository implementation**

Define the table with a unique nullable `plan_id`, indexed `(user_id, deleted_at, updated_at)`, validated state/title-status strings, `revision INTEGER NOT NULL DEFAULT 0`, and JSON snapshot text. Add migration version 3 using `ALTER TABLE tasks ADD COLUMN user_deleted_at TEXT` plus `CREATE TABLE`/indexes; do not rebuild existing tables. Implement all repository writes as SQLite transactions and normalize dates/types at the domain boundary.

```ts
replaceSnapshot(sessionId: string, userId: string, expectedRevision: number, snapshot: unknown): ConversationSession {
  const result = this.database.raw.query(`
    UPDATE conversation_sessions
    SET snapshot = ?, revision = revision + 1, updated_at = ?
    WHERE session_id = ? AND user_id = ? AND deleted_at IS NULL AND revision = ?
  `).run(JSON.stringify(normalizeSnapshot(snapshot)), now(), sessionId, userId, expectedRevision);
  if (result.changes !== 1) throw new SessionRevisionConflictError(sessionId);
  return this.getOwned(sessionId, userId)!;
}
```

- [ ] **Step 4: Run focused tests and type checking**

Run: `cd backend-ts && bun test tests/task-store.test.ts tests/conversation-sessions.test.ts && bun run typecheck`

Expected: all focused tests pass; TypeScript reports no errors.

- [ ] **Step 5: Commit the schema and repository**

```bash
git add backend-ts/src/domain/db-schema.ts backend-ts/src/domain/database.ts backend-ts/src/domain/task-store.ts backend-ts/src/domain/conversation-sessions.ts backend-ts/tests/task-store.test.ts backend-ts/tests/conversation-sessions.test.ts
git commit -m "feat(backend-ts): persist conversation sessions"
```

### Task 2: Pi-backed Intent Title Inference

**Files:**
- Create: `backend-ts/src/agents/conversation-title.ts`
- Create: `backend-ts/tests/conversation-title.test.ts`

**Interfaces:**
- Consumes: existing `PiAgentLlmClient.agentComplete(prompt, options)` from `backend-ts/src/agents/llm/providers.ts`.
- Produces: `ConversationTitleService.infer(firstMessage: string, signal?: AbortSignal): Promise<{ title: string; status: "generated" | "fallback" }>`.
- Produces: `fallbackConversationTitle(firstMessage: string): string` for deterministic failures and invalid model output.

- [ ] **Step 1: Write failing title normalization tests**

Cover a valid Chinese intent title, a valid English title, quote/punctuation stripping, overlong output rejection, empty first message rejection, timeout/provider failure, and a fallback derived from the first message rather than a generic label.

```ts
const service = new ConversationTitleService({
  agentComplete: async () => "规划一个月新疆深度游",
} as Pick<PiAgentLlmClient, "agentComplete">);
expect(await service.infer("国庆新疆玩一个月帮我计划下"))
  .toEqual({ title: "规划一个月新疆深度游", status: "generated" });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd backend-ts && bun test tests/conversation-title.test.ts`

Expected: FAIL because the title service module is missing.

- [ ] **Step 3: Implement the narrow Pi title service**

Use `agentComplete` with no tools, thinking disabled, low temperature, at most 32 output tokens, and a five-second local abort deadline capped by the caller signal. The system prompt must demand a single 8-18-character Chinese title or 3-8-word English title and prohibit quotes, labels, and ending punctuation. Validate the returned text; catch provider/timeout/validation failures and return the deterministic fallback.

```ts
const output = await this.llm.agentComplete(firstMessage, {
  systemPrompt: TITLE_SYSTEM_PROMPT,
  temperature: 0.1,
  maxTokens: 32,
  disableThinking: true,
  signal,
  sessionId: `conversation-title:${createHash("sha256").update(firstMessage).digest("hex").slice(0, 16)}`,
});
```

- [ ] **Step 4: Run focused tests and type checking**

Run: `cd backend-ts && bun test tests/conversation-title.test.ts && bun run typecheck`

Expected: all title cases pass; TypeScript reports no errors.

- [ ] **Step 5: Commit title inference**

```bash
git add backend-ts/src/agents/conversation-title.ts backend-ts/tests/conversation-title.test.ts
git commit -m "feat(backend-ts): infer conversation intent titles"
```

### Task 3: User Conversation API and Unified Record Projection

**Files:**
- Create: `backend-ts/src/domain/conversation-records.ts`
- Modify: `backend-ts/src/domain/schemas.ts`
- Modify: `backend-ts/src/http/app.ts`
- Create: `backend-ts/tests/conversation-records-http.test.ts`

**Interfaces:**
- Consumes: `ConversationSessionRepository`, `ConversationTitleService`, and `SqliteTaskStore.listHistory`.
- Produces: `ConversationRecordService.listOwner(userId, limit)`, `create`, `detail`, `replaceSnapshot`, `softDeleteSession`, and `softDeletePlan`.
- Produces API DTOs with `record_id`, `kind`, `session_id`, nullable `plan_id`/`task_id`, `title`, `title_status`, `state`, `revision`, plan metadata, `updated_at`, and `user_deleted_at` for admin projections.

- [ ] **Step 1: Write failing HTTP contract tests**

Test immediate placeholder creation, idempotent repeated creation with the same client UUID, async title update with an injected fake title service, owner list/detail/update, stale revision `409`, other-user `404`, soft-deleted exclusion, legacy plan projection, and session/plan de-duplication by `plan_id`.

```ts
const created = await json(call(app, "POST", "/api/conversations", {
  session_id: "session-1",
  first_message: "国庆新疆玩一个月帮我计划下",
  snapshot: { version: 1, items: [] },
}));
expect(created).toMatchObject({
  record_id: "session-1",
  kind: "conversation",
  title: "新对话",
  title_status: "pending",
});
```

- [ ] **Step 2: Run the new HTTP tests and verify failure**

Run: `cd backend-ts && bun test tests/conversation-records-http.test.ts`

Expected: FAIL with `404` for `/api/conversations` and missing service/types.

- [ ] **Step 3: Implement the record service, schemas, routes, and title refresh**

Add `conversationTitleService?: ConversationTitleService` to `HttpRuntimeOptions` for deterministic tests. `POST /api/conversations` must commit the placeholder, start a caught background title promise that writes only while `title_status=pending`, and return without awaiting that promise. Repeated creation with the same session UUID may restart only a still-pending title job, making recovery idempotent. Unified list projection emits sessions first, suppresses a legacy task when its `plan_id` is already linked, then sorts once by `updated_at`.

- [ ] **Step 4: Run record, migration, and existing conversation tests**

Run: `cd backend-ts && bun test tests/conversation-records-http.test.ts tests/conversation-sessions.test.ts tests/conversation-http.test.ts tests/task-store.test.ts && bun run typecheck`

Expected: all tests pass; existing plan conversation endpoints are unchanged.

- [ ] **Step 5: Commit the user record API**

```bash
git add backend-ts/src/domain/conversation-records.ts backend-ts/src/domain/schemas.ts backend-ts/src/http/app.ts backend-ts/tests/conversation-records-http.test.ts
git commit -m "feat(backend-ts): expose conversation record API"
```

### Task 4: Generation Transitions and Two-level Deletion

**Files:**
- Modify: `backend-ts/src/domain/conversation-records.ts`
- Modify: `backend-ts/src/http/app.ts`
- Modify: `backend-ts/tests/conversation-records-http.test.ts`
- Modify: `backend-ts/tests/admin-http.test.ts`
- Modify: `backend-ts/tests/trip-task-mutations-http.test.ts`

**Interfaces:**
- Extends: trip plan request body with optional `session_id`.
- Produces: `GET /api/admin/records?visibility=all|active|user_deleted` and `DELETE /api/admin/records/:recordId`.
- Changes: owner `DELETE /api/trip/plan/:planId` to soft deletion; admin trip deletion remains permanent through one shared physical-delete service.

- [ ] **Step 1: Write failing lifecycle and deletion tests**

Cover signed plan submission linking a session, `generating` list state, successful planner completion producing one planned record, planner failure returning it to `chatting`, user plan delete retaining task/conversation/image rows, admin visibility filters, pure-chat permanent delete, plan permanent delete, processing delete rejection, and image deletion only after the last task reference disappears.

```ts
const hidden = await call(app, "DELETE", `/api/trip/plan/${planId}`);
expect(hidden.status).toBe(200);
expect(tasks.get(planId)).not.toBeNull();
expect(await ownerList(app)).not.toContainEqual(expect.objectContaining({ plan_id: planId }));
expect(await adminRecords(app, "user_deleted")).toContainEqual(
  expect.objectContaining({ plan_id: planId, user_deleted_at: expect.any(String) }),
);
```

- [ ] **Step 2: Run focused lifecycle tests and verify failures**

Run: `cd backend-ts && bun test tests/conversation-records-http.test.ts tests/admin-http.test.ts tests/trip-task-mutations-http.test.ts`

Expected: FAIL because generation does not link sessions, owner deletion is still physical, and admin record routes do not exist.

- [ ] **Step 3: Implement state transitions and deletion services**

Persist `session_id` in the normalized request payload, verify session ownership before consuming the execution token, and link the session in the same synchronous submission path as task creation. Update the session from the authoritative task result: only `completed` may set `planned`, while failure may set `chatting` only if the current state is not planned. Move `removeTripData` behind `ConversationRecordService.permanentlyDelete` so only admin routes call it; owner routes write tombstones. Database row deletion is transactional and the existing reference-checked image cleanup runs afterward.

- [ ] **Step 4: Run all affected backend tests and type checking**

Run: `cd backend-ts && bun test tests/conversation-records-http.test.ts tests/admin-http.test.ts tests/trip-planning-http.test.ts tests/trip-task-mutations-http.test.ts tests/conversation-http.test.ts && bun run typecheck`

Expected: lifecycle/deletion cases and all existing trip planning contracts pass.

- [ ] **Step 5: Commit lifecycle and deletion semantics**

```bash
git add backend-ts/src/domain/conversation-records.ts backend-ts/src/http/app.ts backend-ts/tests/conversation-records-http.test.ts backend-ts/tests/admin-http.test.ts backend-ts/tests/trip-task-mutations-http.test.ts
git commit -m "feat(backend-ts): enforce record lifecycle deletion"
```

### Task 5: Frontend Record Store and Discoverable Sidebar Sections

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/stores/conversation-records.ts`
- Create: `frontend/src/stores/conversation-records.test.ts`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`

**Interfaces:**
- Produces: `ConversationRecord`, `ConversationSessionDetail`, and create/update API request types.
- Produces: `records`, `conversationRecords`, `plannedRecords`, `recordsLoading`, `refreshRecords`, `waitForConversationTitle`, `notifyRecordsUpdated`, and active record selection helpers.
- Replaces sidebar consumption of `stores/plans.ts`; retain `refreshPlans` only for views that still require `TripHistoryItem` during migration.

- [ ] **Step 1: Write failing store projection tests**

Test stable sorting, separation into visible `conversation` and `plan` sections, no duplicate linked plan, optimistic immediate insertion, placeholder-to-model-title replacement, planned transition, and removal after successful soft deletion.

```ts
const grouped = groupConversationRecords([
  { record_id: "s1", kind: "conversation", state: "chatting", updated_at: "2026-08-23T10:00:00Z" },
  { record_id: "s2", kind: "plan", state: "planned", updated_at: "2026-08-23T11:00:00Z" },
]);
expect(grouped.conversations.map((item) => item.record_id)).toEqual(["s1"]);
expect(grouped.plans.map((item) => item.record_id)).toEqual(["s2"]);
```

- [ ] **Step 2: Run the store test and verify failure**

Run: `cd frontend && bun test src/stores/conversation-records.test.ts`

Expected: FAIL because the record store does not exist.

- [ ] **Step 3: Implement API types, store, and sidebar UI**

Render two plainly visible section headings without collapsible disclosure. Conversation items show title plus `生成中` when applicable; plan items preserve city/date/status presentation. Clicking a conversation sets `?conversation=<session_id>` and routes home; clicking a plan retains `/plan/:planId`. `waitForConversationTitle(sessionId)` refreshes only while that record remains `pending`, stops after a bounded number of short polls, and never blocks chat. Use the existing trash icon and confirmation, but update user copy to explain that deletion removes the item from their list. Keep fixed sidebar dimensions and mobile drawer behavior unchanged.

- [ ] **Step 4: Run frontend unit tests and build**

Run: `cd frontend && bun test src/stores/conversation-records.test.ts src/stores/preference-options.test.ts && bun run build`

Expected: tests pass and Vue type checking/build completes without layout/type errors.

- [ ] **Step 5: Commit sidebar records**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/stores/conversation-records.ts frontend/src/stores/conversation-records.test.ts frontend/src/App.vue frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json
git commit -m "feat(frontend): show conversation and plan records"
```

### Task 6: Chat Session Creation, Restore, and Plan Upgrade

**Files:**
- Create: `frontend/src/utils/conversationSession.ts`
- Create: `frontend/src/utils/conversationSession.test.ts`
- Modify: `frontend/src/views/ChatHome.vue`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/utils/planConversation.js`
- Modify: `frontend/src/utils/planConversation.test.mjs`

**Interfaces:**
- Consumes: session CRUD/list endpoints, background title polling, and `notifyRecordsUpdated` from Task 5.
- Produces: versioned `ChatSessionSnapshot`, stable snapshot serializer, local import marker, and current `sessionId`/`revision` lifecycle.
- Extends: trip generation request with `session_id`.

- [ ] **Step 1: Write failing session utility and request tests**

Cover stable-item serialization, transient-item exclusion, one-time local import eligibility, UUID reuse after create failure, revision updates, query-session selection, new-plan identity reset without deletion, and `session_id` inclusion in the confirmed plan request.

```ts
expect(toServerSnapshot([
  { id: 1, role: "user", type: "text", text: "国庆新疆玩一个月帮我计划下" },
  { id: 2, role: "assistant", type: "streaming", text: "正在" },
]).items).toHaveLength(1);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd frontend && bun test src/utils/conversationSession.test.ts src/utils/planConversation.test.mjs`

Expected: FAIL because server session utilities and plan `session_id` propagation are missing.

- [ ] **Step 3: Integrate server persistence without delaying chat**

On the first submit, generate a stable client UUID, push the local bubble, optimistically insert the placeholder record, and start session creation. Start trip parsing as soon as session creation has returned the durable id; then call `waitForConversationTitle` without awaiting it so the backend-generated title replaces the placeholder when ready. Debounce stable snapshot writes and carry the latest revision. On `409`, fetch the server detail and restore it rather than overwriting newer state. Import the old `tripstar.chat_session.<user>` snapshot once when no server identity is present. Restore `?conversation=` sessions on route/query changes and prevent an older async restore from replacing a newly selected chat.

- [ ] **Step 4: Link generation and preserve state on completion/failure**

Include `session_id` in the signed plan request, notify the record store when generation begins, completes, or fails, and stop clearing the server session after success. Clear only the active local identity before navigating to the plan result. New-plan starts a blank identity while leaving prior server records untouched.

- [ ] **Step 5: Run focused tests, all frontend unit tests, and build**

Run: `cd frontend && bun test src/utils/conversationSession.test.ts src/utils/planConversation.test.mjs && bun test src && bun run build`

Expected: all frontend tests pass and the production build completes.

- [ ] **Step 6: Commit chat lifecycle integration**

```bash
git add frontend/src/utils/conversationSession.ts frontend/src/utils/conversationSession.test.ts frontend/src/views/ChatHome.vue frontend/src/services/api.ts frontend/src/utils/planConversation.js frontend/src/utils/planConversation.test.mjs
git commit -m "feat(frontend): persist and restore trip conversations"
```

### Task 7: Administrator Record Visibility and Permanent Delete

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/components/admin/AdminTripsPanel.vue`
- Create: `frontend/src/admin/conversation-records.ts`
- Create: `frontend/src/admin/conversation-records.test.ts`
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `GET /api/admin/records` and permanent-delete endpoint from Task 4.
- Produces: visibility filter `all | active | user_deleted`, user-deleted badge projection, and permanent-delete confirmation copy.

- [ ] **Step 1: Write failing admin projection tests**

Cover all/active/user-deleted filters, conversation versus plan labels, nickname/search behavior, and permanent-delete eligibility for non-processing records.

```ts
expect(filterAdminRecords(records, { visibility: "user_deleted", status: "all", query: "" }))
  .toEqual([expect.objectContaining({ record_id: "deleted-session" })]);
```

- [ ] **Step 2: Run the focused admin test and verify failure**

Run: `cd frontend && bun test src/admin/conversation-records.test.ts`

Expected: FAIL because the admin record projection does not exist.

- [ ] **Step 3: Update the admin panel and API client**

Load all records by default, add a visible segmented/select visibility filter with `全部 / 正常 / 用户已删除`, show record kind and a `用户已删除` badge, retain user/status/search filters, and label the destructive action `永久删除`. The confirmation must state that chat, plan data, and unreferenced images cannot be recovered. Disable permanent deletion for `generating`/`processing` records.

- [ ] **Step 4: Run admin tests and frontend build**

Run: `cd frontend && bun test src/admin/conversation-records.test.ts src/admin/navigation.test.ts && bun run build`

Expected: tests pass and the admin Vue component type-checks/builds.

- [ ] **Step 5: Commit admin record management**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/components/admin/AdminTripsPanel.vue frontend/src/admin/conversation-records.ts frontend/src/admin/conversation-records.test.ts frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json
git commit -m "feat(admin): manage deleted conversation records"
```

### Task 8: Full Regression and Browser Acceptance

**Files:**
- Modify only when a failing verification identifies a scoped defect in files from Tasks 1-7.

**Interfaces:**
- Verifies the complete spec; produces no new public contract.

- [ ] **Step 1: Run fresh backend verification**

Run: `cd backend-ts && bun run test && bun run typecheck`

Expected: the complete backend suite passes with zero failures and TypeScript reports no errors.

- [ ] **Step 2: Run fresh frontend verification**

Run: `cd frontend && bun test src && bun run build`

Expected: the complete frontend suite passes with zero failures and the production build completes.

- [ ] **Step 3: Restart only the task-owned local server**

Stop the server process started for this task on `127.0.0.1:7860`, restart `backend-ts/src/index.ts` with the repository data directory, and verify `/health` plus the frontend root return `200`. Do not stop unrelated processes or ports.

- [ ] **Step 4: Verify the user flow with browser-use**

Reuse the existing YouBan tab when available. Send `国庆新疆玩一个月帮我计划下`; verify a placeholder conversation appears immediately, the inferred intent title replaces it without delaying the assistant reply, reload restores the chat, clicking new plan preserves the old record, and selecting the record resumes it. Complete generation and verify the same row moves to `游玩计划` with no duplicate. User-delete it and verify it disappears while its images remain retrievable.

- [ ] **Step 5: Verify the admin flow with browser-use**

Open the existing admin route in the reused tab or one task-created tab. Verify the default all-record view, each visibility filter, the user-deleted badge, and the permanent-delete confirmation. Permanently delete the acceptance fixture, refresh, verify it no longer exists in any filter, and verify only its now-unreferenced images return `404`.

- [ ] **Step 6: Inspect final state and commit only scoped acceptance fixes**

Run: `git status --short && git diff --check && git log --oneline --decorate -12`

Expected: no uncommitted implementation changes. If verification required a scoped repair, rerun the affected focused test first, then both full suites, and commit that repair with its regression test before final reporting.
