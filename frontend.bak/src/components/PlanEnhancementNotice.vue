<template>
  <section v-if="!dismissed && noticeMessage" class="plan-enhancement-notice" role="status" aria-live="polite">
    <a-spin v-if="isWorking" size="small" class="plan-enhancement-notice__spinner" />
    <span class="plan-enhancement-notice__message">{{ noticeMessage }}</span>
    <button
      v-if="isTerminal"
      type="button"
      class="plan-enhancement-notice__dismiss"
      :aria-label="t('result.enhancement.dismiss')"
      :title="t('result.enhancement.dismiss')"
      @click="dismiss"
    >
      <CloseOutlined aria-hidden="true" />
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CloseOutlined } from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import type { PlanEnhancementStatus } from '@/types'

const props = defineProps<{
  status: PlanEnhancementStatus
}>()

const { t } = useI18n()
const dismissed = ref(false)
const TERMINAL_STATUSES = new Set<PlanEnhancementStatus>(['completed', 'failed', 'skipped'])
const isTerminal = computed(() => TERMINAL_STATUSES.has(props.status))
const isWorking = computed(() => props.status === 'pending' || props.status === 'running')

const noticeMessage = computed(() => {
  switch (props.status) {
    case 'pending':
    case 'running':
      return t(
        'result.enhancement.inProgress',
        '为了减少等待，已先为你生成快速版计划。你可以立即查看，游伴正在补充更详细的信息。',
      )
    case 'completed':
      return t('result.enhancement.completed', '计划细节已补充完成。')
    case 'failed':
      return t(
        'result.enhancement.failed',
        '当前计划可以正常使用，部分实时信息暂未补充，你可以稍后重试。',
      )
    case 'skipped':
      return t('result.enhancement.skipped', '已保留你的修改，后台补充内容没有覆盖当前计划。')
  }
})

const dismiss = () => {
  if (isTerminal.value) dismissed.value = true
}
</script>

<style scoped>
.plan-enhancement-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 2px 0 14px;
  padding: 4px 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.plan-enhancement-notice__spinner {
  flex: 0 0 auto;
  margin-top: 3px;
}

.plan-enhancement-notice__message {
  min-width: 0;
}

.plan-enhancement-notice__dismiss {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  margin: -1px 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.plan-enhancement-notice__dismiss:hover {
  color: var(--text-primary);
}
</style>
