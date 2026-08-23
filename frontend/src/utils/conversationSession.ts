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

export interface ConversationOperationContext {
  readonly token: number
  readonly ownerId: string
  readonly sessionId: string | null
}

export interface ConversationOperationState extends ConversationOperationContext {
  readonly alive: boolean
}

export interface ConversationPersistenceCapture {
  readonly ownerId: string
  readonly sessionId: string | null
  readonly revision: number
  readonly snapshot: ChatSessionSnapshot
}

export interface ConversationPersistenceResult {
  readonly revision?: number
  readonly discardPendingForSession?: boolean
  readonly retryPending?: boolean
}

type ConversationPersistenceWriter = (
  capture: ConversationPersistenceCapture,
) => Promise<ConversationPersistenceResult | void>

export interface PendingConversationSubmission {
  readonly itemId: number
  readonly text: string
  readonly sessionId: string
}

export type ConversationSelectionAction =
  | { type: 'keep' }
  | { type: 'blank' }
  | { type: 'resume-local' }
  | { type: 'restore'; sessionId: string }

export interface RestoredActiveTask {
  readonly taskId: string
  readonly sessionId: string
  readonly city: string
  readonly days: number
  readonly userText: string
  readonly startDate?: string
  readonly endDate?: string
}

export interface ExistingActiveTask {
  readonly taskId: string
  readonly sessionId?: string
  readonly city: string
  readonly days: number
  readonly userText: string
  readonly startDate?: string
  readonly endDate?: string
}

export interface ConversationFallbackStorage {
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const CONVERSATION_PERSISTENCE_ENVELOPE_VERSION = 1 as const
const CONVERSATION_PERSISTENCE_STORAGE_PREFIX = 'tripstar.chat_persistence.'

const clone = <T>(value: T): T => structuredClone(value)

export const captureConversationOperation = (
  context: ConversationOperationContext,
): ConversationOperationContext => ({ ...context })

export const isConversationOperationCurrent = (
  context: ConversationOperationContext,
  current: ConversationOperationState,
): boolean => Boolean(
  current.alive
  && context.token === current.token
  && context.ownerId === current.ownerId
  && context.sessionId === current.sessionId,
)

export const captureConversationPersistence = (
  capture: ConversationPersistenceCapture,
): ConversationPersistenceCapture => ({
  ownerId: capture.ownerId,
  sessionId: capture.sessionId,
  revision: Math.max(0, Math.trunc(capture.revision) || 0),
  snapshot: clone(capture.snapshot),
})

export const conversationPersistenceStoragePrefix = (ownerId: string): string =>
  `${CONVERSATION_PERSISTENCE_STORAGE_PREFIX}${encodeURIComponent(ownerId)}.`

export const conversationPersistenceStorageKey = (ownerId: string, sessionId: string): string =>
  `${conversationPersistenceStoragePrefix(ownerId)}${encodeURIComponent(sessionId)}`

export const serializeConversationPersistenceEnvelope = (
  capture: ConversationPersistenceCapture,
): string => JSON.stringify({
  envelope_version: CONVERSATION_PERSISTENCE_ENVELOPE_VERSION,
  ...captureConversationPersistence(capture),
})

export const parseConversationPersistenceEnvelope = (
  raw: string,
  expectedOwnerId: string,
  expectedSessionId?: string,
): ConversationPersistenceCapture | null => {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const candidate = value as Record<string, unknown>
    const ownerId = typeof candidate.ownerId === 'string' ? candidate.ownerId : ''
    const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId : ''
    const revision = Number(candidate.revision)
    const snapshot = normalizeServerSnapshot(candidate.snapshot)
    if (candidate.envelope_version !== CONVERSATION_PERSISTENCE_ENVELOPE_VERSION
      || ownerId !== expectedOwnerId
      || !sessionId
      || (expectedSessionId !== undefined && sessionId !== expectedSessionId)
      || !Number.isFinite(revision)
      || revision < 0
      || !snapshot) return null
    return captureConversationPersistence({ ownerId, sessionId, revision, snapshot })
  } catch {
    return null
  }
}

export const persistConversationFallback = (
  storage: ConversationFallbackStorage,
  legacyKey: string,
  capture: ConversationPersistenceCapture,
): void => {
  if (capture.sessionId) {
    storage.removeItem(legacyKey)
    storage.setItem(
      conversationPersistenceStorageKey(capture.ownerId, capture.sessionId),
      serializeConversationPersistenceEnvelope(capture),
    )
    return
  }
  if (capture.snapshot.items.length === 0 && !capture.snapshot.pendingUserText) {
    storage.removeItem(legacyKey)
    return
  }
  storage.setItem(legacyKey, JSON.stringify(capture.snapshot))
}

export class ConversationPersistenceQueue {
  private readonly pending: ConversationPersistenceCapture[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private draining: Promise<boolean> | null = null
  private readonly latestRevision = new Map<string, number>()

  constructor(
    private readonly write: ConversationPersistenceWriter,
    private readonly debounceMs = 200,
  ) {}

  schedule(capture: ConversationPersistenceCapture): void {
    const next = captureConversationPersistence(capture)
    const last = this.pending.at(-1)
    if (last?.ownerId === next.ownerId && last.sessionId === next.sessionId) {
      this.pending[this.pending.length - 1] = next
    } else {
      this.pending.push(next)
    }
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
  }

  async flush(): Promise<boolean> {
    this.clearTimer()
    if (!this.draining) {
      this.draining = this.drain().finally(() => { this.draining = null })
    }
    const succeeded = await this.draining
    if (succeeded && this.pending.length > 0) return this.flush()
    return succeeded
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private async drain(): Promise<boolean> {
    while (this.pending.length > 0) {
      const pending = this.pending.shift()!
      const knownRevision = pending.sessionId
        ? this.latestRevision.get(pending.sessionId) ?? pending.revision
        : pending.revision
      const capture = knownRevision === pending.revision
        ? pending
        : { ...pending, revision: knownRevision }
      const result = await this.write(capture)
      if (result?.retryPending) {
        this.pending.unshift(capture)
        return false
      }
      if (!capture.sessionId || !result) continue
      if (Number.isFinite(result.revision)) {
        this.latestRevision.set(capture.sessionId, Math.max(0, Math.trunc(result.revision ?? 0)))
      }
      if (result.discardPendingForSession) {
        for (let index = this.pending.length - 1; index >= 0; index -= 1) {
          if (this.pending[index]?.sessionId === capture.sessionId) this.pending.splice(index, 1)
        }
      }
    }
    return true
  }
}

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

export const legacyImportFollowUp = (created: boolean): {
  markImported: boolean
  resumeInterrupted: boolean
} => ({
  markImported: created,
  resumeInterrupted: created,
})

export const conversationSelectionAction = (input: {
  selectedSessionId: string
  currentSessionId: string
  activeTaskSessionId: string
  initial: boolean
}): ConversationSelectionAction => {
  if (input.selectedSessionId) {
    return input.selectedSessionId === input.currentSessionId
      ? { type: 'keep' }
      : { type: 'restore', sessionId: input.selectedSessionId }
  }
  if (input.initial) {
    return input.activeTaskSessionId
      ? { type: 'restore', sessionId: input.activeTaskSessionId }
      : { type: 'resume-local' }
  }
  return input.currentSessionId ? { type: 'blank' } : { type: 'keep' }
}

export const activeTaskFromConversation = (detail: {
  session_id: string | null
  task_id: string | null
  state: string
  status: string | null
  city: string
  travel_days: number
  start_date: string
  end_date: string
}): RestoredActiveTask | null => {
  const sessionId = detail.session_id?.trim() ?? ''
  const taskId = detail.task_id?.trim() ?? ''
  if (!sessionId || !taskId || (detail.state !== 'generating' && detail.status !== 'processing')) return null
  return {
    taskId,
    sessionId,
    city: detail.city,
    days: Math.max(0, Math.trunc(detail.travel_days) || 0),
    userText: '',
    ...(detail.start_date ? { startDate: detail.start_date } : {}),
    ...(detail.end_date ? { endDate: detail.end_date } : {}),
  }
}

export const mergeRestoredActiveTask = (
  local: ExistingActiveTask | null,
  restored: RestoredActiveTask,
): RestoredActiveTask => {
  if (!local || local.taskId !== restored.taskId) return restored
  return {
    taskId: restored.taskId,
    sessionId: restored.sessionId,
    city: restored.city || local.city,
    days: restored.days || local.days,
    userText: local.userText || restored.userText,
    ...((restored.startDate || local.startDate) ? { startDate: restored.startDate || local.startDate } : {}),
    ...((restored.endDate || local.endDate) ? { endDate: restored.endDate || local.endDate } : {}),
  }
}

export const pendingSubmissionItemId = (
  pending: PendingConversationSubmission | null,
  text: string,
  sessionId: string,
): number | null => pending
  && pending.sessionId === sessionId
  && pending.text === text
  ? pending.itemId
  : null
