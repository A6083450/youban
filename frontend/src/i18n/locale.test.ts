import { describe, expect, test } from 'bun:test'

import { normalizeLocale } from './locale'

describe('product locale normalization', () => {
  test('keeps only Chinese and English product locales', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('en-US')).toBe('en-US')
    expect(normalizeLocale('en-GB')).toBe('en-US')
  })

  test('falls unsupported and persisted Japanese locales back to Chinese', () => {
    expect(normalizeLocale('ja-JP')).toBe('zh-CN')
    expect(normalizeLocale('fr-FR')).toBe('zh-CN')
    expect(normalizeLocale(null)).toBe('zh-CN')
  })
})
