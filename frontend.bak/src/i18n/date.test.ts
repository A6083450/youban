import { describe, expect, test } from 'bun:test'

import { formatProductDate } from './date'

describe('localized product dates', () => {
  test('renders ISO dates as natural French dates', () => {
    expect(formatProductDate('2026-08-26', 'fr-FR')).toBe('26 août 2026')
    expect(formatProductDate('2026-10-03', 'fr-CA')).toBe('3 octobre 2026')
  })

  test('keeps invalid or empty values stable', () => {
    expect(formatProductDate('', 'fr-FR')).toBe('')
    expect(formatProductDate('date inconnue', 'fr-FR')).toBe('date inconnue')
  })
})
