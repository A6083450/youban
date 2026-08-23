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

export type AdminRecordPageFetcher = (
  visibility: AdminRecordVisibility,
  page: Readonly<AdminRecordPage>,
) => Promise<AdminConversationRecord[]>

export const ADMIN_RECORD_MAX_PAGES = 100
export const ADMIN_RECORD_MAX_RECORDS = 50_000

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
  const records = new Map<string, AdminConversationRecord>()
  let offset = 0
  for (let pageIndex = 0; pageIndex < ADMIN_RECORD_MAX_PAGES; pageIndex += 1) {
    const page = await fetchPage(visibility, { limit: pageSize, offset })
    let added = 0
    for (const record of page) {
      if (records.has(record.record_id)) continue
      records.set(record.record_id, record)
      added += 1
      if (records.size >= ADMIN_RECORD_MAX_RECORDS) break
    }
    if (
      page.length < pageSize
      || added === 0
      || records.size >= ADMIN_RECORD_MAX_RECORDS
    ) break
    offset += page.length
  }
  return [...records.values()]
}

export interface AdminRecordVisibilityLoadResult {
  current: boolean
  visibility: AdminRecordVisibility
  records: AdminConversationRecord[]
  error?: unknown
}

export const createAdminRecordVisibilityLoader = (
  fetchPage: AdminRecordPageFetcher,
  pageSize = 500,
) => {
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
