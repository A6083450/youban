<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setStoredValue, StorageKeys } from '@/platform/storage'
import { HOME_ROUTE } from '@/router/auth-guard'
import { approveWebLoginChallenge } from '@/services/v2'
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '确认网页登录',
  },
})

type PageState = 'ready' | 'invalid' | 'submitting' | 'success' | 'expired' | 'failed'

const auth = useAuthStore()
const preferences = usePreferencesStore()
const { t } = useI18n()
const challengeId = ref('')
const state = ref<PageState>('invalid')
const busy = computed(() => state.value === 'submitting')
const valid = computed(() => /^[0-9a-f]{32}$/.test(challengeId.value))
const confirmLabel = computed(() => auth.ready ? t('login.confirmButton') : t('login.confirmLoginButton'))
const secondaryLabel = computed(() => ['ready', 'submitting'].includes(state.value)
  ? t('login.confirmCancel')
  : t('login.confirmBackHome'))
const message = computed(() => ({
  ready: t('login.confirmDescription'),
  invalid: t('login.confirmInvalid'),
  submitting: t('login.confirmDescription'),
  success: t('login.confirmSuccess'),
  expired: t('login.confirmExpired'),
  failed: t('login.confirmFailed'),
})[state.value])

function normalizedScene(value: unknown): string {
  try {
    return decodeURIComponent(String(value || '')).trim().toLowerCase()
  }
  catch {
    return ''
  }
}

function clearPendingChallenge(): void {
  setStoredValue(StorageKeys.pendingWebLoginChallenge, null)
}

async function confirmLogin(): Promise<void> {
  if (!valid.value || busy.value || state.value === 'success')
    return
  state.value = 'submitting'
  try {
    await auth.restore(true)
    if (!auth.ready) {
      setStoredValue(StorageKeys.pendingWebLoginChallenge, challengeId.value)
      uni.reLaunch({ url: '/pages/login/index' })
      return
    }
    await approveWebLoginChallenge(challengeId.value)
    clearPendingChallenge()
    state.value = 'success'
  }
  catch (error) {
    clearPendingChallenge()
    state.value = error instanceof Error && error.message.includes('过期') ? 'expired' : 'failed'
  }
}

function cancel(): void {
  clearPendingChallenge()
  uni.reLaunch({ url: HOME_ROUTE })
}

onLoad((query) => {
  challengeId.value = normalizedScene(query?.scene)
  state.value = valid.value ? 'ready' : 'invalid'
  if (!valid.value)
    clearPendingChallenge()
})
</script>

<template>
  <view class="confirm-page" :class="preferences.themeClass">
    <view class="confirm-card">
      <view class="brand-mark">
        {{ t('app.brand').slice(0, 1) }}
      </view>
      <view class="confirm-title">
        {{ t('login.confirmTitle') }}
      </view>
      <view class="confirm-message" :class="`state-${state}`">
        {{ message }}
      </view>
      <button
        class="confirm-button"
        :loading="busy"
        :disabled="!valid || busy || state === 'success'"
        @click="confirmLogin"
      >
        {{ confirmLabel }}
      </button>
      <button class="cancel-button" :disabled="busy" @click="cancel">
        {{ secondaryLabel }}
      </button>
    </view>
  </view>
</template>

<style scoped lang="scss">
.confirm-page {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: 100vh;
  padding: 80rpx 44rpx calc(env(safe-area-inset-bottom) + 48rpx);
  background: var(--surface-page);
  color: var(--text-primary);
}
.confirm-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 680rpx;
  margin: 0 auto;
  text-align: center;
}
.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 92rpx;
  height: 92rpx;
  margin: 0 auto;
  border-radius: 12rpx;
  background: var(--accent-primary);
  color: #fff;
  font-size: 46rpx;
  font-weight: 720;
}
.confirm-title {
  margin-top: 48rpx;
  font-size: 48rpx;
  font-weight: 720;
  line-height: 1.3;
}
.confirm-message {
  min-height: 96rpx;
  margin: 24rpx auto 64rpx;
  color: var(--text-secondary);
  font-size: 28rpx;
  line-height: 1.7;
}
.state-invalid,
.state-expired,
.state-failed {
  color: var(--status-danger);
}
.state-success {
  color: var(--status-success);
}
.confirm-button,
.cancel-button {
  width: 100%;
  height: 94rpx;
  margin: 0;
  border: 0;
  border-radius: 10rpx;
  font-size: 29rpx;
  font-weight: 680;
  line-height: 94rpx;
}
.confirm-button {
  background: var(--accent-primary);
  color: #fff;
}
.confirm-button[disabled],
.cancel-button[disabled] {
  opacity: 0.58;
}
.cancel-button {
  margin-top: 22rpx;
  background: transparent;
  color: var(--text-secondary);
}
button::after {
  border: 0;
}
</style>
