import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./WorkProgress.vue', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../services/api.ts', import.meta.url), 'utf8')
const chatSource = readFileSync(new URL('../views/ChatHome.vue', import.meta.url), 'utf8')

describe('WorkProgress safe detail boundary', () => {
  it('renders only values that passed the TripTaskDetail normalizer', () => {
    expect(source).toContain('const normalizedDetails = computed<TripTaskDetail[]>(() =>')
    expect(source).toContain('for (const detail of props.details || [])')
    expect(source).toContain("if (!detail || typeof detail !== 'object') continue")
    expect(source).toContain('const title = typeof detail.title === \'string\'')
    expect(source).toContain('.slice(0, 160)')
    expect(source).toContain('const list = normalizedDetails.value')
    expect(source).toContain('for (const d of normalizedDetails.value)')
    expect(source).not.toContain('for (const d of props.details || [])')
  })

  it('normalizes optional intake events before showing them in streaming state', () => {
    expect(apiSource).toContain('onThinking?: (detail: TripTaskDetail) => void')
    expect(apiSource).toContain("else if (evt.type === 'thinking')")
    expect(apiSource).toContain("cb.onThinking?.({ type: 'thinking', title })")
    expect(chatSource).toContain("thinking?: TripTaskDetail")
    expect(chatSource).toContain("item.thinking?.title || t('composer.parsing')")
    expect(chatSource).toContain('setStreamingThinking(streamId, detail)')
  })
})
