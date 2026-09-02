import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const componentUrl = new URL('./PlanChatPanel.vue', import.meta.url)

test('passes restored messages to BubbleList as visible bubble content', async () => {
  const source = await readFile(componentUrl, 'utf8')

  assert.match(source, /content:\s*getMessageContent\(message\)/)
  assert.match(source, /class="agent-inputbar overflow-hidden bg-white"/)
  assert.match(source, /\.elx-x-sender__content/)
  assert.doesNotMatch(source, /\.el-sender-wrap/)
  assert.match(source, /\.agent-inputbar\s*\{[\s\S]*?border:\s*1px solid var\(--border-subtle\)/)
  assert.match(source, /\.agent-inputbar\.is-focused\s*\{[\s\S]*?box-shadow:\s*0 0 0 3px rgba\(217, 119, 87, 0\.16\), 0 12px 36px rgba\(217, 119, 87, 0\.25\)/)
  assert.match(source, /\.agent-sender:focus-within\s*\{[\s\S]*?box-shadow:\s*none/)
  assert.match(source, /\.agent-sender:focus-within::after\s*\{\s*border-width:\s*0/)
  assert.match(source, /<template #avatar="\{ item \}">/)
  assert.match(source, /<UserFilled v-if="item\.placement === 'end'"/)
  assert.match(source, /<Compass v-else/)
  assert.match(source, /bg-\[#d97757\] text-white/)
  assert.match(source, /<template #content="\{ item \}">/)
  assert.match(source, /:virtual="false"/)
  assert.doesNotMatch(source, /<template #item="\{ item \}">/)
})
