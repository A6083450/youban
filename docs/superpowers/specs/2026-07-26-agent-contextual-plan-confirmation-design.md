# Agent 上下文旅行计划确认设计

## 背景

当前旅行对话存在两个相反风险：

1. 把 `ready_to_generate`（字段完整度）误当作用户授权，导致用户仅咨询“九寨沟有什么玩”时自动生成计划。
2. 为阻止误生成而使用固定确认词表后，待确认卡片下用户自然回复“嗯”无法执行，破坏对话体验。

最终目标不是继续扩充关键词，而是让 agent 结合完整上下文判断用户是否确认，并把模型判断转换为服务端可验证、不可篡改、不可重复使用的执行授权。

## 目标

- 用户是否确认生成，完全由 agent 结合最近对话、当前待确认草稿、最新回复和情绪进行推理。
- 前端不维护“嗯、好的、可以”等确认词表，也不自行解释自然语言语义。
- `ready_to_generate` 仅表示字段完整度，永远不能授权生成。
- agent 低置信度时继续自然对话确认，不直接生成。
- agent 高置信度判断 `confirm` 后，由后端签发一次性执行凭证。
- `/api/trip/plan` 仅接受有效执行凭证，防止前端误调用、接口绕过、草稿篡改和重复提交。

## 非目标

- 不改造旅行计划生成引擎、天气/酒店/景点搜索流程。
- 不增加确认按钮；确认仍通过下方聊天输入框完成。
- 不使用固定肯定词表作为确认决策兜底。
- 不让浏览器直接生成或验证服务端签名。

## 状态机

```text
对话探索
  ├─ recommend / chat / clarify → 继续自然对话
  └─ plan → 生成结构化草稿
                 ↓
           待确认草稿 pending
                 ↓ 用户任意自然语言回复
           Agent 确认决策中
        ├─ chat → 回答问题，保留原草稿
        ├─ update → 更新草稿，重新进入 pending
        ├─ cancel → 清除草稿
        ├─ ask_confirmation → 自然追问一句，保留草稿
        └─ confirm（高置信度）
                 ↓
        服务端签发一次性 execution_token
                 ↓
          POST /api/trip/plan
                 ↓
               生成中
```

## Agent 决策契约

`POST /api/trip/confirm-reply` 请求：

```json
{
  "text": "嗯",
  "draft": { "...": "当前待确认草稿" },
  "history": [
    { "role": "user", "content": "帮我安排一下吧" },
    { "role": "assistant", "content": "已展示大理 7 天草稿，请确认" }
  ],
  "language": "zh-CN",
  "today": "2026-07-26"
}
```

响应：

```json
{
  "success": true,
  "action": "confirm|update|cancel|chat|ask_confirmation",
  "confidence": 0.0,
  "message": "自然语言回复",
  "trip": null,
  "execution_token": null
}
```

规则：

- `confirm`：用户明确接受当前草稿并希望开始执行。
- `update`：用户要求修改日期、天数、偏好、交通、住宿、城市等，返回完整新草稿。
- `cancel`：用户明确不继续当前草稿。
- `chat`：用户在咨询、比较、表达感受或提出与是否执行无关的问题。
- `ask_confirmation`：意图可能是确认但不够确定，agent 用自然语言追问一次。
- 只有 `action=confirm` 且 `confidence >= 0.85` 时签发 `execution_token`。
- `confidence < 0.85` 的 `confirm` 强制降级为 `ask_confirmation`。
- “嗯”不是固定确认词；是否确认取决于历史中上一动作是否在请求确认、当前是否有待确认草稿以及本轮语气。
- “嗯？”、“可以先介绍一下吗”、“这里有什么玩”应根据语义落入 `chat` 或 `ask_confirmation`，不能签发 token。

## 执行凭证

### 内容绑定

`execution_token` 必须绑定：

- 当前草稿的规范化哈希：城市列表、日期、天数、交通、住宿、偏好；
- agent 本轮确认决策 ID；
- 过期时间；
- 随机 nonce；
- 服务端签名。

### 生命周期

- token 仅由 `/confirm-reply` 在高置信度 `confirm` 时签发。
- token 有效期 10 分钟。
- `/plan` 成功接收后立即标记为已消费，重复提交返回 409。
- 草稿任一业务字段发生变化，旧 token 校验失败。
- 服务端维护短期 token ledger（内存即可）；服务重启后 token 失效，前端收到失效提示后保留草稿并请 agent 重新确认。

### `/plan` 校验

`POST /api/trip/plan` 请求必须携带 `execution_token`，后端按顺序校验：

1. token 存在且签名正确；
2. 未过期；
3. 未消费；
4. token 中草稿哈希等于当前请求草稿哈希；
5. decision ID 存在于服务端 ledger 且对应高置信度 `confirm`。

任一失败均不得创建 task、落盘任务或启动后台生成。

## 前端行为

### 普通对话阶段

- `/parse` 返回 `plan + trip` 时始终展示确认卡片。
- 即使 `ready_to_generate=true` 也只表示卡片内容完整，不自动生成。

### 待确认阶段

- 用户的所有回复都调用 `/confirm-reply`，不设前端关键词快速通道。
- `chat`：显示 agent 回复，卡片继续保留。
- `ask_confirmation`：显示 agent 追问，卡片继续保留。
- `update`：用返回的新草稿替换卡片；清除任何旧 token。
- `cancel`：移除待确认状态。
- `confirm`：必须同时收到 `execution_token`；随后调用 `/plan`。
- `confirm` 但无 token：视为服务端异常，不调用 `/plan`，显示重试提示。

## 错误处理

- `/confirm-reply` 超时或失败：保留草稿，提示用户可重试，不自动生成。
- agent 输出非法 action：后端降级为 `ask_confirmation`。
- agent 输出 `confirm` 但低置信度：后端降级为 `ask_confirmation`。
- `/plan` token 过期：返回 401/409；前端保留草稿并让 agent 重新确认。
- `/plan` token 与草稿不匹配：返回 400，不创建任务。
- token 已消费：返回 409，前端不重复创建任务。

## 需要撤销的临时代码

实施时删除或替换以下尚未形成最终设计的机制：

- 前端 `CONTEXTUAL_CONFIRMATIONS` 与 `isTripConfirmationReply(text, hasPendingDraft)` 固定词表判断。
- 后端同名固定词表判断。
- `/parse` 阶段签发的 `confirmation_token`；草稿展示不应自带执行授权。
- `/plan` 通过确认文本 + 草稿 token 推断授权的方式。
- 任何不经过 `/confirm-reply` agent 决策就直接调用 `onConfirmGenerate` 的路径。

保留并复用：

- 草稿规范化与字段绑定思路；
- `/plan` 在创建任务前强制校验授权的安全边界；
- 对话历史传输；
- `ready_to_generate` 不自动执行的约束。

## 测试策略

### Agent 决策测试（mock LLM 输出）

- 待确认卡片 + “嗯” + 上一条明确请求确认 → 高置信度 `confirm`，签发 token。
- 普通聊天中的“嗯” → `chat`，不签发 token。
- 待确认卡片 + “嗯？” → `ask_confirmation` 或 `chat`，不签发 token。
- 待确认卡片 + “九寨沟有什么玩” → `chat`，不签发 token。
- 待确认卡片 + “改成 5 天” → `update`，返回新草稿且旧 token 无效。
- 重复催促时 agent 结合情绪直接回应，但不得改变确认安全门槛。

### API 授权测试

- 缺 token、伪造 token、过期 token、已消费 token、草稿不匹配 token 均不得创建任务。
- 有效 token 只允许创建一个任务。
- `/plan` 拒绝时 `_tasks`、任务文件和后台协程均无变化。

### 前端状态机测试

- 所有待确认回复都进入 `/confirm-reply`。
- `chat/update/cancel/ask_confirmation` 都不调用 `generateTripPlan`。
- 仅 `confirm + execution_token` 调用一次 `generateTripPlan`。
- `ready_to_generate=true` 仍展示确认卡片。

## 成功标准

- 截图场景中，卡片后的“嗯”由 agent 根据上下文判定为确认并开始生成。
- 同样的“嗯”在没有确认卡片的普通对话中不生成。
- 目的地咨询和疑问句不生成。
- 前端没有确认关键词白名单。
- 无法通过直接调用 `/plan` 绕过 agent 决策。
- token 不可篡改、不可复用、过期后安全失败。
