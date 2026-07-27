<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripPlan, WeatherInfo, DayPlan } from '@/types'

const { t, locale } = useI18n()

const props = defineProps<{ tripPlan: TripPlan }>()
const emit = defineEmits<{ (e: 'select-day', dayArrayIndex: number): void }>()

const localeTag = computed(() => {
  const current = String(locale.value || 'en').toLowerCase()
  if (current.startsWith('zh')) return 'zh-CN'
  if (current.startsWith('ja')) return 'ja-JP'
  return 'en-US'
})

const cities = computed<string[]>(() => {
  const list = props.tripPlan.cities?.filter(Boolean)
  return list && list.length ? list : [props.tripPlan.city].filter(Boolean)
})

const isMultiCity = computed(() => cities.value.length > 1)
const routeLabel = computed(() => cities.value.join(' → '))

const weatherByDate = computed<Map<string, WeatherInfo>>(() => {
  const map = new Map<string, WeatherInfo>()
  for (const w of props.tripPlan.weather_info || []) {
    if (w.date) map.set(w.date, w)
  }
  return map
})

interface EnrichedDay {
  day: DayPlan
  index: number
  weather: WeatherInfo | null
}

const enrichedDays = computed<EnrichedDay[]>(() =>
  (props.tripPlan.days || []).map((day, index) => ({
    day,
    index,
    weather: weatherByDate.value.get(day.date) || null,
  }))
)

interface BudgetItem {
  label: string
  value: number
}

const budgetItems = computed<BudgetItem[]>(() => {
  const b = props.tripPlan.budget
  if (!b) return []
  const raw: [string, number | undefined][] = [
    [t('result.flow.budgetAttraction'), b.total_attractions],
    [t('result.flow.budgetHotel'), b.total_hotels],
    [t('result.flow.budgetMeal'), b.total_meals],
    [t('result.flow.budgetTransport'), b.total_transportation],
    [t('result.flow.budgetInterCity'), b.total_inter_city_transport],
  ]
  return raw
    .filter((entry): entry is [string, number] => Boolean(entry[1]))
    .map(([label, value]) => ({ label, value }))
})

// 日期解析：兼容 "2026-07-27" 与 "2026年7月27日" 等写法
const parseDate = (raw: string): Date | null => {
  if (!raw) return null
  const normalized = raw
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-')
    .trim()
  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) return parsed
  const matched = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return null
  const [, year, month, day] = matched
  const fallback = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

const formatDayDate = (raw: string): string => {
  const date = parseDate(raw)
  if (!date) return raw || '--'
  return new Intl.DateTimeFormat(localeTag.value, { month: 'short', day: 'numeric' }).format(date)
}

const formatWeekday = (raw: string): string => {
  const date = parseDate(raw)
  if (!date) return ''
  return new Intl.DateTimeFormat(localeTag.value, { weekday: 'short' }).format(date)
}

const formatTemp = (temp: number | null | undefined): string => {
  if (temp == null || !Number.isFinite(Number(temp))) return '--'
  return `${Math.round(Number(temp))}°`
}

// 天气文本 → emoji（与全站天气图标判定同源，输出精简 emoji）
const weatherEmoji = (weatherText: string | undefined): string => {
  const text = (weatherText || '').trim()
  if (/(雷|thunder|storm|lightning)/i.test(text)) return '⛈️'
  if (/(雪|snow|sleet|hail|冰雹|冻雨|雨夹雪)/i.test(text)) return '❄️'
  const hasRain = /(雨|rain|shower|drizzle|阵雨|小雨|中雨|大雨|暴雨)/i.test(text)
  const hasSun = /(晴|sun|clear)/i.test(text)
  if (hasRain && hasSun) return '🌦️'
  if (hasRain) return '🌧️'
  if (/(多云|云|partly|cloud)/i.test(text)) return '⛅'
  if (/(阴|overcast|雾|霾|fog|mist|haze)/i.test(text)) return '☁️'
  if (hasSun) return '☀️'
  return '🌡️'
}

const getMealLabel = (type: string): string => {
  const labels: Record<string, string> = {
    breakfast: t('result.meals.breakfast'),
    lunch: t('result.meals.lunch'),
    dinner: t('result.meals.dinner'),
    snack: t('result.meals.snack'),
  }
  return labels[type] || type
}
</script>

<template>
  <div class="trip-flow">
    <!-- 起点城市卡 -->
    <div class="tf-origin">
      <div class="tf-origin-main">
        <span class="tf-origin-icon">📍</span>
        <span class="tf-origin-route">{{ routeLabel }}</span>
      </div>
      <div class="tf-origin-meta">
        <span class="tf-origin-dates">{{ t('result.dateRange', { start: tripPlan.start_date, end: tripPlan.end_date }) }}</span>
        <span class="tf-origin-badge">{{ t('result.flow.daysCount', { n: enrichedDays.length }) }}</span>
        <span v-if="isMultiCity" class="tf-origin-badge">{{ t('result.flow.citiesCount', { n: cities.length }) }}</span>
      </div>
    </div>

    <!-- 竖向时间线 -->
    <div class="tf-timeline">
      <div v-for="row in enrichedDays" :key="row.day.day_index" class="tf-day">
        <span class="tf-day-dot">{{ row.index + 1 }}</span>
        <div
          class="tf-day-card"
          role="button"
          tabindex="0"
          @click="emit('select-day', row.index)"
          @keydown.enter="emit('select-day', row.index)"
          @keydown.space.prevent="emit('select-day', row.index)"
        >
          <div class="tf-day-head">
            <div class="tf-day-headline">
              <span class="tf-day-no">{{ t('result.flow.dayLabel', { n: row.index + 1 }) }}</span>
              <span v-if="isMultiCity && row.day.city" class="tf-day-city">{{ row.day.city }}</span>
              <span v-if="row.day.is_transfer_day" class="tf-day-transfer">{{ t('result.transferDay') }}</span>
            </div>
            <div class="tf-day-right">
              <span class="tf-day-date">{{ formatDayDate(row.day.date) }} {{ formatWeekday(row.day.date) }}</span>
              <span v-if="row.weather" class="tf-day-weather">
                {{ weatherEmoji(row.weather.day_weather) }} {{ formatTemp(row.weather.day_temp) }}
              </span>
            </div>
          </div>

          <div v-if="row.day.is_transfer_day && row.day.transfer_info" class="tf-transfer">
            <span class="tf-transfer-icon">🚄</span>{{ row.day.transfer_info }}
          </div>

          <div v-if="row.day.attractions && row.day.attractions.length" class="tf-line">
            <span class="tf-line-icon">🎯</span>
            <div class="tf-chips">
              <span v-for="(a, i) in row.day.attractions" :key="i" class="tf-chip tf-chip--attraction">{{ a.name }}</span>
            </div>
          </div>

          <div v-if="row.day.hotel" class="tf-line">
            <span class="tf-line-icon">🏨</span>
            <span class="tf-hotel-name">{{ row.day.hotel.name }}</span>
            <span v-if="row.day.hotel.estimated_cost" class="tf-hotel-cost">¥{{ row.day.hotel.estimated_cost }}{{ t('result.flow.perNight') }}</span>
            <span v-else-if="row.day.hotel.price_range" class="tf-hotel-cost">{{ row.day.hotel.price_range }}</span>
          </div>

          <div v-if="row.day.meals && row.day.meals.length" class="tf-line">
            <span class="tf-line-icon">🍜</span>
            <div class="tf-meals">
              <span v-for="(m, i) in row.day.meals" :key="i" class="tf-meal">
                <span class="tf-meal-type">{{ getMealLabel(m.type) }}</span>
                <span class="tf-meal-name">{{ m.name }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 预算收尾卡 -->
    <div v-if="tripPlan.budget" class="tf-summary tf-budget">
      <span class="tf-summary-icon">💰</span>
      <span class="tf-budget-total">{{ t('result.flow.budgetTotal') }} ¥{{ tripPlan.budget.total }}</span>
      <span v-if="budgetItems.length" class="tf-budget-items">
        <span v-for="item in budgetItems" :key="item.label" class="tf-budget-item">
          {{ item.label }} ¥{{ item.value }}
        </span>
      </span>
    </div>

    <!-- 出行贴士 -->
    <div v-if="tripPlan.overall_suggestions" class="tf-summary tf-tips">
      <span class="tf-summary-icon">💡</span>
      <div class="tf-tips-body">
        <span class="tf-tips-title">{{ t('result.flow.tips') }}</span>
        <p class="tf-tips-text">{{ tripPlan.overall_suggestions }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trip-flow {
  padding: 4px 4px 8px;
}

/* ===== 起点城市卡 ===== */
.tf-origin {
  background: linear-gradient(135deg, rgba(217, 119, 87, 0.1), rgba(217, 119, 87, 0.04));
  border: 1px solid rgba(217, 119, 87, 0.18);
  border-radius: 16px;
  padding: 18px 22px;
  margin-bottom: 8px;
}

.tf-origin-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tf-origin-icon {
  font-size: 20px;
}

.tf-origin-route {
  font-size: 20px;
  font-weight: 700;
  color: #3D3229;
  line-height: 1.3;
}

.tf-origin-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}

.tf-origin-dates {
  font-size: 13px;
  color: rgba(61, 50, 41, 0.55);
}

.tf-origin-badge {
  font-size: 12px;
  font-weight: 600;
  color: #C4603D;
  background: rgba(217, 119, 87, 0.12);
  padding: 3px 10px;
  border-radius: 999px;
}

/* ===== 时间线 ===== */
.tf-timeline {
  position: relative;
  padding: 8px 0;
}

/* 贯穿竖脊 */
.tf-timeline::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 24px;
  bottom: 24px;
  width: 2px;
  background: linear-gradient(180deg, rgba(217, 119, 87, 0.5), rgba(217, 119, 87, 0.2));
  border-radius: 2px;
}

.tf-day {
  position: relative;
  padding-left: 48px;
  padding-bottom: 16px;
}

.tf-day:last-child {
  padding-bottom: 0;
}

.tf-day-dot {
  position: absolute;
  left: 0;
  top: 6px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #D97757;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(217, 119, 87, 0.3);
  z-index: 1;
}

.tf-day-card {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 16px;
  padding: 14px 16px;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.tf-day-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 26px rgba(61, 50, 41, 0.1);
  border-color: rgba(217, 119, 87, 0.35);
}

.tf-day-card:focus-visible {
  outline: 2px solid rgba(217, 119, 87, 0.5);
  outline-offset: 2px;
}

.tf-day-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.tf-day-headline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.tf-day-no {
  font-size: 16px;
  font-weight: 700;
  color: #3D3229;
}

.tf-day-city {
  font-size: 12px;
  font-weight: 600;
  color: #3a9c7a;
  background: rgba(90, 216, 166, 0.12);
  border: 1px solid rgba(90, 216, 166, 0.22);
  padding: 2px 8px;
  border-radius: 6px;
}

.tf-day-transfer {
  font-size: 12px;
  font-weight: 600;
  color: #C4603D;
  background: rgba(217, 119, 87, 0.12);
  padding: 2px 8px;
  border-radius: 6px;
}

.tf-day-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.tf-day-date {
  font-size: 12px;
  color: rgba(61, 50, 41, 0.5);
  white-space: nowrap;
}

.tf-day-weather {
  font-size: 13px;
  font-weight: 600;
  color: rgba(61, 50, 41, 0.7);
  white-space: nowrap;
}

.tf-transfer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #C4603D;
  background: rgba(217, 119, 87, 0.06);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 10px;
}

.tf-transfer-icon {
  font-size: 14px;
}

/* 每一行信息（景点 / 酒店 / 餐饮） */
.tf-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
}

.tf-line + .tf-line {
  border-top: 1px dashed rgba(61, 50, 41, 0.07);
}

.tf-line-icon {
  font-size: 14px;
  line-height: 22px;
  flex-shrink: 0;
}

.tf-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tf-chip {
  font-size: 13px;
  color: #3D3229;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(61, 50, 41, 0.05);
  border: 1px solid rgba(61, 50, 41, 0.06);
}

.tf-chip--attraction {
  color: #2f8f6d;
  background: rgba(90, 216, 166, 0.1);
  border-color: rgba(90, 216, 166, 0.2);
}

.tf-hotel-name {
  font-size: 13px;
  font-weight: 600;
  color: #3D3229;
  line-height: 22px;
}

.tf-hotel-cost {
  font-size: 12px;
  color: #b8801f;
  background: rgba(246, 189, 22, 0.14);
  padding: 1px 8px;
  border-radius: 6px;
  line-height: 20px;
}

.tf-meals {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.tf-meal {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
}

.tf-meal-type {
  color: rgba(61, 50, 41, 0.5);
}

.tf-meal-name {
  color: #3D3229;
  font-weight: 500;
}

/* ===== 收尾卡（预算 / 贴士） ===== */
.tf-summary {
  border-radius: 16px;
  padding: 14px 18px;
  margin-top: 12px;
}

.tf-summary-icon {
  font-size: 16px;
}

.tf-budget {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  background: rgba(255, 152, 69, 0.08);
  border: 1px solid rgba(255, 152, 69, 0.18);
}

.tf-budget-total {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
}

.tf-budget-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.tf-budget-item {
  font-size: 12px;
  color: rgba(61, 50, 41, 0.6);
}

.tf-tips {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: rgba(179, 127, 235, 0.07);
  border: 1px solid rgba(179, 127, 235, 0.16);
}

.tf-tips-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.tf-tips-title {
  font-size: 13px;
  font-weight: 700;
  color: #7c4fb0;
}

.tf-tips-text {
  font-size: 13px;
  color: rgba(61, 50, 41, 0.75);
  line-height: 1.6;
  margin: 0;
}

@media (max-width: 640px) {
  .tf-origin-route {
    font-size: 17px;
  }

  .tf-day {
    padding-left: 40px;
  }

  .tf-timeline::before {
    left: 13px;
  }

  .tf-day-dot {
    width: 28px;
    height: 28px;
    font-size: 13px;
  }

  .tf-day-head {
    flex-direction: column;
    gap: 6px;
  }

  .tf-day-right {
    gap: 8px;
  }
}
</style>
