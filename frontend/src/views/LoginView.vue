<template>
  <div class="login-page">
    <div class="login-card">
      <img class="login-logo" src="/favicon.svg" alt="游伴" />
      <h1 class="login-title">{{ t('app.brand') }}</h1>
      <p class="login-subtitle">{{ t('login.subtitle') }}</p>
      <a-input
        v-model:value="nickname"
        class="login-input"
        size="large"
        :maxlength="20"
        :placeholder="t('login.placeholder')"
        @pressEnter="submit"
      />
      <a-button
        type="primary"
        size="large"
        block
        class="login-button"
        :loading="loading"
        :disabled="!nickname.trim()"
        @click="submit"
      >
        {{ t('login.enter') }}
      </a-button>
      <p class="login-hint">{{ t('login.hint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { loginWithNickname } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const nickname = ref('')
const loading = ref(false)

const submit = async () => {
  const name = nickname.value.trim()
  if (!name || loading.value) return
  loading.value = true
  try {
    const user = await loginWithNickname(name)
    message.success(t('login.welcome', { name: user.nickname }))
    router.replace('/')
  } catch (error: any) {
    message.error(error?.message || t('login.failed'))
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(560px 420px at 18% 12%, rgba(217, 119, 87, 0.14), transparent 65%),
    radial-gradient(640px 480px at 85% 88%, rgba(196, 96, 61, 0.10), transparent 60%),
    linear-gradient(160deg, #faf9f5 0%, #f0eee6 100%);
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 380px;
  background: #ffffff;
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 20px;
  padding: 40px 32px;
  text-align: center;
  box-shadow: 0 18px 48px rgba(61, 50, 41, 0.10);
}
.login-logo { width: 52px; height: 52px; margin-bottom: 8px; }
.login-title { font-size: 24px; font-weight: 700; margin: 0 0 4px; color: #3d3229; }
.login-subtitle { color: #6e655d; margin: 0 0 24px; font-size: 14px; }
.login-input { margin-bottom: 16px; border-radius: 12px; }
.login-input:deep(.ant-input),
.login-input.ant-input {
  border-color: rgba(61, 50, 41, 0.16);
}
.login-input.ant-input:hover,
.login-input.ant-input:focus,
.login-input.ant-input-focused {
  border-color: #d97757 !important;
  box-shadow: 0 0 0 2px rgba(217, 119, 87, 0.14) !important;
}
.login-button {
  border-radius: 12px;
  height: 44px;
  font-weight: 600;
  background: linear-gradient(135deg, #d97757, #c4603d) !important;
  border-color: #d97757 !important;
  color: #fff !important;
}
.login-button:hover:not(:disabled) {
  background: linear-gradient(135deg, #c4603d, #b0532f) !important;
  border-color: #c4603d !important;
}
.login-button:disabled {
  background: #ece7df !important;
  border-color: #ece7df !important;
  color: #a39c93 !important;
}
.login-hint { margin: 16px 0 0; color: #a39c93; font-size: 12px; }
</style>
