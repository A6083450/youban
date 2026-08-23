import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const chatHomeSource = readFileSync(new URL('./ChatHome.vue', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

describe('chat lifecycle persistence boundaries', () => {
  it('awaits persistence before leaving the chat route', () => {
    expect(chatHomeSource).toMatch(/onBeforeRouteLeave\(async \(\) => \{\s*await flushCurrentPersistence\(\)/)
  })

  it('registers a pre-auth-transition persistence flush', () => {
    expect(chatHomeSource).toContain('registerBeforeAuthTransition(flushCurrentPersistence)')
  })

  it('does not delete the chat fallback before the active chat flushes', () => {
    const goNewPlanBody = appSource.match(/const goNewPlan = \(\) => \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(goNewPlanBody).not.toContain('localStorage.removeItem')
  })

  it('restores durable fallback envelopes into the retry queue', () => {
    expect(chatHomeSource).toContain('readPersistedConversationCaptures(userId())')
    expect(chatHomeSource).toContain('persistenceQueue.schedule(capture)')
  })

  it('retires the undurable raw fallback after durable creation succeeds', () => {
    const ensureBody = chatHomeSource.match(
      /const ensureServerConversation = async[\s\S]*?\n\}/,
    )?.[0] ?? ''
    expect(ensureBody).toContain('removeLegacyChatSnapshot(ownerId)')
  })
})
