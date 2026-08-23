import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const componentUrl = new URL('./ChatHome.vue', import.meta.url)

test('highlights user messages while keeping assistant replies plain and cursor-free', async () => {
  const source = await readFile(componentUrl, 'utf8')

  assert.match(source, /:no-style="item\.role !== 'user'"/)
  assert.match(source, /:variant="item\.role === 'user' \? 'filled' : 'outlined'"/)
  assert.match(source, /--elx-bubble-bg:\s*var\(--accent-primary\)/)
  assert.match(source, /--elx-bubble-text-color:\s*#fff/)
  assert.doesNotMatch(source, /stream-caret/)
})
