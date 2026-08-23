import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')

test('keeps title polling live when a session deletion fails', () => {
  expect(appSource).toMatch(/if \(item\.session_id\) \{\s*await deleteConversation\(item\.session_id\)/)
  expect(appSource).not.toContain('invalidateConversationTitlePolling')
})
