import type { TripPlan } from '@/features/result/model'
import { buildMapProjection, getMapDayColor } from './model'
import type { MapAttraction, MapHotel } from './model'
import { drawAmapRoutes } from './amap-routes'

const MAP_PIN_PATH = 'M18 2C9.44 2 2.5 8.94 2.5 17.5c0 3.31 1.04 6.38 2.8 8.9L18 44l12.7-17.6c1.76-2.52 2.8-5.59 2.8-8.9C33.5 8.94 26.56 2 18 2Z'
const MAP_HOTEL_GLYPH = 'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z'
const MAP_VIEW_PADDING = [96, 48, 48, 48]

function fitProjection(AMap: any, map: any, points: Array<{ longitude: number, latitude: number }>): void {
  if (!points.length)
    return
  if (points.length === 1) {
    map.setZoomAndCenter(15, [points[0].longitude, points[0].latitude], true)
    return
  }
  const longitudes = points.map(point => point.longitude)
  const latitudes = points.map(point => point.latitude)
  const bounds = new AMap.Bounds(
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  )
  map.setBounds(bounds, true, MAP_VIEW_PADDING)
  if (map.getZoom() > 15)
    map.setZoom(15, true)
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function markerContent(dayNumber: number, stopNumber: number): string {
  const color = getMapDayColor(dayNumber)
  return `<div class="tripstar-map-pin">
    <svg class="tripstar-map-pin__svg" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="18" cy="44" rx="5" ry="1.8" fill="rgba(61, 50, 41, 0.28)"/>
      <path d="${MAP_PIN_PATH}" fill="${color}" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>
    </svg><span class="tripstar-map-pin__num" style="font-size:${stopNumber >= 10 ? 12 : 14}px">${stopNumber}</span></div>`
}

function hotelMarkerContent(dayNumber: number): string {
  const color = getMapDayColor(dayNumber)
  return `<div class="tripstar-map-pin">
    <svg class="tripstar-map-pin__svg" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="18" cy="44" rx="5" ry="1.8" fill="rgba(61, 50, 41, 0.28)"/>
      <path d="${MAP_PIN_PATH}" fill="#FFFDF9" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
      <g transform="translate(10.8, 10.3) scale(0.6)"><path d="${MAP_HOTEL_GLYPH}" fill="${color}"/></g>
    </svg></div>`
}

interface MapCopy {
  noData: string
  minuteUnit: string
  dayAttraction: (day: number, index: number) => string
  hotelLabel: (day: number) => string
}

function attractionInfo(item: MapAttraction, copy: MapCopy): string {
  const duration = Number.isFinite(item.visit_duration) ? item.visit_duration : '—'
  return `<div class="tripstar-map-tooltip tripstar-map-tooltip--plain">
    <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--day" style="color:${getMapDayColor(item.dayIndex + 1)}">${escapeHtml(copy.dayAttraction(item.dayIndex + 1, item.attractionIndex + 1))}</p>
    <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--title">${escapeHtml(item.name || copy.noData)}</p>
    <p class="tripstar-map-tooltip__line">${escapeHtml(item.address || copy.noData)}</p>
    <p class="tripstar-map-tooltip__line">${duration}${escapeHtml(copy.minuteUnit)}</p></div>`
}

function hotelInfo(item: MapHotel, copy: MapCopy): string {
  return `<div class="tripstar-map-tooltip tripstar-map-tooltip--plain">
    <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--day" style="color:${getMapDayColor(item.dayIndex + 1)}">${escapeHtml(copy.hotelLabel(item.dayIndex + 1))}</p>
    <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--title">${escapeHtml(item.name || copy.noData)}</p>
    <p class="tripstar-map-tooltip__line">${escapeHtml(item.address || copy.noData)}</p>
    ${item.price_range ? `<p class="tripstar-map-tooltip__line">${escapeHtml(item.price_range)}</p>` : ''}</div>`
}

export async function renderTripPlanOnAmap(options: {
  AMap: any
  map: any
  plan: TripPlan
  selectedDayIndex: number | null
  copy: MapCopy
  isCurrent: () => boolean
}): Promise<void> {
  const { AMap, map, plan, selectedDayIndex, copy, isCurrent } = options
  const projection = buildMapProjection(plan, selectedDayIndex)
  const markers: any[] = []

  for (const [index, item] of projection.attractions.entries()) {
    const marker = new AMap.Marker({
      position: [item.longitude, item.latitude],
      content: markerContent(item.dayIndex + 1, item.stopNumber),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, 0),
      zIndex: 120 + index,
    })
    const infoWindow = new AMap.InfoWindow({
      isCustom: true,
      content: attractionInfo(item, copy),
      offset: new AMap.Pixel(0, -52),
      closeWhenClickMap: true,
    })
    marker.on('mouseover', () => infoWindow.open(map, marker.getPosition()))
    marker.on('mouseout', () => infoWindow.close())
    marker.on('click', () => infoWindow.open(map, marker.getPosition()))
    markers.push(marker)
  }

  for (const item of projection.hotels) {
    const marker = new AMap.Marker({
      position: [item.longitude, item.latitude],
      content: hotelMarkerContent(item.dayIndex + 1),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, 0),
      zIndex: 118,
    })
    const infoWindow = new AMap.InfoWindow({
      isCustom: true,
      content: hotelInfo(item, copy),
      offset: new AMap.Pixel(0, -52),
      closeWhenClickMap: true,
    })
    marker.on('mouseover', () => infoWindow.open(map, marker.getPosition()))
    marker.on('mouseout', () => infoWindow.close())
    marker.on('click', () => infoWindow.open(map, marker.getPosition()))
    markers.push(marker)
  }

  if (!isCurrent())
    return
  map.add(markers)
  fitProjection(AMap, map, [...projection.attractions, ...projection.hotels])
  await drawAmapRoutes({ AMap, map, plan, attractions: projection.attractions, isCurrent })
}
