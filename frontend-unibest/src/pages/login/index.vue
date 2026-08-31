<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
// #ifdef H5
import { mountWechatLoginWidget } from '@/features/auth/wechat-login-widget'
import { startWechatWebLogin } from '@/services/v2'
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
      <view class="brand-mark">
        {{ t('app.brand').slice(0, 1) }}
      </view>
      <view class="brand-name">
        {{ t('app.brand') }}
      </view>
      <view class="login-title">
        {{ t('login.miniTitle') }}
      </view>
      <view class="login-description">
        {{ t('login.miniDescription') }}
      </view>

      <button
        class="avatar-login"
        open-type="chooseAvatar"
        :disabled="busy"
        @chooseavatar="chooseAvatar"
      >
        <image v-if="previewUrl" class="avatar-preview" :src="previewUrl" mode="aspectFill" />
        <view v-else class="avatar-placeholder">
          {{ t('account.wechatUser').slice(0, 1) }}
        </view>
      </button>

      <button
        class="mini-login-button"
        open-type="chooseAvatar"
        :loading="busy"
        :disabled="busy"
        @chooseavatar="chooseAvatar"
      >
        {{ t('login.miniButton') }}
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
  margin: 0 0 22px;
  color: var(--text-secondary);
  font-size: 14px;
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
  justify-content: space-between;
  padding: 116rpx 44rpx calc(env(safe-area-inset-bottom) + 30rpx);
}
.login-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 680rpx;
  margin: 0 auto;
  text-align: center;
}
.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80rpx;
  height: 80rpx;
  border-radius: 8rpx;
  background: var(--accent-primary);
  color: #fff;
  font-size: 42rpx;
  font-weight: 720;
}
.brand-name {
  margin-top: 20rpx;
  color: var(--accent-strong);
  font-size: 25rpx;
  font-weight: 680;
}
.login-title {
  max-width: 620rpx;
  margin-top: 44rpx;
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
.avatar-login {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 196rpx;
  height: 196rpx;
  margin: 64rpx 0 44rpx;
  padding: 0;
  border: 8rpx solid var(--surface-elevated);
  border-radius: 50%;
  background: var(--accent-soft);
  box-shadow: 0 20rpx 54rpx rgba(55, 45, 40, 0.14);
  overflow: hidden;
}
.avatar-preview {
  width: 100%;
  height: 100%;
}
.avatar-placeholder {
  color: var(--accent-strong);
  font-size: 58rpx;
  font-weight: 700;
}
.mini-login-button {
  width: 100%;
  height: 94rpx;
  margin: 0;
  border: 0;
  border-radius: 8rpx;
  background: var(--accent-primary);
  color: #fff;
  font-size: 29rpx;
  font-weight: 680;
  line-height: 94rpx;
}
.mini-login-button[disabled],
.avatar-login[disabled] {
  opacity: 0.58;
}
.login-note {
  max-width: 590rpx;
  margin-top: 24rpx;
  color: var(--text-secondary);
  font-size: 23rpx;
  line-height: 1.65;
}
.privacy-link {
  height: 72rpx;
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 23rpx;
  line-height: 72rpx;
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
