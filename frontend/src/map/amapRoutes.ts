import { getBackendRuntimeSettings } from '@/services/api'
import type { TripPlan } from '@/types'
import {
  buildArcPath,
  detectRouteMode,
  extractRoutePath,
  ROUTE_STYLE_PRESETS,
} from './routeGeometry'
import type { RouteMode, RoutePoint } from './routeGeometry'

export type MapAttraction = TripPlan['days'][number]['attractions'][number] & {
  dayIndex: number
  attrIndex: number
  globalIndex: number
}

let cachedRestKey: string | null = null
let lastRestCallAt = 0
let pluginFailures = 0
const segmentCache = new Map<string, RoutePoint[]>()

const getRestKey = async (): Promise<string> => {
  if (cachedRestKey !== null) return cachedRestKey
  try {
    const settings = await getBackendRuntimeSettings()
    cachedRestKey = settings.vite_amap_web_key || ''
  } catch {
    cachedRestKey = ''
  }
  return cachedRestKey
}

const searchPluginRoute = (
  AMap: any,
  mode: Exclude<RouteMode, 'straight'>,
  start: RoutePoint,
  end: RoutePoint,
): Promise<RoutePoint[] | null> => new Promise((resolve) => {
  const Service = mode === 'walking' ? AMap.Walking : AMap.Driving
  if (!Service) {
    resolve(null)
    return
  }

  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = (path: RoutePoint[] | null) => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    resolve(path)
  }
  timer = setTimeout(() => finish(null), 4000)

  const service = mode === 'driving'
    ? new Service({ policy: AMap.DrivingPolicy?.LEAST_TIME ?? 0 })
    : new Service({})
  service.search(start, end, (status: string, result: any) => {
    if (status !== 'complete') {
      finish(null)
      return
    }
    const path = extractRoutePath(result)
    finish(path.length > 1 ? path : null)
  })
})

const wait = (milliseconds: number): Promise<void> => new Promise(
  (resolve) => setTimeout(resolve, milliseconds),
)

const searchRestRoute = async (
  mode: Exclude<RouteMode, 'straight'>,
  start: RoutePoint,
  end: RoutePoint,
  attempt = 0,
): Promise<RoutePoint[] | null> => {
  const key = await getRestKey()
  if (!key) return null

  const requestGap = lastRestCallAt + 380 - Date.now()
  if (requestGap > 0) await wait(requestGap)
  lastRestCallAt = Date.now()

  const url = `https://restapi.amap.com/v3/direction/${mode}`
    + `?origin=${start[0].toFixed(6)},${start[1].toFixed(6)}`
    + `&destination=${end[0].toFixed(6)},${end[1].toFixed(6)}`
    + `&extensions=base&key=${key}`

  try {
    const response = await fetch(url)
    const data = await response.json()
    if (data?.status !== '1') {
      const reason = `${data?.info ?? ''} ${data?.infocode ?? ''}`
      if (attempt < 2 && /qps|exceed|limit|frequen/i.test(reason)) {
        await wait(700 * (attempt + 1))
        return searchRestRoute(mode, start, end, attempt + 1)
      }
      console.warn('高德 REST 路线规划失败:', reason.trim() || data)
      return null
    }

    const steps = data?.route?.paths?.[0]?.steps
    if (!Array.isArray(steps)) return null
    const path: RoutePoint[] = []
    for (const step of steps) {
      for (const pair of String(step?.polyline || '').split(';')) {
        const [lng, lat] = pair.split(',').map(Number)
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
        const previous = path[path.length - 1]
        if (!previous || previous[0] !== lng || previous[1] !== lat) path.push([lng, lat])
      }
    }
    return path.length > 1 ? path : null
  } catch {
    return null
  }
}

export const resetAmapRouteCache = (): void => {
  cachedRestKey = null
  lastRestCallAt = 0
  pluginFailures = 0
  segmentCache.clear()
}

export const drawAmapRoutes = async (options: {
  AMap: any
  map: any
  plan: TripPlan
  attractions: MapAttraction[]
  isCurrent: () => boolean
}): Promise<any[]> => {
  const { AMap, map, plan, attractions, isCurrent } = options
  const dayGroups: Record<number, MapAttraction[]> = {}
  for (const attraction of attractions) {
    dayGroups[attraction.dayIndex] ||= []
    dayGroups[attraction.dayIndex].push(attraction)
  }

  const polylines: any[] = []
  for (const dayAttractions of Object.values(dayGroups)) {
    dayAttractions.sort((left, right) => left.attrIndex - right.attrIndex)
    const dayIndex = dayAttractions[0]?.dayIndex
    if (dayIndex === undefined) continue

    const preferredMode = detectRouteMode(plan.days[dayIndex]?.transportation || '')
    const stops: RoutePoint[] = dayAttractions.map((attraction) => [
      attraction.location.longitude,
      attraction.location.latitude,
    ])
    const hotelLocation = plan.days[dayIndex]?.hotel?.location
    if (hotelLocation?.longitude && hotelLocation?.latitude) {
      const hotelPoint: RoutePoint = [hotelLocation.longitude, hotelLocation.latitude]
      stops.unshift(hotelPoint)
      stops.push(hotelPoint)
    }

    for (let index = 0; index < stops.length - 1; index += 1) {
      if (!isCurrent()) return []
      const start = stops[index]
      const end = stops[index + 1]
      const cacheKey = `${preferredMode}:${start.join(',')}|${end.join(',')}`
      let path = segmentCache.get(cacheKey) ?? null

      if (!path && pluginFailures < 2) {
        path = await searchPluginRoute(AMap, preferredMode, start, end)
        pluginFailures = path ? 0 : pluginFailures + 1
      }
      if (!path) path = await searchRestRoute(preferredMode, start, end)
      if (path) segmentCache.set(cacheKey, path)

      const planned = path !== null && path.length > 1
      const styleMode: RouteMode = planned ? preferredMode : 'straight'
      polylines.push(new AMap.Polyline({
        path: planned ? path : buildArcPath(start, end),
        ...ROUTE_STYLE_PRESETS[styleMode],
        isOutline: true,
        showDir: planned,
        zIndex: planned ? 90 : 88,
      }))
    }
  }

  if (polylines.length > 0 && isCurrent()) map.add(polylines)
  return polylines
}
