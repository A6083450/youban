<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripCheckpointSummary } from '@/types'

const props = withDefaults(defineProps<{
  taskId: string
  city: string
  dateRange?: string
  error: string
  checkpointSummary?: TripCheckpointSummary
  loading?: boolean
}>(), {
  dateRange: '',
  checkpointSummary: undefined,
  loading: false,
})

const emit = defineEmits<{
  retry: []
  'restart-all': []
}>()

const { t, te } = useI18n()

const checkpointStage = computed(() => {
  const stage = props.checkpointSummary?.last_successful_stage
  return stage && te(`tripFailure.stages.${stage}`)
    ? t(`tripFailure.stages.${stage}`)
    : t('tripFailure.unknownStage')
})
</script>

<template>
  <section
    :id="`trip-failure-${taskId}`"
    class="failure-card"
    role="alert"
    tabindex="-1"
    :aria-label="t('tripFailure.title')"
    :aria-busy="loading"
  >
    <h3 class="failure-title">{{ t('tripFailure.title') }}</h3>
    <p class="failure-trip">
      <strong>{{ city }}</strong>
      <span v-if="dateRange"> · {{ dateRange }}</span>
    </p>

    <dl v-if="checkpointSummary" class="failure-progress">
      <div>
        <dt>{{ t('tripFailure.lastStage') }}</dt>
        <dd>{{ checkpointStage }}</dd>
      </div>
      <div>
        <dt>{{ t('tripFailure.completedSegments') }}</dt>
        <dd>{{ checkpointSummary.completed_segments }}/{{ checkpointSummary.total_segments }}</dd>
      </div>
    </dl>

    <p class="failure-error">
      <span>{{ t('tripFailure.errorLabel') }}</span>
      {{ error }}
    </p>

    <div class="failure-actions">
      <button
        type="button"
        class="failure-button primary"
        :disabled="loading"
        :aria-busy="loading"
        @click="emit('retry')"
      >
        {{ loading ? t('tripFailure.retrying') : t('tripFailure.retry') }}
      </button>
      <button
        type="button"
        class="failure-button secondary"
        :disabled="loading"
        :aria-busy="loading"
        @click="emit('restart-all')"
      >
        {{ t('tripFailure.restartAll') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.failure-card {
  width: 100%;
  padding: 18px;
  border: 1px solid rgba(196, 96, 61, 0.32);
  border-radius: var(--card-radius);
  background: linear-gradient(145deg, rgba(255, 250, 247, 0.98), rgba(255, 244, 238, 0.92));
  box-shadow: var(--card-shadow);
  color: #3d3229;
}

.failure-title {
  margin: 0;
  color: #9b462f;
  font-size: 16px;
  font-weight: 750;
}

.failure-trip,
.failure-error {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.55;
}

.failure-progress {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 0;
}

.failure-progress div {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(217, 119, 87, 0.08);
}

.failure-progress dt,
.failure-error span {
  color: #806f62;
  font-size: 12px;
}

.failure-progress dd {
  margin: 3px 0 0;
  font-size: 13px;
  font-weight: 650;
}

.failure-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #5d4e43;
}

.failure-error span {
  margin-right: 4px;
  font-weight: 650;
}

.failure-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.failure-button {
  min-height: 44px;
  padding: 0 18px;
  border-radius: 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.failure-button.primary {
  border: 1px solid #b95537;
  background: #c4603d;
  color: #fff;
}

.failure-button.primary:hover:not(:disabled) {
  background: #ad5034;
}

.failure-button.secondary {
  border: 1px solid rgba(196, 96, 61, 0.45);
  background: #fff;
  color: #9b462f;
}

.failure-button.secondary:hover:not(:disabled) {
  background: rgba(217, 119, 87, 0.08);
}

.failure-button:focus-visible {
  outline: 3px solid rgba(56, 132, 255, 0.5);
  outline-offset: 2px;
}

.failure-button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

@media (max-width: 480px) {
  .failure-progress {
    grid-template-columns: 1fr;
  }

  .failure-actions {
    flex-direction: column;
  }

  .failure-button {
    width: 100%;
  }
}
</style>
