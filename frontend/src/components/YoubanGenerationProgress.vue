<script setup lang="ts">
import type { TripTaskDetailDto, TripTaskStageDto } from '@youban/contracts'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import YoubanGenerationLoader from '@/components/YoubanGenerationLoader.vue'

interface ProgressStep {
  key: string
  title: string
  content?: string
  status: 'done' | 'active'
}

const props = withDefaults(defineProps<{
  message: string
  progress: number
  stage: TripTaskStageDto
  details: TripTaskDetailDto[]
  compact?: boolean
}>(), {
  compact: false,
})

const { t } = useI18n()
const expanded = ref(true)
const timelineTarget = ref('')
const timelineBottomAnchors = ['generation-progress-bottom-a', 'generation-progress-bottom-b'] as const
const collapsedCount = 2
const stageOrder: TripTaskStageDto[] = [
  'submitted',
  'initializing',
  'attraction_search',
  'weather_search',
  'hotel_search',
  'planning',
  'reviewing',
  'graph_building',
  'completed',
]

const safeProgress = computed(() => Math.max(0, Math.min(100, Number(props.progress) || 0)))
const currentStageIndex = computed(() => Math.max(0, stageOrder.indexOf(props.stage)))
const stageChips = computed(() => stageOrder.map((stage, index) => ({
  stage,
  label: t(`generationProgress.stages.${stage}`),
  status: index < currentStageIndex.value ? 'done' : index === currentStageIndex.value ? 'active' : 'pending',
})))

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== 'string')
    return ''
  const printable = Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character
  }).join('')
  return printable.replace(/\s+/g, ' ').trim().slice(0, limit)
}

function stripMarkdown(raw: string): string {
  const output: string[] = []
  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    let line = rawLine.trim()
    if (!line || /^[\s:|-]+$/.test(line) || /^\*{3,}$/.test(line))
      continue
    line = line.replace(/^#{1,6}\s*/, '')
    if (line.includes('|'))
      line = line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()).filter(Boolean).join('，')
    line = line
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.、]\s+/, '')
    if (line)
      output.push(line)
  }
  return cleanText(output.join(' '), 320)
}

const normalizedDetails = computed<TripTaskDetailDto[]>(() => {
  const accepted = new Set<TripTaskDetailDto['type']>([
    'thinking',
    'searching',
    'found',
    'planning',
    'tool_call',
    'info',
  ])
  return (props.details || []).flatMap((detail) => {
    if (!detail || typeof detail !== 'object' || !accepted.has(detail.type))
      return []
    const title = cleanText(detail.title, 160)
    if (!title)
      return []
    const content = detail.type === 'thinking' ? '' : cleanText(detail.content, 2000)
    return [{
      type: detail.type,
      title,
      ...(content ? { content } : {}),
      ...(Number.isFinite(detail.timestamp) ? { timestamp: detail.timestamp } : {}),
    }]
  })
})

const currentThinking = computed(() => {
  const last = normalizedDetails.value.at(-1)
  return last?.type === 'thinking' ? last.title : ''
})

const eventSteps = computed<ProgressStep[]>(() => {
  const steps: ProgressStep[] = []
  for (const detail of normalizedDetails.value) {
    if (!['searching', 'found', 'info'].includes(detail.type))
      continue
    const step: ProgressStep = {
      key: `${detail.type}:${detail.title}`,
      title: detail.title,
      content: detail.content ? stripMarkdown(detail.content) : undefined,
      status: 'done',
    }
    const duplicate = steps.findIndex(item => item.key === step.key)
    if (duplicate >= 0)
      steps.splice(duplicate, 1)
    steps.push(step)
  }
  const running = props.stage !== 'completed' && props.stage !== 'failed'
  if (running && !currentThinking.value && steps.length)
    steps[steps.length - 1] = { ...steps[steps.length - 1], status: 'active' }
  return steps
})

const visibleSteps = computed(() => expanded.value ? eventSteps.value : eventSteps.value.slice(-collapsedCount))

function followTimeline(): void {
  void nextTick().then(() => {
    timelineTarget.value = timelineTarget.value === timelineBottomAnchors[0]
      ? timelineBottomAnchors[1]
      : timelineBottomAnchors[0]
  })
}

watch(
  () => [
    props.stage,
    props.message,
    props.details.length,
    props.details.at(-1)?.title || '',
    props.details.at(-1)?.content || '',
    expanded.value,
  ],
  followTimeline,
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <view class="generation-progress" :class="{ 'generation-progress--compact': compact }">
    <view class="generation-progress__header">
      <YoubanGenerationLoader :message="message" :compact="compact" />
      <view class="generation-progress__bar" aria-hidden="true">
        <view class="generation-progress__fill" :style="{ width: `${safeProgress}%` }" />
      </view>
      <text class="generation-progress__percent">{{ safeProgress }}%</text>
    </view>

    <view class="generation-progress__stages">
      <view
        v-for="item in stageChips"
        :key="item.stage"
        class="generation-progress__stage"
        :class="`generation-progress__stage--${item.status}`"
      >
        <text v-if="item.status === 'done'" class="generation-progress__stage-check">✓</text>
        <view v-else-if="item.status === 'active'" class="generation-progress__spinner generation-progress__spinner--small" />
        <view v-else class="generation-progress__stage-dot" />
        <text>{{ item.label }}</text>
      </view>
    </view>

    <scroll-view
      v-if="visibleSteps.length || currentThinking"
      scroll-y
      class="generation-progress__timeline"
      :scroll-into-view="timelineTarget"
      :scroll-with-animation="true"
    >
      <view v-for="step in visibleSteps" :key="step.key" class="generation-progress__step">
        <view class="generation-progress__step-marker" :class="`generation-progress__step-marker--${step.status}`">
          <view v-if="step.status === 'active'" class="generation-progress__spinner" />
          <text v-else>✓</text>
        </view>
        <view class="generation-progress__step-copy">
          <text class="generation-progress__step-title">{{ step.title }}</text>
          <text v-if="step.content" class="generation-progress__step-content">{{ step.content }}</text>
        </view>
      </view>

      <view v-if="currentThinking" class="generation-progress__step generation-progress__thinking">
        <view class="generation-progress__thinking-dots" aria-hidden="true">
          <text /><text /><text />
        </view>
        <text class="generation-progress__step-title">{{ currentThinking }}</text>
      </view>
      <view :id="timelineBottomAnchors[0]" class="generation-progress__bottom-anchor" />
      <view :id="timelineBottomAnchors[1]" class="generation-progress__bottom-anchor" />
    </scroll-view>

    <button
      v-if="eventSteps.length > collapsedCount"
      class="generation-progress__toggle"
      @click="expanded = !expanded"
    >
      <text>{{ expanded ? t('generationProgress.hideDetails') : t('generationProgress.showDetails') }}</text>
      <text class="generation-progress__toggle-icon" :class="{ expanded }">⌄</text>
    </button>
  </view>
</template>

<style scoped>
.generation-progress {
  box-sizing: border-box;
  width: 100%;
  max-width: 620px;
}

.generation-progress__header {
  padding: 4px 0 12px;
}

.generation-progress__bar {
  width: 100%;
  height: 4px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(100, 80, 60, 0.1);
}

.generation-progress__fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent-primary);
  transition: width 0.6s ease;
}

.generation-progress__percent {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 16px;
  text-align: right;
}

.generation-progress__stages {
  display: flex;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 6px;
}

.generation-progress__stage {
  display: inline-flex;
  box-sizing: border-box;
  min-height: 24px;
  padding: 3px 9px;
  align-items: center;
  border-radius: 999px;
  background: rgba(100, 80, 60, 0.06);
  color: #a89888;
  font-size: 11px;
  gap: 5px;
  line-height: 16px;
  white-space: nowrap;
}

.generation-progress__stage--done {
  background: rgba(58, 156, 122, 0.1);
  color: var(--status-success);
}

.generation-progress__stage--active {
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-weight: 600;
}

.generation-progress__stage-check {
  font-size: 11px;
  font-weight: 800;
}

.generation-progress__stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(100, 80, 60, 0.25);
}

.generation-progress__timeline {
  box-sizing: border-box;
  max-height: 280px;
  padding: 4px 2px;
  border-top: 1px solid var(--border-subtle);
}

.generation-progress__bottom-anchor {
  width: 100%;
  height: 1px;
}

.generation-progress__step {
  position: relative;
  display: flex;
  padding: 9px 0;
  align-items: flex-start;
  gap: 11px;
}

.generation-progress__step-marker {
  position: relative;
  z-index: 1;
  display: flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  flex: 0 0 26px;
  border-radius: 50%;
  background: rgba(58, 156, 122, 0.1);
  color: var(--status-success);
  font-size: 11px;
  font-weight: 800;
}

.generation-progress__step-marker--active {
  background: var(--accent-soft);
  color: var(--accent-strong);
  box-shadow: 0 0 0 3px var(--accent-selected);
}

.generation-progress__step-copy {
  display: flex;
  min-width: 0;
  padding-top: 3px;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.generation-progress__step-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.generation-progress__step-content {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.generation-progress__spinner {
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(217, 119, 87, 0.22);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: generation-progress-spin 0.8s linear infinite;
}

.generation-progress__spinner--small {
  width: 10px;
  height: 10px;
  border-width: 1.5px;
}

.generation-progress__thinking {
  align-items: center;
}

.generation-progress__thinking-dots {
  display: flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  flex: 0 0 26px;
  gap: 3px;
}

.generation-progress__thinking-dots text {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-strong);
  animation: generation-progress-think 1.2s ease-in-out infinite;
}

.generation-progress__thinking-dots text:nth-child(2) {
  animation-delay: 0.2s;
}

.generation-progress__thinking-dots text:nth-child(3) {
  animation-delay: 0.4s;
}

.generation-progress__toggle {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  margin: 6px 0 0;
  padding: 8px 0 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-top: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  gap: 6px;
  line-height: 20px;
}

.generation-progress__toggle::after {
  display: none;
}

.generation-progress__toggle-icon {
  transition: transform 0.2s ease;
}

.generation-progress__toggle-icon.expanded {
  transform: rotate(180deg);
}

.generation-progress--compact .generation-progress__timeline {
  max-height: 240px;
}

@keyframes generation-progress-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes generation-progress-think {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .generation-progress__spinner,
  .generation-progress__thinking-dots text {
    animation: none;
  }
}
</style>
