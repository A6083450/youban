import { describe, expect, it, vi } from 'vitest'
import { formatResultDate, formatResultNumber } from './format'

describe('result runtime formatting', () => {
  it('returns the supplied date fallback when Intl is unavailable', () => {
    vi.stubGlobal('Intl', undefined)
    expect(formatResultDate(new Date(2026, 8, 3), 'zh-CN', { dateStyle: 'long' }, '2026.09.03')).toBe('2026.09.03')
    vi.unstubAllGlobals()
  })

  it('returns a finite number fallback when locale formatting throws', () => {
    const formatter = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(() => {
      throw new RangeError('unsupported locale')
    })
    const result = formatResultNumber(1234.567, '_', 2)
    formatter.mockRestore()
    expect(result).toBe('1234.57')
  })
})
