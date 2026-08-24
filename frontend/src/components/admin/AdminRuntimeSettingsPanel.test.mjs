import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./AdminRuntimeSettingsPanel.vue', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../../services/api.ts', import.meta.url), 'utf8')
const locales = ['zh', 'en', 'ja'].map((locale) => JSON.parse(readFileSync(
  new URL(`../../i18n/locales/${locale}.json`, import.meta.url),
  'utf8',
)))

describe('administrator model thinking controls', () => {
  it('binds both switches and disables visible thinking until enabled', () => {
    expect(source).toContain('v-model:checked="settingsForm.llm_thinking_enabled"')
    expect(source).toContain('v-model:checked="settingsForm.llm_thinking_visible"')
    expect(source).toContain(':disabled="!settingsForm.llm_thinking_enabled"')
  })

  it('clears visible thinking before saving after thinking is disabled', () => {
    expect(source).toContain('if (!settingsForm.llm_thinking_enabled) settingsForm.llm_thinking_visible = false')
  })

  it('normalizes both thinking settings as booleans', () => {
    expect(apiSource).toContain('llm_thinking_enabled: Boolean(')
    expect(apiSource).toContain('llm_thinking_visible: Boolean(')
  })

  it('provides labels and help descriptions in every supported locale', () => {
    for (const locale of locales) {
      expect(locale.settings.labels.thinkingEnabled).toEqual(expect.any(String))
      expect(locale.settings.labels.thinkingVisible).toEqual(expect.any(String))
      expect(locale.settings.help.thinkingEnabled).toEqual(expect.any(String))
      expect(locale.settings.help.thinkingVisible).toEqual(expect.any(String))
    }
  })
})
