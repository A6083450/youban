# 设计文档:ChatGPT 式对话体验重设计 + Agent 式计划修改

日期:2026-07-25
分支:feat/youban-chat-redesign
状态:已获用户批准

## 背景与目标

当前 TripStar 存在三个体验短板:

1. **新建计划页 (ChatHome)**:欢迎区 + suggestion chips + 底部输入框,发送后仅显示用户气泡与进度面板,不像对话产品。
2. **详情页 (Result) 卡片**:景点/酒店/餐饮卡片是 antd 默认样式堆叠,视觉粗糙;左下角的 AIChat 浮球是装饰性 3D 组件(scale 0.3、44px 字体),只能问答不能改计划。
3. **计划修改**:只能进入手动编辑模式逐字段改,没有对话式修改能力。

目标:

- 新建计划页重设计为 ChatGPT 式对话流,现有「解析 → 确认 → 生成」流程融入对话。
- 详情页各类卡片视觉优化。
- 详情页新增右侧可展开 Agent 聊天面板,用户用自然语言直接修改计划内容,AI 返回更新后的计划并实时生效。
- 整体 UI 统一设计规范。

## 关键决策(用户已确认)

| 决策点 | 结论 |
|---|---|
| AI 如何改计划 | AI 直接改:新后端接口返回更新后的完整计划,前端实时应用 |
| 对话框形态 | 右侧可展开面板(替换现有左下角 AIChat 装饰浮球) |
| 新建计划页 | 完整 ChatGPT 式对话流,确认卡片内嵌为 AI 消息 |

## 一、新建计划页 (ChatHome) — ChatGPT 式对话流

### 布局

- **初始态**:页面垂直居中 —— 大标题、副标题、居中圆角输入框(阴影 + focus 发光),suggestion chips 位于输入框下方,对标 ChatGPT 首页。
- **对话态**:发送首条消息后,欢迎区淡出,输入框动画滑落至底部固定;对话流 `max-width: 768px` 居中滚动。

### 消息模型

ChatHome 维护统一消息数组:

```ts
type ChatItem =
  | { role: 'user'; type: 'text'; text: string }
  | { role: 'assistant'; type: 'text'; text: string }        // 追问等
  | { role: 'assistant'; type: 'typing' }                    // 解析中指示器
  | { role: 'assistant'; type: 'confirm'; draft: ParsedTripDraft }
  | { role: 'assistant'; type: 'progress'; status: WorkProgressStatus }
  | { role: 'assistant'; type: 'done'; planId: string }
```

渲染规则:

- 用户消息:右侧橙色气泡(沿用 `#D97757 → #C4603D` 渐变)。
- AI 消息:左侧,✨ 头像 + 浅色卡片;文本消息直接排版,结构化内容(确认卡片、WorkProgress、完成摘要卡)内嵌在 AI 消息体内。

### 流程映射

1. 用户输入 → 用户气泡 + AI typing。
2. 解析需追问 → typing 替换为 AI 文本消息(追问内容),用户继续回复后,将「原始输入 + 用户回复」拼接再次调用 `parseTripText` 解析。
3. 解析成功 → AI 消息内嵌**确认卡片**(城市 chips、日期 range-picker、偏好 chips、交通/住宿 select、生成/取消按钮),沿用 PlanComposer 现有交互逻辑。
4. 点击生成 → AI 消息内嵌 WorkProgress 面板 + 搜索状态条,接收现有 task event 流。
5. 完成 → AI 消息变为「✅ 计划已生成」摘要卡(目的地、天数),并自动 `router.push('/plan/:id')`(保留现有自动跳转)。

### 组件拆分

- `PlanComposer.vue` 重构为**纯输入框组件**(textarea + 发送按钮 + suggestion 填充),解析/确认/生成逻辑上移到 ChatHome。
- 确认卡片抽为 `TripDraftConfirmCard.vue`(从 PlanComposer 现有 confirm-card 迁移)。
- WorkProgress 组件保持不变,仅改变挂载位置(从 sent-list 移到 AI 消息体内)。

## 二、详情页卡片优化

仅改 `activeSection === 'days'` 区块及全局卡片语言,不动预算/地图/图谱/天气的逻辑。

### 景点卡 (attraction-card)

- 卡片头部:左侧时间轴序号圆点(与上一景点连线),替代现有 badge-number。
- 图片:统一 16:9 比例容器,`object-fit: cover`,圆角 12px;加载失败沿用现有 fallback。
- 票价、评分:图片右上角精致 badge(毛玻璃底)。
- 信息区:地址(📍 icon,单行省略 + title tooltip)、时长(chip:`⏱ 90分钟`)、描述(2 行截断,「展开/收起」)。
- 预约提醒:柔和 warning 条(浅黄底 + 📋 icon),替换现有样式。
- 编辑模式:操作按钮(上移/下移/删除)改为卡片右上角 icon 按钮,字段编辑控件样式不变。

### 酒店卡 (hotel-card)

图标化信息栅格(📍 地址 / 🏨 类型 / 💰 价格区间 / ⭐ 评分 / 📏 距离),价格区间高亮为主题色。

### 餐饮 (meals)

由 `a-descriptions` 表格改为并排小卡(早餐 🍳 / 午餐 🍜 / 晚餐 🌙),每卡:icon + 餐次名 + 餐厅名 + 描述,小屏自动换行。

### Day 面板

- header 保持「第 N 天 + 城市 tag + 日期」,增加当天景点数小字。
- transfer banner 微调为左侧色条卡片样式。

## 三、Agent 聊天面板(核心新功能)

### 前端组件 PlanChatPanel.vue(替换 AIChat.vue)

- **收起态**:右下角悬浮按钮「✨ 修改计划」,主题橙渐变,轻微呼吸动效。
- **展开态**:右侧滑入面板,宽 400px(≥1280px 屏)或 360px,全高,带 header(「旅途星辰 AI · 修改计划」+ 关闭按钮)、消息流、底部输入框(textarea,Enter 发送,Shift+Enter 换行)。
- **移动端**(<768px):展开为全屏抽屉。
- **空态**:欢迎语 + 快捷指令 chips,如「把第 2 天的 XX 换成别的」「整体预算降低 20%」「第 3 天加一个美食景点」。
- 挂载位置:`Result.vue` 中替换 `<AIChat :trip-plan="tripPlan" />`。

### 消息类型

```ts
type PanelMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; kind: 'text'; content: string }
  | { role: 'assistant'; kind: 'typing' }
  | { role: 'assistant'; kind: 'changes'; content: string; changes: string[]; snapshotIndex: number }
```

- `changes` 消息:修改摘要卡,列出 AI 应用的每条变更,附「撤销」按钮 → 回滚到 `snapshotIndex` 对应快照。
- 快照管理:面板内维护 `planSnapshots: TripPlan[]`,每次应用修改前 push 当前 plan 深拷贝;撤销时恢复并同步所有下游状态。

### 修改应用流程(前端)

1. 发送 `POST /api/chat/edit`,body:`{ message, trip_plan, history }`。
2. 响应 `{ success, reply, updated_plan: TripPlan | null, changes: string[] }`。
3. `updated_plan` 非 null 时:
   - 先 push 快照;
   - 调用 Result.vue 暴露的 `applyPlanUpdate(newPlan)`:更新 `tripPlan` → `recalculateBudgetTotals()` → 重算/刷新地图(若 map 激活)、知识图谱(若激活)、overview swiper(若激活) → `sessionStorage.setItem('tripPlan', ...)`;
   - 面板中渲染 `changes` 摘要卡。
4. `updated_plan` 为 null(纯问答)→ 仅渲染文本回复。

### 后端接口 `POST /api/chat/edit`

新增 `backend/app/api/routes/chat.py` 端点 + `chat_service.chat_edit_trip`:

- System prompt:LLM 同时承担问答与修改。要求返回**严格 JSON**(使用 OpenAI 兼容 `response_format: {"type": "json_object"}`):

```json
{
  "reply": "给用户的自然语言回复",
  "updated_plan": { ...完整 TripPlan JSON... } | null,
  "changes": ["已将第2天的XX替换为YY", "已将晚餐预算下调至人均80元"]
}
```

- 规则(写入 prompt):
  - 纯提问 → `updated_plan: null`,仅回答。
  - 要求修改 → 返回**完整**更新后的 trip_plan(保持原有 schema 与未涉及字段不变),`changes` 用简短中文列出实际改动;无实际改动时 `changes: []`。
  - 不得修改 `start_date`/`end_date`/`city` 等结构性字段;仅允许调整 days 内的景点、酒店、餐饮、描述、交通方式等。
  - `max_tokens` 提升到 8192 以容纳完整 plan。
- 响应模型 `TripChatEditResponse { success, reply, updated_plan?, changes }`。
- 选择「完整 plan」而非增量 patch:计划 JSON 结构关联复杂(天数/景点/酒店/餐饮/预算),LLM 直接输出完整 JSON 一致性最可靠;预算由前端 `recalculateBudgetTotals()` 重算,不依赖 LLM 计算。
- 保留现有 `/api/chat/ask` 不动(向后兼容),前端问答也迁移到 `/api/chat/edit`。

### 错误处理

- LLM 返回非法 JSON → 后端降级:attempt json 提取失败时返回 `{ reply: 原文, updated_plan: null, changes: [] }`。
- 前端应用失败(如 schema 校验缺 days)→ 不更新 plan,聊天里提示「这次修改没有生效,请换个说法试试」。
- 网络错误 → 沿用现有错误文案模式。

## 四、整体 UI 规范

- 卡片统一:圆角 16px,`box-shadow: 0 4px 16px rgba(100,80,60,.06)`,hover 上浮 2px + 阴影加深,过渡 0.2s。
- 主题色不变:`#D97757` / `#C4603D`,文本 `#3D3229` / `#6B5D52`。
- 动效:消息淡入上滑(0.25s)、面板右滑入(0.3s ease-out)、typing 三点脉冲。
- `global.css` 新增变量:`--chat-user-bubble`, `--chat-ai-bg`, `--panel-width`, `--card-radius` 等,组件样式引用变量。
- 字体层级:消息 14-15px,卡片标题 15px/700,正文 13-14px,辅助 12px/#A89888。

## 影响文件清单

**前端**

| 文件 | 改动 |
|---|---|
| `views/ChatHome.vue` | 重构为对话流(消息模型 + 布局) |
| `components/PlanComposer.vue` | 重构为纯输入框 |
| `components/TripDraftConfirmCard.vue` | 新增(从 PlanComposer 迁出) |
| `components/PlanChatPanel.vue` | 新增(Agent 面板) |
| `components/AIChat.vue` | 删除 |
| `views/Result.vue` | 卡片模板优化;接入 PlanChatPanel;新增 `applyPlanUpdate` |
| `services/api.ts` | 新增 `chatEditPlan()` |
| `types/index.ts` | 新增 PanelMessage / TripChatEditResponse 类型 |
| `styles/global.css` | 新增 chat 设计变量 |
| `i18n` (zh/en/ja) | 新增面板、修改摘要、快捷指令等文案 |

**后端**

| 文件 | 改动 |
|---|---|
| `app/api/routes/chat.py` | 新增 `/edit` 端点 |
| `app/services/chat_service.py` | 新增 `chat_edit_trip()` |
| `app/models/schemas.py` | 新增 `TripChatEditRequest/Response` |

## 测试与验证

- 前端:`npm run build`(tsc)通过。
- 后端:对 `/api/chat/edit` 做手动 curl 验证(问答与修改两种意图)。
- 浏览器手动验证:新建计划完整流程(建议 → 输入 → 确认卡 → 进度 → 跳转);详情页对话修改(替换景点 → 卡片/预算/地图联动更新);撤销回滚;移动端面板全屏。
- i18n 三语言文案齐全(zh/en/ja)。

## 非目标 (YAGNI)

- 不做修改历史的持久化(快照仅存内存,刷新即失效)。
- 不做流式输出(SSE)——聊天面板一次性返回。
- 不动预算/地图/知识图谱/天气区块的功能逻辑。
- 不删除 `/api/chat/ask` 接口(保留兼容,前端不再调用)。
