<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'

const preferences = usePreferencesStore()
const { t } = useI18n()

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '隐私说明与用户协议',
  },
})
</script>

<template>
  <view class="privacy-page" :class="preferences.themeClass">
    <view class="privacy-content">
      <view class="privacy-eyebrow">
        PRIVACY
      </view>
      <view class="privacy-title">
        {{ t('privacy.title') }}
      </view>
      <view class="privacy-date">
        {{ t('privacy.updated') }}
      </view>

      <view class="privacy-section">
        <view class="section-title">
          {{ t('privacy.accountTitle') }}
        </view>
        <view class="section-copy">
          {{ t('privacy.accountCopy') }}
        </view>
      </view>
      <view class="privacy-section">
        <view class="section-title">
          {{ t('privacy.mapTitle') }}
        </view>
        <view class="section-copy">
          {{ t('privacy.mapCopy') }}
        </view>
      </view>
      <view class="privacy-section">
        <view class="section-title">
          {{ t('privacy.shareTitle') }}
        </view>
        <view class="section-copy">
          {{ t('privacy.shareCopy') }}
        </view>
      </view>
      <view class="privacy-section">
        <view class="section-title">
          {{ t('privacy.sessionTitle') }}
        </view>
        <view class="section-copy">
          {{ t('privacy.sessionCopy') }}
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.privacy-page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 48px 24px 80px;
  background: var(--surface-page);
  color: var(--text-primary);
}
.privacy-content {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}
.privacy-eyebrow {
  margin: 0;
  color: #b85738;
  font-size: 12px;
  font-weight: 700;
}
.privacy-title {
  margin: 8px 0 0;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.3;
}
.privacy-date {
  margin: 8px 0 40px;
  color: var(--text-secondary);
  font-size: 13px;
}
.privacy-section {
  padding: 28px 0;
  border-top: 1px solid #ded4ca;
}
.section-title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
}
.section-copy {
  margin: 0;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.9;
}
@media (max-width: 420px) {
  .privacy-page {
    padding: 32px 20px 64px;
  }
  .privacy-title {
    font-size: 27px;
  }
}
</style>
