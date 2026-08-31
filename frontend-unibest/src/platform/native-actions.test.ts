import type { NativeActionDto } from '@youban/contracts'
import { describe, expect, it, vi } from 'vitest'
import { addCalendarEventsSequentially, calendarEventsFromAction } from './native-actions'

const event = {
  title: '西湖',
  startTime: 1_788_220_200,
  endTime: 1_788_225_600,
  allDay: false,
  description: '湖边漫步',
  location: '杭州',
  alarm: true,
  alarmOffset: 1800,
}

describe('native actions', () => {
  it('accepts only validated calendar action payloads', () => {
    const action: NativeActionDto = {
      type: 'add_calendar',
      expires_at: '2026-09-01T00:00:00Z',
      payload: { events: [event] },
    }
    expect(calendarEventsFromAction(action)).toEqual([event])
    expect(calendarEventsFromAction({ ...action, payload: { events: [{ title: 'incomplete' }] } })).toEqual([])
    expect(calendarEventsFromAction({ ...action, type: 'share' })).toEqual([])
  })

  it('adds native calendar events in order', async () => {
    const calls: string[] = []
    const add = vi.fn(async (item: typeof event) => calls.push(item.title))
    await addCalendarEventsSequentially([event, { ...event, title: '灵隐寺' }], add)
    expect(calls).toEqual(['西湖', '灵隐寺'])
  })
})
