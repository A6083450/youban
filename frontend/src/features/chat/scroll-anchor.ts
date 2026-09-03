import type { Ref } from 'vue'
import { nextTick } from 'vue'

type AfterRender = () => Promise<unknown>

export function createAlternatingScrollFollower(
  target: Ref<string>,
  anchors: readonly [string, string],
  afterRender: AfterRender = nextTick,
): () => Promise<void> {
  let pending = false
  let running: Promise<void> | null = null

  async function drain(): Promise<void> {
    try {
      while (pending) {
        await afterRender()
        pending = false
        target.value = target.value === anchors[0] ? anchors[1] : anchors[0]
        await afterRender()
      }
    }
    finally {
      running = null
    }
  }

  return () => {
    pending = true
    running ??= drain()
    return running
  }
}
