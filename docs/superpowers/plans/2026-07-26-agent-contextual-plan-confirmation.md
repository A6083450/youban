# Agent Contextual Plan Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 agent 结合对话历史、当前草稿和最新回复推理是否确认生成，并用一次性服务端执行凭证安全启动计划。

**Architecture:** `/confirm-reply` 是唯一确认意图决策入口。Agent 输出 `confirm/update/cancel/chat/ask_confirmation + confidence`；只有高置信度 `confirm` 才在后端创建 decision ledger 记录并签发与规范化草稿绑定的一次性 `execution_token`。前端不解释自然语言确认，`/plan` 在创建 task 前校验签名、过期、草稿哈希、decision 状态与消费状态。

**Tech Stack:** FastAPI、Pydantic v2、Python stdlib `hmac/hashlib/secrets/time`、Vue 3 `<script setup>`、TypeScript、Node `node:test`、Python `unittest`

## Global Constraints

- 不使用前端或后端固定肯定词表判断“嗯/好的/可以”等自然语言确认。
- `ready_to_generate` 仅表示字段完整度，永远不能授权生成。
- 只有 `action=confirm` 且 `confidence >= 0.85` 才能签发执行凭证。
- 低置信度确认必须降级为 `ask_confirmation`，继续自然对话。
- 执行凭证有效期 10 分钟、一次性使用、与城市/日期/天数/交通/住宿/偏好绑定。
- `/plan` 任一授权校验失败时，不得写 `_tasks`、不得落盘、不得启动后台协程。
- 不增加确认按钮；用户继续使用聊天输入框确认。

---

## File Structure

- `backend/app/services/trip_confirmation.py`：只负责草稿规范化、decision ledger、一次性 token 签发/校验/消费；不包含自然语言关键词判断。
- `backend/app/services/trip_confirmation_test.py`：token 生命周期、草稿绑定、过期、重复消费单元测试。
- `backend/app/api/routes/trip.py`：调用 LLM 进行确认决策；高置信度 confirm 签发 token；`/plan` 校验并消费 token。
- `backend/app/api/routes/trip_confirmation_endpoint_test.py`：confirm-reply 输出和 plan endpoint 授权集成测试。
- `backend/app/models/schemas.py`：`TripRequest.execution_token` 请求字段。
- `frontend/src/types/index.ts`：确认动作、confidence、execution token 类型契约。
- `frontend/src/services/api.ts`：confirm-reply 和 plan 请求传输。
- `frontend/src/views/ChatHome.vue`：待确认状态机；所有回复走 agent；仅 confirm+token 生成。
- 删除 `frontend/src/utils/tripConfirmation.js`、`.d.ts`、`.test.mjs`：撤销固定确认词表机制。

---

### Task 1: 一次性执行凭证服务

**Files:**
- Replace: `backend/app/services/trip_confirmation.py`
- Replace: `backend/app/services/trip_confirmation_test.py`

**Interfaces:**
- Produces: `register_confirm_decision(draft: Any, confidence: float, ttl_seconds: int = 600) -> tuple[str, str]`
- Produces: `validate_execution_token(token: object, draft: Any) -> tuple[bool, str]`
- Produces: `consume_execution_token(token: object, draft: Any) -> tuple[bool, str]`
- Consumes: no LLM or route code

- [ ] **Step 1: Replace tests with failing token lifecycle tests**

```python
import time
import unittest
from unittest.mock import patch

from app.services.trip_confirmation import (
    clear_confirmation_ledger,
    consume_execution_token,
    register_confirm_decision,
    validate_execution_token,
)

DRAFT = {
    "city": "大理",
    "cities": [{"city": "大理", "days": 7}],
    "start_date": "2026-10-01",
    "end_date": "2026-10-07",
    "travel_days": 7,
    "transportation": "公共交通",
    "accommodation": "经济型酒店",
    "preferences": ["自然风光", "休闲"],
}

class ExecutionTokenTest(unittest.TestCase):
    def setUp(self):
        clear_confirmation_ledger()

    def test_high_confidence_decision_issues_valid_token(self):
        decision_id, token = register_confirm_decision(DRAFT, 0.92)
        self.assertTrue(decision_id)
        self.assertTrue(token)
        self.assertEqual(validate_execution_token(token, DRAFT), (True, "ok"))

    def test_low_confidence_does_not_issue_token(self):
        decision_id, token = register_confirm_decision(DRAFT, 0.84)
        self.assertEqual((decision_id, token), ("", ""))

    def test_token_is_bound_to_draft(self):
        _, token = register_confirm_decision(DRAFT, 0.95)
        changed = {**DRAFT, "travel_days": 5}
        self.assertEqual(validate_execution_token(token, changed), (False, "draft_mismatch"))

    def test_token_is_one_time(self):
        _, token = register_confirm_decision(DRAFT, 0.95)
        self.assertEqual(consume_execution_token(token, DRAFT), (True, "ok"))
        self.assertEqual(consume_execution_token(token, DRAFT), (False, "already_consumed"))

    def test_expired_token_is_rejected(self):
        with patch("app.services.trip_confirmation.time.time", return_value=1000):
            _, token = register_confirm_decision(DRAFT, 0.95, ttl_seconds=10)
        with patch("app.services.trip_confirmation.time.time", return_value=1011):
            self.assertEqual(validate_execution_token(token, DRAFT), (False, "expired"))
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd backend
.venv/bin/python -m unittest app.services.trip_confirmation_test -v
```

Expected: import failures for `clear_confirmation_ledger`, `register_confirm_decision`, `validate_execution_token`, and `consume_execution_token`.

- [ ] **Step 3: Implement token ledger without natural-language rules**

```python
# backend/app/services/trip_confirmation.py
import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from typing import Any

_SECRET = secrets.token_bytes(32)
_DRAFT_FIELDS = (
    "city", "cities", "start_date", "end_date", "travel_days",
    "transportation", "accommodation", "preferences",
)
_CONFIRM_THRESHOLD = 0.85
_LEDGER: dict[str, dict[str, Any]] = {}

def _canonical_draft(draft: Any) -> dict[str, Any]:
    data = draft.model_dump(mode="json") if hasattr(draft, "model_dump") else dict(draft or {})
    return {field: data.get(field) or ([] if field in {"cities", "preferences"} else None) for field in _DRAFT_FIELDS}

def _draft_hash(draft: Any) -> str:
    raw = json.dumps(_canonical_draft(draft), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()

def clear_confirmation_ledger() -> None:
    _LEDGER.clear()

def register_confirm_decision(draft: Any, confidence: float, ttl_seconds: int = 600) -> tuple[str, str]:
    if confidence < _CONFIRM_THRESHOLD:
        return "", ""
    decision_id = uuid.uuid4().hex
    nonce = secrets.token_urlsafe(16)
    expires_at = int(time.time()) + ttl_seconds
    payload = {"decision_id": decision_id, "nonce": nonce, "expires_at": expires_at, "draft_hash": _draft_hash(draft)}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(_SECRET, encoded.encode(), hashlib.sha256).hexdigest()
    token = f"{encoded}.{signature}"
    _LEDGER[decision_id] = {**payload, "consumed": False}
    return decision_id, token

def _decode(token: object) -> tuple[dict[str, Any] | None, str]:
    try:
        encoded, supplied = str(token or "").rsplit(".", 1)
        expected = hmac.new(_SECRET, encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(supplied, expected):
            return None, "invalid_signature"
        padded = encoded + "=" * (-len(encoded) % 4)
        return json.loads(base64.urlsafe_b64decode(padded)), "ok"
    except Exception:
        return None, "invalid_token"

def validate_execution_token(token: object, draft: Any) -> tuple[bool, str]:
    payload, reason = _decode(token)
    if not payload:
        return False, reason
    entry = _LEDGER.get(str(payload.get("decision_id") or ""))
    if not entry:
        return False, "unknown_decision"
    if entry["consumed"]:
        return False, "already_consumed"
    if int(entry["expires_at"]) < int(time.time()):
        return False, "expired"
    if entry["draft_hash"] != _draft_hash(draft):
        return False, "draft_mismatch"
    return True, "ok"

def consume_execution_token(token: object, draft: Any) -> tuple[bool, str]:
    valid, reason = validate_execution_token(token, draft)
    if not valid:
        return False, reason
    payload, _ = _decode(token)
    _LEDGER[payload["decision_id"]]["consumed"] = True
    return True, "ok"
```

- [ ] **Step 4: Run token tests and verify GREEN**

Run:

```bash
cd backend
.venv/bin/python -m unittest app.services.trip_confirmation_test -v
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit (only if explicitly requested by user)**

```bash
git add backend/app/services/trip_confirmation.py backend/app/services/trip_confirmation_test.py
git commit -m "feat(chat): add one-time plan execution tokens"
```

---

### Task 2: Agent 确认决策 API

**Files:**
- Modify: `backend/app/api/routes/trip.py:580-743`
- Modify: `backend/app/api/routes/trip_confirmation_endpoint_test.py`

**Interfaces:**
- Consumes: `register_confirm_decision(draft, confidence)` from Task 1
- Produces: `TripConfirmReplyResponse` JSON with `action`, `confidence`, `message`, `trip`, `decision_id`, `execution_token`

- [ ] **Step 1: Write failing confirm-reply route tests with mocked LLM output**

Add tests that monkeypatch `get_llm` and return deterministic JSON:

```python
class FakeMessage:
    def __init__(self, content): self.content = content
class FakeChoice:
    def __init__(self, content): self.message = FakeMessage(content)
class FakeResponse:
    def __init__(self, content): self.choices = [FakeChoice(content)]

# action=confirm, confidence=.94 -> execution_token non-empty
# action=confirm, confidence=.70 -> action becomes ask_confirmation, token empty
# action=chat -> token empty, original draft preserved by frontend contract
# action=update -> returns full new trip with token empty
```

Mock `asyncio.to_thread` to execute the supplied lambda inline or return `FakeResponse` so no external LLM call occurs.

- [ ] **Step 2: Run route tests and verify RED**

```bash
cd backend
.venv/bin/python -m unittest app.api.routes.trip_confirmation_endpoint_test -v
```

Expected: response lacks `confidence`, `decision_id`, `execution_token`, and `ask_confirmation` action.

- [ ] **Step 3: Update confirm-reply prompt and response contract**

Change allowed actions to:

```json
{
  "action": "confirm|update|cancel|chat|ask_confirmation",
  "confidence": 0.0,
  "message": "自然语言回复",
  "cities": [],
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "transportation": "公共交通",
  "accommodation": "经济型酒店",
  "preferences": [],
  "inferred_fields": [],
  "suggestions": []
}
```

Prompt requirements:

```text
- 结合最近对话、当前草稿、最新回复和语气判断，不使用固定词表。
- 用户回复“嗯”时，必须根据上一轮是否明确请求确认判断；普通聊天中的“嗯”不是确认。
- 疑问、咨询、比较、继续了解目的地属于 chat。
- 不够确定时 action=ask_confirmation，并自然追问一句。
- confidence 表示用户是否明确授权执行当前草稿，而不是字段完整度。
```

Post-process exactly:

```python
confidence = max(0.0, min(float(data.get("confidence") or 0), 1.0))
if action == "confirm" and confidence < 0.85:
    action = "ask_confirmation"
    message = message or "你是想按当前这份草稿开始生成计划吗？"

decision_id = ""
execution_token = ""
if action == "confirm":
    confirmed_trip = _build_trip() or draft
    decision_id, execution_token = register_confirm_decision(confirmed_trip, confidence)

return {
    "success": True,
    "action": action,
    "confidence": confidence,
    "message": message,
    "trip": trip,
    "decision_id": decision_id,
    "execution_token": execution_token,
}
```

Do not sign or return execution tokens from `/parse` or `update` actions.

- [ ] **Step 4: Run confirm-reply tests and verify GREEN**

```bash
cd backend
.venv/bin/python -m unittest app.api.routes.trip_confirmation_endpoint_test -v
```

Expected: confirm high confidence signs; low confidence downgrades; chat/update never sign.

- [ ] **Step 5: Commit if requested**

```bash
git add backend/app/api/routes/trip.py backend/app/api/routes/trip_confirmation_endpoint_test.py
git commit -m "feat(chat): let agent authorize plan execution"
```

---

### Task 3: `/plan` 一次性 token 强制校验

**Files:**
- Modify: `backend/app/models/schemas.py:16-37`
- Modify: `backend/app/api/routes/trip.py:746-800`
- Modify: `backend/app/api/routes/trip_confirmation_endpoint_test.py`

**Interfaces:**
- Consumes: `consume_execution_token(token, request)` from Task 1
- Produces: `TripRequest.execution_token: str`

- [ ] **Step 1: Write failing endpoint tests**

Use isolated `_TASKS_DATA_DIR`, patch `_persist_task_state`, and patch `asyncio.create_task` for every case:

```python
# no token -> HTTPException 400; no task; create_task not called
# forged token -> 400; no task
# valid token + mutated draft -> 400; no task
# valid token -> processing; exactly one task; create_task called once
# same token second call -> 409; task count unchanged; create_task not called again
```

- [ ] **Step 2: Run and verify RED**

```bash
cd backend
.venv/bin/python -m unittest app.api.routes.trip_confirmation_endpoint_test -v
```

Expected: old `confirmation_text/confirmation_token` fields or reusable token behavior fail assertions.

- [ ] **Step 3: Replace request and endpoint authorization**

In `TripRequest`:

```python
execution_token: Optional[str] = Field(default="", description="Agent 确认决策签发的一次性执行凭证")
```

Remove `confirmation_text` and `confirmation_token` from backend request schema.

At the first line of `plan_trip`, before generating task ID:

```python
accepted, reason = consume_execution_token(request.execution_token, request)
if not accepted:
    status_code = 409 if reason == "already_consumed" else 400
    detail = {
        "already_consumed": "该确认已执行，请勿重复提交",
        "expired": "确认已过期，请在对话中重新确认",
        "draft_mismatch": "行程草稿已变化，请重新确认",
    }.get(reason, "缺少有效的 Agent 确认凭证")
    raise HTTPException(status_code=status_code, detail=detail)
```

- [ ] **Step 4: Run endpoint tests and compile backend**

```bash
cd backend
.venv/bin/python -m unittest app.services.trip_confirmation_test app.api.routes.trip_confirmation_endpoint_test -v
.venv/bin/python -m compileall -q app
```

Expected: all pass; no compile output.

- [ ] **Step 5: Commit if requested**

```bash
git add backend/app/models/schemas.py backend/app/api/routes/trip.py backend/app/api/routes/trip_confirmation_endpoint_test.py
git commit -m "fix(api): require one-time agent execution token"
```

---

### Task 4: 前端待确认状态机改为 Agent-only 决策

**Files:**
- Delete: `frontend/src/utils/tripConfirmation.js`
- Delete: `frontend/src/utils/tripConfirmation.d.ts`
- Delete: `frontend/src/utils/tripConfirmation.test.mjs`
- Modify: `frontend/src/types/index.ts:92-104, 248-300`
- Modify: `frontend/src/services/api.ts:363-395`
- Modify: `frontend/src/views/ChatHome.vue:118-450`

**Interfaces:**
- Consumes: confirm-reply response `{ action, confidence, message, trip, decision_id, execution_token }`
- Produces: `TripFormData.execution_token: string`

- [ ] **Step 1: Add failing pure state reducer test**

Create `frontend/src/utils/confirmationState.js` and `confirmationState.test.mjs` desired interface:

```javascript
export function reduceConfirmationDecision(state, response) {
  // test desired behavior first
}
```

Tests:

```javascript
// chat -> {effect:'message', keepDraft:true}
// ask_confirmation -> message, keepDraft:true
// update+trip -> replaceDraft, no generate
// cancel -> clearDraft, no generate
// confirm without token -> error, keepDraft:true, no generate
// confirm with token -> generate exactly once payload
```

This reducer interprets structured agent actions only; it does not inspect user text.

- [ ] **Step 2: Run reducer tests and verify RED**

```bash
cd frontend
node --test src/utils/confirmationState.test.mjs
```

Expected: module/function missing.

- [ ] **Step 3: Implement reducer and update types**

Types:

```typescript
export type TripConfirmReplyAction = 'confirm' | 'cancel' | 'update' | 'chat' | 'ask_confirmation'
export interface TripConfirmReplyResponse {
  success: boolean
  action: TripConfirmReplyAction
  confidence: number
  message: string
  trip?: ParsedTripDraft | null
  decision_id?: string
  execution_token?: string
}
export interface TripFormData {
  // existing fields
  execution_token: string
}
```

Reducer returns deterministic effects and never reads natural-language text.

- [ ] **Step 4: Replace ChatHome pending flow**

Delete:

- `normalizeReply`
- `CANCEL_REPLIES`
- imports from `tripConfirmation.js`
- direct call to `onConfirmGenerate` before `/confirm-reply`

Every pending reply must execute:

```typescript
const res = await confirmTripReply(text, draft, getCurrentLocale(), history)
const effect = reduceConfirmationDecision({ draft, cardId }, res)
```

Handle effects:

```typescript
if (effect.type === 'generate') {
  removeItem(typingId)
  clearPendingConfirm()
  await onConfirmGenerate(effect.draft, effect.token)
}
// message / update / cancel / error branches do not generate
```

Change `onConfirmGenerate` signature:

```typescript
const onConfirmGenerate = async (draft: ParsedTripDraft, executionToken: string) => {
  const requestData: TripFormData = {
    ...,
    execution_token: executionToken,
  }
}
```

Remove `confirmation_text`, `confirmation_token`, and parse-stage draft token use.

- [ ] **Step 5: Run frontend tests, types, and build**

```bash
cd frontend
node --test src/utils/confirmationState.test.mjs
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/vite build
```

Expected: reducer tests pass; type check zero diagnostics; Vite success.

- [ ] **Step 6: Commit if requested**

```bash
git add -A frontend/src/utils frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/views/ChatHome.vue
git commit -m "refactor(chat): route confirmations through agent decisions"
```

---

### Task 5: 端到端确认状态回归验证

**Files:**
- Modify: `backend/app/api/routes/trip_confirmation_endpoint_test.py`
- Modify: `frontend/src/utils/confirmationState.test.mjs`
- Verify: `docs/superpowers/specs/2026-07-26-agent-contextual-plan-confirmation-design.md`

**Interfaces:**
- Consumes all prior interfaces
- Produces verified complete flow

- [ ] **Step 1: Add scenario matrix**

Backend mocked LLM scenarios:

```text
pending draft + “嗯” + history says assistant requested confirmation -> confirm .92 + token
pending draft + “嗯” + neutral history -> ask_confirmation .55 + no token
pending draft + “嗯？” -> ask_confirmation/chat + no token
pending draft + “有什么玩” -> chat + no token
pending draft + “改成5天” -> update + new draft + no token
```

Frontend reducer scenarios assert only first case produces `generate`.

- [ ] **Step 2: Run full verification**

```bash
cd backend
.venv/bin/python -m unittest app.services.trip_confirmation_test app.api.routes.trip_confirmation_endpoint_test -v
.venv/bin/python -m compileall -q app

cd ../frontend
node --test src/utils/confirmationState.test.mjs
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/vite build
```

Expected: all tests pass, no compile/type errors, Vite build success.

- [ ] **Step 3: Scan for forbidden/stale patterns**

```bash
command grep -rn "CONTEXTUAL_CONFIRMATIONS\|AFFIRM_REPLIES\|isTripConfirmationReply\|confirmation_text\|confirmation_token" backend/app frontend/src || true
command grep -rn "ready_to_generate" frontend/src/views/ChatHome.vue || true
command grep -rnE "TODO|TBD|test\.(skip|only)|describe\.(skip|only)|it\.(skip|only)" backend/app frontend/src || true
```

Expected: no fixed confirmation terms, old confirmation fields, readiness-triggered generation, placeholders, or skipped tests.

- [ ] **Step 4: Restart backend and health-check**

```bash
cd backend
pids=$(ps aux | command grep "uvicorn app.api.main" | command grep -v grep | tr -s ' ' | cut -d ' ' -f2)
if [ -n "$pids" ]; then kill $pids; fi
sleep 2
nohup .venv/bin/python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8000 > data/backend.log 2>&1 & disown
sleep 4
curl -s http://127.0.0.1:8000/api/trip/health
```

Expected: `{"status":"healthy", ...}`.

- [ ] **Step 5: Independent verification**

Dispatch `oh-my-claudecode:verifier` to inspect all generation call paths and run safe mocked endpoint tests. Required verdict: PASS, zero blockers.

- [ ] **Step 6: Commit if explicitly requested**

```bash
git add backend/app frontend/src docs/superpowers/specs/2026-07-26-agent-contextual-plan-confirmation-design.md docs/superpowers/plans/2026-07-26-agent-contextual-plan-confirmation.md
git commit -m "feat(chat): add agent-driven contextual plan confirmation"
```
