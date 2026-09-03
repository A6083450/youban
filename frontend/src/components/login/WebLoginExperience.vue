<script setup lang="ts">
import type { UserLocaleDto, UserSkinDto } from '@youban/contracts'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

type WebLoginState = 'loading' | 'ready' | 'scanned' | 'success' | 'expired' | 'failed'

const props = defineProps<{
  locale: UserLocaleDto
  qrCodeDataUrl: string
  skin: UserSkinDto
  state: WebLoginState
  statusText: string
}>()

const emit = defineEmits<{
  changeLocale: [locale: UserLocaleDto]
  changeSkin: [skin: UserSkinDto]
  retry: []
}>()

const { t } = useI18n()
const motionEnabled = ref(true)
const failed = computed(() => props.state === 'failed' || props.state === 'expired')
</script>

<template>
  <view
    class="web-login-experience"
    :class="[
      skin === 'google' ? 'theme-clear' : 'theme-warm',
      { 'motion-paused': !motionEnabled },
    ]"
  >
    <view class="login-backdrop" aria-hidden="true">
      <view class="contour contour-left" />
      <view class="contour contour-right" />
      <svg class="route-map" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <path class="route-base" d="M-80 790 C240 650 440 760 700 610 S1090 300 1520 370" />
        <path class="route-flow" d="M-80 790 C240 650 440 760 700 610 S1090 300 1520 370" />
        <circle class="route-node" cx="280" cy="675" r="7" />
        <circle class="route-node" cx="790" cy="530" r="7" />
        <circle class="route-node" cx="1190" cy="325" r="7" />
      </svg>
    </view>

    <view class="login-toolbar" role="toolbar" :aria-label="t('app.preferences.label')">
      <view class="preference-control language-control">
        <view class="i-carbon-language control-icon" aria-hidden="true" />
        <button data-locale="zh-CN" :class="{ active: locale === 'zh-CN' }" @click="emit('changeLocale', 'zh-CN')">
          {{ t('app.language.zh') }}
        </button>
        <button data-locale="en-US" :class="{ active: locale === 'en-US' }" @click="emit('changeLocale', 'en-US')">
          EN
        </button>
        <button data-locale="fr-FR" :class="{ active: locale === 'fr-FR' }" @click="emit('changeLocale', 'fr-FR')">
          FR
        </button>
      </view>
      <view class="preference-control skin-control">
        <button data-skin="default" :class="{ active: skin === 'default' }" @click="emit('changeSkin', 'default')">
          <text class="skin-swatch warm" />{{ t('app.skin.warm') }}
        </button>
        <button data-skin="google" :class="{ active: skin === 'google' }" @click="emit('changeSkin', 'google')">
          <text class="skin-swatch clear" />{{ t('app.skin.clear') }}
        </button>
      </view>
      <button
        class="motion-toggle"
        :title="motionEnabled ? t('login.motionPause') : t('login.motionPlay')"
        :aria-label="motionEnabled ? t('login.motionPause') : t('login.motionPlay')"
        :aria-pressed="motionEnabled"
        @click="motionEnabled = !motionEnabled"
      >
        <view v-if="motionEnabled" class="i-carbon-pause-filled" aria-hidden="true" />
        <view v-else class="i-carbon-play-filled-alt" aria-hidden="true" />
      </button>
    </view>

    <view class="login-content">
      <view class="journey-copy">
        <view class="brand-lockup">
          <image class="brand-logo" src="/static/brand-logo.svg" mode="aspectFit" />
          <text class="brand-name">{{ t('app.brand') }}</text>
        </view>
        <view class="journey-title">
          {{ t('login.webHeroTitle') }}
        </view>
        <view class="journey-description">
          {{ t('login.webHeroDescription') }}
        </view>
        <view class="journey-steps">
          <view class="journey-step active">
            <text class="step-dot" />{{ t('login.webStepDiscover') }}
          </view>
          <view class="journey-step">
            <text class="step-dot" />{{ t('login.webStepPlan') }}
          </view>
          <view class="journey-step">
            <text class="step-dot" />{{ t('login.webStepStart') }}
          </view>
        </view>
      </view>

      <view class="login-panel">
        <view class="panel-status" aria-live="polite">
          {{ statusText }}
        </view>
        <view class="wechat-login-shell" :class="{ 'is-scanned': state === 'scanned' }">
          <image
            v-if="qrCodeDataUrl"
            class="wechat-login-code"
            :class="{ 'is-scanned': state === 'scanned' }"
            :src="qrCodeDataUrl"
            mode="aspectFit"
            :aria-label="t('login.pending')"
          />
          <view v-if="state === 'loading'" class="widget-state">
            <view class="spinner" :aria-label="t('common.loading')" />
          </view>
          <view v-else-if="state === 'scanned'" class="widget-state scan-waiting-state" aria-live="polite">
            <view class="scan-waiting-spinner" aria-hidden="true" />
            <view class="scan-waiting-title">
              {{ t('login.scannedTitle') }}
            </view>
            <view class="scan-waiting-hint">
              {{ t('login.scannedHint') }}
            </view>
          </view>
          <view v-else-if="failed" class="widget-state widget-failed">
            <button class="refresh-button" @click="emit('retry')">
              {{ t('login.retry') }}
            </button>
          </view>
        </view>
        <view class="login-security">
          <text class="security-dot" />{{ t('login.webSecurity') }}
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss" src="./web-login-experience.scss" />

<style scoped lang="scss" src="./web-login-experience-widget.scss" />
