import { describe, expect, it, vi } from 'vitest'
import { consumeSseChunk, streamTripParse } from './chat-stream'

describe('chat stream', () => {
  it('retains a partial SSE line and emits complete events', () => {
    const events: unknown[] = []
    const first = consumeSseChunk('', 'data: {"type":"delta","text":"你', event => events.push(event))
    expect(first).toContain('data:')
    const remaining = consumeSseChunk(first, '好"}\n\ndata: [DONE]\n\n', event => events.push(event))
    expect(remaining).toBe('')
    expect(events).toEqual([{ type: 'delta', text: '你好' }])
  })

  it('uses the structured endpoint when streaming is unavailable', async () => {
    const final = { success: true, need_clarify: true, clarify_question: '几天？', summary: '' }
    const request = vi.fn().mockResolvedValue(final)
    const onFinal = vi.fn()
    await streamTripParse('去西安', 'zh-CN', [], { onFinal }, {
      platform: 'mp-weixin',
      request,
    })
    expect(request).toHaveBeenCalledOnce()
    expect(onFinal).toHaveBeenCalledWith(final)
  })
})
