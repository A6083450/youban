export type RouteMode = 'driving' | 'walking' | 'straight'
export type RoutePoint = [number, number]

const MAP_ROUTE_GREEN = '#07C160'

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

export const detectRouteMode = (
  transportation: string,
): Exclude<RouteMode, 'straight'> => {
  const normalized = (transportation || '').toLowerCase()
  if (/(步行|徒步|散步|walk|walking)/i.test(normalized)) return 'walking'
  return 'driving'
}

export const buildArcPath = (
  start: RoutePoint,
  end: RoutePoint,
  segments = 32,
): RoutePoint[] => {
  const [x1, y1] = start
  const [x2, y2] = end
  const latScale = Math.cos(((y1 + y2) / 2) * Math.PI / 180) || 1e-6
  const ux = (x2 - x1) * latScale
  const uy = y2 - y1
  if (Math.hypot(ux, uy) === 0) return [start, end]

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

const toRoutePoint = (raw: any): RoutePoint | null => {
  if (!raw) return null
  if (Array.isArray(raw) && raw.length >= 2) {
    const lng = Number(raw[0])
    const lat = Number(raw[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }
  if (typeof raw.getLng === 'function' && typeof raw.getLat === 'function') {
    const lng = Number(raw.getLng())
    const lat = Number(raw.getLat())
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }
  if ('lng' in raw && 'lat' in raw) {
    const lng = Number(raw.lng)
    const lat = Number(raw.lat)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }
  if ('longitude' in raw && 'latitude' in raw) {
    const lng = Number(raw.longitude)
    const lat = Number(raw.latitude)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }
  return null
}

const parsePolylineString = (polyline: string): RoutePoint[] => polyline
  .split(';')
  .map((pair) => pair.split(','))
  .map((parts) => {
    const lng = Number(parts[0])
    const lat = Number(parts[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  })
  .filter((point): point is RoutePoint => point !== null)

const dedupeRoutePath = (points: RoutePoint[]): RoutePoint[] => points.filter(
  (point, index, array) => index === 0
    || point[0] !== array[index - 1][0]
    || point[1] !== array[index - 1][1],
)

export const extractRoutePath = (result: any): RoutePoint[] => {
  const route = result?.routes?.[0]
    || result?.route?.paths?.[0]
    || result?.route?.routes?.[0]
  if (!route) return []

  const points: RoutePoint[] = []
  for (const step of route.steps || []) {
    if (Array.isArray(step?.path)) {
      for (const node of step.path) {
        const point = toRoutePoint(node)
        if (point) points.push(point)
      }
    } else if (typeof step?.polyline === 'string') {
      points.push(...parsePolylineString(step.polyline))
    }
  }
  if (points.length > 1) return dedupeRoutePath(points)
  if (typeof route.polyline !== 'string') return []

  const routePoints = dedupeRoutePath(parsePolylineString(route.polyline))
  return routePoints.length > 1 ? routePoints : []
}
