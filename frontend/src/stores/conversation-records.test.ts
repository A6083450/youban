import { beforeEach, describe, expect, test } from 'bun:test'
import {
  conversationRecords,
  createOptimisticConversationRecord,
  groupConversationRecords,
  plannedRecords,
  records,
  removeRecord,
  upsertRecord,
} from './conversation-records'

const record = (overrides: Record<string, unknown> = {}) => ({
  record_id: 'session-1',
  kind: 'conversation',
  session_id: 'session-1',
  plan_id: null,
  task_id: null,
  title: '北京三日游',
  title_status: 'generated',
  state: 'chatting',
  revision: 0,
  status: null,
  user_id: 'user-1',
  city: '',
  cities: [],
  start_date: '',
  end_date: '',
  travel_days: 0,
  updated_at: '2026-08-23T10:00:00Z',
  overall_suggestions: '',
  user_deleted_at: null,
  ...overrides,
})

describe('conversation records store', () => {
  beforeEach(() => {
    records.value = []
  })

  test('sorts records stably and separates conversation and plan sections', () => {
    const grouped = groupConversationRecords([
      record({ record_id: 's1', updated_at: '2026-08-23T10:00:00Z' }),
      record({
        record_id: 's2',
        kind: 'plan',
        state: 'planned',
        session_id: null,
        plan_id: 'p2',
        task_id: 't2',
        city: '上海',
        updated_at: '2026-08-23T11:00:00Z',
      }),
      record({ record_id: 's3', updated_at: '2026-08-23T10:00:00Z' }),
    ])

    expect(grouped.conversations.map((item) => item.record_id)).toEqual(['s1', 's3'])
    expect(grouped.plans.map((item) => item.record_id)).toEqual(['s2'])
  })

  test('does not show a duplicate legacy plan linked to a session record', () => {
    const grouped = groupConversationRecords([
      record({
        record_id: 'session-1',
        kind: 'plan',
        state: 'planned',
        plan_id: 'plan-1',
        task_id: 'task-1',
      }),
      record({
        record_id: 'plan-1',
        kind: 'plan',
        session_id: null,
        plan_id: 'plan-1',
        task_id: 'task-1',
        city: '北京',
      }),
    ])

    expect(grouped.plans.map((item) => item.record_id)).toEqual(['session-1'])
  })

  test('inserts a pending conversation immediately and replaces its generated title', () => {
    createOptimisticConversationRecord({
      sessionId: 'session-1',
      firstMessage: '帮我安排北京三日游',
      userId: 'user-1',
    })

    expect(conversationRecords.value).toHaveLength(1)
    expect(conversationRecords.value[0]?.title_status).toBe('pending')

    upsertRecord(record({ title: '北京三日游', title_status: 'generated' }))

    expect(conversationRecords.value[0]?.title).toBe('北京三日游')
    expect(conversationRecords.value[0]?.title_status).toBe('generated')
  })

  test('moves a linked session into the plan section when it is planned', () => {
    upsertRecord(record())
    upsertRecord(record({
      kind: 'plan',
      state: 'planned',
      plan_id: 'plan-1',
      task_id: 'task-1',
      city: '北京',
      status: 'completed',
    }))

    expect(conversationRecords.value).toEqual([])
    expect(plannedRecords.value.map((item) => item.record_id)).toEqual(['session-1'])
  })

  test('removes a record after its soft deletion succeeds', () => {
    upsertRecord(record())
    removeRecord('session-1')

    expect(records.value).toEqual([])
  })
})
