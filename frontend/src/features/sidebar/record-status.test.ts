import type { ConversationRecordDto } from '@youban/contracts'
import { describe, expect, it } from 'vitest'
import { sidebarPlanBadge } from './record-status'

function record(overrides: Partial<ConversationRecordDto>): ConversationRecordDto {
  return {
    record_id: 'record-1',
    kind: 'plan',
    session_id: null,
    plan_id: 'plan-1',
    task_id: 'task-1',
    title: '上海周末',
    title_status: 'generated',
    state: 'planned',
    revision: 1,
    status: 'completed',
    user_id: 'user-1',
    city: '上海',
    cities: [],
    start_date: '2026-08-31',
    end_date: '2026-09-02',
    travel_days: 3,
    updated_at: '2026-08-31T00:00:00Z',
    overall_suggestions: '',
    user_deleted_at: null,
    ...overrides,
  }
}

describe('sidebar plan status', () => {
  it('keeps processing and failed ahead of date-derived state', () => {
    expect(sidebarPlanBadge(record({ state: 'generating', status: 'processing' }), '2026-08-31')).toBe('processing')
    expect(sidebarPlanBadge(record({ status: 'failed' }), '2026-08-31')).toBe('failed')
  })

  it('marks completed plans ongoing throughout the inclusive trip range', () => {
    expect(sidebarPlanBadge(record({}), '2026-08-31')).toBe('ongoing')
    expect(sidebarPlanBadge(record({}), '2026-09-02')).toBe('ongoing')
  })

  it('does not label plans outside the trip range or without completed status', () => {
    expect(sidebarPlanBadge(record({}), '2026-08-30')).toBeNull()
    expect(sidebarPlanBadge(record({}), '2026-09-03')).toBeNull()
    expect(sidebarPlanBadge(record({ status: 'processing', state: 'planned' }), '2026-08-31')).toBe('processing')
    expect(sidebarPlanBadge(record({ status: null }), '2026-08-31')).toBeNull()
  })
})
