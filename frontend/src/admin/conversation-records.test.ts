import { describe, expect, it } from 'bun:test'
import type { AdminConversationRecord } from '@/types'
import {
  adminRecordDeletePath,
  adminRecordKindKey,
  createAdminRecordVisibilityLoader,
  filterAdminRecords,
  isAdminRecordPermanentlyDeletable,
  loadAllAdminRecordPages,
  refreshAdminRecordsAfterPermanentDelete,
} from './conversation-records'

const record = (
  overrides: Partial<AdminConversationRecord> = {},
): AdminConversationRecord => ({
  record_id: 'session:active-chat',
  kind: 'conversation',
  session_id: 'active-chat',
  plan_id: null,
  task_id: null,
  title: '国庆新疆旅行想法',
  title_status: 'generated',
  state: 'chatting',
  revision: 2,
  status: null,
  user_id: 'user-1',
  nickname: '小艾',
  city: '',
  cities: [],
  start_date: '',
  end_date: '',
  travel_days: 0,
  updated_at: '2026-08-24T10:00:00Z',
  overall_suggestions: '',
  user_deleted_at: null,
  ...overrides,
})

const records = [
  record(),
  record({
    record_id: 'session:deleted-chat',
    session_id: 'deleted-chat',
    title: '北京周末对话',
    user_deleted_at: '2026-08-24T11:00:00Z',
  }),
  record({
    record_id: 'task:completed-plan',
    kind: 'plan',
    session_id: null,
    plan_id: 'completed-plan',
    task_id: 'completed-plan',
    title: '杭州周末游',
    state: 'planned',
    status: 'completed',
    city: '杭州',
    start_date: '2026-10-01',
    end_date: '2026-10-03',
    travel_days: 3,
    user_id: 'user-2',
    nickname: 'Jason',
  }),
]

describe('admin conversation record projection', () => {
  it('filters all, active, and user-deleted records without hiding either kind', () => {
    expect(filterAdminRecords(records, {
      visibility: 'all',
      status: 'all',
      query: '',
      userKey: 'all',
      anonymousLabel: '未登录用户',
    }).map((item) => item.record_id)).toEqual([
      'session:active-chat',
      'session:deleted-chat',
      'task:completed-plan',
    ])

    expect(filterAdminRecords(records, {
      visibility: 'active',
      status: 'all',
      query: '',
      userKey: 'all',
      anonymousLabel: '未登录用户',
    }).map((item) => item.record_id)).toEqual([
      'session:active-chat',
      'task:completed-plan',
    ])

    expect(filterAdminRecords(records, {
      visibility: 'user_deleted',
      status: 'all',
      query: '',
      userKey: 'all',
      anonymousLabel: '未登录用户',
    }).map((item) => item.record_id)).toEqual(['session:deleted-chat'])
  })

  it('preserves user and status filters while search matches nickname, title, or city', () => {
    expect(filterAdminRecords(records, {
      visibility: 'all',
      status: 'completed',
      query: 'jason',
      userKey: 'user-2',
      anonymousLabel: '未登录用户',
    }).map((item) => item.record_id)).toEqual(['task:completed-plan'])

    expect(filterAdminRecords(records, {
      visibility: 'all',
      status: 'all',
      query: '新疆',
      userKey: 'all',
      anonymousLabel: '未登录用户',
    }).map((item) => item.record_id)).toEqual(['session:active-chat'])

    expect(filterAdminRecords(records, {
      visibility: 'all',
      status: 'all',
      query: '杭州',
      userKey: 'all',
      anonymousLabel: '未登录用户',
    }).map((item) => item.record_id)).toEqual(['task:completed-plan'])
  })

  it('projects distinct translation keys for conversations and plans', () => {
    expect(adminRecordKindKey(record({ kind: 'conversation' }))).toBe('admin.trips.kindConversation')
    expect(adminRecordKindKey(record({ kind: 'plan' }))).toBe('admin.trips.kindPlan')
  })

  it('allows permanent deletion only after generation or processing has stopped', () => {
    expect(isAdminRecordPermanentlyDeletable(record())).toBe(true)
    expect(isAdminRecordPermanentlyDeletable(record({ state: 'generating' }))).toBe(false)
    expect(isAdminRecordPermanentlyDeletable(record({ status: 'processing' }))).toBe(false)
    expect(isAdminRecordPermanentlyDeletable(record({ status: 'failed' }))).toBe(true)
  })

  it('encodes namespaced record ids as a single permanent-delete path segment', () => {
    expect(adminRecordDeletePath('session:active-chat')).toBe('/api/admin/records/session%3Aactive-chat')
    expect(adminRecordDeletePath('task:completed-plan')).toBe('/api/admin/records/task%3Acompleted-plan')
  })

  it('keeps paging through duplicate overlap when each full page still adds new record ids', async () => {
    const source = Array.from({ length: 1_201 }, (_, index) => record({
      record_id: `session:deleted-${index}`,
      session_id: `deleted-${index}`,
      user_deleted_at: '2026-08-24T11:00:00Z',
    }))
    source.splice(500, 0, source[499]!)
    const requests: Array<{ visibility: string; limit: number; offset: number }> = []

    const loaded = await loadAllAdminRecordPages('user_deleted', async (visibility, page) => {
      requests.push({ visibility, ...page })
      return {
        items: source.slice(page.offset, page.offset + page.limit),
        total: 1_201,
      }
    }, 500)

    expect(loaded).toHaveLength(1_201)
    expect(new Set(loaded.map((item) => item.record_id)).size).toBe(1_201)
    expect(requests).toEqual([
      { visibility: 'user_deleted', limit: 500, offset: 0 },
      { visibility: 'user_deleted', limit: 500, offset: 500 },
      { visibility: 'user_deleted', limit: 500, offset: 1000 },
    ])
  })

  it('rejects a full repeated page that makes no progress toward total', async () => {
    const repeatedPage = Array.from({ length: 500 }, (_, index) => record({
      record_id: `session:repeated-${index}`,
      session_id: `repeated-${index}`,
    }))
    let calls = 0

    const loading = loadAllAdminRecordPages('all', async () => {
      calls += 1
      if (calls > 4) throw new Error('pagination did not terminate')
      return { items: repeatedPage, total: 1_000 }
    })

    await expect(loading).rejects.toThrow('progress')
    expect(calls).toBe(2)
  })

  it('does not silently truncate a conceptual total above 50,000 records', async () => {
    let calls = 0

    const loading = loadAllAdminRecordPages('all', async () => {
      calls += 1
      if (calls > 2) throw new Error('pagination did not terminate')
      return calls === 1
        ? { items: [record({ record_id: 'session:first-of-many' })], total: 50_001 }
        : { items: [], total: 50_001 }
    }, 1)

    await expect(loading).rejects.toThrow('incomplete')
    expect(calls).toBe(2)
  })

  it('throws instead of returning partial records at the protective request bound', async () => {
    let calls = 0
    const loading = loadAllAdminRecordPages('all', async () => {
      calls += 1
      return {
        items: [record({ record_id: `session:bounded-${calls}` })],
        total: 1_001,
      }
    }, 1)

    await expect(loading).rejects.toThrow('request bound')
    expect(calls).toBe(1_000)
  })

  it('rejects a short page before the stable total is complete', async () => {
    const loading = loadAllAdminRecordPages('active', async () => ({
      items: [record({ record_id: 'session:only-one' })],
      total: 3,
    }), 2)

    await expect(loading).rejects.toThrow('incomplete')
  })

  it('rejects missing, invalid, or changing totals', async () => {
    for (const invalidTotal of [undefined, -1, 1.5, Number.NaN]) {
      await expect(loadAllAdminRecordPages('all', async () => ({
        items: [],
        total: invalidTotal,
      }))).rejects.toThrow('total')
    }

    let page = 0
    await expect(loadAllAdminRecordPages('all', async () => {
      page += 1
      return page === 1
        ? { items: [record({ record_id: 'session:first' })], total: 2 }
        : { items: [record({ record_id: 'session:second' })], total: 3 }
    }, 1)).rejects.toThrow('changed')
  })

  it('marks an older visibility request stale when a newer filter resolves first', async () => {
    let resolveActive: ((value: AdminConversationRecord[]) => void) | undefined
    const activePage = new Promise<AdminConversationRecord[]>((resolve) => {
      resolveActive = resolve
    })
    const loader = createAdminRecordVisibilityLoader(async (visibility) => (
      visibility === 'active'
        ? activePage.then((items) => ({ items, total: items.length }))
        : {
            items: [record({ record_id: 'session:deleted-latest', user_deleted_at: '2026-08-24T11:00:00Z' })],
            total: 1,
          }
    ), 500)

    const older = loader.load('active')
    const newer = await loader.load('user_deleted')
    resolveActive?.([record({ record_id: 'session:active-late' })])
    const late = await older

    expect(newer).toEqual(expect.objectContaining({
      current: true,
      visibility: 'user_deleted',
      records: [expect.objectContaining({ record_id: 'session:deleted-latest' })],
    }))
    expect(late).toEqual(expect.objectContaining({
      current: false,
      visibility: 'active',
      records: [expect.objectContaining({ record_id: 'session:active-late' })],
    }))
  })

  it('coordinates panel deletion so invalidation precedes its authoritative current-visibility reload', async () => {
    const deletedRecord = record({ record_id: 'session:deleted-during-load' })
    let resolveOld: ((value: AdminConversationRecord[]) => void) | undefined
    let request = 0
    const requestedVisibilities: string[] = []
    const loader = createAdminRecordVisibilityLoader(async (visibility) => {
      request += 1
      requestedVisibilities.push(visibility)
      if (request === 1) {
        const items = await new Promise<AdminConversationRecord[]>((resolve) => {
          resolveOld = resolve
        })
        return { items, total: items.length }
      }
      return { items: [], total: 0 }
    })
    let rendered = [deletedRecord]
    const commit = (result: Awaited<ReturnType<typeof loader.load>>) => {
      if (result.current) rendered = result.records
    }

    const staleLoad = loader.load('all')
    const current = await refreshAdminRecordsAfterPermanentDelete(
      loader,
      () => 'active',
      async () => {
        rendered = rendered.filter((item) => item.record_id !== deletedRecord.record_id)
        resolveOld?.([deletedRecord])
        commit(await staleLoad)
        expect(rendered).toEqual([])
      },
    )
    commit(current)

    expect(request).toBe(2)
    expect(requestedVisibilities).toEqual(['all', 'active'])
    expect(current).toEqual(expect.objectContaining({ current: true, visibility: 'active' }))
    expect(rendered).toEqual([])
  })

  it('reports a current load error while keeping a late older error stale', async () => {
    let rejectOld: ((reason: Error) => void) | undefined
    const oldPage = new Promise<never>((_resolve, reject) => {
      rejectOld = reject
    })
    const loader = createAdminRecordVisibilityLoader(async (visibility) => {
      if (visibility === 'active') return oldPage
      if (visibility === 'user_deleted') return { items: [], total: 0 }
      throw new Error('current list failed')
    })

    const older = loader.load('active')
    const newer = await loader.load('user_deleted')
    rejectOld?.(new Error('late stale failure'))
    const staleFailure = await older
    const currentFailure = await loader.load('all')

    expect(newer).toEqual(expect.objectContaining({ current: true, records: [] }))
    expect(staleFailure).toEqual(expect.objectContaining({
      current: false,
      error: expect.objectContaining({ message: 'late stale failure' }),
    }))
    expect(currentFailure).toEqual(expect.objectContaining({
      current: true,
      error: expect.objectContaining({ message: 'current list failed' }),
    }))
  })
})
