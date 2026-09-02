import { describe, expect, it } from 'vitest'
import { createTypewriter } from './typewriter'

describe('agent typewriter', () => {
  it('reveals a large transport chunk over multiple visible frames', async () => {
    const frames: string[] = []
    const typewriter = createTypewriter(value => frames.push(value), {
      delay: async () => {},
    })

    typewriter.push('你好世界')
    await typewriter.finish('你好世界')

    expect(frames).toEqual(['你', '你好', '你好世', '你好世界'])
  })

  it('types the final response when the transport emitted no deltas', async () => {
    const frames: string[] = []
    const typewriter = createTypewriter(value => frames.push(value), {
      charactersPerTick: 2,
      delay: async () => {},
    })

    await typewriter.finish('调整完成')

    expect(frames).toEqual(['调整', '调整完成'])
  })

  it('does not replay from the beginning when the final text normalizes streamed punctuation', async () => {
    const frames: string[] = []
    const streamed = '好的,行程已调整。'
    const final = '好的，行程已调整。'
    const typewriter = createTypewriter(value => frames.push(value), {
      delay: async () => {},
    })

    typewriter.push(streamed)
    for (let index = 0; index < streamed.length + 2; index += 1)
      await Promise.resolve()
    expect(frames.at(-1)).toBe(streamed)

    await typewriter.finish(final)

    expect(frames.filter(value => value === '好')).toHaveLength(1)
    expect(frames.slice(-2)).toEqual([streamed, final])
  })
})
