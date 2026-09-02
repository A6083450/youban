import { describe, expect, it } from 'vitest'
import { setAppLocale } from '@/locale'
import * as resultModel from './model'
import {
  buildCalendarEvents,
  buildDayTimeline,
  buildTodayTimeline,
  buildTripCalendar,
  extractTripPlan,
  groupItineraryDays,
  resolveItineraryDisplayMode,
  todayProgress,
  todayState,
} from './model'

const plan = {
  city: '杭州',
  start_date: '2026-09-01',
  end_date: '2026-09-02',
  days: [
    { date: '2026-09-01', day_index: 0, description: '西湖慢游', transportation: '步行', accommodation: '湖滨酒店', attractions: [], meals: [] },
    { date: '2026-09-02', day_index: 1, description: '灵隐寻幽', transportation: '公交', accommodation: '湖滨酒店', attractions: [], meals: [] },
  ],
  weather_info: [],
  overall_suggestions: '穿舒适的鞋。',
}

describe('trip result model', () => {
  it('extracts a plan from the backend result envelope', () => {
    expect(extractTripPlan({ success: true, data: plan })).toMatchObject({ city: '杭州', days: plan.days })
  })

  it('rejects malformed or incomplete result payloads', () => {
    expect(extractTripPlan({ success: true })).toBeNull()
    expect(extractTripPlan({ data: { city: '杭州' } })).toBeNull()
    expect(extractTripPlan(null)).toBeNull()
  })

  it('distinguishes before, during and after the trip', () => {
    const trip = extractTripPlan({ data: plan })!
    expect(todayState(trip, '2026-08-31')).toEqual({ phase: 'before', day: null })
    expect(todayState(trip, '2026-09-02')).toMatchObject({ phase: 'during', day: { day_index: 1 } })
    expect(todayState(trip, '2026-09-03')).toEqual({ phase: 'after', day: null })
  })

  it('projects each day into a native calendar event with useful context', () => {
    const trip = extractTripPlan({ data: {
      ...plan,
      days: [{
        ...plan.days[0],
        city: '杭州',
        attractions: [{ name: '西湖', address: '湖滨', start_time: '09:30' }],
        meals: [{ name: '杭帮菜', type: 'lunch' }],
      }],
    } })!
    expect(buildCalendarEvents(trip)).toEqual([expect.objectContaining({
      title: '杭州行程 · 第1天',
      location: '杭州',
      startTime: expect.any(Number),
      description: expect.stringContaining('西湖'),
    })])
  })

  it('builds a standards-compatible calendar download', () => {
    const trip = extractTripPlan({ data: plan })!
    const calendar = buildTripCalendar(trip)
    expect(calendar).toContain('BEGIN:VCALENDAR\r\n')
    expect(calendar).toContain('SUMMARY:杭州行程 · 第1天')
    expect(calendar).toContain('END:VCALENDAR\r\n')
  })

  it('localizes native calendar titles and descriptions', () => {
    const trip = extractTripPlan({ data: {
      ...plan,
      city: 'Hangzhou',
      days: [{
        ...plan.days[0],
        city: 'Hangzhou',
        attractions: [{ name: 'West Lake' }],
      }],
    } })!
    setAppLocale('en-US')
    const [event] = buildCalendarEvents(trip)
    expect(event.title).toBe('Hangzhou itinerary · Day 1')
    expect(event.description).toContain('Attractions: West Lake')
    setAppLocale('zh-CN')
  })

  it('merges and sorts today items while projecting persisted execution state', () => {
    const day = {
      ...plan.days[0],
      attractions: [{ id: 'attr_1', name: '西湖', start_time: '09:00', end_time: '11:00' }],
      meals: [{ id: 'meal_1', name: '午餐', time: '12:00' }],
    }
    const timeline = buildTodayTimeline(day, {
      meal_1: { status: 'skipped', updated_at: '2026-09-01T12:00:00Z' },
      attr_1: { status: 'done', actual_cost: 50 },
    })
    expect(timeline.map(item => [item.id, item.status])).toEqual([
      ['attr_1', 'done'],
      ['meal_1', 'skipped'],
    ])
    expect(todayProgress(timeline)).toEqual({ done: 1, total: 2 })
  })

  it('selects the legacy day, week and month grouping thresholds', () => {
    expect(resolveItineraryDisplayMode(7)).toBe('day')
    expect(resolveItineraryDisplayMode(8)).toBe('week')
    expect(resolveItineraryDisplayMode(30)).toBe('week')
    expect(resolveItineraryDisplayMode(31)).toBe('month')
  })

  it('groups itinerary days into stable week and calendar-month ranges', () => {
    const days = Array.from({ length: 10 }, (_, index) => ({
      ...plan.days[0],
      day_index: index,
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    }))
    expect(groupItineraryDays(days, 'week').map(group => [group.startDayIndex, group.endDayIndex])).toEqual([
      [0, 6],
      [7, 9],
    ])
    expect(groupItineraryDays([
      { ...days[0], date: '2026-09-30' },
      { ...days[1], date: '2026-10-01' },
    ], 'month').map(group => group.startDate)).toEqual(['2026-09-30', '2026-10-01'])
  })

  it('merges transfer, attractions and meals into the old sorted daily timeline', () => {
    const timeline = buildDayTimeline({
      ...plan.days[0],
      is_transfer_day: true,
      transfer_info: '乘坐高铁前往杭州',
      transfer_time: '08:30',
      attractions: [{ name: '西湖', start_time: '14:00', visit_duration: 180 }],
      meals: [{ name: '杭帮菜', type: 'lunch', time: '12:00' }],
    })
    expect(timeline.map(item => [item.kind, item.time])).toEqual([
      ['transfer', '08:30'],
      ['meal', '12:00'],
      ['attraction', '14:00'],
    ])
    expect(timeline.at(-1)).toMatchObject({ endTime: '17:00' })
  })

  it('collects attraction and city photo targets for legacy result visuals', () => {
    const collectTargets = (resultModel as unknown as {
      collectTripPhotoTargets?: (value: unknown) => Array<{ name: string, city: string }>
    }).collectTripPhotoTargets
    expect(collectTargets).toBeTypeOf('function')
    expect(collectTargets?.({
      ...plan,
      city: '杭州',
      days: [
        { ...plan.days[0], city: '杭州', attractions: [{ name: '西湖' }, { name: '灵隐寺' }] },
        { ...plan.days[1], city: '上海', attractions: [{ name: '西湖' }] },
      ],
    })).toEqual([
      { name: '西湖', city: '杭州' },
      { name: '灵隐寺', city: '杭州' },
      { name: '杭州', city: '杭州' },
      { name: '上海', city: '上海' },
    ])
  })

  it('uses attraction photos first and city photos as the legacy journey-pin fallback', () => {
    const resolvePinPhoto = (resultModel as unknown as {
      resolveTripDayPinPhoto?: (
        day: unknown,
        fallbackCity: string,
        photos: Record<string, string>,
        baseUrl: string,
      ) => string
    }).resolveTripDayPinPhoto
    expect(resolvePinPhoto).toBeTypeOf('function')
    const day = { ...plan.days[0], city: '杭州', attractions: [{ name: '西湖' }] }
    expect(resolvePinPhoto?.(day, '杭州', { 西湖: '/images/west-lake.jpg', 杭州: '/images/hangzhou.jpg' }, 'http://api.test')).toBe('http://api.test/images/west-lake.jpg')
    expect(resolvePinPhoto?.({ ...day, attractions: [] }, '杭州', { 杭州: '/images/hangzhou.jpg' }, 'http://api.test')).toBe('http://api.test/images/hangzhou.jpg')
  })
})
