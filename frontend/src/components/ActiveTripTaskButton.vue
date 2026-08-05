<template>
  <button
    type="button"
    class="active-task-return"
    @click="emit('activate')"
  >
    <span class="active-task-return__status">
      <LoadingOutlined spin aria-hidden="true" />
      <span>{{ t('sidebar.activeGeneration') }}</span>
    </span>
    <strong class="active-task-return__city">{{ task.city }}</strong>
    <span v-if="dateRange" class="active-task-return__date">{{ dateRange }}</span>
    <span class="active-task-return__action">
      <span>{{ t('sidebar.returnToGeneration') }}</span>
      <ArrowRightOutlined aria-hidden="true" />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRightOutlined, LoadingOutlined } from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import type { ActiveTripTaskRecord } from '@/stores/activeTripTask'

const props = defineProps<{
  readonly task: ActiveTripTaskRecord
}>()

const emit = defineEmits<{ activate: [] }>()
const { t } = useI18n()

const dateRange = computed(() =>
  props.task.startDate && props.task.endDate
    ? `${props.task.startDate} ~ ${props.task.endDate}`
    : '',
)
</script>

<style scoped>
.active-task-return {
  --active-task-background: color-mix(in srgb, var(--accent-strong) 90%, var(--text-primary));
  --active-task-hover-background: color-mix(in srgb, var(--accent-strong) 80%, var(--text-primary));
  width: calc(100% - 24px);
  min-height: 104px;
  margin: 0 12px 14px;
  padding: 13px 14px;
  border: 1px solid var(--accent-primary);
  border-radius: 8px;
  background: var(--active-task-background);
  color: var(--surface-elevated);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--accent-primary) 24%, transparent);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.active-task-return:hover {
  background: var(--active-task-hover-background);
  box-shadow: 0 10px 22px color-mix(in srgb, var(--accent-strong) 28%, transparent);
  transform: translateY(-1px);
}

.active-task-return:active {
  transform: translateY(0);
}

.active-task-return:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 3px;
}

.active-task-return__status,
.active-task-return__action {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 700;
}

.active-task-return__city {
  overflow: hidden;
  font-size: 15px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-task-return__date {
  overflow: hidden;
  color: var(--surface-elevated);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-task-return__action {
  justify-content: space-between;
  margin-top: 3px;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--surface-elevated) 28%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .active-task-return {
    transition: background-color 0.15s ease;
  }

  .active-task-return:hover,
  .active-task-return:active {
    transform: none;
  }

  .active-task-return :deep(.anticon-spin) {
    animation: none;
  }
}
</style>
