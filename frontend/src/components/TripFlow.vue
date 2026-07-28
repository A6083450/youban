<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowRightOutlined,
  BulbOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import type { TripPlan, TripBlueprintStage } from '@/types'
import { resolveTripBlueprint } from '@/utils/tripPresentation.js'

const props = defineProps<{ tripPlan: TripPlan }>()
const emit = defineEmits<{ (event: 'select-day', dayArrayIndex: number): void }>()
const { t } = useI18n()

const blueprint = computed(() => resolveTripBlueprint(props.tripPlan))

const selectStage = (dayIndex: number | undefined) => {
  if (dayIndex === undefined) return
  const arrayIndex = props.tripPlan.days.findIndex((day) => day.day_index === dayIndex)
  if (arrayIndex >= 0) emit('select-day', arrayIndex)
}

const stageDayRange = (stage: TripBlueprintStage): string => {
  const first = stage.day_indices[0]
  const last = stage.day_indices.at(-1)
  if (first === undefined || last === undefined) return ''
  return t('result.blueprint.dayRange', { start: first + 1, end: last + 1 })
}
</script>

<template>
  <section class="trip-blueprint" aria-labelledby="trip-blueprint-title">
    <header class="trip-blueprint__header">
      <p class="trip-blueprint__eyebrow">{{ t('result.blueprint.eyebrow') }}</p>
      <h2 id="trip-blueprint-title">
        {{ blueprint.title || t('result.blueprint.legacyTitle') }}
      </h2>
      <p v-if="blueprint.summary" class="trip-blueprint__summary">
        {{ blueprint.summary }}
      </p>
    </header>

    <div class="trip-blueprint__stages">
      <button
        v-for="(stage, index) in blueprint.stages"
        :key="`${stage.day_indices.join('-')}-${index}`"
        type="button"
        class="trip-blueprint__stage"
        @click="selectStage(stage.day_indices[0])"
      >
        <span class="trip-blueprint__stage-topline">
          <span class="trip-blueprint__stage-number">
            {{ String(index + 1).padStart(2, '0') }}
          </span>
          <span class="trip-blueprint__day-range">{{ stageDayRange(stage) }}</span>
        </span>
        <strong>{{ stage.title || stage.cities.join(' / ') }}</strong>
        <span v-if="stage.theme" class="trip-blueprint__theme">{{ stage.theme }}</span>
        <p v-if="stage.rationale" class="trip-blueprint__rationale">
          {{ stage.rationale }}
        </p>
        <span v-if="stage.highlights.length" class="trip-blueprint__highlights">
          <span v-for="highlight in stage.highlights" :key="highlight">
            {{ highlight }}
          </span>
        </span>
        <span v-if="stage.transition" class="trip-blueprint__transition">
          <ArrowRightOutlined aria-hidden="true" />
          {{ stage.transition }}
        </span>
      </button>
    </div>

    <div v-if="blueprint.logic" class="trip-blueprint__insight">
      <BulbOutlined aria-hidden="true" />
      <div>
        <strong>{{ t('result.blueprint.planningLogic') }}</strong>
        <p>{{ blueprint.logic }}</p>
      </div>
    </div>

    <div v-if="blueprint.pace" class="trip-blueprint__pace">
      <EnvironmentOutlined aria-hidden="true" />
      <span>{{ blueprint.pace }}</span>
    </div>
  </section>
</template>

<style scoped>
.trip-blueprint {
  display: grid;
  gap: 24px;
  min-inline-size: 0;
  padding: 4px;
  color: var(--text-primary);
}

.trip-blueprint__header {
  max-inline-size: 720px;
}

.trip-blueprint__eyebrow {
  margin: 0 0 8px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.trip-blueprint__header h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.trip-blueprint__summary {
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.7;
  text-wrap: pretty;
}

.trip-blueprint__stages {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: 0;
  border-block: 1px solid var(--border-subtle);
}

.trip-blueprint__stage {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-inline-size: 0;
  padding: 18px 20px 20px;
  border: 0;
  border-block-start: 3px solid var(--accent-primary);
  border-inline-end: 1px solid var(--border-subtle);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
  overflow-wrap: break-word;
  word-break: auto-phrase;
  text-wrap: pretty;
}

.trip-blueprint__stage:hover {
  background: var(--surface-soft);
}

.trip-blueprint__stage:last-child {
  border-inline-end: 0;
}

.trip-blueprint__stage:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.trip-blueprint__stage-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.trip-blueprint__stage-number {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}

.trip-blueprint__day-range {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.trip-blueprint__stage strong {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
}

.trip-blueprint__theme {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.trip-blueprint__rationale {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.trip-blueprint__highlights {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.trip-blueprint__highlights > span {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--surface-soft);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.trip-blueprint__transition {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-block-start: auto;
  padding-block-start: 8px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.trip-blueprint__transition :deep(svg) {
  flex: 0 0 auto;
  margin-block-start: 3px;
  color: var(--accent-primary);
}

.trip-blueprint__insight,
.trip-blueprint__pace {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 0;
  border-block: 1px solid var(--border-subtle);
}

.trip-blueprint__insight :deep(svg),
.trip-blueprint__pace :deep(svg) {
  flex: 0 0 auto;
  margin-block-start: 3px;
  color: var(--accent-primary);
  font-size: 16px;
}

.trip-blueprint__insight strong {
  font-size: 13px;
  font-weight: 700;
}

.trip-blueprint__insight p,
.trip-blueprint__pace span {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .trip-blueprint {
    gap: 20px;
  }

  .trip-blueprint__stages {
    grid-template-columns: 1fr;
    border-block: 0;
  }

  .trip-blueprint__header h2 {
    font-size: 20px;
  }

  .trip-blueprint__stage {
    padding: 8px 0 20px 16px;
    border-block-start: 0;
    border-inline-end: 0;
    border-inline-start: 2px solid var(--accent-primary);
    border-block-end: 1px solid var(--border-subtle);
  }

  .trip-blueprint__stage:last-child {
    border-block-end: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trip-blueprint__stage {
    transition: none;
  }
}
</style>
