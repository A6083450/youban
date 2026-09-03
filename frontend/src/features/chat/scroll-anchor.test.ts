import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createAlternatingScrollFollower } from './scroll-anchor'

describe('alternating scroll follower', () => {
  it('coalesces one render burst into one committed anchor change', async () => {
    const target = ref('')
    const committed: string[] = []
    const afterRender = async () => {
      await Promise.resolve()
      if (target.value && committed.at(-1) !== target.value)
        committed.push(target.value)
    }
    const follow = createAlternatingScrollFollower(
      target,
      ['bottom-a', 'bottom-b'],
      afterRender,
    )

    await Promise.all([follow(), follow(), follow()])
    expect(committed).toEqual(['bottom-a'])

    await follow()
    expect(committed).toEqual(['bottom-a', 'bottom-b'])
  })
})
