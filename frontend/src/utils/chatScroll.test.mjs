import test from 'node:test'
import assert from 'node:assert/strict'
import { isConversationNearBottom, scrollConversationToBottom } from './chatScroll.js'

test('scrolls the conversation container exactly to its latest bottom', () => {
  const calls = []
  const anchor = {
    scrollIntoView(options) {
      calls.push(options)
    },
  }
  const container = { scrollTop: 0, scrollHeight: 480 }

  scrollConversationToBottom(container, anchor)

  assert.equal(container.scrollTop, 480)
  assert.deepEqual(calls, [])
})

test('falls back to the end anchor when no scroll container is available', () => {
  const calls = []
  const anchor = {
    scrollIntoView(options) {
      calls.push(options)
    },
  }

  scrollConversationToBottom(null, anchor)

  assert.deepEqual(calls, [{ block: 'end', inline: 'nearest' }])
})

test('detects whether the user is still following the latest messages', () => {
  assert.equal(isConversationNearBottom({ scrollTop: 380, scrollHeight: 500, clientHeight: 100 }), true)
  assert.equal(isConversationNearBottom({ scrollTop: 250, scrollHeight: 500, clientHeight: 100 }), false)
})
