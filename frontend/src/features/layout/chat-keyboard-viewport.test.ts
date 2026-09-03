import { describe, expect, it, vi } from 'vitest'
import { useChatKeyboardViewport } from './chat-keyboard-viewport'

describe('chat keyboard viewport', () => {
  it('reserves the reported keyboard height without moving the page header', () => {
    const onResize = vi.fn()
    const viewport = useChatKeyboardViewport(onResize)

    expect(viewport.style.value).toEqual({ '--chat-keyboard-height': '0px' })

    viewport.update({ detail: { height: 684.4 } })
    expect(viewport.style.value).toEqual({ '--chat-keyboard-height': '684px' })
    expect(onResize).toHaveBeenCalledTimes(1)

    viewport.reset()
    expect(viewport.style.value).toEqual({ '--chat-keyboard-height': '0px' })
    expect(onResize).toHaveBeenCalledTimes(2)
  })
})
