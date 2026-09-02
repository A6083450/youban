<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
// #ifdef H5
import AMapLoader from '@amap/amap-jsapi-loader'
// #endif
import type { TripPlan } from '@/features/result/model'
import {
  amapExportDimensions,
  buildAmapStaticMapUrl,
  drawAmapExportPin,
  loadAmapDataUrl,
  loadAmapStaticMapDataUrl,
  waitForAmapCanvasDataUrl,
  waitForAmapOverlayWindow,
} from '@/features/map/amap-capture'
import { buildArcPath, buildMapProjection, detectRouteMode, getMapDayColor } from '@/features/map/model'
import { resolveH5Element } from '@/features/map/h5-element'
import { getPublicRuntimeSettings } from '@/services/v2'
// #ifdef H5
import { renderTripPlanOnAmap } from '@/features/map/amap-overlays'
import { resetAmapRouteCache } from '@/features/map/amap-routes'
// #endif

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string }
  }
}

const props = withDefaults(defineProps<{
  plan: TripPlan
  active: boolean
  focusDayIndex?: number | null
}>(), { focusDayIndex: null })

const { t } = useI18n()
const selectedDayIndex = ref<number | null>(null)
const userTouchedFilter = ref(false)
const mapLoading = ref(false)
const mapLoadingText = ref('')
const mapNotice = ref('')
const containerRef = ref<HTMLElement | { $el?: HTMLElement } | null>(null)
const projection = computed(() => buildMapProjection(props.plan, selectedDayIndex.value))

const mapCenter = computed(() => {
  const first = projection.value.attractions[0] || projection.value.hotels[0]
  return first
    ? { latitude: first.latitude, longitude: first.longitude }
    : { latitude: 35.8617, longitude: 104.1954 }
})

const nativeMarkers = computed(() => [
  ...projection.value.attractions.map((item, index) => ({
    id: index + 1,
    latitude: item.latitude,
    longitude: item.longitude,
    title: item.name,
    iconPath: '/static/app/icons/40x40.png',
    width: 28,
    height: 28,
    label: {
      content: String(item.stopNumber),
      color: '#ffffff',
      fontSize: 11,
      textAlign: 'center' as const,
      anchorX: -2,
      anchorY: -22,
    },
    callout: {
      content: item.name,
      display: 'BYCLICK' as const,
      padding: 8,
      borderRadius: 6,
      bgColor: '#ffffff',
      color: '#3D3229',
    },
  })),
  ...projection.value.hotels.map((item, index) => ({
    id: 10_000 + index,
    latitude: item.latitude,
    longitude: item.longitude,
    title: item.name,
    iconPath: '/static/app/icons/40x40.png',
    width: 24,
    height: 24,
    callout: {
      content: item.name,
      display: 'BYCLICK' as const,
      padding: 8,
      borderRadius: 6,
      bgColor: '#ffffff',
      color: getMapDayColor(item.dayIndex + 1),
    },
  })),
])

const nativePolylines = computed(() => props.plan.days.flatMap((day, dayIndex) => {
  if (selectedDayIndex.value !== null && selectedDayIndex.value !== dayIndex)
    return []
  const attractions = projection.value.attractions
    .filter(item => item.dayIndex === dayIndex)
    .sort((left, right) => left.attractionIndex - right.attractionIndex)
  const points = attractions.map(item => [item.longitude, item.latitude] as [number, number])
  const hotel = day.hotel?.location
  if (hotel && Number.isFinite(hotel.longitude) && Number.isFinite(hotel.latitude)) {
    points.unshift([hotel.longitude, hotel.latitude])
    points.push([hotel.longitude, hotel.latitude])
  }
  if (points.length < 2)
    return []
  const routePoints = points.slice(0, -1).flatMap((start, index) => {
    const segment = buildArcPath(start, points[index + 1], 12)
    return index ? segment.slice(1) : segment
  })
  const walking = detectRouteMode(day.transportation) === 'walking'
  return [{
    points: routePoints.map(([longitude, latitude]) => ({ longitude, latitude })),
    color: '#07C160',
    width: walking ? 4 : 5,
    dottedLine: walking,
    arrowLine: !walking,
  }]
}))

function chooseDay(dayIndex: number | null): void {
  userTouchedFilter.value = true
  selectedDayIndex.value = selectedDayIndex.value === dayIndex ? null : dayIndex
}

let map: any = null
let amapLib: any = null
let amapRestKey = ''
let initialization: Promise<void> | null = null
let overlayRendering: Promise<void> | null = null
let generation = 0
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function showMapNotice(message: string): void {
  mapNotice.value = message
  if (noticeTimer)
    clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    mapNotice.value = ''
  }, 3000)
}

function destroyMap(): void {
  generation += 1
  initialization = null
  overlayRendering = null
  if (!map)
    return
  try {
    map.destroy()
  }
  catch (error) {
    console.warn('地图实例清理失败:', error)
  }
  map = null
  amapLib = null
}

// #ifdef H5
function renderCurrentPlan(AMap: any, targetMap: any, targetGeneration: number): void {
  const task = renderTripPlanOnAmap({
    AMap,
    map: targetMap,
    plan: props.plan,
    selectedDayIndex: selectedDayIndex.value,
    copy: {
      noData: t('common.noData'),
      minuteUnit: t('result.minuteUnit'),
      dayAttraction: (day, index) => t('result.mapInfo.dayAttraction', { day, index }),
      hotelLabel: day => t('result.mapInfo.hotelLabel', { day }),
    },
    isCurrent: () => targetGeneration === generation && map === targetMap,
  }).catch((error) => {
    if (targetGeneration === generation)
      console.error('地图标注/路线绘制失败:', error)
  })
  overlayRendering = task
  void task.finally(() => {
    if (overlayRendering === task)
      overlayRendering = null
  })
}

function waitForAmapComplete(targetMap: any): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      targetMap.off?.('complete', finish)
      resolve()
    }
    targetMap.on?.('complete', finish)
    timer = setTimeout(finish, 4000)
  })
}

async function initAMap(targetGeneration: number): Promise<void> {
  mapLoading.value = true
  mapLoadingText.value = t('result.mapInfo.loadingMap')
  try {
    const settings = await getPublicRuntimeSettings()
    amapRestKey = settings.vite_amap_web_key || ''
    if (!settings.vite_amap_web_js_key) {
      mapLoading.value = false
      showMapNotice(t('result.mapInfo.keyMissing'))
      return
    }
    if (!window._AMapSecurityConfig?.securityJsCode)
      window._AMapSecurityConfig = { securityJsCode: 'tripstar-placeholder' }
    const AMap = await AMapLoader.load({
      key: settings.vite_amap_web_js_key,
      version: '2.0',
      plugins: ['AMap.Marker', 'AMap.Polyline', 'AMap.InfoWindow', 'AMap.Driving', 'AMap.Walking'],
    })
    amapLib = AMap
    if (targetGeneration !== generation || !props.active || !containerRef.value)
      return
    const targetMap = new AMap.Map('amap-container', {
      zoom: 12,
      center: [116.397128, 39.916527],
      viewMode: '3D',
      mapStyle: 'amap://styles/normal',
      WebGLParams: { preserveDrawingBuffer: true },
    })
    map = targetMap
    await waitForAmapComplete(targetMap)
    if (targetGeneration !== generation || !props.active || map !== targetMap)
      return
    mapLoading.value = false
    renderCurrentPlan(AMap, targetMap, targetGeneration)
  }
  catch (error) {
    if (targetGeneration !== generation)
      return
    mapLoading.value = false
    console.error('地图加载失败:', error)
    showMapNotice(t('result.messages.mapLoadFailed'))
  }
}

async function ensureMapReady(): Promise<void> {
  await nextTick()
  if (!props.active)
    return
  if (map) {
    map.resize?.()
    return
  }
  if (!initialization)
    initialization = initAMap(generation)
  const task = initialization
  await task
  if (initialization === task)
    initialization = null
}

function reloadMap(): void {
  resetAmapRouteCache()
  destroyMap()
  if (props.active)
    void ensureMapReady()
}
// #endif

async function captureScreenshot(): Promise<string> {
  // #ifdef H5
  await ensureMapReady()
  const container = resolveH5Element(containerRef.value)
  if (!container)
    return ''
  const rendering = overlayRendering
  if (rendering)
    await waitForAmapOverlayWindow(rendering)
  let mapCanvasDataUrl = await waitForAmapCanvasDataUrl(container)
  let usingStaticMap = false
  if (!mapCanvasDataUrl && amapRestKey) {
    const staticMarkers = [
      ...projection.value.attractions.map(item => ({
        longitude: item.longitude,
        latitude: item.latitude,
        color: getMapDayColor(item.dayIndex + 1),
        label: String(item.stopNumber),
      })),
      ...projection.value.hotels.map(item => ({
        longitude: item.longitude,
        latitude: item.latitude,
        color: getMapDayColor(item.dayIndex + 1),
        label: 'H',
      })),
    ]
    const staticPaths = props.plan.days.map((_, dayIndex) => {
      const attractions = projection.value.attractions
        .filter(item => item.dayIndex === dayIndex)
        .sort((left, right) => left.attractionIndex - right.attractionIndex)
      const points: Array<[number, number]> = attractions.map(item => [item.longitude, item.latitude])
      const hotel = projection.value.hotels.find(item => item.dayIndex === dayIndex)
      if (hotel) {
        points.unshift([hotel.longitude, hotel.latitude])
        points.push([hotel.longitude, hotel.latitude])
      }
      return { color: getMapDayColor(dayIndex + 1), points }
    })
    try {
      mapCanvasDataUrl = await loadAmapStaticMapDataUrl(buildAmapStaticMapUrl({
        key: amapRestKey,
        width: 936,
        height: 713,
        markers: staticMarkers,
        paths: staticPaths,
      }))
      usingStaticMap = true
    }
    catch {
      mapCanvasDataUrl = ''
    }
  }
  const baseCanvas = container.querySelector<HTMLCanvasElement>('canvas.amap-layer, canvas')
  if (!baseCanvas || !mapCanvasDataUrl)
    return mapCanvasDataUrl
  try {
    const baseImage = await loadAmapDataUrl(mapCanvasDataUrl)
    const dimensions = amapExportDimensions(baseCanvas.width, baseCanvas.height)
    const captureScale = dimensions.scale
    const composite = document.createElement('canvas')
    composite.width = dimensions.width
    composite.height = dimensions.height
    const context = composite.getContext('2d')
    if (!context)
      return mapCanvasDataUrl
    context.drawImage(baseImage, 0, 0, composite.width, composite.height)
    const drawProjectionMarker = (
      item: { longitude: number, latitude: number, dayIndex: number },
      label: string,
      hotel = false,
    ) => {
      const pixel = map?.lngLatToContainer?.([item.longitude, item.latitude])
      const x = Number(pixel?.x ?? pixel?.getX?.())
      const y = Number(pixel?.y ?? pixel?.getY?.())
      if (!Number.isFinite(x) || !Number.isFinite(y))
        return
      drawAmapExportPin(context, {
        x,
        y,
        color: getMapDayColor(item.dayIndex + 1),
        label,
        hotel,
      }, captureScale)
    }
    if (!usingStaticMap) {
      projection.value.attractions.forEach(item => drawProjectionMarker(item, String(item.stopNumber)))
      projection.value.hotels.forEach(item => drawProjectionMarker(item, '', true))
      const copyright = container.querySelector<HTMLElement>('.amap-copyright')?.textContent?.trim() || '© AutoNavi'
      context.fillStyle = 'rgba(255, 255, 255, 0.86)'
      context.fillRect(0, composite.height - 24 * captureScale, 300 * captureScale, 24 * captureScale)
      context.fillStyle = '#3D3229'
      context.font = `${11 * captureScale}px PingFang SC, Microsoft YaHei, sans-serif`
      context.textAlign = 'left'
      context.textBaseline = 'middle'
      context.fillText(`高德地图 ${copyright}`, 8 * captureScale, composite.height - 11 * captureScale)
    }
    return composite.toDataURL('image/png')
  }
  catch {
    return ''
  }
  // #endif
  // #ifndef H5
  return ''
  // #endif
}

watch(() => props.active, (active) => {
  // #ifdef H5
  if (active)
    void ensureMapReady()
  // #endif
})

watch(selectedDayIndex, () => {
  // #ifdef H5
  if (!map || !amapLib)
    return
  resetAmapRouteCache()
  map.clearMap()
  renderCurrentPlan(amapLib, map, generation)
  // #endif
})

watch(() => props.focusDayIndex, (value) => {
  if (value !== null && value !== undefined && !userTouchedFilter.value)
    selectedDayIndex.value = value
})

watch(() => props.plan, () => {
  // #ifdef H5
  reloadMap()
  // #endif
}, { deep: true })

onMounted(() => {
  // #ifdef H5
  if (props.active)
    void ensureMapReady()
  // #endif
})

onUnmounted(() => {
  if (noticeTimer)
    clearTimeout(noticeTimer)
  // #ifdef H5
  destroyMap()
  // #endif
})

defineExpose({ captureScreenshot })
</script>

<template>
  <view class="right-map">
    <view class="map-card">
      <!-- #ifdef H5 -->
      <view id="amap-container" ref="containerRef" class="amap-container" />
      <!-- #endif -->
      <!-- #ifdef MP-WEIXIN -->
      <map class="native-map" :latitude="mapCenter.latitude" :longitude="mapCenter.longitude" :markers="nativeMarkers" :polyline="nativePolylines" :scale="11" show-scale />
      <!-- #endif -->
      <view v-if="mapLoading" class="map-loading-mask">
        <view class="map-loading-spinner">
          <view class="map-loading-spinner__ring" /><view class="map-loading-spinner__pin" />
        </view>
        <text class="map-loading-text">{{ mapLoadingText }}</text>
      </view>
      <view v-if="plan.days.length > 1" class="map-day-legend">
        <button class="map-day-legend__item" :class="{ 'map-day-legend__item--active': selectedDayIndex === null }" @click="chooseDay(null)">
          {{ t('result.mapInfo.allDays') }}
        </button>
        <button v-for="(_, dayIndex) in plan.days" :key="dayIndex" class="map-day-legend__item" :class="{ 'map-day-legend__item--active': selectedDayIndex === dayIndex }" @click="chooseDay(dayIndex)">
          <text class="map-day-legend__dot" :style="{ backgroundColor: getMapDayColor(dayIndex + 1) }" />
          {{ t('result.mapInfo.dayTitle', { day: dayIndex + 1 }) }}
        </button>
      </view>
    </view>
    <view v-if="mapNotice" class="map-notice" role="alert">
      <text class="map-notice__icon">!</text><text>{{ mapNotice }}</text>
    </view>
  </view>
</template>

<style scoped>
.right-map {
  position: relative;
  flex: 1;
  width: 100%;
  height: calc(100vh - 185px);
  height: calc(100dvh - 185px);
  min-height: 520px;
}
.map-card {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  height: 100%;
  min-height: 500px;
  overflow: hidden;
  background: transparent;
}
.amap-container,
.native-map {
  position: absolute;
  width: auto;
  height: auto;
  inset: 1px;
}
.map-day-legend {
  position: absolute;
  z-index: 5;
  top: 13px;
  left: 13px;
  display: flex;
  box-sizing: border-box;
  max-width: calc(100% - 24px);
  padding: 7px 14px;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 14px;
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 14px rgba(61, 50, 41, 0.12);
  pointer-events: none;
  backdrop-filter: blur(8px);
}
.map-day-legend__item {
  display: inline-flex;
  box-sizing: border-box;
  min-height: 24px;
  margin: 0;
  padding: 2px 10px;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: #3d3229;
  font:
    300 12px / 18.8571px -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    'Helvetica Neue',
    Arial,
    'Noto Sans',
    sans-serif;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
}
.map-day-legend__item::after {
  display: none;
}
.map-day-legend__item--active {
  border-color: #c98a2d;
  background: rgba(216, 169, 78, 0.14);
  color: #a8752a;
  font-weight: 600;
}
.map-day-legend__dot {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(61, 50, 41, 0.35);
}
.map-loading-mask {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 18px;
  background: rgba(250, 247, 242, 0.92);
  inset: 0;
  backdrop-filter: blur(6px);
}
.map-loading-spinner {
  position: relative;
  width: 52px;
  height: 52px;
}
.map-loading-spinner__ring {
  position: absolute;
  border: 3px solid rgba(217, 119, 87, 0.18);
  border-top-color: #d97757;
  border-radius: 50%;
  animation: map-loading-rotate 0.9s linear infinite;
  inset: 0;
}
.map-loading-spinner__pin {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  border-radius: 50% 50% 50% 4px;
  background: #d97757;
  box-shadow: inset 0 0 0 4px rgba(255, 255, 255, 0.85);
  transform: translate(-50%, -62%) rotate(-45deg);
}
.map-loading-text {
  color: #8a7d70;
  font-size: 13px;
  font-weight: 500;
}
.map-notice {
  position: fixed;
  z-index: 1000;
  top: 8px;
  left: 50%;
  display: flex;
  min-height: 40px;
  padding: 9px 16px;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
  background: #fff;
  color: rgba(0, 0, 0, 0.88);
  font-size: 14px;
  line-height: 22px;
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.08),
    0 3px 6px -4px rgba(0, 0, 0, 0.12);
  transform: translateX(-50%);
}
.map-notice__icon {
  display: flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #faad14;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}
:deep(.tripstar-map-pin) {
  position: relative;
  width: 36px;
  height: 46px;
  cursor: pointer;
  filter: drop-shadow(0 4px 8px rgba(61, 50, 41, 0.3));
}
:deep(.tripstar-map-pin__svg) {
  display: block;
  width: 100%;
  height: 100%;
}
:deep(.tripstar-map-pin__num) {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  width: 100%;
  height: 35px;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(61, 50, 41, 0.35);
  pointer-events: none;
}
:deep(.tripstar-map-tooltip) {
  max-width: min(320px, calc(100vw - 40px));
  padding: 10px 14px;
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  color: #3d3229;
  box-shadow: 0 10px 28px rgba(61, 50, 41, 0.18);
  pointer-events: none;
}
:deep(.tripstar-map-tooltip__line) {
  margin: 0;
  overflow: hidden;
  color: rgba(61, 50, 41, 0.68);
  font-size: 12px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.tripstar-map-tooltip__line + .tripstar-map-tooltip__line) {
  margin-top: 2px;
}
:deep(.tripstar-map-tooltip__line--day) {
  font-size: 11px;
  font-weight: 700;
}
:deep(.tripstar-map-tooltip__line--title) {
  color: #3d3229;
  font-size: 14px;
  font-weight: 700;
}
:deep(.amap-info-content) {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
:deep(.amap-info-sharp) {
  display: none !important;
}
@keyframes map-loading-rotate {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 768px) {
  .right-map {
    height: calc(100vh - 230px);
    height: calc(100dvh - 230px);
    min-height: 420px;
  }
  .map-day-legend {
    padding: 6px 12px;
    flex-wrap: nowrap;
    gap: 12px;
    overflow-x: auto;
  }
  .map-day-legend__item {
    font-size: 11px;
  }
}
</style>
