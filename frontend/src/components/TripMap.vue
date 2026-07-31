<template>
  <div ref="rootRef" class="right-map">
    <a-card id="map" :bordered="false" class="map-card section-shellless">
      <div id="amap-container" ref="containerRef"></div>
      <transition name="map-loading-fade">
        <div v-if="mapLoading" class="map-loading-mask">
          <div class="map-loading-spinner" aria-hidden="true">
            <span class="map-loading-spinner__ring"></span>
            <span class="map-loading-spinner__pin"></span>
          </div>
          <transition name="map-loading-text" mode="out-in">
            <div :key="mapLoadingText" class="map-loading-text">{{ mapLoadingText }}</div>
          </transition>
        </div>
      </transition>
      <div v-if="tripPlan.days.length > 1" class="map-day-legend">
        <span v-for="(_, dayIndex) in tripPlan.days" :key="dayIndex" class="map-day-legend__item">
          <span
            class="map-day-legend__dot"
            :style="{ backgroundColor: getMapDayColor(dayIndex + 1) }"
          ></span>
          {{ t('result.mapInfo.dayTitle', { day: dayIndex + 1 }) }}
        </span>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import AMapLoader from '@amap/amap-jsapi-loader'
import html2canvas from 'html2canvas'
import type { TripPlan } from '@/types'
import {
  getBackendRuntimeSettings,
  getRuntimeMapJsKey,
  RUNTIME_SETTINGS_UPDATED_EVENT,
} from '@/services/api'
import { getMapDayColor, renderTripPlanOnAmap } from '@/map/amapOverlays'
import { resetAmapRouteCache } from '@/map/amapRoutes'
import '@/styles/trip-map.css'

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string }
  }
}

const props = defineProps<{
  tripPlan: TripPlan
  active: boolean
}>()

const { t } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const containerRef = ref<HTMLElement | null>(null)
const mapLoading = ref(false)
const mapLoadingText = ref('')

let map: any = null
let initialization: Promise<void> | null = null
let generation = 0

const destroyMap = (): void => {
  generation += 1
  initialization = null
  if (!map) return
  try {
    map.destroy()
  } catch (error: unknown) {
    console.warn('地图实例清理失败:', error)
  }
  map = null
}

const initAMap = async (targetGeneration: number): Promise<void> => {
  mapLoading.value = true
  mapLoadingText.value = t('result.mapInfo.loadingMap')

  try {
    const mapJsKey = getRuntimeMapJsKey() || (await getBackendRuntimeSettings()).vite_amap_web_js_key
    if (!mapJsKey) {
      mapLoading.value = false
      message.warning('请先在设置中配置高德地图 JS Key')
      return
    }

    if (!window._AMapSecurityConfig?.securityJsCode) {
      window._AMapSecurityConfig = { securityJsCode: 'tripstar-placeholder' }
    }

    const AMap = await AMapLoader.load({
      key: mapJsKey,
      version: '2.0',
      plugins: ['AMap.Marker', 'AMap.Polyline', 'AMap.InfoWindow', 'AMap.Driving', 'AMap.Walking'],
    })

    if (targetGeneration !== generation || !props.active || !containerRef.value) return

    const targetMap = new AMap.Map('amap-container', {
      zoom: 12,
      center: [116.397128, 39.916527],
      viewMode: '3D',
      mapStyle: 'amap://styles/normal',
      WebGLParams: { preserveDrawingBuffer: true },
    })
    map = targetMap

    // Base-map readiness is independent from marker and route enhancement.
    mapLoading.value = false
    void renderTripPlanOnAmap({
      AMap,
      map: targetMap,
      plan: props.tripPlan,
      copy: {
        noData: t('common.noData'),
        minuteUnit: t('result.minuteUnit'),
        dayAttraction: (day, index) => t('result.mapInfo.dayAttraction', { day, index }),
        hotelLabel: (day) => t('result.mapInfo.hotelLabel', { day }),
      },
      isCurrent: () => targetGeneration === generation && map === targetMap,
    }).catch((error: unknown) => {
      if (targetGeneration === generation) {
        console.error('地图标注/路线绘制失败:', error)
      }
    })
  } catch (error: unknown) {
    if (targetGeneration !== generation) return
    mapLoading.value = false
    console.error('地图加载失败:', error)
    message.error(t('result.messages.mapLoadFailed'))
  }
}

const ensureMapReady = async (): Promise<void> => {
  await nextTick()
  if (!props.active) return
  if (map) {
    if (typeof map.resize === 'function') map.resize()
    return
  }
  if (!initialization) {
    const targetGeneration = generation
    initialization = initAMap(targetGeneration)
  }
  const task = initialization
  await task
  if (initialization === task) initialization = null
}

const reloadMap = (): void => {
  resetAmapRouteCache()
  destroyMap()
  if (props.active) void ensureMapReady()
}

const captureScreenshot = async (): Promise<string> => {
  const root = rootRef.value
  const container = containerRef.value
  if (!root || !container || (container.clientHeight === 0 && props.active)) return ''

  const previousDisplay = root.style.display
  const previousPosition = root.style.position
  if (getComputedStyle(root).display === 'none') {
    root.style.display = 'block'
    root.style.position = 'absolute'
    await nextTick()
    if (map && typeof map.resize === 'function') map.resize()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
  }

  try {
    const canvas = await html2canvas(container, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#f8f5f0',
      scale: 1.5,
      logging: false,
      ignoreElements: (element) =>
        typeof element.className === 'string' && element.className.includes('amap-controls'),
    })
    return canvas.toDataURL('image/png')
  } catch (error: unknown) {
    console.warn('地图截图失败，导出将不包含地图:', error)
    return ''
  } finally {
    root.style.display = previousDisplay
    root.style.position = previousPosition
  }
}

watch(
  () => props.active,
  (active) => {
    if (active) void ensureMapReady()
  },
)

watch(
  () => props.tripPlan,
  () => {
    reloadMap()
  },
  { deep: true },
)

onMounted(() => {
  window.addEventListener(RUNTIME_SETTINGS_UPDATED_EVENT, reloadMap)
  if (props.active) void ensureMapReady()
})

onUnmounted(() => {
  window.removeEventListener(RUNTIME_SETTINGS_UPDATED_EVENT, reloadMap)
  destroyMap()
})

defineExpose({ captureScreenshot })
</script>
