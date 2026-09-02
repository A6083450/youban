<template>
  <main class="login-page">
    <section class="login-panel">
      <img class="login-logo" src="/favicon.svg" :alt="t('app.brand')" />
      <h1>{{ t('app.brand') }}</h1>
      <p class="status">{{ statusText }}</p>
      <img v-if="accountAvatar" class="account-avatar" :src="accountAvatar" :alt="t('login.avatarAlt')" />
      <img v-if="qrCode" class="qr" :src="qrCode" :alt="t('login.qrAlt')" />
      <a-spin v-else-if="!accountAvatar" size="large" />
      <p v-if="accountAvatar" class="avatar-hint">{{ t('login.avatarHint') }}</p>
      <div v-if="challenge" class="short-code">
        <span>{{ t('login.shortCode') }}</span>
        <strong>{{ challenge.short_code }}</strong>
        <small>{{ challenge.challenge_id }}</small>
      </div>
      <a-button v-if="failed" type="primary" size="large" block @click="start">{{ t('login.refresh') }}</a-button>
      <div class="share-entry"><ShareCodeEntry /></div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { message } from 'ant-design-vue'
import {
  createWebLoginChallenge,
  exchangeWebLoginChallenge,
  getWebLoginChallengeStatus,
  type WebLoginChallenge,
} from '@/services/api'
import { completeWebLogin } from '@/stores/auth'
import ShareCodeEntry from '@/components/ShareCodeEntry.vue'

const router = useRouter()
const { t } = useI18n()
const challenge = ref<WebLoginChallenge | null>(null)
const qrCode = ref('')
const accountAvatar = ref('')
const state = ref<'loading' | 'pending' | 'approved' | 'failed'>('loading')
const failed = computed(() => state.value === 'failed')
const statusText = computed(() => t(`login.${state.value}`))
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0

const poll = async (current: WebLoginChallenge, token: number) => {
  if (token !== generation) return
  try {
    const status = await getWebLoginChallengeStatus(current.challenge_id, current.verifier)
    if (status === 'approved') {
      state.value = 'approved'
      const user = await exchangeWebLoginChallenge(current.challenge_id, current.verifier)
      await completeWebLogin(user)
      accountAvatar.value = user.avatar_url || ''
      qrCode.value = ''
      message.success(t('login.welcome', { name: user.nickname }))
      await new Promise((resolve) => setTimeout(resolve, 450))
      await router.replace('/')
      return
    }
    if (status === 'expired' || status === 'exchanged') {
      state.value = 'failed'
      return
    }
    timer = setTimeout(() => void poll(current, token), 1500)
  } catch {
    timer = setTimeout(() => void poll(current, token), 2500)
  }
}

const start = async () => {
  generation += 1
  const token = generation
  if (timer) clearTimeout(timer)
  state.value = 'loading'
  qrCode.value = ''
  accountAvatar.value = ''
  try {
    const current = await createWebLoginChallenge()
    if (token !== generation) return
    challenge.value = current
    qrCode.value = await QRCode.toDataURL(
      `youban://web-login?id=${encodeURIComponent(current.challenge_id)}&credential=${encodeURIComponent(current.challenge_token)}`,
      { width: 256, margin: 1, errorCorrectionLevel: 'M' },
    )
    state.value = 'pending'
    void poll(current, token)
  } catch {
    state.value = 'failed'
  }
}

onMounted(() => void start())
onBeforeUnmount(() => {
  generation += 1
  if (timer) clearTimeout(timer)
})
</script>

<style scoped>
.login-page { align-items: center; background: var(--surface-page); color: var(--text-primary); display: flex; justify-content: center; min-height: 100vh; padding: 24px; }
.login-panel { max-width: 360px; text-align: center; width: 100%; }
.login-logo { height: 54px; width: 54px; }
h1 { color: var(--text-primary); font-size: 30px; margin: 8px 0 4px; }
.status { color: var(--text-secondary); margin: 0 0 22px; }
.qr { background: var(--surface-elevated); border: 1px solid var(--border-subtle); height: 256px; padding: 12px; width: 256px; }
.account-avatar { border: 4px solid #fff; border-radius: 50%; box-shadow: 0 10px 28px rgba(31, 49, 38, .14); height: 104px; margin: 18px auto; object-fit: cover; width: 104px; }
.avatar-hint { color: var(--text-secondary); font-size: 13px; line-height: 1.6; margin: 0 auto 8px; max-width: 300px; }
.short-code { align-items: center; display: grid; gap: 4px; margin: 20px auto 0; max-width: 280px; }
.short-code span, .short-code small { color: var(--text-secondary); font-size: 12px; }
.short-code strong { color: var(--accent-primary); font-size: 28px; letter-spacing: 0; }
.short-code small { overflow-wrap: anywhere; }
button { margin-top: 22px; }
.share-entry { border-top: 1px solid var(--border-subtle); margin-top: 30px; padding-top: 24px; }
</style>
