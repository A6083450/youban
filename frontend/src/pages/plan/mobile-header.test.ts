import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const planSource = readFileSync(resolve(process.cwd(), 'src/pages/plan/index.vue'), 'utf8')
const resultSource = readFileSync(resolve(process.cwd(), 'src/components/trip/TripResult.vue'), 'utf8')

describe('mobile plan header', () => {
  it('keeps native navigation and the sticky result toolbar below the safe area', () => {
    expect(planSource).toContain('class="plan-mobile-header"')
    expect(planSource).toContain('--plan-mobile-header-height')
    expect(planSource).toContain('flex: 0 0 var(--plan-mobile-header-height);')
    const mobileToolbar = resultSource.match(/@media \(max-width: 820px\)[\s\S]*?\.result-toolbar \{([\s\S]*?)\}/)?.[1] || ''
    expect(mobileToolbar).toContain('height: auto;')
    expect(mobileToolbar).toContain('top: var(--result-toolbar-top, 0px);')
  })

  it('restores the legacy H5 menu, centered brand and new-plan actions', () => {
    expect(planSource).toMatch(/<!-- #ifdef H5 -->[\s\S]*class="plan-h5-mobile-header"[\s\S]*navigation\.openMenu[\s\S]*app\.brand[\s\S]*sidebar\.newPlan[\s\S]*<!-- #endif -->/)
    expect(planSource).toContain('@click="drawerOpen = true"')
    expect(planSource).toContain('@click="goNewPlan"')
    expect(planSource).toContain('.plan-h5-mobile-header')
    expect(planSource).toContain('.plan-content > .back-button')
  })

  it('matches the legacy 44px mobile actions and lighter navigation icon color', () => {
    expect(planSource).toMatch(/\.plan-h5-mobile-action \{[\s\S]*width: 44px;[\s\S]*height: 44px;/)
    expect(planSource).toMatch(/\.plan-h5-mobile-action \{[\s\S]*color: var\(--text-secondary\);/)
    expect(planSource).toMatch(/\.plan-h5-mobile-brand \{[\s\S]*font-weight: 800;/)
  })

  it('reserves a dedicated mobile viewport lane for the fixed edit dock', () => {
    expect(planSource).toContain('--plan-edit-dock-clearance: 0px;')
    expect(planSource).toMatch(/\.plan-content \{[^}]*margin-bottom: var\(--plan-edit-dock-clearance\);/)
    expect(planSource).toMatch(/@media \(max-width: 768px\)[\s\S]*\.plan-page \{[^}]*--plan-edit-dock-clearance: calc\(64px \+ max\(12px, env\(safe-area-inset-bottom\)\)\);/)
  })
})
