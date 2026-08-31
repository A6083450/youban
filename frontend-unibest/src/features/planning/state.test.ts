import type { ParsedTripDraftDto, TripParseResponseDto } from '@youban/contracts'
import { describe, expect, it } from 'vitest'
import { setAppLocale } from '@/locale'
import {
  buildTripPlanRequest,
  formatAgentReply,
  formatTripDraft,
  pickSuggestionBatch,
  reduceParseResult,
} from './state'

const draft: ParsedTripDraftDto = {
  city: '西安',
  cities: [{ city: '西安', days: 3 }],
  start_date: '2026-09-05',
  end_date: '2026-09-07',
  travel_days: 3,
  transportation: '公共交通',
  accommodation: '舒适型酒店',
  traveler_count: 2,
  room_count: 1,
  budget_amount: 5000,
  budget_basis: 'group_total',
  preferences: ['美食', '历史'],
  free_text_input: '去西安玩三天',
  origin_text: '去西安玩三天',
}

function response(overrides: Partial<TripParseResponseDto>): TripParseResponseDto {
  return {
    success: true,
    need_clarify: false,
    clarify_question: '',
    summary: '',
    ...overrides,
  }
}

describe('planning conversation state', () => {
  it('keeps clarification as an assistant message', () => {
    expect(reduceParseResult(response({ action: 'clarify', reply: '想玩几天？' }))).toEqual({
      type: 'message',
      text: '想玩几天？',
    })
  })

  it('keeps a complete draft pending until the user confirms', () => {
    expect(reduceParseResult(response({
      action: 'plan',
      trip: draft,
      ready_to_generate: true,
      readiness_token: 'ready-token',
    }))).toMatchObject({
      type: 'draft',
      draft,
      readyToGenerate: true,
      readinessToken: 'ready-token',
    })
  })

  it('allows automatic generation only with an execution token', () => {
    expect(reduceParseResult(response({
      action: 'plan',
      trip: draft,
      auto_generate: true,
      execution_token: 'execution-token',
    }))).toMatchObject({ type: 'generate', token: 'execution-token' })
  })

  it('builds the exact v2 plan request and retains conversation ownership', () => {
    expect(buildTripPlanRequest(draft, 'execution-token', 'zh-CN', 'session-1', [
      { role: 'user', content: '去西安玩三天' },
    ])).toMatchObject({
      city: '西安',
      cities: [{ city: '西安', days: 3 }],
      traveler_count: 2,
      room_count: 1,
      execution_token: 'execution-token',
      session_id: 'session-1',
    })
  })

  it('formats recommendations and the follow-up question in one reply', () => {
    expect(formatAgentReply(response({
      reply: '可以考虑这两个地方。',
      recommendations: [{ destination: '大理', reason: '节奏舒缓', suggested_days: 4 }],
      follow_up_question: '更喜欢山还是海？',
    }))).toContain('大理：节奏舒缓（建议 4 天）')
    expect(formatAgentReply(response({ follow_up_question: '更喜欢山还是海？' }))).toBe('更喜欢山还是海？')
  })

  it('formats fallback and draft details in the active product language', () => {
    setAppLocale('en-US')
    expect(formatAgentReply(response({}))).toBe('I need a little more information before I can continue planning.')
    expect(formatTripDraft({
      ...draft,
      city: 'Xi\'an',
      cities: [{ city: 'Xi\'an', days: 3 }],
      budget_amount: 6000,
      budget_basis: 'per_person',
      preferences: ['Food', 'History'],
    })).toContain('Route: Xi\'an 3 days')
    expect(formatTripDraft({
      ...draft,
      city: 'Xi\'an',
      cities: [{ city: 'Xi\'an', days: 3 }],
      budget_amount: 6000,
      budget_basis: 'per_person',
      preferences: [],
    })).toContain('Budget: CNY 6,000 (per person)')
    setAppLocale('zh-CN')
  })

  it('rotates a bounded suggestion batch without duplicates', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f']
    const batch = pickSuggestionBatch(pool, 5, () => 0.25)
    expect(batch).toHaveLength(5)
    expect(new Set(batch).size).toBe(5)
    expect(batch.every(item => pool.includes(item))).toBe(true)
  })
})
