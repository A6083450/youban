<script setup lang="ts">
import type { NativeCalendarEventDto } from '@youban/contracts'
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TripResult from '@/components/trip/TripResult.vue'
import type { MobileMenuButtonRect } from '@/features/layout/safe-area'
import { mobileHeaderMetrics } from '@/features/layout/safe-area'
import { renderTripGuideImage, saveImageToAlbum } from '@/features/result/guide-image'
import {
  buildCalendarEvents,
  buildTripCalendar,
  extractTripPlan,
} from '@/features/result/model'
import type { TripPlan } from '@/features/result/model'
import { addCalendarEventsSequentially } from '@/platform/native-actions'
import { getSharedTripPlan } from '@/services/v2'
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'
import { safeAreaInsets, systemInfo } from '@/utils/systemInfo'

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '分享行程',
  },
})

const plan = ref<TripPlan | null>(null)
const auth = useAuthStore()
const preferences = usePreferencesStore()
const { t } = useI18n()
const shareCode = ref('')
const loading = ref(true)
const errorMessage = ref('')
const actionBusy = ref(false)

function getMenuButtonRect(): MobileMenuButtonRect | undefined {
  // #ifdef MP-WEIXIN
  return uni.getMenuButtonBoundingClientRect()
  // #endif
  // #ifndef MP-WEIXIN
  return undefined
  // #endif
}

const headerMetrics = mobileHeaderMetrics(systemInfo?.windowWidth, safeAreaInsets?.top, getMenuButtonRect())
const shareHeaderStyle = {
  '--mobile-actions-right': headerMetrics.actionsRight,
  '--mobile-menu-center': headerMetrics.menuCenter,
  '--mobile-header-height': headerMetrics.headerHeight,
  '--result-toolbar-top': headerMetrics.headerHeight,
}

function errorText(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

async function loadSharedPlan(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await getSharedTripPlan(shareCode.value)
    const result = extractTripPlan(response.result)
    if (!result)
      throw new Error(t('shareCode.notFound'))
    plan.value = result
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('shareCode.notFound')
  }
  finally {
    loading.value = false
  }
}

function goHome(): void {
  uni.reLaunch({ url: '/pages/index/index' })
}

function openPlans(): void {
  uni.reLaunch({ url: '/pages/index/index?plans=1' })
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
  const current = plan.value
  if (!current || actionBusy.value)
    return
  // #ifdef H5
  downloadCalendar()
  return
  // #endif
  // #ifdef MP-WEIXIN
  actionBusy.value = true
  try {
    const events = buildCalendarEvents(current!).map(event => ({
      ...event,
      endTime: Number(event.endTime),
      alarm: true,
      alarmOffset: 1800,
    }))
    await addCalendarEventsSequentially(events, addPhoneCalendar)
    uni.showToast({ title: t('result.messages.calendarSuccess'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: errorText(error, t('result.messages.calendarFailed', { error: '' })), icon: 'none' })
  }
  finally {
    actionBusy.value = false
  }
  // #endif
}

async function exportGuide(): Promise<void> {
  const current = plan.value
  if (!current || actionBusy.value)
    return
  // #ifdef H5
  window.print()
  return
  // #endif
  // #ifdef MP-WEIXIN
  actionBusy.value = true
  uni.showLoading({ title: t('result.messages.generatingImage'), mask: true })
  try {
    const filePath = await renderTripGuideImage(current!, 'shared-guide-canvas')
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
  path: `/pages/share/index?code=${encodeURIComponent(shareCode.value)}`,
}))

onShareTimeline(() => ({
  title: plan.value
    ? t('result.export.shareTitle', { city: plan.value.city })
    : t('result.export.shareDefaultTitle'),
  query: `code=${encodeURIComponent(shareCode.value)}`,
}))

onLoad((query) => {
  void preferences.sync()
  shareCode.value = typeof query?.code === 'string' ? query.code.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{32}$/.test(shareCode.value)) {
    loading.value = false
    errorMessage.value = t('shareCode.invalid')
    return
  }
  void loadSharedPlan()
})
</script>

<template>
  <view class="share-page" :class="preferences.themeClass" :style="shareHeaderStyle">
    <view class="share-navigation">
      <button class="share-home-action" :title="t('result.backHome')" :aria-label="t('result.backHome')" @click="goHome">
        <wd-icon name="home" size="18px" />
      </button>
      <text class="share-navigation-title">{{ t('result.share.pageTitle') }}</text>
    </view>
    <view v-if="loading" class="share-state">
      <view class="loader-ring" />
      <text>{{ t('common.loading') }}</text>
    </view>
    <view v-else-if="errorMessage" class="share-state">
      <wd-icon name="warning" size="34px" color="#c2413a" />
      <text class="state-title">{{ t('shareCode.errorTitle') }}</text>
      <text class="state-message">{{ errorMessage }}</text>
      <button class="primary-command" @click="goHome">
        {{ t('result.share.readonlyCta') }}
      </button>
    </view>
    <TripResult
      v-else-if="plan"
      :plan="plan"
      :readonly-action-label="auth.ready ? t('sidebar.plans') : ''"
      readonly
      @readonly-action="openPlans"
      @export="exportGuide"
      @calendar="addCalendar"
    />
    <canvas canvas-id="shared-guide-canvas" class="guide-canvas" />
  </view>
</template>

<style scoped>
.share-page {
  display: flex;
  width: 100%;
  min-height: 100vh;
  flex-direction: column;
  background: var(--surface-page);
}
.share-navigation {
  position: sticky;
  z-index: 70;
  top: 0;
  display: flex;
  box-sizing: border-box;
  height: var(--mobile-header-height);
  flex: 0 0 var(--mobile-header-height);
  padding: 0 var(--mobile-actions-right) 0 12px;
  align-items: flex-start;
  gap: 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-navigation);
}
.share-home-action,
.primary-command {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  line-height: 1.4;
}
.share-home-action::after,
.primary-command::after {
  display: none;
}
.share-home-action {
  display: inline-flex;
  width: 40px;
  height: 40px;
  margin-top: calc(var(--mobile-menu-center) - 20px);
  padding: 0;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  background: var(--surface-elevated);
  color: var(--text-primary);
}
.share-navigation-title {
  position: absolute;
  top: var(--mobile-menu-center);
  left: 50%;
  max-width: calc(100% - var(--mobile-actions-right) - 64px);
  overflow: hidden;
  transform: translate(-50%, -50%);
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.4;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.share-state {
  display: flex;
  box-sizing: border-box;
  min-height: calc(100vh - var(--mobile-header-height));
  padding: 60px 24px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  color: var(--text-secondary);
}
.loader-ring {
  width: 34px;
  height: 34px;
  border: 3px solid rgba(217, 119, 87, 0.18);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.state-title {
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 700;
}
.state-message {
  max-width: 480px;
  font-size: 14px;
  line-height: 1.7;
  text-align: center;
}
.primary-command {
  margin-top: 8px;
  padding: 9px 17px;
  border-radius: 6px;
  background: var(--accent-primary);
  color: white;
  font-size: 14px;
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
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media print {
  .share-navigation {
    display: none;
  }
}
</style>
