<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripPlan } from '@/types'
import { buildTripGraph, buildGraphOption } from '@/utils/tripGraph.js'

const props = defineProps<{ tripPlan: TripPlan; active: boolean }>()
const emit = defineEmits<{ (event: 'select-day', dayArrayIndex: number): void }>()
const { t } = useI18n()

const containerRef = ref<HTMLElement | null>(null)
const hasDays = computed(() => (props.tripPlan?.days?.length ?? 0) > 0)
// t 依赖 locale，语言切换时自动重算；tripPlan 变化（Agent 编辑）同样触发
const option = computed(() => (hasDays.value ? buildGraphOption(buildTripGraph(props.tripPlan, t)) : null))

let chart: import('echarts/core').ECharts | null = null
let initialization: Promise<void> | null = null

const ensureChartReady = async (): Promise<void> => {
  if (!props.active || !hasDays.value) return
  await nextTick()
  if (chart) {
    chart.resize()
    return
  }
  if (!initialization) {
    initialization = (async () => {
      const [core, charts, components, renderers] = await Promise.all([
        import('echarts/core'),
        import('echarts/charts'),
        import('echarts/components'),
        import('echarts/renderers'),
      ])
      core.use([
        charts.GraphChart,
        components.TooltipComponent,
        components.LegendComponent,
        renderers.CanvasRenderer,
      ])
      if (!containerRef.value || chart) return
      chart = core.init(containerRef.value)
      chart.on('click', (params) => {
        const data = params.data as { lane?: string; arrayIndex?: number }
        if (params.dataType === 'node' && data?.lane === 'day' && typeof data.arrayIndex === 'number') {
          emit('select-day', data.arrayIndex)
        }
      })
      if (option.value) chart.setOption(option.value)
    })()
  }
  try {
    await initialization
  } finally {
    initialization = null
  }
}

watch(() => props.active, (active) => { if (active) void ensureChartReady() }, { immediate: true })
watch(option, (value) => { if (chart && value) chart.setOption(value, true) })

const handleResize = () => chart?.resize()
onMounted(() => window.addEventListener('resize', handleResize))
onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <section class="trip-graph" :aria-label="t('result.side.graph')">
    <div v-if="!hasDays" class="trip-graph__empty">{{ t('result.graph.empty') }}</div>
    <div v-show="hasDays" ref="containerRef" class="trip-graph__canvas" />
  </section>
</template>

<style scoped>
.trip-graph {
  min-inline-size: 0;
}

.trip-graph__canvas {
  inline-size: 100%;
  block-size: 560px;
}

.trip-graph__empty {
  padding: 48px 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

@media (max-width: 720px) {
  .trip-graph__canvas {
    block-size: 420px;
  }
}
</style>
