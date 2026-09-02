import { test, expect } from 'bun:test'

import { clearSkin, getSkinDefinition, warmSkin } from '../themes/index.ts'

test('clear skin uses the dedicated soft cyan palette instead of legacy Google blue', async () => {
  expect(getSkinDefinition('google')).toBe(clearSkin)
  expect(clearSkin.cssVariables['--accent-primary']).toBe('#3b9bb4')
  expect(clearSkin.cssVariables['--surface-page']).toBe('#f5f9fc')
  expect(Object.values(clearSkin.cssVariables)).not.toContain('#1a73e8')
  expect(clearSkin.antTheme.token?.colorPrimary).toBe('#3b9bb4')
  expect(getSkinDefinition('default')).toBe(warmSkin)
  expect(warmSkin.antTheme.token?.colorPrimary).toBe('#d97757')
})
