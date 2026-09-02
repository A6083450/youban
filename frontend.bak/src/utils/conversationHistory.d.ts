import type { ChatMessage } from '@/types'

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
