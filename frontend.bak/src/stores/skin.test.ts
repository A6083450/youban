import { beforeEach, describe, expect, test } from 'bun:test'

import {
  SKIN_STORAGE_KEY,
  applySkin,
  normalizeSkin,
  readStoredSkin,
} from './skin'

describe('skin store', () => {
  const values = new Map<string, string>()
  const styles = new Map<string, string>()
  const documentElement = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) => styles.set(name, value),
    },
  }

  beforeEach(() => {
    values.clear()
    styles.clear()
    documentElement.dataset = {}
    Object.assign(globalThis, {
      document: { documentElement },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })
  })

  test('accepts only supported skins', () => {
    expect(normalizeSkin('google')).toBe('google')
    expect(normalizeSkin('default')).toBe('default')
    expect(normalizeSkin('unknown')).toBe('default')
    expect(normalizeSkin(null)).toBe('default')
  })

  test('reads persisted skin with a safe fallback', () => {
    values.set(SKIN_STORAGE_KEY, 'google')
    expect(readStoredSkin()).toBe('google')

    values.set(SKIN_STORAGE_KEY, 'invalid')
    expect(readStoredSkin()).toBe('default')
  })

  test('persists skin and synchronizes the root data attribute', () => {
    applySkin('google')

    expect(values.get(SKIN_STORAGE_KEY)).toBe('google')
    expect(documentElement.dataset.skin).toBe('google')
    expect(styles.get('--accent-primary')).toBe('#3b9bb4')
    expect(styles.get('--surface-navigation')).toBe('#eef7f9')
  })

  test('replaces clear theme variables with warm theme variables', () => {
    applySkin('google')
    applySkin('default')

    expect(styles.get('--accent-primary')).toBe('#d97757')
    expect(styles.get('--surface-navigation')).toBe('#fffaf6')
  })
})
