# 行程生成失败重试与多 Agent 并行规划设计

版本：v1.0 · 2026-08-03

## 1. 背景

当前行程生成由一个 LangGraph 规划节点完成：一次性把全部城市、景点、天气和酒店数据放入大 prompt，再由单次 LLM 调用输出完整 `TripPlan` JSON。

长行程存在三个问题：

1. 输出长度随天数线性增长，生成慢，且更容易截断或输出非法 JSON。
2. 解析或评审失败时会重新生成整份计划，已完成工作全部浪费。
3. 失败任务虽然保留 `request_payload`，但搜索结果和规划中间产物没有持久化，无法从失败点恢复。

本设计同时解决：

- 生成失败后提供明确的重试入口。
- 从最小失败单元继续生成，而不是整份重来。
- 长行程由多个子 agent 并行规划，主 agent 只负责编排、合并和验收。

## 2. 目标

### 2.1 功能目标

- 失败卡片内嵌“从失败处重试”按钮。
- 复用原 `task_id` 就地重试，不创建重复计划。
- 已成功的搜索结果、分段计划和汇总结果可跨重试、跨服务重启恢复。
- 每日行程正文全部由子 agent 生成。
- 主 agent 只负责任务拆分、边界约束、进度协调、合并和最终验收。
- 长行程采用 2–3 天自适应分段，最多 4 个子 agent 并发。
- 某一分段失败时，只重跑该分段。

### 2.2 性能目标

- 1–3 天计划保持单子 agent，不增加不必要的协调成本。
- 8–15 天计划正文阶段最多 4 个并发调用。
- 长行程正文耗时接近“最慢分段耗时 + 汇总/评审耗时”，不再随全部天数串行累加。

### 2.3 非目标

- 不引入任务队列、数据库、LangGraph 子图或 `Send` 动态路由。
- 不持久化原始 LLM 文本用于重复解析。
- 不实现无限评审循环；局部修订最多一轮。
- 不改变现有 TripPlan 对外响应结构。

## 3. 当前架构与约束

### 3.1 现有生成图

当前图：

```text
START
  → load_memories
  → fetch_attractions
  → fetch_weather
  → fetch_hotels
  → plan_itinerary
  → parse_plan
  → review_plan
  → revise_itinerary（可选）
  → parse_plan
  → save_memories
  → END
```

现有图未配置 LangGraph checkpointer，中间 state 只存在于单次 `graph.ainvoke` 内。

### 3.2 已有可复用能力

- task 通过内存 dict + JSON 文件原子落盘。
- task 保留完整 `request_payload`。
- WebSocket 已支持阶段、进度、details 和失败事件。
- `plan_parser.py` 已有 JSON 提取、清洗、纠错、截断修复和 LLM 修复。
- `ChatOpenAI.ainvoke` 可通过 `asyncio.gather` 并行调用。
- 前端已有 `WorkProgress`，可继续显示细粒度进度。

### 3.3 重试凭证约束

原 `execution_token` 是一次性凭证，首次提交时已消费。重试端点必须：

- 复用 owner 鉴权。
- 不再次调用 `consume_execution_token`。
- 从保存的 `request_payload` 重建请求时清空 `execution_token`。

## 4. 总体架构

```text
主编排 agent
  ├─ 读取 request + checkpoint
  ├─ 恢复或获取景点/天气/酒店数据
  ├─ 确定性拆分 2–3 天 segment
  ├─ 并行派发 segment 子 agent（Semaphore=4）
  │    ├─ 子 agent A → DayPlan[]
  │    ├─ 子 agent B → DayPlan[]
  │    ├─ 子 agent C → DayPlan[]
  │    └─ 子 agent D → DayPlan[]
  ├─ 合并并执行确定性校验
  ├─ 后端确定性计算 budget
  ├─ 汇总子 agent → overall_suggestions + blueprint
  ├─ 评审子 agent → 跨段问题 + segment_ids
  ├─ 仅重跑有问题的 segment（最多一轮）
  └─ 输出完整 TripPlan
```

实现采用现有 `plan_itinerary` 节点内部的 `asyncio.gather`，不改 LangGraph 图拓扑。

## 5. Agent 职责

### 5.1 主编排 agent

主 agent 不生成 `days[]` 正文，只负责：

- 从城市停留天数计算 day range。
- 确定性拆分 segment。
- 为各 segment 提供输入和首尾边界约束。
- 限制并发数。
- 合并各 segment 的 `DayPlan[]`。
- 执行结构校验和确定性预算计算。
- 派发汇总与评审子 agent。
- 根据评审结果只重跑对应 segment。
- 更新 task 进度和 checkpoint。

### 5.2 分段规划子 agent

每个 segment 子 agent 只负责 2–3 天：

输入：

- `segment_id`
- 起止 `day_index` 和日期
- 城市与是否跨城
- 候选景点、天气、酒店数据
- 交通、住宿和用户偏好
- 前一段结束位置/酒店
- 后一段起始城市/时间边界
- 上次失败错误（重试时）

输出：

```json
{
  "segment_id": "seg-01",
  "days": [
    { "day_index": 0, "date": "...", "...": "DayPlan fields" }
  ]
}
```

子 agent 不生成：

- 顶层 budget
- overall_suggestions
- blueprint
- weather_info

### 5.3 汇总子 agent

在全部 `DayPlan` 合并后生成：

- `overall_suggestions`
- `blueprint`

汇总失败时降级：

- `overall_suggestions` 使用规则化文本。
- `blueprint = null`。
- 不阻断每日行程交付。

### 5.4 评审子 agent

输入完整合并计划，重点检查：

- 跨段景点重复。
- 相邻日期/城市衔接。
- 酒店连续性。
- 跨城日交通合理性。
- 时间冲突。

输出：

```json
{
  "approved": false,
  "issues": ["..."],
  "segment_ids": ["seg-02"]
}
```

只允许一轮局部修订。评审调用失败时，只要确定性校验通过，计划降级放行。

## 6. 自适应分段算法

### 6.1 规则

- 1–3 天：1 个 segment。
- 4–7 天：按 2–3 天拆成 2–3 个 segment。
- 8–15 天：按 2–3 天拆分；同一批最多 4 个并发。
- 多城市先按城市停留边界切分。
- 城际移动日与到达后的首日不跨 segment 拆开。
- 单城市长行程继续按 2–3 天拆分，避免“按城市拆分”无法加速。

### 6.2 确定性要求

分段器必须保证：

- 每个 `day_index` 恰好出现一次。
- segment 按 `day_index` 连续。
- 不产生空 segment。
- 不超过计划总天数。
- 分段结果仅依赖请求参数，不依赖 LLM。

## 7. Checkpoint 设计

在 task JSON 顶层新增：

```json
"checkpoint": {
  "version": 1,
  "search": {
    "attractions": {},
    "weather": {},
    "hotels": {}
  },
  "segments": {
    "seg-01": {
      "day_indices": [0, 1, 2],
      "status": "completed",
      "output": [],
      "attempts": 1,
      "error": ""
    },
    "seg-02": {
      "day_indices": [3, 4, 5],
      "status": "failed",
      "output": [],
      "attempts": 1,
      "error": "JSON 解析失败..."
    }
  },
  "summary": {
    "status": "pending",
    "output": null,
    "error": ""
  },
  "review": {
    "status": "pending",
    "output": null,
    "error": ""
  }
}
```

### 7.1 写入时机

- 每类搜索完成后立即落盘。
- 每个 segment 解析并通过 `DayPlan` 校验后立即落盘。
- 汇总完成后立即落盘。
- 评审完成后立即落盘。
- 使用既有 tmp + replace 原子写，不引入新存储层。

### 7.2 恢复规则

- `search` 已存在：fetch 节点跳过远程获取。
- segment `completed`：直接复用 output。
- segment `failed` / `pending` / 缺失：重新派发子 agent。
- 重试 prompt 带上该 segment 的上次 error。
- summary `completed` 且 segment 未变化：复用。
- review `completed` 且 segment 未变化：复用。
- checkpoint 版本未知或结构非法：丢弃 checkpoint，安全退化为完整重试。

不为 checkpoint 建迁移框架；当前只支持 `version = 1`。

## 8. 预算与全局字段

### 8.1 Budget

budget 不再由 LLM 计算。后端从合并后的 days 确定性汇总：

- attractions：`ticket_price`
- hotels：`estimated_cost`
- meals：`estimated_cost`
- transportation：沿用现有估算规则
- inter-city transportation：沿用现有字段/规则

这样减少 LLM 算术错误和 JSON 修复负担。

### 8.2 WeatherInfo

`weather_info` 直接从搜索阶段的结构化/可解析天气数据组装，不让分段子 agent 重复生成。

### 8.3 Blueprint

仅由汇总子 agent 生成，必须满足所有 `day_index` 恰好覆盖一次；否则沿用 `TripPlan` 校验器降级为 `null`。

## 9. 重试 API

### 9.1 从失败处重试

```http
POST /api/trip/plan/{task_id}/retry
Content-Type: application/json

{
  "restart_all": false
}
```

行为：

1. task 不存在：404。
2. 非 owner：403。
3. task 不是 failed：409。
4. task 已有重试协程：409。
5. 从 `request_payload` 重建 `TripRequest`，清空 `execution_token`。
6. 重置运行态字段：
   - `status = processing`
   - `stage = initializing`
   - `progress = 0`
   - `message = ...`
   - `details = []`
   - `error = null`
   - `result = null`
7. 保留 checkpoint，并恢复最小失败单元。
8. 复用原 `task_id` 启动后台任务。

### 9.2 重新生成全部

请求：

```json
{ "restart_all": true }
```

除上述重置外，清空 checkpoint，从搜索阶段重新开始。

## 10. 前端交互

### 10.1 失败卡片

失败后不再把进度卡片替换成纯文本。卡片显示：

- 城市与日期。
- 最后成功阶段。
- 简短错误摘要。
- 已完成的 segment 数。
- 主按钮：“从失败处重试”。
- 次按钮：“重新生成全部”。

### 10.2 重试流程

1. 点击重试，按钮进入 loading，禁止重复点击。
2. 调用 retry API。
3. 原卡片就地切回 progress。
4. 重新连接 `watchTripTask(taskId)`。
5. 接收后端 checkpoint 恢复进度。
6. 完成后沿用现有成功流程进入计划页。
7. 再次失败时回到同一失败卡片，可继续重试。

### 10.3 失败计划页

左侧失败计划可继续打开。右侧失败态展示同一重试卡片，不再只显示“没有找到旅行计划数据 / 返回首页”。

## 11. 进度事件

继续使用现有 WebSocket 与 `WorkProgress`，不改事件协议。

示例 details：

```text
已恢复景点、天气和酒店数据
正在并行规划 4 个行程分段
✓ 第 1–3 天
✓ 第 4–6 天
重试第 7–9 天（第 2 次）
✓ 第 10–12 天
正在生成旅行摘要与蓝图
正在检查跨段衔接
```

总进度由主 agent 按已完成工作单元计算，子 agent 不直接写全局百分比，避免并发事件导致进度倒退。

## 12. 错误处理

- 单 segment JSON 解析失败：只标记该 segment failed，其他并发任务继续并落盘。
- 单 segment API 超时/限流：保留现有两次节点重试；最终失败才结束任务。
- 汇总失败：规则化摘要 + blueprint null，计划继续交付。
- 评审失败：确定性校验通过则降级放行。
- 聚合缺天、重复天、日期不连续：任务失败，不输出不完整计划。
- 后端重启：processing 任务转 failed，用户点击重试后按 checkpoint 恢复。
- 老失败任务无 checkpoint：自动退化为完整重试。
- 重复 retry 请求：409。

## 13. 测试

### 13.1 后端

1. 分段器：1、3、4、7、15 天及多城市边界。
2. 分段覆盖：day_index 完整、连续、无重复。
3. 并行规划：4 个 fake 子 agent 并发执行，合并顺序稳定。
4. 局部失败：一个 segment 失败，其他 segment 仍完成并落盘。
5. 局部恢复：重试只调用失败 segment。
6. checkpoint 跨服务重启恢复。
7. 未知 checkpoint version 退化为全量重试。
8. retry API：404、403、409、token 清理、运行态重置。
9. `restart_all = true` 清空 checkpoint。
10. 聚合校验：缺天、重复天、日期不连续时失败。
11. 汇总/评审失败降级不阻断有效 days。

### 13.2 前端与手动验收

- `vue-tsc --noEmit`。
- 故意让一个 segment 输出非法 JSON。
- 失败卡片显示“从失败处重试”。
- 点击后只重跑失败 segment。
- 已完成 segment 内容保持不变。
- 成功后进入正常结果页。
- 老失败任务无 checkpoint 时能完整重试。
- 重复点击不会启动多个任务。

## 14. 成功标准

- 15 天计划最多 4 个分段 LLM 调用并发。
- 所有 `days[]` 正文均由子 agent 生成。
- 主 agent 不直接生成每日行程。
- 任一 segment 失败后，重试日志明确显示只重跑失败 segment。
- 已完成 segment 在重试前后内容保持不变。
- 旧失败任务可重试。
- 服务重启后 checkpoint 可恢复。
- 长行程正文阶段耗时不再随总天数串行累加。
