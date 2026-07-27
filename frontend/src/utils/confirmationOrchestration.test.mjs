import test from 'node:test'
import assert from 'node:assert/strict'
import {
  orchestrateConfirmationReply,
  buildTripPlanRequest,
  shouldClearActiveTask,
} from './confirmationOrchestration.js'

const draft = {
  city: '成都',
  cities: [{ city: '成都', days: 3 }],
  start_date: '2026-08-01',
  end_date: '2026-08-03',
  travel_days: 3,
  transportation: '公共交通',
  accommodation: '经济型酒店',
  preferences: ['美食'],
  free_text_input: '去成都玩三天',
  origin_text: '去成都玩三天',
}

const input = {
  text: '嗯',
  draft,
  cardId: 7,
  language: 'zh-CN',
  history: [{ role: 'assistant', content: '要按这份草稿生成吗？' }],
}

const createHarness = (response, generateResult = { status: 'completed' }) => {
  const confirmCalls = []
  const generateCalls = []
  return {
    confirmCalls,
    generateCalls,
    dependencies: {
      confirmReply: async (...args) => {
        confirmCalls.push(args)
        return response
      },
      generate: async (...args) => {
        generateCalls.push(args)
        return generateResult
      },
    },
  }
}

test('forwards every pending reply to confirm-reply exactly once without interpreting its text', async () => {
  const harness = createHarness({ action: 'chat', message: '继续聊聊。' })

  const result = await orchestrateConfirmationReply(input, harness.dependencies)

  assert.deepEqual(harness.confirmCalls, [[input.text, draft, input.language, input.history]])
  assert.equal(harness.generateCalls.length, 0)
  assert.deepEqual(result.pending, { cardId: 7, draft })
})

const updatedDraft = { ...draft, accommodation: '精品酒店' }
for (const { response, expected } of [
  {
    response: { action: 'chat', message: '继续聊聊。' },
    expected: {
      effect: { type: 'message', message: '继续聊聊。', keepDraft: true },
      pending: { cardId: 7, draft },
    },
  },
  {
    response: { action: 'ask_confirmation', message: '要按当前草稿生成吗？' },
    expected: {
      effect: { type: 'message', message: '要按当前草稿生成吗？', keepDraft: true },
      pending: { cardId: 7, draft },
    },
  },
  {
    response: { action: 'update', message: '已修改。', trip: updatedDraft },
    expected: {
      effect: { type: 'update', draft: updatedDraft, cardId: 7, message: '已修改。', keepDraft: true },
      pending: { cardId: 7, draft: updatedDraft },
    },
  },
  {
    response: { action: 'cancel', message: '已取消。' },
    expected: {
      effect: { type: 'cancel', message: '已取消。', cardId: 7, keepDraft: false },
      pending: null,
    },
  },
  {
    response: { action: 'confirm', message: '开始生成。', trip: draft },
    expected: {
      effect: { type: 'error', message: '开始生成。', keepDraft: true },
      pending: { cardId: 7, draft },
    },
  },
]) {
  test(`${response.action} without an execution token never generates`, async () => {
    const harness = createHarness(response)

    const result = await orchestrateConfirmationReply(input, harness.dependencies)

    assert.equal(harness.confirmCalls.length, 1)
    assert.equal(harness.generateCalls.length, 0)
    assert.deepEqual(result, expected)
  })
}

test('contextual endpoint scenario matrix only orchestrates generation for signed confirm', async () => {
  const scenarios = [
    {
      name: 'pending 嗯 after explicit confirmation request',
      text: '嗯',
      history: [{ role: 'assistant', content: '要按这份草稿生成吗？' }],
      response: {
        action: 'confirm',
        confidence: 0.92,
        message: '好，我现在按这份草稿开始生成。',
        trip: draft,
        execution_token: 'execution-token-123',
      },
      expectedGenerateCalls: 1,
    },
    {
      name: 'pending 嗯 with neutral history',
      text: '嗯',
      history: [{ role: 'assistant', content: '成都夏天比较湿热。' }],
      response: {
        action: 'ask_confirmation',
        confidence: 0.55,
        message: '你希望我现在按这份草稿开始生成吗？',
        trip: draft,
      },
      expectedGenerateCalls: 0,
    },
    {
      name: 'pending 嗯？',
      text: '嗯？',
      history: [{ role: 'assistant', content: '要按这份草稿生成吗？' }],
      response: {
        action: 'ask_confirmation',
        confidence: 0.31,
        message: '你是想再了解一下，还是按当前草稿开始生成？',
        trip: draft,
      },
      expectedGenerateCalls: 0,
    },
    {
      name: 'pending 有什么玩',
      text: '有什么玩',
      history: [{ role: 'assistant', content: '要按这份草稿生成吗？' }],
      response: {
        action: 'chat',
        confidence: 0.08,
        message: '成都可以逛宽窄巷子、锦里和熊猫基地。',
        trip: draft,
      },
      expectedGenerateCalls: 0,
    },
    {
      name: 'pending 改成5天',
      text: '改成5天',
      history: [{ role: 'assistant', content: '要按这份草稿生成吗？' }],
      response: {
        action: 'update',
        confidence: 0.96,
        message: '已改成 5 天。',
        trip: {
          ...draft,
          cities: [{ city: '成都', days: 5 }],
          end_date: '2026-08-05',
          travel_days: 5,
        },
      },
      expectedGenerateCalls: 0,
    },
  ]

  for (const scenario of scenarios) {
    const harness = createHarness(scenario.response)
    const scenarioInput = { ...input, text: scenario.text, history: scenario.history }

    const result = await orchestrateConfirmationReply(scenarioInput, harness.dependencies)

    assert.deepEqual(
      harness.confirmCalls,
      [[scenario.text, draft, input.language, scenario.history]],
      scenario.name
    )
    assert.equal(harness.generateCalls.length, scenario.expectedGenerateCalls, scenario.name)
    assert.equal(result.effect.type === 'generate', scenario.expectedGenerateCalls === 1, scenario.name)
  }
})

test('confirm with an execution token generates exactly once', async () => {
  const confirmedDraft = { ...draft, transportation: '包车' }
  const harness = createHarness({
    action: 'confirm',
    message: '开始生成。',
    trip: confirmedDraft,
    execution_token: 'execute-once',
  })

  const result = await orchestrateConfirmationReply(input, harness.dependencies)

  assert.equal(harness.confirmCalls.length, 1)
  assert.deepEqual(harness.generateCalls, [[confirmedDraft, 'execute-once']])
  assert.equal(result.effect.type, 'generate')
  assert.equal(result.pending, null)
})

test('confirm-reply failure returns an error effect and preserves the original pending draft', async () => {
  const confirmCalls = []
  const generateCalls = []

  const result = await orchestrateConfirmationReply(input, {
    confirmReply: async (...args) => {
      confirmCalls.push(args)
      throw new Error('Agent unavailable')
    },
    generate: async (...args) => {
      generateCalls.push(args)
      return true
    },
  })

  assert.equal(confirmCalls.length, 1)
  assert.equal(generateCalls.length, 0)
  assert.deepEqual(result, {
    effect: { type: 'error', message: 'Agent unavailable', keepDraft: true },
    pending: { cardId: 7, draft },
  })
})

test('submission failure restores the confirmed draft and pending card state', async () => {
  const confirmedDraft = { ...draft, transportation: '包车' }
  const harness = createHarness({
    action: 'confirm',
    message: '开始生成。',
    trip: confirmedDraft,
    execution_token: 'execute-once',
  }, { status: 'submit_failed' })

  const result = await orchestrateConfirmationReply(input, harness.dependencies)

  assert.equal(harness.confirmCalls.length, 1)
  assert.equal(harness.generateCalls.length, 1)
  assert.equal(result.effect.type, 'generate')
  assert.deepEqual(result.pending, { cardId: 7, draft: confirmedDraft })
})

test('watch failure after task creation never restores pending confirmation', async () => {
  const harness = createHarness({
    action: 'confirm',
    message: '开始生成。',
    trip: draft,
    execution_token: 'execute-once',
  }, { status: 'watch_failed', taskId: 'task-123' })

  const result = await orchestrateConfirmationReply(input, harness.dependencies)

  assert.equal(harness.generateCalls.length, 1)
  assert.equal(result.effect.type, 'generate')
  assert.equal(result.pending, null)
  assert.equal(result.generation.status, 'watch_failed')
  assert.equal(result.generation.taskId, 'task-123')
})

test('completed generation clears pending confirmation', async () => {
  const harness = createHarness({
    action: 'confirm',
    message: '开始生成。',
    trip: draft,
    execution_token: 'execute-once',
  }, { status: 'completed' })

  const result = await orchestrateConfirmationReply(input, harness.dependencies)

  assert.equal(result.pending, null)
  assert.deepEqual(result.generation, { status: 'completed' })
})

test('active task is cleared only after successful completion', () => {
  assert.equal(shouldClearActiveTask({ status: 'completed' }), true)
  assert.equal(shouldClearActiveTask({ status: 'submit_failed' }), false)
  assert.equal(shouldClearActiveTask({ status: 'watch_failed', taskId: 'task-123' }), false)
})

test('plan request uses authorized draft travel_days instead of deriving it from dates', () => {
  const contradictoryDraft = {
    ...draft,
    end_date: '2026-08-05',
    travel_days: 3,
  }

  const request = buildTripPlanRequest(contradictoryDraft, 'execute-once', 'zh-CN')

  assert.equal(request.travel_days, 3)
  assert.equal(request.end_date, '2026-08-05')
})

test('plan request rejects non-integer or out-of-range draft travel_days', () => {
  for (const travelDays of [0, 2.5, 31, Number.NaN]) {
    assert.equal(buildTripPlanRequest({ ...draft, travel_days: travelDays }, 'token', 'zh-CN'), null)
  }
})
