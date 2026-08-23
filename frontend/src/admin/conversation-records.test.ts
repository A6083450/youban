import { describe, expect, it } from 'bun:test'
import type { AdminConversationRecord } from '@/types'
import {
  adminRecordDeletePath,
  adminRecordKindKey,
  filterAdminRecords,
  isAdminRecordPermanentlyDeletable,
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
})
