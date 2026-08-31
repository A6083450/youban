import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const planSource = readFileSync(resolve(process.cwd(), 'src/pages/plan/index.vue'), 'utf8')
const resultSource = readFileSync(resolve(process.cwd(), 'src/components/trip/TripResult.vue'), 'utf8')

describe('mobile plan header', () => {
  it('keeps navigation and the sticky result toolbar below the native safe area', () => {
    expect(planSource).toContain('class="plan-mobile-header"')
    expect(planSource).toContain('--plan-mobile-header-height')
    expect(planSource).toContain('flex: 0 0 var(--plan-mobile-header-height);')
    const mobileToolbar = resultSource.match(/@media \(max-width: 820px\)[\s\S]*?\.result-toolbar \{([\s\S]*?)\}/)?.[1] || ''
    expect(mobileToolbar).toContain('height: auto;')
    expect(mobileToolbar).toContain('top: 0;')
  })
})
