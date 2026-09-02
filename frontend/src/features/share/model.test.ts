import { describe, expect, it } from 'vitest'
import { buildPlanShareUrl, shareActionLabel, shareQrFileName } from './model'

describe('plan sharing presentation', () => {
  it('builds a working uni-app H5 route from the deployment base', () => {
    expect(buildPlanShareUrl('https://youban.example', '/', 'abc 123')).toBe(
      'https://youban.example/#/pages/share/index?code=abc%20123',
    )
    expect(buildPlanShareUrl('https://youban.example/', '/travel/', 'token')).toBe(
      'https://youban.example/travel/#/pages/share/index?code=token',
    )
  })

  it('keeps the legacy QR download filename', () => {
    expect(shareQrFileName('abcdef')).toBe('tripstar_share_abcdef.png')
  })

  it('matches the legacy two-character action spacing', () => {
    expect(shareActionLabel('复制')).toBe('复 制')
    expect(shareActionLabel('Copy')).toBe('Copy')
  })
})
