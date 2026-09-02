import { describe, expect, it } from 'vitest'
import { parseTaskEvent } from './task-events'

describe('task event parser', () => {
  it('accepts a shared-contract event', () => {
    expect(parseTaskEvent(JSON.stringify({
      task_id: 'task-1',
      plan_id: 'plan-1',
      status: 'processing',
      stage: 'planning',
      progress: 55,
      message: '正在规划',
    }))?.progress).toBe(55)
  })

  it('rejects malformed and schema-drifted messages', () => {
    expect(parseTaskEvent('{')).toBeNull()
    expect(parseTaskEvent(JSON.stringify({ taskId: 'task-1' }))).toBeNull()
  })
})
