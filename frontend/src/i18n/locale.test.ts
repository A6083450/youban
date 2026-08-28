import { describe, expect, test } from 'bun:test'

import { normalizeLocale } from './locale'
import { messages, SUPPORTED_LOCALES } from './messages'

const stringEntries = (value: unknown, prefix = ''): Array<[string, string]> => {
  if (typeof value === 'string') return [[prefix, value]]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => (
    stringEntries(child, prefix ? `${prefix}.${key}` : key)
  ))
}

describe('product locale normalization', () => {
  test('normalizes Chinese, English, and French browser locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['zh-CN', 'en-US', 'fr-FR'])
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('en-US')).toBe('en-US')
    expect(normalizeLocale('en-GB')).toBe('en-US')
    expect(normalizeLocale('fr-FR')).toBe('fr-FR')
    expect(normalizeLocale('fr-CA')).toBe('fr-FR')
  })

  test('falls unsupported persisted locales back to Chinese', () => {
    expect(normalizeLocale('xx-XX')).toBe('zh-CN')
    expect(normalizeLocale(null)).toBe('zh-CN')
  })

  test('ships a complete French catalog instead of falling back to English', () => {
    const englishEntries = stringEntries(messages['en-US'])
    const frenchEntries = stringEntries((messages as Record<string, unknown>)['fr-FR'])

    expect(frenchEntries.map(([key]) => key)).toEqual(englishEntries.map(([key]) => key))
    const identicalCount = frenchEntries.filter(([key, value]) => (
      value === new Map(englishEntries).get(key)
    )).length
    expect(identicalCount).toBeLessThan(80)
    expect(Object.fromEntries(frenchEntries)).toEqual(expect.objectContaining({
      'app.language.fr': 'Français',
      'common.loading': 'Chargement…',
      'composer.send': 'Envoyer',
    }))
  })
})
