<script setup lang="ts">
import type {
  BudgetLedgerItemDto,
  BudgetLedgerResponseDto,
  ExecutionMapDto,
  ItemExecutionStatusDto,
} from '@youban/contracts'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BudgetLedger from './BudgetLedger.vue'
import DailyItinerary from './DailyItinerary.vue'
import TripMap from './TripMap.vue'
import TripToday from './TripToday.vue'
import WeatherDayCard from './WeatherDayCard.vue'
import { waitForAmapVisibilityFrame } from '@/features/map/amap-capture'
import { getApiBaseUrl } from '@/http/client'
import { resolveMediaUrl } from '@/features/result/model'
import type { TripAttraction, TripDay, TripPlan } from '@/features/result/model'
import { resolveAvailableResultSection, resultSectionAnchor } from '@/features/result/section-state'

type ResultSection = 'today' | 'overview' | 'days' | 'map' | 'budget' | 'weather'

const props = withDefaults(defineProps<{
  plan: TripPlan
  planId?: string
  readonly?: boolean
  editable?: boolean
  shareReady?: boolean
  budgetLedger?: BudgetLedgerResponseDto | null
  execution?: ExecutionMapDto
  statusBusy?: boolean
  actionsBusy?: boolean
  initialSection?: ResultSection
  enhancementStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | null
}>(), {
  planId: '',
  readonly: false,
  editable: false,
  shareReady: true,
  budgetLedger: null,
  execution: () => ({}),
  statusBusy: false,
  actionsBusy: false,
  initialSection: 'overview',
  enhancementStatus: null,
})

const emit = defineEmits<{
  share: []
  export: [format: 'image' | 'pdf']
  calendar: []
  edit: []
  budgetAdd: []
  attractionAdd: []
  budgetEdit: [item: BudgetLedgerItemDto]
  budgetDelete: [item: BudgetLedgerItemDto]
  budgetRestore: [item: BudgetLedgerItemDto]
  itemStatus: [payload: { itemId: string, status: ItemExecutionStatusDto, actualCost?: number }]
}>()

const { locale, t } = useI18n()

const sectionLabels = computed<Record<ResultSection, string>>(() => ({
  today: t('result.side.today'),
  overview: t('result.side.overview'),
  days: t('result.side.days'),
  map: t('result.side.map'),
  budget: t('result.side.budget'),
  weather: t('result.side.weather'),
}))

const activeSection = ref<ResultSection>(props.initialSection)
const requestedSection = ref<ResultSection>(props.initialSection)
const sectionScrollTarget = ref('')
const activeWeatherIndex = ref(0)
const exportMenuOpen = ref(false)
const tripMapRef = ref<{ captureScreenshot: () => Promise<string> } | null>(null)
const localeTag = computed(() => ({ zh: 'zh-CN', en: 'en-US', fr: 'fr-FR' }[locale.value] || locale.value))
const noticeDismissed = ref(false)
const allAttractions = computed(() => props.plan.days.flatMap((day, dayIndex) =>
  day.attractions.map((attraction, attractionIndex) => ({ attraction, day, dayIndex, attractionIndex })),
))
const availableSections = computed<ResultSection[]>(() => {
  const result: ResultSection[] = props.readonly ? [] : ['today']
  result.push('overview', 'days', 'map')
  if (props.plan.budget || props.budgetLedger)
    result.push('budget')
  if (props.plan.weather_info.length)
    result.push('weather')
  return result
})
const cities = computed(() => props.plan.days.map(day => day.city || props.plan.city)
  .filter((value, index, values) => value && values.indexOf(value) === index))
const blueprintThemes = computed(() => {
  const themes = new Set<string>()
  for (const stage of props.plan.blueprint?.stages || []) {
    if (stage.theme)
      themes.add(stage.theme)
  }
  return [...themes].slice(0, 3)
})
const journeyTitle = computed(() => props.plan.blueprint?.title || t('result.overviewTitle', { city: props.plan.city }))
const journeySummary = computed(() => props.plan.blueprint?.summary || props.plan.overall_suggestions)
const enhancementMessage = computed(() => {
  if (noticeDismissed.value || !props.enhancementStatus)
    return ''
  return t(`result.enhancement.${props.enhancementStatus}`)
})
const enhancementTerminal = computed(() => ['completed', 'failed', 'skipped'].includes(props.enhancementStatus || ''))

const journeyAccents = ['#4caf7d', '#5b8ff9', '#b37feb', '#f0a83c', '#e8684a', '#4fb8c9', '#d7709e']

function weatherFor(day: TripDay) {
  return props.plan.weather_info.find(item => item.date === day.date)
}

function journeyAccent(index: number): string {
  return journeyAccents[index % journeyAccents.length]
}

async function revealActiveSection(): Promise<void> {
  sectionScrollTarget.value = ''
  await nextTick()
  sectionScrollTarget.value = resultSectionAnchor(activeSection.value)
}

watch(availableSections, (sections) => {
  activeSection.value = resolveAvailableResultSection(activeSection.value, requestedSection.value, sections)
  void revealActiveSection()
}, { immediate: true })

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : value
}

function formatLongDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match)
    return value
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function formatMoney(value: number | undefined): string {
  return Number(value || 0).toLocaleString(locale.value, { maximumFractionDigits: 0 })
}

function attractionImage(attraction: TripAttraction): string {
  return resolveMediaUrl(attraction.image_url, getApiBaseUrl())
}

function attractionTime(attraction: TripAttraction): string {
  if (attraction.start_time && attraction.end_time)
    return `${attraction.start_time} - ${attraction.end_time}`
  if (attraction.start_time)
    return attraction.start_time
  if (attraction.visit_duration)
    return t('result.daily.recommendedVisitDuration', { duration: t('result.daily.durationMinutes', { minutes: attraction.visit_duration }) })
  return t('result.daily.timePending')
}

function setSection(section: ResultSection): void {
  requestedSection.value = section
  activeSection.value = section
  void revealActiveSection()
}

function chooseExport(format: 'image' | 'pdf'): void {
  exportMenuOpen.value = false
  emit('export', format)
}

async function captureMapScreenshot(): Promise<string> {
  const previous = activeSection.value
  activeSection.value = 'map'
  await nextTick()
  // #ifdef H5
  await waitForAmapVisibilityFrame()
  // #endif
  try {
    return await tripMapRef.value?.captureScreenshot() || ''
  }
  catch {
    return ''
  }
  finally {
    activeSection.value = previous
    await nextTick()
  }
}

defineExpose({ captureMapScreenshot })
</script>

<template>
  <view class="result-surface">
    <view class="result-panel">
      <view class="result-toolbar">
        <scroll-view scroll-x class="section-scroll" :scroll-into-view="sectionScrollTarget" :show-scrollbar="false">
          <view class="section-tabs">
            <button
              v-for="section in availableSections"
              :id="resultSectionAnchor(section)"
              :key="section"
              class="section-tab"
              :class="{ active: activeSection === section }"
              @click="setSection(section)"
            >
              {{ sectionLabels[section] }}
            </button>
          </view>
        </scroll-view>
        <view class="toolbar-actions">
          <template v-if="!props.readonly">
            <!-- #ifdef MP-WEIXIN -->
            <button class="action-button" :disabled="!props.shareReady" open-type="share" @click="emit('share')">
              <wd-icon name="share-alt" size="13px" />
              <text>{{ t('result.share.button') }}</text>
            </button>
            <!-- #endif -->
            <!-- #ifndef MP-WEIXIN -->
            <button class="action-button" :disabled="!props.shareReady" @click="emit('share')">
              <wd-icon name="share-alt" size="13px" />
              <text>{{ t('result.share.button') }}</text>
            </button>
            <!-- #endif -->
            <button v-if="props.editable" class="action-button" @click="emit('edit')">
              <wd-icon name="edit-outline" size="16px" />
              <text>{{ t('result.editTrip') }}</text>
            </button>
          </template>
          <!-- #ifdef H5 -->
          <view class="export-control">
            <button class="action-button" :disabled="props.actionsBusy" @click="exportMenuOpen = !exportMenuOpen">
              <wd-icon name="download" size="13px" />
              <text>{{ t('result.exportImage') }}</text>
              <wd-icon name="arrow-down" size="10px" />
            </button>
            <view v-if="exportMenuOpen" class="guide-export-menu">
              <button class="guide-export-option" @click="chooseExport('image')">
                <wd-icon name="image" size="18px" />
                <view><strong>{{ t('result.export.imageOption') }}</strong><small>{{ t('result.export.imageOptionDescription') }}</small></view>
              </button>
              <button class="guide-export-option" @click="chooseExport('pdf')">
                <wd-icon name="file" size="18px" />
                <view><strong>{{ t('result.export.pdfOption') }}</strong><small>{{ t('result.export.pdfOptionDescription') }}</small></view>
              </button>
            </view>
          </view>
          <!-- #endif -->
          <!-- #ifndef H5 -->
          <button class="action-button" :disabled="props.actionsBusy" @click="chooseExport('image')">
            <wd-icon name="download" size="13px" />
            <text>{{ t('result.exportImage') }}</text>
          </button>
          <!-- #endif -->
          <button class="action-button" @click="emit('calendar')">
            <wd-icon name="calendar-line" size="13px" />
            <text>{{ t('result.exportCalendar') }}</text>
          </button>
        </view>
      </view>

      <view v-if="props.readonly" class="readonly-banner">
        {{ t('result.share.readonlyBanner') }}
      </view>

      <view v-if="enhancementMessage" class="enhancement-notice" role="status">
        <text>{{ enhancementMessage }}</text>
        <button v-if="enhancementTerminal" :aria-label="t('result.enhancement.dismiss')" @click="noticeDismissed = true">
          ×
        </button>
      </view>

      <view v-show="activeSection === 'overview'" class="section-content overview-section">
        <view class="overview-journey">
          <view class="journey-hero">
            <text class="journey-eyebrow">{{ t('result.side.graph') }}</text>
            <text class="journey-title">{{ journeyTitle }}</text>
            <text v-if="journeySummary" class="journey-summary">{{ journeySummary }}</text>
            <view v-if="blueprintThemes.length" class="journey-pills">
              <view v-for="theme in blueprintThemes" :key="theme" class="journey-pill">
                <text class="journey-pill-dot" />
                <text>{{ theme }}</text>
              </view>
            </view>
          </view>

          <view class="journey-track-wrap">
            <view class="journey-track-toolbar">
              <text class="journey-marker">{{ t('result.graph.journeyStart') }}</text>
              <text class="journey-marker journey-marker-end">{{ t('result.graph.journeyEnd') }}</text>
            </view>
            <scroll-view scroll-x class="journey-track" :show-scrollbar="false">
              <view class="journey-rail" />
              <view class="journey-track-group">
                <button
                  v-for="(day, index) in plan.days"
                  :key="`${day.date}-${index}`"
                  class="journey-stop"
                  :style="{ '--journey-accent': journeyAccent(index) }"
                  @click="setSection('days')"
                >
                  <text class="journey-day">D{{ index + 1 }}</text>
                  <view class="journey-pin">
                    <text>{{ (day.city || plan.city).slice(0, 1) || '·' }}</text>
                  </view>
                  <view class="journey-info">
                    <text class="journey-city">{{ day.city || plan.city }}</text>
                    <text v-if="weatherFor(day)" class="journey-weather">
                      {{ weatherFor(day)?.day_weather }} {{ weatherFor(day)?.day_temp }}°
                    </text>
                    <view class="journey-spots">
                      <text v-for="attraction in day.attractions.slice(0, 3)" :key="attraction.name">
                        {{ attraction.name }}
                      </text>
                    </view>
                  </view>
                </button>
                <view class="journey-stop journey-stop-end">
                  <text class="journey-day">&nbsp;</text>
                  <view class="journey-pin journey-pin-plane">
                    <text>✈</text>
                  </view>
                </view>
              </view>
            </scroll-view>
          </view>
        </view>

        <view v-if="allAttractions.length" class="overview-grid">
          <view
            v-for="({ attraction, dayIndex, attractionIndex }, visualIndex) in allAttractions"
            :key="`${dayIndex}-${attractionIndex}-${attraction.name}`"
            class="overview-attraction"
          >
            <view class="overview-attraction-media" :class="`overview-attraction-media-${visualIndex % 5}`">
              <image
                v-if="attractionImage(attraction)"
                class="overview-attraction-image"
                :src="attractionImage(attraction)"
                mode="aspectFill"
              />
              <view v-else class="overview-attraction-fallback">
                {{ attraction.name }}
              </view>
              <text class="overview-day-badge">D{{ dayIndex + 1 }}</text>
            </view>
            <view class="overview-attraction-copy">
              <text class="overview-attraction-name">{{ attraction.name }}</text>
              <text class="overview-attraction-description">
                {{ attraction.description || attraction.address || t('common.noData') }}
              </text>
            </view>
          </view>
        </view>
        <view v-else class="empty-section">
          {{ t('result.noTripPlanDesc') }}
        </view>

        <view class="overview-meta">
          <text class="meta-accent">{{ t('result.dateRange', { start: formatLongDate(plan.start_date), end: formatLongDate(plan.end_date) }) }}</text>
          <text v-if="planId">Plan ID: {{ planId }}</text>
          <text v-if="plan.overall_suggestions">{{ plan.overall_suggestions }}</text>
        </view>
      </view>

      <view v-show="activeSection === 'today'" class="section-content today-section">
        <TripToday
          :plan="plan"
          :execution="execution"
          :status-busy="statusBusy"
          @item-status="payload => emit('itemStatus', payload)"
        />
      </view>

      <view v-show="activeSection === 'days'" class="section-content days-section">
        <DailyItinerary :plan="plan" />
      </view>

      <view v-show="activeSection === 'map'" class="section-content map-section">
        <TripMap ref="tripMapRef" :plan="plan" :active="activeSection === 'map'" />
      </view>

      <view v-show="activeSection === 'budget'" v-if="plan.budget || budgetLedger" class="section-content budget-section">
        <BudgetLedger
          v-if="budgetLedger"
          :ledger="budgetLedger"
          :readonly="props.readonly"
          @add="emit('budgetAdd')"
          @add-attraction="emit('attractionAdd')"
          @edit="item => emit('budgetEdit', item)"
          @delete="item => emit('budgetDelete', item)"
          @restore="item => emit('budgetRestore', item)"
        />
        <view v-else-if="plan.budget" class="budget-fallback">
          <view class="budget-total">
            <text class="eyebrow">BUDGET</text>
            <view><text class="currency">¥</text><text class="total-number">{{ formatMoney(plan.budget.total) }}</text></view>
            <text>{{ plan.budget_basis === 'per_person' ? t('result.budget.perPerson') : t('result.budget.groupTotal') }}</text>
          </view>
          <view class="budget-breakdown">
            <view><text>{{ t('result.budget.attraction') }}</text><strong>¥{{ formatMoney(plan.budget.total_attractions) }}</strong></view>
            <view><text>{{ t('result.budget.hotel') }}</text><strong>¥{{ formatMoney(plan.budget.total_hotels) }}</strong></view>
            <view><text>{{ t('result.budget.meal') }}</text><strong>¥{{ formatMoney(plan.budget.total_meals) }}</strong></view>
            <view><text>{{ t('result.budget.transport') }}</text><strong>¥{{ formatMoney(plan.budget.total_transportation) }}</strong></view>
            <view v-if="plan.budget.total_inter_city_transport">
              <text>{{ t('result.interCityTransport') }}</text><strong>¥{{ formatMoney(plan.budget.total_inter_city_transport) }}</strong>
            </view>
            <view v-if="plan.budget.total_other">
              <text>{{ t('result.budget.other') }}</text><strong>¥{{ formatMoney(plan.budget.total_other) }}</strong>
            </view>
          </view>
          <view v-if="plan.budget_adjustment_note" class="budget-note">
            {{ plan.budget_adjustment_note }}
          </view>
        </view>
      </view>

      <view v-show="activeSection === 'weather'" class="section-content weather-section">
        <view class="weather-section-card">
          <view class="weather-dashboard">
            <view class="weather-grid">
              <WeatherDayCard
                v-for="(weather, index) in plan.weather_info"
                :key="`${weather.date}-${index}`"
                :weather="weather"
                :day-number="index + 1"
                :active="index === activeWeatherIndex"
                :locale-tag="localeTag"
                @select="dayNumber => activeWeatherIndex = dayNumber - 1"
              />
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.result-surface {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 20px 20px 44px;
  color: var(--text-primary);
  background: var(--surface-page);
}
.result-panel {
  box-sizing: border-box;
  width: 100%;
  max-width: 1240px;
  min-width: 0;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid var(--border-subtle);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.68);
  box-shadow: 0 20px 50px rgba(61, 50, 41, 0.08);
  /* #ifdef H5 */
  container-type: inline-size;
  /* #endif */
}
.result-toolbar {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -20px -20px 16px;
  padding: 10px 20px 8px;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 22px 22px 0 0;
  background: rgba(255, 250, 246, 0.94);
  box-sizing: border-box;
  height: 57px;
}
.section-scroll {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}
.section-tabs,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.export-control {
  position: relative;
}
.guide-export-menu {
  position: absolute;
  z-index: 80;
  top: calc(100% + 4px);
  right: 0;
  box-sizing: border-box;
  width: 300px;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: #fff;
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.08),
    0 3px 6px -4px rgba(0, 0, 0, 0.12),
    0 9px 28px 8px rgba(0, 0, 0, 0.05);
}
.guide-export-option {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  min-height: 60px;
  margin: 0;
  padding: 10px 12px;
  align-items: flex-start;
  gap: 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  grid-template-columns: 20px minmax(0, 1fr);
  line-height: 1.4;
  text-align: left;
}
.guide-export-option::after {
  display: none;
}
.guide-export-option:hover {
  background: rgba(61, 50, 41, 0.05);
}
.guide-export-option view {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.guide-export-option strong,
.guide-export-option small {
  display: block;
}
.guide-export-option strong {
  font-size: 14px;
  font-weight: 600;
}
.guide-export-option small {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.section-tab,
.action-button,
.text-command,
.journey-stop {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  line-height: 1.4;
}
.section-tab::after,
.action-button::after,
.text-command::after,
.journey-stop::after {
  display: none;
}
.section-tab {
  position: relative;
  flex: none;
  min-height: 42px;
  padding: 10px 13px;
  color: var(--text-secondary);
  font-size: 14px;
}
.section-tab.active {
  color: var(--accent-strong);
  font-weight: 700;
}
.section-tab.active::before {
  position: absolute;
  right: 12px;
  bottom: -8px;
  left: 12px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent-primary);
  content: '';
}
.toolbar-actions {
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  transform: translateY(2px);
}
.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: auto;
  height: 34px;
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 20.4286px;
}
.action-button[disabled] {
  opacity: 0.48;
}
.readonly-banner {
  margin-bottom: 18px;
  padding: 12px 14px;
  border: 1px solid rgba(58, 156, 122, 0.24);
  border-radius: 8px;
  background: rgba(58, 156, 122, 0.08);
  color: #2f795f;
  font-size: 13px;
  line-height: 1.6;
}
.enhancement-notice {
  display: flex;
  min-height: 25px;
  margin: 2px 0 14px;
  padding: 4px 0;
  align-items: flex-start;
  box-sizing: border-box;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
  gap: 8px;
}
.enhancement-notice button {
  width: 22px;
  height: 22px;
  margin: -1px 0 0 auto;
  padding: 0;
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 19px;
  line-height: 20px;
}
.enhancement-notice button::after {
  display: none;
}
.section-content {
  animation: section-in 0.25s ease;
}
.journey-heading,
.section-heading,
.day-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}
.eyebrow,
.day-number {
  display: block;
  margin-bottom: 7px;
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 800;
}
.journey-title,
.section-title,
.day-title {
  display: block;
  font-size: 26px;
  font-weight: 750;
  line-height: 1.3;
}
.journey-summary {
  display: block;
  max-width: 720px;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
}
.journey-date,
.section-date,
.day-date {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}
.date-separator {
  color: var(--accent-primary);
}
.journey-scroll {
  margin: 24px 0;
  padding: 4px 0 18px;
  border-bottom: 1px solid var(--border-subtle);
}
.journey-line {
  display: flex;
  align-items: stretch;
  min-width: max-content;
}
.journey-stop {
  position: relative;
  display: flex;
  width: 180px;
  padding: 0 30px 0 0;
  flex-direction: column;
  text-align: left;
}
.stop-index {
  display: inline-flex;
  align-self: flex-start;
  padding: 4px 7px;
  border-radius: 5px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 800;
}
.stop-city {
  margin-top: 8px;
  font-size: 15px;
  font-weight: 700;
}
.stop-description {
  display: -webkit-box;
  margin-top: 3px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.attraction-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}
.attraction-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}
.attraction-image,
.attraction-fallback {
  width: 100%;
  height: 142px;
}
.attraction-fallback {
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  box-sizing: border-box;
  padding: 14px;
  background: linear-gradient(145deg, #e4efe9, #f4dfb9 58%, #d9a48a);
  color: rgba(61, 50, 41, 0.72);
  font-size: 34px;
  font-weight: 800;
}
.attraction-copy {
  padding: 12px;
}
.attraction-kicker {
  color: var(--accent-strong);
  font-size: 10px;
  font-weight: 700;
}
.attraction-name {
  margin-top: 5px;
  font-size: 16px;
  font-weight: 750;
  line-height: 1.4;
}
.attraction-description {
  display: -webkit-box;
  margin-top: 6px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.text-command {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 4px;
  margin-top: 9px;
  padding: 0;
  color: #2f795f;
  font-size: 12px;
  text-align: left;
}
.text-command text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 18px;
  padding-top: 15px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 12px;
}
.meta-accent {
  color: var(--accent-strong);
  font-weight: 700;
}
.empty-section,
.map-empty,
.today-empty,
.column-empty {
  box-sizing: border-box;
  width: 100%;
  padding: 48px 20px;
  color: var(--text-secondary);
  text-align: center;
}
.today-section,
.days-section,
.map-section,
.budget-section,
.weather-section {
  padding: 8px 0 4px;
}
.today-section {
  box-sizing: border-box;
  margin-top: 20px;
  padding: 18px 20px 24px;
}
.days-section {
  margin-top: 20px;
  padding: 0;
}
.map-section {
  padding: 0;
}
.budget-section {
  padding: 0;
}
.weather-section {
  padding: 0;
}
.day-intro,
.transfer-banner,
.budget-note {
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid rgba(217, 119, 87, 0.2);
  border-radius: 7px;
  background: rgba(217, 119, 87, 0.07);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.timeline {
  max-width: 780px;
  margin: 26px auto 8px;
}
.timeline-item {
  display: grid;
  grid-template-columns: 62px 14px minmax(0, 1fr);
  gap: 12px;
  min-height: 98px;
}
.timeline-time {
  padding-top: 1px;
  color: var(--accent-strong);
  font-size: 13px;
  font-weight: 700;
}
.timeline-dot {
  position: relative;
  width: 10px;
  height: 10px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
}
.timeline-dot::after {
  position: absolute;
  top: 11px;
  left: 4px;
  width: 1px;
  height: 82px;
  background: rgba(217, 119, 87, 0.3);
  content: '';
}
.timeline-item:last-child .timeline-dot::after {
  display: none;
}
.timeline-title {
  font-size: 16px;
  font-weight: 700;
}
.timeline-description {
  margin-top: 5px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.today-progress {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 4px;
}
.timeline-head,
.timeline-actions,
.done-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}
.status-tag {
  padding: 2px 7px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--status-success) 12%, transparent);
  color: var(--status-success);
  font-size: 10px;
}
.timeline-item.is-skipped,
.timeline-item.is-postponed {
  opacity: 0.65;
}
.timeline-actions {
  margin-top: 10px;
  flex-wrap: wrap;
}
.status-command,
.done-actions button {
  box-sizing: border-box;
  min-height: 30px;
  margin: 0;
  padding: 5px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}
.status-command::after,
.done-actions button::after {
  display: none;
}
.status-command.primary,
.done-actions button.primary {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: white;
}
.done-modal-layer,
.done-modal-mask {
  position: fixed;
  z-index: 150;
  inset: 0;
}
.done-modal-mask {
  background: rgba(38, 31, 26, 0.42);
}
.done-dialog {
  position: absolute;
  z-index: 151;
  top: 50%;
  left: 50%;
  display: flex;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 28px));
  padding: 20px;
  border-radius: 8px;
  background: var(--surface-elevated);
  box-shadow: 0 22px 60px rgba(38, 31, 26, 0.24);
  transform: translate(-50%, -50%);
  flex-direction: column;
  gap: 12px;
}
.done-title {
  font-size: 18px;
  font-weight: 750;
}
.done-name {
  color: var(--text-secondary);
  font-size: 14px;
}
.done-cost {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}
.done-cost input {
  box-sizing: border-box;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-page);
  color: var(--text-primary);
}
.done-actions {
  justify-content: flex-end;
}
.today-empty {
  display: flex;
  min-height: 330px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
}
.today-empty-title {
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 700;
}
.day-block {
  padding: 24px 0 28px;
  border-bottom: 1px solid var(--border-subtle);
}
.day-block:first-child {
  padding-top: 4px;
}
.day-block:last-child {
  border-bottom: 0;
}
.day-info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0;
}
.day-info-grid > view {
  display: flex;
  min-width: 0;
  padding: 12px;
  border-radius: 7px;
  background: var(--surface-soft);
  flex-direction: column;
  gap: 5px;
}
.day-info-grid text,
.meal-row > text {
  color: var(--text-secondary);
  font-size: 12px;
}
.day-info-grid strong {
  font-size: 13px;
  line-height: 1.5;
}
.day-columns {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.8fr);
  gap: 24px;
}
.day-column {
  min-width: 0;
}
.column-title {
  display: block;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 800;
}
.schedule-row {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--border-subtle);
}
.schedule-time {
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
}
.schedule-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.schedule-name,
.meal-name,
.hotel-name {
  font-size: 14px;
  font-weight: 700;
}
.meal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-top: 1px solid var(--border-subtle);
}
.meal-row > view {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.meal-type {
  color: #2f795f;
  font-size: 10px;
  font-weight: 800;
}
.hotel-note {
  display: flex;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
  flex-direction: column;
  gap: 5px;
}
.hotel-note .column-title {
  margin-bottom: 2px;
}
.budget-fallback {
  display: grid;
  grid-template-columns: minmax(250px, 0.62fr) minmax(0, 1.38fr);
  gap: 28px;
  align-items: start;
}
.budget-total {
  min-height: 240px;
  padding: 28px;
  border-radius: 8px;
  background: #3d3229;
  color: rgba(255, 255, 255, 0.72);
}
.budget-total .eyebrow {
  color: #f2b08d;
}
.budget-total > view {
  margin: 34px 0 10px;
  color: white;
}
.currency {
  margin-right: 5px;
  font-size: 22px;
}
.total-number {
  font-size: 48px;
  font-weight: 780;
}
.budget-breakdown {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.budget-breakdown > view {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.68);
  color: var(--text-secondary);
  font-size: 13px;
}
.budget-breakdown strong {
  color: var(--text-primary);
  font-size: 18px;
}
.budget-note {
  grid-column: 1 / -1;
  margin-top: 0;
}
.weather-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.weather-section-card {
  box-sizing: border-box;
  overflow: hidden;
  margin-bottom: 20px;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.55);
}
.weather-dashboard {
  padding: 8px 0 16px;
}
.overview-journey {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-subtle);
}
.journey-hero {
  box-sizing: border-box;
  padding: 26px 28px 24px;
  border: 1px solid #ead9b8;
  border-radius: 20px;
  background: #fff9eb;
}
.journey-eyebrow {
  display: block;
  margin-bottom: 6px;
  color: #b39a6c;
  font-size: 12px;
  font-weight: 700;
}
.journey-title {
  display: block;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
}
.journey-summary {
  display: block;
  max-width: 560px;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.journey-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
.journey-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 13px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  gap: 7px;
}
.journey-pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-primary);
}
.journey-track-wrap {
  position: relative;
  margin-top: 21px;
}
.journey-track-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  min-height: 40px;
  margin-bottom: 10px;
  padding: 0 14px;
}
.journey-marker {
  color: #b39a6c;
  font-size: 11px;
  font-weight: 700;
}
.journey-track {
  position: relative;
  height: 203px;
  padding-bottom: 8px;
  overflow: hidden;
}
.journey-track-group {
  position: relative;
  display: flex;
  width: 100%;
  min-width: max-content;
  gap: 4px;
}
.journey-rail {
  position: absolute;
  z-index: 0;
  top: 68px;
  right: 70px;
  left: 70px;
  border-top: 2px dashed #ddc9a4;
}
.journey-stop {
  position: relative;
  z-index: 1;
  display: flex;
  box-sizing: border-box;
  width: auto;
  min-width: 130px;
  margin: 0;
  padding: 0 6px;
  flex: 1 0 130px;
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  flex-direction: column;
  line-height: 1.4;
  text-align: center;
}
.journey-stop::after {
  display: none !important;
}
.journey-day {
  height: 20px;
  margin-bottom: 12px;
  color: var(--journey-accent, #b09a77);
  font-size: 13px;
  font-weight: 700;
}
.journey-pin {
  position: relative;
  display: grid;
  box-sizing: border-box;
  width: 72px;
  height: 72px;
  border: 3px solid var(--journey-accent, #5b8ff9);
  border-radius: 50%;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 24px;
  font-weight: 700;
  place-items: center;
}
.journey-pin::after {
  position: absolute;
  bottom: -17px;
  left: 50%;
  border: 6px solid transparent;
  border-top: 8px solid var(--journey-accent, #5b8ff9);
  content: '';
  transform: translateX(-50%);
}
.journey-pin-plane {
  border-style: dashed;
  border-color: #ddc9a4;
  color: #b39a6c;
}
.journey-pin-plane::after {
  border-top-color: #ddc9a4;
}
.journey-info {
  display: flex;
  align-items: center;
  margin-top: 14px;
  flex-direction: column;
}
.journey-city {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
}
.journey-weather {
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--text-secondary);
  font-size: 11px;
}
.journey-spots {
  display: flex;
  align-items: center;
  margin-top: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  flex-direction: column;
  gap: 2px;
}
.overview-grid {
  width: 100%;
  padding: 4px 0 12px;
  column-count: 5;
  column-gap: 16px;
}
.overview-attraction {
  display: inline-flex;
  width: 100%;
  min-width: 0;
  margin-bottom: 20px;
  break-inside: avoid;
  flex-direction: column;
}
.overview-attraction-media {
  position: relative;
  overflow: hidden;
  width: 100%;
  border-radius: 10px;
  background: var(--surface-soft);
}
.overview-attraction-media-0 {
  aspect-ratio: 4 / 3;
}
.overview-attraction-media-1 {
  aspect-ratio: 3 / 4;
}
.overview-attraction-media-2 {
  aspect-ratio: 1;
}
.overview-attraction-media-3 {
  aspect-ratio: 4 / 5;
}
.overview-attraction-media-4 {
  aspect-ratio: 5 / 4;
}
.overview-attraction-image,
.overview-attraction-fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.overview-attraction-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 16px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}
.overview-day-badge {
  position: absolute;
  z-index: 2;
  top: 10px;
  left: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(61, 50, 41, 0.68);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.overview-attraction-copy {
  display: flex;
  padding: 10px 4px 0;
  flex-direction: column;
}
.overview-attraction-name {
  margin-bottom: 4px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
}
.overview-attraction-description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.overview-section {
  margin-bottom: 20px;
}
.overview-meta {
  margin-top: 8px;
  padding-top: 16px;
  line-height: 1.5;
}
/* #ifdef H5 */
@container (max-width: 1120px) {
  .overview-grid {
    column-count: 4;
  }
}
@container (max-width: 900px) {
  .overview-grid {
    column-count: 3;
  }
}
@container (max-width: 640px) {
  .overview-grid {
    column-count: 2;
  }
}
/* #endif */
@keyframes section-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 1050px) {
  .attraction-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 1023px) {
  .weather-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 820px) {
  .result-surface {
    padding: 12px 10px 30px;
  }
  .result-panel {
    padding: 14px;
    border-radius: 16px;
  }
  .result-toolbar {
    top: 0;
    height: auto;
    min-height: 94px;
    align-items: stretch;
    margin: -14px -14px 14px;
    padding: 8px 12px;
    border-radius: 16px 16px 0 0;
    flex-direction: column;
  }
  .section-tab.active::before {
    bottom: -8px;
  }
  .toolbar-actions {
    justify-content: flex-start;
    overflow-x: auto;
    flex-wrap: nowrap;
  }
  .section-scroll {
    width: 100%;
    flex: none;
  }
  .attraction-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .overview-grid {
    column-count: 2;
    column-gap: 10px;
  }
  .day-columns {
    grid-template-columns: 1fr;
  }
  .budget-fallback {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 560px) {
  .journey-heading,
  .section-heading,
  .day-header {
    flex-direction: column;
    gap: 10px;
  }
  .journey-title,
  .section-title,
  .day-title {
    font-size: 22px;
  }
  .journey-hero {
    padding: 20px 18px;
    border-radius: 16px;
  }
  .journey-track-toolbar {
    min-height: 24px;
    padding: 0;
  }
  .journey-track {
    height: auto;
  }
  .journey-marker {
    display: none;
  }
  .attraction-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .attraction-image,
  .attraction-fallback {
    height: 116px;
  }
  .day-info-grid {
    grid-template-columns: 1fr;
  }
  .budget-breakdown {
    grid-template-columns: 1fr;
  }
  .total-number {
    font-size: 40px;
  }
}
@media (max-width: 640px) {
  .weather-grid {
    grid-template-columns: 1fr;
  }
}
</style>
