# Agent 式对话体验重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建计划页改为 ChatGPT 式对话流;详情页卡片全面优化;新增右侧 Agent 聊天面板,支持自然语言直接修改计划。

**Architecture:** 后端新增 `/api/chat/edit`(LLM 返回 `{reply, updated_plan, changes}`,updated_plan 为完整计划 JSON);前端新增 `PlanChatPanel` 组件(快照 + 撤销),`Result.vue` 提供 `applyAgentPlan` 应用更新并重算预算/刷新地图图谱;`ChatHome` 重构为消息模型驱动的对话流,`PlanComposer` 退化为纯输入框,确认卡片抽为 `TripDraftConfirmCard`。

**Tech Stack:** Vue 3 + TypeScript + ant-design-vue + vue-i18n(zh/en/ja);FastAPI + httpx(OpenAI 兼容 Chat Completions)。

**Spec:** `docs/superpowers/specs/2026-07-25-agent-chat-redesign-design.md`

## Global Constraints

- 项目**没有单元测试基础设施**(前端仅 `npm run build` = vue-tsc + vite build;后端无 pytest)。每个任务的验证 = 类型检查/编译通过 + 文中给出的运行时验证命令。
- 主题色不变:`#D97757` / `#C4603D`;文本 `#3D3229` / `#6B5D52`。
- 所有新增用户可见文案必须同时加到 `frontend/src/i18n/locales/zh.json`、`en.json`、`ja.json` 三个文件(嵌套结构对齐)。
- 不删除后端 `/api/chat/ask`;前端不再调用它。
- 后端从 `backend/` 目录启动:`cd backend && .venv/bin/uvicorn app.api.main:app --port 8000`;前端 `cd frontend && npm run dev`。
- 提交信息使用中文 conventional commits(如 `feat: ...`),与仓库历史一致。

---

### Task 1: 后端 `/api/chat/edit` 接口

**Files:**
- Modify: `backend/app/models/schemas.py`(在 `TripChatResponse` 之后追加)
- Modify: `backend/app/services/chat_service.py`
- Modify: `backend/app/api/routes/chat.py`

**Interfaces:**
- Consumes: 现有 `TripChatRequest { message: str, trip_plan: dict, history: List[ChatMessage] }`(schemas.py:278)
- Produces:
  - `TripChatEditResponse { success: bool, reply: str, updated_plan: Optional[dict], changes: List[str] }`
  - `chat_edit_trip(message: str, trip_plan_dict: Dict[str, Any], history: Optional[List[Dict[str, str]]]) -> Dict[str, Any]`,返回 `{"reply": str, "updated_plan": dict | None, "changes": list[str]}`
  - 端点 `POST /api/chat/edit`

- [ ] **Step 1: schemas.py 追加响应模型**

在 `backend/app/models/schemas.py` 末尾(`TripChatResponse` 之后)追加:

```python
class TripChatEditResponse(BaseModel):
    """行程问答/修改响应"""
    success: bool = Field(default=True, description="是否成功")
    reply: str = Field(..., description="AI回复内容")
    updated_plan: Optional[dict] = Field(default=None, description="更新后的完整旅行计划(仅当AI执行了修改)")
    changes: List[str] = Field(default=[], description="本次修改内容清单")
```

- [ ] **Step 2: chat_service.py 新增 edit 服务**

在 `backend/app/services/chat_service.py` 末尾追加:

```python
# ============ 行程修改 (Agent) ============
EDIT_SYSTEM_PROMPT = """你是专业且贴心的私人旅行管家「游伴AI」,同时承担【行程问答】和【行程修改】两项职责。

你必须始终返回一个严格的 JSON 对象,不要输出 JSON 以外的任何内容:
{
  "reply": "给用户的自然语言回复,中文,亲切简洁,可适当使用 emoji",
  "updated_plan": null 或 完整更新后的旅行计划 JSON 对象,
  "changes": ["变更点1", "变更点2"]
}

行为规则:
1. 用户只是在【提问/咨询】(票价、天气、适不适合、建议等)时:updated_plan 必须为 null,changes 为 [],只在 reply 中回答(200字以内;行程中未提供的信息需说明"行程中未提供该信息,以下是建议")。
2. 用户要求【修改行程】(替换/删除/增加景点、换酒店、调整餐饮、修改描述、调整费用等)时:
   - 基于【当前旅行计划】JSON 生成修改后的完整计划,放入 updated_plan。
   - 必须保持原有 JSON schema 与所有未涉及字段完全不变。
   - 不得修改 city、cities、start_date、end_date、weather_info。
   - 只允许调整 days 内的 attractions、hotel、meals、description、transportation、accommodation,以及 overall_suggestions。
   - 不要增删 days 数组元素;每天 attractions 至少保留 1 个。
   - 涉及费用时用合理估值填写 ticket_price / estimated_cost(数字);budget 字段保持原样即可(前端会自动重算)。
   - changes 用简短中文逐条列出实际改动(如"已将第2天的钟楼替换为碑林博物馆");无实际改动则为 []。
   - reply 简要说明改了什么。
3. 修改要求无法满足时(如超出天数范围):updated_plan 为 null,changes 为 [],在 reply 中解释原因并给出替代建议。"""


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """从 LLM 输出中提取 JSON 对象,容忍前后多余文本。"""
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, TypeError):
        pass
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


def _validate_updated_plan(plan: Any, original: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """校验 LLM 返回的 updated_plan 基本结构,并强制还原不允许修改的结构性字段。"""
    if not isinstance(plan, dict):
        return None
    days = plan.get('days')
    original_days = original.get('days', [])
    if not isinstance(days, list) or len(days) != len(original_days):
        return None
    for day in days:
        if not isinstance(day, dict):
            return None
        attractions = day.get('attractions')
        if not isinstance(attractions, list) or len(attractions) < 1:
            return None
    # 强制还原不允许修改的结构性字段
    for key in ('city', 'cities', 'start_date', 'end_date', 'weather_info'):
        if key in original:
            plan[key] = original[key]
    return plan


async def chat_edit_trip(
    message: str,
    trip_plan_dict: Dict[str, Any],
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Agent 式行程对话:LLM 同时承担问答与修改。
    返回 {"reply": str, "updated_plan": dict | None, "changes": list[str]}
    """
    llm_config = _get_llm_runtime_config()
    if not llm_config["api_key"]:
        return {
            "reply": "抱歉,AI 服务尚未配置 API Key,请先在设置页面中完成配置。",
            "updated_plan": None,
            "changes": [],
        }

    messages = [
        {"role": "system", "content": EDIT_SYSTEM_PROMPT},
        {"role": "user", "content": _build_context_message(trip_plan_dict)},
    ]
    if history:
        for item in history:
            messages.append({
                "role": item.get("role", "user"),
                "content": item.get("content", ""),
            })
    messages.append({"role": "user", "content": message})

    url = f"{llm_config['base_url']}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {llm_config['api_key']}",
    }
    payload = {
        "model": llm_config["model_id"],
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 8192,
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=llm_config["timeout"]) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            raw = data["choices"][0]["message"]["content"].strip()
    except httpx.HTTPStatusError as e:
        print(f"❌ LLM API 返回错误: {e.response.status_code} - {e.response.text}")
        # 部分模型不支持 response_format,降级重试一次
        if e.response.status_code == 400:
            payload.pop("response_format", None)
            try:
                async with httpx.AsyncClient(timeout=llm_config["timeout"]) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    raw = response.json()["choices"][0]["message"]["content"].strip()
            except Exception as e2:
                print(f"❌ 降级重试失败: {e2}")
                return {"reply": "抱歉,AI 服务暂时出现问题,请稍后重试 🙏", "updated_plan": None, "changes": []}
        else:
            return {"reply": f"抱歉,AI 服务暂时出现问题 (HTTP {e.response.status_code}),请稍后重试 🙏", "updated_plan": None, "changes": []}
    except httpx.TimeoutException:
        return {"reply": "抱歉,AI 回复超时了,请稍后再试 ⏳", "updated_plan": None, "changes": []}
    except Exception as e:
        print(f"❌ LLM 调用异常: {e}")
        return {"reply": "抱歉,AI 出现了意外错误,请稍后重试 🙏", "updated_plan": None, "changes": []}

    parsed = _extract_json_object(raw)
    if not parsed:
        # LLM 未按格式返回:降级为纯文本回复,不应用任何修改
        return {"reply": raw, "updated_plan": None, "changes": []}

    reply = str(parsed.get("reply") or "").strip() or "好的。"
    changes_raw = parsed.get("changes")
    changes = [str(c) for c in changes_raw if str(c).strip()] if isinstance(changes_raw, list) else []
    updated_plan = _validate_updated_plan(parsed.get("updated_plan"), trip_plan_dict)
    if parsed.get("updated_plan") is not None and updated_plan is None:
        # LLM 试图修改但结构不合法:放弃修改,告知用户
        changes = []
        reply += "\n\n(这次修改没有生效,可能是改动范围太大,可以换个说法或分步告诉我 🙏)"

    return {"reply": reply, "updated_plan": updated_plan, "changes": changes}
```

- [ ] **Step 3: routes/chat.py 新增端点**

修改 `backend/app/api/routes/chat.py`:

- import 行改为:

```python
from ...models.schemas import TripChatRequest, TripChatResponse, TripChatEditResponse
from ...services.chat_service import chat_with_trip_context, chat_edit_trip
```

- 文件末尾追加:

```python
@router.post(
    "/edit",
    response_model=TripChatEditResponse,
    summary="行程智能问答/修改",
    description="Agent 式对话:回答问题,或按用户要求直接修改旅行计划"
)
async def edit_trip(request: TripChatRequest):
    try:
        print(f"\n✏️ 收到行程修改对话: {request.message[:50]}...")

        history = [{"role": m.role, "content": m.content} for m in (request.history or [])]
        result = await chat_edit_trip(
            message=request.message,
            trip_plan_dict=request.trip_plan,
            history=history,
        )

        print(f"✅ 回复: {result['reply'][:80]}... | 修改 {len(result['changes'])} 处")

        return TripChatEditResponse(
            success=True,
            reply=result["reply"],
            updated_plan=result["updated_plan"],
            changes=result["changes"],
        )

    except Exception as e:
        print(f"❌ 行程修改对话失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"AI修改服务异常: {str(e)}"
        )
```

- [ ] **Step 4: 编译检查**

Run: `cd backend && .venv/bin/python -m py_compile app/models/schemas.py app/services/chat_service.py app/api/routes/chat.py && echo OK`
Expected: 输出 `OK`

- [ ] **Step 5: 纯函数自测(不需要 LLM Key)**

Run:

```bash
cd backend && .venv/bin/python -c "
from app.services.chat_service import _extract_json_object, _validate_updated_plan
# JSON 提取:纯 JSON / 带杂质文本 / 非 JSON
assert _extract_json_object('{\"reply\": \"hi\", \"updated_plan\": null, \"changes\": []}')['reply'] == 'hi'
assert _extract_json_object('好的{\"reply\": \"hi\"}谢谢')['reply'] == 'hi'
assert _extract_json_object('没有JSON') is None
# 校验:天数不一致被拒;结构字段被还原
orig = {'city': '西安', 'start_date': '2026-08-01', 'days': [{'attractions': [{'name': 'A'}]}]}
bad = {'days': []}
assert _validate_updated_plan(bad, orig) is None
good = {'city': '北京', 'days': [{'attractions': [{'name': 'B'}]}]}
out = _validate_updated_plan(good, orig)
assert out['city'] == '西安' and out['days'][0]['attractions'][0]['name'] == 'B'
empty_attr = {'days': [{'attractions': []}]}
assert _validate_updated_plan(empty_attr, orig) is None
print('ALL PASS')
"
```

Expected: 输出 `ALL PASS`

- [ ] **Step 6: 端到端 curl(需 LLM Key 已配置)**

启动后端后执行:

```bash
curl -s -X POST http://localhost:8000/api/chat/edit \
  -H 'Content-Type: application/json' \
  -d '{"message": "第一天有哪些景点?", "trip_plan": {"city": "西安", "start_date": "2026-08-01", "end_date": "2026-08-02", "days": [{"date": "2026-08-01", "day_index": 0, "description": "古城游", "transportation": "公共交通", "accommodation": "舒适型酒店", "attractions": [{"name": "兵马俑", "address": "临潼区", "location": {"longitude": 109.27, "latitude": 34.38}, "visit_duration": 180, "description": "世界文化遗产"}], "meals": []}], "weather_info": [], "overall_suggestions": "注意防晒"}, "history": []}'
```

Expected: JSON 含 `success: true`、`reply` 提到兵马俑、`updated_plan: null`、`changes: []`。再用 `"message": "把第一天的兵马俑换成华清宫"` 重试,预期 `updated_plan` 非 null 且 `changes` 非空。
若未配置 Key,预期 `reply` 为配置提示文案(同样证明接口链路通)。

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/schemas.py backend/app/services/chat_service.py backend/app/api/routes/chat.py
git commit -m "feat: 新增 /api/chat/edit Agent 式行程问答与修改接口"
```

---

### Task 2: 前端基础 — 类型、API 封装、全局 CSS 变量、i18n 键

**Files:**
- Modify: `frontend/src/types/index.ts`(在 `TripChatResponse` 之后追加)
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/styles/global.css`(末尾追加)
- Modify: `frontend/src/i18n/locales/zh.json`、`en.json`、`ja.json`

**Interfaces:**
- Produces(后续任务依赖):
  - `TripChatEditResponse`、`PanelMessage` 类型
  - `chatEditPlan(message: string, tripPlan: TripPlan, history: ChatMessage[]): Promise<TripChatEditResponse>`
  - CSS 变量:`--chat-user-bubble`、`--chat-ai-bg`、`--chat-ai-border`、`--panel-width`、`--card-radius`、`--card-shadow`、`--card-shadow-hover`
  - i18n 命名空间 `result.agent.*`(zh 文案见下,en/ja 对应翻译)

- [ ] **Step 1: types/index.ts 追加类型**

在 `TripChatResponse` 定义之后追加:

```ts
export interface TripChatEditResponse {
  success: boolean
  reply: string
  updated_plan?: TripPlan | null
  changes: string[]
}

export type PanelMessage =
  | { role: 'user'; kind: 'text'; content: string }
  | { role: 'assistant'; kind: 'text'; content: string }
  | { role: 'assistant'; kind: 'typing' }
  | {
      role: 'assistant'
      kind: 'changes'
      content: string
      changes: string[]
      snapshotIndex: number
      undone?: boolean
    }
```

- [ ] **Step 2: services/api.ts 新增 chatEditPlan**

`import type { ... }` 列表中追加 `ChatMessage`、`TripChatEditResponse`、`TripPlan`(TripPlan 若未导入)。文件末尾(`export default apiClient` 之前)追加:

```ts
/**
 * Agent 式行程对话(问答 + 修改计划)
 */
export async function chatEditPlan(
  message: string,
  tripPlan: TripPlan,
  history: ChatMessage[]
): Promise<TripChatEditResponse> {
  try {
    const response = await apiClient.post<TripChatEditResponse>('/api/chat/edit', {
      message,
      trip_plan: tripPlan,
      history,
    })
    return response.data
  } catch (error: any) {
    console.error('行程修改对话失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.chatEditFailed'))
  }
}
```

- [ ] **Step 3: global.css 末尾追加设计变量**

```css
/* ===== Agent 对话体验设计变量 ===== */
:root {
  --chat-user-bubble: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  --chat-ai-bg: #ffffff;
  --chat-ai-border: rgba(100, 80, 60, 0.12);
  --panel-width: 400px;
  --card-radius: 16px;
  --card-shadow: 0 4px 16px rgba(100, 80, 60, 0.06);
  --card-shadow-hover: 0 8px 24px rgba(100, 80, 60, 0.12);
}

/* 消息进入动画(对话类组件共用) */
@keyframes chat-msg-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 4: i18n 三语言追加键**

zh.json 在 `result` 对象内追加 `agent` 命名空间;`api` 对象内追加 `chatEditFailed`:

```json
"agent": {
  "fabLabel": "✨ 修改计划",
  "title": "游伴 AI",
  "subtitle": "问我问题,或直接让我改行程",
  "welcome": "我是你的旅行管家,可以回答行程问题,也可以直接帮你修改计划,例如:",
  "quick1": "把第2天的某个景点换成别的",
  "quick2": "整体预算降低一点",
  "quick3": "第1天加一个美食景点",
  "placeholder": "输入修改要求或问题,Enter 发送…",
  "send": "发送",
  "changesTitle": "已为你修改:",
  "undo": "撤销",
  "undone": "已撤销",
  "replyFallback": "抱歉,这次没处理好,换个说法试试?",
  "networkError": "网络连接异常,请检查后端服务是否已启动",
  "typing": "正在思考"
}
```

```json
"chatEditFailed": "行程修改对话失败,请稍后重试"
```

en.json 对应:

```json
"agent": {
  "fabLabel": "✨ Edit plan",
  "title": "Youban AI",
  "subtitle": "Ask me anything, or let me edit the trip",
  "welcome": "I'm your travel concierge. Ask about the trip, or let me edit the plan directly, e.g.:",
  "quick1": "Swap an attraction on day 2",
  "quick2": "Lower the overall budget a bit",
  "quick3": "Add a food spot to day 1",
  "placeholder": "Type an edit or question, Enter to send…",
  "send": "Send",
  "changesTitle": "Changes applied:",
  "undo": "Undo",
  "undone": "Undone",
  "replyFallback": "Sorry, I couldn't handle that. Try rephrasing?",
  "networkError": "Network error. Is the backend running?",
  "typing": "Thinking"
}
```

```json
"chatEditFailed": "Trip edit conversation failed, please retry"
```

ja.json 对应:

```json
"agent": {
  "fabLabel": "✨ プランを編集",
  "title": "Youban AI",
  "subtitle": "質問も、プランの直接編集もできます",
  "welcome": "旅行コンシェルジュです。質問への回答や、プランの直接編集ができます。例:",
  "quick1": "2日目の観光地を別の場所に変えて",
  "quick2": "全体の予算を少し下げて",
  "quick3": "1日目にグルメスポットを追加して",
  "placeholder": "変更や質問を入力、Enter で送信…",
  "send": "送信",
  "changesTitle": "変更を適用しました:",
  "undo": "元に戻す",
  "undone": "取り消し済み",
  "replyFallback": "うまく処理できませんでした。言い換えてみてください",
  "networkError": "ネットワークエラー。バックエンドを確認してください",
  "typing": "考え中"
}
```

```json
"chatEditFailed": "プラン編集の会話に失敗しました。再試行してください"
```

同时给 zh/en/ja 的 `result` 追加 Task 4 需要的键:

```json
"reservationRequired": "需提前预约",
"expand": "展开",
"collapse": "收起",
"attractionCount": "{count} 个景点"
```

en: `"reservationRequired": "Reservation required"`, `"expand": "More"`, `"collapse": "Less"`, `"attractionCount": "{count} spots"`
ja: `"reservationRequired": "要事前予約"`, `"expand": "もっと見る"`, `"collapse": "閉じる"`, `"attractionCount": "{count} か所"`

- [ ] **Step 5: 类型检查**

Run: `cd frontend && npm run build`
Expected: 构建成功(此任务未改动组件,仅验证类型与 i18n JSON 语法)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/styles/global.css frontend/src/i18n/locales/
git commit -m "feat: Agent 对话前端基础(类型、API、设计变量、i18n)"
```

---

### Task 3: PlanChatPanel 组件 + Result.vue 接入(替换 AIChat)

**Files:**
- Create: `frontend/src/components/PlanChatPanel.vue`
- Modify: `frontend/src/views/Result.vue`(模板末尾 + script)
- Delete: `frontend/src/components/AIChat.vue`

**Interfaces:**
- Consumes: `chatEditPlan`(Task 2)、`PanelMessage`/`TripPlan` 类型、i18n `result.agent.*`
- Produces:
  - `PlanChatPanel` props: `{ tripPlan: TripPlan | null }`;emits: `(e: 'apply-plan', plan: TripPlan)`、`(e: 'restore-plan', plan: TripPlan)`
  - `Result.vue` 新增 `applyAgentPlan(plan: TripPlan): Promise<void>` — 设置 tripPlan、重算预算、写 sessionStorage、刷新当前激活区块(地图/图谱/swiper)

- [ ] **Step 1: 创建 PlanChatPanel.vue**

```vue
<template>
  <div class="agent-panel-root">
    <!-- 收起态:悬浮按钮 -->
    <button
      v-if="!panelOpen"
      type="button"
      class="agent-fab"
      @click="panelOpen = true"
    >
      {{ t('result.agent.fabLabel') }}
    </button>

    <!-- 展开态:右侧面板 -->
    <transition name="agent-slide">
      <aside v-if="panelOpen" class="agent-panel">
        <header class="agent-header">
          <div class="agent-header-text">
            <div class="agent-title">{{ t('result.agent.title') }}</div>
            <div class="agent-subtitle">{{ t('result.agent.subtitle') }}</div>
          </div>
          <button type="button" class="agent-close" @click="panelOpen = false">×</button>
        </header>

        <div class="agent-messages" ref="messagesRef">
          <div v-if="messages.length === 0" class="agent-empty">
            <p>{{ t('result.agent.welcome') }}</p>
            <div class="agent-quick">
              <button
                v-for="key in ['quick1', 'quick2', 'quick3']"
                :key="key"
                type="button"
                class="agent-quick-chip"
                :disabled="loading || !tripPlan"
                @click="sendQuick(t(`result.agent.${key}`))"
              >
                {{ t(`result.agent.${key}`) }}
              </button>
            </div>
          </div>

          <template v-for="(msg, idx) in messages" :key="idx">
            <!-- 用户消息 -->
            <div v-if="msg.role === 'user'" class="agent-row user">
              <div class="agent-bubble user">{{ msg.content }}</div>
            </div>
            <!-- typing -->
            <div v-else-if="msg.kind === 'typing'" class="agent-row assistant">
              <div class="agent-bubble assistant typing">
                <span class="agent-dot"></span>
                <span class="agent-dot"></span>
                <span class="agent-dot"></span>
              </div>
            </div>
            <!-- 文本回复 -->
            <div v-else-if="msg.kind === 'text'" class="agent-row assistant">
              <div class="agent-bubble assistant">{{ msg.content }}</div>
            </div>
            <!-- 修改摘要卡 -->
            <div v-else class="agent-row assistant">
              <div class="agent-bubble assistant">{{ msg.content }}</div>
              <div v-if="msg.changes.length" class="agent-changes-card">
                <div class="agent-changes-title">{{ t('result.agent.changesTitle') }}</div>
                <ul class="agent-changes-list">
                  <li v-for="(c, ci) in msg.changes" :key="ci">{{ c }}</li>
                </ul>
                <button
                  type="button"
                  class="agent-undo-btn"
                  :disabled="msg.undone"
                  @click="undoChange(msg)"
                >
                  {{ msg.undone ? t('result.agent.undone') : t('result.agent.undo') }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <div class="agent-input-area">
          <textarea
            v-model="input"
            class="agent-textarea"
            :placeholder="t('result.agent.placeholder')"
            :disabled="loading || !tripPlan"
            rows="2"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <button
            type="button"
            class="agent-send"
            :disabled="!input.trim() || loading || !tripPlan"
            :aria-label="t('result.agent.send')"
            @click="send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </aside>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { chatEditPlan } from '@/services/api'
import type { ChatMessage, PanelMessage, TripPlan } from '@/types'

const props = defineProps<{ tripPlan: TripPlan | null }>()
const emit = defineEmits<{
  (e: 'apply-plan', plan: TripPlan): void
  (e: 'restore-plan', plan: TripPlan): void
}>()

const { t } = useI18n()
const panelOpen = ref(false)
const input = ref('')
const loading = ref(false)
const messages = ref<PanelMessage[]>([])
const snapshots = ref<TripPlan[]>([])
const messagesRef = ref<HTMLElement | null>(null)

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

watch(panelOpen, (open) => {
  if (open) scrollToBottom()
})

const sendQuick = (text: string) => {
  input.value = text
  void send()
}

const send = async () => {
  const text = input.value.trim()
  if (!text || loading.value || !props.tripPlan) return

  messages.value.push({ role: 'user', kind: 'text', content: text })
  input.value = ''
  loading.value = true
  messages.value.push({ role: 'assistant', kind: 'typing' })
  scrollToBottom()

  try {
    const history: ChatMessage[] = messages.value
      .filter((m): m is Extract<PanelMessage, { kind: 'text' }> => m.kind === 'text')
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }))

    const res = await chatEditPlan(text, props.tripPlan, history)
    messages.value.pop() // 移除 typing

    if (res.updated_plan) {
      const snapshotIndex = snapshots.value.length
      snapshots.value.push(JSON.parse(JSON.stringify(props.tripPlan)))
      emit('apply-plan', res.updated_plan)
      messages.value.push({
        role: 'assistant',
        kind: 'changes',
        content: res.reply,
        changes: res.changes ?? [],
        snapshotIndex,
      })
    } else {
      messages.value.push({
        role: 'assistant',
        kind: 'text',
        content: res.reply || t('result.agent.replyFallback'),
      })
    }
  } catch (err) {
    console.error('Agent chat error:', err)
    messages.value.pop()
    messages.value.push({ role: 'assistant', kind: 'text', content: t('result.agent.networkError') })
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

const undoChange = (msg: Extract<PanelMessage, { kind: 'changes' }>) => {
  if (msg.undone) return
  const snapshot = snapshots.value[msg.snapshotIndex]
  if (!snapshot) return
  emit('restore-plan', snapshot)
  msg.undone = true
}
</script>

<style scoped>
.agent-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1000;
  border: none;
  border-radius: 999px;
  padding: 12px 22px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--chat-user-bubble);
  box-shadow: 0 6px 20px rgba(217, 119, 87, 0.4);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.agent-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(217, 119, 87, 0.5);
}

.agent-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: var(--panel-width);
  max-width: 100vw;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  background: #FAF7F2;
  border-left: 1px solid var(--chat-ai-border);
  box-shadow: -8px 0 32px rgba(61, 50, 41, 0.12);
}

.agent-slide-enter-active,
.agent-slide-leave-active {
  transition: transform 0.3s ease-out, opacity 0.3s ease-out;
}

.agent-slide-enter-from,
.agent-slide-leave-to {
  transform: translateX(40px);
  opacity: 0;
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--chat-ai-border);
  background: #fff;
}

.agent-title {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
}

.agent-subtitle {
  font-size: 12px;
  color: #A89888;
  margin-top: 2px;
}

.agent-close {
  border: none;
  background: rgba(61, 50, 41, 0.06);
  color: #6B5D52;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-close:hover {
  background: rgba(217, 119, 87, 0.15);
  color: #D97757;
}

.agent-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-empty {
  color: #6B5D52;
  font-size: 13px;
  line-height: 1.6;
}

.agent-quick {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.agent-quick-chip {
  border: 1px solid rgba(217, 119, 87, 0.3);
  background: rgba(217, 119, 87, 0.06);
  color: #C4603D;
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-quick-chip:hover:not(:disabled) {
  background: rgba(217, 119, 87, 0.14);
}

.agent-quick-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.agent-row {
  display: flex;
  animation: chat-msg-in 0.25s ease;
}

.agent-row.user {
  justify-content: flex-end;
}

.agent-row.assistant {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.agent-bubble {
  max-width: 88%;
  border-radius: 14px;
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-bubble.user {
  background: var(--chat-user-bubble);
  color: #fff;
  border-radius: 14px 14px 4px 14px;
}

.agent-bubble.assistant {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  color: #3D3229;
  border-radius: 14px 14px 14px 4px;
}

.agent-bubble.typing {
  display: inline-flex;
  gap: 5px;
  padding: 12px 16px;
}

.agent-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #D97757;
  animation: agent-dot-pulse 1.2s infinite ease-in-out both;
}

.agent-dot:nth-child(2) { animation-delay: 0.15s; }
.agent-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes agent-dot-pulse {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.agent-changes-card {
  width: 88%;
  background: rgba(217, 119, 87, 0.06);
  border: 1px solid rgba(217, 119, 87, 0.22);
  border-radius: 12px;
  padding: 10px 14px;
}

.agent-changes-title {
  font-size: 12px;
  font-weight: 700;
  color: #C4603D;
  margin-bottom: 6px;
}

.agent-changes-list {
  margin: 0 0 8px;
  padding-left: 16px;
  font-size: 12.5px;
  color: #3D3229;
  line-height: 1.7;
}

.agent-undo-btn {
  border: 1px solid rgba(100, 80, 60, 0.2);
  background: #fff;
  color: #6B5D52;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-undo-btn:hover:not(:disabled) {
  border-color: #D97757;
  color: #C4603D;
}

.agent-undo-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--chat-ai-border);
  background: #fff;
}

.agent-textarea {
  flex: 1;
  border: 1px solid var(--chat-ai-border);
  border-radius: 12px;
  padding: 9px 12px;
  font-family: inherit;
  font-size: 13.5px;
  color: #3D3229;
  resize: none;
  outline: none;
  line-height: 1.5;
  transition: border-color 0.15s ease;
}

.agent-textarea:focus {
  border-color: #D97757;
}

.agent-textarea::placeholder {
  color: #B8A99A;
}

.agent-send {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--chat-user-bubble);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s ease;
}

.agent-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .agent-panel {
    width: 100vw;
    border-left: none;
  }
}
</style>
```

- [ ] **Step 2: Result.vue 接入 PlanChatPanel**

模板末尾,将:

```html
    <AIChat :trip-plan="tripPlan" />
```

替换为:

```html
    <PlanChatPanel
      :trip-plan="tripPlan"
      @apply-plan="applyAgentPlan"
      @restore-plan="applyAgentPlan"
    />
```

script 中,import 行:

```ts
import AIChat from '@/components/AIChat.vue'
```

替换为:

```ts
import PlanChatPanel from '@/components/PlanChatPanel.vue'
```

并在 `applyTripPlanPayload` 定义之后新增:

```ts
// Agent 对话修改计划:应用新计划并重算预算、刷新当前区块
const applyAgentPlan = async (plan: TripPlan) => {
  await applyTripPlanPayload({
    plan,
    graph: graphData.value,
    planId: planId.value,
  })
  recalculateBudgetTotals()
  if (tripPlan.value) {
    sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))
  }
  message.success(t('result.agent.changesTitle'))
}
```

注意:`applyAgentPlan` 中调用的 `recalculateBudgetTotals` 在文件中定义于其后(`Result.vue:1463`),`<script setup>` 顶层 const 函数在运行时被调用时已完成初始化,无需移动位置。

- [ ] **Step 3: 删除 AIChat.vue 并检查残留引用**

```bash
rm frontend/src/components/AIChat.vue
/usr/bin/grep -rn "AIChat" frontend/src/ || echo "NO REFERENCE"
```

Expected: 输出 `NO REFERENCE`

- [ ] **Step 4: 类型检查**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 5: 运行时验证(浏览器)**

后端与前端 dev server 启动后,打开任一计划详情页 `/plan/:id`:
1. 右下角出现「✨ 修改计划」悬浮按钮;点击滑出右侧面板,空态显示欢迎语 + 3 个快捷指令。
2. 发送「第1天有哪些景点?」→ 只有文本回复,计划不变。
3. 发送「把第1天的某个景点换成别的」→ 出现修改摘要卡,天数区块/预算相应更新;点「撤销」→ 计划还原,按钮变「已撤销」。
4. 缩窄窗口 <768px,面板全屏。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PlanChatPanel.vue frontend/src/views/Result.vue frontend/src/components/AIChat.vue
git commit -m "feat: 详情页右侧 Agent 聊天面板,支持自然语言修改计划并撤销"
```

---

### Task 4: Result.vue 天数区块卡片重设计

**Files:**
- Modify: `frontend/src/views/Result.vue`(days 区块模板 `Result.vue:243-393`、script 新增辅助函数、样式区)

**Interfaces:**
- Consumes: i18n `result.reservationRequired` / `result.expand` / `result.collapse` / `result.attractionCount`(Task 2 已加)、`getMealLabel`(Result.vue:1426)
- Produces: `mealIcon(type: string): string`、`isDescExpanded(key: string): boolean`、`toggleDesc(key: string): void`(仅文件内使用)

- [ ] **Step 1: script 新增辅助函数**

在 `getMealLabel` 定义之后新增:

```ts
// 餐次图标
const mealIcon = (type: string): string => {
  const icons: Record<string, string> = {
    breakfast: '🍳',
    lunch: '🍜',
    dinner: '🌙',
    snack: '🍡',
  }
  return icons[type] || '🍽️'
}

// 景点描述展开/收起
const expandedDescs = ref<Set<string>>(new Set())

const isDescExpanded = (key: string): boolean => expandedDescs.value.has(key)

const toggleDesc = (key: string) => {
  const next = new Set(expandedDescs.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedDescs.value = next
}
```

- [ ] **Step 2: 替换 day-header(Result.vue:251-258)**

将 `<template #header>` 内的 `<div class="day-header">` 替换为:

```html
                <div class="day-header">
                  <span class="day-title">{{ t('common.dayNumber', { day: index + 1 }) }}</span>
                  <span v-if="day.city" class="day-city-tag">{{ day.city }}</span>
                  <span v-if="day.is_transfer_day" class="day-transfer-tag">{{ t('result.transferDay') }}</span>
                  <span class="day-attr-count">{{ t('result.attractionCount', { count: day.attractions.length }) }}</span>
                  <span class="day-date">{{ day.date }}</span>
                </div>
```

- [ ] **Step 3: 替换景点列表(Result.vue:284-362)**

将 `<!-- 景点安排 -->` 下的 `<a-divider ...>` 与整个 `<a-list ...>...</a-list>` 替换为:

```html
              <!-- 景点安排:时间轴卡片 -->
              <a-divider orientation="left">{{ t('result.attractionTitle') }}</a-divider>
              <div class="attr-timeline-list">
                <div
                  v-for="(item, index) in day.attractions"
                  :key="`${day.day_index}-${index}-${item.name}`"
                  class="attr-card"
                >
                  <div class="attr-order-dot">{{ index + 1 }}</div>

                  <div class="attr-image-wrapper">
                    <img
                      :src="item.image_url || getAttractionImage(item.name, index)"
                      :alt="item.name"
                      class="attr-image"
                      @error="handleImageError"
                    />
                    <div class="attr-img-badges">
                      <span v-if="item.rating" class="attr-badge attr-badge--rating">⭐ {{ item.rating }}</span>
                      <span v-if="item.ticket_price" class="attr-badge attr-badge--price">¥{{ item.ticket_price }}</span>
                    </div>
                  </div>

                  <div class="attr-info">
                    <div class="attr-head">
                      <h4 class="attr-name">{{ item.name }}</h4>
                      <div v-if="editMode" class="attr-actions">
                        <button
                          type="button"
                          class="attr-action-btn"
                          :disabled="index === 0"
                          :title="t('result.moveUp')"
                          @click="moveAttraction(day.day_index, index, 'up')"
                        >↑</button>
                        <button
                          type="button"
                          class="attr-action-btn"
                          :disabled="index === day.attractions.length - 1"
                          :title="t('result.moveDown')"
                          @click="moveAttraction(day.day_index, index, 'down')"
                        >↓</button>
                        <button
                          type="button"
                          class="attr-action-btn attr-action-btn--danger"
                          :title="t('common.delete')"
                          @click="deleteAttraction(day.day_index, index)"
                        >✕</button>
                      </div>
                    </div>

                    <!-- 编辑模式字段 -->
                    <template v-if="editMode">
                      <p class="attr-field-label"><strong>{{ t('result.fieldAddress') }}</strong></p>
                      <a-input v-model:value="item.address" size="small" style="margin-bottom: 8px" />
                      <p class="attr-field-label"><strong>{{ t('result.fieldVisitDurationMinutes') }}</strong></p>
                      <a-input-number v-model:value="item.visit_duration" :min="10" :max="480" size="small" style="width: 100%; margin-bottom: 8px" />
                      <p class="attr-field-label"><strong>{{ t('result.fieldDescription') }}</strong></p>
                      <a-textarea v-model:value="item.description" :rows="2" size="small" style="margin-bottom: 8px" />
                    </template>

                    <!-- 查看模式 -->
                    <template v-else>
                      <div class="attr-meta">
                        <span class="attr-meta-addr" :title="item.address">📍 {{ item.address }}</span>
                        <span class="attr-chip">⏱ {{ item.visit_duration }}{{ t('result.minuteUnit') }}</span>
                      </div>
                      <p
                        class="attr-desc"
                        :class="{ expanded: isDescExpanded(`${day.day_index}-${index}`) }"
                      >{{ item.description }}</p>
                      <button
                        v-if="item.description && item.description.length > 60"
                        type="button"
                        class="attr-desc-toggle"
                        @click="toggleDesc(`${day.day_index}-${index}`)"
                      >
                        {{ isDescExpanded(`${day.day_index}-${index}`) ? t('result.collapse') : t('result.expand') }}
                      </button>
                      <div v-if="item.reservation_required" class="attr-reservation">
                        <span class="attr-reservation-label">📋 {{ t('result.reservationRequired') }}</span>
                        <span v-if="item.reservation_tips" class="attr-reservation-tips">{{ item.reservation_tips }}</span>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
```

- [ ] **Step 4: 替换酒店卡(Result.vue:364-377)**

将 `<!-- 酒店推荐 -->` 下的 `<a-divider>` 与 `<a-card v-if="day.hotel" ...>...</a-card>` 替换为:

```html
              <!-- 酒店推荐 -->
              <a-divider v-if="day.hotel" orientation="left">{{ t('result.hotelTitle') }}</a-divider>
              <div v-if="day.hotel" class="hotel-info-card">
                <div class="hotel-info-head">
                  <span class="hotel-info-icon">🏨</span>
                  <span class="hotel-info-name">{{ day.hotel.name }}</span>
                  <span class="hotel-info-price">{{ day.hotel.price_range }}</span>
                </div>
                <div class="hotel-info-grid">
                  <div class="hotel-info-item">
                    <span class="hotel-info-label">📍 {{ t('result.fieldAddress') }}</span>
                    <span class="hotel-info-value">{{ day.hotel.address }}</span>
                  </div>
                  <div class="hotel-info-item">
                    <span class="hotel-info-label">🏷️ {{ t('result.fieldType') }}</span>
                    <span class="hotel-info-value">{{ day.hotel.type }}</span>
                  </div>
                  <div class="hotel-info-item">
                    <span class="hotel-info-label">⭐ {{ t('result.fieldRating') }}</span>
                    <span class="hotel-info-value">{{ day.hotel.rating }}</span>
                  </div>
                  <div class="hotel-info-item">
                    <span class="hotel-info-label">📏 {{ t('result.fieldDistance') }}</span>
                    <span class="hotel-info-value">{{ day.hotel.distance }}</span>
                  </div>
                </div>
              </div>
```

- [ ] **Step 5: 替换餐饮区块(Result.vue:379-390)**

将 `<!-- 餐饮安排 -->` 下的 `<a-divider>` 与 `<a-descriptions ...>...</a-descriptions>` 替换为:

```html
              <!-- 餐饮安排 -->
              <a-divider v-if="day.meals && day.meals.length" orientation="left">{{ t('result.mealsTitle') }}</a-divider>
              <div v-if="day.meals && day.meals.length" class="meal-cards">
                <div v-for="meal in day.meals" :key="meal.type" class="meal-card">
                  <div class="meal-card-head">
                    <span class="meal-icon">{{ mealIcon(meal.type) }}</span>
                    <span class="meal-type">{{ getMealLabel(meal.type) }}</span>
                    <span v-if="meal.estimated_cost" class="meal-cost">¥{{ meal.estimated_cost }}</span>
                  </div>
                  <div class="meal-name">{{ meal.name }}</div>
                  <div v-if="meal.description" class="meal-desc">{{ meal.description }}</div>
                </div>
              </div>
```

- [ ] **Step 6: i18n 补 moveUp / moveDown 键**

zh.json `result` 内追加:`"moveUp": "上移"`, `"moveDown": "下移"`
en.json:`"moveUp": "Move up"`, `"moveDown": "Move down"`
ja.json:`"moveUp": "上へ"`, `"moveDown": "下へ"`

- [ ] **Step 7: 替换样式**

在 `<style scoped>` 中,删除旧的 `.attraction-card`、`.attraction-image-wrapper`、`.attraction-image`、`.attraction-badge`、`.badge-number`、`.price-tag`、`.reservation-alert`、`.reservation-badge`、`.reservation-tips`、`.hotel-card` 及其 `:deep` 规则(约 Result.vue:3100-3189、3757-3778),替换为:

```css
/* ===== 景点时间轴卡片 ===== */
.attr-timeline-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-left: 34px;
}

.attr-timeline-list::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 12px;
  bottom: 12px;
  width: 2px;
  background: linear-gradient(180deg, rgba(217, 119, 87, 0.4), rgba(217, 119, 87, 0.08));
  border-radius: 1px;
}

.attr-card {
  position: relative;
  display: flex;
  gap: 16px;
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 14px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.attr-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--card-shadow-hover);
}

.attr-order-dot {
  position: absolute;
  left: -34px;
  top: 18px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--chat-user-bubble);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(217, 119, 87, 0.35);
}

.attr-image-wrapper {
  position: relative;
  width: 180px;
  flex-shrink: 0;
  border-radius: 12px;
  overflow: hidden;
  align-self: flex-start;
  aspect-ratio: 16 / 10;
  background: #F0E8DC;
}

.attr-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}

.attr-card:hover .attr-image {
  transform: scale(1.05);
}

.attr-img-badges {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}

.attr-badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  backdrop-filter: blur(8px);
  background: rgba(61, 50, 41, 0.55);
}

.attr-badge--price {
  background: rgba(217, 119, 87, 0.9);
}

.attr-info {
  flex: 1;
  min-width: 0;
}

.attr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.attr-name {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
}

.attr-actions {
  display: flex;
  gap: 6px;
}

.attr-action-btn {
  width: 26px;
  height: 26px;
  border: 1px solid var(--chat-ai-border);
  background: #fff;
  border-radius: 8px;
  font-size: 13px;
  color: #6B5D52;
  cursor: pointer;
  transition: all 0.15s ease;
}

.attr-action-btn:hover:not(:disabled) {
  border-color: #D97757;
  color: #C4603D;
}

.attr-action-btn--danger:hover:not(:disabled) {
  border-color: #d4380d;
  color: #d4380d;
}

.attr-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.attr-field-label {
  margin: 6px 0 4px;
  font-size: 12px;
  color: #6B5D52;
}

.attr-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.attr-meta-addr {
  font-size: 12.5px;
  color: #6B5D52;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attr-chip {
  font-size: 12px;
  color: #C4603D;
  background: rgba(217, 119, 87, 0.1);
  border-radius: 999px;
  padding: 2px 10px;
  flex-shrink: 0;
}

.attr-desc {
  margin: 8px 0 0;
  font-size: 13px;
  color: #6B5D52;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.attr-desc.expanded {
  display: block;
}

.attr-desc-toggle {
  border: none;
  background: none;
  padding: 4px 0 0;
  font-size: 12px;
  color: #D97757;
  cursor: pointer;
}

.attr-reservation {
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(255, 152, 0, 0.08);
  border-left: 3px solid rgba(255, 152, 0, 0.5);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.attr-reservation-label {
  font-size: 12.5px;
  font-weight: 700;
  color: #C4603D;
}

.attr-reservation-tips {
  font-size: 12px;
  color: rgba(61, 50, 41, 0.65);
  line-height: 1.5;
}

/* ===== 酒店信息卡 ===== */
.hotel-info-card {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 16px 18px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.hotel-info-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--card-shadow-hover);
}

.hotel-info-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.hotel-info-icon {
  font-size: 20px;
}

.hotel-info-name {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
  flex: 1;
  min-width: 0;
}

.hotel-info-price {
  font-size: 13px;
  font-weight: 700;
  color: #C4603D;
  background: rgba(217, 119, 87, 0.1);
  border-radius: 999px;
  padding: 3px 12px;
  flex-shrink: 0;
}

.hotel-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 20px;
}

.hotel-info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hotel-info-label {
  font-size: 12px;
  color: #A89888;
}

.hotel-info-value {
  font-size: 13px;
  color: #3D3229;
}

/* ===== 餐饮小卡 ===== */
.meal-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.meal-card {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 14px 16px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.meal-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--card-shadow-hover);
}

.meal-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.meal-icon {
  font-size: 18px;
}

.meal-type {
  font-size: 13px;
  font-weight: 700;
  color: #6B5D52;
  flex: 1;
}

.meal-cost {
  font-size: 12.5px;
  font-weight: 700;
  color: #C4603D;
}

.meal-name {
  font-size: 14px;
  font-weight: 600;
  color: #3D3229;
}

.meal-desc {
  margin-top: 4px;
  font-size: 12.5px;
  color: #6B5D52;
  line-height: 1.6;
}

/* ===== day-header 景点数 ===== */
.day-attr-count {
  font-size: 12px;
  color: #A89888;
}

@media (max-width: 640px) {
  .attr-card {
    flex-direction: column;
  }

  .attr-image-wrapper {
    width: 100%;
  }

  .attr-meta-addr {
    max-width: 100%;
  }
}
```

- [ ] **Step 8: 类型检查**

Run: `cd frontend && npm run build`
Expected: 构建成功(若报 `item.reservation_required` 类型错误,在 `types/index.ts` 的 `Attraction` 接口追加 `reservation_required?: boolean` 与 `reservation_tips?: string` 后重跑)

- [ ] **Step 9: 运行时验证**

打开详情页 → 「行程」区块:景点呈时间轴单列卡(图片左、信息右)、hover 上浮;描述 2 行截断可展开;酒店卡为图标栅格;餐饮为并排小卡;进入编辑模式,↑/↓/✕ 按钮可用。

- [ ] **Step 10: Commit**

```bash
git add frontend/src/views/Result.vue frontend/src/types/index.ts frontend/src/i18n/locales/
git commit -m "feat: 详情页天数区块卡片重设计(时间轴景点卡/酒店栅格/餐饮小卡)"
```

---

### Task 5: ChatHome 对话流重构 + PlanComposer 纯输入化 + TripDraftConfirmCard 抽取

**Files:**
- Create: `frontend/src/components/TripDraftConfirmCard.vue`
- Modify: `frontend/src/components/PlanComposer.vue`(整体重写)
- Modify: `frontend/src/views/ChatHome.vue`(整体重写)
- Modify: `frontend/src/i18n/locales/zh.json`、`en.json`、`ja.json`

**Interfaces:**
- Consumes: `parseTripText`、`generateTripPlan`(api.ts)、`WorkProgress` 组件(不变)、`ParsedTripDraft`/`TripFormData`/`TripTaskEvent`/`TripTaskDetail` 类型
- Produces:
  - `PlanComposer` 新接口 — props: `{ disabled?: boolean }`;emits: `(e: 'send', text: string)`;expose: `setText(text: string)`
  - `TripDraftConfirmCard` — props: `{ draft: ParsedTripDraft, generating: boolean }`;emits: `(e: 'confirm', draft: ParsedTripDraft, start: string, end: string)`、`(e: 'cancel')`

- [ ] **Step 1: 创建 TripDraftConfirmCard.vue**

确认卡片交互逻辑从旧 PlanComposer 迁移(城市 chips、日期、偏好、交通/住宿、操作按钮):

```vue
<template>
  <div class="confirm-card">
    <div class="confirm-title">{{ t('composer.confirmTitle') }}</div>
    <div class="confirm-row">
      <span class="confirm-label">{{ t('composer.cities') }}</span>
      <div class="city-chips">
        <span v-for="c in localDraft.cities" :key="c.city" class="city-chip">{{ c.city }} · {{ c.days }}{{ t('composer.daysUnit') }}</span>
      </div>
    </div>
    <div class="confirm-row">
      <span class="confirm-label">{{ t('composer.dates') }}</span>
      <a-range-picker
        v-model:value="dateRange"
        size="small"
        class="confirm-picker"
        :allow-clear="false"
      />
    </div>
    <div class="confirm-row">
      <span class="confirm-label">{{ t('composer.prefs') }}</span>
      <div class="pref-chips">
        <span
          v-for="opt in preferenceOptions"
          :key="opt"
          class="pref-chip"
          :class="{ active: localDraft.preferences.includes(opt) }"
          @click="togglePreference(opt)"
        >{{ preferenceLabel(opt) }}</span>
      </div>
    </div>
    <div class="confirm-row">
      <span class="confirm-label">{{ t('composer.transport') }}</span>
      <a-select v-model:value="localDraft.transportation" size="small" class="confirm-select">
        <a-select-option value="公共交通">{{ t('home.transportation.public') }}</a-select-option>
        <a-select-option value="自驾">{{ t('home.transportation.drive') }}</a-select-option>
        <a-select-option value="步行">{{ t('home.transportation.walk') }}</a-select-option>
        <a-select-option value="混合">{{ t('home.transportation.mixed') }}</a-select-option>
      </a-select>
      <a-select v-model:value="localDraft.accommodation" size="small" class="confirm-select">
        <a-select-option value="经济型酒店">{{ t('home.accommodation.budget') }}</a-select-option>
        <a-select-option value="舒适型酒店">{{ t('home.accommodation.comfort') }}</a-select-option>
        <a-select-option value="豪华酒店">{{ t('home.accommodation.luxury') }}</a-select-option>
        <a-select-option value="民宿">{{ t('home.accommodation.homestay') }}</a-select-option>
      </a-select>
    </div>
    <div class="confirm-actions">
      <button type="button" class="confirm-cancel" :disabled="generating" @click="emit('cancel')">{{ t('composer.cancel') }}</button>
      <button type="button" class="confirm-submit" :disabled="generating" @click="handleConfirm">
        {{ generating ? t('composer.generating') : t('composer.generate') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs, { type Dayjs } from 'dayjs'
import type { ParsedTripDraft } from '@/types'

const props = defineProps<{
  draft: ParsedTripDraft
  generating: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', draft: ParsedTripDraft, start: string, end: string): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
// 本地副本,避免直接改父级 prop
const localDraft = ref<ParsedTripDraft>(JSON.parse(JSON.stringify(props.draft)))
const dateRange = ref<[Dayjs, Dayjs]>([dayjs(props.draft.start_date), dayjs(props.draft.end_date)])

const preferenceOptions = ['历史文化', '自然风光', '美食', '购物', '艺术', '休闲']
const preferenceLabelKeys: Record<string, string> = {
  历史文化: 'home.interests.history',
  自然风光: 'home.interests.nature',
  美食: 'home.interests.food',
  购物: 'home.interests.shopping',
  艺术: 'home.interests.art',
  休闲: 'home.interests.leisure',
}
const preferenceLabel = (value: string) => t(preferenceLabelKeys[value] || value)

const togglePreference = (value: string) => {
  const idx = localDraft.value.preferences.indexOf(value)
  if (idx === -1) localDraft.value.preferences.push(value)
  else localDraft.value.preferences.splice(idx, 1)
}

const handleConfirm = () => {
  if (!dateRange.value) return
  emit(
    'confirm',
    localDraft.value,
    dateRange.value[0].format('YYYY-MM-DD'),
    dateRange.value[1].format('YYYY-MM-DD'),
  )
}
</script>

<style scoped>
.confirm-card {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  padding: 20px 22px;
  box-shadow: var(--card-shadow);
  max-width: 640px;
}

.confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
  margin-bottom: 14px;
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.confirm-label {
  width: 56px;
  flex-shrink: 0;
  font-size: 13px;
  color: #6B5D52;
}

.city-chips, .pref-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.city-chip {
  background: rgba(217, 119, 87, 0.1);
  border: 1px solid rgba(217, 119, 87, 0.3);
  color: #C4603D;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 600;
}

.pref-chip {
  border: 1px solid rgba(100, 80, 60, 0.15);
  color: #6B5D52;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.pref-chip.active {
  border-color: #D97757;
  background: rgba(217, 119, 87, 0.1);
  color: #C4603D;
}

.confirm-picker {
  flex: 1;
  min-width: 240px;
}

.confirm-select {
  min-width: 140px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.confirm-cancel {
  border: 1px solid rgba(100, 80, 60, 0.15);
  background: #fff;
  color: #6B5D52;
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
}

.confirm-submit {
  border: none;
  background: var(--chat-user-bubble);
  color: #fff;
  border-radius: 10px;
  padding: 8px 22px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.confirm-submit:disabled,
.confirm-cancel:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
```

- [ ] **Step 2: 重写 PlanComposer.vue 为纯输入框**

整体替换文件内容:

```vue
<template>
  <div class="composer">
    <div class="input-box" :class="{ disabled }">
      <textarea
        v-model="inputText"
        class="input-textarea"
        :placeholder="t('composer.placeholder')"
        :disabled="disabled"
        rows="2"
        @keydown.enter.exact.prevent="handleSend"
      ></textarea>
      <button
        type="button"
        class="send-btn"
        :disabled="!inputText.trim() || disabled"
        :aria-label="t('composer.send')"
        @click="handleSend"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ (e: 'send', text: string): void }>()

const { t } = useI18n()
const inputText = ref('')

const handleSend = () => {
  const text = inputText.value.trim()
  if (!text || props.disabled) return
  emit('send', text)
  inputText.value = ''
}

const setText = (text: string) => {
  inputText.value = text
}

defineExpose({ setText })
</script>

<style scoped>
.composer {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: #FFFFFF;
  border: 1px solid rgba(100, 80, 60, 0.18);
  border-radius: 24px;
  padding: 12px 14px;
  box-shadow: 0 4px 20px rgba(100, 80, 60, 0.08);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.input-box:focus-within {
  border-color: #D97757;
  box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.1);
}

.input-box.disabled {
  opacity: 0.7;
}

.input-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 15px;
  color: #3D3229;
  background: transparent;
  line-height: 1.5;
}

.input-textarea::placeholder {
  color: #A89888;
}

.send-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--chat-user-bubble);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 3: 重写 ChatHome.vue 为对话流**

整体替换文件内容:

```vue
<template>
  <div class="chat-home">
    <!-- 对话流 -->
    <div v-show="items.length > 0" ref="scrollRef" class="chat-scroll">
      <div class="thread">
        <template v-for="item in items" :key="item.id">
          <!-- 文本消息(用户/AI) -->
          <div v-if="item.type === 'text'" class="msg-row" :class="item.role">
            <div class="msg-bubble" :class="item.role">{{ item.text }}</div>
          </div>

          <!-- AI typing -->
          <div v-else-if="item.type === 'typing'" class="msg-row assistant">
            <div class="msg-bubble assistant typing">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
            </div>
          </div>

          <!-- 确认卡片 -->
          <div v-else-if="item.type === 'confirm'" class="msg-row assistant">
            <TripDraftConfirmCard
              :draft="item.draft"
              :generating="generating"
              @confirm="onConfirmGenerate"
              @cancel="onCancelConfirm(item.id)"
            />
          </div>

          <!-- 生成进度 -->
          <div v-else-if="item.type === 'progress'" class="msg-row assistant">
            <div class="progress-wrap">
              <WorkProgress
                :visible="item.status.visible"
                :progress="item.status.progress"
                :message="item.status.message"
                :stage="item.status.stage"
                :details="item.status.details"
              />
            </div>
          </div>

          <!-- 完成卡片 -->
          <div v-else class="msg-row assistant">
            <div class="done-card">
              <div class="done-title">✅ {{ t('chatHome.doneTitle') }}</div>
              <div class="done-desc">{{ item.city }} · {{ item.days }}{{ t('composer.daysUnit') }} · {{ t('chatHome.doneCta') }}</div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 输入区(空态时整体居中,含欢迎语) -->
    <div class="chat-input-area" :class="{ 'is-empty': items.length === 0 }">
      <div v-if="items.length === 0" class="welcome">
        <h1 class="welcome-title">{{ t('chatHome.title') }}</h1>
        <p class="welcome-desc">{{ t('chatHome.desc') }}</p>
      </div>
      <PlanComposer ref="composerRef" :disabled="busy" @send="handleUserSend" />
      <div v-if="items.length === 0" class="suggestions">
        <button
          v-for="s in suggestions"
          :key="s"
          type="button"
          class="suggestion-chip"
          @click="fillSuggestion(s)"
        >{{ s }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import PlanComposer from '@/components/PlanComposer.vue'
import TripDraftConfirmCard from '@/components/TripDraftConfirmCard.vue'
import WorkProgress from '@/components/WorkProgress.vue'
import { parseTripText, generateTripPlan } from '@/services/api'
import { getCurrentLocale } from '@/i18n'
import { notifyPlansUpdated } from '@/stores/plans'
import type { ParsedTripDraft, TripFormData, TripTaskDetail, TripTaskStage } from '@/types'

interface WorkProgressStatus {
  visible: boolean
  progress: number
  message: string
  stage: TripTaskStage
  details: TripTaskDetail[]
}

type ChatItem =
  | { id: number; role: 'user'; type: 'text'; text: string }
  | { id: number; role: 'assistant'; type: 'text'; text: string }
  | { id: number; role: 'assistant'; type: 'typing' }
  | { id: number; role: 'assistant'; type: 'confirm'; draft: ParsedTripDraft }
  | { id: number; role: 'assistant'; type: 'progress'; status: WorkProgressStatus }
  | { id: number; role: 'assistant'; type: 'done'; planId: string; city: string; days: number }

const { t, tm } = useI18n()
const router = useRouter()

const composerRef = ref<InstanceType<typeof PlanComposer> | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const items = ref<ChatItem[]>([])
const busy = ref(false)
const generating = ref(false)
// 追问上下文:保存原始输入,追问回复时拼接再解析
const parseContext = ref('')
let nextId = 1

const suggestions = computed(() => {
  const list = (tm as (key: string) => unknown)('chatHome.suggestions')
  return Array.isArray(list) ? (list as string[]) : []
})

const fillSuggestion = (text: string) => {
  composerRef.value?.setText(text)
}

const scrollToBottom = () => {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    }
  })
}

const pushItem = (item: Omit<ChatItem, 'id'> & { id?: number }): number => {
  const id = item.id ?? nextId++
  items.value.push({ ...item, id } as ChatItem)
  scrollToBottom()
  return id
}

const replaceItem = (id: number, item: Omit<ChatItem, 'id'>) => {
  const idx = items.value.findIndex((i) => i.id === id)
  if (idx !== -1) {
    items.value[idx] = { ...item, id } as ChatItem
  }
  scrollToBottom()
}

const stageText = (stage: TripTaskStage) => {
  if (stage === 'attraction_search') return t('home.loading.searchingAttractions')
  if (stage === 'weather_search') return t('home.loading.queryingWeather')
  if (stage === 'hotel_search') return t('home.loading.recommendingHotels')
  if (stage === 'planning' || stage === 'graph_building') return t('home.loading.generatingPlan')
  if (stage === 'completed') return t('home.loading.done')
  return t('home.loading.initializing')
}

const handleUserSend = async (text: string) => {
  if (busy.value) return
  pushItem({ role: 'user', type: 'text', text })

  busy.value = true
  const typingId = pushItem({ role: 'assistant', type: 'typing' })
  try {
    // 追问场景:拼接原始输入与本次回复
    const textToParse = parseContext.value ? `${parseContext.value}\n补充说明:${text}` : text
    const res = await parseTripText(textToParse, getCurrentLocale())
    if (res.need_clarify || !res.trip) {
      parseContext.value = parseContext.value || text
      replaceItem(typingId, {
        role: 'assistant',
        type: 'text',
        text: res.clarify_question || t('composer.clarifyFallback'),
      })
      return
    }
    parseContext.value = ''
    replaceItem(typingId, { role: 'assistant', type: 'confirm', draft: res.trip })
  } catch (error: any) {
    replaceItem(typingId, {
      role: 'assistant',
      type: 'text',
      text: error?.message || t('composer.parseFailed'),
    })
  } finally {
    busy.value = false
  }
}

const onCancelConfirm = (itemId: number) => {
  replaceItem(itemId, { role: 'assistant', type: 'text', text: t('composer.canceled') })
}

const onConfirmGenerate = async (draft: ParsedTripDraft, start: string, end: string) => {
  if (generating.value) return
  const travelDays = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
  if (travelDays < 1 || travelDays > 30) {
    message.warning(t('home.messages.travelDaysTooLong'))
    return
  }

  generating.value = true
  busy.value = true
  const status = reactive<WorkProgressStatus>({
    visible: true,
    progress: 5,
    message: t('home.loading.initializing'),
    stage: 'submitted',
    details: [],
  })
  const progressId = pushItem({ role: 'assistant', type: 'progress', status })

  try {
    sessionStorage.removeItem('tripPlan')
    sessionStorage.removeItem('graphData')
    sessionStorage.removeItem('planId')

    const requestData: TripFormData = {
      city: draft.city,
      cities: draft.cities,
      start_date: start,
      end_date: end,
      travel_days: travelDays,
      transportation: draft.transportation,
      accommodation: draft.accommodation,
      preferences: draft.preferences,
      free_text_input: draft.free_text_input,
      origin_text: draft.origin_text,
      language: getCurrentLocale(),
    }

    const response = await generateTripPlan(requestData, {
      onTaskEvent: (event) => {
        if (Number.isFinite(event.progress)) {
          status.progress = Math.max(0, Math.min(100, event.progress))
        }
        status.message = event.message || stageText(event.stage)
        status.stage = event.stage
        if (event.details?.length) {
          status.details = [...status.details, ...event.details]
        }
        scrollToBottom()
      },
    })

    if (response.success && response.data) {
      const planId = response.plan_id || ''
      sessionStorage.setItem('tripPlan', JSON.stringify(response.data))
      if (response.graph_data) {
        sessionStorage.setItem('graphData', JSON.stringify(response.graph_data))
      }
      if (planId) {
        sessionStorage.setItem('planId', planId)
      }
      message.success(t('home.messages.generateSuccess'))
      notifyPlansUpdated()
      replaceItem(progressId, {
        role: 'assistant',
        type: 'done',
        planId,
        city: response.data.city,
        days: response.data.days.length,
      })
      setTimeout(() => {
        router.push(`/plan/${planId}`)
      }, 900)
    } else {
      replaceItem(progressId, {
        role: 'assistant',
        type: 'text',
        text: response.message || t('home.messages.generateFailed'),
      })
    }
  } catch (error: any) {
    replaceItem(progressId, {
      role: 'assistant',
      type: 'text',
      text: error?.message || t('home.messages.generateRetry'),
    })
  } finally {
    generating.value = false
    busy.value = false
  }
}
</script>

<style scoped>
.chat-home {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 32px 24px 16px;
}

.thread {
  max-width: 768px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.msg-row {
  display: flex;
  animation: chat-msg-in 0.25s ease;
}

.msg-row.user {
  justify-content: flex-end;
}

.msg-row.assistant {
  justify-content: flex-start;
}

.msg-bubble {
  max-width: 80%;
  padding: 10px 16px;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-bubble.user {
  background: var(--chat-user-bubble);
  color: #fff;
  border-radius: 16px 16px 4px 16px;
}

.msg-bubble.assistant {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  color: #3D3229;
  border-radius: 16px 16px 16px 4px;
}

.msg-bubble.typing {
  display: inline-flex;
  gap: 5px;
  padding: 14px 18px;
}

.typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #D97757;
  animation: typing-pulse 1.2s infinite ease-in-out both;
}

.typing-dot:nth-child(2) { animation-delay: 0.15s; }
.typing-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes typing-pulse {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.progress-wrap {
  width: 100%;
}

.done-card {
  background: var(--chat-ai-bg);
  border: 1px solid rgba(217, 119, 87, 0.3);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 14px 18px;
}

.done-title {
  font-size: 14px;
  font-weight: 700;
  color: #3D3229;
}

.done-desc {
  margin-top: 4px;
  font-size: 13px;
  color: #6B5D52;
}

.chat-input-area {
  padding: 16px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-input-area.is-empty {
  flex: 1;
  justify-content: center;
}

.welcome {
  max-width: 768px;
  width: 100%;
  margin: 0 auto;
  text-align: center;
}

.welcome-title {
  font-size: 34px;
  font-weight: 800;
  color: #3D3229;
  margin: 0 0 12px;
  letter-spacing: -0.02em;
}

.welcome-desc {
  font-size: 15px;
  color: #6B5D52;
  margin: 0;
}

.suggestions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  max-width: 768px;
  margin: 0 auto;
}

.suggestion-chip {
  border: 1px solid rgba(217, 119, 87, 0.3);
  background: rgba(217, 119, 87, 0.06);
  color: #C4603D;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.suggestion-chip:hover {
  background: rgba(217, 119, 87, 0.14);
}
</style>
```

- [ ] **Step 4: i18n 补键**

zh.json:`chatHome` 内追加 `"doneTitle": "计划已生成！"`, `"doneCta": "正在为你打开计划详情…"`;`composer` 内追加 `"canceled": "好的,已取消。换个想法再告诉我～"`。
en.json:`"doneTitle": "Your plan is ready!"`, `"doneCta": "Opening your itinerary…"`;`"canceled": "OK, canceled. Tell me another idea~"`.
ja.json:`"doneTitle": "プランが完成しました!"`, `"doneCta": "旅程詳細を開いています…"`;`"canceled": "キャンセルしました。別のアイデアを教えてください~"`。

- [ ] **Step 5: 类型检查**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 6: 运行时验证**

打开首页 `/`:
1. 空态:标题 + 输入框 + suggestion chips 整体垂直居中。
2. 点击 suggestion → 文本填入输入框;Enter 发送 → 输入区落底,用户气泡靠右,AI typing 后出现确认卡片(内嵌于对话流)。
3. 修改日期/偏好后点「生成计划」→ 对话流中出现 WorkProgress 面板,完成后出现 ✅ 完成卡并自动跳转详情页。
4. 刷新重试:发送「随便玩玩」→ AI 追问文本消息;回复补充信息后出现确认卡片。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/TripDraftConfirmCard.vue frontend/src/components/PlanComposer.vue frontend/src/views/ChatHome.vue frontend/src/i18n/locales/
git commit -m "feat: 新建计划页重构为 ChatGPT 式对话流"
```

---

### Task 6: 端到端收尾验证

**Files:** 无新增改动(仅验证,发现问题回到对应任务修复)

- [ ] **Step 1: 全量构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 2: 后端冒烟**

Run: `cd backend && .venv/bin/python -m py_compile app/api/main.py app/api/routes/chat.py app/services/chat_service.py app/models/schemas.py && echo OK`
Expected: `OK`

- [ ] **Step 3: i18n 键完整性检查(三语言键集合一致)**

Run:

```bash
/usr/bin/python3 -c "
import json
def keys(o, p=''):
    out = set()
    for k, v in o.items():
        out.add(p + k)
        if isinstance(v, dict):
            out |= keys(v, p + k + '.')
    return out
base = '/Users/liangjiaquan/gitReposition/TripStar/frontend/src/i18n/locales/'
zh = keys(json.load(open(base + 'zh.json')))
en = keys(json.load(open(base + 'en.json')))
ja = keys(json.load(open(base + 'ja.json')))
missing_en = zh - en
missing_ja = zh - ja
extra_en = en - zh
extra_ja = ja - zh
print('missing in en:', sorted(missing_en))
print('missing in ja:', sorted(missing_ja))
print('extra in en:', sorted(extra_en))
print('extra in ja:', sorted(extra_ja))
assert not missing_en and not missing_ja, 'i18n 键缺失'
print('I18N OK')
"
```

Expected: `I18N OK`(extra 仅报告不阻断——存量键可能本就不齐,只要求新增键三端齐全)

- [ ] **Step 4: 浏览器全流程回归**

按 Task 3/4/5 的运行时验证清单完整走一遍:新建计划(对话流)→ 详情页(卡片新样式)→ Agent 面板(问答/修改/撤销/移动端全屏)。

- [ ] **Step 5: Commit(如有修复)**

```bash
git add -A
git commit -m "fix: 端到端回归修复"
```

---

## Self-Review 记录

- **Spec 覆盖**:对话流(Task 5)✓、卡片优化(Task 4)✓、Agent 面板 + 后端接口(Task 1/2/3)✓、全局 UI 变量(Task 2)✓、撤销(Task 3)✓、i18n 三语言(各任务 Step)✓。
- **Placeholder 扫描**:无 TBD/TODO;所有代码步骤含完整代码。
- **类型一致性**:`TripChatEditResponse`、`PanelMessage`、`chatEditPlan`、`applyAgentPlan`、`PlanComposer` 新接口(`setText`/`send`)、`TripDraftConfirmCard`(`confirm(draft, start, end)`)在任务间引用一致。
- **已知取舍**:对话历史仅 `kind: 'text'` 消息发往后端(changes 消息 content 也包含在 text 类中不参与);撤销仅内存快照(spec 非目标:不持久化)。
