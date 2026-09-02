import { nextTick, watchEffect } from 'vue'
import { describe, expect, it } from 'vitest'
import { createReactiveMessage } from './reactive-message'

describe('reactive chat message', () => {
  it('notifies the renderer when the returned message text changes', async () => {
    const message = createReactiveMessage({ text: '' })
    const renderedValues: string[] = []
    const stop = watchEffect(() => {
      renderedValues.push(message.text)
    })

    message.text = '你'
    await nextTick()
    stop()

    expect(renderedValues).toEqual(['', '你'])
  })
})
