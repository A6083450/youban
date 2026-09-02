import type { ExecutionMapDto } from '@youban/contracts'
import type { TodayTimelineItem, TripPlan } from './model'

export type TodayReflectionState = 'start' | 'progress' | 'mixed' | 'complete' | 'deferred'

export function todayReflectionState(items: TodayTimelineItem[]): TodayReflectionState {
  const done = items.filter(item => item.status === 'done').length
  const pending = items.filter(item => item.status === 'pending').length
  const deferred = items.filter(item => item.status === 'skipped' || item.status === 'postponed').length
  if (items.length > 0 && done === items.length)
    return 'complete'
  if (done > 0 && pending === 0 && deferred > 0)
    return 'mixed'
  if (done > 0)
    return 'progress'
  if (pending === 0 && deferred > 0)
    return 'deferred'
  return 'start'
}

export function todayEndedSummary(plan: TripPlan, execution: ExecutionMapDto): { days: number, done: number, cost: number } {
  const done = Object.values(execution).filter(entry => entry.status === 'done')
  return {
    days: plan.days.length,
    done: done.length,
    cost: done.reduce((sum, entry) => sum + (entry.actual_cost || 0), 0),
  }
}

export function daysUntilTrip(startDate: string, today: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const current = new Date(`${today}T00:00:00`)
  const difference = Math.floor((start.getTime() - current.getTime()) / 86_400_000)
  return Math.max(1, Number.isFinite(difference) ? difference : 1)
}
