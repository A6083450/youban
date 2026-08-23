import { computed, ref } from 'vue'
import { getConversationRecords, getConversationSession, getStoredUser } from '@/services/api'
import type { ConversationRecord } from '@/types'

const TITLE_POLL_ATTEMPTS = 6
const TITLE_POLL_INTERVAL_MS = 500

export const CONVERSATION_RECORDS_UPDATED_EVENT = 'youban:conversation-records-updated'

export const records = ref<ConversationRecord[]>([])
export const recordsLoading = ref(false)

export interface GroupedConversationRecords {
  conversations: ConversationRecord[]
  plans: ConversationRecord[]
}

const sortRecords = (items: readonly ConversationRecord[]): ConversationRecord[] => items
  .map((item, index) => ({ item, index }))
  .sort((left, right) => {
    const difference = right.item.updated_at.localeCompare(left.item.updated_at)
    return difference || left.index - right.index
  })
  .map(({ item }) => item)

export const groupConversationRecords = (
  items: readonly ConversationRecord[],
): GroupedConversationRecords => {
  const linkedPlanIds = new Set(
    items.flatMap((item) => item.session_id && item.plan_id ? [item.plan_id] : []),
  )
  const visible = items.filter((item) => !(item.session_id === null && item.plan_id && linkedPlanIds.has(item.plan_id)))
  const sorted = sortRecords(visible)

  return {
    conversations: sorted.filter((item) => item.kind === 'conversation'),
    plans: sorted.filter((item) => item.kind === 'plan'),
  }
}

export const conversationRecords = computed(() => groupConversationRecords(records.value).conversations)
export const plannedRecords = computed(() => groupConversationRecords(records.value).plans)

export const upsertRecord = (record: ConversationRecord): void => {
  const index = records.value.findIndex((item) => item.record_id === record.record_id)
  if (index === -1) {
    records.value = [record, ...records.value]
    return
  }
  records.value.splice(index, 1, record)
}

export const removeRecord = (recordId: string): void => {
  records.value = records.value.filter((item) => item.record_id !== recordId)
}

export const findRecordBySessionId = (sessionId: string): ConversationRecord | undefined =>
  records.value.find((item) => item.session_id === sessionId)

export const findRecordByPlanId = (planId: string): ConversationRecord | undefined =>
  records.value.find((item) => item.plan_id === planId)

export const isConversationRecordActive = (record: ConversationRecord, sessionId: string): boolean =>
  Boolean(sessionId) && record.session_id === sessionId

export const isPlanRecordActive = (record: ConversationRecord, planId: string): boolean =>
  Boolean(planId) && record.plan_id === planId

export const createOptimisticConversationRecord = (input: {
  sessionId: string
  firstMessage: string
  userId: string
}): ConversationRecord => {
  const now = new Date().toISOString()
  const record: ConversationRecord = {
    record_id: input.sessionId,
    kind: 'conversation',
    session_id: input.sessionId,
    plan_id: null,
    task_id: null,
    title: input.firstMessage.trim() || '新对话',
    title_status: 'pending',
    state: 'chatting',
    revision: 0,
    status: null,
    user_id: input.userId,
    city: '',
    cities: [],
    start_date: '',
    end_date: '',
    travel_days: 0,
    updated_at: now,
    overall_suggestions: '',
    user_deleted_at: null,
  }
  upsertRecord(record)
  return record
}

export const refreshRecords = async (): Promise<void> => {
  recordsLoading.value = true
  try {
    records.value = await getConversationRecords(50)
  } catch {
    records.value = []
  } finally {
    recordsLoading.value = false
  }
}

const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, milliseconds)
})

export const waitForConversationTitle = async (sessionId: string): Promise<void> => {
  const ownerId = getStoredUser()?.user_id || ''
  if (!ownerId) return

  for (let attempt = 0; attempt < TITLE_POLL_ATTEMPTS; attempt += 1) {
    const current = findRecordBySessionId(sessionId)
    if (!current || current.title_status !== 'pending' || getStoredUser()?.user_id !== ownerId) return
    if (attempt > 0) await pause(TITLE_POLL_INTERVAL_MS)

    const pending = findRecordBySessionId(sessionId)
    if (!pending || pending.title_status !== 'pending' || getStoredUser()?.user_id !== ownerId) return
    try {
      upsertRecord(await getConversationSession(sessionId))
    } catch {
      return
    }
  }
}

export const notifyRecordsUpdated = (): void => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONVERSATION_RECORDS_UPDATED_EVENT))
}
