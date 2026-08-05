<template>
  <div class="trip-today">
    <!-- 行程期内:当天视图 -->
    <template v-if="mode === 'active' && day">
      <header class="today-header">
        <div class="today-header-main">
          <span class="today-date">{{ day.date }}</span>
          <span class="today-title">{{ t('result.today.headerDay', { day: dayArrayIndex + 1, city: day.city || tripPlan.city }) }}</span>
          <span v-if="todayWeather" class="today-weather">{{ todayWeather.day_weather }} {{ todayWeather.night_temp }}~{{ todayWeather.day_temp }}°C</span>
        </div>
        <div class="today-progress">
          <span class="today-progress-text">{{ t('result.today.progress', progress) }}</span>
          <div class="today-progress-bar"><i :style="{ width: progressPercent + '%' }"></i></div>
        </div>
      </header>

      <div v-if="day.is_transfer_day && day.transfer_info" class="today-context-card">
        <span class="today-context-label">{{ t('result.today.transferCard') }}</span>
        <span>{{ day.transfer_info }}</span>
      </div>

      <section
        v-if="progress.total > 0"
        class="today-reflection"
        :class="{ 'is-complete': reflectionState === 'complete' }"
        :aria-label="t('result.today.reflectionLabel')"
      >
        <div class="today-reflection-mark" aria-hidden="true">
          <TrophyOutlined />
        </div>
        <div class="today-reflection-content">
          <div class="today-reflection-kicker">
            {{ t('result.today.achievement', { percent: progressPercent }) }}
          </div>
          <h3>{{ reflectionTitle }}</h3>
          <p>{{ reflectionSummary }}</p>
          <p v-if="completedStory" class="today-reflection-story">
            <CheckCircleFilled aria-hidden="true" />
            <span class="today-reflection-story-wide">{{ completedStory }}</span>
            <span class="today-reflection-story-compact">
              {{ t('result.today.reflection.storyCompact', { count: doneItems.length }) }}
            </span>
          </p>
        </div>
      </section>

      <a-empty v-if="mainItems.length === 0 && laterItems.length === 0" :description="t('result.today.noActionable')" />

      <div class="today-timeline">
        <article
          v-for="item in mainItems"
          :key="item.id || item.name"
          class="today-item"
          :class="[`is-${item.status}`, `kind-${item.kind}`]"
        >
          <div class="today-item-time">{{ item.timeLabel || '—' }}</div>
          <div class="today-item-body">
            <img
              v-if="item.kind === 'attraction' && attractionPhotos[item.name] && !failedThumbs.has(item.name)"
              :src="attractionPhotos[item.name]"
              :alt="item.name"
              class="today-item-thumb"
              @error="onThumbError(item.name)"
            />
            <div class="today-item-head">
              <span class="today-item-name">{{ item.name }}</span>
              <span v-if="item.kind === 'meal'" class="today-item-tag">{{ mealLabel(item.category) }}</span>
              <span v-else-if="item.category" class="today-item-tag">{{ item.category }}</span>
              <span v-if="item.status !== 'pending'" class="today-item-status">{{ statusLabel(item.status) }}</span>
            </div>
            <p v-if="item.description" class="today-item-desc">{{ item.description }}</p>
            <div class="today-item-actions">
              <template v-if="item.status === 'pending'">
                <button type="button" class="today-btn today-btn-done" :disabled="!canOperate(item)" @click="openDoneModal(item)">{{ t('result.today.actionDone') }}</button>
                <button type="button" class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'skipped')">{{ t('result.today.actionSkip') }}</button>
                <button type="button" class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'postponed')">{{ t('result.today.actionPostpone') }}</button>
              </template>
              <button v-else type="button" class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'pending')">{{ t('result.today.actionRestore') }}</button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="laterItems.length" class="today-later">
        <div class="today-later-title">{{ t('result.today.laterGroup') }}</div>
        <article v-for="item in laterItems" :key="item.id || item.name" class="today-item is-postponed" :class="`kind-${item.kind}`">
          <div class="today-item-time">{{ item.timeLabel || '—' }}</div>
          <div class="today-item-body">
            <div class="today-item-head">
              <span class="today-item-name">{{ item.name }}</span>
              <span class="today-item-status">{{ statusLabel(item.status) }}</span>
            </div>
            <div class="today-item-actions">
              <button type="button" class="today-btn today-btn-done" :disabled="!canOperate(item)" @click="openDoneModal(item)">{{ t('result.today.actionDone') }}</button>
              <button type="button" class="today-btn" :disabled="!canOperate(item)" @click="emitStatus(item, 'pending')">{{ t('result.today.actionRestore') }}</button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="day.hotel" class="today-context-card">
        <span class="today-context-label">{{ t('result.today.hotelCard') }}</span>
        <span>{{ day.hotel.name }}</span>
      </div>

      <p v-if="!online" class="today-offline-hint">{{ t('result.today.offlineHint') }}</p>

      <div class="today-action-feedback-shell">
        <Transition name="today-feedback">
          <div
            v-if="actionFeedback"
            :key="actionFeedback.id"
            class="today-action-feedback"
            :class="`is-${actionFeedback.status}`"
            role="status"
            aria-live="polite"
          >
            <CheckCircleFilled v-if="actionFeedback.status === 'done'" aria-hidden="true" />
            <CompassOutlined v-else aria-hidden="true" />
            <span class="today-action-feedback-copy">
              <strong>{{ actionFeedback.name }}</strong><span class="today-action-feedback-message">{{ actionFeedbackSeparator }}{{ actionFeedback.message }}</span>
            </span>
          </div>
        </Transition>
      </div>
    </template>

    <!-- 出发前:倒计时 + 首日预览 -->
    <template v-else-if="mode === 'before'">
      <div class="today-placeholder">
        <div class="today-countdown">{{ t('result.today.countdown', { days: daysToStart }) }}</div>
        <div class="today-later-title">{{ t('result.today.firstDayPreview') }}</div>
        <ul class="today-preview-list">
          <li v-for="item in firstDayPreview" :key="item.name">{{ item.timeLabel || '—' }} · {{ item.name }}</li>
        </ul>
      </div>
    </template>

    <!-- 结束后:完成统计 -->
    <template v-else>
      <div class="today-placeholder">
        <div class="today-countdown">{{ t('result.today.endedTitle') }}</div>
        <div class="today-ended-summary">{{ t('result.today.endedSummary', endedSummary) }}</div>
      </div>
    </template>

    <!-- 完成弹层:可选实际花费 -->
    <a-modal
      v-model:open="doneModalOpen"
      :title="t('result.today.doneModalTitle')"
      :ok-text="t('result.today.confirmDone')"
      :cancel-text="t('common.cancel')"
      @ok="confirmDone"
    >
      <p class="today-modal-name">{{ doneTarget?.name }}</p>
      <div class="today-modal-cost">
        <label>{{ t('result.today.actualCostLabel') }}</label>
        <a-input-number
          v-model:value="doneCost"
          :min="0"
          :precision="0"
          :placeholder="t('result.today.actualCostPlaceholder')"
          style="width: 100%"
        />
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { CheckCircleFilled, CompassOutlined, TrophyOutlined } from '@ant-design/icons-vue'
import type { ExecutionMap, ItemExecutionStatus, TripPlan } from '@/types'
import { buildTodayTimeline, todayProgress, type TodayTimelineItem } from '@/utils/tripExecution'

const props = defineProps<{
  tripPlan: TripPlan
  execution: ExecutionMap
  /** 今天在 days 数组中的下标;<0 时按出发前/已结束展示 */
  dayArrayIndex: number
  /** 景点图片(按景点名索引),由父组件 Result.vue 提供 */
  attractionPhotos?: Record<string, string>
  confirmedStatusFeedback?: { id: number; itemId: string; status: ItemExecutionStatus }
}>()

// prop 可选,模板统一走带兜底的访问器
const attractionPhotos = computed<Record<string, string>>(() => props.attractionPhotos || {})

const emit = defineEmits<{
  (event: 'update-status', payload: { itemId: string; status: ItemExecutionStatus; actualCost?: number }): void
}>()

const { t, te, locale } = useI18n()

const online = ref(navigator.onLine)
const setOnline = () => { online.value = true }
const setOffline = () => { online.value = false }
onMounted(() => {
  window.addEventListener('online', setOnline)
  window.addEventListener('offline', setOffline)
})
onUnmounted(() => {
  window.removeEventListener('online', setOnline)
  window.removeEventListener('offline', setOffline)
})

const todayStr = dayjs().format('YYYY-MM-DD')

const mode = computed<'active' | 'before' | 'after'>(() => {
  if (props.dayArrayIndex >= 0) return 'active'
  return todayStr < props.tripPlan.start_date ? 'before' : 'after'
})

const day = computed(() => (props.dayArrayIndex >= 0 ? props.tripPlan.days[props.dayArrayIndex] : null))

const timeline = computed<TodayTimelineItem[]>(() =>
  day.value ? buildTodayTimeline(day.value, props.execution) : [],
)
const mainItems = computed(() => timeline.value.filter((item) => item.status !== 'postponed'))
const laterItems = computed(() => timeline.value.filter((item) => item.status === 'postponed'))
const progress = computed(() => todayProgress(timeline.value))
const progressPercent = computed(() =>
  progress.value.total === 0 ? 0 : Math.round((progress.value.done / progress.value.total) * 100),
)
const doneItems = computed(() => timeline.value.filter((item) => item.status === 'done'))
const deferredCount = computed(() =>
  timeline.value.filter((item) => item.status === 'skipped' || item.status === 'postponed').length,
)
const pendingCount = computed(() => timeline.value.filter((item) => item.status === 'pending').length)

type ReflectionState = 'start' | 'progress' | 'mixed' | 'complete' | 'deferred'
const reflectionState = computed<ReflectionState>(() => {
  if (progress.value.total > 0 && progress.value.done === progress.value.total) return 'complete'
  if (progress.value.done > 0 && pendingCount.value === 0 && deferredCount.value > 0) return 'mixed'
  if (progress.value.done > 0) return 'progress'
  if (pendingCount.value === 0 && deferredCount.value > 0) return 'deferred'
  return 'start'
})

const reflectionTitle = computed(() => t(`result.today.reflection.${reflectionState.value}Title`))
const reflectionSummary = computed(() => {
  const key = `result.today.reflection.${reflectionState.value}Summary`
  return t(key, {
    done: progress.value.done,
    total: progress.value.total,
    remaining: pendingCount.value,
    deferred: deferredCount.value,
  })
})

const completedStory = computed(() => {
  const names = doneItems.value.map((item) => item.name)
  if (names.length === 0) return ''
  const visibleNames = names.slice(0, 2)
  const localeCode = String(locale.value || 'zh-CN')
  const places = visibleNames.join(localeCode.toLowerCase().startsWith('en') ? ' and ' : '、')
  return names.length > visibleNames.length
    ? t('result.today.reflection.storyMore', { places, count: names.length })
    : t('result.today.reflection.story', { places })
})

const todayWeather = computed(() =>
  day.value ? props.tripPlan.weather_info?.find((w) => w.date === day.value?.date) : undefined,
)

const daysToStart = computed(() => Math.max(1, dayjs(props.tripPlan.start_date).diff(dayjs(todayStr), 'day')))

const firstDayPreview = computed(() =>
  props.tripPlan.days.length ? buildTodayTimeline(props.tripPlan.days[0], {}).slice(0, 5) : [],
)

const endedSummary = computed(() => {
  const entries = Object.values(props.execution)
  const done = entries.filter((entry) => entry.status === 'done')
  const cost = done.reduce((sum, entry) => sum + (entry.actual_cost || 0), 0)
  return { days: props.tripPlan.days.length, done: done.length, cost }
})

const canOperate = (item: TodayTimelineItem): boolean => Boolean(item.id) && online.value

type ActionFeedback = {
  id: number
  status: ItemExecutionStatus
  name: string
  message: string
}

const actionFeedback = ref<ActionFeedback | null>(null)
let feedbackSequence = 0
let feedbackTimer: number | undefined
const showActionFeedback = (item: TodayTimelineItem, status: ItemExecutionStatus) => {
  const keyByStatus: Record<ItemExecutionStatus, string> = {
    done: 'result.today.feedback.done',
    skipped: 'result.today.feedback.skipped',
    postponed: 'result.today.feedback.postponed',
    pending: 'result.today.feedback.restored',
  }
  window.clearTimeout(feedbackTimer)
  actionFeedback.value = {
    id: ++feedbackSequence,
    status,
    name: item.name,
    message: t(keyByStatus[status]),
  }
  feedbackTimer = window.setTimeout(() => {
    actionFeedback.value = null
  }, 3200)
}
const actionFeedbackSeparator = computed(() =>
  String(locale.value || '').toLowerCase().startsWith('en') ? ' ' : '',
)
watch(() => props.confirmedStatusFeedback, (feedback) => {
  if (!feedback) return
  const item = timeline.value.find((entry) => entry.id === feedback.itemId)
  if (item) showActionFeedback(item, feedback.status)
})

const emitStatus = (item: TodayTimelineItem, status: ItemExecutionStatus) => {
  if (!canOperate(item)) return
  emit('update-status', { itemId: item.id, status })
}

// 完成弹层
const doneModalOpen = ref(false)
const doneTarget = ref<TodayTimelineItem | null>(null)
const doneCost = ref<number | null>(null)
const openDoneModal = (item: TodayTimelineItem) => {
  if (!canOperate(item)) return
  doneTarget.value = item
  doneCost.value = item.costHint ?? null
  doneModalOpen.value = true
}
const confirmDone = () => {
  if (doneTarget.value) {
    emit('update-status', {
      itemId: doneTarget.value.id,
      status: 'done',
      actualCost: doneCost.value ?? undefined,
    })
  }
  doneModalOpen.value = false
  doneTarget.value = null
}

const mealLabel = (type?: string): string => {
  const key = type ? `result.meals.${type}` : ''
  return key && te(key) ? t(key) : type || ''
}

const statusLabel = (status: ItemExecutionStatus): string => {
  const map: Record<string, string> = {
    done: t('result.today.statusDone'),
    skipped: t('result.today.statusSkipped'),
    postponed: t('result.today.statusPostponed'),
  }
  return map[status] || ''
}

// 缩略图加载失败:隐藏该图片(不影响行程数据)
const failedThumbs = ref(new Set<string>())
const onThumbError = (name: string) => {
  failedThumbs.value = new Set([...failedThumbs.value, name])
}

onUnmounted(() => window.clearTimeout(feedbackTimer))
</script>

<style scoped>
.trip-today { display: flex; flex-direction: column; gap: 14px; }
.today-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 10px; }
.today-header-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.today-date { font-size: 13px; color: rgba(61, 50, 41, 0.55); letter-spacing: 0.04em; }
.today-title { font-size: 20px; font-weight: 700; color: #3d3229; }
.today-weather { font-size: 13px; color: rgba(61, 50, 41, 0.65); }
.today-progress { display: flex; align-items: center; gap: 10px; min-width: 180px; }
.today-progress-text { font-size: 13px; color: rgba(61, 50, 41, 0.7); white-space: nowrap; }
.today-progress-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(61, 50, 41, 0.1); overflow: hidden; }
.today-progress-bar i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #d8a94e, #c98a2d); transition: width 0.3s ease; }
.today-context-card { display: flex; gap: 10px; align-items: baseline; padding: 10px 14px; border-radius: 10px; background: rgba(216, 169, 78, 0.08); font-size: 13px; color: rgba(61, 50, 41, 0.8); }
.today-context-label { flex-shrink: 0; font-weight: 600; color: #a8752a; }
.today-context-card > span:last-child { min-width: 0; text-wrap: pretty; }
.today-reflection { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--accent-primary) 22%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--accent-primary) 7%, var(--surface-elevated)); }
.today-reflection.is-complete { border-color: color-mix(in srgb, var(--status-success) 28%, transparent); background: color-mix(in srgb, var(--status-success) 8%, var(--surface-elevated)); }
.today-reflection-mark { display: grid; flex: 0 0 36px; width: 36px; height: 36px; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--accent-primary) 14%, var(--surface-elevated)); color: var(--accent-strong); font-size: 17px; }
.today-reflection.is-complete .today-reflection-mark { background: color-mix(in srgb, var(--status-success) 15%, var(--surface-elevated)); color: var(--status-success); }
.today-reflection-content { min-width: 0; }
.today-reflection-kicker { margin-bottom: 2px; color: var(--accent-strong); font-size: 12px; font-weight: 600; line-height: 1.4; }
.today-reflection.is-complete .today-reflection-kicker { color: var(--status-success); }
.today-reflection h3 { margin: 0; color: var(--text-primary); font-size: 16px; font-weight: 700; line-height: 1.45; }
.today-reflection p { margin: 3px 0 0; color: var(--text-secondary); font-size: 14px; line-height: 1.6; text-wrap: pretty; }
.today-reflection-story { display: flex; align-items: flex-start; gap: 6px; }
.today-reflection-story .anticon { flex: 0 0 auto; margin-top: 4px; color: var(--status-success); font-size: 12px; }
.today-reflection-story-compact { display: none; }
.today-timeline, .today-later { display: flex; flex-direction: column; gap: 10px; }
.today-item { display: flex; gap: 12px; padding: 13px 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(61, 50, 41, 0.08); }
.today-item-time { flex-shrink: 0; width: 92px; font-size: 12px; color: rgba(61, 50, 41, 0.55); padding-top: 2px; font-variant-numeric: tabular-nums; }
.today-item-body { flex: 1; min-width: 0; }
.today-item-thumb { width: 100%; max-height: 150px; object-fit: cover; border-radius: 10px; margin-bottom: 9px; display: block; }
.today-item-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.today-item-name { font-size: 15px; font-weight: 600; color: #3d3229; }
.today-item-tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(61, 50, 41, 0.06); color: rgba(61, 50, 41, 0.6); }
.today-item-status { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: rgba(216, 169, 78, 0.16); color: #a8752a; }
.today-item-desc { margin: 6px 0 0; font-size: 12.5px; line-height: 1.6; color: rgba(61, 50, 41, 0.6); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.today-item-actions { display: flex; gap: 8px; margin-top: 10px; }
.today-btn { padding: 4px 14px; border-radius: 8px; border: 1px solid rgba(61, 50, 41, 0.15); background: transparent; font-size: 12.5px; color: rgba(61, 50, 41, 0.75); cursor: pointer; transition: all 0.15s ease; }
.today-btn:hover:not(:disabled) { border-color: #c98a2d; color: #a8752a; }
.today-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.today-btn-done { background: linear-gradient(135deg, #d8a94e, #c98a2d); border-color: transparent; color: #fff; }
.today-btn-done:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.today-item.is-done { border-color: color-mix(in srgb, var(--status-success) 20%, transparent); background: color-mix(in srgb, var(--status-success) 5%, var(--surface-elevated)); opacity: 1; }
.today-item.is-done .today-item-status { background: color-mix(in srgb, var(--status-success) 14%, transparent); color: var(--status-success); }
.today-item.is-skipped { background: color-mix(in srgb, var(--text-primary) 2%, var(--surface-elevated)); }
.today-item.is-skipped .today-item-name, .today-item.is-skipped .today-item-desc { color: color-mix(in srgb, var(--text-primary) 62%, transparent); }
.today-action-feedback-shell { position: fixed; z-index: 1100; bottom: 82px; left: 50%; width: min(520px, calc(100vw - 32px)); transform: translateX(-50%); pointer-events: none; }
.today-action-feedback { display: flex; align-items: center; justify-content: center; gap: 8px; width: fit-content; max-width: 100%; margin: 0 auto; padding: 10px 14px; border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--text-primary) 92%, transparent); box-shadow: 0 10px 28px color-mix(in srgb, var(--text-primary) 20%, transparent); color: var(--surface-elevated); font-size: 13px; line-height: 1.45; }
.today-action-feedback .anticon { flex: 0 0 auto; color: color-mix(in srgb, var(--accent-primary) 55%, white); }
.today-action-feedback.is-done .anticon { color: color-mix(in srgb, var(--status-success) 55%, white); }
.today-action-feedback-copy { min-width: 0; text-wrap: pretty; }
.today-action-feedback-copy strong { font-weight: 600; }
.today-feedback-enter-active, .today-feedback-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.today-feedback-enter-from, .today-feedback-leave-to { opacity: 0; transform: translateY(8px); }
.today-later-title { font-size: 13px; font-weight: 600; color: rgba(61, 50, 41, 0.5); letter-spacing: 0.04em; margin-top: 4px; }
.today-offline-hint { font-size: 12px; color: #b0483e; }
.today-placeholder { padding: 28px 8px; display: flex; flex-direction: column; gap: 12px; }
.today-countdown { font-size: 18px; font-weight: 700; color: #3d3229; }
.today-preview-list { margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 2; color: rgba(61, 50, 41, 0.75); }
.today-ended-summary { font-size: 14px; color: rgba(61, 50, 41, 0.7); }
.today-modal-name { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.today-modal-cost { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
@media (max-width: 640px) {
  .today-item { flex-direction: column; gap: 6px; }
  .today-item-time { width: auto; }
  .today-reflection { padding: 12px; }
  .today-action-feedback { justify-content: flex-start; border-radius: 8px; }
  .today-reflection-story-wide { display: none; }
  .today-reflection-story-compact { display: inline; }
  .today-action-feedback-copy strong, .today-action-feedback-message { display: block; }
  .today-action-feedback-message { margin-top: 2px; }
}
@media (prefers-reduced-motion: reduce) {
  .today-feedback-enter-active, .today-feedback-leave-active { transition: opacity 0.2s ease; }
  .today-feedback-enter-from, .today-feedback-leave-to { transform: none; }
}
</style>
