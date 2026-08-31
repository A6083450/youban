import type { TripHotel, TripPlan } from '@/features/result/model'

export type RouteMode = 'driving' | 'walking' | 'straight'
export type RoutePoint = [number, number]

const MAP_ROUTE_GREEN = '#07C160'
const MAP_DAY_COLORS = ['#D97757', '#3E7CB1', '#5B9A68', '#8961A7', '#B07D3F', '#B85C79', '#4F9A94', '#7A7265']

export const ROUTE_STYLE_PRESETS: Record<
  RouteMode,
  {
    strokeColor: string
    strokeWeight: number
    strokeOpacity: number
    strokeStyle: 'solid' | 'dashed'
    strokeDasharray?: number[]
    lineJoin: 'round'
    lineCap: 'round'
    outlineColor: string
    borderWeight: number
  }
> = {
  driving: {
    strokeColor: MAP_ROUTE_GREEN,
    strokeWeight: 6,
    strokeOpacity: 0.98,
    strokeStyle: 'solid',
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(255, 255, 255, 0.95)',
    borderWeight: 2.8,
  },
  walking: {
    strokeColor: MAP_ROUTE_GREEN,
    strokeWeight: 5.5,
    strokeOpacity: 0.95,
    strokeStyle: 'dashed',
    strokeDasharray: [16, 12],
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(255, 255, 255, 0.95)',
    borderWeight: 2.8,
  },
  straight: {
    strokeColor: MAP_ROUTE_GREEN,
    strokeWeight: 4.5,
    strokeOpacity: 0.95,
    strokeStyle: 'dashed',
    strokeDasharray: [2, 12],
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(255, 255, 255, 0.95)',
    borderWeight: 2,
  },
}

export interface MapAttraction {
  name: string
  address?: string
  visit_duration?: number
  longitude: number
  latitude: number
  dayIndex: number
  attractionIndex: number
  stopNumber: number
}

export interface MapHotel {
  name: string
  address?: string
  price_range?: string
  longitude: number
  latitude: number
  dayIndex: number
  hotel: TripHotel
}

export interface MapProjection {
  attractions: MapAttraction[]
  hotels: MapHotel[]
}

function validCoordinate(longitude: unknown, latitude: unknown): longitude is number {
  return Number.isFinite(longitude) && Number.isFinite(latitude)
}

export function buildMapProjection(plan: TripPlan, selectedDayIndex: number | null): MapProjection {
  const attractions: MapAttraction[] = []
  const hotels: MapHotel[] = []
  const seenHotels = new Set<string>()

  plan.days.forEach((day, dayIndex) => {
    if (selectedDayIndex !== null && selectedDayIndex !== dayIndex)
      return

    day.attractions.forEach((attraction, attractionIndex) => {
      const longitude = attraction.location?.longitude
      const latitude = attraction.location?.latitude
      if (!validCoordinate(longitude, latitude))
        return
      attractions.push({
        name: attraction.name,
        address: attraction.address,
        visit_duration: attraction.visit_duration,
        longitude,
        latitude: latitude as number,
        dayIndex,
        attractionIndex,
        stopNumber: attractionIndex + 1,
      })
    })

    const longitude = day.hotel?.location?.longitude
    const latitude = day.hotel?.location?.latitude
    if (!day.hotel || !validCoordinate(longitude, latitude))
      return
    const coordinateKey = `${longitude},${latitude}`
    if (seenHotels.has(coordinateKey))
      return
    seenHotels.add(coordinateKey)
    hotels.push({
      name: day.hotel.name,
      address: day.hotel.address,
      price_range: day.hotel.price_range,
      longitude,
      latitude: latitude as number,
      dayIndex,
      hotel: day.hotel,
    })
  })

  return { attractions, hotels }
}

export function getMapDayColor(dayNumber: number): string {
  return MAP_DAY_COLORS[(dayNumber - 1) % MAP_DAY_COLORS.length]
}

export function detectRouteMode(transportation: string): Exclude<RouteMode, 'straight'> {
  return /步行|徒步|散步|walk/i.test((transportation || '').toLowerCase()) ? 'walking' : 'driving'
}

export function buildArcPath(start: RoutePoint, end: RoutePoint, segments = 32): RoutePoint[] {
  const [x1, y1] = start
  const [x2, y2] = end
  const latScale = Math.cos(((y1 + y2) / 2) * Math.PI / 180) || 1e-6
  const ux = (x2 - x1) * latScale
  const uy = y2 - y1
  if (Math.hypot(ux, uy) === 0)
    return [start, end]

  const bend = 0.18
  const cx = (x1 + x2) / 2 - (uy * bend) / latScale
  const cy = (y1 + y2) / 2 + ux * bend
  const path: RoutePoint[] = []
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments
    const remaining = 1 - progress
    path.push([
      remaining * remaining * x1 + 2 * remaining * progress * cx + progress * progress * x2,
      remaining * remaining * y1 + 2 * remaining * progress * cy + progress * progress * y2,
    ])
  }
  return path
}

function toRoutePoint(raw: any): RoutePoint | null {
  if (!raw)
    return null
  if (Array.isArray(raw) && raw.length >= 2) {
    const longitude = Number(raw[0])
    const latitude = Number(raw[1])
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null
  }
  if (typeof raw.getLng === 'function' && typeof raw.getLat === 'function') {
    const longitude = Number(raw.getLng())
    const latitude = Number(raw.getLat())
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null
  }
  const longitude = Number(raw.lng ?? raw.longitude)
  const latitude = Number(raw.lat ?? raw.latitude)
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null
}

function parsePolylineString(polyline: string): RoutePoint[] {
  return polyline.split(';').map((pair) => {
    const [longitude, latitude] = pair.split(',').map(Number)
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] as RoutePoint : null
  }).filter((point): point is RoutePoint => point !== null)
}

function dedupeRoutePath(points: RoutePoint[]): RoutePoint[] {
  return points.filter((point, index, array) => index === 0
    || point[0] !== array[index - 1][0]
    || point[1] !== array[index - 1][1])
}

export function extractRoutePath(result: any): RoutePoint[] {
  const route = result?.routes?.[0] || result?.route?.paths?.[0] || result?.route?.routes?.[0]
  if (!route)
    return []
  const points: RoutePoint[] = []
  for (const step of route.steps || []) {
    if (Array.isArray(step?.path)) {
      for (const node of step.path) {
        const point = toRoutePoint(node)
        if (point)
          points.push(point)
      }
    }
    else if (typeof step?.polyline === 'string') {
      points.push(...parsePolylineString(step.polyline))
    }
  }
  if (points.length > 1)
    return dedupeRoutePath(points)
  return typeof route.polyline === 'string' ? dedupeRoutePath(parsePolylineString(route.polyline)) : []
}
