<template>
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

      <div class="sidebar-share-code">
        <div class="sidebar-share-code__title">{{ t('shareCode.sidebarTitle') }}</div>
        <ShareCodeEntry compact />
      </div>

      <div class="sidebar-section-title">{{ t('sidebar.plans') }}</div>
      <div class="sidebar-list">
        <div v-if="plansLoading" class="sidebar-hint">{{ t('common.loading') }}</div>
        <div v-else-if="plans.length === 0" class="sidebar-hint">{{ t('sidebar.empty') }}</div>
        <div
          v-for="item in plans"
          :key="item.plan_id"
          class="sidebar-item"
          :class="{ active: activePlanId === item.plan_id }"
          role="button"
          tabindex="0"
          @click="openPlan(item.plan_id)"
          @keydown.enter="openPlan(item.plan_id)"
        >
          <span class="sidebar-item-city">{{ item.city }}</span>
          <span class="sidebar-item-date">
            {{ item.start_date }} ~ {{ item.end_date }}
            <span v-if="item.status === 'processing'" class="sidebar-item-badge processing">{{ t('sidebar.processing') }}</span>
            <span v-else-if="item.status === 'failed'" class="sidebar-item-badge failed">{{ t('sidebar.failed') }}</span>
            <span v-else-if="isOngoing(item)" class="sidebar-item-badge ongoing">{{ t('sidebar.ongoing') }}</span>
          </span>
          <a-popconfirm
            :title="t('sidebar.deleteConfirm')"
            :ok-text="t('common.ok')"
            :cancel-text="t('common.cancel')"
            placement="right"
            @confirm="deletePlan(item)"
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
      </div>

      <div class="sidebar-footer">
        <div class="lang-switch" role="group" :aria-label="t('app.language.label')">
          <button
            v-for="opt in localeOptions"
            :key="opt.value"
            type="button"
            class="lang-switch-btn"
            :class="{ active: locale === opt.value }"
            :aria-pressed="locale === opt.value"
            @click="switchLocale(opt.value)"
          >
            {{ t(opt.labelKey) }}
          </button>
        </div>
      </div>

      <div class="sidebar-user">
        <UserBadge />
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
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import dayjs from 'dayjs'
import { setAppLocale, type AppLocale } from '@/i18n'
import { plans, plansLoading, refreshPlans, PLANS_UPDATED_EVENT } from '@/stores/plans'
import { deleteTripPlan, getStoredUser } from '@/services/api'
import UserBadge from '@/components/UserBadge.vue'
import ShareCodeEntry from '@/components/ShareCodeEntry.vue'
import YoubanSplash from '@/splash/YoubanSplash.vue'
import { AUTH_UPDATED_EVENT } from '@/stores/auth'
import type { TripHistoryItem } from '@/types'
import { NEW_PLAN_EVENT } from '@/utils/planConversation.js'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()

const activePlanId = computed(() => (route.name === 'PlanView' ? String(route.params.id || '') : ''))

// 行程期内(已完成且今日落在 start~end 之间)的计划,侧栏标注"进行中"
const isOngoing = (item: TripHistoryItem): boolean => {
  if (item.status !== 'completed' || !item.start_date || !item.end_date) return false
  const today = dayjs().format('YYYY-MM-DD')
  return item.start_date <= today && item.end_date >= today
}

// 语言切换选项（标签始终显示各语言原生名）
const localeOptions = [
  { value: 'zh-CN', labelKey: 'app.language.zh' },
  { value: 'ja-JP', labelKey: 'app.language.ja' },
  { value: 'en-US', labelKey: 'app.language.en' },
] as const

const switchLocale = (value: string) => {
  locale.value = value
}

// 后台页面：独立布局，不显示侧边栏/顶栏
const isAdminRoute = computed(() => route.name === 'Admin')
const isShareRoute = computed(() => route.name === 'Share')

// 登录和公开分享页走无侧栏布局:不暴露当前用户或历史计划
const isBareRoute = computed(() => isAdminRoute.value || isShareRoute.value || route.name === 'Login')

// 移动端抽屉
const mobileMenuOpen = ref(false)

watch(
  locale,
  (nextLocale) => {
    setAppLocale(nextLocale as AppLocale)
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
  if (route.path !== '/') {
    const uid = getStoredUser()?.user_id || 'anonymous'
    localStorage.removeItem(`tripstar.chat_session.${uid}`)
    router.push('/')
  }
}

const openPlan = (planId: string) => {
  if (!planId) return
  mobileMenuOpen.value = false
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.setItem('planId', planId)
  router.push(`/plan/${planId}`)
}

const deletePlan = async (item: TripHistoryItem) => {
  try {
    await deleteTripPlan(item.task_id)
    message.success(t('sidebar.deleted'))
    // 删除的正是当前打开的计划时回到首页,避免停留在一个已不存在的计划页
    if (activePlanId.value === item.plan_id) {
      sessionStorage.removeItem('tripPlan')
      sessionStorage.removeItem('graphData')
      sessionStorage.removeItem('planId')
      router.push('/')
    }
    refreshPlans()
  } catch (error: any) {
    message.error(error?.message || t('sidebar.deleteFailed'))
  }
}

const onPlansUpdated = () => {
  void refreshPlans()
}

const onAuthUpdated = () => {
  void refreshPlans()
}

onMounted(() => {
  void refreshPlans()
  window.addEventListener(PLANS_UPDATED_EVENT, onPlansUpdated)
  window.addEventListener(AUTH_UPDATED_EVENT, onAuthUpdated)
})

onUnmounted(() => {
  window.removeEventListener(PLANS_UPDATED_EVENT, onPlansUpdated)
  window.removeEventListener(AUTH_UPDATED_EVENT, onAuthUpdated)
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
  letter-spacing: 0.08em;
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
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 12px;
  background: rgba(217, 119, 87, 0.08);
  color: #C4603D;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.new-plan-btn:hover {
  background: rgba(217, 119, 87, 0.16);
}

.new-plan-plus {
  font-size: 18px;
  line-height: 1;
}

.sidebar-share-code {
  margin: 0 12px 16px;
  padding: 12px;
  background: #faf7f2;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 8px;
}

.sidebar-share-code__title {
  margin-bottom: 8px;
  color: #3d3229;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.sidebar-section-title {
  padding: 4px 16px 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(61, 50, 41, 0.45);
  letter-spacing: 0.06em;
}

.sidebar-list {
  flex: 1;
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
  cursor: pointer;
  transition: background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
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

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.08);
}

/* 侧栏底部用户区 */
.sidebar-user {
  padding: 0 12px 12px;
}

/* 分段式语言切换 */
.lang-switch {
  flex: 1;
  display: flex;
  gap: 2px;
  padding: 3px;
  background: rgba(61, 50, 41, 0.06);
  border-radius: 10px;
}

.lang-switch-btn {
  flex: 1;
  border: none;
  border-radius: 8px;
  background: transparent;
  padding: 5px 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(61, 50, 41, 0.55);
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.lang-switch-btn:hover {
  color: #3D3229;
}

.lang-switch-btn.active {
  background: #fff;
  color: #3D3229;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(61, 50, 41, 0.12);
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
