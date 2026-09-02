import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')

function styleBlocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(match => match[1])
}

describe('chat composer layout', () => {
  it('reserves enough height for a two-line placeholder without clipping it', () => {
    const [desktopComposer, mobileComposer] = styleBlocks('.composer')
    const [input] = styleBlocks('.composer-input')

    expect(desktopComposer).toContain('height: auto;')
    expect(desktopComposer).toContain('min-height: 72px;')
    expect(desktopComposer).toContain('padding: 8px 11px 8px 18px;')
    expect(input).toContain('height: auto;')
    expect(input).toContain('min-height: 56px;')
    expect(input).toContain('padding: 4px 0;')
    expect(mobileComposer).toContain('min-height: 72px;')
    expect(mobileComposer).toContain('padding: 8px 11px 8px 18px;')
  })
})
