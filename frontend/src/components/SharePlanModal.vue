<template>
  <a-modal
    :open="open"
    :title="t('result.share.modalTitle')"
    :footer="null"
    centered
    :width="360"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="share-modal-body">
      <div class="share-link-block">
        <span class="share-link-label">{{ t('result.share.linkLabel') }}</span>
        <div class="share-link-row">
          <input
            class="share-link-input"
            :value="shareUrl"
            readonly
            @focus="(e) => (e.target as HTMLInputElement).select()"
          />
          <a-button type="primary" size="small" @click="copyLink">
            {{ t('result.share.copy') }}
          </a-button>
        </div>
      </div>

      <div class="share-qr-block">
        <div class="share-qr-title">{{ t('result.share.qrTitle') }}</div>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR" class="share-qr-img" />
        <div v-else class="share-qr-fallback">{{ t('result.share.qrFailed') }}</div>
        <a-button v-if="qrDataUrl" size="small" class="share-qr-download" @click="downloadQr">
          {{ t('result.share.downloadQr') }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import QRCode from 'qrcode'

const props = defineProps<{ open: boolean; planId: string }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()
const { t } = useI18n()

const shareUrl = computed(() => `${window.location.origin}/share/${props.planId}`)
const qrDataUrl = ref('')

const generateQr = async () => {
  if (!props.planId) {
    qrDataUrl.value = ''
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(shareUrl.value, { width: 320, margin: 1 })
  } catch (error) {
    console.error('生成二维码失败:', error)
    qrDataUrl.value = ''
  }
}

watch(
  () => [props.open, props.planId],
  () => {
    if (props.open) generateQr()
  },
  { immediate: true }
)

const copyLink = async () => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(shareUrl.value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl.value
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    message.success(t('result.share.copied'))
  } catch (error) {
    console.error('复制链接失败:', error)
    message.error(t('result.share.copyFailed'))
  }
}

const downloadQr = () => {
  if (!qrDataUrl.value) return
  const link = document.createElement('a')
  link.download = `tripstar_share_${props.planId}.png`
  link.href = qrDataUrl.value
  link.click()
}
</script>

<style scoped>
.share-modal-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 4px 0;
}
.share-link-label {
  display: block;
  font-size: 13px;
  color: rgba(61, 50, 41, 0.7);
  margin-bottom: 8px;
}
.share-link-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.share-link-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 8px;
  font-size: 13px;
  color: #3D3229;
  background: #FAF7F2;
}
.share-qr-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.share-qr-title {
  font-size: 13px;
  color: rgba(61, 50, 41, 0.7);
}
.share-qr-img {
  width: 160px;
  height: 160px;
  border-radius: 8px;
  border: 1px solid rgba(61, 50, 41, 0.1);
}
.share-qr-fallback {
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12px;
  color: rgba(61, 50, 41, 0.5);
  border: 1px dashed rgba(61, 50, 41, 0.2);
  border-radius: 8px;
}
</style>
