import type { NativeActionDto, NativeCalendarEventDto } from '@youban/contracts'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isCalendarEvent(value: unknown): value is NativeCalendarEventDto {
  const item = record(value)
  return Boolean(
    item
    && typeof item.title === 'string'
    && typeof item.startTime === 'number'
    && typeof item.endTime === 'number'
    && typeof item.allDay === 'boolean'
    && typeof item.description === 'string'
    && typeof item.location === 'string'
    && typeof item.alarm === 'boolean'
    && typeof item.alarmOffset === 'number',
  )
}

export function calendarEventsFromAction(action: NativeActionDto): NativeCalendarEventDto[] {
  if (action.type !== 'add_calendar')
    return []
  const events = action.payload.events
  return Array.isArray(events) && events.every(isCalendarEvent) ? events : []
}

export async function addCalendarEventsSequentially(
  events: NativeCalendarEventDto[],
  addEvent: (event: NativeCalendarEventDto) => Promise<unknown>,
): Promise<void> {
  for (const event of events)
    await addEvent(event)
}
