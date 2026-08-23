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
