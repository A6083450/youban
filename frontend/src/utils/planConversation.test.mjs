import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildArchivedConversation,
  canUseCachedPlan,
  completeTripPlanResponse,
} from './planConversation.js'

test('archives all stable creation messages and excludes transient UI items', () => {
  const items = [
    { id: 1, role: 'user', type: 'text', text: '春节去哈尔滨玩五天' },
    { id: 2, role: 'assistant', type: 'text', text: '我先帮你整理一下。' },
    { id: 3, role: 'assistant', type: 'confirm', draft: { city: '哈尔滨' } },
    { id: 4, role: 'assistant', type: 'typing' },
    { id: 5, role: 'assistant', type: 'streaming', text: '处理中' },
    { id: 6, role: 'assistant', type: 'progress', status: {} },
    { id: 7, role: 'assistant', type: 'done', planId: 'plan-1' },
  ]

  assert.deepEqual(buildArchivedConversation(items), [
    { role: 'user', content: '春节去哈尔滨玩五天' },
    { role: 'assistant', content: '我先帮你整理一下。' },
  ])
})

test('fills a missing result plan id from the completed task event', () => {
  const result = completeTripPlanResponse(
    { success: true, message: 'ok', data: { city: '哈尔滨' } },
    'event-plan-id',
    'task-id',
  )

  assert.equal(result.plan_id, 'event-plan-id')
})

test('falls back to task id when both response and event omit plan id', () => {
  const result = completeTripPlanResponse(
    { success: true, message: 'ok', data: { city: '哈尔滨' } },
    '',
    'task-id',
  )

  assert.equal(result.plan_id, 'task-id')
})

test('uses cached plan only when its recorded owner matches the target route', () => {
  assert.equal(canUseCachedPlan('{"city":"哈尔滨"}', 'plan-a', 'plan-a'), true)
  assert.equal(canUseCachedPlan('{"city":"哈尔滨"}', 'plan-a', 'plan-b'), false)
  assert.equal(canUseCachedPlan('{"city":"哈尔滨"}', '', 'plan-b'), false)
  assert.equal(canUseCachedPlan(null, 'plan-a', 'plan-a'), false)
  assert.equal(canUseCachedPlan('{"city":"哈尔滨"}', 'plan-a', ''), true)
  assert.equal(canUseCachedPlan('{"city":"哈尔滨"}', '', ''), false)
})
