export const CHAT_SESSION_SNAPSHOT_VERSION = 1 as const

const STABLE_ITEM_TYPES = new Set(['text', 'draft', 'failed', 'done'])

export interface SnapshotItem {
  id: number
  role: 'user' | 'assistant'
  type: string
  text?: string
  [key: string]: unknown
}

export interface ChatSessionSnapshotState {
  pendingConfirmId: number | null
  pendingDraft: unknown | null
  pendingReadinessToken?: string
  pendingUserText: string | null
  nextId: number
}

export interface ChatSessionSnapshot extends ChatSessionSnapshotState {
  [key: string]: unknown
  version: typeof CHAT_SESSION_SNAPSHOT_VERSION
  items: SnapshotItem[]
  pendingReadinessToken: string
}

export interface ConversationIdentity {
  sessionId: string | null
  pendingSessionId: string | null
  revision: number
}

const clone = <T>(value: T): T => structuredClone(value)

export const toServerSnapshot = (
  items: readonly SnapshotItem[],
  state: ChatSessionSnapshotState,
): ChatSessionSnapshot => ({
  version: CHAT_SESSION_SNAPSHOT_VERSION,
  items: items.filter((item) => STABLE_ITEM_TYPES.has(item.type)).map(clone),
  pendingConfirmId: state.pendingConfirmId,
  pendingDraft: clone(state.pendingDraft),
  pendingReadinessToken: String(state.pendingReadinessToken ?? ''),
  pendingUserText: state.pendingUserText,
  nextId: Math.max(1, Math.trunc(state.nextId) || 1),
})

export const normalizeServerSnapshot = (value: unknown): ChatSessionSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.items)) return null
  const items = candidate.items.filter((item): item is SnapshotItem => Boolean(
    item
    && typeof item === 'object'
    && Number.isFinite(Number((item as SnapshotItem).id))
    && ((item as SnapshotItem).role === 'user' || (item as SnapshotItem).role === 'assistant')
    && typeof (item as SnapshotItem).type === 'string',
  ))

  return toServerSnapshot(items, {
    pendingConfirmId: candidate.pendingConfirmId !== null
      && candidate.pendingConfirmId !== undefined
      && Number.isFinite(Number(candidate.pendingConfirmId))
      ? Number(candidate.pendingConfirmId)
      : null,
    pendingDraft: candidate.pendingDraft && typeof candidate.pendingDraft === 'object'
      ? clone(candidate.pendingDraft)
      : null,
    pendingReadinessToken: typeof candidate.pendingReadinessToken === 'string'
      ? candidate.pendingReadinessToken
      : '',
    pendingUserText: typeof candidate.pendingUserText === 'string'
      ? candidate.pendingUserText
      : null,
    nextId: Number(candidate.nextId),
  })
}

export const firstUserMessage = (snapshot: ChatSessionSnapshot): string => {
  const first = snapshot.items.find((item) => item.role === 'user' && item.type === 'text')
  return String(first?.text ?? '').trim()
}

export const createConversationIdentity = (): ConversationIdentity => ({
  sessionId: null,
  pendingSessionId: null,
  revision: 0,
})

export const reserveConversationId = (
  identity: ConversationIdentity,
  createId: () => string = () => crypto.randomUUID(),
): string => {
  if (!identity.pendingSessionId) identity.pendingSessionId = createId()
  return identity.pendingSessionId
}

export const acceptConversationRevision = (
  identity: ConversationIdentity,
  sessionId: string,
  revision: number,
): boolean => {
  if (identity.pendingSessionId && identity.pendingSessionId !== sessionId) return false
  if (identity.sessionId && identity.sessionId !== sessionId) return false
  identity.sessionId = sessionId
  identity.pendingSessionId = sessionId
  identity.revision = Math.max(0, Math.trunc(revision) || 0)
  return true
}

export const resetConversationIdentity = (identity: ConversationIdentity): void => {
  identity.sessionId = null
  identity.pendingSessionId = null
  identity.revision = 0
}

export const queryConversationId = (value: unknown): string => {
  if (Array.isArray(value)) return value.length === 1 ? queryConversationId(value[0]) : ''
  return typeof value === 'string' ? value.trim() : ''
}

export const isCurrentConversationSelection = (input: {
  expectedSessionId: string
  selectedSessionId: string
  expectedOwnerId: string
  currentOwnerId: string
  requestToken: number
  currentToken: number
}): boolean => Boolean(
  input.expectedSessionId
  && input.expectedSessionId === input.selectedSessionId
  && input.expectedOwnerId === input.currentOwnerId
  && input.requestToken === input.currentToken,
)

export const legacyImportMarkerKey = (userId: string): string =>
  `tripstar.chat_session_imported.${userId}`

export const isLegacyImportEligible = (input: {
  activeSessionId: string
  importMarked: boolean
  snapshot: unknown
}): boolean => Boolean(
  !input.activeSessionId
  && !input.importMarked
  && input.snapshot
  && typeof input.snapshot === 'object'
  && Array.isArray((input.snapshot as { items?: unknown }).items)
  && ((input.snapshot as { items: unknown[] }).items.length > 0),
)
