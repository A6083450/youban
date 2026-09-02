import { describe, expect, it } from 'vitest'
import { resolveAvailableResultSection, resultSectionAnchor } from './section-state'

describe('result section availability', () => {
  it('restores an asynchronously available requested section', () => {
    expect(resolveAvailableResultSection('budget', 'budget', ['today', 'overview'])).toBe('today')
    expect(resolveAvailableResultSection('today', 'budget', ['today', 'overview', 'budget'])).toBe('budget')
  })

  it('keeps the current user-selected section when it remains available', () => {
    expect(resolveAvailableResultSection('days', 'days', ['today', 'overview', 'days', 'budget'])).toBe('days')
  })

  it('creates stable scroll anchors for section tabs', () => {
    expect(resultSectionAnchor('weather')).toBe('result-section-weather')
  })
})
