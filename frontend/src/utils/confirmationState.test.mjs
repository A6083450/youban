import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceConfirmationDecision } from './confirmationState.js'

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

const state = { draft, cardId: 7 }

test('contextual endpoint scenario matrix only generates for signed confirm', () => {
  const scenarios = [
    {
      name: 'pending 嗯 after explicit confirmation request',
      response: {
        action: 'confirm',
        confidence: 0.92,
        message: '好，我现在按这份草稿开始生成。',
        trip: draft,
        execution_token: 'execution-token-123',
      },
      expectedType: 'generate',
    },
    {
      name: 'pending 嗯 with neutral history',
      response: {
        action: 'ask_confirmation',
        confidence: 0.55,
        message: '你希望我现在按这份草稿开始生成吗？',
        trip: draft,
      },
      expectedType: 'message',
    },
    {
      name: 'pending 嗯？',
      response: {
        action: 'ask_confirmation',
        confidence: 0.31,
        message: '你是想再了解一下，还是按当前草稿开始生成？',
        trip: draft,
      },
      expectedType: 'message',
    },
    {
      name: 'pending 有什么玩',
      response: {
        action: 'chat',
        confidence: 0.08,
        message: '成都可以逛宽窄巷子、锦里和熊猫基地。',
        trip: draft,
      },
      expectedType: 'message',
    },
    {
      name: 'pending 改成5天',
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
      expectedType: 'update',
    },
  ]

  for (const scenario of scenarios) {
    const effect = reduceConfirmationDecision(state, scenario.response)
    assert.equal(effect.type, scenario.expectedType, scenario.name)
    assert.equal(effect.type === 'generate', scenario === scenarios[0], scenario.name)
  }
})

test('chat returns a message and keeps the draft', () => {
  assert.deepEqual(
    reduceConfirmationDecision(state, {
      action: 'chat',
      message: '宽窄巷子适合傍晚逛。',
    }),
    {
      type: 'message',
      message: '宽窄巷子适合傍晚逛。',
      keepDraft: true,
    }
  )
})

test('ask_confirmation returns a message and keeps the draft', () => {
  assert.deepEqual(
    reduceConfirmationDecision(state, {
      action: 'ask_confirmation',
      message: '你是想按当前草稿开始生成吗？',
    }),
    {
      type: 'message',
      message: '你是想按当前草稿开始生成吗？',
      keepDraft: true,
    }
  )
})

test('update replaces the draft without generating', () => {
  const updatedDraft = {
    ...draft,
    accommodation: '精品酒店',
  }

  assert.deepEqual(
    reduceConfirmationDecision(state, {
      action: 'update',
      message: '已更新住宿。',
      trip: updatedDraft,
      execution_token: 'must-not-be-used',
    }),
    {
      type: 'update',
      draft: updatedDraft,
      cardId: 7,
      message: '已更新住宿。',
      keepDraft: true,
    }
  )
})

test('cancel clears the draft without generating', () => {
  assert.deepEqual(
    reduceConfirmationDecision(state, {
      action: 'cancel',
      message: '已取消。',
    }),
    {
      type: 'cancel',
      message: '已取消。',
      cardId: 7,
      keepDraft: false,
    }
  )
})

test('confirm without an execution token returns an error and keeps the draft', () => {
  assert.deepEqual(
    reduceConfirmationDecision(state, {
      action: 'confirm',
      message: '开始生成。',
      trip: draft,
    }),
    {
      type: 'error',
      message: '开始生成。',
      keepDraft: true,
    }
  )
})

test('confirm with an execution token returns one generate payload', () => {
  const confirmedDraft = {
    ...draft,
    transportation: '包车',
  }

  assert.deepEqual(
    reduceConfirmationDecision(state, {
      action: 'confirm',
      message: '开始生成。',
      trip: confirmedDraft,
      execution_token: 'execute-once',
    }),
    {
      type: 'generate',
      draft: confirmedDraft,
      token: 'execute-once',
      keepDraft: false,
    }
  )
})
