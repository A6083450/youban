<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { wechatPrivacyAuthorization } from '@/platform/wechat-privacy'

const AGREE_BUTTON_ID = 'youban-privacy-agree'
const { t } = useI18n()

wechatPrivacyAuthorization.install()

function agree(): void {
  wechatPrivacyAuthorization.agree(AGREE_BUTTON_ID)
}
</script>

<template>
  <view v-if="wechatPrivacyAuthorization.visible.value" class="privacy-authorization-mask">
    <view class="privacy-authorization-dialog" role="dialog" aria-modal="true">
      <view class="privacy-authorization-title">
        {{ t('login.privacyPromptTitle') }}
      </view>
      <view class="privacy-authorization-description">
        {{ t('login.privacyPromptDescription') }}
      </view>
      <button class="privacy-contract-button" @click="wechatPrivacyAuthorization.openContract">
        {{ t('login.privacyPromptView') }}
      </button>
      <view class="privacy-authorization-actions">
        <button class="privacy-decline-button" @click="wechatPrivacyAuthorization.disagree">
          {{ t('login.privacyPromptDecline') }}
        </button>
        <button
          id="youban-privacy-agree"
          class="privacy-agree-button"
          open-type="agreePrivacyAuthorization"
          @agreeprivacyauthorization="agree"
        >
          {{ t('login.privacyPromptAgree') }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.privacy-authorization-mask {
  position: fixed;
  z-index: 10000;
  display: flex;
  padding: 44rpx;
  align-items: center;
  justify-content: center;
  background: rgba(39, 31, 26, 0.54);
  inset: 0;
}
.privacy-authorization-dialog {
  box-sizing: border-box;
  width: 100%;
  max-width: 620rpx;
  padding: 40rpx;
  border: 1rpx solid var(--border-subtle);
  border-radius: 12rpx;
  background: var(--surface-elevated);
  color: var(--text-primary);
  box-shadow: 0 24rpx 72rpx rgba(39, 31, 26, 0.2);
}
.privacy-authorization-title {
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.45;
}
.privacy-authorization-description {
  margin-top: 20rpx;
  color: var(--text-secondary);
  font-size: 25rpx;
  line-height: 1.75;
}
.privacy-contract-button {
  height: 68rpx;
  margin: 16rpx 0 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-strong);
  font-size: 24rpx;
  line-height: 68rpx;
  text-align: left;
}
.privacy-authorization-actions {
  display: grid;
  margin-top: 28rpx;
  gap: 16rpx;
  grid-template-columns: 1fr 1.35fr;
}
.privacy-decline-button,
.privacy-agree-button {
  height: 76rpx;
  margin: 0;
  border: 0;
  border-radius: 10rpx;
  font-size: 25rpx;
  line-height: 76rpx;
}
.privacy-decline-button {
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.privacy-agree-button {
  background: var(--accent-primary);
  color: #fff;
  font-weight: 650;
}
.privacy-contract-button::after,
.privacy-decline-button::after,
.privacy-agree-button::after {
  border: 0;
}
</style>
