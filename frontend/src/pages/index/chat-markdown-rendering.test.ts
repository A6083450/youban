import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')

describe('chat markdown integration', () => {
  it('keeps streaming text lightweight and renders completed assistant replies with mp-html', () => {
    expect(source).toContain('ChatMessageContent')
    expect(source).toMatch(/<ChatMessageContent[\s\S]*?:markdown="item\.role === 'assistant' && item\.kind === 'text'"/)
  })
})
