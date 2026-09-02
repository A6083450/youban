import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/ChatMessageContent.vue'), 'utf8')

describe('chat message typography', () => {
  it('keeps Chinese message copy readable instead of inheriting compressed inline typography', () => {
    expect(source).toMatch(/\.message-text\s*\{[\s\S]*?display:\s*block/)
    expect(source).toMatch(/\.message-text\s*\{[\s\S]*?font-family:[\s\S]*?'PingFang SC'/)
    expect(source).toMatch(/\.message-text\s*\{[\s\S]*?font-size:\s*16px/)
    expect(source).toMatch(/\.message-text\s*\{[\s\S]*?font-weight:\s*400/)
    expect(source).toMatch(/\.message-text\s*\{[\s\S]*?line-height:\s*1\.75/)
    expect(source).toMatch(/\.message-text\s*\{[\s\S]*?letter-spacing:\s*0/)
  })
})
