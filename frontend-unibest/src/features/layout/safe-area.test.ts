import { describe, expect, it } from 'vitest'
import { mobileActionsRightCss, safeAreaTopCss } from './safe-area'

describe('mobile safe area', () => {
  it('keeps the runtime status bar inset in CSS pixels', () => {
    expect(safeAreaTopCss(47)).toBe('47px')
    expect(safeAreaTopCss(undefined)).toBe('0px')
    expect(safeAreaTopCss(-5)).toBe('0px')
  })

  it('reserves the native WeChat menu capsule on the right', () => {
    expect(mobileActionsRightCss(390, 279)).toBe('119px')
    expect(mobileActionsRightCss(390, undefined)).toBe('12px')
  })
})
