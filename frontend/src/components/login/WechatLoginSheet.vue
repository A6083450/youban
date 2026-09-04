<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { wechatPrivacyAuthorization } from '@/platform/wechat-privacy'
import { useAuthStore } from '@/store/auth'

const props = defineProps<{
  open: boolean
  prompt: string
}>()

const emit = defineEmits<{
  authenticated: []
  close: []
}>()

const AGREE_BUTTON_ID = 'youban-sheet-privacy-agree'
const auth = useAuthStore()
const { t } = useI18n()
const busy = ref(false)
const errorMessage = ref('')

wechatPrivacyAuthorization.install()

watch(() => props.open, (open) => {
  if (open)
    errorMessage.value = ''
})

function close(): void {
  if (busy.value)
    return
  if (wechatPrivacyAuthorization.visible.value)
    wechatPrivacyAuthorization.disagree()
  emit('close')
}

function agreePrivacy(): void {
  wechatPrivacyAuthorization.agree(AGREE_BUTTON_ID)
}

async function loginMiniProgram(): Promise<void> {
  if (busy.value)
    return
  busy.value = true
  errorMessage.value = ''
  try {
    await auth.loginMiniProgram()
    emit('authenticated')
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('login.miniFailed')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <view v-if="open" class="login-sheet-mask" @click.self="close">
    <view class="login-sheet" role="dialog" aria-modal="true" :aria-label="t('login.sheetTitle')">
      <view class="sheet-handle" />

      <template v-if="wechatPrivacyAuthorization.visible.value">
        <view class="sheet-privacy-state">
          <view class="sheet-kicker">
            {{ t('login.sheetKicker') }}
          </view>
          <view class="sheet-title">
            {{ t('login.privacyPromptTitle') }}
          </view>
          <view class="sheet-description">
            {{ t('login.privacyPromptDescription') }}
          </view>
          <button class="sheet-contract-action" @click="wechatPrivacyAuthorization.openContract">
            {{ t('login.privacyPromptView') }}
          </button>
          <view class="sheet-privacy-actions">
            <button class="sheet-cancel-action" @click="close">
              {{ t('login.privacyPromptDecline') }}
            </button>
            <button
              id="youban-sheet-privacy-agree"
              class="sheet-privacy-agree"
              open-type="agreePrivacyAuthorization"
              @agreeprivacyauthorization="agreePrivacy"
            >
              {{ t('login.privacyPromptAgree') }}
            </button>
          </view>
        </view>
      </template>

      <template v-else>
        <view class="sheet-kicker-row">
          <text class="sheet-kicker-mark">AI</text>
          <text class="sheet-kicker">{{ t('login.sheetKicker') }}</text>
        </view>
        <view class="sheet-title">
          {{ t('login.sheetTitle') }}
        </view>
        <view class="sheet-description">
          {{ t('login.sheetDescription') }}
        </view>
        <view v-if="prompt" class="sheet-prompt-preview">
          “{{ prompt }}”
        </view>
        <view class="sheet-benefits">
          <view class="sheet-benefit">
            <text class="sheet-benefit-mark">1</text>
            <text>{{ t('login.sheetBenefitSave') }}</text>
          </view>
          <view class="sheet-benefit">
            <text class="sheet-benefit-mark">2</text>
            <text>{{ t('login.sheetBenefitPrivacy') }}</text>
          </view>
        </view>
        <view v-if="errorMessage" class="sheet-error">
          {{ errorMessage }}
        </view>
        <button
          class="sheet-login-action"
          :loading="busy"
          :disabled="busy"
          @click="loginMiniProgram"
        >
          <text class="sheet-wechat-mark">微</text>
          <text>{{ busy ? t('login.loggingIn') : t('login.miniButton') }}</text>
        </button>
        <view class="sheet-footer">
          <button class="sheet-cancel-action" @click="close">
            {{ t('login.sheetCancel') }}
          </button>
          <button class="sheet-contract-action" @click="wechatPrivacyAuthorization.openContract">
            {{ t('login.privacyLink') }}
          </button>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped lang="scss" src="./wechat-login-sheet.scss" />
