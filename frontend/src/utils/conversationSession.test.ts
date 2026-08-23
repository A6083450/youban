import { describe, expect, it } from 'bun:test'
import {
  acceptConversationRevision,
  activeTaskFromConversation,
  captureConversationOperation,
  captureConversationPersistence,
  ConversationPersistenceQueue,
  conversationSelectionAction,
  conversationPersistenceStorageKey,
  conversationPersistenceStoragePrefix,
  createConversationIdentity,
  firstUserMessage,
  isLegacyImportEligible,
  isCurrentConversationSelection,
  isConversationOperationCurrent,
  legacyImportFollowUp,
  legacyImportMarkerKey,
  mergeRestoredActiveTask,
  normalizeServerSnapshot,
  pendingSubmissionItemId,
  parseConversationPersistenceEnvelope,
  persistConversationFallback,
  queryConversationId,
  reserveConversationId,
  resetConversationIdentity,
  toServerSnapshot,
  serializeConversationPersistenceEnvelope,
  type ChatSessionSnapshot,
} from './conversationSession'

const stableState = {
  pendingConfirmId: 3,
  pendingDraft: { city: '乌鲁木齐' },
  pendingReadinessToken: 'ready-1',
  pendingUserText: null,
  nextId: 6,
}

describe('conversation session snapshots', () => {
  it('serializes stable chat items and excludes transient UI items', () => {
    const snapshot = toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text: '国庆新疆玩一个月帮我计划下' },
      { id: 2, role: 'assistant', type: 'streaming', text: '正在' },
      { id: 3, role: 'assistant', type: 'draft', text: '新疆路线', draft: { city: '新疆' } },
      { id: 4, role: 'assistant', type: 'progress', status: { progress: 20 } },
      { id: 5, role: 'assistant', type: 'typing' },
    ], stableState)

    expect(snapshot).toEqual({
      version: 1,
      items: [
        { id: 1, role: 'user', type: 'text', text: '国庆新疆玩一个月帮我计划下' },
        { id: 3, role: 'assistant', type: 'draft', text: '新疆路线', draft: { city: '新疆' } },
      ],
      ...stableState,
    })
    expect(firstUserMessage(snapshot)).toBe('国庆新疆玩一个月帮我计划下')
  })

  it('normalizes legacy snapshots to the versioned server contract', () => {
    const snapshot = normalizeServerSnapshot({
      items: [{ id: 7, role: 'assistant', type: 'text', text: '继续规划' }],
      pendingConfirmId: null,
      pendingDraft: null,
      pendingUserText: '继续',
      nextId: 8,
    })

    expect(snapshot).toEqual({
      version: 1,
      items: [{ id: 7, role: 'assistant', type: 'text', text: '继续规划' }],
      pendingConfirmId: null,
      pendingDraft: null,
      pendingReadinessToken: '',
      pendingUserText: '继续',
      nextId: 8,
    })
  })
})

describe('conversation session identity', () => {
  it('reuses the reserved UUID after a create failure', () => {
    const identity = createConversationIdentity()
    let calls = 0
    const createId = () => `session-${++calls}`

    expect(reserveConversationId(identity, createId)).toBe('session-1')
    expect(reserveConversationId(identity, createId)).toBe('session-1')
    expect(calls).toBe(1)
  })

  it('accepts only revisions for the current durable session', () => {
    const identity = createConversationIdentity()
    identity.pendingSessionId = 'session-1'

    expect(acceptConversationRevision(identity, 'session-1', 2)).toBe(true)
    expect(identity).toEqual({ sessionId: 'session-1', pendingSessionId: 'session-1', revision: 2 })
    expect(acceptConversationRevision(identity, 'older-session', 9)).toBe(false)
    expect(identity.revision).toBe(2)
  })

  it('resets only active identity when starting a new plan', () => {
    const identity = { sessionId: 'session-1', pendingSessionId: 'session-1', revision: 4 }

    resetConversationIdentity(identity)

    expect(identity).toEqual({ sessionId: null, pendingSessionId: null, revision: 0 })
  })
})

describe('conversation session selection and migration', () => {
  it('normalizes a single route query id and rejects ambiguous values', () => {
    expect(queryConversationId(' session-1 ')).toBe('session-1')
    expect(queryConversationId(['session-1'])).toBe('session-1')
    expect(queryConversationId(['session-1', 'session-2'])).toBe('')
    expect(queryConversationId(undefined)).toBe('')
  })

  it('rejects an older restore after route selection or owner changes', () => {
    expect(isCurrentConversationSelection({
      expectedSessionId: 'session-b',
      selectedSessionId: 'session-b',
      expectedOwnerId: 'user-1',
      currentOwnerId: 'user-1',
      requestToken: 4,
      currentToken: 4,
    })).toBe(true)
    expect(isCurrentConversationSelection({
      expectedSessionId: 'session-a',
      selectedSessionId: 'session-b',
      expectedOwnerId: 'user-1',
      currentOwnerId: 'user-1',
      requestToken: 3,
      currentToken: 4,
    })).toBe(false)
    expect(isCurrentConversationSelection({
      expectedSessionId: 'session-b',
      selectedSessionId: 'session-b',
      expectedOwnerId: 'user-1',
      currentOwnerId: 'user-2',
      requestToken: 4,
      currentToken: 4,
    })).toBe(false)
  })

  it('imports a legacy local snapshot only before a server identity or marker exists', () => {
    const snapshot = { items: [{ id: 1, role: 'user', type: 'text', text: '去新疆' }] }

    expect(legacyImportMarkerKey('user-1')).toBe('tripstar.chat_session_imported.user-1')
    expect(isLegacyImportEligible({ activeSessionId: '', importMarked: false, snapshot })).toBe(true)
    expect(isLegacyImportEligible({ activeSessionId: 'session-1', importMarked: false, snapshot })).toBe(false)
    expect(isLegacyImportEligible({ activeSessionId: '', importMarked: true, snapshot })).toBe(false)
    expect(isLegacyImportEligible({ activeSessionId: '', importMarked: false, snapshot: null })).toBe(false)
  })

  it('keeps a failed legacy import pending for explicit retry', () => {
    expect(legacyImportFollowUp(false)).toEqual({ markImported: false, resumeInterrupted: false })
    expect(legacyImportFollowUp(true)).toEqual({ markImported: true, resumeInterrupted: true })
  })

  it('restores an active linked session only during initial empty-query selection', () => {
    expect(conversationSelectionAction({
      selectedSessionId: '',
      currentSessionId: '',
      activeTaskSessionId: 'session-active',
      initial: true,
    })).toEqual({ type: 'restore', sessionId: 'session-active' })
    expect(conversationSelectionAction({
      selectedSessionId: '',
      currentSessionId: 'session-a',
      activeTaskSessionId: 'session-active',
      initial: false,
    })).toEqual({ type: 'blank' })
    expect(conversationSelectionAction({
      selectedSessionId: 'session-b',
      currentSessionId: 'session-a',
      activeTaskSessionId: '',
      initial: false,
    })).toEqual({ type: 'restore', sessionId: 'session-b' })
  })

  it('rebuilds a missing local active task from a generating server conversation', () => {
    expect(activeTaskFromConversation({
      session_id: 'session-1',
      task_id: 'task-1',
      state: 'generating',
      status: 'processing',
      city: '新疆',
      travel_days: 30,
      start_date: '2026-10-01',
      end_date: '2026-10-30',
    })).toEqual({
      taskId: 'task-1',
      sessionId: 'session-1',
      city: '新疆',
      days: 30,
      userText: '',
      startDate: '2026-10-01',
      endDate: '2026-10-30',
    })
    expect(activeTaskFromConversation({
      session_id: 'session-1',
      task_id: 'task-1',
      state: 'chatting',
      status: null,
      city: '',
      travel_days: 0,
      start_date: '',
      end_date: '',
    })).toBeNull()
  })
})

describe('conversation operation ownership', () => {
  it('invalidates a stream when its request, account, session, or component changes', () => {
    const context = captureConversationOperation({ token: 7, ownerId: 'user-1', sessionId: 'session-a' })
    const current = { token: 7, ownerId: 'user-1', sessionId: 'session-a', alive: true }

    expect(isConversationOperationCurrent(context, current)).toBe(true)
    expect(isConversationOperationCurrent(context, { ...current, token: 8 })).toBe(false)
    expect(isConversationOperationCurrent(context, { ...current, ownerId: 'user-2' })).toBe(false)
    expect(isConversationOperationCurrent(context, { ...current, sessionId: 'session-b' })).toBe(false)
    expect(isConversationOperationCurrent(context, { ...current, alive: false })).toBe(false)
  })
})

describe('conversation persistence queue', () => {
  it('captures an immutable snapshot and flushes the outgoing session immediately', async () => {
    const source = toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text: '会话 A' },
    ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 })
    const writes: Array<{ sessionId: string; revision: number; snapshot: ChatSessionSnapshot }> = []
    const queue = new ConversationPersistenceQueue(async (capture) => {
      writes.push(capture)
      return { revision: capture.revision + 1 }
    })

    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-a',
      revision: 3,
      snapshot: source,
    }))
    source.items[0]!.text = '错误地变成会话 B'
    await queue.flush()

    expect(writes).toEqual([{
      ownerId: 'user-1',
      sessionId: 'session-a',
      revision: 3,
      snapshot: {
        version: 1,
        items: [{ id: 1, role: 'user', type: 'text', text: '会话 A' }],
        pendingConfirmId: null,
        pendingDraft: null,
        pendingReadinessToken: 'ready-1',
        pendingUserText: null,
        nextId: 2,
      },
    }])
  })

  it('serializes writes and advances a queued same-session snapshot to the returned revision', async () => {
    let releaseFirst: ((value: { revision: number }) => void) | undefined
    const seen: Array<{ text: string; revision: number }> = []
    const queue = new ConversationPersistenceQueue(async (capture) => {
      seen.push({ text: String(capture.snapshot.items[0]?.text), revision: capture.revision })
      if (seen.length === 1) {
        return await new Promise<{ revision: number }>((resolve) => { releaseFirst = resolve })
      }
      return { revision: capture.revision + 1 }
    })
    const snapshot = (text: string) => toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text },
    ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 })

    queue.schedule(captureConversationPersistence({ ownerId: 'user-1', sessionId: 'session-a', revision: 4, snapshot: snapshot('一') }))
    const flushing = queue.flush()
    await Promise.resolve()
    queue.schedule(captureConversationPersistence({ ownerId: 'user-1', sessionId: 'session-a', revision: 4, snapshot: snapshot('二') }))
    releaseFirst?.({ revision: 5 })
    await flushing

    expect(seen).toEqual([
      { text: '一', revision: 4 },
      { text: '二', revision: 5 },
    ])
  })

  it('retains a failed outgoing capture ahead of a later session until retry succeeds', async () => {
    let shouldFail = true
    const seen: Array<{ sessionId: string | null; text: string }> = []
    const queue = new ConversationPersistenceQueue(async (capture) => {
      seen.push({
        sessionId: capture.sessionId,
        text: String(capture.snapshot.items[0]?.text),
      })
      if (shouldFail) return { retryPending: true }
      return { revision: capture.revision + 1 }
    })
    const snapshot = (text: string) => toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text },
    ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 })

    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-a',
      revision: 2,
      snapshot: snapshot('会话 A'),
    }))
    expect(await queue.flush()).toBe(false)

    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-b',
      revision: 7,
      snapshot: snapshot('会话 B'),
    }))
    shouldFail = false
    expect(await queue.flush()).toBe(true)

    expect(seen).toEqual([
      { sessionId: 'session-a', text: '会话 A' },
      { sessionId: 'session-a', text: '会话 A' },
      { sessionId: 'session-b', text: '会话 B' },
    ])
  })
})

describe('conversation persistence fallback envelope', () => {
  it('round-trips the captured owner, session, revision, and immutable snapshot', () => {
    const capture = captureConversationPersistence({
      ownerId: 'user/1',
      sessionId: 'session 1',
      revision: 6,
      snapshot: toServerSnapshot([
        { id: 1, role: 'user', type: 'text', text: '会话内容' },
      ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 }),
    })
    const raw = serializeConversationPersistenceEnvelope(capture)

    expect(conversationPersistenceStoragePrefix('user/1')).toBe('tripstar.chat_persistence.user%2F1.')
    expect(conversationPersistenceStorageKey('user/1', 'session 1')).toBe(
      'tripstar.chat_persistence.user%2F1.session%201',
    )
    expect(parseConversationPersistenceEnvelope(raw, 'user/1', 'session 1')).toEqual(capture)
    expect(parseConversationPersistenceEnvelope(raw, 'user-2', 'session 1')).toBeNull()
    expect(parseConversationPersistenceEnvelope(raw, 'user/1', 'session-2')).toBeNull()
  })

  it('rejects raw legacy snapshots that do not carry durable identity', () => {
    expect(parseConversationPersistenceEnvelope(JSON.stringify({
      version: 1,
      items: [{ id: 1, role: 'user', type: 'text', text: '旧快照' }],
    }), 'user-1')).toBeNull()
  })

  it('retires an earlier undurable fallback when the queued durable capture writes', async () => {
    const values = new Map<string, string>()
    const storage = {
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const legacyKey = 'tripstar.chat_session.user-1'
    const snapshot = toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text: '去新疆' },
    ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 })
    const queue = new ConversationPersistenceQueue(async (capture) => {
      persistConversationFallback(storage, legacyKey, capture)
      return { revision: capture.revision + 1 }
    })

    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: null,
      revision: 0,
      snapshot,
    }))
    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-1',
      revision: 1,
      snapshot,
    }))
    await queue.flush()

    expect(values.has(legacyKey)).toBe(false)
    expect(values.has(conversationPersistenceStorageKey('user-1', 'session-1'))).toBe(true)
  })
})

describe('restored active task upgrade', () => {
  it('adds a missing session id without discarding richer legacy task metadata', () => {
    expect(mergeRestoredActiveTask({
      taskId: 'task-1',
      city: '新疆',
      days: 30,
      userText: '国庆新疆玩一个月帮我计划下',
      startDate: '2026-10-01',
      endDate: '2026-10-30',
    }, {
      taskId: 'task-1',
      sessionId: 'session-1',
      city: '',
      days: 0,
      userText: '',
    })).toEqual({
      taskId: 'task-1',
      sessionId: 'session-1',
      city: '新疆',
      days: 30,
      userText: '国庆新疆玩一个月帮我计划下',
      startDate: '2026-10-01',
      endDate: '2026-10-30',
    })
  })
})

describe('failed session creation retry', () => {
  it('reuses the existing pending user bubble for the same explicit retry', () => {
    expect(pendingSubmissionItemId({ itemId: 9, text: '去新疆', sessionId: 'session-1' }, '去新疆', 'session-1')).toBe(9)
    expect(pendingSubmissionItemId({ itemId: 9, text: '去新疆', sessionId: 'session-1' }, '改去北京', 'session-1')).toBeNull()
    expect(pendingSubmissionItemId({ itemId: 9, text: '去新疆', sessionId: 'session-1' }, '去新疆', 'session-2')).toBeNull()
  })
})
