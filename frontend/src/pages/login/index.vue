<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
// #ifdef H5
import {
  createWebLoginChallenge,
  exchangeWebLoginChallenge,
  getWebLoginChallengeStatus,
} from '@/services/v2'
// #endif
import { getStoredValue, setStoredValue, StorageKeys } from '@/platform/storage'
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
const state = ref<'loading' | 'ready' | 'success' | 'expired' | 'failed'>('loading')
const busy = ref(false)
const previewUrl = ref('')
const qrCodeDataUrl = ref('')
const failed = computed(() => state.value === 'failed' || state.value === 'expired')
const statusText = computed(() => ({
  loading: t('login.loading'),
  ready: t('login.pending'),
  success: t('login.webSuccess'),
  expired: t('login.expired'),
  failed: t('login.failed'),
})[state.value])
let generation = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let challengeExpiresAt = 0

// #ifdef H5
function clearPoll(): void {
  if (pollTimer)
    clearTimeout(pollTimer)
  pollTimer = undefined
}

function failWebLogin(token: number, nextState: 'expired' | 'failed' = 'failed'): void {
  if (token === generation)
    state.value = nextState
}

function schedulePoll(token: number, challengeId: string, delay = 1000): void {
  clearPoll()
  pollTimer = setTimeout(() => void pollWebLogin(token, challengeId), delay)
}

function retryPoll(token: number, challengeId: string): void {
  if (Date.now() >= challengeExpiresAt) {
    failWebLogin(token, 'expired')
    return
  }
  schedulePoll(token, challengeId, 1500)
}

async function pollWebLogin(token: number, challengeId: string): Promise<void> {
  try {
    const result = await getWebLoginChallengeStatus(challengeId)
    if (token !== generation)
      return
    if (result.status === 'pending') {
      schedulePoll(token, challengeId)
      return
    }
    if (result.status === 'expired') {
      failWebLogin(token, 'expired')
      return
    }
    if (result.status !== 'approved') {
      failWebLogin(token)
      return
    }
    state.value = 'success'
    await exchangeWebLoginChallenge(challengeId)
    await auth.restore(true)
    if (token === generation)
      uni.reLaunch({ url: HOME_ROUTE })
  }
  catch (error) {
    if (token !== generation)
      return
    if ((error as { status?: unknown } | null)?.status === 422) {
      void startWebLogin()
      return
    }
    retryPoll(token, challengeId)
  }
}

async function startWebLogin(): Promise<void> {
  generation += 1
  const token = generation
  clearPoll()
  challengeExpiresAt = 0
  state.value = 'loading'
  qrCodeDataUrl.value = ''
  try {
    const challenge = await createWebLoginChallenge()
    if (token !== generation)
      return
    const expiresAt = Date.parse(challenge.expires_at)
    challengeExpiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 5 * 60 * 1000
    qrCodeDataUrl.value = challenge.qr_code_data_url
    state.value = 'ready'
    schedulePoll(token, challenge.challenge_id)
  }
  catch {
    if (token === generation)
      state.value = 'failed'
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
    const pending = getStoredValue<string>(StorageKeys.pendingWebLoginChallenge)
    if (/^[0-9a-f]{32}$/.test(pending || '')) {
      setStoredValue(StorageKeys.pendingWebLoginChallenge, null)
      uni.reLaunch({ url: `/pages/web-login/index?scene=${pending}` })
    }
    else {
      uni.reLaunch({ url: HOME_ROUTE })
    }
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

function openPrivacy(): void {
  uni.navigateTo({ url: '/pages/privacy/index' })
}

onMounted(() => {
  if (auth.ready) {
    uni.reLaunch({ url: HOME_ROUTE })
    return
  }
  // #ifdef H5
  void startWebLogin()
  // #endif
})

onBeforeUnmount(() => {
  generation += 1
  // #ifdef H5
  clearPoll()
  // #endif
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
      <view class="wechat-login-shell">
        <image
          v-if="qrCodeDataUrl"
          class="wechat-login-code"
          :src="qrCodeDataUrl"
          mode="aspectFit"
          :aria-label="t('login.pending')"
        />
        <view v-if="state === 'loading'" class="widget-state">
          <view class="spinner" :aria-label="t('common.loading')" />
        </view>
        <view v-else-if="failed" class="widget-state widget-failed">
          <button class="refresh-button" @click="startWebLogin">
            {{ t('login.retry') }}
          </button>
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
.wechat-login-shell {
  position: relative;
  box-sizing: border-box;
  width: 320px;
  height: 320px;
  margin: 0 auto;
  padding: 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: var(--surface-elevated);
  overflow: hidden;
}
.wechat-login-code {
  width: 100%;
  height: 100%;
}
.widget-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-elevated);
}
.widget-failed {
  padding: 18px;
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
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
