import type { ExecutionMapDto } from '@youban/contracts'
import { describe, expect, it } from 'vitest'
import type { TodayTimelineItem, TripPlan } from './model'
import { daysUntilTrip, todayEndedSummary, todayReflectionState } from './today'

function item(status: TodayTimelineItem['status']): TodayTimelineItem {
  return {
    kind: 'attraction',
    id: status,
    name: status,
    timeLabel: '09:00',
    sortKey: 540,
    status,
  }
}

describe('today presentation', () => {
  it('derives each legacy reflection state from execution progress', () => {
    expect(todayReflectionState([item('pending')])).toBe('start')
    expect(todayReflectionState([item('done'), item('pending')])).toBe('progress')
    expect(todayReflectionState([item('done'), item('skipped')])).toBe('mixed')
    expect(todayReflectionState([item('skipped'), item('postponed')])).toBe('deferred')
    expect(todayReflectionState([item('done'), item('done')])).toBe('complete')
  })

  it('summarizes completed execution records and actual costs', () => {
    const plan = { days: [{}, {}, {}] } as TripPlan
    const execution: ExecutionMapDto = {
      one: { status: 'done', actual_cost: 80 },
      two: { status: 'done', actual_cost: 20 },
      three: { status: 'skipped' },
    }
    expect(todayEndedSummary(plan, execution)).toEqual({ days: 3, done: 2, cost: 100 })
  })

  it('keeps the old minimum one-day countdown copy', () => {
    expect(daysUntilTrip('2026-09-03', '2026-09-01')).toBe(2)
    expect(daysUntilTrip('2026-09-01', '2026-09-01')).toBe(1)
  })
})
