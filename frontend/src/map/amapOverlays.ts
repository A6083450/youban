import type { TripPlan } from '@/types'
import { drawAmapRoutes } from './amapRoutes'
import type { MapAttraction } from './amapRoutes'

const MAP_DAY_COLORS = ['#D97757', '#3E7CB1', '#5B9A68', '#8961A7', '#B07D3F', '#B85C79', '#4F9A94', '#7A7265']
const MAP_PIN_PATH = 'M18 2C9.44 2 2.5 8.94 2.5 17.5c0 3.31 1.04 6.38 2.8 8.9L18 44l12.7-17.6c1.76-2.52 2.8-5.59 2.8-8.9C33.5 8.94 26.56 2 18 2Z'
const MAP_HOTEL_GLYPH = 'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z'
const MAP_VIEW_PADDING = [96, 48, 48, 48]

export const getMapDayColor = (dayNumber: number): string => (
  MAP_DAY_COLORS[(dayNumber - 1) % MAP_DAY_COLORS.length]
)

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const buildMarkerContent = (dayNumber: number, stopNumber: number): string => {
  const color = getMapDayColor(dayNumber)
  const fontSize = stopNumber >= 10 ? 12 : 14
  return `
    <div class="tripstar-map-pin">
      <svg class="tripstar-map-pin__svg" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="18" cy="44" rx="5" ry="1.8" fill="rgba(61, 50, 41, 0.28)"/>
        <path d="${MAP_PIN_PATH}" fill="${color}" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>
      </svg>
      <span class="tripstar-map-pin__num" style="font-size:${fontSize}px" aria-hidden="true">${stopNumber}</span>
    </div>`
}

const buildHotelMarkerContent = (dayNumber: number): string => {
  const color = getMapDayColor(dayNumber)
  return `
    <div class="tripstar-map-pin">
      <svg class="tripstar-map-pin__svg" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="18" cy="44" rx="5" ry="1.8" fill="rgba(61, 50, 41, 0.28)"/>
        <path d="${MAP_PIN_PATH}" fill="#FFFDF9" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
        <g transform="translate(10.8, 10.3) scale(0.6)">
          <path d="${MAP_HOTEL_GLYPH}" fill="${color}"/>
        </g>
      </svg>
    </div>`
}

type MapCopy = {
  noData: string
  minuteUnit: string
  dayAttraction: (day: number, index: number) => string
  hotelLabel: (day: number) => string
}

const buildAttractionInfo = (attraction: MapAttraction, copy: MapCopy): string => {
  const color = getMapDayColor(attraction.dayIndex + 1)
  const duration = Number.isFinite(attraction.visit_duration) ? attraction.visit_duration : '—'
  return `
    <div class="tripstar-map-tooltip tripstar-map-tooltip--plain">
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--day" style="color:${color}">${escapeHtml(copy.dayAttraction(attraction.dayIndex + 1, attraction.attrIndex + 1))}</p>
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--title">${escapeHtml(attraction.name || copy.noData)}</p>
      <p class="tripstar-map-tooltip__line">${escapeHtml(attraction.address || copy.noData)}</p>
      <p class="tripstar-map-tooltip__line">${duration}${escapeHtml(copy.minuteUnit)}</p>
    </div>`
}

const buildHotelInfo = (
  hotel: TripPlan['days'][number]['hotel'],
  dayIndex: number,
  copy: MapCopy,
): string => {
  const color = getMapDayColor(dayIndex + 1)
  const price = escapeHtml(hotel?.price_range || '')
  return `
    <div class="tripstar-map-tooltip tripstar-map-tooltip--plain">
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--day" style="color:${color}">${escapeHtml(copy.hotelLabel(dayIndex + 1))}</p>
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--title">${escapeHtml(hotel?.name || copy.noData)}</p>
      <p class="tripstar-map-tooltip__line">${escapeHtml(hotel?.address || copy.noData)}</p>
      ${price ? `<p class="tripstar-map-tooltip__line">${price}</p>` : ''}
    </div>`
}

export const renderTripPlanOnAmap = async (options: {
  AMap: any
  map: any
  plan: TripPlan
  copy: MapCopy
  isCurrent: () => boolean
}): Promise<void> => {
  const { AMap, map, plan, copy, isCurrent } = options
  const markers: any[] = []
  const attractions: MapAttraction[] = []

  let globalIndex = 0
  plan.days.forEach((day, dayIndex) => {
    day.attractions.forEach((attraction, attrIndex) => {
      globalIndex += 1
      if (!attraction.location?.longitude || !attraction.location?.latitude) return
      attractions.push({ ...attraction, dayIndex, attrIndex, globalIndex })
    })
  })

  for (const [index, attraction] of attractions.entries()) {
    const marker = new AMap.Marker({
      position: [attraction.location.longitude, attraction.location.latitude],
      content: buildMarkerContent(attraction.dayIndex + 1, attraction.attrIndex + 1),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, 0),
      zIndex: 120 + index,
    })
    const infoWindow = new AMap.InfoWindow({
      isCustom: true,
      content: buildAttractionInfo(attraction, copy),
      offset: new AMap.Pixel(0, -52),
      closeWhenClickMap: true,
    })
    marker.on('mouseover', () => infoWindow.open(map, marker.getPosition()))
    marker.on('mouseout', () => infoWindow.close())
    marker.on('click', () => infoWindow.open(map, marker.getPosition()))
    markers.push(marker)
  }

  const seenHotels = new Set<string>()
  plan.days.forEach((day, dayIndex) => {
    const location = day.hotel?.location
    if (!location?.longitude || !location?.latitude) return
    const coordinateKey = `${location.longitude},${location.latitude}`
    if (seenHotels.has(coordinateKey)) return
    seenHotels.add(coordinateKey)

    const marker = new AMap.Marker({
      position: [location.longitude, location.latitude],
      content: buildHotelMarkerContent(dayIndex + 1),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, 0),
      zIndex: 118,
    })
    const infoWindow = new AMap.InfoWindow({
      isCustom: true,
      content: buildHotelInfo(day.hotel, dayIndex, copy),
      offset: new AMap.Pixel(0, -52),
      closeWhenClickMap: true,
    })
    marker.on('mouseover', () => infoWindow.open(map, marker.getPosition()))
    marker.on('mouseout', () => infoWindow.close())
    marker.on('click', () => infoWindow.open(map, marker.getPosition()))
    markers.push(marker)
  })

  if (!isCurrent()) return
  map.add(markers)
  if (attractions.length > 0) {
    map.setFitView(markers, false, MAP_VIEW_PADDING, 15)
  }
  const routes = await drawAmapRoutes({ AMap, map, plan, attractions, isCurrent })
  if (!isCurrent() || attractions.length === 0) return
  map.setFitView(routes.length > 0 ? [...markers, ...routes] : markers, false, MAP_VIEW_PADDING, 15)
}
