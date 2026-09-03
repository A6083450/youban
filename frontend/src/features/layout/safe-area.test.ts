import { describe, expect, it } from 'vitest'
import { mobileActionsRightCss, mobileHeaderMetrics, safeAreaTopCss } from './safe-area'

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

  it('aligns the custom header to the native capsule vertical center', () => {
    expect(mobileHeaderMetrics(390, 47, {
      left: 279,
      top: 48,
      height: 32,
      bottom: 80,
    })).toEqual({
      safeTop: '47px',
      actionsRight: '119px',
      menuTop: '48px',
      menuHeight: '32px',
      menuCenter: '64px',
      headerHeight: '99px',
    })
  })
})
