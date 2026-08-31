import type { ChatMessageDto, TripParseResponseDto } from '@youban/contracts'
import { getApiBaseUrl } from '@/http/client'
import { authHeaders, currentPlatform } from '@/platform/auth'
import type { AppPlatform } from '@/platform/auth'
import { t } from '@/locale'
import { parseTripText } from './v2'

type StreamEvent
  = | { type: 'delta', text: string }
    | { type: 'thinking', title?: string, content?: string }
    | { type: 'final', payload: TripParseResponseDto }
    | { type: 'error', message?: string }

export interface ChatStreamCallbacks {
  onDelta?: (text: string) => void
  onThinking?: (title: string) => void
  onFinal?: (payload: TripParseResponseDto) => void
  onError?: (message: string) => void
  signal?: AbortSignal
}

export function consumeSseChunk(
  previous: string,
  chunk: string,
  emit: (event: StreamEvent) => void,
): string {
  const lines = `${previous}${chunk}`.split('\n')
  const remainder = lines.pop() || ''
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line.startsWith('data:'))
      continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]')
      continue
    try {
      emit(JSON.parse(payload) as StreamEvent)
    }
    catch {
      // A malformed server event is ignored; the final structured event remains authoritative.
    }
  }
  return remainder
}

interface StreamDependencies {
  platform?: AppPlatform
  request?: typeof parseTripText
  fetcher?: typeof fetch
}

function todayString(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

export async function streamTripParse(
  text: string,
  language: string,
  history: ChatMessageDto[],
  callbacks: ChatStreamCallbacks,
  dependencies: StreamDependencies = {},
): Promise<void> {
  const platform = dependencies.platform ?? currentPlatform()
  const request = dependencies.request ?? parseTripText
  if (platform !== 'h5' || typeof ReadableStream === 'undefined') {
    callbacks.onFinal?.(await request(text, language, history))
    return
  }

  const fetcher = dependencies.fetcher ?? fetch
  const response = await fetcher(`${getApiBaseUrl()}/api/v2/trip/parse/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text, language, today: todayString(), history: history.slice(-10) }),
    signal: callbacks.signal,
  })
  if (!response.ok || !response.body)
    throw new Error(t('api.requestFailedWithStatus', { status: response.status }))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const emit = (event: StreamEvent) => {
    if (event.type === 'delta')
      callbacks.onDelta?.(event.text)
    else if (event.type === 'thinking')
      callbacks.onThinking?.(event.title || event.content || '')
    else if (event.type === 'final')
      callbacks.onFinal?.(event.payload)
    else if (event.type === 'error')
      callbacks.onError?.(event.message || t('chatHome.serviceUnavailable'))
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer = consumeSseChunk(buffer, decoder.decode(value, { stream: true }), emit)
  }
  consumeSseChunk(buffer, '\n', emit)
}
