import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatChatDraft,
  migrateLegacyDraftItems,
  shouldShowDraftActions,
} from './chatDraft.js'

const draft = {
  city: '北京',
  cities: [{ city: '北京', days: 3 }],
  start_date: '2026-10-01',
  end_date: '2026-10-03',
  travel_days: 3,
  transportation: '公共交通',
  accommodation: '舒适型酒店',
  traveler_count: 2,
  room_count: 1,
  budget_amount: 6000,
  budget_basis: 'group_total',
  preferences: ['历史文化', '美食'],
  inferred_fields: ['transportation'],
}

test('formats a ready Chinese draft as a compact assistant message', () => {
  const text = formatChatDraft(draft, 'zh-CN')

  assert.match(text, /^### 北京 · 3天/m)
  assert.match(text, /\*\*路线\*\*：北京 3天/)
  assert.match(text, /\*\*日期\*\*：2026-10-01 至 2026-10-03/)
  assert.match(text, /\*\*同行\*\*：2人 · 1间房/)
  assert.match(text, /\*\*预算\*\*：¥6,000（总预算）/)
  assert.match(text, /采用了建议值：出行方式/)
})

test('formats the same draft in English', () => {
  const text = formatChatDraft({
    ...draft,
    city: 'Beijing',
    cities: [{ city: 'Beijing', days: 3 }],
  }, 'en')

  assert.match(text, /^### Beijing · 3 days/m)
  assert.match(text, /\*\*Route\*\*: Beijing 3 days/)
  assert.match(text, /\*\*Travelers\*\*: 2 travelers · 1 room/)
  assert.match(text, /Suggested defaults: Transportation/)
})

test('shows draft actions only with backend readiness and its signed token', () => {
  assert.equal(shouldShowDraftActions(true, 'ready-token'), true)
  assert.equal(shouldShowDraftActions(true, ''), false)
  assert.equal(shouldShowDraftActions(false, 'ready-token'), false)
  assert.equal(shouldShowDraftActions(undefined, 'ready-token'), false)
})

test('migrates legacy confirmation cards conservatively without executable actions', () => {
  const items = [
    { id: 1, role: 'user', type: 'text', text: '去北京玩三天' },
    { id: 2, role: 'assistant', type: 'confirm', draft },
  ]

  const migrated = migrateLegacyDraftItems(items, 'zh-CN')

  assert.equal(migrated[0], items[0])
  assert.deepEqual(migrated[1], {
    id: 2,
    role: 'assistant',
    type: 'draft',
    draft,
    text: formatChatDraft(draft, 'zh-CN'),
    ready: false,
  })
})
