import { describe, expect, it } from 'bun:test'
import {
  acceptConversationRevision,
  createConversationIdentity,
  firstUserMessage,
  isLegacyImportEligible,
  isCurrentConversationSelection,
  legacyImportMarkerKey,
  normalizeServerSnapshot,
  queryConversationId,
  reserveConversationId,
  resetConversationIdentity,
  toServerSnapshot,
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
})
