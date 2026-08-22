import { describe, expect, test } from 'bun:test'

import { VISIBLE_LOCALE_OPTIONS, VISIBLE_SKIN_OPTIONS } from './preference-options'

describe('visible preference options', () => {
  test('shows exactly Chinese and English', () => {
    expect(VISIBLE_LOCALE_OPTIONS.map(({ value }) => value)).toEqual(['zh-CN', 'en-US'])
  })

  test('keeps persisted skin ids behind neutral labels', () => {
    expect(VISIBLE_SKIN_OPTIONS).toEqual([
      { value: 'default', labelKey: 'app.skin.warm', swatch: 'warm' },
      { value: 'google', labelKey: 'app.skin.clear', swatch: 'clear' },
    ])
  })
})
