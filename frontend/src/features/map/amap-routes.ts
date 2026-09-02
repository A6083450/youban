import type { TripPlan } from '@/features/result/model'
import type { MapAttraction, RouteMode, RoutePoint } from './model'
import { buildArcPath, detectRouteMode, extractRoutePath, ROUTE_STYLE_PRESETS } from './model'
import { getPublicRuntimeSettings } from '@/services/v2'

let cachedRestKey: string | null = null
let lastRestCallAt = 0
let pluginFailures = 0
const segmentCache = new Map<string, RoutePoint[]>()

async function getRestKey(): Promise<string> {
  if (cachedRestKey !== null)
    return cachedRestKey
  try {
    cachedRestKey = (await getPublicRuntimeSettings()).vite_amap_web_key || ''
  }
  catch {
    cachedRestKey = ''
  }
  return cachedRestKey
}

function searchPluginRoute(
  AMap: any,
  mode: Exclude<RouteMode, 'straight'>,
  start: RoutePoint,
  end: RoutePoint,
): Promise<RoutePoint[] | null> {
  return new Promise((resolve) => {
    const Service = mode === 'walking' ? AMap.Walking : AMap.Driving
    if (!Service) {
      resolve(null)
      return
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (path: RoutePoint[] | null) => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      resolve(path)
    }
    timer = setTimeout(() => finish(null), 4000)
    const service = mode === 'driving'
      ? new Service({ policy: AMap.DrivingPolicy?.LEAST_TIME ?? 0 })
      : new Service({})
    service.search(start, end, (status: string, result: any) => {
      const path = status === 'complete' ? extractRoutePath(result) : []
      finish(path.length > 1 ? path : null)
    })
  })
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function searchRestRoute(
  mode: Exclude<RouteMode, 'straight'>,
  start: RoutePoint,
  end: RoutePoint,
  attempt = 0,
): Promise<RoutePoint[] | null> {
  const key = await getRestKey()
  if (!key)
    return null
  const requestGap = lastRestCallAt + 380 - Date.now()
  if (requestGap > 0)
    await wait(requestGap)
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
      return null
    }
    const path: RoutePoint[] = []
    for (const step of data?.route?.paths?.[0]?.steps || []) {
      for (const pair of String(step?.polyline || '').split(';')) {
        const [longitude, latitude] = pair.split(',').map(Number)
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude))
          continue
        const previous = path.at(-1)
        if (!previous || previous[0] !== longitude || previous[1] !== latitude)
          path.push([longitude, latitude])
      }
    }
    return path.length > 1 ? path : null
  }
  catch {
    return null
  }
}

export function resetAmapRouteCache(): void {
  cachedRestKey = null
  lastRestCallAt = 0
  pluginFailures = 0
  segmentCache.clear()
}

export async function drawAmapRoutes(options: {
  AMap: any
  map: any
  plan: TripPlan
  attractions: MapAttraction[]
  isCurrent: () => boolean
}): Promise<any[]> {
  const { AMap, map, plan, attractions, isCurrent } = options
  const dayGroups = new Map<number, MapAttraction[]>()
  for (const attraction of attractions) {
    const group = dayGroups.get(attraction.dayIndex) || []
    group.push(attraction)
    dayGroups.set(attraction.dayIndex, group)
  }

  const polylines: any[] = []
  for (const [dayIndex, dayAttractions] of dayGroups) {
    dayAttractions.sort((left, right) => left.attractionIndex - right.attractionIndex)
    const preferredMode = detectRouteMode(plan.days[dayIndex]?.transportation || '')
    const stops: RoutePoint[] = dayAttractions.map(item => [item.longitude, item.latitude])
    const hotelLocation = plan.days[dayIndex]?.hotel?.location
    if (hotelLocation && Number.isFinite(hotelLocation.longitude) && Number.isFinite(hotelLocation.latitude)) {
      const hotelPoint: RoutePoint = [hotelLocation.longitude, hotelLocation.latitude]
      stops.unshift(hotelPoint)
      stops.push(hotelPoint)
    }

    for (let index = 0; index < stops.length - 1; index += 1) {
      if (!isCurrent())
        return []
      const start = stops[index]
      const end = stops[index + 1]
      const cacheKey = `${preferredMode}:${start.join(',')}|${end.join(',')}`
      let path = segmentCache.get(cacheKey) || null
      if (!path && pluginFailures < 2) {
        path = await searchPluginRoute(AMap, preferredMode, start, end)
        pluginFailures = path ? 0 : pluginFailures + 1
      }
      if (!path)
        path = await searchRestRoute(preferredMode, start, end)
      if (path)
        segmentCache.set(cacheKey, path)

      const planned = Boolean(path && path.length > 1)
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
  if (polylines.length && isCurrent())
    map.add(polylines)
  return polylines
}
