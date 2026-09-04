<script setup lang="ts">
import type {
  BudgetLedgerItemDto,
  BudgetLedgerResponseDto,
  ExecutionMapDto,
  ItemExecutionStatusDto,
} from '@youban/contracts'
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BudgetLedger from './BudgetLedger.vue'
import DailyItinerary from './DailyItinerary.vue'
import TripMap from './TripMap.vue'
import TripToday from './TripToday.vue'
import WeatherDayCard from './WeatherDayCard.vue'
import { waitForAmapVisibilityFrame } from '@/features/map/amap-capture'
import { getApiBaseUrl } from '@/http/client'
import { formatResultDate, formatResultNumber } from '@/features/result/format'
import {
  resolveTripAttractionPhoto,
  resolveTripDayPinPhoto,
} from '@/features/result/model'
import { buildFixedItemPageTargets, findHorizontalPageIndex } from '@/features/result/horizontal-pager'
import type { TripAttraction, TripDay, TripPlan } from '@/features/result/model'
import { resolveAvailableResultSection, resultSectionAnchor } from '@/features/result/section-state'

type ResultSection = 'today' | 'overview' | 'days' | 'map' | 'budget' | 'weather'

const props = withDefaults(defineProps<{
  plan: TripPlan
  planId?: string
  readonly?: boolean
  readonlyActionLabel?: string
  editable?: boolean
  shareReady?: boolean
  budgetLedger?: BudgetLedgerResponseDto | null
  execution?: ExecutionMapDto
  statusBusy?: boolean
  actionsBusy?: boolean
  attractionPhotos?: Record<string, string>
  initialSection?: ResultSection
  enhancementStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | null
}>(), {
  planId: '',
  readonly: false,
  readonlyActionLabel: '',
  editable: false,
  shareReady: true,
  budgetLedger: null,
  execution: () => ({}),
  statusBusy: false,
  actionsBusy: false,
  attractionPhotos: () => ({}),
  initialSection: 'overview',
  enhancementStatus: null,
})

const emit = defineEmits<{
  share: []
  readonlyAction: []
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
const failedPhotoNames = ref(new Set<string>())
const journeyPage = ref(0)
const journeyScrollLeft = ref(0)
const journeyViewportWidth = ref(0)
const highlightPage = ref(0)
const highlightScrollLeft = ref(0)
const highlightViewportWidth = ref(0)
const tripMapRef = ref<{ captureScreenshot: () => Promise<string> } | null>(null)
const instance = getCurrentInstance()
const localeTag = computed(() => ({ zh: 'zh-CN', en: 'en-US', fr: 'fr-FR' }[locale.value] || locale.value))
const noticeDismissed = ref(false)
const allAttractions = computed(() => {
  const result: Array<{ attraction: TripAttraction, day: TripDay, dayIndex: number, attractionIndex: number }> = []
  props.plan.days.forEach((day, dayIndex) => {
    day.attractions.forEach((attraction, attractionIndex) => {
      result.push({ attraction, day, dayIndex, attractionIndex })
    })
  })
  return result
})
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
const journeyTitle = computed(() => props.plan.blueprint?.title || t('result.graph.journeyTitle', {
  days: props.plan.days.length,
  cities: cities.value.join(' → '),
}))
const journeySummary = computed(() => props.plan.blueprint?.summary || '')
const journeyHighlights = computed(() => {
  const result: Array<{ day: TripDay, index: number, attraction: TripAttraction, photo: string }> = []
  props.plan.days.forEach((day, index) => {
    for (const attraction of day.attractions) {
      const photo = attractionImage(attraction)
      if (!photo)
        continue
      result.push({ day, index, attraction, photo })
      break
    }
  })
  return result
})
const journeyHeroPhoto = computed(() => journeyHighlights.value[0]?.photo || '')
const journeyHeroStyle = computed(() => journeyHeroPhoto.value
  ? {
      backgroundImage: `linear-gradient(100deg, var(--journey-hero-overlay-start) 25%, var(--journey-hero-overlay-middle) 55%, var(--journey-hero-overlay-end)), url(${journeyHeroPhoto.value})`,
    }
  : undefined)
const journeyPageTargets = computed(() => buildFixedItemPageTargets(
  props.plan.days.length + 1,
  journeyViewportWidth.value || fallbackPagerWidth(),
  130,
  4,
))
const journeyPageCount = computed(() => journeyPageTargets.value.length)
const highlightPageTargets = computed(() => buildFixedItemPageTargets(
  journeyHighlights.value.length,
  highlightViewportWidth.value || fallbackPagerWidth(),
  168,
  12,
))
const highlightPageCount = computed(() => highlightPageTargets.value.length)
const journeyTailStyle = computed(() => ({ width: `${Math.max(0, journeyViewportWidth.value - 134)}px` }))
const highlightTailStyle = computed(() => ({ width: `${Math.max(0, highlightViewportWidth.value - 180)}px` }))
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

function journeyPinPhoto(day: TripDay): string {
  return resolveTripDayPinPhoto(day, props.plan.city, props.attractionPhotos, getApiBaseUrl())
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
  return formatResultDate(date, locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }, formatDate(value))
}

function formatMoney(value: number | undefined): string {
  return formatResultNumber(Number(value || 0), locale.value, 0)
}

function attractionImage(attraction: TripAttraction): string {
  if (failedPhotoNames.value.has(attraction.name))
    return ''
  return resolveTripAttractionPhoto(attraction, props.attractionPhotos, getApiBaseUrl())
}

function onPhotoError(name: string): void {
  failedPhotoNames.value = new Set([...failedPhotoNames.value, name])
}

function fallbackPagerWidth(): number {
  const width = uni.getWindowInfo().windowWidth
  return width <= 820 ? Math.max(0, width - 48) : Math.min(1200, Math.max(0, width - 340))
}

async function refreshJourneyPagers(): Promise<void> {
  await nextTick()
  const fallback = fallbackPagerWidth()
  const query = uni.createSelectorQuery()
  if (instance?.proxy)
    query.in(instance.proxy)
  query.select('.journey-track').boundingClientRect()
  query.select('.journey-highlights-scroll').boundingClientRect()
  query.exec((results) => {
    journeyViewportWidth.value = Number(results?.[0]?.width || fallback)
    highlightViewportWidth.value = Number(results?.[1]?.width || journeyViewportWidth.value || fallback)
    journeyPage.value = Math.min(journeyPage.value, journeyPageTargets.value.length - 1)
    highlightPage.value = Math.min(highlightPage.value, highlightPageTargets.value.length - 1)
    journeyScrollLeft.value = journeyPageTargets.value[journeyPage.value] || 0
    highlightScrollLeft.value = highlightPageTargets.value[highlightPage.value] || 0
  })
}

function setJourneyPage(next: number): void {
  const page = Math.max(0, Math.min(journeyPageCount.value - 1, next))
  journeyPage.value = page
  journeyScrollLeft.value = journeyPageTargets.value[page] || 0
}

function onJourneyScroll(event: { detail?: { scrollLeft?: number } }): void {
  const scrollLeft = Number(event.detail?.scrollLeft || 0)
  journeyPage.value = findHorizontalPageIndex(journeyPageTargets.value, scrollLeft)
}

function setHighlightPage(next: number): void {
  const page = Math.max(0, Math.min(highlightPageCount.value - 1, next))
  highlightPage.value = page
  highlightScrollLeft.value = highlightPageTargets.value[page] || 0
}

function onHighlightScroll(event: { detail?: { scrollLeft?: number } }): void {
  highlightPage.value = findHorizontalPageIndex(highlightPageTargets.value, Number(event.detail?.scrollLeft || 0))
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
  if (section === 'overview')
    void refreshJourneyPagers()
}

function onWindowResize(): void {
  void refreshJourneyPagers()
}

onMounted(() => {
  void refreshJourneyPagers()
  uni.onWindowResize(onWindowResize)
})

onBeforeUnmount(() => {
  uni.offWindowResize(onWindowResize)
})

watch(
  () => [props.plan.days.length, journeyHighlights.value.length],
  () => void refreshJourneyPagers(),
)

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
        <view class="readonly-banner-copy">
          <text class="readonly-banner-title">{{ t('result.share.readonlyBanner') }}</text>
          <text class="readonly-banner-hint">{{ t('result.share.readonlyHint') }}</text>
        </view>
        <button
          v-if="props.readonlyActionLabel"
          class="readonly-banner-action"
          :aria-label="props.readonlyActionLabel"
          @click="emit('readonlyAction')"
        >
          <text>{{ props.readonlyActionLabel }}</text>
          <wd-icon name="arrow-right" size="14px" />
        </button>
      </view>

      <view v-if="enhancementMessage" class="enhancement-notice" role="status">
        <text>{{ enhancementMessage }}</text>
        <button v-if="enhancementTerminal" :aria-label="t('result.enhancement.dismiss')" @click="noticeDismissed = true">
          ×
        </button>
      </view>

      <view v-show="activeSection === 'overview'" class="section-content overview-section">
        <view class="overview-journey">
          <view class="journey-hero" :style="journeyHeroStyle">
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
              <view v-if="journeyPageCount > 1" class="journey-pager">
                <text>{{ journeyPage + 1 }} / {{ journeyPageCount }}</text>
                <button :disabled="journeyPage === 0" :aria-label="t('result.graph.previousJourney')" @click="setJourneyPage(journeyPage - 1)">
                  <wd-icon name="arrow-left" size="15px" />
                </button>
                <button :disabled="journeyPage >= journeyPageCount - 1" :aria-label="t('result.graph.nextJourney')" @click="setJourneyPage(journeyPage + 1)">
                  <wd-icon name="arrow-right" size="15px" />
                </button>
              </view>
              <text class="journey-marker journey-marker-end">{{ t('result.graph.journeyEnd') }}</text>
            </view>
            <scroll-view
              :scroll-x="journeyPageCount > 1"
              class="journey-track"
              :scroll-left="journeyScrollLeft"
              :scroll-with-animation="true"
              :show-scrollbar="false"
              @scroll="onJourneyScroll"
            >
              <view class="journey-rail" />
              <view class="journey-track-group">
                <button
                  v-for="(day, index) in plan.days"
                  :id="`journey-stop-${index}`"
                  :key="`${day.date}-${index}`"
                  class="journey-stop"
                  :style="{ '--journey-accent': journeyAccent(index) }"
                  @click="setSection('days')"
                >
                  <text class="journey-day">D{{ index + 1 }}</text>
                  <view class="journey-pin">
                    <image
                      v-if="journeyPinPhoto(day)"
                      class="journey-pin-image"
                      :src="journeyPinPhoto(day)"
                      mode="aspectFill"
                    />
                    <text v-else>{{ (day.city || plan.city).slice(0, 1) || '·' }}</text>
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
                <view :id="`journey-stop-${plan.days.length}`" class="journey-stop journey-stop-end">
                  <text class="journey-day">&nbsp;</text>
                  <view class="journey-pin journey-pin-plane">
                    <text>✈</text>
                  </view>
                </view>
                <view class="journey-page-tail journey-page-tail-track" :style="journeyTailStyle" />
              </view>
            </scroll-view>
          </view>

          <view v-if="journeyHighlights.length" class="journey-highlights">
            <view class="journey-highlights-header">
              <text class="journey-highlights-title">{{ t('result.graph.highlights') }}</text>
              <view v-if="highlightPageCount > 1" class="journey-highlights-pager">
                <text>{{ highlightPage + 1 }} / {{ highlightPageCount }}</text>
                <button :disabled="highlightPage === 0" :aria-label="t('result.graph.previousHighlight')" @click="setHighlightPage(highlightPage - 1)">
                  <wd-icon name="arrow-left" size="15px" />
                </button>
                <button :disabled="highlightPage >= highlightPageCount - 1" :aria-label="t('result.graph.nextHighlight')" @click="setHighlightPage(highlightPage + 1)">
                  <wd-icon name="arrow-right" size="15px" />
                </button>
              </view>
            </view>
            <scroll-view
              :scroll-x="highlightPageCount > 1"
              class="journey-highlights-scroll"
              :scroll-left="highlightScrollLeft"
              :scroll-with-animation="true"
              :show-scrollbar="false"
              @scroll="onHighlightScroll"
            >
              <view class="journey-highlights-row">
                <button
                  v-for="highlight in journeyHighlights"
                  :key="`${highlight.index}-${highlight.attraction.name}`"
                  class="journey-highlight-card"
                  @click="setSection('days')"
                >
                  <view class="journey-highlight-media">
                    <image :src="highlight.photo" mode="aspectFill" @error="onPhotoError(highlight.attraction.name)" />
                    <text>D{{ highlight.index + 1 }}</text>
                  </view>
                  <strong>{{ highlight.attraction.name }}</strong>
                  <text>{{ highlight.day.city || plan.city }}</text>
                </button>
                <view class="journey-page-tail journey-page-tail-highlights" :style="highlightTailStyle" />
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
                @error="onPhotoError(attraction.name)"
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
        <view v-else-if="plan.days.length" class="overview-day-list">
          <view
            v-for="(day, index) in plan.days"
            :key="`${day.date}-${index}`"
            class="overview-day-card"
          >
            <view class="overview-day-index" :style="{ '--journey-accent': journeyAccent(index) }">
              D{{ index + 1 }}
            </view>
            <view class="overview-day-copy">
              <view class="overview-day-heading">
                <strong>{{ day.city || plan.city }}</strong>
                <text>{{ formatDate(day.date) }}</text>
              </view>
              <text class="overview-day-description">
                {{ day.description || t('common.noData') }}
              </text>
              <view class="overview-day-facts">
                <text v-if="day.transportation">{{ day.transportation }}</text>
                <text v-if="day.meals.length">{{ day.meals.map(meal => meal.name).join(' · ') }}</text>
              </view>
            </view>
          </view>
        </view>
        <view v-else class="empty-section">
          {{ t('result.noTripPlanDesc') }}
        </view>

        <view class="overview-meta">
          <text class="meta-accent">{{ t('result.dateRange', { start: formatLongDate(plan.start_date), end: formatLongDate(plan.end_date) }) }}</text>
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
        <DailyItinerary :plan="plan" :attraction-photos="attractionPhotos" />
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
  background-color: var(--surface-page);
  background-image: var(--result-page-image);
}
.result-panel {
  box-sizing: border-box;
  width: 100%;
  max-width: 1240px;
  min-width: 0;
  margin: 0 auto;
  padding: 20px;
  border: 1.2px solid var(--border-subtle);
  border-radius: 22px;
  background: var(--result-panel);
  box-shadow: var(--result-panel-shadow);
  backdrop-filter: blur(18px);
  /* #ifdef H5 */
  container-type: inline-size;
  /* #endif */
}
.result-toolbar {
  position: sticky;
  z-index: 20;
  top: var(--result-toolbar-top, 0px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -20px -20px 16px;
  padding: 10px 20px 8px;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 22px 22px 0 0;
  background: var(--result-sticky);
  backdrop-filter: blur(12px);
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
  display: flex;
  margin-bottom: 18px;
  padding: 12px 14px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(58, 156, 122, 0.24);
  border-radius: 8px;
  background: rgba(58, 156, 122, 0.08);
  color: #2f795f;
  font-size: 13px;
  line-height: 1.6;
}
.readonly-banner-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.readonly-banner-title {
  font-weight: 700;
}
.readonly-banner-hint {
  color: var(--text-secondary);
  font-size: 11px;
}
.readonly-banner-action {
  display: inline-flex;
  box-sizing: border-box;
  width: auto;
  max-width: 128px;
  height: 36px;
  margin: 0;
  padding: 0 10px;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 7px;
  background: var(--surface-elevated);
  color: #2f795f;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}
.readonly-banner-action::after {
  display: none;
}
.readonly-banner-action text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.enhancement-notice {
  display: flex;
  min-height: 25px;
  margin: 0 0 14px;
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
  min-height: 106px;
  padding: 26px 28px 24px;
  border: 1px solid var(--journey-hero-border);
  border-radius: 20px;
  background-color: var(--journey-hero);
  background-position: right center;
  background-repeat: no-repeat;
  background-size: cover;
}
.journey-eyebrow {
  display: block;
  margin-bottom: 6px;
  color: var(--journey-muted);
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
  display: grid;
  align-items: center;
  box-sizing: border-box;
  min-height: 40px;
  margin-bottom: 10px;
  padding: 0 14px;
  grid-template-columns: 1fr auto 1fr;
}
.journey-pager,
.journey-highlights-pager {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.journey-pager button,
.journey-highlights-pager button {
  display: inline-flex;
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--journey-hero-border);
  border-radius: 50%;
  background: var(--journey-card);
  color: var(--accent-primary);
}
.journey-pager button::after,
.journey-highlights-pager button::after {
  display: none;
}
.journey-pager button[disabled],
.journey-highlights-pager button[disabled] {
  border-color: var(--border-subtle);
  background: var(--surface-soft);
  color: var(--text-secondary);
  opacity: 0.42;
}
.journey-marker {
  color: var(--journey-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
}
.journey-marker-end {
  justify-self: end;
}
.journey-track {
  position: relative;
  height: 183px;
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
.journey-page-tail {
  display: block;
  flex: 0 0 auto;
  pointer-events: none;
}
.journey-rail {
  position: absolute;
  z-index: 0;
  top: 68px;
  right: 70px;
  left: 70px;
  border-top: 2px dashed var(--journey-rail);
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
  overflow: visible;
  box-shadow: var(--card-shadow);
}
.journey-pin-image {
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
}
.journey-pin::after {
  position: absolute;
  bottom: -9px;
  left: 50%;
  border: 6px solid transparent;
  border-top: 8px solid var(--journey-accent, #5b8ff9);
  content: '';
  transform: translateX(-50%);
}
.journey-pin-plane {
  border-style: dashed;
  border-color: var(--journey-rail);
  color: var(--journey-muted);
  box-shadow: none;
}
.journey-pin-plane::after {
  border-top-color: var(--journey-rail);
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
.journey-highlights {
  margin-top: 26px;
}
.journey-highlights-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.journey-highlights-title {
  display: block;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
}
.journey-highlights-scroll {
  width: 100%;
  padding-bottom: 8px;
  white-space: nowrap;
}
.journey-highlights-row {
  display: flex;
  width: max-content;
  gap: 12px;
}
.journey-highlight-card {
  display: flex;
  box-sizing: border-box;
  width: 168px;
  margin: 0;
  padding: 0 0 16px;
  overflow: hidden;
  align-items: flex-start;
  border: 1px solid var(--journey-hero-border);
  border-radius: 14px;
  background: var(--journey-card);
  color: var(--text-primary);
  flex: 0 0 168px;
  flex-direction: column;
  gap: 4px;
  line-height: 1.15;
  text-align: left;
}
.journey-highlight-card::after {
  display: none;
}
.journey-highlight-media {
  position: relative;
  width: 100%;
  height: 100px;
  overflow: hidden;
  border-radius: 13px 13px 0 0;
  background: var(--surface-soft);
}
.journey-highlight-media image {
  width: 100%;
  height: 100%;
}
.journey-highlight-media text {
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(61, 50, 41, 0.68);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.journey-highlight-card strong,
.journey-highlight-card > text {
  display: block;
  padding-inline: 10px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.journey-highlight-card strong {
  font-size: 13px;
}
.journey-highlight-card > text {
  color: var(--text-secondary);
  font-size: 12px;
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
.overview-day-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
  padding: 0 0 16px;
}
.overview-day-card {
  display: grid;
  min-width: 0;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-subtle);
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px;
}
.overview-day-index {
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--journey-accent, var(--accent-primary));
  border-radius: 50%;
  color: var(--journey-accent, var(--accent-primary));
  font-size: 12px;
  font-weight: 750;
}
.overview-day-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.overview-day-heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.overview-day-heading strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.overview-day-heading text {
  flex: none;
  color: var(--text-secondary);
  font-size: 11px;
}
.overview-day-description {
  display: -webkit-box;
  margin-top: 6px;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.overview-day-facts {
  display: flex;
  margin-top: 8px;
  flex-wrap: wrap;
  gap: 5px 8px;
}
.overview-day-facts text {
  max-width: 100%;
  padding: 3px 7px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
    padding: 13px 10px 30px;
  }
  .result-panel {
    padding: 14px;
    border-radius: 22px;
  }
  .result-toolbar {
    top: var(--result-toolbar-top, 0px);
    height: auto;
    min-height: 0;
    align-items: stretch;
    gap: 8px;
    margin: -14px -14px 14px;
    padding: 8px 14px 0;
    border-radius: 22px 22px 0 0;
    flex-direction: column;
  }
  .section-tabs {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }
  .section-tab {
    width: auto;
    min-width: 0;
    min-height: 36px;
    padding: 7px 4px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--surface-elevated);
    font-size: 13px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .section-tab.active {
    border-color: var(--accent-focus);
    background: var(--accent-selected);
    font-weight: 400;
  }
  .section-tab.active::before {
    display: none;
  }
  .toolbar-actions {
    justify-content: flex-end;
    overflow: visible;
    padding-bottom: 4px;
    flex-wrap: wrap;
  }
  .action-button {
    height: 32px;
    min-height: 32px;
    padding: 0 10px;
    font-size: 11px;
  }
  .section-scroll {
    width: 100%;
    flex: none;
    height: auto;
    overflow: visible;
  }
  .attraction-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .overview-grid {
    column-count: 2;
    column-gap: 10px;
  }
  .overview-day-list {
    grid-template-columns: 1fr;
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
  .section-title,
  .day-title {
    font-size: 22px;
  }
  .journey-title {
    font-size: 18px;
  }
  .journey-hero {
    min-height: 115px;
    padding: 20px 18px;
    border-radius: 16px;
  }
  .journey-track-toolbar {
    display: flex;
    justify-content: flex-end;
    min-height: 44px;
    margin-bottom: 8px;
    padding: 0;
  }
  .journey-pager {
    display: flex;
    margin-left: auto;
  }
  .journey-pager button,
  .journey-highlights-pager button {
    width: 44px;
    height: 44px;
  }
  .journey-track {
    height: 183px;
  }
  .journey-marker {
    display: none;
  }
  .journey-highlight-card {
    width: clamp(156px, 72vw, 232px);
    flex-basis: clamp(156px, 72vw, 232px);
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
