import type { TripConfirmReplyResponseDto, TripParseResponseDto } from '@youban/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/auth'
import { consumeSseChunk, streamTripConfirmReply, streamTripParse } from './chat-stream'

const readyUser = {
  user_id: 'user-1',
  nickname: '微信用户',
  avatar_url: '/api/avatars/avatar.png',
  profile_complete: true,
}

const storage = new Map<string, unknown>()

function chunkData(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function chunkedRequester(chunks: string[]) {
  return binaryChunkedRequester(chunks.map(chunkData))
}

function binaryChunkedRequester(chunks: ArrayBuffer[]) {
  let onChunk: ((result: { data: ArrayBuffer }) => void) | undefined
  const task = {
    abort: vi.fn(),
    offHeadersReceived: vi.fn(),
    onHeadersReceived: vi.fn(),
    onChunkReceived(callback: (result: { data: ArrayBuffer }) => void) {
      onChunk = callback
    },
  }
  const requester = vi.fn((options: UniNamespace.RequestOptions) => {
    queueMicrotask(() => {
      for (const chunk of chunks)
        onChunk?.({ data: chunk })
      options.success?.({ data: '', statusCode: 200, header: {}, cookies: [] })
    })
    return task
  }) as unknown as typeof uni.request
  return { requester, task }
}

function statusRequester(statusCode: number) {
  const task = {
    abort: vi.fn(),
    offHeadersReceived: vi.fn(),
    onHeadersReceived: vi.fn(),
    onChunkReceived: vi.fn(),
  }
  const requester = vi.fn((options: UniNamespace.RequestOptions) => {
    queueMicrotask(() => options.success?.({ data: '', statusCode, header: {}, cookies: [] }))
    return task
  }) as unknown as typeof uni.request
  return requester
}

describe('chat stream', () => {
  beforeEach(() => {
    storage.clear()
    storage.set('youban.v2.auth-token', 'stale-token')
    storage.set('youban.v2.user', readyUser)
    vi.mocked(uni.getStorageSync).mockImplementation(key => storage.get(String(key)) ?? null)
    vi.mocked(uni.setStorageSync).mockImplementation((key, value) => {
      storage.set(String(key), value)
    })
    vi.mocked(uni.removeStorageSync).mockImplementation((key) => {
      storage.delete(String(key))
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retains a partial SSE line and emits complete events', () => {
    const events: unknown[] = []
    const first = consumeSseChunk('', 'data: {"type":"delta","text":"你', event => events.push(event))
    expect(first).toContain('data:')
    const remaining = consumeSseChunk(first, '好"}\n\ndata: [DONE]\n\n', event => events.push(event))
    expect(remaining).toBe('')
    expect(events).toEqual([{ type: 'delta', text: '你好' }])
  })

  it('streams mini-program chunks through the SSE endpoint', async () => {
    const final = { success: true, need_clarify: true, clarify_question: '几天？', summary: '' } as TripParseResponseDto
    const { requester } = chunkedRequester([
      'data: {"type":"delta","text":"你',
      '好"}\n\ndata: {"type":"final","payload":',
      `${JSON.stringify(final)}}\n\ndata: [DONE]\n\n`,
    ])
    const onDelta = vi.fn()
    const onFinal = vi.fn()
    await streamTripParse('去西安', 'zh-CN', [], { onDelta, onFinal }, {
      platform: 'mp-weixin',
      uniRequester: requester,
    })

    expect(requester).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/api/v2/trip/parse/stream'),
      enableChunked: true,
    }))
    expect(onDelta).toHaveBeenCalledWith('你好')
    expect(onFinal).toHaveBeenCalledWith(final)
  })

  it('streams UTF-8 chunks without a native TextDecoder', async () => {
    vi.stubGlobal('TextDecoder', undefined)
    const final = { success: true, need_clarify: true, clarify_question: '几天？', summary: '' } as TripParseResponseDto
    const payload = `data: {"type":"delta","text":"你好"}\n\ndata: {"type":"final","payload":${JSON.stringify(final)}}\n\ndata: [DONE]\n\n`
    const bytes = new TextEncoder().encode(payload)
    const chunks = Array.from(bytes, (_, index) => bytes.slice(index, index + 1).buffer as ArrayBuffer)
    const { requester } = binaryChunkedRequester(chunks)
    const onDelta = vi.fn()
    const onFinal = vi.fn()

    await streamTripParse('去西安', 'zh-CN', [], { onDelta, onFinal }, {
      platform: 'mp-weixin',
      uniRequester: requester,
    })

    expect(onDelta).toHaveBeenCalledWith('你好')
    expect(onFinal).toHaveBeenCalledWith(final)
  })

  it('streams draft adjustment replies in the mini program', async () => {
    const final = {
      action: 'update',
      message: '已经增加一天。',
      ready_to_generate: true,
    } as TripConfirmReplyResponseDto
    const { requester } = chunkedRequester([
      'data: {"type":"delta","text":"已经"}\n\n',
      `data: {"type":"final","payload":${JSON.stringify(final)}}\n\ndata: [DONE]\n\n`,
    ])
    const onDelta = vi.fn()
    const onFinal = vi.fn()

    await streamTripConfirmReply('增加一天', {} as never, 'zh-CN', [], '', { onDelta, onFinal }, {
      platform: 'mp-weixin',
      uniRequester: requester,
    })

    expect(requester).toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/api/v2/trip/confirm-reply/stream'),
      enableChunked: true,
    }))
    expect(onDelta).toHaveBeenCalledWith('已经')
    expect(onFinal).toHaveBeenCalledWith(final)
  })

  it('returns to login when a mini-program stream receives 401', async () => {
    const auth = useAuthStore()

    await expect(streamTripParse('去苏州', 'zh-CN', [], {}, {
      platform: 'mp-weixin',
      uniRequester: statusRequester(401),
    })).rejects.toThrow()

    expect(auth.ready).toBe(false)
    expect(auth.token).toBe('')
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })
})
