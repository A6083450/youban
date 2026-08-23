import { readFile } from 'node:fs/promises'
import { test, expect } from 'bun:test'

const themeUrl = new URL('./theme.css', import.meta.url)
const appUrl = new URL('../App.vue', import.meta.url)

test('clear skin uses the dedicated soft cyan palette instead of legacy Google blue', async () => {
  const [theme, app] = await Promise.all([
    readFile(themeUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
  ])
  const clearSkin = theme.match(/:root\[data-skin='google'\]\s*\{([\s\S]*?)\n\}/)?.[1]

  expect(clearSkin).toContain('--accent-primary: #3b9bb4;')
  expect(clearSkin).toContain('--surface-page: #f5f9fc;')
  expect(clearSkin).not.toContain('#1a73e8')
  expect(app).toContain("colorPrimary: skin.value === 'google' ? '#3b9bb4' : '#d97757'")
})
