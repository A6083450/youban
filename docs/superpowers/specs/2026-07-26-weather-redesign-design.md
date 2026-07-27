# 天气信息 Redesign 设计文档

**日期：** 2026-07-26  
**主题：** Result 页天气信息区域重新设计，展示未来游玩天数的天气情况  
**状态：** 待实现

---

## 1. 背景与目标

当前 Result 页的「天气信息」tab 采用左右分栏布局：左侧为深色渐变的大卡片展示选中日，右侧为日期列表+详情。该布局存在以下问题：

1. **风格割裂**：深色渐变卡片与项目整体的温暖中性、白色半透明卡片风格不一致。
2. **移动端受限**：固定高度 `350px` 在移动端容易裁剪内容，近期已两次修复相关问题。
3. **信息密度低**：需要左右交互才能看完所有旅行日的天气，不能一眼概览。

**目标**：在保留「天气信息」入口的前提下，重新设计成更直观、简约、响应式的逐日天气展示。

---

## 2. 设计方案

### 2.1 整体布局

采用 **逐日卡片网格（Daily Card Grid）**：

- **PC 端**：4 列卡片网格（`≥1024px`）。
- **平板端**：2 列卡片网格（`640px–1023px`）。
- **移动端**：单列卡片（`<640px`），纵向滚动。

每张卡片对应旅行期间的一天，卡片内部按信息优先级垂直排列。

### 2.2 单张卡片内容

从上到下依次为：

1. **顶部栏**
   - 左侧：日期（`7月28日`）+ 星期（`周一`）
   - 右侧：城市标签（仅多城市行程显示；单城市可隐藏以减少重复）
   - 日期下方：第 N 天徽章（`第 1 天`），使用主色 `#D97757`
2. **中部主体**
   - 天气图标（保留现有 CSS 动画图标或 SVG）
   - 白天温度大号展示：`31°`
   - 夜间温度小号展示：`/ 22°`
   - 白天天气文字：`晴`
3. **底部分栏**
   - 夜间天气 + 夜间温度：`多云 · 22°C`
   - 风向风力：`东南风 3级`

### 2.3 选中态

- 默认选中第一天（或当前日期对应的旅行日）。
- 选中态通过以下视觉元素表达：
  - 卡片顶部 4px 色条：`linear-gradient(90deg, #D97757, #C4603D)`
  - 卡片边框：1.5px solid `#D97757`
  - 轻微增强阴影
- 非选中态：1px solid `rgba(61, 50, 41, 0.1)`，标准阴影。

### 2.4 视觉风格

- 背景：沿用项目全局的 `linear-gradient(180deg, #FAF7F2, #F5F0E8)`
- 卡片：白色半透明 `rgba(255, 255, 255, 0.72)`，毛玻璃 `backdrop-filter: blur(12px)`，圆角 `18px`
- 文字：`#3D3229` 主文字，`rgba(61, 50, 41, 0.55)` 辅助文字，`#D97757` 强调色
- 不再使用深色渐变背景。

---

## 3. 组件与文件改动

### 3.1 新增组件

建议将天气卡片抽离为独立组件，便于复用和测试：

- `frontend/src/components/WeatherDayCard.vue`
  - Props：`weather: WeatherInfo`，`dayNumber: number`，`active: boolean`
  - 内部处理：日期格式化、天气图标映射、温度格式化。

### 3.2 修改文件

- `frontend/src/views/Result.vue`
  - 替换 `weather-dashboard` 区域模板：由左右分栏改为卡片网格。
  - 保留 `activeWeatherIndex` 和 `selectedWeather` 的响应式逻辑。
  - 移除深色渐变相关 CSS 和固定高度限制。
  - 删除大量旧的 `.weather-side`、`.weather-info-side`、`.today-info-*` 等样式。
  - 引入 `WeatherDayCard.vue`。
- `frontend/src/i18n/locales/zh.json` / `en.json` / `ja.json`
  - 新增/复用翻译键：日期格式、第 N 天、城市标签等（如有需要）。
- `frontend/src/types/index.ts`
  - 无需改动，`WeatherInfo` 类型已包含所需字段。

### 3.3 保留逻辑

- 天气图标映射 `getWeatherIconKind`
- 温度格式化 `formatWeatherTemp`
- 日期/星期格式化 `formatWeatherDate` / `formatWeatherWeekday`
- 降水概率、湿度估算 `getWeatherPrecipitation` / `getWeatherHumidity`
- 风力格式化 `getWeatherWind`

这些函数在网格中仍然需要，只是从「详情面板」转移到「每张卡片底部」或工具提示中。

---

## 4. 响应式策略

| 断点 | 列数 | 卡片布局 |
|------|------|----------|
| `≥1024px` | 4 列 | 完整垂直卡片 |
| `640px–1023px` | 2 列 | 完整垂直卡片 |
| `<640px` | 1 列 | 水平紧凑卡片（图标左侧，文字右侧） |

移动端水平布局原因：避免单列滚动时卡片过高、信息稀疏，同时单手操作友好。

---

## 5. 交互与行为

- **默认状态**：加载后默认选中第一天。
- **点击卡片**：切换 `activeWeatherIndex`，仅改变选中态视觉，不改变页面其他区域（本次 redesign 不绑定到地图或日程跳转）。
- **Hover 态**：非移动端时，卡片轻微上浮 `translateY(-2px)` 并增强阴影。
- **无障碍**：卡片使用 `button` 或可聚焦的 `div`，`aria-pressed` 表示选中态。

---

## 6. 数据与边界情况

### 6.1 数据来源

天气数据来自 `tripPlan.weather_info`，类型为 `WeatherInfo[]`：

```ts
interface WeatherInfo {
  date: string
  city?: string
  day_weather: string
  night_weather: string
  day_temp: number
  night_temp: number
  wind_direction: string
  wind_power: string
}
```

### 6.2 边界处理

- **空数据**：若 `weather_info` 为空，隐藏天气 tab（保持现有逻辑）。
- **城市字段缺失**：`city` 为空时隐藏城市标签，回退到 `tripPlan.city` 不显示。
- **温度异常**：`formatWeatherTemp` 已对非数字返回 `'--'`。
- **超长天气描述**：卡片中部天气文字超出时截断并显示省略号。

---

## 7. 验收标准

- [ ] PC 端天气 tab 显示为 4 列卡片网格。
- [ ] 平板端显示为 2 列卡片网格。
- [ ] 移动端显示为单列水平紧凑卡片。
- [ ] 卡片风格与 Result 页其他白色半透明卡片一致。
- [ ] 默认选中第一天，选中态有明显视觉标识。
- [ ] 点击卡片可切换选中态。
- [ ] 不再出现固定高度导致的裁剪问题。
- [ ] 天气 tab 在 `weather_info` 为空时正确隐藏。
- [ ] `vite build` 通过，无 TypeScript 错误。

---

## 8. 待排除范围

- 不新增后端字段（如紫外线、穿衣指数）。
- 不将天气嵌入每日行程卡片（本次只改造独立天气区）。
- 不添加天气与地图/日程的联动跳转。

---

## 9. 参考

- 当前实现：`frontend/src/views/Result.vue` 中 `weather-dashboard` 区域。
- 设计稿：`docs/superpowers/brainstorm/82979-1785006376/content/weather-day-cards.html`
