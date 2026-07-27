import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConversationHistory,
  CONFIRMATION_CARD_HISTORY_MESSAGE,
} from './conversationHistory.js'

test('includes confirmation card semantics as assistant history and excludes current user message', () => {
  const items = [
    { id: 1, role: 'user', type: 'text', text: '规划大理七天' },
    { id: 2, role: 'assistant', type: 'confirm', draft: { city: '大理' } },
    { id: 3, role: 'user', type: 'text', text: '嗯' },
  ]

  assert.deepEqual(buildConversationHistory(items, 3), [
    { role: 'user', content: '规划大理七天' },
    { role: 'assistant', content: CONFIRMATION_CARD_HISTORY_MESSAGE },
  ])
})

test('keeps only the most recent ten eligible history entries', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    type: 'text',
    text: `message-${index + 1}`,
  }))
  items.push({ id: 13, role: 'assistant', type: 'confirm', draft: {} })
  items.push({ id: 14, role: 'user', type: 'text', text: 'current' })

  const history = buildConversationHistory(items, 14)

  assert.equal(history.length, 10)
  assert.deepEqual(history[0], { role: 'assistant', content: 'message-4' })
  assert.deepEqual(history.at(-1), {
    role: 'assistant',
    content: CONFIRMATION_CARD_HISTORY_MESSAGE,
  })
})
