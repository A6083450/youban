import type { AdminConversationRecord } from '@/types'

export type AdminRecordVisibility = 'all' | 'active' | 'user_deleted'
export type AdminRecordStatusFilter = 'all' | 'completed' | 'processing' | 'failed'

export interface AdminRecordFilters {
  visibility: AdminRecordVisibility
  status: AdminRecordStatusFilter
  query: string
  userKey: string
  anonymousLabel: string
}

export interface AdminRecordPage {
  limit: number
  offset: number
}

export interface AdminRecordPageResult {
  items: AdminConversationRecord[]
  total: number
  snapshot_id: string
}

export type AdminRecordPageFetcher = (
  visibility: AdminRecordVisibility,
  page: Readonly<AdminRecordPage>,
) => Promise<AdminRecordPageResult>

const ADMIN_RECORD_MAX_PAGE_REQUESTS = 1_000

export const adminRecordKindKey = (
  record: Pick<AdminConversationRecord, 'kind'>,
): 'admin.trips.kindConversation' | 'admin.trips.kindPlan' => (
  record.kind === 'plan' ? 'admin.trips.kindPlan' : 'admin.trips.kindConversation'
)

export const isAdminRecordPermanentlyDeletable = (
  record: Pick<AdminConversationRecord, 'state' | 'status'>,
): boolean => record.state !== 'generating' && record.status !== 'processing'

export const adminRecordDeletePath = (recordId: string): string => (
  `/api/admin/records/${encodeURIComponent(recordId)}`
)

export const filterAdminRecords = (
  records: readonly AdminConversationRecord[],
  filters: Readonly<AdminRecordFilters>,
): AdminConversationRecord[] => {
  const keyword = filters.query.trim().toLowerCase()
  return records.filter((record) => {
    const userDeleted = record.user_deleted_at !== null
    if (filters.visibility === 'active' && userDeleted) return false
    if (filters.visibility === 'user_deleted' && !userDeleted) return false
    if (filters.userKey !== 'all' && (record.user_id || 'anonymous') !== filters.userKey) return false

    if (filters.status !== 'all') {
      const status = record.state === 'generating' ? 'processing' : record.status
      if (status !== filters.status) return false
    }

    if (!keyword) return true
    const nickname = (record.nickname || filters.anonymousLabel).toLowerCase()
    return nickname.includes(keyword)
      || record.title.toLowerCase().includes(keyword)
      || record.city.toLowerCase().includes(keyword)
  })
}

export const loadAllAdminRecordPages = async (
  visibility: AdminRecordVisibility,
  fetchPage: AdminRecordPageFetcher,
  pageSize = 500,
): Promise<AdminConversationRecord[]> => {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new Error('Admin record page size is invalid')
  }
  const records = new Map<string, AdminConversationRecord>()
  let expectedTotal: number | null = null
  let expectedSnapshotId: string | null = null
  let offset = 0
  for (let pageIndex = 0; pageIndex < ADMIN_RECORD_MAX_PAGE_REQUESTS; pageIndex += 1) {
    const page = await fetchPage(visibility, { limit: pageSize, offset })
    if (!Array.isArray(page.items)) throw new Error('Admin record page items are invalid')
    if (!Number.isSafeInteger(page.total) || page.total < 0) {
      throw new Error('Admin record total is invalid')
    }
    if (typeof page.snapshot_id !== 'string' || !/^[a-f0-9]{64}$/.test(page.snapshot_id)) {
      throw new Error('Admin record snapshot is invalid')
    }
    if (expectedTotal === null) expectedTotal = page.total
    else if (page.total !== expectedTotal) throw new Error('Admin record total changed during pagination')
    if (expectedSnapshotId === null) expectedSnapshotId = page.snapshot_id
    else if (page.snapshot_id !== expectedSnapshotId) {
      throw new Error('Admin record snapshot changed during pagination')
    }

    let added = 0
    for (const record of page.items) {
      if (records.has(record.record_id)) continue
      records.set(record.record_id, record)
      added += 1
    }
    if (records.size > expectedTotal) throw new Error('Admin record page exceeds total')
    if (records.size === expectedTotal) return [...records.values()]
    if (page.items.length === 0 || page.items.length < pageSize) {
      throw new Error('Admin record pagination is incomplete')
    }
    if (added === 0) throw new Error('Admin record pagination made no progress')

    offset += page.items.length
    const expectedRequestBound = Math.ceil(expectedTotal / pageSize) + 2
    if (pageIndex + 1 >= Math.min(expectedRequestBound, ADMIN_RECORD_MAX_PAGE_REQUESTS)) {
      throw new Error('Admin record pagination exceeded its request bound')
    }
  }
  throw new Error('Admin record pagination exceeded its request bound')
}

export interface AdminRecordVisibilityLoadResult {
  current: boolean
  visibility: AdminRecordVisibility
  records: AdminConversationRecord[]
  error?: unknown
}

export interface AdminRecordVisibilityLoader {
  invalidate: () => void
  load: (visibility: AdminRecordVisibility) => Promise<AdminRecordVisibilityLoadResult>
}

export const createAdminRecordVisibilityLoader = (
  fetchPage: AdminRecordPageFetcher,
  pageSize = 500,
): AdminRecordVisibilityLoader => {
  let generation = 0
  return {
    invalidate(): void {
      generation += 1
    },
    async load(visibility: AdminRecordVisibility): Promise<AdminRecordVisibilityLoadResult> {
      const requestGeneration = ++generation
      try {
        const records = await loadAllAdminRecordPages(visibility, fetchPage, pageSize)
        return { current: requestGeneration === generation, visibility, records }
      } catch (error) {
        return { current: requestGeneration === generation, visibility, records: [], error }
      }
    },
  }
}

export const refreshAdminRecordsAfterPermanentDelete = async (
  loader: AdminRecordVisibilityLoader,
  getVisibility: () => AdminRecordVisibility,
  onInvalidated: () => void | Promise<void>,
): Promise<AdminRecordVisibilityLoadResult> => {
  loader.invalidate()
  await onInvalidated()
  return loader.load(getVisibility())
}
