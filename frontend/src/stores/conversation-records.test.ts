import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  conversationRecords,
  createOptimisticConversationRecord,
  groupConversationRecords,
  invalidateAllConversationTitlePolling,
  invalidateConversationTitlePolling,
  isGeneratingRecord,
  plannedRecords,
  records,
  removeRecord,
  syncRecordsForAuthentication,
  shouldClearActiveTripTask,
  shouldShowActiveTripTaskFallback,
  upsertRecord,
  waitForConversationTitle,
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

  test('does not request private records until authentication is ready', async () => {
    const refresh = mock(async () => undefined)
    const clear = mock(() => undefined)

    await syncRecordsForAuthentication(false, { refresh, clear })
    expect(refresh).not.toHaveBeenCalled()
    expect(clear).toHaveBeenCalledTimes(1)

    await syncRecordsForAuthentication(true, { refresh, clear })
    expect(refresh).toHaveBeenCalledTimes(1)
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
      title: '新对话',
      userId: 'user-1',
    })

    expect(conversationRecords.value).toHaveLength(1)
    expect(conversationRecords.value[0]?.title).toBe('新对话')
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

  test('does not resurrect a deleted record when an in-flight title request resolves', async () => {
    upsertRecord(record({ title_status: 'pending' }))
    let resolveDetail: (value: ReturnType<typeof record>) => void = () => undefined
    const getConversationSession = mock(() => new Promise<ReturnType<typeof record>>((resolve) => {
      resolveDetail = resolve
    }))

    const polling = waitForConversationTitle('session-1', {
      getConversationSession,
      getUserId: () => 'user-1',
      pause: async () => undefined,
    })
    await Promise.resolve()
    removeRecord('session-1')
    invalidateConversationTitlePolling('session-1')
    resolveDetail(record({ title: '北京三日游', title_status: 'generated' }))
    await polling

    expect(getConversationSession).toHaveBeenCalledTimes(1)
    expect(records.value).toEqual([])
  })

  test('does not apply an in-flight title request after authentication invalidates polling', async () => {
    upsertRecord(record({ title_status: 'pending' }))
    let userId = 'user-1'
    let resolveDetail: (value: ReturnType<typeof record>) => void = () => undefined
    const getConversationSession = mock(() => new Promise<ReturnType<typeof record>>((resolve) => {
      resolveDetail = resolve
    }))

    const polling = waitForConversationTitle('session-1', {
      getConversationSession,
      getUserId: () => userId,
      pause: async () => undefined,
    })
    await Promise.resolve()
    userId = 'user-2'
    invalidateAllConversationTitlePolling()
    resolveDetail(record({ title: '北京三日游', title_status: 'generated' }))
    await polling

    expect(records.value[0]?.title_status).toBe('pending')
  })

  test('bounds title polling and stops without a locally pending record', async () => {
    const getConversationSession = mock(async () => record({ title_status: 'pending' }))

    await waitForConversationTitle('missing', {
      getConversationSession,
      getUserId: () => 'user-1',
      pause: async () => undefined,
      maxAttempts: 2,
    })

    expect(getConversationSession).not.toHaveBeenCalled()

    upsertRecord(record({ title_status: 'pending' }))
    await waitForConversationTitle('session-1', {
      getConversationSession,
      getUserId: () => 'user-1',
      pause: async () => undefined,
      maxAttempts: 2,
    })

    expect(getConversationSession).toHaveBeenCalledTimes(2)
  })

  test('keeps the localized optimistic title while the generated title is pending', async () => {
    createOptimisticConversationRecord({
      sessionId: 'session-1',
      title: 'New conversation',
      userId: 'user-1',
    })

    await waitForConversationTitle('session-1', {
      getConversationSession: async () => record({ title: '新对话', title_status: 'pending' }),
      getUserId: () => 'user-1',
      pause: async () => undefined,
      maxAttempts: 1,
    })

    expect(records.value[0]?.title).toBe('New conversation')
  })

  test('derives the generating badge from record lifecycle state', () => {
    const generatingSession = record({
      title_status: 'generated',
      state: 'generating',
      status: 'processing',
      plan_id: 'plan-1',
      task_id: 'task-1',
    })
    const processingConversation = record({ title_status: 'generated', status: 'processing' })

    expect(isGeneratingRecord(generatingSession)).toBe(true)
    expect(isGeneratingRecord(processingConversation)).toBe(true)
    expect(isGeneratingRecord(record())).toBe(false)
  })

  test('uses the record row as the only return entry when it already represents the active generation', () => {
    const activeTask = { taskId: 'task-1', sessionId: 'session-1' }
    const generatingSession = record({
      state: 'generating',
      status: 'processing',
      plan_id: 'plan-1',
      task_id: 'task-1',
    })

    expect(shouldShowActiveTripTaskFallback(activeTask, [generatingSession])).toBe(false)
    expect(shouldShowActiveTripTaskFallback(activeTask, [
      record({ record_id: 'other', session_id: 'other' }),
    ])).toBe(true)
    expect(shouldShowActiveTripTaskFallback({ taskId: 'task-1' }, [generatingSession])).toBe(false)
    expect(shouldShowActiveTripTaskFallback(activeTask, [record({
      kind: 'plan',
      state: 'planned',
      status: 'completed',
      plan_id: 'task-1',
      task_id: 'task-1',
    })])).toBe(false)
  })

  test('clears a stale active task marker once the matching record is terminal', () => {
    const activeTask = { taskId: 'task-1', sessionId: 'session-1' }

    expect(shouldClearActiveTripTask(activeTask, [record({
      state: 'generating',
      status: 'processing',
      task_id: 'task-1',
    })])).toBe(false)
    expect(shouldClearActiveTripTask(activeTask, [record({
      kind: 'plan',
      state: 'planned',
      status: 'completed',
      plan_id: 'task-1',
      task_id: 'task-1',
    })])).toBe(true)
    expect(shouldClearActiveTripTask(activeTask, [record({
      record_id: 'other',
      session_id: 'other',
      task_id: 'other',
    })])).toBe(false)
  })
})
