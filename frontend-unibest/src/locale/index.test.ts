import { describe, expect, it } from 'vitest'
import { t } from './index'

describe('locale helpers', () => {
  it('returns the localized value for a flat key', () => {
    expect(t('tabbar.home')).toBe('首页')
  })

  it('interpolates nested values', () => {
    expect(t('introduction', {
      name: '张三',
      detail: { height: 178, weight: '75kg' },
    })).toBe('我是 张三,身高:178,体重:75kg')
  })

  it('returns an empty string for an unknown key', () => {
    expect(t('missing.key')).toBe('')
  })
})
