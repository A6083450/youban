# 天气信息 Redesign 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Result 页的「天气信息」tab 从左右分栏改为逐日卡片网格，统一项目视觉风格，并兼容 PC、平板、移动端。

**Architecture：** 新增独立的 `WeatherDayCard.vue` 组件负责单张天气卡片的渲染与状态样式；`Result.vue` 中原来的 `weather-dashboard` 区域改为调用该组件的响应式网格容器，并移除旧的深色渐变样式与固定高度。所有格式化逻辑复用现有工具函数。

**Tech Stack：** Vue 3 + TypeScript + Ant Design Vue + Vite + CSS（无新依赖）。

## Global Constraints

- 不得修改后端模型或 API；复用现有的 `WeatherInfo` 类型。
- 不得新增第三方依赖。
- 保持项目现有视觉体系：温暖中性背景、白色半透明毛玻璃卡片、主色 `#D97757`、文字 `#3D3229`。
- 必须移除固定高度 `350px`，改为由内容撑开。
- 天气 tab 的显示/隐藏逻辑保持不变（依赖 `tripPlan.weather_info.length > 0`）。
- 所有文案使用 `vue-i18n` 的 `t()`，不硬编码中文。

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/components/WeatherDayCard.vue` | 新建 | 单张天气卡片：日期、第几天、城市、天气图标、温度、夜间天气、风力、选中态 |
| `frontend/src/views/Result.vue` | 修改 | 替换 `weather-dashboard` 模板；移除旧天气样式；引入 `WeatherDayCard` |
| `frontend/src/i18n/locales/zh.json` | 修改 | 按需补充/复用天气相关文案键 |
| `frontend/src/i18n/locales/en.json` | 修改 | 同上 |
| `frontend/src/i18n/locales/ja.json` | 修改 | 同上 |

---

## Task 1: 创建 WeatherDayCard.vue 组件

**Files:**
- Create: `frontend/src/components/WeatherDayCard.vue`
- Test: 手动在 Result 页引入后通过浏览器/构建验证

**Interfaces:**
- Consumes: `WeatherInfo`（来自 `@/types`），`dayNumber: number`，`active: boolean`，`localeTag: string`
- Produces: 一个可点击、带选中态的天气卡片；点击时通过 `select` 事件返回 `dayNumber`

### 步骤

- [ ] **Step 1: 创建组件骨架**

  在 `frontend/src/components/WeatherDayCard.vue` 写入：

  ```vue
  <script setup lang="ts">
  import { computed } from 'vue'
  import type { WeatherInfo } from '@/types'

  const props = withDefaults(
    defineProps<{
      weather: WeatherInfo
      dayNumber: number
      active?: boolean
      localeTag?: string
    }>(),
    { active: false, localeTag: 'zh-CN' }
  )

  const emit = defineEmits<{ (e: 'select', dayNumber: number): void }>()

  const parseWeatherDate = (rawDate: string): Date | null = {
    if (!rawDate) return null
    const normalized = rawDate
      .replace(/年/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, '')
      .replace(/[./]/g, '-')
      .trim()
    const parsedDate = new Date(normalized)
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate
    const matched = rawDate.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
    if (!matched) return null
    const [, year, month, day] = matched
    const fallbackDate = new Date(Number(year), Number(month) - 1, Number(day))
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate
  }

  const formatDate = (rawDate: string): string = {
    const date = parseWeatherDate(rawDate)
    if (!date) return rawDate || '--'
    return new Intl.DateTimeFormat(props.localeTag, {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
    }).format(date)
  }

  const formatTemp = (temperature: number | null | undefined): string = {
    if (!Number.isFinite(Number(temperature))) return '--'
    return `${Math.round(Number(temperature))}°`
  }
  </script>

  <template>
    <div
      class="weather-day-card"
      :class="{ 'weather-day-card--active': active }"
      role="button"
      tabindex="0"
      @click="emit('select', dayNumber)"
    >
      <div class="weather-day-card__header">
        <div>
          <div class="weather-day-card__date">{{ formatDate(weather.date) }}</div>
          <div class="weather-day-card__day-number">第 {{ dayNumber }} 天</div>
        </div>
        <span v-if="weather.city" class="weather-day-card__city">{{ weather.city }}</span>
      </div>

      <div class="weather-day-card__body">
        <div class="weather-day-card__icon">☀️</div>
        <div class="weather-day-card__temp">
          {{ formatTemp(weather.day_temp) }}
          <span class="weather-day-card__temp-night">/ {{ formatTemp(weather.night_temp) }}</span>
        </div>
        <div class="weather-day-card__weather-text">{{ weather.day_weather || '--' }}</div>
      </div>

      <div class="weather-day-card__footer">
        <div class="weather-day-card__footer-row">
          <span class="weather-day-card__footer-label">夜间</span>
          <span class="weather-day-card__footer-value"
            >{{ weather.night_weather || '--' }} · {{ formatTemp(weather.night_temp) }}</span
          >
        </div>
        <div class="weather-day-card__footer-row">
          <span class="weather-day-card__footer-label">风力</span>
          <span class="weather-day-card__footer-value"
            >{{ (weather.wind_direction || '--') + ' ' + (weather.wind_power || '--') }}</span
          >
        </div>
      </div>
    </div>
  </template>

  <style scoped>
  .weather-day-card {
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(61, 50, 41, 0.1);
    border-radius: 18px;
    padding: 18px;
    box-shadow: 0 8px 24px rgba(61, 50, 41, 0.06);
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }

  .weather-day-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(61, 50, 41, 0.1);
  }

  .weather-day-card--active {
    background: rgba(255, 255, 255, 0.85);
    border: 1.5px solid #D97757;
    box-shadow: 0 12px 32px rgba(217, 119, 87, 0.14);
  }

  .weather-day-card--active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, #D97757, #C4603D);
  }

  .weather-day-card__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .weather-day-card__date {
    font-size: 13px;
    color: rgba(61, 50, 41, 0.55);
    font-weight: 600;
  }

  .weather-day-card__day-number {
    font-size: 12px;
    color: #D97757;
    font-weight: 700;
    margin-top: 4px;
  }

  .weather-day-card__city {
    font-size: 11px;
    color: rgba(61, 50, 41, 0.5);
    background: rgba(61, 50, 41, 0.06);
    padding: 3px 8px;
    border-radius: 999px;
  }

  .weather-day-card__body {
    text-align: center;
    margin: 18px 0;
  }

  .weather-day-card__icon {
    font-size: 52px;
    line-height: 1;
  }

  .weather-day-card__temp {
    font-size: 32px;
    font-weight: 800;
    color: #3D3229;
    margin-top: 10px;
  }

  .weather-day-card__temp-night {
    font-size: 18px;
    color: rgba(61, 50, 41, 0.45);
    font-weight: 500;
  }

  .weather-day-card__weather-text {
    font-size: 14px;
    color: rgba(61, 50, 41, 0.7);
    margin-top: 4px;
  }

  .weather-day-card__footer {
    border-top: 1px solid rgba(61, 50, 41, 0.08);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .weather-day-card__footer-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .weather-day-card__footer-label {
    color: rgba(61, 50, 41, 0.55);
  }

  .weather-day-card__footer-value {
    color: #3D3229;
    font-weight: 600;
  }

  @media (max-width: 640px) {
    .weather-day-card {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
    }

    .weather-day-card__body {
      flex: 0 0 80px;
      margin: 0;
    }

    .weather-day-card__icon {
      font-size: 40px;
    }

    .weather-day-card__temp {
      font-size: 24px;
      margin-top: 4px;
    }

    .weather-day-card__temp-night {
      font-size: 14px;
    }

    .weather-day-card__weather-text {
      display: none;
    }

    .weather-day-card__header {
      flex: 1;
      min-width: 0;
      margin-bottom: 0;
      flex-direction: column;
      gap: 4px;
    }

    .weather-day-card__footer {
      flex: 1;
      min-width: 0;
      border-top: none;
      padding-top: 0;
    }

    .weather-day-card__footer-row {
      justify-content: flex-start;
      gap: 8px;
    }
  }
  </style>
  ```

  注意：当前先使用占位 emoji 作为天气图标，Task 2 中再替换为项目现有的 CSS 动画天气图标映射。

- [ ] **Step 2: 运行类型检查**

  Run:
  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar/frontend
  npx vue-tsc --noEmit
  ```
  Expected: 无新增错误（允许项目已有错误，但不得由本组件引入新错误）。

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar
  git add frontend/src/components/WeatherDayCard.vue
  git commit -m "feat(weather): add WeatherDayCard component"
  ```

---

## Task 2: 在 Result.vue 中接入天气卡片网格

**Files:**
- Modify: `frontend/src/views/Result.vue`

**Interfaces:**
- Consumes: `WeatherDayCard.vue` 的 `weather`、`dayNumber`、`active`、`localeTag` props 和 `select` 事件
- Produces: Result 页天气 tab 展示为响应式卡片网格

### 步骤

- [ ] **Step 1: 导入组件**

  在 `frontend/src/views/Result.vue` 的 `<script setup>` 顶部附近，现有 import 之后添加：

  ```ts
  import WeatherDayCard from '@/components/WeatherDayCard.vue'
  ```

- [ ] **Step 2: 替换天气区域模板**

  找到 `weather-dashboard` div（约第 440–583 行），替换为：

  ```vue
  <div v-if="selectedWeather" class="weather-dashboard">
    <div class="weather-grid">
      <WeatherDayCard
        v-for="(item, index) in weatherDisplayList"
        :key="`${item.date}-${index}`"
        :weather="item"
        :day-number="index + 1"
        :active="index === activeWeatherIndex"
        :locale-tag="localeTag"
        @select="selectWeatherDay"
      />
    </div>
  </div>
  ```

  保留 `selectedWeather`、`weatherDisplayList`、`activeWeatherIndex`、`selectWeatherDay`、`localeTag` 等现有响应式逻辑不变。

- [ ] **Step 3: 确认事件处理可用**

  `selectWeatherDay(index: number)` 已存在，逻辑为设置 `activeWeatherIndex.value = index`。无需修改。

- [ ] **Step 4: 运行构建**

  Run:
  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar/frontend
  npx vite build
  ```
  Expected: 构建成功，无 TypeScript/Vite 错误。

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar
  git add frontend/src/views/Result.vue
  git commit -m "feat(weather): replace dashboard with responsive card grid"
  ```

---

## Task 3: 迁移天气图标映射到 WeatherDayCard

**Files:**
- Modify: `frontend/src/components/WeatherDayCard.vue`
- Modify: `frontend/src/views/Result.vue`

**Interfaces:**
- Consumes: `WeatherIconKind` 和 `getWeatherIconKind`（从 Result.vue 复用或抽离）
- Produces: 卡片根据 `day_weather` + `night_weather` 渲染正确的 CSS 动画天气图标

### 步骤

- [ ] **Step 1: 将天气图标逻辑抽离到组件内**

  在 `WeatherDayCard.vue` 的 `<script setup>` 中添加：

  ```ts
  type WeatherIconKind = 'sun-shower' | 'thunder-storm' | 'cloudy' | 'flurries' | 'sunny' | 'rainy'

  const getWeatherIconKind = (weatherText: string): WeatherIconKind = {
    const text = (weatherText || '').trim()
    const hasRain = /(雨|rain|shower|drizzle|sprinkle|阵雨|小雨|中雨|大雨|暴雨)/i.test(text)
    const hasSun = /(晴|sun|clear)/i.test(text)

    if (/(雷|thunder|storm|lightning|雷暴|雷阵雨)/i.test(text)) return 'thunder-storm'
    if (/(雪|snow|sleet|hail|冰雹|冻雨|雨夹雪)/i.test(text)) return 'flurries'
    if (hasRain && hasSun) return 'sun-shower'
    if (hasRain) return 'rainy'
    if (/(云|阴|cloud|overcast|雾|霾|fog|mist|haze|wind|breeze|gale)/i.test(text)) return 'cloudy'
    return 'sunny'
  }

  const iconKind = computed(() =>
    getWeatherIconKind(`${props.weather.day_weather || ''} ${props.weather.night_weather || ''}`)
  )
  ```

- [ ] **Step 2: 替换模板中的占位 emoji**

  将模板中的：

  ```vue
  <div class="weather-day-card__icon">☀️</div>
  ```

  替换为项目现有的 CSS 动画天气图标结构（复制 Result.vue 中 `.weather-hero-icon` 的 6 套模板）：

  ```vue
  <div class="weather-day-card__icon weather-icon" :class="iconKind">
    <template v-if="iconKind === 'sun-shower'">
      <div class="cloud"></div>
      <div class="sun"><div class="rays"></div></div>
      <div class="rain"></div>
    </template>
    <template v-else-if="iconKind === 'thunder-storm'">
      <div class="cloud"></div>
      <div class="lightning">
        <div class="bolt"></div>
        <div class="bolt"></div>
      </div>
    </template>
    <template v-else-if="iconKind === 'cloudy'">
      <div class="cloud"></div>
      <div class="cloud"></div>
    </template>
    <template v-else-if="iconKind === 'flurries'">
      <div class="cloud"></div>
      <div class="snow">
        <div class="flake"></div>
        <div class="flake"></div>
      </div>
    </template>
    <template v-else-if="iconKind === 'rainy'">
      <div class="cloud"></div>
      <div class="rain"></div>
    </template>
    <template v-else">
      <div class="sun"><div class="rays"></div></div>
    </template>
  </div>
  ```

- [ ] **Step 3: 在组件内添加 `.weather-icon` 基础样式**

  在 `WeatherDayCard.vue` 的 `<style scoped>` 中添加：

  ```css
  .weather-day-card__icon.weather-icon {
    position: relative;
    display: inline-block;
    width: 5.2em;
    height: 4.4em;
    font-size: 10px;
    color: #3D3229;
    animation: weather-float 5.5s ease-in-out infinite;
  }
  ```

  并复制 Result.vue 中 `.weather-icon` 相关 `.cloud`、`.sun`、`.rain`、`.snow`、`.bolt`、`.flake`、keyframes 等样式到组件中，保持天气图标渲染正确。为避免样式重复，也可将这些天气图标样式保留在 `Result.vue` 的公共位置，本组件只负责传入 class。但为组件独立性，推荐复制到组件内。

- [ ] **Step 4: 清理 Result.vue 中重复的天气图标代码**

  保留 Result.vue 中 `getWeatherIconKind`、`WeatherIconKind`、`selectedWeatherIconKind`、`weatherDisplayList` 等用于 `weatherDisplayList` 的类型转换逻辑，但删除已废弃的 `.weather-hero-icon`、`.weather-icon` 等大型 CSS 块。

- [ ] **Step 5: 构建验证**

  Run:
  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar/frontend
  npx vite build
  ```
  Expected: 构建成功。

- [ ] **Step 6: Commit**

  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar
  git add frontend/src/components/WeatherDayCard.vue frontend/src/views/Result.vue
  git commit -m "feat(weather): migrate animated weather icons into WeatherDayCard"
  ```

---

## Task 4: 清理旧天气样式并统一响应式

**Files:**
- Modify: `frontend/src/views/Result.vue`

**Interfaces:**
- Consumes: 已新增的 `.weather-dashboard`、`.weather-grid` 样式需求
- Produces: 移除旧样式后的干净样式表

### 步骤

- [ ] **Step 1: 添加新的网格容器样式**

  在 `Result.vue` 的 `<style scoped>` 中，天气相关样式顶部添加：

  ```css
  .weather-dashboard {
    padding: 8px 0 16px;
  }

  .weather-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }

  @media (max-width: 1023px) {
    .weather-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 640px) {
    .weather-grid {
      grid-template-columns: 1fr;
    }
  }
  ```

- [ ] **Step 2: 删除旧天气样式**

  删除以下已废弃的 CSS 类（约第 3756 行起大量代码）：

  - `.weather-section-card` 中除 `overflow: hidden` 外的多余属性
  - `.weather-dashboard` 旧定义中的 `display: flex`、`height: 350px`、`background: none`
  - `.weather-side`、`.weather-gradient`、`.date-container`、`.date-dayname`、`.date-day`、`.location`、`.location-icon`
  - `.weather-container`、`.weather-hero-icon`
  - `.weather-info-side`、`.today-info-container`、`.today-info`、`.today-info-item`、`.week-container`、`.week-list` 及子元素
  - 旧的 `@keyframes weather-*`（若已复制到 `WeatherDayCard.vue` 中）
  - 旧的移动端天气媒体查询 `.weather-dashboard`、`.weather-side` 等

  删除后保留：
  - `.weather-section-card { overflow: hidden; }`
  - 新的 `.weather-dashboard` 和 `.weather-grid`
  - 如果 `WeatherDayCard.vue` 未完全复制 keyframes，则保留这些 keyframes 在 Result.vue 中

- [ ] **Step 3: 确认样式无语法错误**

  Run:
  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar/frontend
  npx vite build
  ```
  Expected: 构建成功。

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar
  git add frontend/src/views/Result.vue
  git commit -m "refactor(weather): remove old dashboard styles and add responsive grid"
  ```

---

## Task 5: i18n 文案整理

**Files:**
- Modify: `frontend/src/i18n/locales/zh.json`
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Modify: `frontend/src/components/WeatherDayCard.vue`

**Interfaces:**
- Consumes: `vue-i18n` 的 `t()`
- Produces: 卡片内「夜间」「风力」「第 N 天」等文案支持多语言

### 步骤

- [ ] **Step 1: 添加/确认翻译键**

  在 `zh.json` 的 `result` 命名空间下确认存在以下键（如不存在则添加）：

  ```json
  {
    "weatherNight": "夜间",
    "weatherWind": "风力",
    "dayNumber": "第 {day} 天"
  }
  ```

  在 `en.json`：

  ```json
  {
    "weatherNight": "Night",
    "weatherWind": "Wind",
    "dayNumber": "Day {day}"
  }
  ```

  在 `ja.json`：

  ```json
  {
    "weatherNight": "夜間",
    "weatherWind": "風力",
    "dayNumber": "{day} 日目"
  }
  ```

- [ ] **Step 2: 在组件内注入 i18n**

  在 `WeatherDayCard.vue` 的 `<script setup>` 中添加：

  ```ts
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()
  ```

  并将模板中的硬编码替换为：

  ```vue
  <div class="weather-day-card__day-number">{{ t('result.dayNumber', { day: dayNumber }) }}</div>
  ...
  <span class="weather-day-card__footer-label">{{ t('result.weatherNight') }}</span>
  ...
  <span class="weather-day-card__footer-label">{{ t('result.weatherWind') }}</span>
  ```

- [ ] **Step 3: 构建验证**

  Run:
  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar/frontend
  npx vite build
  ```
  Expected: 构建成功。

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar
  git add frontend/src/components/WeatherDayCard.vue frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json
  git commit -m "i18n(weather): localize weather card labels"
  ```

---

## Task 6: 最终验证与视觉检查

**Files:**
- Modify: 无（仅验证）

### 步骤

- [ ] **Step 1: 完整构建**

  Run:
  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar/frontend
  npx vite build
  ```
  Expected: `dist/` 生成，终端显示 `build completed`。

- [ ] **Step 2: 启动开发服务器并查看天气 tab**

  Run:
  ```bash
  cd /Users/liangjiaquan/gitReposition/TripStar/frontend
  npm run dev
  ```

  在浏览器打开输出地址，加载一条包含 `weather_info` 的行程数据，切换到「天气信息」tab，确认：
  - PC 端显示 4 列卡片网格
  - 平板/窄窗口显示 2 列
  - 手机宽度显示单列水平卡片
  - 默认第一天选中
  - 点击其他卡片切换选中态
  - 天气图标与天气文字对应
  - 无固定高度裁剪问题

- [ ] **Step 3: 清理 visual companion 服务器（可选）**

  如果 visual companion 仍在后台运行：
  ```bash
  /Users/liangjiaquan/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/brainstorming/scripts/stop-server.sh /Users/liangjiaquan/gitReposition/TripStar/.superpowers/brainstorm/82979-1785006376/state
  ```

- [ ] **Step 4: Commit 任何最后的修复**

  如有必要，提交修复后结束任务。

---

## Self-Review Checklist

- [x] **Spec coverage**：每个设计要点都有对应任务。
- [x] **Placeholder scan**：无 TBD/TODO/"实现 later" 等占位符。
- [x] **Type consistency**：`WeatherInfo`、`dayNumber`、`activeWeatherIndex`、`selectWeatherDay` 名称与现有代码一致。
- [x] **No new deps**：仅使用现有技术栈。
