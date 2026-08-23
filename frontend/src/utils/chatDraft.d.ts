import type { ParsedTripDraft } from '@/types'

export interface ConversationalDraftItem {
  id: number
  role: 'assistant'
  type: 'draft'
  text: string
  draft: ParsedTripDraft
  ready: boolean
}

export function formatChatDraft(draft: ParsedTripDraft, locale?: string): string
export function shouldShowDraftActions(readyToGenerate?: boolean, readinessToken?: string): boolean
export function migrateLegacyDraftItems<T>(items: T[], locale?: string): Array<T | ConversationalDraftItem>
