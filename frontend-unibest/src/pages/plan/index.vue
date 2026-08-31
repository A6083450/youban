<script setup lang="ts">
import type {
  AttractionMutationInputDto,
  BudgetItemInputDto,
  BudgetLedgerItemDto,
  BudgetLedgerResponseDto,
  ExecutionMapDto,
  ItemExecutionStatusDto,
  NativeCalendarEventDto,
} from '@youban/contracts'
import {
  onLoad,
  onShareAppMessage,
  onShareTimeline,
  onUnload,
} from '@dcloudio/uni-app'
import QRCode from 'qrcode'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AttractionEditor from '@/components/trip/AttractionEditor.vue'
import BudgetEditor from '@/components/trip/BudgetEditor.vue'
import PlanSidebar from '@/components/layout/PlanSidebar.vue'
import PlanEditDock from '@/components/trip/PlanEditDock.vue'
import SharePlanModal from '@/components/trip/SharePlanModal.vue'
import TripResult from '@/components/trip/TripResult.vue'
import { mobileActionsRightCss, safeAreaTopCss } from '@/features/layout/safe-area'
import { renderTripGuideImage, saveImageToAlbum } from '@/features/result/guide-image'
import { buildTripCalendar, extractTripPlan, resolveMediaUrl } from '@/features/result/model'
import type { TripPlan } from '@/features/result/model'
import {
  buildWebGuideHtml,
  downloadWebGuide,
  renderWebGuidePdf,
  renderWebGuidePng,
  webGuideFileName,
} from '@/features/result/web-export'
import { getApiBaseUrl } from '@/http/client'
import { addCalendarEventsSequentially, calendarEventsFromAction } from '@/platform/native-actions'
import { usePreferencesStore } from '@/store/preferences'
import { safeAreaInsets, systemInfo } from '@/utils/systemInfo'
import {
  completeMiniProgramAction,
  createBudgetItem,
  createItineraryAttraction,
  createMiniProgramAction,
  createTripShare,
  deleteBudgetItem,
  deleteItineraryAttraction,
  getBudgetItems,
  getMiniProgramAction,
  getTaskStatus,
  retryTripPlan,
  updateBudgetItem,
  updateItineraryAttraction,
  updateTripItemStatus,
} from '@/services/v2'

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '行程详情',
    enablePullDownRefresh: false,
  },
})

type ResultSection = 'today' | 'overview' | 'days' | 'map' | 'budget' | 'weather'

const plan = ref<TripPlan | null>(null)
const preferences = usePreferencesStore()
const { t } = useI18n()
const planId = ref('')
const initialSection = ref<ResultSection>('overview')
const state = ref<'loading' | 'processing' | 'ready' | 'failed'>('loading')
const progress = ref(0)
const progressText = ref(t('common.loading'))
const errorMessage = ref('')
const shareCode = ref('')
const sharePreparing = ref(false)
const shareModalOpen = ref(false)
const actionBusy = ref(false)
const drawerOpen = ref(false)
const budgetLedger = ref<BudgetLedgerResponseDto | null>(null)
const enhancementStatus = ref<'pending' | 'running' | 'completed' | 'failed' | 'skipped' | null>(null)
const budgetEditorOpen = ref(false)
const budgetEditingItem = ref<BudgetLedgerItemDto | null>(null)
const budgetSaving = ref(false)
const execution = ref<ExecutionMapDto>({})
const statusBusyItem = ref('')
const attractionEditorOpen = ref(false)
const attractionEditingItem = ref<{ attraction: TripPlan['days'][number]['attractions'][number], dayIndex: number } | null>(null)
const tripResultRef = ref<InstanceType<typeof TripResult> | null>(null)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0

const validSections = new Set<ResultSection>(['today', 'overview', 'days', 'map', 'budget', 'weather'])

function getMenuButtonLeft(): number | undefined {
  // #ifdef MP-WEIXIN
  return uni.getMenuButtonBoundingClientRect().left
  // #endif
  // #ifndef MP-WEIXIN
  return undefined
  // #endif
}

const mobileSafeTop = safeAreaTopCss(safeAreaInsets?.top)
const mobileHeaderStyle = {
  '--mobile-safe-top': mobileSafeTop,
  '--mobile-actions-right': mobileActionsRightCss(systemInfo?.windowWidth, getMenuButtonLeft()),
  '--plan-mobile-header-height': `calc(48px + ${mobileSafeTop})`,
}

function errorText(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

function stopPolling(): void {
  if (pollTimer)
    clearTimeout(pollTimer)
  pollTimer = undefined
}

async function prepareShare(): Promise<void> {
  if (!planId.value || shareCode.value || sharePreparing.value)
    return
  sharePreparing.value = true
  try {
    const result = await createTripShare(planId.value)
    shareCode.value = result.share_code
  }
  catch {
    // The result remains usable when share-token preparation is temporarily unavailable.
  }
  finally {
    sharePreparing.value = false
  }
}

async function loadBudget(): Promise<void> {
  if (!planId.value)
    return
  try {
    budgetLedger.value = await getBudgetItems(planId.value)
  }
  catch {
    budgetLedger.value = null
  }
}

async function loadPlan(token: number): Promise<void> {
  try {
    const status = await getTaskStatus(planId.value)
    if (token !== generation)
      return
    if (status.status === 'completed') {
      const result = extractTripPlan(status.result)
      if (!result)
        throw new Error(t('result.noTripPlan'))
      plan.value = result
      execution.value = status.execution
      state.value = 'ready'
      progress.value = 100
      progressText.value = t('chatHome.doneTitle')
      enhancementStatus.value = status.enhancement_status ?? null
      void prepareShare()
      void loadBudget()
      if (status.plan_quality === 'fast' && !['completed', 'failed', 'skipped'].includes(status.enhancement_status || ''))
        pollTimer = setTimeout(() => void loadPlan(token), 1500)
      return
    }
    if (status.status === 'failed') {
      state.value = 'failed'
      errorMessage.value = status.error || t('api.generateTripPlanFailed')
      return
    }
    state.value = 'processing'
    progress.value = Math.max(0, Math.min(100, status.progress))
    progressText.value = status.progress_text || t('home.loading.generatingPlan')
    pollTimer = setTimeout(() => void loadPlan(token), 1800)
  }
  catch (error) {
    if (token !== generation)
      return
    state.value = 'failed'
    errorMessage.value = error instanceof Error ? error.message : t('api.queryTaskStatusFailed')
  }
}

function reload(): void {
  stopPolling()
  state.value = 'loading'
  errorMessage.value = ''
  const token = ++generation
  void loadPlan(token)
}

async function retry(restartAll = false): Promise<void> {
  if (!planId.value || actionBusy.value)
    return
  actionBusy.value = true
  try {
    await retryTripPlan(planId.value, restartAll)
    reload()
  }
  catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : t('api.generateTripPlanFailed'), icon: 'none' })
  }
  finally {
    actionBusy.value = false
  }
}

function goBack(): void {
  if (getCurrentPages().length > 1)
    uni.navigateBack()
  else
    uni.reLaunch({ url: '/pages/index/index' })
}

function applyEditedPlan(updated: TripPlan): void {
  plan.value = updated
  void loadBudget()
}

function openBudgetEditor(item: BudgetLedgerItemDto | null = null): void {
  if (item?.type === 'attraction' && item.linked_item_id) {
    for (const day of plan.value?.days || []) {
      const attraction = day.attractions.find(candidate => candidate.id === item.linked_item_id)
      if (attraction) {
        attractionEditingItem.value = { attraction, dayIndex: day.day_index }
        attractionEditorOpen.value = true
        return
      }
    }
  }
  budgetEditingItem.value = item
  budgetEditorOpen.value = true
}

function openAttractionEditor(): void {
  attractionEditingItem.value = null
  attractionEditorOpen.value = true
}

function applyItineraryMutation(response: Awaited<ReturnType<typeof createItineraryAttraction>>): void {
  const updated = extractTripPlan({ data: response.plan })
  if (!updated)
    throw new Error(t('result.noTripPlan'))
  plan.value = updated
  budgetLedger.value = response
}

async function saveAttraction(input: AttractionMutationInputDto, itemId: string): Promise<void> {
  if (budgetSaving.value)
    return
  budgetSaving.value = true
  try {
    const response = itemId
      ? await updateItineraryAttraction(planId.value, itemId, input)
      : await createItineraryAttraction(planId.value, input)
    applyItineraryMutation(response)
    attractionEditorOpen.value = false
    attractionEditingItem.value = null
    uni.showToast({ title: t(itemId ? 'result.messages.attractionUpdated' : 'result.messages.attractionAdded'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: errorText(error, t('result.messages.attractionSaveFailed')), icon: 'none' })
  }
  finally {
    budgetSaving.value = false
  }
}

async function saveBudgetItem(input: BudgetItemInputDto): Promise<void> {
  if (budgetSaving.value)
    return
  budgetSaving.value = true
  const isEditing = Boolean(budgetEditingItem.value)
  try {
    budgetLedger.value = budgetEditingItem.value
      ? await updateBudgetItem(planId.value, budgetEditingItem.value.id, input)
      : await createBudgetItem(planId.value, input)
    budgetEditorOpen.value = false
    budgetEditingItem.value = null
    uni.showToast({ title: t(isEditing ? 'result.messages.budgetItemUpdated' : 'result.messages.budgetItemAdded'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: errorText(error, t('result.messages.budgetSaveFailed')), icon: 'none' })
  }
  finally {
    budgetSaving.value = false
  }
}

async function removeBudgetItem(item: BudgetLedgerItemDto): Promise<void> {
  const linkedAttraction = item.type === 'attraction' && item.linked_item_id
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: linkedAttraction ? t('result.budget.deleteAttractionTitle') : t('result.budget.confirmDeleteTitle'),
      content: linkedAttraction
        ? t('result.budget.deleteAttractionContent', { name: item.name })
        : t('result.budget.confirmDeleteDescription', { name: item.name }),
      confirmColor: '#c2413a',
      success: result => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed)
    return
  try {
    if (linkedAttraction) {
      applyItineraryMutation(await deleteItineraryAttraction(planId.value, item.linked_item_id))
      const next = { ...execution.value }
      delete next[item.linked_item_id]
      execution.value = next
    }
    else {
      budgetLedger.value = await deleteBudgetItem(planId.value, item.id)
    }
    uni.showToast({ title: t(linkedAttraction ? 'result.messages.attractionDeletedEverywhere' : 'result.messages.budgetItemDeleted'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: errorText(error, t('sidebar.deleteFailed')), icon: 'none' })
  }
}

async function updateItemStatus(payload: {
  itemId: string
  status: ItemExecutionStatusDto
  actualCost?: number
}): Promise<void> {
  if (!payload.itemId || statusBusyItem.value)
    return
  const previous = execution.value[payload.itemId]
  const optimistic = { ...execution.value }
  if (payload.status === 'pending') {
    delete optimistic[payload.itemId]
  }
  else {
    optimistic[payload.itemId] = {
      status: payload.status,
      updated_at: new Date().toISOString(),
      ...(payload.actualCost === undefined ? {} : { actual_cost: payload.actualCost }),
    }
  }
  execution.value = optimistic
  statusBusyItem.value = payload.itemId
  try {
    const response = await updateTripItemStatus(planId.value, payload.itemId, {
      status: payload.status,
      ...(payload.actualCost === undefined ? {} : { actual_cost: payload.actualCost }),
    })
    const confirmed = { ...execution.value }
    if (response.execution)
      confirmed[payload.itemId] = response.execution
    else
      delete confirmed[payload.itemId]
    execution.value = confirmed
  }
  catch (error) {
    const rollback = { ...execution.value }
    if (previous)
      rollback[payload.itemId] = previous
    else
      delete rollback[payload.itemId]
    execution.value = rollback
    uni.showToast({ title: errorText(error, t('result.today.updateFailed')), icon: 'none' })
  }
  finally {
    statusBusyItem.value = ''
  }
}

async function restoreBudgetItem(item: BudgetLedgerItemDto): Promise<void> {
  try {
    budgetLedger.value = await updateBudgetItem(planId.value, item.id, { deleted: false })
    uni.showToast({ title: t('result.messages.budgetItemRestored'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: errorText(error, t('result.messages.budgetSaveFailed')), icon: 'none' })
  }
}

async function sharePlan(): Promise<void> {
  await prepareShare()
  if (!shareCode.value) {
    uni.showToast({ title: t('result.share.createFailed'), icon: 'none' })
    return
  }
  // #ifdef H5
  shareModalOpen.value = true
  // #endif
}

function downloadCalendar(): void {
  if (!plan.value)
    return
  // #ifdef H5
  const blob = new Blob([buildTripCalendar(plan.value)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = `${t('app.brand')}_${plan.value.city}_${plan.value.start_date}.ics`
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
  uni.showToast({ title: t('result.messages.calendarSuccess'), icon: 'success' })
  // #endif
}

function addPhoneCalendar(event: NativeCalendarEventDto): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // #ifdef MP-WEIXIN
    wx.addPhoneCalendar({
      title: event.title,
      startTime: event.startTime,
      endTime: String(event.endTime),
      allDay: event.allDay,
      description: event.description,
      location: event.location,
      alarm: event.alarm,
      alarmOffset: event.alarmOffset,
      success: () => resolve(),
      fail: reject,
    })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error(t('result.messages.calendarEmpty')))
    // #endif
  })
}

async function addCalendar(): Promise<void> {
  if (!plan.value || actionBusy.value)
    return
  // #ifdef H5
  downloadCalendar()
  return
  // #endif
  // #ifdef MP-WEIXIN
  actionBusy.value = true
  let actionId = ''
  try {
    const ticket = await createMiniProgramAction({ type: 'add_calendar', plan_id: planId.value })
    actionId = ticket.action_id
    const action = await getMiniProgramAction(actionId)
    const events = calendarEventsFromAction(action)
    if (!events.length)
      throw new Error(t('result.messages.calendarEmpty'))
    await addCalendarEventsSequentially(events, addPhoneCalendar)
    await completeMiniProgramAction(actionId)
    actionId = ''
    uni.showToast({ title: t('result.messages.calendarSuccess'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: errorText(error, t('result.messages.calendarFailed', { error: '' })), icon: 'none' })
  }
  finally {
    if (actionId)
      void completeMiniProgramAction(actionId).catch(() => undefined)
    actionBusy.value = false
  }
  // #endif
}

async function exportGuide(format: 'image' | 'pdf' = 'image'): Promise<void> {
  const current = plan.value
  if (!current || actionBusy.value)
    return
  // #ifdef H5
  actionBusy.value = true
  uni.showLoading({
    title: t(format === 'pdf' ? 'result.messages.generatingPdf' : 'result.messages.generatingImage'),
    mask: true,
  })
  try {
    const mapDataUrl = await tripResultRef.value?.captureMapScreenshot() || ''
    const footerQrDataUrl = await QRCode.toDataURL(window.location.href, { width: 120, margin: 1 })
    const exportPlan: TripPlan = current.budget || !budgetLedger.value
      ? current
      : { ...current, budget: budgetLedger.value.totals }
    const html = buildWebGuideHtml(exportPlan, (key, params) => t(key, params || {}), {
      mapDataUrl,
      footerQrDataUrl,
      resolveImageUrl: value => resolveMediaUrl(value, getApiBaseUrl()),
    })
    const prefix = t('result.export.filePrefix')
    const timestamp = Date.now()
    if (format === 'pdf') {
      const bytes = await renderWebGuidePdf(html, (key, params) => t(key, params || {}))
      downloadWebGuide(bytes, webGuideFileName(prefix, current.city, timestamp, 'pdf'), 'application/pdf')
      uni.showToast({ title: t('result.messages.pdfSuccess'), icon: 'success' })
    }
    else {
      const blob = await renderWebGuidePng(html)
      downloadWebGuide(blob, webGuideFileName(prefix, current.city, timestamp, 'png'), 'image/png')
      uni.showToast({ title: t('result.messages.imageSuccess'), icon: 'success' })
    }
  }
  catch (error) {
    uni.showToast({
      title: t(format === 'pdf' ? 'result.messages.pdfFailed' : 'result.messages.imageFailed', {
        error: errorText(error, ''),
      }),
      icon: 'none',
    })
  }
  finally {
    uni.hideLoading()
    actionBusy.value = false
  }
  return
  // #endif
  // #ifdef MP-WEIXIN
  actionBusy.value = true
  uni.showLoading({ title: t('result.messages.generatingImage'), mask: true })
  try {
    const filePath = await renderTripGuideImage(current!, 'guide-canvas')
    await saveImageToAlbum(filePath)
    uni.hideLoading()
    uni.showToast({ title: t('result.messages.imageSuccess'), icon: 'success' })
  }
  catch (error) {
    uni.hideLoading()
    uni.showToast({ title: errorText(error, t('result.messages.imageFailed', { error: '' })), icon: 'none' })
  }
  finally {
    actionBusy.value = false
  }
  // #endif
}

onShareAppMessage(() => ({
  title: plan.value
    ? t('result.export.shareTitle', { city: plan.value.city })
    : t('result.export.shareDefaultTitle'),
  path: shareCode.value
    ? `/pages/share/index?code=${encodeURIComponent(shareCode.value)}`
    : '/pages/index/index',
}))

onShareTimeline(() => ({
  title: plan.value
    ? t('result.export.shareTitle', { city: plan.value.city })
    : t('result.export.shareDefaultTitle'),
  query: shareCode.value ? `code=${encodeURIComponent(shareCode.value)}` : '',
}))

onLoad((query) => {
  void preferences.sync()
  planId.value = typeof query?.id === 'string' ? query.id.trim() : ''
  const section = typeof query?.section === 'string' ? query.section as ResultSection : 'overview'
  initialSection.value = validSections.has(section) ? section : 'overview'
  if (!planId.value) {
    state.value = 'failed'
    errorMessage.value = t('result.noTripPlan')
    return
  }
  reload()
})

onUnload(() => {
  generation += 1
  stopPolling()
})
</script>

<template>
  <view class="plan-page" :class="preferences.themeClass" :style="mobileHeaderStyle">
    <!-- #ifdef MP-WEIXIN -->
    <view class="plan-mobile-header">
      <button class="back-button" :title="t('result.backHome')" :aria-label="t('result.backHome')" @click="goBack">
        <wd-icon name="arrow-left" size="22px" />
      </button>
      <text class="plan-mobile-title">{{ plan?.city || t('result.pageTitle') }}</text>
    </view>
    <!-- #endif -->
    <PlanSidebar :active-plan-id="planId" :open="drawerOpen" @close="drawerOpen = false" />
    <main class="plan-content">
      <!-- #ifndef MP-WEIXIN -->
      <button class="back-button" :title="t('result.backHome')" :aria-label="t('result.backHome')" @click="goBack">
        <wd-icon name="arrow-left" size="22px" />
      </button>
      <!-- #endif -->

      <view v-if="state === 'loading' || state === 'processing'" class="task-state">
        <view class="loader-ring" />
        <text class="task-title">{{ progressText }}</text>
        <view class="progress-track">
          <view class="progress-value" :style="{ width: `${progress}%` }" />
        </view>
        <text class="progress-label">{{ progress }}%</text>
      </view>

      <view v-else-if="state === 'failed'" class="task-state failed-state">
        <wd-icon name="warning" size="34px" color="#c2413a" />
        <text class="task-title">{{ t('tripFailure.title') }}</text>
        <text class="task-message">{{ errorMessage }}</text>
        <view class="failure-actions">
          <button class="primary-command" :disabled="actionBusy" @click="retry(false)">
            {{ t('tripFailure.retry') }}
          </button>
          <button class="secondary-command" :disabled="actionBusy" @click="retry(true)">
            {{ t('tripFailure.restartAll') }}
          </button>
        </view>
      </view>

      <TripResult
        v-else-if="plan"
        ref="tripResultRef"
        :plan="plan"
        :plan-id="planId"
        :initial-section="initialSection"
        :share-ready="!sharePreparing"
        :budget-ledger="budgetLedger"
        :execution="execution"
        :status-busy="Boolean(statusBusyItem)"
        :actions-busy="actionBusy"
        :enhancement-status="enhancementStatus"
        @share="sharePlan"
        @export="exportGuide"
        @calendar="addCalendar"
        @budget-add="openBudgetEditor(null)"
        @attraction-add="openAttractionEditor"
        @budget-edit="openBudgetEditor"
        @budget-delete="removeBudgetItem"
        @budget-restore="restoreBudgetItem"
        @item-status="updateItemStatus"
      />
      <PlanEditDock
        v-if="state === 'ready' && plan"
        :plan="plan"
        :plan-id="planId"
        @update="applyEditedPlan"
      />
      <SharePlanModal
        :open="shareModalOpen"
        :share-code="shareCode"
        @close="shareModalOpen = false"
      />
      <BudgetEditor
        v-if="plan"
        :open="budgetEditorOpen"
        :item="budgetEditingItem"
        :days="plan.days"
        :saving="budgetSaving"
        @close="budgetEditorOpen = false"
        @save="saveBudgetItem"
      />
      <AttractionEditor
        v-if="plan"
        :open="attractionEditorOpen"
        :plan-city="plan.city"
        :days="plan.days"
        :item="attractionEditingItem"
        :saving="budgetSaving"
        @close="attractionEditorOpen = false"
        @save="saveAttraction"
      />

      <canvas canvas-id="guide-canvas" class="guide-canvas" />
    </main>
  </view>
</template>

<style scoped>
.plan-page {
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  min-height: 100vh;
  background: var(--surface-page);
}
.plan-content {
  position: relative;
  min-width: 0;
  height: 100%;
  overflow: auto;
  flex: 1;
}
.plan-mobile-header {
  display: none;
}
.back-button,
.primary-command,
.secondary-command {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  line-height: 1.4;
}
.back-button::after,
.primary-command::after,
.secondary-command::after {
  display: none;
}
.back-button {
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  background: rgba(255, 250, 246, 0.94);
  color: var(--text-primary);
  box-shadow: 0 5px 16px rgba(61, 50, 41, 0.1);
}
/* #ifndef MP-WEIXIN */
.back-button {
  position: fixed;
  z-index: 60;
  top: max(14px, env(safe-area-inset-top));
  left: 14px;
}
/* #endif */
@media (min-width: 769px) {
  .back-button {
    display: none;
  }
}
@media (max-width: 768px) {
  .plan-page {
    display: flex;
    flex-direction: column;
  }
  /* #ifdef MP-WEIXIN */
  .plan-mobile-header {
    position: relative;
    z-index: 70;
    display: flex;
    box-sizing: border-box;
    height: var(--plan-mobile-header-height);
    flex: 0 0 var(--plan-mobile-header-height);
    padding: var(--mobile-safe-top) var(--mobile-actions-right) 0 12px;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-navigation);
  }
  .plan-mobile-header .back-button {
    flex: 0 0 auto;
    box-shadow: none;
  }
  .plan-mobile-title {
    position: absolute;
    top: var(--mobile-safe-top);
    left: 50%;
    display: flex;
    height: 48px;
    max-width: 42%;
    align-items: center;
    overflow: hidden;
    transform: translateX(-50%);
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plan-content {
    height: auto;
    min-height: 0;
  }
  /* #endif */
}
.task-state {
  display: flex;
  box-sizing: border-box;
  min-height: 100vh;
  padding: 72px 24px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: var(--surface-page);
  color: var(--text-primary);
}
.loader-ring {
  width: 38px;
  height: 38px;
  border: 3px solid rgba(217, 119, 87, 0.18);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.task-title {
  margin-top: 20px;
  font-size: 20px;
  font-weight: 700;
}
.task-message {
  max-width: 520px;
  margin-top: 9px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
  text-align: center;
}
.progress-track {
  width: min(340px, 78vw);
  height: 6px;
  margin-top: 24px;
  overflow: hidden;
  border-radius: 3px;
  background: rgba(217, 119, 87, 0.13);
}
.progress-value {
  height: 100%;
  border-radius: 3px;
  background: var(--accent-primary);
  transition: width 0.25s ease;
}
.progress-label {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.failure-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 24px;
}
.primary-command,
.secondary-command {
  min-height: 40px;
  padding: 9px 17px;
  border-radius: 6px;
  font-size: 14px;
}
.primary-command {
  background: var(--accent-primary);
  color: white;
}
.secondary-command {
  border: 1px solid var(--border-subtle);
  background: var(--surface-elevated);
  color: var(--text-primary);
}
.guide-canvas {
  position: fixed;
  z-index: -1;
  top: -2000px;
  left: -2000px;
  width: 750px;
  height: 1334px;
  pointer-events: none;
}
:deep(.result-surface) {
  padding-bottom: 132px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media print {
  .back-button {
    display: none;
  }
}
</style>
