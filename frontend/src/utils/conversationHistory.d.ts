import type { ChatMessage } from '@/types'

export const CONFIRMATION_CARD_HISTORY_MESSAGE: string

export interface ConversationHistoryItem {
  id: number
  role: 'user' | 'assistant'
  type: string
  text?: string
}

export function buildConversationHistory(
  items: ConversationHistoryItem[],
  currentUserItemId: number,
  limit?: number
): ChatMessage[]
