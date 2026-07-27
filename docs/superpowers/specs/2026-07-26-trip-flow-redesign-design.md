# 「知识图谱」重设计为「行程脉络」— 设计文档

日期:2026-07-26
状态:已批准,待实现

## 背景与问题

行程结果页(`Result.vue`)顶部导航有一个 tab 叫「知识图谱」,内容是一张 ECharts 力导向关系图,把 城市→日程→景点→酒店→餐饮→天气→预算→建议 用连线连成网络。

现存问题:

- **名字太技术**:「知识图谱」是 AI/工程术语,普通用户看不懂,不像旅行功能。
- **视觉难读**:节点是模糊的渐变圆球、标签被截断成 5–7 个字(如「赛里木湖」→「赛里木…」)、8 种彩虹配色、力导向物理仿真会持续飘动,信息很难一眼看懂。
- **风格不统一**:彩虹渐变 + 模糊光晕,与 App 其余部分的 Anthropic 暖色克制风格不一致。

## 目标

1. 改名为**「行程脉络」**(en: Itinerary Flow / ja: 旅程の流れ),去掉「知识图谱」字样。
2. 把关系图重设计为**竖向时间线**,自上而下像故事一样一眼读懂。
3. 采用 Anthropic 暖色克制风格,与全站一致。
4. 文字完整不截断、静态不飘动、可交互(点击跳转到对应「每日行程」)。

## 方案

### 命名改动

| 位置 | 现在 | 改为 |
|---|---|---|
| 导航 tab `result.side.graph` | 知识图谱 | 行程脉络 |
| `result.graphTitle` | 旅行知识图谱 | 行程脉络 |
| `WorkProgress` 阶段 `graph_building` | 知识图谱 | 整理行程脉络 |
| en `result.side.graph` | Knowledge Graph | Itinerary Flow |
| ja `result.side.graph` | 知識グラフ | 旅程の流れ |

内部 section key 保留 `knowledge-graph`(不可见,不改,降低回归风险)。新组件的文案放在 `result.flow.*` 命名空间。

### 视觉:竖向时间线脉络

```
起点城市卡(多城显示「A → B → C」路线 + N 天 · M 城)
 ┃
 ●━ ① 第 1 天 · 城市 ······ 日期 星期 天气emoji温度
 ┃   🎯 景点1 · 景点2 · 景点3   (完整名 chips,可点击跳转)
 ┃   🏨 酒店名  ¥xx/晚
 ┃   🍜 午餐·名  晚餐·名
 ┃
 ●━ ② 第 2 天 …
 ┃
预算收尾卡(总预算 + 分项)
出行贴士卡(overall_suggestions,如有)
```

- 左侧一条 coral 竖脊贯穿,每天是脊上一个圆点 + 一张日卡。
- 配色 Anthropic 暖色克制:主色 coral `#D97757`;卡片米白 + 细暖边 `rgba(61,50,41,.08)` + 圆角 16px;文字 `#3D3229`。分类只用极浅底色区分(景点鼠尾草绿、住宿暖金、餐饮陶土),整体安静,不再彩虹。
- 文字完整不截断;节点静态不飘动。
- 可交互:点日卡 / 景点 chip → emit `select-day(dayIndex)`,Result.vue 跳到「每日行程」对应那天(复用现有 `goToDayFromOverview` 逻辑)。
- 响应式:移动端竖脊留左,日卡整宽堆叠,chips 换行。

### 数据与结构

- 新建 `frontend/src/components/TripFlow.vue`,props `{ tripPlan: TripPlan }`,emit `select-day`。
- 纯 HTML/CSS/Vue 渲染,不用 ECharts。
- 数据全部来自 `tripPlan`:
  - 城市:`tripPlan.cities || [tripPlan.city]`
  - 每天:`tripPlan.days[]`(`day_index / date / city / attractions / hotel / meals / is_transfer_day / transfer_info`)
  - 天气:按 `date` 匹配 `tripPlan.weather_info[]`
  - 预算:`tripPlan.budget`
  - 贴士:`tripPlan.overall_suggestions`
- 星期与本地化:用 `Intl.DateTimeFormat(localeTag, { weekday: 'short' })`,localeTag 由 i18n locale 映射(zh→zh-CN / en→en-US / ja→ja-JP)。
- 天气 emoji:按 `day_weather` 文本关键字映射(晴☀️/多云⛅/阴☁️/雨🌧️/雪❄️/雾🌫️,兜底 🌡️)。

### 清理

- Result.vue 删除旧知识图谱死代码:`initKnowledgeGraph`、`ensureGraphReady` 图表分支、`buildKgBoundaryPositionMap`、`getKgNodeVisualPreset`、`buildFeatherCircleSvgDataUrl`、`getKgNodeSymbol`、`getKgLegendDotStyle`、`getKgCategoryPalette`、KG 相关 ref(`graphData / graphCategories / kgChart / kgResizeHandler`)、`import * as echarts`、kg CSS、kg 图表容器与自定义 legend 模板。
- 清掉已无人读取的 `graphData` sessionStorage 读写(Result.vue / ChatHome.vue / App.vue)。
- 后端 `knowledge_graph_service.py` 与响应里的 `graph_data` 暂不动(留着无害),作为可选后续清理。

## 验证

- `frontend` 下 `npx vite build` 通过、`vue-tsc` 类型检查无新增错误。
- 手动核对:单城/多城、有/无天气、有/无预算、有/无贴士、含城际移动日 的行程都能正确渲染;点击日卡能跳到对应每日行程。

## 范围外(YAGNI)

- 不改后端 graph 生成逻辑。
- 不改「每日行程」「概览」等其它 section。
- 不新增导出图片对该 section 的特殊处理(沿用现有截图逻辑)。
