<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
// #ifdef H5
import { mountWechatLoginWidget } from '@/features/auth/wechat-login-widget'
import { loginNickname, startWechatWebLogin } from '@/services/v2'
// #endif
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'
import { HOME_ROUTE } from '@/router/auth-guard'

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '登录游伴',
  },
})

const auth = useAuthStore()
const preferences = usePreferencesStore()
const { t } = useI18n()
const state = ref<'loading' | 'ready' | 'failed'>('loading')
const busy = ref(false)
const previewUrl = ref('')
const shareCode = ref('')
const shareInvalid = ref(false)
const failureMessage = ref('')
const nickname = ref('')
const nicknameError = ref('')
const nicknameBusy = ref(false)
const failed = computed(() => state.value === 'failed')
const statusText = computed(() => ({
  loading: t('login.loading'),
  ready: t('login.pending'),
  failed: failureMessage.value || t('login.failed'),
})[state.value])
let generation = 0

// #ifdef H5
function callbackFailureMessage(): string {
  const query = window.location.hash.split('?', 2)[1] || ''
  const result = new URLSearchParams(query).get('wechat_error')
  const translationKey = {
    denied: 'login.denied',
    expired: 'login.expired',
    provider: 'login.providerError',
    identity: 'login.identityError',
  }[result || '']
  return translationKey ? t(translationKey) : ''
}

async function startWebLogin(): Promise<void> {
  generation += 1
  const token = generation
  state.value = 'loading'
  failureMessage.value = ''
  document.getElementById('wechat-login-container')?.replaceChildren()
  try {
    const configuration = await startWechatWebLogin()
    if (token !== generation)
      return
    await mountWechatLoginWidget('wechat-login-container', configuration)
    if (token === generation)
      state.value = 'ready'
  }
  catch {
    if (token === generation)
      state.value = 'failed'
  }
}

function updateNickname(event: { detail: { value: string } }): void {
  nickname.value = String(event.detail.value || '')
  nicknameError.value = ''
}

async function submitNickname(): Promise<void> {
  const normalized = nickname.value.trim().split(/\s+/u).filter(Boolean).join(' ')
  if (!normalized) {
    nicknameError.value = t('login.nicknameRequired')
    return
  }
  if (Array.from(normalized).length > 20) {
    nicknameError.value = t('login.nicknameTooLong')
    return
  }
  if (nicknameBusy.value)
    return
  nicknameBusy.value = true
  nicknameError.value = ''
  try {
    const response = await loginNickname(normalized)
    auth.acceptWebsiteSession(response.user)
    uni.reLaunch({ url: HOME_ROUTE })
  }
  catch (error) {
    nicknameError.value = error instanceof Error ? error.message : t('login.nicknameFailed')
  }
  finally {
    nicknameBusy.value = false
  }
}
// #endif

async function chooseAvatar(event: unknown): Promise<void> {
  const detail = (event as { detail?: { avatarUrl?: string } })?.detail
  const filePath = String(detail?.avatarUrl || '').trim()
  if (!filePath || busy.value)
    return
  busy.value = true
  previewUrl.value = filePath
  uni.showLoading({ title: t('login.loggingIn'), mask: true })
  try {
    await auth.loginMiniProgramWithAvatar(filePath)
    uni.hideLoading()
    uni.reLaunch({ url: HOME_ROUTE })
  }
  catch (error) {
    uni.hideLoading()
    busy.value = false
    previewUrl.value = ''
    uni.showToast({
      title: error instanceof Error ? error.message : t('login.miniFailed'),
      icon: 'none',
    })
  }
}

function normalizeShareCode(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function updateShareCode(event: { detail: { value: string } }): void {
  shareCode.value = normalizeShareCode(event.detail.value)
  shareInvalid.value = false
}

function submitShareCode(): void {
  if (!/^[0-9a-f]{32}$/.test(shareCode.value)) {
    shareInvalid.value = true
    return
  }
  uni.navigateTo({ url: `/pages/share/index?code=${encodeURIComponent(shareCode.value)}` })
}

function openPrivacy(): void {
  uni.navigateTo({ url: '/pages/privacy/index' })
}

onMounted(() => {
  if (auth.ready) {
    uni.reLaunch({ url: HOME_ROUTE })
    return
  }
  // #ifdef H5
  const callbackFailure = callbackFailureMessage()
  if (callbackFailure) {
    failureMessage.value = callbackFailure
    state.value = 'failed'
    return
  }
  void startWebLogin()
  // #endif
})

onBeforeUnmount(() => {
  generation += 1
})
</script>

<template>
  <!-- #ifdef H5 -->
  <view class="login-page web-login-page" :class="preferences.themeClass">
    <view class="login-panel">
      <image class="login-logo" src="/static/brand-logo.svg" mode="aspectFit" />
      <view class="web-brand">
        {{ t('app.brand') }}
      </view>
      <view class="status">
        {{ statusText }}
      </view>
      <view class="nickname-entry">
        <view class="nickname-label">
          {{ t('login.nicknameLabel') }}
        </view>
        <view class="nickname-row">
          <input
            class="nickname-input"
            :value="nickname"
            :maxlength="20"
            :placeholder="t('login.nicknamePlaceholder')"
            confirm-type="go"
            @input="updateNickname"
            @confirm="submitNickname"
          >
          <button
            class="nickname-login-button"
            :loading="nicknameBusy"
            :disabled="nicknameBusy"
            @click="submitNickname"
          >
            {{ t('login.nicknameButton') }}
          </button>
        </view>
        <view v-if="nicknameError" class="nickname-error">
          {{ nicknameError }}
        </view>
      </view>
      <view class="login-divider">
        <view class="divider-line" />
        <text>{{ t('login.nicknameDivider') }}</text>
        <view class="divider-line" />
      </view>
      <view class="wechat-login-shell">
        <view id="wechat-login-container" class="wechat-login-widget" />
        <view v-if="state === 'loading'" class="widget-state">
          <view class="spinner" :aria-label="t('common.loading')" />
        </view>
        <view v-else-if="failed" class="widget-state widget-failed">
          <button class="refresh-button" @click="startWebLogin">
            {{ t('login.retry') }}
          </button>
        </view>
      </view>
      <view class="share-entry">
        <view class="share-label">
          {{ t('shareCode.label') }}
        </view>
        <view class="share-row">
          <input
            class="share-input"
            :value="shareCode"
            :maxlength="32"
            :placeholder="t('shareCode.placeholder')"
            @input="updateShareCode"
          >
          <button class="share-button" @click="submitShareCode">
            {{ t('shareCode.submit') }}
          </button>
        </view>
        <view v-if="shareInvalid" class="share-error">
          {{ t('shareCode.invalid') }}
        </view>
      </view>
    </view>
  </view>
  <!-- #endif -->

  <!-- #ifdef MP-WEIXIN -->
  <view class="login-page mini-login-page" :class="preferences.themeClass">
    <view class="login-main">
      <view class="mini-brand-row">
        <view class="mini-brand-logo-frame">
          <image class="mini-brand-logo" src="/static/brand-logo.png" mode="aspectFit" />
        </view>
        <view class="mini-brand-copy">
          <text class="mini-brand-name">{{ t('app.brand') }}</text>
          <text class="mini-agent-label">{{ t('login.miniAgentLabel') }}</text>
        </view>
      </view>
      <view class="login-title">
        {{ t('login.miniTitle') }}
      </view>
      <view class="login-description">
        {{ t('login.miniDescription') }}
      </view>

      <view class="mini-agent-callout">
        {{ t('login.miniAgentHint') }}
      </view>

      <button
        class="mini-login-button"
        open-type="chooseAvatar"
        :loading="busy"
        :disabled="busy"
        @chooseavatar="chooseAvatar"
      >
        <text class="wechat-login-mark">微</text>
        <text>{{ t('login.miniButton') }}</text>
      </button>
      <view class="login-note">
        {{ t('login.miniNote') }}
      </view>
    </view>

    <button class="privacy-link" @click="openPrivacy">
      {{ t('login.privacyLink') }}
    </button>
  </view>
  <!-- #endif -->
</template>

<style scoped lang="scss">
.login-page {
  box-sizing: border-box;
  min-height: 100vh;
  background: var(--surface-page);
  color: var(--text-primary);
}
.web-login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.login-panel {
  width: 100%;
  max-width: 360px;
  text-align: center;
}
.login-logo {
  width: 54px;
  height: 54px;
}
.web-brand {
  margin: 8px 0 4px;
  color: var(--text-primary);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
}
.status {
  margin: 0 0 20px;
  color: var(--text-secondary);
  font-size: 14px;
}
.nickname-entry {
  text-align: left;
}
.nickname-label {
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}
.nickname-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.nickname-input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 4px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 14px;
}
.nickname-login-button {
  width: 76px;
  height: 42px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  line-height: 42px;
}
.nickname-login-button[disabled] {
  opacity: 0.58;
}
.nickname-error {
  margin-top: 8px;
  color: var(--status-danger);
  font-size: 12px;
  line-height: 1.4;
}
.login-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 22px 0 14px;
  color: var(--text-tertiary, var(--text-secondary));
  font-size: 12px;
  white-space: nowrap;
}
.divider-line {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}
.wechat-login-shell {
  position: relative;
  width: 300px;
  height: 400px;
  margin: 0 auto;
  overflow: hidden;
}
.wechat-login-widget {
  width: 300px;
  height: 400px;
}
.widget-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-page);
}
.widget-failed {
  align-items: flex-start;
  padding-top: 148px;
}
.spinner {
  width: 28px;
  height: 28px;
  margin: 0;
  border: 3px solid rgba(217, 119, 87, 0.2);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.refresh-button {
  width: 180px;
  height: 42px;
  margin: 0;
  border: 0;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 15px;
  line-height: 42px;
}
.share-entry {
  margin-top: 30px;
  padding-top: 24px;
  border-top: 1px solid var(--border-subtle);
  text-align: left;
}
.share-label {
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}
.share-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.share-input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 4px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 14px;
}
.share-button {
  width: 76px;
  height: 40px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  line-height: 40px;
}
.share-error {
  margin-top: 8px;
  color: var(--status-danger);
  font-size: 12px;
  line-height: 1.4;
}
.mini-login-page {
  display: flex;
  flex-direction: column;
  padding: 112rpx 44rpx calc(env(safe-area-inset-bottom) + 24rpx);
}
.login-main {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  max-width: 680rpx;
  margin: 0 auto;
  text-align: left;
}
.mini-brand-row {
  display: flex;
  align-items: center;
  gap: 24rpx;
}
.mini-brand-logo-frame {
  width: 108rpx;
  height: 108rpx;
  flex: none;
  overflow: hidden;
}
.mini-brand-logo {
  display: block;
  width: 100%;
  height: 100%;
}
.mini-brand-copy {
  display: flex;
  flex-direction: column;
  gap: 5rpx;
}
.mini-brand-name {
  color: var(--accent-strong);
  font-size: 28rpx;
  font-weight: 720;
  line-height: 1.35;
}
.mini-agent-label {
  color: var(--text-secondary);
  font-size: 22rpx;
  line-height: 1.45;
}
.login-title {
  max-width: 620rpx;
  margin-top: 96rpx;
  font-size: 48rpx;
  font-weight: 720;
  line-height: 1.3;
}
.login-description {
  max-width: 590rpx;
  margin-top: 22rpx;
  color: var(--text-secondary);
  font-size: 27rpx;
  line-height: 1.7;
}
.mini-agent-callout {
  box-sizing: border-box;
  width: 100%;
  margin-top: 64rpx;
  padding: 26rpx 30rpx;
  border-left: 6rpx solid var(--accent-primary);
  background: var(--accent-soft);
  color: var(--text-secondary);
  font-size: 24rpx;
  line-height: 1.65;
}
.mini-login-button {
  display: flex;
  width: 100%;
  height: 96rpx;
  margin: 0;
  margin-top: auto;
  padding: 0 28rpx;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 10rpx;
  background: var(--accent-primary);
  color: #fff;
  font-size: 29rpx;
  font-weight: 680;
  gap: 16rpx;
  line-height: 96rpx;
}
.wechat-login-mark {
  display: flex;
  width: 44rpx;
  height: 44rpx;
  align-items: center;
  justify-content: center;
  border: 2rpx solid rgba(255, 255, 255, 0.72);
  border-radius: 10rpx;
  font-size: 20rpx;
  font-weight: 700;
  line-height: 44rpx;
}
.mini-login-button[disabled] {
  opacity: 0.58;
}
.login-note {
  width: 100%;
  margin-top: 20rpx;
  color: var(--text-secondary);
  font-size: 23rpx;
  line-height: 1.65;
  text-align: center;
}
.privacy-link {
  width: 100%;
  height: 72rpx;
  margin: 10rpx 0 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 23rpx;
  line-height: 72rpx;
  text-align: center;
}
button::after {
  border: 0;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
