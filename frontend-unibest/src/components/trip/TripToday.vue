<script setup lang="ts">
import type { ExecutionMapDto, ItemExecutionStatusDto } from '@youban/contracts'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApiBaseUrl } from '@/http/client'
import { getPoiPhoto } from '@/services/v2'
import { buildTodayTimeline, resolveMediaUrl, todayProgress, todayState } from '@/features/result/model'
import type { TodayTimelineItem, TripPlan } from '@/features/result/model'
import { daysUntilTrip, todayEndedSummary, todayReflectionState } from '@/features/result/today'

const props = withDefaults(defineProps<{
  plan: TripPlan
  execution: ExecutionMapDto
  statusBusy?: boolean
}>(), {
  statusBusy: false,
})

const emit = defineEmits<{
  itemStatus: [payload: { itemId: string, status: ItemExecutionStatusDto, actualCost?: number }]
}>()

const { locale, t, te } = useI18n()
const modalCancelLabel = computed(() => {
  const label = t('common.cancel')
  const characters = Array.from(label)
  return String(locale.value).startsWith('zh') && characters.length === 2 ? characters.join(' ') : label
})
const now = new Date()
const todayText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const tripState = computed(() => todayState(props.plan, todayText))
const day = computed(() => tripState.value.phase === 'during' ? tripState.value.day : null)
const dayArrayIndex = computed(() => day.value ? props.plan.days.indexOf(day.value) : -1)
const timeline = computed(() => day.value ? buildTodayTimeline(day.value, props.execution) : [])
const mainItems = computed(() => timeline.value.filter(item => item.status !== 'postponed'))
const laterItems = computed(() => timeline.value.filter(item => item.status === 'postponed'))
const progress = computed(() => todayProgress(timeline.value))
const progressPercent = computed(() => progress.value.total === 0 ? 0 : Math.round((progress.value.done / progress.value.total) * 100))
const doneItems = computed(() => timeline.value.filter(item => item.status === 'done'))
const pendingCount = computed(() => timeline.value.filter(item => item.status === 'pending').length)
const deferredCount = computed(() => timeline.value.filter(item => item.status === 'skipped' || item.status === 'postponed').length)
const reflectionState = computed(() => todayReflectionState(timeline.value))
const reflectionTitle = computed(() => t(`result.today.reflection.${reflectionState.value}Title`))
const reflectionSummary = computed(() => t(`result.today.reflection.${reflectionState.value}Summary`, {
  done: progress.value.done,
  total: progress.value.total,
  remaining: pendingCount.value,
  deferred: deferredCount.value,
}))
const todayWeather = computed(() => day.value
  ? props.plan.weather_info.find(weather => weather.date === day.value?.date)
  : undefined)
const daysToStart = computed(() => daysUntilTrip(props.plan.start_date, todayText))
const firstDayPreview = computed(() => props.plan.days.length ? buildTodayTimeline(props.plan.days[0], {}).slice(0, 5) : [])
const endedSummary = computed(() => todayEndedSummary(props.plan, props.execution))

const completedStory = computed(() => {
  const names = doneItems.value.map(item => item.name)
  if (!names.length)
    return ''
  const visibleNames = names.slice(0, 2)
  const normalizedLocale = String(locale.value || 'zh-CN').toLowerCase()
  const places = visibleNames.join(normalizedLocale.startsWith('en') ? ' and ' : normalizedLocale.startsWith('fr') ? ' et ' : '、')
  return names.length > visibleNames.length
    ? t('result.today.reflection.storyMore', { places, count: names.length })
    : t('result.today.reflection.story', { places })
})

const online = ref(true)
function updateNetworkStatus(result: { isConnected: boolean }): void {
  online.value = result.isConnected
}
onMounted(() => {
  // #ifdef H5
  online.value = navigator.onLine
  // #endif
  uni.onNetworkStatusChange(updateNetworkStatus)
})
onUnmounted(() => uni.offNetworkStatusChange(updateNetworkStatus))

const failedThumbs = ref(new Set<string>())
const attractionPhotos = ref<Record<string, string>>({})
async function loadAttractionPhotos(): Promise<void> {
  const targets = new Map<string, string>()
  for (const planDay of props.plan.days) {
    const city = String(planDay.city || props.plan.city || '').trim()
    for (const attraction of planDay.attractions) {
      const name = attraction.name.trim()
      if (name && !targets.has(name))
        targets.set(name, city)
    }
  }
  const names = [...targets.keys()].filter(name => !attractionPhotos.value[name])
  let currentIndex = 0
  async function loadNextPhoto(): Promise<void> {
    while (currentIndex < names.length) {
      const name = names[currentIndex++]
      try {
        const source = await getPoiPhoto(name, targets.get(name) || props.plan.city)
        if (source)
          attractionPhotos.value[name] = resolveMediaUrl(source, getApiBaseUrl())
      }
      catch {
        // A missing POI photo should leave the same text-only fallback as the legacy client.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, names.length) }, () => loadNextPhoto()))
}
watch(() => props.plan, () => void loadAttractionPhotos(), { immediate: true })

function itemPhoto(item: TodayTimelineItem): string {
  if (item.kind !== 'attraction' || failedThumbs.value.has(item.name))
    return ''
  const attraction = day.value?.attractions.find(value => value.id === item.id || value.name === item.name)
  return resolveMediaUrl(attraction?.image_url || attractionPhotos.value[item.name], getApiBaseUrl())
}
function onThumbError(name: string): void {
  failedThumbs.value = new Set([...failedThumbs.value, name])
}

function mealLabel(type?: string): string {
  const key = type ? `result.meals.${type}` : ''
  return key && te(key) ? t(key) : type || ''
}

function statusLabel(status: ItemExecutionStatusDto): string {
  const labels: Partial<Record<ItemExecutionStatusDto, string>> = {
    done: t('result.today.statusDone'),
    skipped: t('result.today.statusSkipped'),
    postponed: t('result.today.statusPostponed'),
  }
  return labels[status] || ''
}

function canOperate(item: TodayTimelineItem): boolean {
  return Boolean(item.id) && online.value && !props.statusBusy
}

const doneModalOpen = ref(false)
const doneTarget = ref<TodayTimelineItem | null>(null)
const doneCost = ref('')
function openDoneModal(item: TodayTimelineItem): void {
  if (!canOperate(item))
    return
  doneTarget.value = item
  doneCost.value = item.costHint == null ? '' : String(item.costHint)
  doneModalOpen.value = true
}
function closeDoneModal(): void {
  doneModalOpen.value = false
  doneTarget.value = null
  doneCost.value = ''
}
function confirmDone(): void {
  if (!doneTarget.value)
    return
  const actualCost = doneCost.value.trim() === '' ? undefined : Math.max(0, Number(doneCost.value))
  emit('itemStatus', {
    itemId: doneTarget.value.id,
    status: 'done',
    ...(Number.isFinite(actualCost) ? { actualCost } : {}),
  })
  closeDoneModal()
}
function emitStatus(item: TodayTimelineItem, status: ItemExecutionStatusDto): void {
  if (canOperate(item))
    emit('itemStatus', { itemId: item.id, status })
}

interface ActionFeedback { id: number, itemId: string, status: ItemExecutionStatusDto, name: string, message: string }
const actionFeedback = ref<ActionFeedback | null>(null)
let feedbackSequence = 0
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.execution, (next, previous) => {
  for (const item of timeline.value) {
    const nextStatus = next[item.id]?.status
    if (!nextStatus || nextStatus === previous?.[item.id]?.status)
      continue
    const messages: Record<ItemExecutionStatusDto, string> = {
      done: t('result.today.feedback.done'),
      skipped: t('result.today.feedback.skipped'),
      postponed: t('result.today.feedback.postponed'),
      pending: t('result.today.feedback.restored'),
    }
    if (feedbackTimer)
      clearTimeout(feedbackTimer)
    actionFeedback.value = {
      id: ++feedbackSequence,
      itemId: item.id,
      status: nextStatus,
      name: item.name,
      message: messages[nextStatus],
    }
    feedbackTimer = setTimeout(() => actionFeedback.value = null, 3200)
    break
  }
}, { deep: true })
onUnmounted(() => {
  if (feedbackTimer)
    clearTimeout(feedbackTimer)
})
</script>

<template>
  <view class="trip-today">
    <template v-if="tripState.phase === 'during' && day">
      <view class="today-header">
        <view class="today-header-main">
          <text class="today-date">{{ day.date }}</text>
          <text class="today-title">{{ t('result.today.headerDay', { day: dayArrayIndex + 1, city: day.city || plan.city }) }}</text>
          <text v-if="todayWeather" class="today-weather">
            {{ todayWeather.day_weather }} {{ todayWeather.night_temp }}~{{ todayWeather.day_temp }}°C
          </text>
        </view>
        <view class="today-progress">
          <text class="today-progress-text">{{ t('result.today.progress', progress) }}</text>
          <view class="today-progress-bar">
            <view :style="{ width: `${progressPercent}%` }" />
          </view>
        </view>
      </view>

      <view v-if="day.is_transfer_day && day.transfer_info" class="today-context-card">
        <text class="today-context-label">{{ t('result.today.transferCard') }}</text>
        <text>{{ day.transfer_info }}</text>
      </view>

      <view
        v-if="progress.total > 0"
        class="today-reflection"
        :class="{ 'is-complete': reflectionState === 'complete' }"
        :aria-label="t('result.today.reflectionLabel')"
      >
        <view class="today-reflection-mark" aria-hidden="true">
          <view class="i-carbon-trophy" />
        </view>
        <view class="today-reflection-content">
          <view class="today-reflection-kicker">
            {{ t('result.today.achievement', { percent: progressPercent }) }}
          </view>
          <view class="today-reflection-title">
            {{ reflectionTitle }}
          </view>
          <view class="today-reflection-summary">
            {{ reflectionSummary }}
          </view>
          <view v-if="completedStory" class="today-reflection-story">
            <view class="i-carbon-checkmark-filled" aria-hidden="true" />
            <text class="today-reflection-story-wide">{{ completedStory }}</text>
            <text class="today-reflection-story-compact">
              {{ t('result.today.reflection.storyCompact', { count: doneItems.length }) }}
            </text>
          </view>
        </view>
      </view>

      <view v-if="mainItems.length === 0 && laterItems.length === 0" class="today-no-actionable">
        {{ t('result.today.noActionable') }}
      </view>

      <view class="today-timeline">
        <view
          v-for="item in mainItems"
          :key="item.id || item.name"
          class="today-item"
          :class="[`is-${item.status}`, `kind-${item.kind}`]"
        >
          <view class="today-item-time">
            {{ item.timeLabel || '—' }}
          </view>
          <view class="today-item-body">
            <image
              v-if="itemPhoto(item)"
              :src="itemPhoto(item)"
              :alt="item.name"
              class="today-item-thumb"
              mode="aspectFill"
              @error="onThumbError(item.name)"
            />
            <view class="today-item-head">
              <text class="today-item-name">{{ item.name }}</text>
              <text v-if="item.kind === 'meal'" class="today-item-tag">{{ mealLabel(item.category) }}</text>
              <text v-else-if="item.category" class="today-item-tag">{{ item.category }}</text>
              <text v-if="item.status !== 'pending'" class="today-item-status">{{ statusLabel(item.status) }}</text>
            </view>
            <view v-if="item.description" class="today-item-desc">
              {{ item.description }}
            </view>
            <view class="today-item-actions">
              <template v-if="item.status === 'pending'">
                <button class="today-btn today-btn-done" :disabled="!canOperate(item)" @click="openDoneModal(item)">
                  {{ t('result.today.actionDone') }}
                </button>
                <button class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'skipped')">
                  {{ t('result.today.actionSkip') }}
                </button>
                <button class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'postponed')">
                  {{ t('result.today.actionPostpone') }}
                </button>
              </template>
              <button v-else class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'pending')">
                {{ t('result.today.actionRestore') }}
              </button>
            </view>
          </view>
        </view>
      </view>

      <view v-if="laterItems.length" class="today-later">
        <view class="today-later-title">
          {{ t('result.today.laterGroup') }}
        </view>
        <view v-for="item in laterItems" :key="item.id || item.name" class="today-item is-postponed" :class="`kind-${item.kind}`">
          <view class="today-item-time">
            {{ item.timeLabel || '—' }}
          </view>
          <view class="today-item-body">
            <view class="today-item-head">
              <text class="today-item-name">{{ item.name }}</text>
              <text class="today-item-status">{{ statusLabel(item.status) }}</text>
            </view>
            <view class="today-item-actions">
              <button class="today-btn today-btn-done" :disabled="!canOperate(item)" @click="openDoneModal(item)">
                {{ t('result.today.actionDone') }}
              </button>
              <button class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'pending')">
                {{ t('result.today.actionRestore') }}
              </button>
            </view>
          </view>
        </view>
      </view>

      <view v-if="day.hotel" class="today-context-card">
        <text class="today-context-label">{{ t('result.today.hotelCard') }}</text>
        <text>{{ day.hotel.name }}</text>
      </view>
      <text v-if="!online" class="today-offline-hint">{{ t('result.today.offlineHint') }}</text>

      <view class="today-action-feedback-shell">
        <view
          v-if="actionFeedback"
          class="today-action-feedback"
          :class="`is-${actionFeedback.status}`"
          role="status"
          aria-live="polite"
        >
          <view :class="actionFeedback.status === 'done' ? 'i-carbon-checkmark-filled' : 'i-carbon-compass'" />
          <text class="today-action-feedback-copy">
            <strong>{{ actionFeedback.name }}</strong>{{ /^(en|fr)/.test(String(locale).toLowerCase()) ? ' ' : '' }}{{ actionFeedback.message }}
          </text>
        </view>
      </view>
    </template>

    <view v-else-if="tripState.phase === 'before'" class="today-placeholder">
      <view class="today-countdown">
        {{ t('result.today.countdown', { days: daysToStart }) }}
      </view>
      <view class="today-later-title">
        {{ t('result.today.firstDayPreview') }}
      </view>
      <view class="today-preview-list">
        <view v-for="item in firstDayPreview" :key="item.name" class="today-preview-item">
          {{ item.timeLabel || '—' }} · {{ item.name }}
        </view>
      </view>
    </view>

    <view v-else class="today-placeholder">
      <view class="today-countdown">
        {{ t('result.today.endedTitle') }}
      </view>
      <view class="today-ended-summary">
        {{ t('result.today.endedSummary', endedSummary) }}
      </view>
    </view>

    <view v-if="doneModalOpen" class="today-modal-layer">
      <view class="today-modal-mask" @click="closeDoneModal" />
      <view class="today-modal" role="dialog" aria-modal="true" :aria-label="t('result.today.doneModalTitle')">
        <button class="today-modal-close" :aria-label="t('common.cancel')" @click="closeDoneModal">
          <wd-icon name="close" size="14px" />
        </button>
        <view class="today-modal-title">
          {{ t('result.today.doneModalTitle') }}
        </view>
        <view class="today-modal-name">
          {{ doneTarget?.name }}
        </view>
        <label class="today-modal-cost">
          <text>{{ t('result.today.actualCostLabel') }}</text>
          <input v-model="doneCost" type="digit" :placeholder="t('result.today.actualCostPlaceholder')">
        </label>
        <view class="today-modal-actions">
          <button class="today-btn" @click="closeDoneModal">
            {{ modalCancelLabel }}
          </button>
          <button class="today-btn today-btn-done" @click="confirmDone">
            {{ t('result.today.confirmDone') }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.trip-today {
  display: flex;
  color: #3d3229;
  font-family:
    -apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC',
    'Microsoft YaHei', sans-serif;
  font-size: 14px;
  font-weight: 300;
  line-height: 1.15;
  flex-direction: column;
  gap: 14px;
}
.today-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.today-header-main {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}
.today-date {
  color: rgba(61, 50, 41, 0.55);
  font-size: 13px;
  letter-spacing: 0.04em;
}
.today-title {
  color: #3d3229;
  font-size: 20px;
  font-weight: 700;
}
.today-weather {
  color: rgba(61, 50, 41, 0.65);
  font-size: 13px;
}
.today-progress {
  display: flex;
  min-width: 180px;
  align-items: center;
  flex-direction: row;
  gap: 10px;
}
.today-progress-text {
  color: rgba(61, 50, 41, 0.7);
  font-size: 13px;
  white-space: nowrap;
}
.today-progress-bar {
  overflow: hidden;
  height: 6px;
  border-radius: 3px;
  background: rgba(61, 50, 41, 0.1);
  flex: 1;
}
.today-progress-bar > view {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #d8a94e, #c98a2d);
  transition: width 0.3s ease;
}
.today-context-card {
  display: flex;
  padding: 10px 14px;
  border-radius: 10px;
  align-items: baseline;
  background: rgba(216, 169, 78, 0.08);
  color: rgba(61, 50, 41, 0.8);
  font-size: 13px;
  gap: 10px;
}
.today-context-label {
  color: #a8752a;
  font-weight: 600;
  flex-shrink: 0;
}
.today-reflection {
  display: flex;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 22%, transparent);
  border-radius: 8px;
  align-items: flex-start;
  background: color-mix(in srgb, var(--accent-primary) 7%, var(--surface-elevated));
  gap: 12px;
}
.today-reflection.is-complete {
  border-color: color-mix(in srgb, var(--status-success) 28%, transparent);
  background: color-mix(in srgb, var(--status-success) 8%, var(--surface-elevated));
}
.today-reflection-mark {
  display: grid;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent-primary) 14%, var(--surface-elevated));
  color: var(--accent-strong);
  font-size: 17px;
  flex: 0 0 36px;
  place-items: center;
}
.today-reflection-content {
  min-width: 0;
}
.today-reflection-kicker {
  margin-bottom: 2px;
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}
.today-reflection.is-complete .today-reflection-kicker {
  color: var(--status-success);
}
.today-reflection-title {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.45;
}
.today-reflection-summary {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}
.today-reflection-story {
  display: flex;
  margin-top: 3px;
  align-items: flex-start;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
  gap: 6px;
}
.today-reflection-story > view {
  margin-top: 4px;
  color: var(--status-success);
  font-size: 12px;
  flex: 0 0 auto;
}
.today-reflection-story-compact {
  display: none;
}
.today-no-actionable {
  padding: 32px 16px;
  color: var(--text-secondary);
  text-align: center;
}
.today-timeline,
.today-later {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.today-item {
  display: flex;
  padding: 13px 14px;
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
  gap: 12px;
}
.today-item-time {
  width: 92px;
  padding-top: 2px;
  color: rgba(61, 50, 41, 0.55);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.today-item-body {
  min-width: 0;
  flex: 1;
}
.today-item-thumb {
  display: block;
  width: 100%;
  max-height: 150px;
  margin-bottom: 9px;
  border-radius: 10px;
}
.today-item-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.today-item-name {
  color: #3d3229;
  font-size: 15px;
  font-weight: 600;
}
.today-item-tag,
.today-item-status {
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(61, 50, 41, 0.06);
  color: rgba(61, 50, 41, 0.6);
  font-size: 11px;
}
.today-item-status {
  background: rgba(216, 169, 78, 0.16);
  color: #a8752a;
}
.today-item-desc {
  display: -webkit-box;
  overflow: hidden;
  margin-top: 6px;
  color: rgba(61, 50, 41, 0.6);
  font-size: 12.5px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.today-item-actions {
  display: flex;
  margin-top: 10px;
  flex-wrap: wrap;
  gap: 8px;
}
.today-btn {
  box-sizing: border-box;
  min-height: 0;
  margin: 0;
  padding: 4px 14px;
  border: 1px solid rgba(61, 50, 41, 0.15);
  border-radius: 8px;
  background: transparent;
  color: rgba(61, 50, 41, 0.75);
  cursor: pointer;
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-size: 12.5px;
  font-weight: 300;
  line-height: 1.15;
  transition: all 0.15s ease;
}
.today-btn::after {
  display: none;
}
.today-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.today-btn-done {
  border-color: transparent;
  background: linear-gradient(135deg, #d8a94e, #c98a2d);
  color: #fff;
}
.today-item.is-done {
  border-color: color-mix(in srgb, var(--status-success) 20%, transparent);
  background: color-mix(in srgb, var(--status-success) 5%, var(--surface-elevated));
}
.today-item.is-done .today-item-status {
  background: color-mix(in srgb, var(--status-success) 14%, transparent);
  color: var(--status-success);
}
.today-item.is-skipped {
  background: color-mix(in srgb, var(--text-primary) 2%, var(--surface-elevated));
}
.today-item.is-skipped .today-item-name,
.today-item.is-skipped .today-item-desc {
  color: color-mix(in srgb, var(--text-primary) 62%, transparent);
}
.today-item.is-postponed {
  opacity: 0.78;
}
.today-later-title {
  margin-top: 4px;
  color: rgba(61, 50, 41, 0.5);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.today-offline-hint {
  color: #b0483e;
  font-size: 12px;
}
.today-action-feedback-shell {
  position: fixed;
  z-index: 1100;
  bottom: 82px;
  left: 50%;
  width: min(520px, calc(100vw - 32px));
  pointer-events: none;
  transform: translateX(-50%);
}
.today-action-feedback {
  display: flex;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
  border-radius: 999px;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--text-primary) 92%, transparent);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--text-primary) 20%, transparent);
  color: var(--surface-elevated);
  font-size: 13px;
  line-height: 1.45;
  gap: 8px;
}
.today-placeholder {
  display: flex;
  padding: 28px 8px;
  flex-direction: column;
  gap: 12px;
}
.today-countdown {
  color: #3d3229;
  font-size: 18px;
  font-weight: 700;
}
.today-preview-list {
  padding-left: 18px;
  color: rgba(61, 50, 41, 0.75);
  font-size: 13.5px;
  line-height: 2;
}
.today-preview-item::before {
  content: '• ';
}
.today-ended-summary {
  color: rgba(61, 50, 41, 0.7);
  font-size: 14px;
}
.today-modal-layer,
.today-modal-mask {
  position: fixed;
  z-index: 150;
  inset: 0;
}
.today-modal-mask {
  background: rgba(0, 0, 0, 0.45);
}
.today-modal {
  position: fixed;
  z-index: 151;
  top: 100px;
  left: 50%;
  box-sizing: border-box;
  width: min(520px, calc(100vw - 28px));
  padding: 20px 24px;
  border-radius: 10px;
  background: var(--surface-elevated);
  box-shadow:
    0 6px 16px 0 rgba(0, 0, 0, 0.08),
    0 3px 6px -4px rgba(0, 0, 0, 0.12),
    0 9px 28px 8px rgba(0, 0, 0, 0.05);
  font-family:
    -apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji',
    'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
  font-size: 14px;
  font-weight: 300;
  line-height: 1.5714285714;
  transform: translateX(-50%);
}
.today-modal-close {
  position: absolute;
  top: 17px;
  right: 17px;
  display: grid;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(0, 0, 0, 0.45);
  line-height: 1;
  place-items: center;
}
.today-modal-close::after {
  display: none;
}
.today-modal-title {
  height: 24px;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.today-modal-name {
  margin-top: 8px;
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 22.5px;
}
.today-modal-cost {
  display: flex;
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5714285714;
  flex-direction: column;
  gap: 6px;
}
.today-modal-cost input {
  box-sizing: border-box;
  height: 32px;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 22px;
}
.today-modal-actions {
  display: flex;
  height: 32px;
  margin-top: 12px;
  justify-content: flex-end;
  gap: 8px;
}
.today-modal-actions .today-btn {
  height: 32px;
  padding: 4px 15px;
  border-color: #d9d9d9;
  border-radius: 6px;
  background: #fff;
  color: rgba(0, 0, 0, 0.88);
  font-family: -apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
}
.today-modal-actions .today-btn-done {
  border-color: #d97757;
  background: #d97757;
  color: #fff;
}
@media (max-width: 640px) {
  .today-item {
    flex-direction: column;
    gap: 6px;
  }
  .today-item-time {
    width: auto;
  }
  .today-reflection {
    padding: 12px;
  }
  .today-action-feedback {
    justify-content: flex-start;
    border-radius: 8px;
  }
  .today-reflection-story-wide {
    display: none;
  }
  .today-reflection-story-compact {
    display: inline;
  }
}
</style>
