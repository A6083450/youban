import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')

describe('agent reply typewriter', () => {
  it('streams both initial parsing and draft adjustment replies into a placeholder bubble', () => {
    expect(source).toContain('createReactiveMessage')
    expect(source).toMatch(/const created = createReactiveMessage\(\{ id: newIdentifier\('message'\), \.\.\.item \}\)/)
    expect(source).toContain('streamTripConfirmReply')
    expect(source).toContain('createTypewriter')
    expect(source).toMatch(/async function handleParse[\s\S]*?typewriter\.push\(delta\)[\s\S]*?await typewriter\.finish/)
    expect(source).toMatch(/async function handleDraftReply[\s\S]*?kind: 'streaming'/)
    expect(source).toMatch(/async function handleDraftReply[\s\S]*?typewriter\.push\(delta\)[\s\S]*?await typewriter\.finish/)
  })
})
