import { describe, expect, it } from 'bun:test'
import { reactive, ref } from 'vue'
import {
  acceptConversationRevision,
  activeTaskFromConversation,
  captureConversationOperation,
  captureConversationPersistence,
  captureConversationRestore,
  cancelConversationRestore,
  ConversationPersistenceQueue,
  conversationSelectionAction,
  conversationPersistenceStorageKey,
  conversationPersistenceStoragePrefix,
  createConversationIdentity,
  firstUserMessage,
  isLegacyImportEligible,
  isCurrentConversationSelection,
  isConversationOperationCurrent,
  isConversationRestoreCurrent,
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
  runWithConversationDeadline,
  toServerSnapshot,
  serializeConversationPersistenceEnvelope,
  type ChatSessionSnapshot,
  type SnapshotItem,
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

  it('projects nested Vue reactive proxies into stable JSON-safe snapshot data', () => {
    const items = ref<SnapshotItem[]>([])
    const nestedPreferences = reactive({ pace: 'slow', tags: ['history', 'food'] })
    const draft = reactive({
      city: '新疆',
      preferences: nestedPreferences,
      ignored: () => 'not serializable',
    })
    items.value.push({
      id: 1,
      role: 'assistant',
      type: 'draft',
      text: '新疆路线',
      draft,
      ignored: Symbol('transient'),
    })
    const pendingDraft = reactive({ city: '新疆', details: reactive({ days: 30 }) })

    const snapshot = toServerSnapshot(items.value, {
      pendingConfirmId: 1,
      pendingDraft,
      pendingReadinessToken: 'ready-proxy',
      pendingUserText: null,
      nextId: 2,
    })

    expect(snapshot).toEqual({
      version: 1,
      items: [{
        id: 1,
        role: 'assistant',
        type: 'draft',
        text: '新疆路线',
        draft: {
          city: '新疆',
          preferences: { pace: 'slow', tags: ['history', 'food'] },
        },
      }],
      pendingConfirmId: 1,
      pendingDraft: { city: '新疆', details: { days: 30 } },
      pendingReadinessToken: 'ready-proxy',
      pendingUserText: null,
      nextId: 2,
    })
    expect(() => JSON.stringify(snapshot)).not.toThrow()
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

  it('keeps reset input blocked and rejects an old reset after a newer operation starts', async () => {
    let operationToken = 0
    let busy = false
    let sessionId: string | null = 'session-a'
    let releaseFlush: (() => void) | undefined
    const flush = new Promise<void>((resolve) => { releaseFlush = resolve })
    const context = captureConversationOperation({
      token: ++operationToken,
      ownerId: 'user-1',
      sessionId,
    })
    busy = true

    const resetting = (async () => {
      await flush
      if (!isConversationOperationCurrent(context, {
        token: operationToken,
        ownerId: 'user-1',
        sessionId,
        alive: true,
      })) return
      sessionId = null
      busy = false
    })()

    expect(busy).toBe(true)
    expect(sessionId).toBe('session-a')
    operationToken += 1
    releaseFlush?.()
    await resetting
    expect(sessionId).toBe('session-a')
    expect(busy).toBe(true)
  })

  it('aborts a never-resolving conversation request at its deadline or parent cancellation', async () => {
    let deadlineSignal: AbortSignal | undefined
    const deadlineRequest = runWithConversationDeadline(async (signal) => {
      deadlineSignal = signal
      return await new Promise<string>(() => {})
    }, 5)

    await expect(deadlineRequest).rejects.toThrow('timed out')
    expect(deadlineSignal?.aborted).toBe(true)

    const parent = new AbortController()
    let cancellationSignal: AbortSignal | undefined
    const cancelledRequest = runWithConversationDeadline(async (signal) => {
      cancellationSignal = signal
      return await new Promise<string>(() => {})
    }, 1_000, parent.signal)
    parent.abort()

    await expect(cancelledRequest).rejects.toThrow('cancelled')
    expect(cancellationSignal?.aborted).toBe(true)
  })

  it('cancels a pending A-to-B restore and releases its input lock when routing back to A', () => {
    const controller = new AbortController()
    const displayedSessionId = 'session-a'
    let busy = true
    const restoreOwnedBusy = cancelConversationRestore({
      controller,
      operationToken: 8,
      ownerId: 'user-1',
      sessionId: 'session-b',
    }, {
      operationToken: 8,
      ownerId: 'user-1',
    })
    if (restoreOwnedBusy) busy = false

    expect(controller.signal.aborted).toBe(true)
    expect(displayedSessionId).toBe('session-a')
    expect(busy).toBe(false)

    const newerOperationController = new AbortController()
    expect(cancelConversationRestore({
      controller: newerOperationController,
      operationToken: 8,
      ownerId: 'user-1',
      sessionId: 'session-b',
    }, {
      operationToken: 9,
      ownerId: 'user-1',
    })).toBe(false)
    expect(newerOperationController.signal.aborted).toBe(true)
  })

  it('invalidates a restore when its request, operation, account, route, or component changes', () => {
    const context = captureConversationRestore({
      restoreToken: 4,
      operationToken: 9,
      ownerId: 'user-1',
      sessionId: 'session-b',
    })
    const current = {
      restoreToken: 4,
      operationToken: 9,
      ownerId: 'user-1',
      selectedSessionId: 'session-b',
      alive: true,
    }

    expect(isConversationRestoreCurrent(context, current)).toBe(true)
    expect(isConversationRestoreCurrent(context, { ...current, restoreToken: 5 })).toBe(false)
    expect(isConversationRestoreCurrent(context, { ...current, operationToken: 10 })).toBe(false)
    expect(isConversationRestoreCurrent(context, { ...current, ownerId: 'user-2' })).toBe(false)
    expect(isConversationRestoreCurrent(context, { ...current, selectedSessionId: 'session-c' })).toBe(false)
    expect(isConversationRestoreCurrent(context, { ...current, alive: false })).toBe(false)
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

  it('retains a transiently failed capture without blocking a later session', async () => {
    let shouldFail = true
    const seen: Array<{ sessionId: string | null; text: string }> = []
    const queue = new ConversationPersistenceQueue(async (capture) => {
      seen.push({
        sessionId: capture.sessionId,
        text: String(capture.snapshot.items[0]?.text),
      })
      if (shouldFail && capture.sessionId === 'session-a') return { retryPending: true }
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
    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-b',
      revision: 7,
      snapshot: snapshot('会话 B'),
    }))
    expect(await queue.flush()).toBe(false)
    expect(seen).toEqual([
      { sessionId: 'session-a', text: '会话 A' },
      { sessionId: 'session-b', text: '会话 B' },
    ])

    shouldFail = false
    expect(await queue.flush()).toBe(true)

    expect(seen).toEqual([
      { sessionId: 'session-a', text: '会话 A' },
      { sessionId: 'session-b', text: '会话 B' },
      { sessionId: 'session-a', text: '会话 A' },
    ])
  })

  it('drops a permanently deleted session and advances to the next session', async () => {
    const seen: Array<string | null> = []
    const queue = new ConversationPersistenceQueue(async (capture) => {
      seen.push(capture.sessionId)
      if (capture.sessionId === 'session-deleted') return { discardPendingForSession: true }
      return { revision: capture.revision + 1 }
    }, 0)
    const snapshot = toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text: '内容' },
    ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 })

    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-deleted',
      revision: 1,
      snapshot,
    }))
    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-live',
      revision: 3,
      snapshot,
    }))

    expect(await queue.flush()).toBe(true)
    expect(seen).toEqual(['session-deleted', 'session-live'])
  })

  it('reports pending persistence per session after another session resolves authoritatively', async () => {
    const queue = new ConversationPersistenceQueue(async (capture) => {
      if (capture.sessionId === 'session-a') return { retryPending: true }
      return { revision: 9, discardPendingForSession: true }
    }, 0)
    const snapshot = (text: string) => toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text },
    ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 })
    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-a',
      revision: 1,
      snapshot: snapshot('会话 A 本地'),
    }))
    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-b',
      revision: 4,
      snapshot: snapshot('会话 B 旧本地'),
    }))

    expect(await queue.flush()).toBe(false)
    expect(queue.hasPending('user-1', 'session-a')).toBe(true)
    expect(queue.hasPending('user-1', 'session-b')).toBe(false)
    const serverSnapshot = snapshot('会话 B 服务端权威内容')
    const persistedSnapshot = snapshot('会话 B 旧本地')
    const restored = queue.hasPending('user-1', 'session-b') ? persistedSnapshot : serverSnapshot
    expect(restored.items[0]?.text).toBe('会话 B 服务端权威内容')
  })

  it('bounds a stalled write, aborts it, and still writes a later session', async () => {
    const seen: Array<string | null> = []
    let stalledSignal: AbortSignal | undefined
    const queue = new ConversationPersistenceQueue(async (capture, signal) => {
      seen.push(capture.sessionId)
      if (capture.sessionId === 'session-stalled') {
        stalledSignal = signal
        return await new Promise(() => {})
      }
      return { revision: capture.revision + 1 }
    }, 0, 5)
    const snapshot = toServerSnapshot([
      { id: 1, role: 'user', type: 'text', text: '内容' },
    ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 })
    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-stalled',
      revision: 1,
      snapshot,
    }))
    queue.schedule(captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-live',
      revision: 2,
      snapshot,
    }))

    const startedAt = Date.now()
    expect(await queue.flush()).toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(500)
    expect(stalledSignal?.aborted).toBe(true)
    expect(seen).toEqual(['session-stalled', 'session-live'])
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

  it('preserves the raw fallback when writing its durable envelope fails', () => {
    const legacyKey = 'tripstar.chat_session.user-1'
    const values = new Map([[legacyKey, 'recoverable raw snapshot']])
    const storage = {
      setItem: (key: string, value: string) => {
        if (key !== legacyKey) throw new Error('quota exceeded')
        values.set(key, value)
      },
      removeItem: (key: string) => { values.delete(key) },
    }
    const capture = captureConversationPersistence({
      ownerId: 'user-1',
      sessionId: 'session-1',
      revision: 1,
      snapshot: toServerSnapshot([
        { id: 1, role: 'user', type: 'text', text: '去新疆' },
      ], { ...stableState, pendingConfirmId: null, pendingDraft: null, nextId: 2 }),
    })

    expect(() => persistConversationFallback(storage, legacyKey, capture)).toThrow('quota exceeded')
    expect(values.get(legacyKey)).toBe('recoverable raw snapshot')
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
