import { ApiV2Routes } from '@youban/contracts'
import type {
  ChatMessageDto,
  ParsedTripDraftDto,
  TripConfirmReplyResponseDto,
  TripParseResponseDto,
} from '@youban/contracts'
import { getApiBaseUrl } from '@/http/client'
import { t } from '@/locale'
import { authHeaders, currentPlatform } from '@/platform/auth'
import type { AppPlatform } from '@/platform/auth'
import { confirmTripReply, parseTripText } from './v2'

type StreamPayload = TripParseResponseDto | TripConfirmReplyResponseDto

type StreamEvent<T extends StreamPayload>
  = | { type: 'delta', text: string }
    | { type: 'thinking', title?: string, content?: string }
    | { type: 'final', payload: T }
    | { type: 'error', message?: string }

export interface ChatStreamCallbacks<T extends StreamPayload = TripParseResponseDto> {
  onDelta?: (text: string) => void
  onThinking?: (title: string) => void
  onFinal?: (payload: T) => void
  onError?: (message: string) => void
  signal?: AbortSignal
}

interface ChunkedRequestTask extends UniNamespace.RequestTask {
  onChunkReceived?: (callback: (result: { data: ArrayBuffer }) => void) => void
}

type UniRequester = (options: UniNamespace.RequestOptions) => UniNamespace.RequestTask

interface StreamDependencies<T extends StreamPayload> {
  platform?: AppPlatform
  fallback?: () => Promise<T>
  fetcher?: typeof fetch
  uniRequester?: UniRequester
}

export function consumeSseChunk<T extends StreamPayload = TripParseResponseDto>(
  previous: string,
  chunk: string,
  emit: (event: StreamEvent<T>) => void,
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
      emit(JSON.parse(payload) as StreamEvent<T>)
    }
    catch {
      // Ignore malformed frames; the final structured event remains authoritative.
    }
  }
  return remainder
}

function todayString(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function dispatchStreamEvent<T extends StreamPayload>(
  event: StreamEvent<T>,
  callbacks: ChatStreamCallbacks<T>,
): boolean {
  if (event.type === 'delta')
    callbacks.onDelta?.(event.text)
  else if (event.type === 'thinking')
    callbacks.onThinking?.(event.title || event.content || '')
  else if (event.type === 'final')
    callbacks.onFinal?.(event.payload)
  else if (event.type === 'error')
    callbacks.onError?.(event.message || t('chatHome.serviceUnavailable'))
  return event.type === 'final'
}

function decodeChunk(decoder: TextDecoder, data: unknown, stream: boolean): string {
  if (typeof data === 'string')
    return data
  if (data instanceof ArrayBuffer)
    return decoder.decode(new Uint8Array(data), { stream })
  if (ArrayBuffer.isView(data))
    return decoder.decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), { stream })
  if (data && typeof data === 'object' && 'byteLength' in data)
    return decoder.decode(new Uint8Array(data as ArrayBuffer), { stream })
  return ''
}

async function streamWithFetch<T extends StreamPayload>(
  path: string,
  body: Record<string, unknown>,
  callbacks: ChatStreamCallbacks<T>,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await fetcher(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
    signal: callbacks.signal,
  })
  if (!response.ok || !response.body)
    throw new Error(t('api.requestFailedWithStatus', { status: response.status }))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer = consumeSseChunk<T>(buffer, decoder.decode(value, { stream: true }), event => dispatchStreamEvent(event, callbacks))
  }
  buffer += decoder.decode()
  consumeSseChunk<T>(buffer, '\n', event => dispatchStreamEvent(event, callbacks))
}

function streamWithUniRequest<T extends StreamPayload>(
  path: string,
  body: Record<string, unknown>,
  callbacks: ChatStreamCallbacks<T>,
  fallback: () => Promise<T>,
  requester: UniRequester,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const decoder = new TextDecoder()
    let buffer = ''
    let receivedChunk = false
    let receivedFinal = false
    let settled = false
    let task: ChunkedRequestTask

    let abort = () => {}
    const cleanup = () => callbacks.signal?.removeEventListener('abort', abort)
    const finish = (error?: unknown) => {
      if (settled)
        return
      settled = true
      cleanup()
      if (error)
        reject(error)
      else
        resolve()
    }
    const emit = (event: StreamEvent<T>) => {
      receivedFinal = dispatchStreamEvent(event, callbacks) || receivedFinal
    }
    const useFallback = async () => {
      try {
        callbacks.onFinal?.(await fallback())
        finish()
      }
      catch (error) {
        finish(error)
      }
    }
    abort = () => {
      task?.abort()
      finish(new Error('aborted'))
    }

    task = requester({
      url: `${getApiBaseUrl()}${path}`,
      method: 'POST',
      data: body,
      header: { 'Content-Type': 'application/json', ...authHeaders() },
      enableChunked: true,
      responseType: 'arraybuffer',
      success(response) {
        const status = Number(response.statusCode)
        if (status < 200 || status >= 300) {
          finish(new Error(t('api.requestFailedWithStatus', { status })))
          return
        }
        if (!receivedChunk)
          buffer = consumeSseChunk<T>(buffer, decodeChunk(decoder, response.data, false), emit)
        else
          buffer += decoder.decode()
        consumeSseChunk<T>(buffer, '\n', emit)
        if (receivedFinal)
          finish()
        else
          void useFallback()
      },
      fail(error) {
        finish(new Error(error.errMsg || t('chatHome.serviceUnavailable')))
      },
    }) as ChunkedRequestTask

    if (typeof task.onChunkReceived !== 'function') {
      task.abort()
      void useFallback()
      return
    }
    task.onChunkReceived(({ data }) => {
      receivedChunk = true
      buffer = consumeSseChunk<T>(buffer, decodeChunk(decoder, data, true), emit)
    })
    callbacks.signal?.addEventListener('abort', abort, { once: true })
  })
}

async function streamRequest<T extends StreamPayload>(
  path: string,
  body: Record<string, unknown>,
  callbacks: ChatStreamCallbacks<T>,
  fallback: () => Promise<T>,
  dependencies: StreamDependencies<T>,
): Promise<void> {
  const platform = dependencies.platform ?? currentPlatform()
  if (platform === 'mp-weixin') {
    return streamWithUniRequest(
      path,
      body,
      callbacks,
      dependencies.fallback ?? fallback,
      dependencies.uniRequester ?? uni.request,
    )
  }
  if (typeof globalThis.ReadableStream === 'undefined') {
    callbacks.onFinal?.(await (dependencies.fallback ?? fallback)())
    return
  }
  await streamWithFetch(path, body, callbacks, dependencies.fetcher ?? fetch)
}

export function streamTripParse(
  text: string,
  language: string,
  history: ChatMessageDto[],
  callbacks: ChatStreamCallbacks<TripParseResponseDto>,
  dependencies: StreamDependencies<TripParseResponseDto> = {},
): Promise<void> {
  return streamRequest(
    ApiV2Routes.tripParseStream,
    { text, language, today: todayString(), history: history.slice(-10) },
    callbacks,
    () => parseTripText(text, language, history),
    dependencies,
  )
}

export function streamTripConfirmReply(
  text: string,
  draft: ParsedTripDraftDto,
  language: string,
  history: ChatMessageDto[],
  readinessToken: string,
  callbacks: ChatStreamCallbacks<TripConfirmReplyResponseDto>,
  dependencies: StreamDependencies<TripConfirmReplyResponseDto> = {},
): Promise<void> {
  return streamRequest(
    ApiV2Routes.tripConfirmReplyStream,
    {
      text,
      draft,
      language,
      today: todayString(),
      history: history.slice(-10),
      readiness_token: readinessToken,
    },
    callbacks,
    () => confirmTripReply(text, draft, language, history, readinessToken),
    dependencies,
  )
}
