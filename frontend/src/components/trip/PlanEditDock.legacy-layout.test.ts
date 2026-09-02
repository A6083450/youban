import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/trip/PlanEditDock.vue'), 'utf8')
const zh = JSON.parse(readFileSync(resolve(process.cwd(), 'src/locale/product-zh.json'), 'utf8'))

describe('plan edit dock legacy layout', () => {
  it('centers on the desktop content area and preserves the 54px pill', () => {
    expect(source).toContain('left: calc(50% + 130px);')
    expect(source).toContain('transform: translateX(-50%);')
    expect(source).toMatch(/\.edit-composer \{[\s\S]*box-sizing: border-box;/)
    expect(source).toMatch(/\.edit-composer \{[\s\S]*border-radius: 16px;/)
    expect(source).toMatch(/\.edit-composer \{[\s\S]*padding: 2px 9px 2px 14px;/)
  })

  it('resets centering for the mobile viewport', () => {
    expect(source).toMatch(/@media \(max-width: 560px\)[\s\S]*\.edit-dock \{[\s\S]*left: 50%;/)
  })

  it('vertically centers a single-line textarea while preserving auto height', () => {
    expect(source).toMatch(/<textarea[\s\S]*auto-height/)
    expect(source).toMatch(/\.edit-composer \{[^}]*align-items: center;/)
    expect(source).toMatch(/\.edit-input \{[^}]*min-height: 38px;/)
    expect(source).toMatch(/\.edit-input \{[^}]*padding: 8px 0;/)
    expect(source).toMatch(/\.edit-input \{[^}]*line-height: 22px;/)
    expect(source).not.toMatch(/\.edit-composer \{[^}]*align-items: flex-end;/)
  })

  it('keeps the mobile placeholder short enough to stay on one line', () => {
    expect(zh.result.agent.placeholder).toBe('输入修改要求或问题…')
  })
})
