import type { ExecutionMapDto, ItemExecutionStatusDto } from '@youban/contracts'
import { t } from '@/locale'

export interface TripLocation {
  longitude: number
  latitude: number
}

export interface TripAttraction {
  id?: string
  poi_id?: string
  name: string
  address?: string
  location?: TripLocation
  visit_duration?: number
  description?: string
  rating?: number
  image_url?: string
  ticket_price?: number
  reservation_required?: boolean
  reservation_tips?: string
  start_time?: string
  end_time?: string
  category?: string
  time_recommendation_basis?: string
  crowd_recommendation_basis?: string
}

export interface TripMeal {
  id?: string
  type?: string
  category?: string
  name: string
  address?: string
  description?: string
  estimated_cost?: number
  time?: string
  location?: TripLocation
  time_recommendation_basis?: string
}

export interface TripHotel {
  name: string
  address?: string
  location?: TripLocation
  price_range?: string
  rating?: string
  distance?: string
  type?: string
  estimated_cost?: number
  source?: string
  source_url?: string
  image_url?: string
  price_status?: 'unavailable' | 'estimated' | 'live'
}

export interface TripDay {
  date: string
  day_index: number
  city?: string
  is_transfer_day?: boolean
  transfer_info?: string
  transfer_time?: string
  description: string
  transportation: string
  accommodation: string
  hotel?: TripHotel
  attractions: TripAttraction[]
  meals: TripMeal[]
}

export interface TripWeather {
  date: string
  city?: string
  day_weather?: string
  night_weather?: string
  day_temp?: number
  night_temp?: number
  wind_direction?: string
  wind_power?: string
}

export interface TripBudget {
  total_attractions: number
  total_hotels: number
  total_meals: number
  total_transportation: number
  total_inter_city_transport?: number
  total_other?: number
  total: number
}

export interface TripBlueprintStage {
  title: string
  cities: string[]
  day_indices: number[]
  theme: string
  rationale: string
  highlights: string[]
  transition: string
}

export interface TripBlueprint {
  title: string
  summary: string
  logic: string
  pace: string
  stages: TripBlueprintStage[]
}

export interface TripPlan {
  city: string
  cities?: Array<string | { city: string, days: number }>
  start_date: string
  end_date: string
  traveler_count?: number
  room_count?: number
  budget_amount?: number | null
  budget_basis?: 'group_total' | 'per_person'
  budget_adjustment_applied?: boolean
  budget_adjustment_note?: string
  days: TripDay[]
  weather_info: TripWeather[]
  overall_suggestions: string
  budget?: TripBudget
  blueprint?: TripBlueprint
}

export interface TripCalendarEvent {
  title: string
  startTime: number
  endTime: string
  allDay: boolean
  description: string
  location: string
}

export interface TodayTimelineItem {
  kind: 'attraction' | 'meal'
  id: string
  name: string
  timeLabel: string
  sortKey: number
  costHint?: number
  category?: string
  description?: string
  status: ItemExecutionStatusDto
}

export type ItineraryDisplayMode = 'day' | 'week' | 'month'

export interface ItineraryDayGroup {
  key: string
  kind: ItineraryDisplayMode
  groupIndex: number
  startDayIndex: number
  endDayIndex: number
  startDate: string | null
  endDate: string | null
  items: Array<{ day: TripDay, index: number }>
}

export type DayTimelineEntry
  = | {
    key: string
    kind: 'transfer'
    time: string | null
    endTime: null
    sourceOrder: number
    item: string
  }
  | {
    key: string
    kind: 'attraction'
    time: string | null
    endTime: string | null
    sourceOrder: number
    item: TripAttraction
    timeRecommendationBasis: string | null
    crowdRecommendationBasis: string | null
    outdoor: boolean
  }
  | {
    key: string
    kind: 'meal'
    time: string | null
    endTime: null
    sourceOrder: number
    item: TripMeal
    timeRecommendationBasis: string | null
  }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function extractTripPlan(result: unknown): TripPlan | null {
  const envelope = record(result)
  const candidate = record(envelope?.data)
  if (!candidate || typeof candidate.city !== 'string' || !Array.isArray(candidate.days))
    return null
  if (!candidate.days.every(day => record(day) && Array.isArray(record(day)?.attractions) && Array.isArray(record(day)?.meals)))
    return null
  return candidate as unknown as TripPlan
}

export interface TripPhotoTarget {
  name: string
  city: string
}

export function collectTripPhotoTargets(plan: Pick<TripPlan, 'city' | 'days'>): TripPhotoTarget[] {
  const targets = new Map<string, string>()
  for (const day of plan.days) {
    const city = String(day.city || plan.city || '').trim()
    for (const attraction of day.attractions) {
      const name = String(attraction.name || '').trim()
      if (name && !targets.has(name))
        targets.set(name, city)
    }
    if (city && !targets.has(city))
      targets.set(city, city)
  }
  return [...targets].map(([name, city]) => ({ name, city }))
}

export function resolveTripAttractionPhoto(
  attraction: Pick<TripAttraction, 'name' | 'image_url'>,
  photos: Record<string, string>,
  baseUrl: string,
): string {
  return resolveMediaUrl(attraction.image_url || photos[attraction.name], baseUrl)
}

export function resolveTripDayPinPhoto(
  day: Pick<TripDay, 'city' | 'attractions'>,
  fallbackCity: string,
  photos: Record<string, string>,
  baseUrl: string,
): string {
  for (const attraction of day.attractions) {
    const source = resolveTripAttractionPhoto(attraction, photos, baseUrl)
    if (source)
      return source
  }
  const city = String(day.city || fallbackCity || '').trim()
  return resolveMediaUrl(photos[city], baseUrl)
}

export type TodayTripState
  = | { phase: 'before' | 'after', day: null }
    | { phase: 'during', day: TripDay }

export function todayState(plan: TripPlan, today: string): TodayTripState {
  if (today < plan.start_date)
    return { phase: 'before', day: null }
  if (today > plan.end_date)
    return { phase: 'after', day: null }
  const day = plan.days.find(item => item.date === today) || plan.days[0]
  return day ? { phase: 'during', day } : { phase: 'after', day: null }
}

function parseMinutes(value?: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value?.trim() || '')
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function minutesToTime(value: number): string {
  const safe = Math.max(0, Math.min(value, 23 * 60 + 59))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function parseTripDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value?.trim() || '')
  if (!match)
    return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null
}

export function resolveItineraryDisplayMode(dayCount: number): ItineraryDisplayMode {
  if (dayCount <= 7)
    return 'day'
  if (dayCount <= 30)
    return 'week'
  return 'month'
}

function makeDayGroup(
  key: string,
  kind: ItineraryDisplayMode,
  groupIndex: number,
  items: Array<{ day: TripDay, index: number }>,
): ItineraryDayGroup | null {
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last)
    return null
  return {
    key,
    kind,
    groupIndex,
    startDayIndex: first.index,
    endDayIndex: last.index,
    startDate: first.day.date || null,
    endDate: last.day.date || null,
    items,
  }
}

export function groupItineraryDays(days: TripDay[], mode: ItineraryDisplayMode): ItineraryDayGroup[] {
  const items = days.map((day, index) => ({ day, index }))
  if (mode === 'day') {
    const group = makeDayGroup('day-all', 'day', 0, items)
    return group ? [group] : []
  }
  if (mode === 'week') {
    const groups: ItineraryDayGroup[] = []
    for (let index = 0; index < items.length; index += 7) {
      const group = makeDayGroup(`week-${index / 7}`, 'week', index / 7, items.slice(index, index + 7))
      if (group)
        groups.push(group)
    }
    return groups
  }
  const groups: ItineraryDayGroup[] = []
  let monthKey = ''
  for (const item of items) {
    const parsed = parseTripDate(item.day.date)
    const nextKey = parsed
      ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`
      : 'unknown'
    const current = groups[groups.length - 1]
    if (!current || monthKey !== nextKey) {
      monthKey = nextKey
      const group = makeDayGroup(`month-${nextKey}-${groups.length}`, 'month', groups.length, [item])
      if (group)
        groups.push(group)
    }
    else {
      const group = makeDayGroup(current.key, 'month', current.groupIndex, [...current.items, item])
      if (group)
        groups[groups.length - 1] = group
    }
  }
  return groups
}

const outdoorKeywords = ['公园', '山', '湖', '岛', '海滩', '湿地', '森林', '草原', '古镇', '古村', '步道', '广场', '街', '园林', 'park', 'mountain', 'lake', 'island', 'beach', 'forest', 'garden']

function mealAnchor(type: string, attractions: DayTimelineEntry[]): number {
  const anchors: Record<string, number> = { breakfast: 8 * 60, lunch: 12 * 60 + 30, dinner: 18 * 60 + 30, snack: 15 * 60 + 30 }
  let anchor = anchors[type.toLowerCase()] ?? anchors.lunch
  const ranges = attractions
    .filter((entry): entry is Extract<DayTimelineEntry, { kind: 'attraction' }> => entry.kind === 'attraction')
    .map(entry => ({ start: parseMinutes(entry.time || ''), end: parseMinutes(entry.endTime || '') }))
  if (type === 'lunch') {
    const ends = ranges.filter(item => item.start !== null && item.start < 13 * 60 && item.end !== null).map(item => item.end!)
    if (ends.length)
      anchor = Math.max(anchor, Math.max(...ends) + 30)
  }
  if (type === 'dinner') {
    const ends = ranges.filter(item => item.start !== null && item.start >= 14 * 60 && item.end !== null).map(item => item.end!)
    if (ends.length)
      anchor = Math.max(anchor, Math.max(...ends) + 30)
  }
  return anchor
}

export function buildDayTimeline(day: TripDay, weather: TripWeather | null = null): DayTimelineEntry[] {
  const entries: DayTimelineEntry[] = []
  let sourceOrder = 0
  let previousEnd: number | null = null
  if (day.is_transfer_day && day.transfer_info) {
    entries.push({ key: 'transfer', kind: 'transfer', time: parseMinutes(day.transfer_time) === null ? null : day.transfer_time!, endTime: null, sourceOrder: sourceOrder++, item: day.transfer_info })
  }
  day.attractions.forEach((item, index) => {
    const searchable = `${item.name} ${item.category || ''} ${item.description || ''}`.toLowerCase()
    const outdoor = outdoorKeywords.some(keyword => searchable.includes(keyword))
    const duration = Math.max(30, Number(item.visit_duration) || 90)
    let start = parseMinutes(item.start_time)
    let recommendation = item.time_recommendation_basis || null
    if (start === null) {
      const hot = Number(weather?.day_temp) >= 29
      const firstAnchor = outdoor && hot ? 8 * 60 : 9 * 60
      const anchor = index === 0 ? firstAnchor : (outdoor && hot ? 16 * 60 : 14 * 60 + (index - 1) * 150)
      start = previousEnd === null ? anchor : Math.max(anchor, previousEnd + 30)
      recommendation = weather ? 'weather' : 'seasonal'
    }
    const end = parseMinutes(item.end_time) ?? start + duration
    previousEnd = end
    entries.push({
      key: `attraction-${sourceOrder}-${item.name}`,
      kind: 'attraction',
      time: minutesToTime(start),
      endTime: minutesToTime(end),
      sourceOrder: sourceOrder++,
      item,
      timeRecommendationBasis: recommendation,
      crowdRecommendationBasis: item.crowd_recommendation_basis || (recommendation ? 'heuristic' : null),
      outdoor,
    })
  })
  const attractions = entries.filter(entry => entry.kind === 'attraction')
  for (const item of day.meals) {
    const existing = parseMinutes(item.time)
    entries.push({
      key: `meal-${sourceOrder}-${item.type}-${item.name}`,
      kind: 'meal',
      time: existing === null ? minutesToTime(mealAnchor(item.type || 'lunch', attractions)) : item.time!,
      endTime: null,
      sourceOrder: sourceOrder++,
      item,
      timeRecommendationBasis: existing === null ? 'schedule' : item.time_recommendation_basis || null,
    })
  }
  return entries.sort((left, right) => {
    if (left.time && right.time)
      return left.time.localeCompare(right.time) || left.sourceOrder - right.sourceOrder
    if (left.time)
      return -1
    if (right.time)
      return 1
    return left.sourceOrder - right.sourceOrder
  })
}

export function buildTodayTimeline(day: TripDay, execution: ExecutionMapDto): TodayTimelineItem[] {
  const noTime = 24 * 60
  const attractions = day.attractions.map((item, index): TodayTimelineItem => {
    const start = parseMinutes(item.start_time)
    const end = parseMinutes(item.end_time)
    return {
      kind: 'attraction',
      id: item.id || '',
      name: item.name,
      timeLabel: start !== null && end !== null
        ? `${item.start_time} - ${item.end_time}`
        : item.start_time || '',
      sortKey: start ?? noTime + index,
      costHint: item.ticket_price,
      description: item.description,
      status: item.id ? execution[item.id]?.status || 'pending' : 'pending',
    }
  })
  const meals = day.meals.map((item, index): TodayTimelineItem => {
    const start = parseMinutes(item.time)
    return {
      kind: 'meal',
      id: item.id || '',
      name: item.name,
      timeLabel: item.time || '',
      sortKey: start ?? noTime + day.attractions.length + index,
      costHint: item.estimated_cost,
      category: item.type,
      description: item.description,
      status: item.id ? execution[item.id]?.status || 'pending' : 'pending',
    }
  })
  return [...attractions, ...meals].sort((left, right) => left.sortKey - right.sortKey)
}

export function todayProgress(items: TodayTimelineItem[]): { done: number, total: number } {
  return { done: items.filter(item => item.status === 'done').length, total: items.length }
}

export function resolveMediaUrl(source: string | undefined, baseUrl: string): string {
  if (!source || /^https?:\/\//.test(source) || source.startsWith('data:') || source.startsWith('blob:'))
    return source || ''
  return `${baseUrl}${source.startsWith('/') ? source : `/${source}`}`
}

function dayDescription(day: TripDay): string {
  const sections = [day.description]
  if (day.attractions.length)
    sections.push(t('result.export.calendarAttractions', { value: day.attractions.map(item => item.name).join(', ') }))
  if (day.meals.length)
    sections.push(t('result.export.calendarMeals', { value: day.meals.map(item => item.name).join(', ') }))
  if (day.transportation)
    sections.push(t('result.export.calendarTransport', { value: day.transportation }))
  if (day.accommodation)
    sections.push(t('result.export.calendarAccommodation', { value: day.accommodation }))
  return sections.filter(Boolean).join('\n')
}

export function buildCalendarEvents(plan: TripPlan): TripCalendarEvent[] {
  return plan.days.map((day, index) => {
    const city = day.city || plan.city
    const start = new Date(`${day.date}T09:00:00`)
    const end = new Date(`${day.date}T20:00:00`)
    return {
      title: t('result.export.calendarTitle', { city, day: index + 1 }),
      startTime: Math.floor(start.getTime() / 1000),
      endTime: String(Math.floor(end.getTime() / 1000)),
      allDay: true,
      description: dayDescription(day),
      location: city,
    }
  }).filter(event => Number.isFinite(event.startTime))
}

function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function calendarDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export function buildTripCalendar(plan: TripPlan): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//YouBan//Trip Plan//ZH-CN',
    'CALSCALE:GREGORIAN',
  ]
  buildCalendarEvents(plan).forEach((event, index) => {
    const date = calendarDate(event.startTime)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${plan.start_date}-${index + 1}@youban.me`,
      `DTSTART;VALUE=DATE:${date}`,
      `DTEND;VALUE=DATE:${calendarDate(event.startTime + 24 * 60 * 60)}`,
      `SUMMARY:${escapeCalendarText(event.title)}`,
      `DESCRIPTION:${escapeCalendarText(event.description)}`,
      `LOCATION:${escapeCalendarText(event.location)}`,
      'END:VEVENT',
    )
  })
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}
