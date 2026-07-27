<template>
  <div class="admin-page">
    <!-- 未登录：密码登录卡片 -->
    <div v-if="!loggedIn" class="admin-login-wrap">
      <div class="admin-card admin-login-card">
        <div class="admin-brand">{{ t('app.brand') }}</div>
        <h1 class="admin-title">{{ t('admin.loginTitle') }}</h1>
        <a-form layout="vertical" @submit.prevent>
          <a-form-item :label="t('admin.passwordLabel')">
            <a-input-password
              v-model:value="password"
              :placeholder="t('admin.passwordPlaceholder')"
              size="large"
              @pressEnter="doLogin"
            />
          </a-form-item>
          <a-button
            type="primary"
            size="large"
            block
            :loading="loggingIn"
            @click="doLogin"
          >
            {{ t('admin.login') }}
          </a-button>
        </a-form>
        <router-link to="/" class="admin-back-link">{{ t('admin.backHome') }}</router-link>
      </div>
    </div>

    <!-- 已登录：配置表单 -->
    <div v-else class="admin-main">
      <header class="admin-header">
        <div class="admin-header-left">
          <span class="admin-brand">{{ t('app.brand') }}</span>
          <span class="admin-header-divider">/</span>
          <span class="admin-header-title">{{ t('admin.title') }}</span>
        </div>
        <div class="admin-header-actions">
          <router-link to="/" class="admin-back-link">{{ t('admin.backHome') }}</router-link>
          <a-button size="small" @click="doLogout">{{ t('admin.logout') }}</a-button>
        </div>
      </header>

      <div class="admin-card admin-config-card">
        <h2 class="admin-section-title">{{ t('admin.configTitle') }}</h2>
        <a-spin :spinning="settingsLoading">
          <a-form layout="vertical">
            <a-form-item :label="t('settings.labels.apiBaseUrl')">
              <a-input v-model:value="settingsForm.api_base_url" :placeholder="t('settings.placeholders.apiBaseUrl')" allow-clear />
            </a-form-item>
            <a-form-item :label="t('settings.labels.amapJsKey')">
              <a-input-password v-model:value="settingsForm.vite_amap_web_js_key" allow-clear />
            </a-form-item>
            <a-form-item :label="t('settings.labels.amapWebKey')">
              <a-input-password v-model:value="settingsForm.vite_amap_web_key" allow-clear />
            </a-form-item>
            <a-form-item :label="t('settings.labels.openaiBaseUrl')">
              <a-input v-model:value="settingsForm.openai_base_url" :placeholder="t('settings.placeholders.openaiBaseUrl')" allow-clear />
            </a-form-item>
            <a-form-item :label="t('settings.labels.openaiModel')">
              <a-input v-model:value="settingsForm.openai_model" :placeholder="t('settings.placeholders.openaiModel')" allow-clear />
            </a-form-item>
            <a-form-item :label="t('settings.labels.openaiApiKey')">
              <a-input-password v-model:value="settingsForm.openai_api_key" allow-clear />
            </a-form-item>
          </a-form>
        </a-spin>
        <div class="admin-config-actions">
          <a-button type="primary" :loading="settingsSaving" @click="saveNow">
            {{ t('settings.saveApply') }}
          </a-button>
        </div>
      </div>

      <div class="admin-card admin-trips-card">
        <div class="admin-trips-head">
          <h2 class="admin-section-title">{{ t('admin.trips.title') }}</h2>
          <div class="admin-trips-toolbar">
            <a-input
              v-model:value="tripsSearch"
              class="admin-trips-search"
              :placeholder="t('admin.trips.searchPlaceholder')"
              allow-clear
            >
              <template #prefix><span class="admin-trips-search-icon">⌕</span></template>
            </a-input>
            <a-select v-model:value="tripsStatusFilter" class="admin-trips-status-filter" size="middle">
              <a-select-option value="all">{{ t('admin.trips.statusAll') }}</a-select-option>
              <a-select-option value="completed">{{ t('admin.trips.statusDone') }}</a-select-option>
              <a-select-option value="processing">{{ t('admin.trips.statusProcessing') }}</a-select-option>
              <a-select-option value="failed">{{ t('admin.trips.statusFailed') }}</a-select-option>
            </a-select>
            <a-button :loading="tripsLoading" @click="loadTrips">
              {{ t('admin.trips.refresh') }}
            </a-button>
          </div>
        </div>

        <a-spin :spinning="tripsLoading">
          <div class="trips-layout">
            <!-- 左栏:用户导航,点人即筛 -->
            <aside class="trips-users">
              <button
                type="button"
                class="trips-user-item"
                :class="{ active: selectedUserKey === 'all' }"
                @click="selectedUserKey = 'all'"
              >
                <span class="trips-user-avatar all">✦</span>
                <span class="trips-user-label">{{ t('admin.trips.allUsers') }}</span>
                <span class="trips-user-count">{{ trips.length }}</span>
              </button>
              <button
                v-for="group in userGroups"
                :key="group.key"
                type="button"
                class="trips-user-item"
                :class="{ active: selectedUserKey === group.key }"
                @click="selectedUserKey = group.key"
              >
                <span class="trips-user-avatar" :class="{ anonymous: group.key === 'anonymous' }">
                  {{ group.initial }}
                </span>
                <span class="trips-user-label">{{ group.label }}</span>
                <span class="trips-user-count">{{ group.count }}</span>
              </button>
            </aside>

            <!-- 右栏:计划卡片流,点卡展开 -->
            <div class="trips-list">
              <template v-if="filteredTrips.length">
                <div
                  v-for="item in filteredTrips"
                  :key="item.task_id"
                  class="trip-card"
                  role="button"
                  tabindex="0"
                  @click="openDetail(item)"
                  @keydown.enter="openDetail(item)"
                >
                  <div class="trip-card-main">
                    <div class="trip-card-info">
                      <div class="trip-card-city">{{ item.city }}</div>
                      <div class="trip-card-meta">
                        <span>{{ formatTripDates(item) }} · {{ t('common.dayCount', { count: item.travel_days }) }}</span>
                        <span class="trip-card-owner">
                          <span class="trip-card-owner-avatar" :class="{ anonymous: !item.nickname }">
                            {{ (item.nickname || '?').trim().charAt(0).toUpperCase() }}
                          </span>
                          {{ item.nickname || t('admin.trips.anonymous') }}
                        </span>
                      </div>
                    </div>
                    <div class="trip-card-side">
                      <span class="trip-status" :class="item.status || 'processing'">{{ statusText(item.status) }}</span>
                      <span class="trip-updated">{{ formatUpdated(item.updated_at) }}</span>
                    </div>
                  </div>
                  <div class="trip-card-actions" @click.stop>
                    <button type="button" class="trip-action-btn view" @click="openDetail(item)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      {{ t('admin.trips.viewDetail') }}
                    </button>
                    <a-popconfirm
                      :title="t('admin.trips.deleteConfirm')"
                      :ok-text="t('common.ok')"
                      :cancel-text="t('common.cancel')"
                      ok-type="danger"
                      placement="topRight"
                      @confirm="removeTrip(item)"
                    >
                      <button
                        type="button"
                        class="trip-action-btn delete"
                        :disabled="item.status === 'processing' || deletingId === item.task_id"
                        @click.stop
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        {{ t('admin.trips.delete') }}
                      </button>
                    </a-popconfirm>
                  </div>
                </div>
              </template>
              <div v-else class="trips-empty">{{ t('admin.trips.empty') }}</div>
            </div>
          </div>
        </a-spin>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import {
  adminDeleteTrip,
  adminGetAllTrips,
  adminLogin,
  clearAdminToken,
  getAdminRuntimeSettings,
  hasAdminSession,
  isAdminAuthError,
  saveAdminRuntimeSettings,
} from '@/services/api'
import type { AdminTripItem, RuntimeSettings } from '@/types'

const { t } = useI18n()
const router = useRouter()

const loggedIn = ref(false)
const password = ref('')
const loggingIn = ref(false)

const settingsLoading = ref(false)
const settingsSaving = ref(false)
const settingsForm = reactive<RuntimeSettings>({
  api_base_url: '',
  vite_amap_web_key: '',
  vite_amap_web_js_key: '',
  google_maps_api_key: '',
  google_maps_proxy: '',
  xhs_cookie: '',
  openai_api_key: '',
  openai_base_url: '',
  openai_model: '',
})

const trips = ref<AdminTripItem[]>([])
const tripsLoading = ref(false)
const tripsSearch = ref('')
const tripsStatusFilter = ref<'all' | 'completed' | 'processing' | 'failed'>('all')
const selectedUserKey = ref<string>('all')
const deletingId = ref('')

/** 点击计划卡片:跳转完整详情页(与侧边栏打开逻辑一致,先清掉上一个计划的缓存) */
const openDetail = (item: AdminTripItem) => {
  const planId = item.plan_id || item.task_id
  if (!planId) return
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.setItem('planId', planId)
  router.push(`/plan/${planId}`)
}

/** 后台删除某个用户的计划(带后台密码校验,进行中的计划后端会拒绝) */
const removeTrip = async (item: AdminTripItem) => {
  if (deletingId.value) return
  deletingId.value = item.task_id
  try {
    await adminDeleteTrip(item.task_id)
    trips.value = trips.value.filter((tp) => tp.task_id !== item.task_id)
    // 删除后该用户可能已无任何计划,左栏会消失,当前若正筛选它则回到「全部」
    if (
      selectedUserKey.value !== 'all' &&
      !trips.value.some((tp) => (tp.user_id || 'anonymous') === selectedUserKey.value)
    ) {
      selectedUserKey.value = 'all'
    }
    message.success(t('admin.trips.deleted'))
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      message.warning(t('admin.sessionExpired'))
      backToLogin()
      return
    }
    message.error(error?.message || t('admin.trips.deleteFailed'))
  } finally {
    deletingId.value = ''
  }
}

const statusText = (status?: string) => {
  if (status === 'completed') return t('admin.trips.statusDone')
  if (status === 'failed') return t('admin.trips.statusFailed')
  return t('admin.trips.statusProcessing')
}

/** 同年时结束日期省略年份:2026-07-27 ~ 08-02 */
const formatTripDates = (record: AdminTripItem) => {
  const start = record.start_date || ''
  const end = record.end_date || ''
  if (start.slice(0, 4) === end.slice(0, 4) && end.length >= 10) {
    return `${start} ~ ${end.slice(5)}`
  }
  return `${start} ~ ${end}`
}

const formatUpdated = (iso?: string) => (iso || '').replace('T', ' ').slice(0, 16)

interface TripUserGroup {
  key: string
  label: string
  initial: string
  count: number
}

/** 左栏用户导航:按计划数降序,未登录归为一组排最后 */
const userGroups = computed<TripUserGroup[]>(() => {
  const groups = new Map<string, TripUserGroup>()
  for (const item of trips.value) {
    const key = item.user_id || 'anonymous'
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    const label = item.nickname || t('admin.trips.anonymous')
    groups.set(key, {
      key,
      label,
      initial: key === 'anonymous' ? '?' : label.trim().charAt(0).toUpperCase(),
      count: 1,
    })
  }
  return [...groups.values()].sort((a, b) => {
    if ((a.key === 'anonymous') !== (b.key === 'anonymous')) {
      return a.key === 'anonymous' ? 1 : -1
    }
    return b.count - a.count
  })
})

const filteredTrips = computed(() => {
  const keyword = tripsSearch.value.trim().toLowerCase()
  return trips.value.filter((item) => {
    if (selectedUserKey.value !== 'all' && (item.user_id || 'anonymous') !== selectedUserKey.value) {
      return false
    }
    if (tripsStatusFilter.value !== 'all' && (item.status || 'processing') !== tripsStatusFilter.value) {
      return false
    }
    if (!keyword) return true
    const nickname = (item.nickname || t('admin.trips.anonymous')).toLowerCase()
    const city = (item.city || '').toLowerCase()
    return nickname.includes(keyword) || city.includes(keyword)
  })
})

const loadTrips = async () => {
  tripsLoading.value = true
  try {
    trips.value = await adminGetAllTrips()
    // 数据刷新后,若之前选中的用户已不存在则回到「全部」
    if (
      selectedUserKey.value !== 'all' &&
      !trips.value.some((item) => (item.user_id || 'anonymous') === selectedUserKey.value)
    ) {
      selectedUserKey.value = 'all'
    }
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      message.warning(t('admin.sessionExpired'))
      backToLogin()
      return
    }
    message.error(error?.message || t('admin.trips.loadFailed'))
  } finally {
    tripsLoading.value = false
  }
}

const backToLogin = () => {
  clearAdminToken()
  loggedIn.value = false
  password.value = ''
}

const loadSettings = async () => {
  settingsLoading.value = true
  try {
    const settings = await getAdminRuntimeSettings()
    Object.assign(settingsForm, settings)
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      message.warning(t('admin.sessionExpired'))
      backToLogin()
      return
    }
    message.error(error?.message || t('settings.messages.loadFailed'))
  } finally {
    settingsLoading.value = false
  }
}

const doLogin = async () => {
  if (loggingIn.value) return
  loggingIn.value = true
  try {
    await adminLogin(password.value)
    loggedIn.value = true
    password.value = ''
    await loadSettings()
    void loadTrips()
  } catch (error: any) {
    message.error(isAdminAuthError(error) ? t('admin.wrongPassword') : error?.message || t('admin.loginFailed'))
  } finally {
    loggingIn.value = false
  }
}

const doLogout = () => {
  backToLogin()
}

const saveNow = async () => {
  settingsSaving.value = true
  try {
    const saved = await saveAdminRuntimeSettings({ ...settingsForm })
    Object.assign(settingsForm, saved)
    message.success(t('settings.messages.saved'))
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      message.warning(t('admin.sessionExpired'))
      backToLogin()
      return
    }
    message.error(error?.message || t('settings.messages.saveFailed'))
  } finally {
    settingsSaving.value = false
  }
}

onMounted(() => {
  // 会话内已登录（sessionStorage 中有密码）则直接进入配置页，后端仍会逐请求校验文件密码
  if (hasAdminSession()) {
    loggedIn.value = true
    void loadSettings()
    void loadTrips()
  }
})
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  background: #faf9f5;
  color: #3D3229;
}

.admin-card {
  background: #fff;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(61, 50, 41, 0.06);
}

/* ─── 登录态 ─── */
.admin-login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.admin-login-card {
  width: 100%;
  max-width: 380px;
  padding: 32px 28px 24px;
  text-align: center;
}

.admin-brand {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #C4603D;
}

.admin-title {
  margin: 10px 0 22px;
  font-size: 22px;
  font-weight: 700;
  color: #3D3229;
}

.admin-login-card :deep(.ant-form-item-label > label) {
  color: rgba(61, 50, 41, 0.75);
}

.admin-back-link {
  display: inline-block;
  margin-top: 16px;
  font-size: 13px;
  color: rgba(61, 50, 41, 0.55);
  text-decoration: none;
}

.admin-back-link:hover {
  color: #C4603D;
}

/* ─── 配置态 ─── */
.admin-main {
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px 20px 48px;
}
.admin-config-card :deep(.ant-form) {
  max-width: 680px;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 16px;
}

.admin-header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.admin-header-divider {
  color: rgba(61, 50, 41, 0.3);
}

.admin-header-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(61, 50, 41, 0.75);
}

.admin-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.admin-header-actions .admin-back-link {
  margin-top: 0;
}

.admin-config-card {
  padding: 24px 28px 20px;
}

.admin-section-title {
  margin: 0 0 18px;
  font-size: 17px;
  font-weight: 700;
  color: #3D3229;
}

.admin-config-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

@media (max-width: 768px) {
  .admin-config-card {
    padding: 18px 16px 16px;
  }
}
.admin-trips-card {
  margin-top: 20px;
  padding: 28px 32px 32px;
}
.admin-trips-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.admin-trips-head .admin-section-title {
  margin: 0;
}
.admin-trips-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.admin-trips-search {
  width: 240px;
  border-radius: 10px;
}
.admin-trips-search-icon {
  color: #a39c93;
  font-size: 15px;
}
.admin-trips-status-filter {
  width: 116px;
}

/* ===== 左右分栏 ===== */
.trips-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

/* 左栏:用户导航 */
.trips-users {
  width: 224px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: #faf9f5;
  border: 1px solid rgba(61, 50, 41, 0.06);
  border-radius: 14px;
  max-height: 560px;
  overflow-y: auto;
}
.trips-user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.trips-user-item:hover {
  background: rgba(61, 50, 41, 0.05);
}
.trips-user-item.active {
  background: #fff;
  box-shadow: 0 2px 10px rgba(61, 50, 41, 0.08);
}
.trips-user-item.active .trips-user-label {
  color: #c4603d;
  font-weight: 600;
}
.trips-user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #d97757, #c4603d);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}
.trips-user-avatar.all {
  background: #3d3229;
  font-size: 14px;
}
.trips-user-avatar.anonymous {
  background: #ece7df;
  color: #a39c93;
}
.trips-user-label {
  flex: 1;
  font-size: 13px;
  color: #3d3229;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trips-user-count {
  font-size: 12px;
  color: #a39c93;
  background: rgba(61, 50, 41, 0.06);
  border-radius: 999px;
  padding: 1px 8px;
  flex-shrink: 0;
}

/* 右栏:计划卡片流 */
.trips-list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.trip-card {
  border: 1px solid rgba(61, 50, 41, 0.09);
  border-radius: 14px;
  padding: 16px 20px;
  background: #fff;
  cursor: pointer;
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
.trip-card:hover {
  border-color: rgba(217, 119, 87, 0.45);
  box-shadow: 0 6px 20px rgba(61, 50, 41, 0.08);
  transform: translateY(-1px);
}
.trip-card-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.trip-card-info {
  min-width: 0;
}
.trip-card-city {
  font-size: 16px;
  font-weight: 700;
  color: #3d3229;
  line-height: 1.45;
}
.trip-card-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 13px;
  color: #8a8178;
}
.trip-card-owner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #6e655d;
}
.trip-card-owner-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #d97757, #c4603d);
  color: #fff;
  font-weight: 700;
  font-size: 11px;
}
.trip-card-owner-avatar.anonymous {
  background: #ece7df;
  color: #a39c93;
}
.trip-card-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.trip-status {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.trip-status.completed {
  background: rgba(82, 160, 106, 0.12);
  color: #3e7d54;
}
.trip-status.processing {
  background: rgba(217, 119, 87, 0.14);
  color: #c4603d;
}
.trip-status.failed {
  background: rgba(196, 74, 54, 0.10);
  color: #b0432f;
}
.trip-updated {
  color: #a39c93;
  font-size: 12px;
  white-space: nowrap;
}
.trip-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.07);
}
.trip-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.trip-action-btn svg {
  width: 14px;
  height: 14px;
}
.trip-action-btn.view {
  color: #c4603d;
  border-color: rgba(217, 119, 87, 0.3);
}
.trip-action-btn.view:hover {
  background: rgba(217, 119, 87, 0.1);
  border-color: rgba(217, 119, 87, 0.5);
}
.trip-action-btn.delete {
  color: #b0432f;
  border-color: rgba(196, 74, 54, 0.25);
}
.trip-action-btn.delete:hover {
  background: rgba(196, 74, 54, 0.08);
  border-color: rgba(196, 74, 54, 0.45);
}
.trip-action-btn:disabled {
  color: #c3bcb2;
  border-color: rgba(61, 50, 41, 0.12);
  background: transparent;
  cursor: not-allowed;
}
.trips-empty {
  padding: 56px 0;
  text-align: center;
  color: #a39c93;
  font-size: 13px;
}

@media (max-width: 768px) {
  .admin-trips-card {
    padding: 20px 16px;
  }
  .trips-layout {
    flex-direction: column;
  }
  .trips-users {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    max-height: none;
    padding: 6px;
  }
  .trips-user-item {
    width: auto;
    flex-shrink: 0;
  }
  .trips-user-label {
    max-width: 96px;
  }
  .trip-card-side {
    flex-direction: row;
    align-items: center;
  }
  .trip-card-main {
    flex-direction: column;
  }
}
</style>
