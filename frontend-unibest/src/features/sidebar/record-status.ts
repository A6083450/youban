import type { ConversationRecordDto } from '@youban/contracts'

export type SidebarPlanBadge = 'processing' | 'failed' | 'ongoing' | null

export function localDateText(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function sidebarPlanBadge(record: ConversationRecordDto, today = localDateText()): SidebarPlanBadge {
  if (record.state === 'generating' || record.status === 'processing')
    return 'processing'
  if (record.status === 'failed')
    return 'failed'
  if (
    record.status === 'completed'
    && Boolean(record.start_date)
    && Boolean(record.end_date)
    && record.start_date <= today
    && record.end_date >= today
  ) {
    return 'ongoing'
  }
  return null
}
