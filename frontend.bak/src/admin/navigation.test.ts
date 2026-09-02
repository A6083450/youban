import { describe, expect, it } from 'bun:test'
import {
  ADMIN_SECTIONS,
  readStoredAdminSection,
  storeAdminSection,
  normalizeAdminSection,
} from './navigation'

describe('admin navigation state', () => {
  it('keeps every first-level destination visible and restores only known sections', () => {
    expect(ADMIN_SECTIONS.map((item) => item.id)).toEqual(['settings', 'skills', 'trips'])
    expect(normalizeAdminSection('unknown')).toBe('settings')
    expect(normalizeAdminSection('skills')).toBe('skills')
  })

  it('persists a valid section and falls back safely when storage is unavailable', () => {
    let storedValue: string | null = 'trips'
    const storage = {
      getItem: () => storedValue,
      setItem: (_key: string, value: string) => {
        storedValue = value
      },
    }

    expect(readStoredAdminSection(storage)).toBe('trips')
    storeAdminSection('skills', storage)
    expect(readStoredAdminSection(storage)).toBe('skills')

    storedValue = 'removed-section'
    expect(readStoredAdminSection(storage)).toBe('settings')
    expect(readStoredAdminSection({ getItem: () => { throw new Error('blocked') } })).toBe('settings')
  })
})
