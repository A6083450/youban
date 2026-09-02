<template>
  <Result
    v-if="!loadError"
    :plan-id="id"
    :key="id"
    readonly
    @share-load-error="loadError = $event"
  />
  <main v-else class="share-error-page">
    <section class="share-error-panel">
      <h1>{{ t('shareCode.errorTitle') }}</h1>
      <p role="alert" aria-live="polite">{{ t(`shareCode.${loadError}`) }}</p>
      <h2>{{ t('shareCode.retryTitle') }}</h2>
      <ShareCodeEntry :initial-code="id" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Result from './Result.vue'
import ShareCodeEntry from '@/components/ShareCodeEntry.vue'
import type { ShareLoadErrorKind } from '@/types'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const loadError = ref<ShareLoadErrorKind | null>(null)

watch(
  () => props.id,
  () => {
    loadError.value = null
  },
)
</script>

<style scoped>
.share-error-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #faf7f2;
}

.share-error-panel {
  width: min(100%, 520px);
  padding: 32px;
  background: #ffffff;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(61, 50, 41, 0.1);
}

.share-error-panel h1 {
  margin: 0 0 8px;
  color: #3d3229;
  font-size: 20px;
  line-height: 1.3;
}

.share-error-panel p {
  margin: 0 0 24px;
  color: #6b5d52;
  font-size: 14px;
  line-height: 1.6;
}

.share-error-panel h2 {
  margin: 0 0 12px;
  color: #3d3229;
  font-size: 14px;
  line-height: 1.5;
}

@media (max-width: 420px) {
  .share-error-page {
    padding: 16px;
  }

  .share-error-panel {
    padding: 24px 20px;
  }
}
</style>
