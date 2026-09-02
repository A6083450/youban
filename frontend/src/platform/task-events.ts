import type { TripTaskEventDto } from '@youban/contracts'
import { TripTaskEventSchema } from '@youban/contracts'
import { Value } from '@sinclair/typebox/value'
import { getApiBaseUrl } from '@/http/client'
import { authHeaders } from './auth'
import { taskEventsPath } from '@/services/v2'

export function parseTaskEvent(raw: string): TripTaskEventDto | null {
  try {
    const value: unknown = JSON.parse(raw)
    return Value.Check(TripTaskEventSchema, value) ? value as TripTaskEventDto : null
  }
  catch {
    return null
  }
}

function websocketBaseUrl(): string {
  return getApiBaseUrl().replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

export interface TaskEventSubscription {
  close: () => void
}

export function subscribeTaskEvents(
  taskId: string,
  onEvent: (event: TripTaskEventDto) => void,
  onError?: (error: unknown) => void,
): TaskEventSubscription {
  const socket = uni.connectSocket({
    url: `${websocketBaseUrl()}${taskEventsPath(taskId)}`,
    header: authHeaders(),
    complete() {},
  })
  socket.onMessage(({ data }) => {
    const event = parseTaskEvent(typeof data === 'string' ? data : '')
    if (event)
      onEvent(event)
  })
  socket.onError(error => onError?.(error))
  return { close: () => socket.close({}) }
}
