import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(resolve(process.cwd(), 'src/style/index.scss'), 'utf8')
const store = readFileSync(resolve(process.cwd(), 'src/store/preferences.ts'), 'utf8')

describe('result theme parity', () => {
  const requiredVariables = [
    '--accent-focus',
    '--accent-selected',
    '--status-success',
    '--result-page-image',
    '--result-panel',
    '--result-sticky',
    '--result-panel-shadow',
    '--journey-hero',
    '--journey-hero-border',
    '--journey-hero-overlay-start',
    '--journey-hero-overlay-middle',
    '--journey-hero-overlay-end',
    '--journey-muted',
    '--journey-rail',
    '--journey-card',
  ]

  it('defines every legacy result variable in static warm and clear themes', () => {
    for (const variable of requiredVariables) {
      const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(stylesheet.match(new RegExp(`^\\s*${escaped}:`, 'gm'))).toHaveLength(2)
    }
  })

  it('applies every legacy result variable when preferences change at runtime', () => {
    for (const variable of requiredVariables)
      expect(store.split(`'${variable}'`)).toHaveLength(3)
  })
})
