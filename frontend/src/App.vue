<template>
  <a-config-provider :theme="antTheme">
  <div class="app-shell">
    <!-- 移动端顶栏 -->
    <header v-if="!isBareRoute" class="mobile-topbar">
      <button
        type="button"
        class="mobile-menu-btn"
        :aria-label="t('sidebar.plans')"
        @click="mobileMenuOpen = true"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <router-link to="/" class="mobile-brand">{{ t('app.brand') }}</router-link>
      <div class="mobile-topbar-right">
        <button type="button" class="mobile-new-btn" :aria-label="t('sidebar.newPlan')" @click="goNewPlan">＋</button>
        <UserBadge />
      </div>
    </header>

    <!-- 移动端抽屉遮罩 -->
    <Transition name="mask-fade">
      <div v-if="!isBareRoute && mobileMenuOpen" class="mobile-mask" @click="mobileMenuOpen = false"></div>
    </Transition>

    <aside v-if="!isBareRoute" class="sidebar" :class="{ open: mobileMenuOpen }">
      <div class="sidebar-header">
        <router-link to="/" class="sidebar-brand">{{ t('app.brand') }}</router-link>
      </div>

      <div class="sidebar-new">
        <button type="button" class="new-plan-btn" @click="goNewPlan">
          <span class="new-plan-plus">+</span>
          <span>{{ t('sidebar.newPlan') }}</span>
        </button>
      </div>

      <ActiveTripTaskButton
        v-if="activeTripTask"
        :task="activeTripTask"
        @activate="returnToActiveTask"
      />

      <div class="sidebar-list">
        <section class="sidebar-section" :aria-label="t('sidebar.conversations')">
          <div class="sidebar-section-title">{{ t('sidebar.conversations') }}</div>
          <div v-if="recordsLoading" class="sidebar-hint">{{ t('common.loading') }}</div>
          <div v-else-if="conversationRecords.length === 0" class="sidebar-hint">{{ t('sidebar.emptyConversations') }}</div>
          <div
            v-for="item in conversationRecords"
            :key="item.record_id"
            class="sidebar-item"
            :class="{ active: isConversationRecordActive(item, activeConversationId) }"
          >
            <button
              type="button"
              class="sidebar-item-main"
              :aria-current="isConversationRecordActive(item, activeConversationId) ? 'page' : undefined"
              @click="openConversation(item.session_id)"
            >
              <span class="sidebar-item-city">{{ item.title }}</span>
              <span v-if="isGeneratingRecord(item)" class="sidebar-item-date">
                <span class="sidebar-item-badge processing">{{ t('sidebar.processing') }}</span>
              </span>
            </button>
            <button
              v-if="shouldShowConversationResume(item)"
              type="button"
              class="sidebar-item-resume"
              @click.stop="openConversation(item.session_id)"
              @keydown.enter.stop
            >
              <PlayCircleOutlined aria-hidden="true" />
              <span>{{ t('sidebar.returnToGeneration') }}</span>
            </button>
            <a-popconfirm
              :title="t('sidebar.deleteConfirm')"
              :ok-text="t('common.ok')"
              :cancel-text="t('common.cancel')"
              placement="right"
              @confirm="deleteRecord(item)"
            >
              <button
                type="button"
                class="sidebar-item-delete"
                :aria-label="t('sidebar.delete')"
                @click.stop
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </a-popconfirm>
          </div>
        </section>

        <section class="sidebar-section" :aria-label="t('sidebar.plans')">
          <div class="sidebar-section-title">{{ t('sidebar.plans') }}</div>
          <div v-if="recordsLoading" class="sidebar-hint">{{ t('common.loading') }}</div>
          <div v-else-if="plannedRecords.length === 0" class="sidebar-hint">{{ t('sidebar.empty') }}</div>
          <div
            v-for="item in plannedRecords"
            :key="item.record_id"
            class="sidebar-item"
            :class="{ active: isPlanRecordActive(item, activePlanId) }"
          >
            <button
              type="button"
              class="sidebar-item-main"
              :aria-current="isPlanRecordActive(item, activePlanId) ? 'page' : undefined"
              @click="openPlan(item.plan_id)"
            >
              <span class="sidebar-item-city">{{ item.city || item.title }}</span>
              <span class="sidebar-item-date">
                {{ item.start_date }} ~ {{ item.end_date }}
                <span v-if="isGeneratingRecord(item)" class="sidebar-item-badge processing">{{ t('sidebar.processing') }}</span>
                <span v-else-if="item.status === 'failed'" class="sidebar-item-badge failed">{{ t('sidebar.failed') }}</span>
                <span v-else-if="isOngoing(item)" class="sidebar-item-badge ongoing">{{ t('sidebar.ongoing') }}</span>
              </span>
            </button>
            <button
              v-if="isGeneratingRecord(item) && item.plan_id"
              type="button"
              class="sidebar-item-resume"
              :disabled="resumingPlanId === item.plan_id"
              :aria-busy="resumingPlanId === item.plan_id"
              @click.stop="resumePlan(item.plan_id)"
              @keydown.enter.stop
            >
              <LoadingOutlined v-if="resumingPlanId === item.plan_id" aria-hidden="true" />
              <PlayCircleOutlined v-else aria-hidden="true" />
              <span>{{ resumingPlanId === item.plan_id ? t('sidebar.resuming') : t('sidebar.resumeGeneration') }}</span>
            </button>
            <a-popconfirm
              :title="t('sidebar.deleteConfirm')"
              :ok-text="t('common.ok')"
              :cancel-text="t('common.cancel')"
              placement="right"
              @confirm="deleteRecord(item)"
            >
              <button
                type="button"
                class="sidebar-item-delete"
                :aria-label="t('sidebar.delete')"
                @click.stop
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </a-popconfirm>
          </div>
        </section>
      </div>

      <div class="sidebar-tools">
        <SidebarShareCodeTool />

        <section class="sidebar-preferences" :aria-label="t('app.preferences.label')">
          <div class="sidebar-preferences__title">{{ t('app.preferences.label') }}</div>

          <div class="preference-group">
            <span class="preference-group__label">{{ t('app.language.label') }}</span>
            <div class="preference-segment" role="group" :aria-label="t('app.language.label')">
              <button
                v-for="option in VISIBLE_LOCALE_OPTIONS"
                :key="option.value"
                type="button"
                class="preference-option"
                :class="{ active: locale === option.value }"
                :aria-pressed="locale === option.value"
                @click="switchLocale(option.value)"
              >
                {{ t(option.labelKey) }}
              </button>
            </div>
          </div>

          <div class="preference-group">
            <span class="preference-group__label">{{ t('app.skin.label') }}</span>
            <div class="preference-segment" role="group" :aria-label="t('app.skin.label')">
              <button
                v-for="option in VISIBLE_SKIN_OPTIONS"
                :key="option.value"
                type="button"
                class="preference-option"
                :class="{ active: skin === option.value }"
                :aria-pressed="skin === option.value"
                @click="applySkin(option.value)"
              >
                <span
                  class="preference-swatch"
                  :class="`preference-swatch--${option.swatch}`"
                  aria-hidden="true"
                ></span>
                {{ t(option.labelKey) }}
              </button>
            </div>
          </div>
        </section>

        <div class="sidebar-user">
          <UserBadge />
        </div>
      </div>
    </aside>

    <main class="main-area">
      <router-view v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </main>

    <YoubanSplash />
  </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { LoadingOutlined, PlayCircleOutlined } from '@ant-design/icons-vue'
import dayjs from 'dayjs'
import { setAppLocale, type AppLocale } from '@/i18n'
import { normalizeLocale } from '@/i18n/locale'
import {
  CONVERSATION_RECORDS_UPDATED_EVENT,
  conversationRecords,
  invalidateAllConversationTitlePolling,
  isConversationRecordActive,
  isGeneratingRecord,
  isPlanRecordActive,
  plannedRecords,
  recordsLoading,
  refreshRecords,
  removeRecord,
  shouldShowConversationResume,
} from '@/stores/conversation-records'
import { PLANS_UPDATED_EVENT } from '@/stores/plans'
import { deleteConversation, deleteTripPlan, getStoredUser } from '@/services/api'
import UserBadge from '@/components/UserBadge.vue'
import ActiveTripTaskButton from '@/components/ActiveTripTaskButton.vue'
import SidebarShareCodeTool from '@/components/SidebarShareCodeTool.vue'
import YoubanSplash from '@/splash/YoubanSplash.vue'
import { AUTH_UPDATED_EVENT } from '@/stores/auth'
import { ACTIVE_TRIP_TASK_UPDATED_EVENT, readActiveTripTask } from '@/stores/activeTripTask'
import { applySkin, skin } from '@/stores/skin'
import { VISIBLE_LOCALE_OPTIONS, VISIBLE_SKIN_OPTIONS } from '@/stores/preference-options'
import type { ActiveTripTaskRecord } from '@/stores/activeTripTask'
import type { ConversationRecord } from '@/types'
import { NEW_PLAN_EVENT } from '@/utils/planConversation.js'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()

const activePlanId = computed(() => (route.name === 'PlanView' ? String(route.params.id || '') : ''))
const activeConversationId = computed(() => (
  route.name === 'ChatHome' ? String(route.query.conversation || '') : ''
))

// 行程期内(已完成且今日落在 start~end 之间)的计划,侧栏标注"进行中"
const isOngoing = (item: ConversationRecord): boolean => {
  if (item.status !== 'completed' || !item.start_date || !item.end_date) return false
  const today = dayjs().format('YYYY-MM-DD')
  return item.start_date <= today && item.end_date >= today
}

const antTheme = computed(() => ({
  token: {
    colorPrimary: skin.value === 'google' ? '#3b9bb4' : '#d97757',
    colorSuccess: skin.value === 'google' ? '#2d8c72' : '#3a9c7a',
    colorError: skin.value === 'google' ? '#c85c5c' : '#c2413a',
    colorText: skin.value === 'google' ? '#22313a' : '#3d3229',
    colorBgLayout: skin.value === 'google' ? '#f5f9fc' : '#faf7f2',
    borderRadius: skin.value === 'google' ? 12 : 8,
  },
}))

const switchLocale = (value: AppLocale) => {
  locale.value = value
}

// 后台页面：独立布局，不显示侧边栏/顶栏
const isAdminRoute = computed(() => route.name === 'Admin')
const isShareRoute = computed(() => route.name === 'Share')

// 登录和公开分享页走无侧栏布局:不暴露当前用户或历史计划
const isBareRoute = computed(() => isAdminRoute.value || isShareRoute.value || route.name === 'Login')

// 移动端抽屉
const mobileMenuOpen = ref(false)
const resumingPlanId = ref('')
const activeTripTask = ref<ActiveTripTaskRecord | null>(null)

watch(
  locale,
  (nextLocale) => {
    setAppLocale(normalizeLocale(nextLocale))
    document.title = t('app.title')
  },
  { immediate: true }
)

const clearPlanResultSession = () => {
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.removeItem('planId')
}

const goNewPlan = () => {
  mobileMenuOpen.value = false
  clearPlanResultSession()
  window.dispatchEvent(new CustomEvent(NEW_PLAN_EVENT))
  if (route.path !== '/' || activeConversationId.value) {
    router.push('/')
  }
}

const openConversation = async (sessionId: string | null): Promise<void> => {
  if (!sessionId) return
  mobileMenuOpen.value = false
  clearPlanResultSession()
  await router.push({ path: '/', query: { conversation: sessionId } })
}

const openPlan = async (planId: string | null): Promise<void> => {
  if (!planId) return
  mobileMenuOpen.value = false
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.setItem('planId', planId)
  await router.push(`/plan/${planId}`)
}

const syncActiveTripTask = (): void => {
  const ownerId = getStoredUser()?.user_id || 'anonymous'
  activeTripTask.value = readActiveTripTask(ownerId)
}

const returnToActiveTask = async (): Promise<void> => {
  mobileMenuOpen.value = false
  clearPlanResultSession()
  const sessionId = activeTripTask.value?.sessionId?.trim()
  await router.push(sessionId ? { path: '/', query: { conversation: sessionId } } : '/')
}

const resumePlan = async (planId: string): Promise<void> => {
  if (!planId || resumingPlanId.value) return
  resumingPlanId.value = planId
  try {
    await openPlan(planId)
  } finally {
    resumingPlanId.value = ''
  }
}

const deleteRecord = async (item: ConversationRecord) => {
  try {
    if (item.session_id) {
      await deleteConversation(item.session_id)
    }
    else if (item.task_id) await deleteTripPlan(item.task_id)
    else return
    removeRecord(item.record_id)
    message.success(t('sidebar.deleted'))
    if (
      isConversationRecordActive(item, activeConversationId.value)
      || isPlanRecordActive(item, activePlanId.value)
    ) {
      clearPlanResultSession()
      await router.push('/')
    }
    void refreshRecords()
  } catch (error: any) {
    message.error(error?.message || t('sidebar.deleteFailed'))
  }
}

const onRecordsUpdated = () => {
  syncActiveTripTask()
  void refreshRecords()
}

const onAuthUpdated = () => {
  invalidateAllConversationTitlePolling()
  syncActiveTripTask()
  void refreshRecords()
}

onMounted(() => {
  syncActiveTripTask()
  void refreshRecords()
  window.addEventListener(CONVERSATION_RECORDS_UPDATED_EVENT, onRecordsUpdated)
  window.addEventListener(PLANS_UPDATED_EVENT, onRecordsUpdated)
  window.addEventListener(AUTH_UPDATED_EVENT, onAuthUpdated)
  window.addEventListener(ACTIVE_TRIP_TASK_UPDATED_EVENT, syncActiveTripTask)
})

onUnmounted(() => {
  window.removeEventListener(CONVERSATION_RECORDS_UPDATED_EVENT, onRecordsUpdated)
  window.removeEventListener(PLANS_UPDATED_EVENT, onRecordsUpdated)
  window.removeEventListener(AUTH_UPDATED_EVENT, onAuthUpdated)
  window.removeEventListener(ACTIVE_TRIP_TASK_UPDATED_EVENT, syncActiveTripTask)
})
</script>

<style>
* {
  box-sizing: border-box;
}

.app-shell {
  --desktop-sidebar-width: 260px;

  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Noto Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  display: flex;
  height: 100vh;
  height: 100dvh;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
}

.app-shell > :deep(.ant-app),
.app-shell + * {
  min-height: 0;
}

/* ─── 固定左侧栏（Codex 式会话列表） ─── */
.sidebar {
  width: var(--desktop-sidebar-width);
  flex-shrink: 0;
  height: 100%;
  position: sticky;
  top: 0;
  background: #fff;
  border-right: 1px solid rgba(61, 50, 41, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.sidebar-header {
  padding: 18px 16px 10px;
}

.sidebar-brand {
  color: #3D3229;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0;
  text-decoration: none;
}

.sidebar-new {
  padding: 4px 12px 12px;
}

.new-plan-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--accent-focus);
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.new-plan-btn:hover {
  background: var(--accent-focus);
}

.new-plan-plus {
  font-size: 18px;
  line-height: 1;
}

.sidebar-section-title {
  padding: 4px 16px 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(61, 50, 41, 0.45);
  letter-spacing: 0;
}

.sidebar-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-hint {
  color: rgba(61, 50, 41, 0.5);
  font-size: 13px;
  padding: 12px 8px;
}

.sidebar-item {
  width: 100%;
  border: none;
  border-radius: 10px;
  background: transparent;
  padding: 10px 12px;
  text-align: left;
  transition: background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
}

.sidebar-item-main {
  width: 100%;
  padding: 0 28px 0 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  cursor: pointer;
}

.sidebar-item-main:focus-visible {
  outline: 2px solid #D97757;
  outline-offset: 4px;
}

.sidebar-item-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #A89888;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.sidebar-item:hover .sidebar-item-delete,
.sidebar-item-delete:focus-visible {
  opacity: 1;
}

.sidebar-item-delete:hover {
  background: rgba(200, 60, 50, 0.1);
  color: #C43C32;
}

.sidebar-item:hover {
  background: rgba(217, 119, 87, 0.08);
}

.sidebar-item.active {
  background: rgba(217, 119, 87, 0.14);
}

.sidebar-item-city {
  color: #3D3229;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item-date {
  color: rgba(61, 50, 41, 0.5);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item-resume {
  width: 100%;
  min-height: 44px;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 8px;
  background: rgba(217, 119, 87, 0.08);
  color: #C4603D;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.sidebar-item-resume:hover:not(:disabled) {
  background: rgba(217, 119, 87, 0.16);
  border-color: rgba(217, 119, 87, 0.55);
}

.sidebar-item-resume:focus-visible {
  outline: 2px solid #D97757;
  outline-offset: 2px;
}

.sidebar-item-resume:disabled {
  cursor: wait;
  opacity: 0.65;
}

.sidebar-item-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 1.5;
}

.sidebar-item-badge.processing {
  color: #d46b08;
  background: rgba(255, 165, 0, 0.15);
}

.sidebar-item-badge.failed {
  color: rgba(61, 50, 41, 0.55);
  background: rgba(61, 50, 41, 0.1);
}

.sidebar-item-badge.ongoing { color: #a8752a; background: rgba(216, 169, 78, 0.18); }

.sidebar-tools {
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-elevated);
}

.sidebar-preferences {
  padding: 12px;
  border-top: 1px solid var(--border-subtle);
}

.sidebar-preferences__title {
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0;
}

.preference-group + .preference-group {
  margin-top: 10px;
}

.preference-group__label {
  display: block;
  margin: 0 0 5px 2px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.preference-segment {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-soft);
}

.preference-option {
  min-width: 0;
  min-height: 44px;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.preference-option:hover {
  color: var(--text-primary);
}

.preference-option.active {
  background: var(--surface-elevated);
  color: var(--accent-strong);
  box-shadow: 0 1px 3px rgba(32, 33, 36, 0.16);
}

.preference-swatch {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
}

.preference-swatch--warm {
  background: linear-gradient(135deg, #faf7f2 0 48%, #d97757 52% 100%);
}

.preference-swatch--clear {
  background: linear-gradient(135deg, #f5f9fc 0 48%, #3b9bb4 52% 100%);
}

/* 侧栏底部用户区 */
.sidebar-user {
  padding: 0 12px 12px;
}

/* ─── 主内容区 ─── */
.main-area {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: #f9f9f9;
  display: flex;
  flex-direction: column;
}

/* 路由页面切换：轻量淡入上移，出场仅淡出避免布局抖动 */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

/* A transformed route becomes the containing block for its fixed chat dock. */
.main-area > .page-enter-active .agent-dock,
.main-area > .page-leave-active .agent-dock {
  left: 50%;
}

.page-leave-to {
  opacity: 0;
}

/* 移动端抽屉遮罩淡入淡出 */
.mask-fade-enter-active,
.mask-fade-leave-active {
  transition: opacity 0.25s ease;
}

.mask-fade-enter-from,
.mask-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active,
  .mask-fade-enter-active,
  .mask-fade-leave-active {
    transition: none;
  }
}

/* ─── 移动端顶栏(桌面隐藏) ─── */
.mobile-topbar {
  display: none;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 12px;
  background: #fff;
  border-bottom: 1px solid rgba(61, 50, 41, 0.1);
  position: sticky;
  top: 0;
  z-index: 90;
  flex-shrink: 0;
}

.mobile-brand {
  color: #3D3229;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-decoration: none;
}

.mobile-menu-btn,
.mobile-new-btn {
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #6B5D52;
  font-size: 22px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.mobile-new-btn {
  color: #C4603D;
  font-weight: 700;
}

.mobile-topbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 移动端顶栏里的用户徽标:限宽,避免昵称把顶栏撑开 */
.mobile-topbar-right .user-badge {
  width: auto;
  max-width: 140px;
}

.mobile-mask {
  position: fixed;
  inset: 0;
  background: rgba(61, 50, 41, 0.35);
  z-index: 99;
}

@media (max-width: 768px) {
  .app-shell {
    flex-direction: column;
    height: 100dvh;
    min-height: 100dvh;
  }

  .mobile-topbar {
    display: flex;
  }

  /* 侧边栏变左侧抽屉 */
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    height: 100dvh;
    width: 280px;
    max-width: 82vw;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 24px rgba(61, 50, 41, 0.15);
    border-right: none;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .main-area {
    flex: 1;
    min-height: 0;
  }
}
</style>
