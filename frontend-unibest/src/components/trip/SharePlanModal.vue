<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildPlanShareUrl, shareActionLabel, shareQrFileName } from '@/features/share/model'

const props = defineProps<{
  open: boolean
  shareCode: string
}>()

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const qrDataUrl = ref('')

const shareUrl = computed(() => {
  let origin = ''
  let basePath = '/'
  // #ifdef H5
  origin = window.location.origin
  basePath = import.meta.env.BASE_URL || '/'
  // #endif
  return buildPlanShareUrl(origin, basePath, props.shareCode)
})

async function generateQr(): Promise<void> {
  if (!props.shareCode) {
    qrDataUrl.value = ''
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(shareUrl.value, { width: 320, margin: 1 })
  }
  catch {
    qrDataUrl.value = ''
  }
}

function copyText(value: string, successKey: string, failureKey: string): void {
  uni.setClipboardData({
    data: value,
    success: () => uni.showToast({ title: t(successKey), icon: 'success' }),
    fail: () => uni.showToast({ title: t(failureKey), icon: 'none' }),
  })
}

function selectInput(event: unknown): void {
  // #ifdef H5
  const target = (event as { target?: unknown }).target
  if (target instanceof HTMLInputElement)
    target.select()
  // #endif
}

function downloadQr(): void {
  if (!qrDataUrl.value)
    return
  // #ifdef H5
  const link = document.createElement('a')
  link.download = shareQrFileName(props.shareCode)
  link.href = qrDataUrl.value
  link.click()
  // #endif
}

watch(() => [props.open, props.shareCode], ([open]) => {
  if (open)
    void generateQr()
}, { immediate: true })
</script>

<template>
  <view v-if="open" class="share-modal-mask" @click.self="emit('close')">
    <view class="share-modal-card" role="dialog" :aria-label="t('result.share.modalTitle')">
      <view class="share-modal-header">
        <text class="share-modal-title">{{ t('result.share.modalTitle') }}</text>
        <button class="share-modal-close" :aria-label="t('common.close')" @click="emit('close')">
          ×
        </button>
      </view>

      <view class="share-modal-body">
        <view class="share-link-block">
          <text class="share-link-label">{{ t('result.share.linkLabel') }}</text>
          <view class="share-link-row">
            <input class="share-link-input" :value="shareUrl" readonly @focus="selectInput">
            <button class="share-primary-copy" @click="copyText(shareUrl, 'result.share.copied', 'result.share.copyFailed')">
              {{ shareActionLabel(t('result.share.copy')) }}
            </button>
          </view>
        </view>

        <view class="share-code-block">
          <text class="share-link-label">{{ t('result.share.codeLabel') }}</text>
          <view class="share-link-row">
            <input
              class="share-link-input share-code-input"
              :aria-label="t('result.share.codeLabel')"
              :value="shareCode"
              readonly
              @focus="selectInput"
            >
            <button
              class="share-code-copy"
              :aria-label="t('result.share.copyCode')"
              @click="copyText(shareCode, 'result.share.codeCopied', 'result.share.codeCopyFailed')"
            >
              <wd-icon name="copy" size="15px" />
            </button>
          </view>
        </view>

        <view class="share-qr-block">
          <text class="share-qr-title">{{ t('result.share.qrTitle') }}</text>
          <image v-if="qrDataUrl" class="share-qr-img" :src="qrDataUrl" mode="aspectFit" />
          <view v-else class="share-qr-fallback">
            {{ t('result.share.qrFailed') }}
          </view>
          <button v-if="qrDataUrl" class="share-qr-download" @click="downloadQr">
            {{ t('result.share.downloadQr') }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.share-modal-mask {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.share-modal-card {
  position: relative;
  box-sizing: border-box;
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 20px 24px;
  border-radius: 8px;
  background: #fff;
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.08),
    0 3px 6px -4px rgba(0, 0, 0, 0.12),
    0 9px 28px 8px rgba(0, 0, 0, 0.05);
  color: #3d3229;
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-weight: 300;
}
.share-modal-header {
  height: 24px;
  line-height: 24px;
}
.share-modal-title {
  display: block;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.share-modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(0, 0, 0, 0.45);
  font-family: Arial, sans-serif;
  font-size: 22px;
  font-weight: 300;
  line-height: 32px;
}
.share-modal-close::after,
.share-primary-copy::after,
.share-code-copy::after,
.share-qr-download::after {
  display: none;
}
.share-modal-body {
  display: flex;
  margin-top: 8px;
  padding: 4px 0;
  flex-direction: column;
  gap: 20px;
}
.share-link-label {
  display: block;
  margin-bottom: 8px;
  color: rgba(61, 50, 41, 0.7);
  font-size: 13px;
  line-height: 20.4219px;
}
.share-link-row {
  display: flex;
  height: 34.4219px;
  align-items: center;
  gap: 8px;
}
.share-link-input {
  box-sizing: border-box;
  min-width: 0;
  height: 34.4219px;
  padding: 6px 10px;
  flex: 1;
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 8px;
  background: #faf7f2;
  color: #3d3229;
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-size: 13px;
  font-weight: 300;
  line-height: 20.4219px;
}
.share-primary-copy,
.share-qr-download {
  box-sizing: border-box;
  height: 24px;
  margin: 0;
  padding: 0 7px;
  border: 1px solid #d97757;
  border-radius: 6px;
  background: #d97757;
  color: #fff;
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-size: 14px;
  font-weight: 300;
  line-height: 22px;
}
.share-code-input {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
.share-code-copy {
  display: flex;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 6px;
  background: #fff;
  color: #c4603d;
}
.share-qr-block {
  display: flex;
  height: 224.4219px;
  align-items: center;
  flex-direction: column;
  gap: 10px;
}
.share-qr-title {
  color: rgba(61, 50, 41, 0.7);
  font-size: 13px;
  line-height: 20.4219px;
}
.share-qr-img,
.share-qr-fallback {
  box-sizing: border-box;
  width: 160px;
  height: 160px;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 8px;
}
.share-qr-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  color: rgba(61, 50, 41, 0.5);
  font-size: 12px;
  text-align: center;
}
.share-qr-download {
  border-color: #d9d9d9;
  background: #fff;
  color: rgba(0, 0, 0, 0.88);
  font-size: 14px;
}
@media (max-width: 420px) {
  .share-modal-card {
    padding-right: 20px;
    padding-left: 20px;
  }
}
</style>
