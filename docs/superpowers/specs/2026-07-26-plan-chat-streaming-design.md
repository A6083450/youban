# 新建计划对话——流式打字机 + 刷新整段恢复 设计

- 日期：2026-07-26
- 范围：**只针对新建计划对话（`ChatHome.vue`）里游伴的对话文字回复**（自然语言解析 / 推荐 / 追问 / 确认对话）。
- 不含：行程生成任务（`WorkProgress`）的推理流式——那条链路已是 WebSocket 进度流，本次不动。

## 目标

用户在新建计划对话里发消息后，游伴的回复要像 chat 一样**逐字实时流式打出来**（现在是"三个点 typing → 整段突然出现"）；并且**刷新页面后整段对话能续上**。

## 关键决策

1. **标准 SSE 流式请求**，不引入 WebSocket、不做多阶段协议。对话是短的请求-响应，SSE 最轻最正常；WebSocket 仍留给行程生成长任务。
2. **不改现有 prompt、不动现有非流式端点**。新增两个流式端点，LLM 输出仍是整坨 JSON；后端在流式过程中增量提取自然语言字段（`reply` / `message`）逐段推送。现有 `/parse`、`/confirm-reply` 原样保留，天然可回退。
3. **刷新恢复用 localStorage 快照 + 中途重发**，不把对话后台任务化（那是"半截续流"档，用户已明确不要）。

## 后端设计（`backend/app/api/routes/trip.py`）

### 新增两个 SSE 端点

- `POST /api/trip/parse/stream`　（对应现有 `/parse`）
- `POST /api/trip/confirm-reply/stream`　（对应现有 `/confirm-reply`）

请求体与现有非流式端点完全一致（`TripParseRequest` / `TripConfirmReplyRequest`）。返回 `StreamingResponse(media_type="text/event-stream")`。

### SSE 事件格式（每行 `data: <json>\n\n`）

| type | 载荷 | 含义 |
|---|---|---|
| `delta` | `{"type":"delta","text":"…"}` | 自然语言回复的**增量文本**（打字机内容） |
| `final` | `{"type":"final","payload":{…}}` | **完整结构化结果**，`payload` 与现有非流式响应 JSON 结构**逐字段一致**（`action`/`reply`/`recommendations`/`trip`/… 或 `action`/`message`/`trip`/`execution_token`/…） |
| `error` | `{"type":"error","message":"…"}` | 出错，前端回退到错误气泡 |

流正常结束后再发一行 `data: [DONE]\n\n` 并关闭。

### 复用而非复制

把现有 `parse_trip_text` / `confirm_trip_reply` 内部拆出可复用 helper，流式与非流式共用，避免两份 prompt 各自漂移：

- `_build_parse_prompt(payload, memory_block, …) -> str`（现 trip.py:399-457 那段）
- `_finalize_parse_response(data, …) -> dict`（现 trip.py:507-628 的 data→response 组装）
- confirm-reply 同理拆 `_build_confirm_prompt` / `_finalize_confirm_response`。

现有非流式端点改为调用这些 helper，**外部行为完全不变**。

### 流式处理主循环（每个流式端点内）

1. 构造 prompt（复用 helper）。
2. `client.chat.completions.create(..., stream=True)`（仍走 `asyncio.to_thread` 拿到迭代器，或用 `.create` 的同步迭代器在线程里逐块 `put` 到 `asyncio.Queue`）。
3. 逐 chunk 累积到 `buffer`，每次调用**增量字段提取器**取出自然语言字段的新增字符 → 发 `delta`。
4. 流结束：对完整 `buffer` 走现有正则 `\{[\s\S]*\}` + `json.loads` → 交给 `_finalize_*` helper → 发 `final`。
5. 保留现有副作用：parse 的 **mem0 后台记忆提取**（trip.py:497-505）在 final 后照常触发。

### 增量字段提取器（核心，`backend/app/agents/plan_parser.py` 或就近新增）

```
def stream_extract_string_field(buffer: str, field: str) -> tuple[str, bool]:
    """从（可能未闭合的）JSON 文本里取出 "field": "…" 的字符串值。
    返回 (已确定的值, 是否已闭合)。逐字符解析并还原 \n \" \\ \uXXXX 等转义。"""
```

- 定位 `"field"` 后冒号后的开引号，从其后逐字符解析 JSON 字符串，遇未转义 `"` 即闭合。
- 每次 chunk 后调用，emit `value[已发送长度:]`。
- 字段尚未出现时返回 `("", False)`，不 emit。
- 有独立单元测试覆盖：分块喂入、跨块转义、Unicode、字段在 JSON 中后置。

> 说明：LLM 未必先输出 `reply`，其前面的 `{"action":"…","emotion":"…"` 会先流过但不显示；`reply` 值开始后逐字显示。绝大多数情况 `reply` 靠前，体验上是"稍等一下 → 开始打字"。

## 前端设计

### 新增流式请求函数（`frontend/src/services/api.ts`）

`parseTripTextStream(...)` / `confirmTripReplyStream(...)`：用 `fetch`（需 POST body + `X-User-Id` 头，故不用 `EventSource`）+ `response.body.getReader()` + `TextDecoder`，按 `\n\n` 切 SSE 事件，回调：

```
{ onDelta(text), onFinal(payload), onError(msg) }
```

### `ChatHome.vue` 渲染改造

- 新增消息类型 `{ role:'assistant', type:'streaming', text:string }`（替代发起请求时的 `typing`）。
- `handleUserSend` / `handlePendingReply` 改调 `*Stream`：先 push 一个空的 `streaming` 气泡；`onDelta` 里把增量 append 到该气泡 `text`（Vue 响应式，自动逐字显现）；`onFinal` 到达后按现有 `action` 分支处理（转成 `text` 气泡 / 出 `confirm` 卡片 / 推荐等，逻辑复用现有 `formatAgentReply` 与确认编排）。
- 可选平滑：delta 再按字符节奏吐出，让打字更匀速（MVP 可省，先直接 append）。

### 刷新整段恢复（localStorage 快照 + 中途重发）

- 新增按用户命名空间的快照 key：`tripstar.chat_session.{user_id}`，存整段 `items`（含 `pendingConfirm` 状态）。
- 每轮对话状态变化后写快照；`onMounted` 时（在 `resumeActiveTask` 之外）读取快照恢复 `items`。
- **中途刷新那条**：发起流式前，快照里该轮记为"用户消息 + 未完成回复"。刷新恢复后若检测到末条是"未得到回复的用户消息"，**自动用同一文本重新发起一次流式**——用户看到那句话重新开始流式回复，达到"续上、显示完整结果"的体感。
  - 与"显示原样那一次的结果"的差异：因是重新生成，内容可能与被中断那次略有不同（`temperature=0.1`，实际很稳定）。这是为"别搞复杂 / 不后台任务化"付出的、可接受的代价。
- 行程生成任务的刷新恢复（`resumeActiveTask` + WebSocket 重连）保持不变，两套恢复并存、互不干扰。

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `backend/app/api/routes/trip.py` | 抽 helper；新增 `/parse/stream`、`/confirm-reply/stream` 两个 SSE 端点 |
| `backend/app/agents/plan_parser.py`（或就近） | 新增 `stream_extract_string_field` + 单测 |
| `frontend/src/services/api.ts` | 新增 `parseTripTextStream` / `confirmTripReplyStream` |
| `frontend/src/views/ChatHome.vue` | `streaming` 消息类型；改流式调用；localStorage 快照 + 刷新恢复 + 中途重发 |
| `frontend/src/types/index.ts` | `PanelMessage` / ChatItem 增加 `streaming` 类型（如需） |

## 验证

- 后端：`stream_extract_string_field` 单测（分块 / 转义 / Unicode / 字段后置）；用 `backend/.venv` 跑。
- 前端：`npx vite build` 通过（类型正确）。
- 手动：发消息看逐字流式；流式中途刷新 → 恢复整段并对末条自动重发续上；确认对话（"就去成都 4 天"）流式 + 出确认卡片正常；断网/错误 → 错误气泡。

## 明确不做（YAGNI）

- 不改行程生成任务的推理流式（用户已排除）。
- 不做对话跨设备/进历史列表的后端持久化（只要"刷新续上"，localStorage 足够）。
- 不做"半截流式续流"（后台任务化 + token 缓存），用户已明确不要。
- 不引入 WebSocket 到对话链路、不引入 SSE 库依赖（手写足够）。
