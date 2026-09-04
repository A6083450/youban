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
import { claimWebLoginOwner, isWebLoginOwner, releaseWebLoginOwner } from './web-login-owner'
// #ifdef H5
import WebLoginExperience from '@/components/login/WebLoginExperience.vue'
// #endif
// #ifdef MP-WEIXIN
import WechatPrivacyAuthorization from '@/components/WechatPrivacyAuthorization.vue'
// #endif

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '登录游伴',
  },
})

const auth = useAuthStore()
const preferences = usePreferencesStore()
const { t } = useI18n()
const state = ref<'loading' | 'ready' | 'scanned' | 'success' | 'expired' | 'failed'>('loading')
const busy = ref(false)
const qrCodeDataUrl = ref('')
const failed = computed(() => state.value === 'failed' || state.value === 'expired')
const statusText = computed(() => ({
  loading: t('login.loading'),
  ready: t('login.pending'),
  scanned: t('login.scanned'),
  success: t('login.webSuccess'),
  expired: t('login.expired'),
  failed: t('login.failed'),
})[state.value])
let generation = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let challengeExpiresAt = 0
const webLoginOwner = claimWebLoginOwner()

// #ifdef H5
function isCurrentWebLogin(token: number): boolean {
  return token === generation && isWebLoginOwner(webLoginOwner)
}

function clearPoll(): void {
  if (pollTimer)
    clearTimeout(pollTimer)
  pollTimer = undefined
}

function failWebLogin(token: number, nextState: 'expired' | 'failed' = 'failed'): void {
  if (isCurrentWebLogin(token))
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
    if (!isCurrentWebLogin(token))
      return
    if (result.status === 'pending') {
      schedulePoll(token, challengeId)
      return
    }
    if (result.status === 'scanned') {
      state.value = 'scanned'
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
    if (isCurrentWebLogin(token))
      uni.reLaunch({ url: HOME_ROUTE })
  }
  catch (error) {
    if (!isCurrentWebLogin(token))
      return
    if ((error as { status?: unknown } | null)?.status === 422) {
      failWebLogin(token)
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
    if (!isCurrentWebLogin(token))
      return
    const expiresAt = Date.parse(challenge.expires_at)
    challengeExpiresAt = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 5 * 60 * 1000
    qrCodeDataUrl.value = challenge.qr_code_data_url
    state.value = 'ready'
    schedulePoll(token, challenge.challenge_id)
  }
  catch {
    if (isCurrentWebLogin(token))
      state.value = 'failed'
  }
}

// #endif

async function loginMiniProgram(): Promise<void> {
  if (busy.value)
    return
  busy.value = true
  uni.showLoading({ title: t('login.loggingIn'), mask: true })
  try {
    await auth.loginMiniProgram()
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
  queueMicrotask(() => {
    if (isWebLoginOwner(webLoginOwner))
      void startWebLogin()
  })
  // #endif
})

onBeforeUnmount(() => {
  generation += 1
  // #ifdef H5
  releaseWebLoginOwner(webLoginOwner)
  clearPoll()
  // #endif
})
</script>

<template>
  <!-- #ifdef H5 -->
  <WebLoginExperience
    :locale="preferences.locale"
    :qr-code-data-url="qrCodeDataUrl"
    :skin="preferences.skin"
    :state="state"
    :status-text="statusText"
    @change-locale="preferences.setLocale"
    @change-skin="preferences.setSkin"
    @retry="startWebLogin"
  />
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
        :loading="busy"
        :disabled="busy"
        @click="loginMiniProgram"
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
    <WechatPrivacyAuthorization />
  </view>
  <!-- #endif -->
</template>

<style scoped lang="scss" src="./login-mini.scss" />
