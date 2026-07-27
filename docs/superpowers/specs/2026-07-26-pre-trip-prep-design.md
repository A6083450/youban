# 行前准备（Pre-Trip Prep）设计文档

**日期：** 2026-07-26  
**主题：** 计划新增「行前准备」板块——AI 个性化生成的可勾选打卡清单  
**状态：** 待实现

---

## 1. 背景与目标

TripStar 生成的旅行计划目前覆盖行程、天气、预算、地图、知识图谱，但从「拿到计划」到「出发」之间缺少一环：用户需要自己琢磨带什么、办什么、注意什么。

**目标**：在计划里新增「行前准备」板块，由 AI 结合本次行程（目的地、天气、天数、跨城、需预约景点等）个性化生成分组清单，用户可逐项勾选打卡、查看准备进度，勾选状态保存在浏览器本地。

**核心决策**（已与用户确认）：

- 内容来源：**LLM 智能生成**（非前端模板）。
- 覆盖范围：**智能打包清单、证件与预订凭证、目的地实用须知、出发前待办** 四个维度全覆盖。
- 交互方式：**可勾选打卡，localStorage 本地保存**（不加后端存储）。
- 生成方式：**独立 LangGraph 节点**（方案 A），不并入主行程生成。

---

## 2. 数据结构

### 2.1 后端模型（`backend/app/models/schemas.py`）

```python
class ChecklistItem(BaseModel):
    """行前准备清单项"""
    text: str = Field(..., description="事项内容")
    note: Optional[str] = Field(default="", description="补充贴士")
    priority: str = Field(default="normal", description="优先级: high/normal")


class PrepSection(BaseModel):
    """行前准备分组"""
    key: str = Field(..., description="分组标识: packing/documents/destination_tips/todo")
    title: str = Field(..., description="分组标题(按目标语言输出)")
    items: List[ChecklistItem] = Field(default=[], description="清单项列表")


class PreTripPrep(BaseModel):
    """行前准备"""
    sections: List[PrepSection] = Field(default=[], description="分组列表")
    summary: Optional[str] = Field(default="", description="一句话总览")
```

`TripPlan` 新增可选字段：

```python
pre_trip_prep: Optional[PreTripPrep] = Field(default=None, description="行前准备清单")
```

字段可选、默认 `None`，因此旧计划数据、`plan_parser.parse_trip_plan` 解析主 LLM 输出均无需改动。

### 2.2 分组约定

| key | 含义 | 生成时结合的上下文 |
|-----|------|--------------------|
| `packing` | 智能打包清单 | `weather_info` 温度/降雨、季节、天数、偏好活动 |
| `documents` | 证件与预订凭证 | 跨城/出境判断、`reservation_required=true` 的景点、酒店/交通 |
| `destination_tips` | 目的地实用须知 | 目的地城市：时差、电压插头、货币支付、语言、习俗、应急电话 |
| `todo` | 出发前待办 | 值机/选座、充电、现金、家中水电燃气/宠物/快递安置等 |

- LLM 固定输出这 4 个分组、顺序如上；单个分组建议 4–8 项，总量控制在 30 项以内。
- **图标由前端按 `key` 映射**，LLM 不输出图标。
- `title`、`text`、`note`、`summary` 跟随请求的 `language`（zh/en/ja）输出。
- `priority: high` 用于强提醒（如「护照有效期需覆盖行程后 6 个月」「XX 景点需提前 7 天预约」），每组最多 1–2 项。

### 2.3 前端类型（`frontend/src/types/index.ts`）

与后端一一对应：`ChecklistItem`、`PrepSection`、`PreTripPrep`；`TripPlan` 新增 `pre_trip_prep?: PreTripPrep | null`。

`TripTaskStage` 联合类型新增 `'prep_generation'`（位于 `planning` 与 `graph_building` 之间）。

---

## 3. 后端生成流程（方案 A：独立节点）

### 3.1 节点接线（`backend/app/agents/trip_planner_agent.py`）

现有图：`... → plan_itinerary → parse_plan → (conditional) → save_memories → END`。

改为在解析成功后插入 `generate_prep`：

```
parse_plan → route_after_parse ─┬→ generate_prep → save_memories → END
                                └→ plan_itinerary（解析失败重试，不变）
```

- `route_after_parse` 成功分支的返回值由 `"save_memories"` 改为 `"generate_prep"`。
- `_build_graph` 注册新节点并调整边；节点计数注释同步更新（7 → 8 节点）。

### 3.2 `generate_prep` 节点行为

1. `_emit(runtime, "prep_generation", "🎒 正在生成行前准备清单...", 90, details=[...])`。
2. 从 `state["trip_plan"]` 提取**精简摘要**作为 LLM 输入（不传完整计划，控制 token）：
   - 城市列表、起止日期、天数、是否跨城；
   - `weather_info` 摘要（逐日温度区间、天气现象）；
   - 需预约景点名单（`reservation_required=true` 的 `name` + `reservation_tips`）；
   - 交通方式、住宿类型、偏好标签、`overall_suggestions`。
3. 独立 prompt（模块级常量 `PREP_AGENT_PROMPT`）：要求输出严格 JSON（`PreTripPrep` 结构），固定 4 个 `key`，按 `language` 输出文字。
4. 调 `get_chat_model(temperature=0.3)`，解析 JSON（剥离 markdown 代码围栏后 `json.loads` + `PreTripPrep.model_validate`），写回 `state["trip_plan"]["pre_trip_prep"]`。
5. **失败降级**：任何异常（超时、JSON 解析失败、校验失败）只打日志并返回 `{}`——`pre_trip_prep` 保持 `None`，主计划完全不受影响，不重试。

### 3.3 进度事件

`prep_generation` 阶段 progress 取 90（`planning` 为 85，之后 `graph_building` 在路由层发出）。前端三处同步：

- `frontend/src/types/index.ts:139` 附近：`TripTaskStage` 加 `'prep_generation'`。
- `frontend/src/components/WorkProgress.vue:117` 阶段顺序数组插入 `'prep_generation'`（`planning` 之后）；`:124` 标签表加 `prep_generation: '行前准备'`。
- `frontend/src/views/ChatHome.vue:226-228`：`prep_generation` 归入现有 `generatingPlan` 加载文案分支即可，不新增翻译键。

---

## 4. 前端展示与交互

### 4.1 新组件 `frontend/src/components/PreTripPrepCard.vue`

- Props：`prep: PreTripPrep`、`storageKey: string`。
- 结构：
  1. **头部**：标题 +（可选）`summary` 一句话总览 + **进度条**（`已完成 x/y`，主色渐变填充）+「重置」按钮（清空勾选，带确认）。
  2. **分组卡片网格**：PC（`≥1024px`）两列、移动端（`<640px`）单列。每张分组卡片：图标 + `title` + 组内进度（`2/6`）；卡片内为清单项列表。
  3. **清单项**：checkbox + `text`；`note` 存在时以小字灰色显示在下方；`priority === 'high'` 时显示主色「重要」小标签。
- 图标映射（前端内置）：`packing` 🎒 / `documents` 🪪 / `destination_tips` 💡 / `todo` ✅（实现时可换成项目已用的 SVG/iconfont 体系，保持与其他 tab 图标一致）。

### 4.2 勾选状态持久化

- 存储：`localStorage`，key = `` `tripstar:prep:${planId}` ``；`planId` 缺失时回退 `` `tripstar:prep:${city}:${start_date}:${end_date}` ``。
- 值：已勾选项的标识数组。**项标识 = `${section.key}::${item.text}`**（内容寻址而非下标，避免 AI 改计划后清单项增删导致勾选错位；文字变了视为新事项、自然回到未勾选）。
- 读写均包 try/catch：隐私模式等 `localStorage` 不可用时降级为组件内存状态（本次会话有效，不持久化，不报错）。

### 4.3 集成进 `Result.vue`

- `activeSection` 顶部菜单新增 `prep` 项，**位置：`overview` 之后、`days` 之前**。
- 新增 `v-show="activeSection === 'prep'"` 的 section 区块，内嵌 `PreTripPrepCard`，沿用 `section-shellless` 卡片壳样式。
- 显隐逻辑：`tripPlan.pre_trip_prep?.sections?.length` 为空时**隐藏该菜单项与区块**（与天气 tab 空数据同款逻辑）。

### 4.4 视觉风格

沿用项目温暖中性体系（与天气 redesign 一致）：

- 卡片：白色半透明 `rgba(255, 255, 255, 0.72)` + `backdrop-filter: blur(12px)`，圆角 `18px`，边框 `1px solid rgba(61, 50, 41, 0.1)`。
- 文字：主文字 `#3D3229`，辅助文字 `rgba(61, 50, 41, 0.55)`，强调色 `#D97757`。
- 进度条：`linear-gradient(90deg, #D97757, #C4603D)`。
- 已勾选项：文字淡化至辅助色 + 删除线，checkbox 填充主色。
- Hover（非移动端）：清单项背景轻微着色 `rgba(217, 119, 87, 0.06)`。

---

## 5. 国际化

- **UI 固定文案**走 i18n，`zh/en/ja.json` 各加键：tab 名「行前准备」、进度文案「已完成 {done}/{total}」、「重置」、重置确认文案、「重要」标签。
- **清单内容**（`title/text/note/summary`）由 LLM 按 `language` 生成，不进 i18n 文件。

---

## 6. 边界与兼容

| 场景 | 行为 |
|------|------|
| 旧计划（无 `pre_trip_prep`） | 隐藏「行前准备」菜单项与区块 |
| `generate_prep` 失败 | 字段为 `None`，同上隐藏；主计划正常返回 |
| AI 对话改计划返回 `updated_plan` | LLM 重新生成的计划 JSON 可能丢失 `pre_trip_prep`——**前端应用 `updated_plan` 时，若其缺失该字段则保留当前计划的旧值**（勾选状态因内容寻址天然兼容） |
| 历史计划重新打开 | `plan_id` 不变 → localStorage 勾选状态自然恢复 |
| `localStorage` 不可用 | 降级为内存态，功能可用但不持久化 |
| 分组 `items` 为空 | 该分组卡片不渲染 |

---

## 7. 改动文件清单

**后端**

- `backend/app/models/schemas.py`：新增 `ChecklistItem` / `PrepSection` / `PreTripPrep`；`TripPlan` 加字段。
- `backend/app/agents/trip_planner_agent.py`：新增 `PREP_AGENT_PROMPT`、`generate_prep` 节点；调整 `route_after_parse` 与 `_build_graph`。

**前端**

- `frontend/src/types/index.ts`：新增三个接口、`TripPlan` 加字段、`TripTaskStage` 加 `'prep_generation'`。
- `frontend/src/components/PreTripPrepCard.vue`：新组件。
- `frontend/src/views/Result.vue`：菜单加 `prep` 项 + 新 section 区块 + `updated_plan` 合并时保留 `pre_trip_prep`。
- `frontend/src/components/WorkProgress.vue`：阶段数组与标签表加 `prep_generation`。
- `frontend/src/views/ChatHome.vue`：加载文案分支覆盖 `prep_generation`。
- `frontend/src/i18n/locales/{zh,en,ja}.json`：UI 文案键。

**测试**

- 后端：`generate_prep` 节点单测（成功写回 / LLM 输出非法 JSON 时降级为 `None` 不抛错）、`PreTripPrep` 模型校验单测；参照现有 `*_test.py` 同目录风格。
- 前端：`vite build` 通过、无 TypeScript 错误。

---

## 8. 验收标准

- [ ] 新生成的计划包含 `pre_trip_prep`，四个分组齐全且内容与行程相关（打包清单反映天气；需预约景点出现在证件组提醒中）。
- [ ] Result 页出现「行前准备」tab（概览之后、每日行程之前），风格与其他板块一致。
- [ ] 勾选/取消勾选即时更新进度条与组内计数；刷新页面后勾选状态保留。
- [ ] 「重置」清空所有勾选（有确认步骤）。
- [ ] `en` / `ja` 语言下生成的清单内容为对应语言，UI 文案随语言切换。
- [ ] 老计划打开不显示该 tab，无报错。
- [ ] 人为让 prep 生成失败（如断网 mock），主计划仍正常生成返回。
- [ ] 生成过程进度条出现「行前准备」阶段。
- [ ] PC 两列 / 移动端单列布局正确。
- [ ] 后端单测通过；`vite build` 通过，无 TypeScript 错误。

---

## 9. 排除范围

- 不做勾选状态云端同步（后端不加存储接口/表）。
- 不做用户自定义增删清单项（后续可迭代）。
- 不做基于清单的推送/提醒通知。
- 不改动 AI 对话改计划的后端逻辑（`pre_trip_prep` 保留由前端合并处理）。

---

## 10. 参考

- 现有 LangGraph 工作流：`backend/app/agents/trip_planner_agent.py:336`（`_build_graph`）。
- 阶段进度映射：`frontend/src/components/WorkProgress.vue:117`。
- 风格基准：`docs/superpowers/specs/2026-07-26-weather-redesign-design.md`。
