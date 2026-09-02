import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/trip/BudgetLedger.vue'), 'utf8')

describe('budget ledger legacy layout', () => {
  it('places the summary before controls and detail rows on narrow screens', () => {
    expect(source).toMatch(/@media \(max-width: 920px\)[\s\S]*\.right-budget-summary \{[\s\S]*order: -1;/)
  })

  it('translates known provider identifiers for user-facing source labels', () => {
    expect(source).toContain('if (provider === \'amap\')')
    expect(source).toContain('return t(\'result.budget.amap\')')
  })

  it('matches the legacy amount formatting and responsive typography', () => {
    expect(source).toContain('{{ formatNumber(totals.total) }}')
    expect(source).not.toContain('totals.total.toLocaleString')
    expect(source).toMatch(/@media \(max-width: 560px\)[\s\S]*\.budget-summary-title \{[\s\S]*font-size: 30px;/)
    expect(source).toMatch(/@media \(max-width: 560px\)[\s\S]*\.budget-summary-total-value \{[\s\S]*font-size: 56px;/)
    expect(source).toMatch(/@media \(max-width: 560px\)[\s\S]*\.budget-summary-sub-value \{[\s\S]*font-size: 24px;/)
  })

  it('keeps the old two-line desktop item and calculation column at 1800px', () => {
    expect(source).toContain('@media (min-width: 1900px)')
    expect(source).not.toContain('@media (min-width: 1500px)')
    expect(source).toMatch(/\.budget-add-btn \{[\s\S]*background: var\(--accent-primary\);/)
  })
})
