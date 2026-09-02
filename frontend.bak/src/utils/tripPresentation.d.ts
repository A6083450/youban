import type { Attraction, DayPlan, Meal, TripBlueprint, TripPlan, WeatherInfo } from '@/types'

export type ItineraryDisplayMode = 'day' | 'week' | 'month'

export interface ItineraryDayItem {
  day: DayPlan
  index: number
}

export interface ItineraryDayGroup {
  key: string
  kind: ItineraryDisplayMode
  groupIndex: number
  startDayIndex: number
  endDayIndex: number
  startDate: string | null
  endDate: string | null
  items: ItineraryDayItem[]
}

export interface DisplayBlueprint extends TripBlueprint {
  source: 'ai' | 'legacy'
}

export type ResultSectionKey = 'today' | 'overview' | 'days' | 'map' | 'budget' | 'weather'
export type ResultActionKey = 'share' | 'export' | 'calendar'

export function projectResultAvailability(
  plan: Partial<TripPlan>,
  readonly?: boolean,
): { sections: ResultSectionKey[]; actions: ResultActionKey[] }
export function resolveInitialResultSection(
  plan: Partial<TripPlan>,
  requested: unknown,
  readonly?: boolean,
  hasToday?: boolean,
): ResultSectionKey

interface TimelineBase {
  key: string
  time: string | null
  endTime: string | null
  sourceOrder: number
}

export interface TransferTimelineEntry extends TimelineBase {
  kind: 'transfer'
  item: string
}

export interface AttractionTimelineEntry extends TimelineBase {
  kind: 'attraction'
  item: Attraction
  timeRecommendationBasis: 'weather' | 'seasonal' | null
  crowdRecommendationBasis: 'heuristic' | null
  outdoor: boolean
}

export interface MealTimelineEntry extends TimelineBase {
  kind: 'meal'
  item: Meal
  timeRecommendationBasis: 'schedule' | null
}

export type TimelineEntry =
  | TransferTimelineEntry
  | AttractionTimelineEntry
  | MealTimelineEntry

export function normalizeReferenceTime(value: unknown): string | null
export function normalizeTripCityNames(value: unknown, fallback?: unknown): string[]
export function resolveJourneyPinPhotos(
  days: DayPlan[],
  attractionPhotos: Record<string, string>,
): string[]
export function parseTripDate(value: unknown): Date | null
export function resolveItineraryDisplayMode(dayCount: number): ItineraryDisplayMode
export function groupItineraryDays(days: DayPlan[], mode: ItineraryDisplayMode): ItineraryDayGroup[]
export function resolveTripBlueprint(plan: TripPlan): DisplayBlueprint
export function buildDayTimeline(day: DayPlan, weather?: WeatherInfo | null): TimelineEntry[]
