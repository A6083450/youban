<script setup lang="ts">
import type { ConversationRecordDto, UserLocaleDto, UserSkinDto } from '@youban/contracts'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { localDateText, sidebarPlanBadge } from '@/features/sidebar/record-status'
import { getApiBaseUrl } from '@/http/client'
import {
  deleteConversation,
  deleteTripPlan,
  getConversations,
} from '@/services/v2'
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'

type PreferencePanel = '' | 'language' | 'skin'

const props = withDefaults(defineProps<{
  activePlanId?: string
  open?: boolean
}>(), {
  activePlanId: '',
  open: false,
})

const emit = defineEmits<{ close: [] }>()
const auth = useAuthStore()
const preferences = usePreferencesStore()
const { t } = useI18n()
const records = ref<ConversationRecordDto[]>([])
const recordsLoading = ref(true)
const shareToolOpen = ref(false)
const shareCode = ref('')
const accountMenuOpen = ref(false)
const activePreferencePanel = ref<PreferencePanel>('')
const today = localDateText()

const conversationRecords = computed(() => records.value.filter(item => item.kind === 'conversation'))
const plannedRecords = computed(() => records.value.filter(item => item.kind === 'plan'))
const planBadge = (record: ConversationRecordDto) => sidebarPlanBadge(record, today)
const userAvatar = computed(() => {
  const source = auth.user?.avatar_url || ''
  if (!source || /^https?:\/\//.test(source))
    return source
  return `${getApiBaseUrl()}${source.startsWith('/') ? source : `/${source}`}`
})
const selectedLanguageLabel = computed(() => {
  if (preferences.locale === 'en-US')
    return t('app.language.en')
  if (preferences.locale === 'fr-FR')
    return t('app.language.fr')
  return t('app.language.zh')
})
const selectedSkinLabel = computed(() => preferences.skin === 'google'
  ? t('app.skin.clear')
  : t('app.skin.warm'))

function togglePreferencePanel(panel: Exclude<PreferencePanel, ''>): void {
  activePreferencePanel.value = activePreferencePanel.value === panel ? '' : panel
}

async function selectLocale(locale: UserLocaleDto): Promise<void> {
  activePreferencePanel.value = ''
  await preferences.setLocale(locale)
}

async function selectSkin(skin: UserSkinDto): Promise<void> {
  activePreferencePanel.value = ''
  await preferences.setSkin(skin)
}

async function loadRecords(): Promise<void> {
  recordsLoading.value = true
  try {
    records.value = (await getConversations(50)).items
  }
  catch {
    records.value = []
  }
  finally {
    recordsLoading.value = false
  }
}

function goHome(query = ''): void {
  emit('close')
  uni.reLaunch({ url: `/pages/index/index${query}` })
}

function openPlan(planId: string | null | undefined): void {
  if (!planId || planId === props.activePlanId)
    return
  emit('close')
  uni.redirectTo({ url: `/pages/plan/index?id=${encodeURIComponent(planId)}` })
}

function openConversation(sessionId: string | null): void {
  if (sessionId)
    goHome(`?conversation=${encodeURIComponent(sessionId)}`)
}

function openSharedPlan(): void {
  const code = shareCode.value.trim().toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(code)) {
    uni.showToast({ title: t('shareCode.invalid'), icon: 'none' })
    return
  }
  emit('close')
  uni.navigateTo({ url: `/pages/share/index?code=${encodeURIComponent(code)}` })
}

async function removeRecord(record: ConversationRecordDto): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: t('sidebar.delete'),
      content: t('sidebar.deleteConfirm'),
      confirmColor: '#c2413a',
      success: result => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed)
    return
  try {
    if (record.session_id)
      await deleteConversation(record.session_id)
    else if (record.task_id || record.plan_id)
      await deleteTripPlan(record.task_id || record.plan_id || '')
    records.value = records.value.filter(item => item.record_id !== record.record_id)
    if (record.plan_id === props.activePlanId)
      goHome()
    uni.showToast({ title: t('sidebar.deleted'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : t('sidebar.deleteFailed'), icon: 'none' })
  }
}

async function logout(): Promise<void> {
  await auth.logout()
  uni.reLaunch({ url: '/pages/login/index' })
}

onMounted(() => {
  void loadRecords()
})
</script>

<template>
  <view v-if="open" class="drawer-mask" @click="emit('close')" />
  <aside class="sidebar" :class="{ open }">
    <view class="sidebar-brand">
      {{ t('app.brand') }}
    </view>
    <button class="new-plan-button" @click="goHome()">
      <text class="plus-symbol">+</text>
      <text>{{ t('sidebar.newPlan') }}</text>
    </button>

    <scroll-view scroll-y class="sidebar-list">
      <view class="sidebar-section-title">
        {{ t('sidebar.conversations') }}
      </view>
      <view v-if="recordsLoading" class="sidebar-empty">
        {{ t('common.loading') }}
      </view>
      <view v-else-if="!conversationRecords.length" class="sidebar-empty">
        {{ t('sidebar.emptyConversations') }}
      </view>
      <view v-for="record in conversationRecords" :key="record.record_id" class="sidebar-record-row">
        <button class="sidebar-record" @click="openConversation(record.session_id)">
          <text class="record-title">{{ record.title }}</text>
          <text v-if="record.state === 'generating'" class="record-status">{{ t('sidebar.processing') }}</text>
        </button>
        <button class="record-delete" :aria-label="t('sidebar.delete')" @click="removeRecord(record)">
          <wd-icon name="delete" size="14px" />
        </button>
      </view>

      <view class="sidebar-section-title plan-section-title">
        {{ t('sidebar.plans') }}
      </view>
      <view v-if="!recordsLoading && !plannedRecords.length" class="sidebar-empty">
        {{ t('sidebar.empty') }}
      </view>
      <view
        v-for="record in plannedRecords"
        :key="record.record_id"
        class="sidebar-record-row"
        :class="{ active: record.plan_id === activePlanId }"
      >
        <button class="sidebar-record" @click="openPlan(record.plan_id)">
          <text class="record-title">{{ record.city || record.title }}</text>
          <view class="record-date">
            {{ record.start_date }} ~ {{ record.end_date }}
            <text v-if="planBadge(record)" class="sidebar-record-badge" :class="planBadge(record)">
              {{ t(`sidebar.${planBadge(record)}`) }}
            </text>
          </view>
        </button>
        <button class="record-delete" :aria-label="t('sidebar.delete')" @click="removeRecord(record)">
          <wd-icon name="delete" size="14px" />
        </button>
      </view>
    </scroll-view>

    <view class="sidebar-tools">
      <view class="sidebar-share-tool">
        <button class="sidebar-share-trigger" :class="{ expanded: shareToolOpen }" @click="shareToolOpen = !shareToolOpen">
          <wd-icon name="link" size="16px" />
          <text>{{ t('shareCode.entryTitle') }}</text>
          <wd-icon class="share-chevron" name="arrow-down" size="12px" />
        </button>
        <view v-if="shareToolOpen" class="sidebar-share-panel">
          <text class="share-code-label">{{ t('shareCode.label') }}</text>
          <view class="share-code-row">
            <input v-model="shareCode" class="share-code-input" :placeholder="t('shareCode.placeholder')" :maxlength="32" @confirm="openSharedPlan">
            <button class="share-code-submit" @click="openSharedPlan">
              {{ t('shareCode.submit') }}
            </button>
          </view>
        </view>
      </view>

      <!-- #ifdef H5 -->
      <view class="sidebar-preferences">
        <view class="sidebar-preferences-title">
          {{ t('app.preferences.label') }}
        </view>
        <view class="preference-group">
          <text class="preference-label">{{ t('app.language.label') }}</text>
          <view class="preference-segment language-segment">
            <button :class="{ active: preferences.locale === 'zh-CN' }" @click="preferences.setLocale('zh-CN')">
              {{ t('app.language.zh') }}
            </button>
            <button :class="{ active: preferences.locale === 'en-US' }" @click="preferences.setLocale('en-US')">
              {{ t('app.language.en') }}
            </button>
            <button :class="{ active: preferences.locale === 'fr-FR' }" @click="preferences.setLocale('fr-FR')">
              {{ t('app.language.fr') }}
            </button>
          </view>
        </view>
        <view class="preference-group">
          <text class="preference-label">{{ t('app.skin.label') }}</text>
          <view class="preference-segment">
            <button :class="{ active: preferences.skin === 'default' }" @click="preferences.setSkin('default')">
              <text class="skin-swatch warm" />{{ t('app.skin.warm') }}
            </button>
            <button :class="{ active: preferences.skin === 'google' }" @click="preferences.setSkin('google')">
              <text class="skin-swatch clear" />{{ t('app.skin.clear') }}
            </button>
          </view>
        </view>
      </view>
      <!-- #endif -->

      <!-- #ifdef MP-WEIXIN -->
      <view class="sidebar-preferences compact">
        <view v-if="activePreferencePanel === 'language'" class="preference-segment preference-choice-panel language language-segment">
          <button data-preference-value="zh-CN" :class="{ active: preferences.locale === 'zh-CN' }" @click="selectLocale('zh-CN')">
            {{ t('app.language.zh') }}
          </button>
          <button data-preference-value="en-US" :class="{ active: preferences.locale === 'en-US' }" @click="selectLocale('en-US')">
            {{ t('app.language.en') }}
          </button>
          <button data-preference-value="fr-FR" :class="{ active: preferences.locale === 'fr-FR' }" @click="selectLocale('fr-FR')">
            {{ t('app.language.fr') }}
          </button>
        </view>
        <view v-if="activePreferencePanel === 'skin'" class="preference-segment preference-choice-panel skin">
          <button data-preference-value="default" :class="{ active: preferences.skin === 'default' }" @click="selectSkin('default')">
            <text class="skin-swatch warm" />{{ t('app.skin.warm') }}
          </button>
          <button data-preference-value="google" :class="{ active: preferences.skin === 'google' }" @click="selectSkin('google')">
            <text class="skin-swatch clear" />{{ t('app.skin.clear') }}
          </button>
        </view>
        <view class="preference-toolbar">
          <button
            class="preference-toolbar-button preference-language-trigger"
            :class="{ active: activePreferencePanel === 'language' }"
            :aria-label="t('app.language.label')"
            @click="togglePreferencePanel('language')"
          >
            <view class="i-carbon-language preference-toolbar-icon" aria-hidden="true" />
            <text>{{ selectedLanguageLabel }}</text>
            <wd-icon name="arrow-down" size="13px" />
          </button>
          <button
            class="preference-toolbar-button preference-skin-trigger"
            :class="{ active: activePreferencePanel === 'skin' }"
            :aria-label="t('app.skin.label')"
            @click="togglePreferencePanel('skin')"
          >
            <view class="i-carbon-sun preference-toolbar-icon" aria-hidden="true" />
            <text>{{ selectedSkinLabel }}</text>
            <wd-icon name="arrow-down" size="13px" />
          </button>
        </view>
      </view>
      <!-- #endif -->

      <!-- #ifdef H5 -->
      <view class="sidebar-user">
        <button class="account-trigger" @click="accountMenuOpen = !accountMenuOpen">
          <image v-if="userAvatar" class="user-avatar" :src="userAvatar" mode="aspectFill" />
          <text class="user-name">{{ auth.user?.nickname || t('account.wechatUser') }}</text>
          <wd-icon name="arrow-down" size="13px" />
        </button>
        <view v-if="accountMenuOpen" class="account-menu">
          <button class="account-logout" @click="logout">
            <wd-icon name="logout" size="15px" />{{ t('account.logout') }}
          </button>
        </view>
      </view>
      <!-- #endif -->
    </view>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  box-sizing: border-box;
  width: 260px;
  min-width: 260px;
  height: 100%;
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-navigation);
  flex: 0 0 260px;
  flex-direction: column;
}
.sidebar-brand {
  box-sizing: border-box;
  height: 51px;
  padding: 18px 16px 10px;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 800;
  line-height: 23px;
}
.new-plan-button {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: calc(100% - 24px);
  height: 40px;
  min-height: 40px;
  margin: 4px 12px 12px;
  padding: 0 14px;
  border: 1px solid var(--accent-focus);
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 14px;
  font-weight: 650;
  gap: 8px;
}
.plus-symbol {
  font-size: 20px;
  font-weight: 400;
}
.sidebar-list {
  box-sizing: border-box;
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 0 8px 12px;
}
.sidebar-section-title {
  padding: 4px 16px 8px;
  color: rgba(61, 50, 41, 0.45);
  font-size: 12px;
  font-weight: 600;
  line-height: 13.8px;
}
.plan-section-title {
  margin-top: 2px;
}
.sidebar-empty {
  padding: 12px 8px;
  color: rgba(61, 50, 41, 0.5);
  font-size: 13px;
  line-height: 14.95px;
}
.sidebar-record-row {
  display: flex;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  flex-direction: column;
}
.sidebar-record-row.active {
  background: var(--accent-soft);
}
.sidebar-record {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 0;
  margin: 0;
  padding: 0 28px 0 0;
  align-items: stretch;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-weight: 300;
  flex-direction: column;
  gap: 2px;
  line-height: normal;
  text-align: left;
}
.sidebar-record::after {
  display: none;
}
.record-delete {
  display: flex;
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  align-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  justify-content: center;
  opacity: 0;
}
.record-title {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  line-height: 16.1px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-date,
.record-status {
  margin-top: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 13.8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-status {
  color: var(--accent-strong);
}
.sidebar-record-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 1.5;
}
.sidebar-record-badge.processing {
  color: #d46b08;
  background: rgba(255, 165, 0, 0.15);
}
.sidebar-record-badge.failed {
  color: rgba(61, 50, 41, 0.55);
  background: rgba(61, 50, 41, 0.1);
}
.sidebar-record-badge.ongoing {
  color: #a8752a;
  background: rgba(216, 169, 78, 0.18);
}
.sidebar-tools {
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-elevated);
}
.sidebar-share-tool {
  padding: 10px 12px 8px;
}
.sidebar-share-trigger {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  min-height: 44px;
  margin: 0;
  padding: 9px 10px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  grid-template-columns: 18px minmax(0, 1fr) 14px;
  gap: 8px;
  text-align: left;
}
.sidebar-share-trigger.expanded {
  border-color: var(--accent-focus);
  background: var(--accent-hover);
  color: var(--accent-strong);
}
.share-chevron {
  justify-self: end;
  opacity: 0.65;
}
.sidebar-share-panel {
  padding: 10px 0 2px;
}
.share-code-label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}
.share-code-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.share-code-input {
  box-sizing: border-box;
  min-width: 0;
  height: 40px;
  padding: 0 10px;
  flex: 1;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  font-size: 12px;
}
.share-code-submit {
  min-width: 68px;
  height: 40px;
  margin: 0;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 12px;
  line-height: 40px;
}
.sidebar-preferences {
  display: flex;
  padding: 12px;
  border-top: 1px solid var(--border-subtle);
  flex-direction: column;
  gap: 10px;
}
.sidebar-preferences-title {
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}
.sidebar-preferences.compact {
  gap: 8px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
}
.preference-toolbar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.preference-toolbar-button {
  display: grid;
  box-sizing: border-box;
  min-width: 0;
  min-height: 48px;
  margin: 0;
  padding: 8px 9px;
  align-items: center;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  grid-template-columns: 22px minmax(0, 1fr) 13px;
  gap: 6px;
  line-height: 16px;
  text-align: left;
}
.preference-toolbar-button.active {
  border-color: var(--accent-focus);
  background: var(--accent-selected);
  color: var(--accent-strong);
}
.preference-toolbar-button text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preference-toolbar-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-strong);
  font-size: 20px;
}
.preference-choice-panel {
  box-shadow: 0 8px 22px rgba(61, 50, 41, 0.12);
}
.preference-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.preference-label {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}
.preference-segment {
  display: grid;
  padding: 3px;
  border-radius: 7px;
  background: var(--surface-soft);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
}
.preference-segment.language-segment {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.preference-segment button {
  display: flex;
  min-width: 0;
  min-height: 30px;
  margin: 0;
  padding: 5px 7px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  gap: 5px;
  font-size: 10px;
}
.preference-segment button.active {
  background: var(--surface-elevated);
  color: var(--accent-strong);
  font-weight: 700;
  box-shadow: 0 2px 7px rgba(61, 50, 41, 0.08);
}
.skin-swatch {
  width: 10px;
  height: 10px;
  border: 1px solid rgba(61, 50, 41, 0.12);
  border-radius: 50%;
}
.skin-swatch.warm {
  background: #d97757;
}
.skin-swatch.clear {
  background: #3b9bb4;
}
.sidebar-user {
  position: relative;
  box-sizing: border-box;
  min-height: 56px;
  padding: 0 12px 12px;
}
.account-trigger {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  margin: 0;
  padding: 7px 10px;
  align-items: center;
  border: 0;
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  gap: 10px;
}
.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
}
.user-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-menu {
  position: absolute;
  z-index: 50;
  right: 12px;
  bottom: 62px;
  left: 12px;
  padding: 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  box-shadow: 0 10px 26px rgba(61, 50, 41, 0.14);
}
.account-menu button {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 38px;
  margin: 0;
  padding: 8px 10px;
  align-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  gap: 8px;
  line-height: 18px;
  text-align: left;
}
.drawer-mask {
  display: none;
}
button::after {
  display: none;
}

@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    z-index: 80;
    top: 0;
    bottom: 0;
    left: 0;
    width: 280px;
    max-width: 82vw;
    min-width: 0;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 24px rgba(61, 50, 41, 0.15);
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .drawer-mask {
    position: fixed;
    z-index: 70;
    inset: 0;
    display: block;
    background: rgba(40, 32, 26, 0.32);
  }
}
</style>
