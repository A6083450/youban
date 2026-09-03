import { describe, expect, it } from 'vitest'
import { pageDefinitionsForPlatform, sortPageDefinitions } from './page-definitions'

describe('pages configuration', () => {
  it('keeps every H5 route after the home page in deterministic order', () => {
    expect(pageDefinitionsForPlatform('h5').map(page => page.path)).toEqual([
      'pages/index/index',
      'pages/login/index',
      'pages/plan/index',
      'pages/privacy/index',
      'pages/share/index',
      'pages/admin/index',
    ])
  })

  it('keeps the H5-only admin route out of the mini-program build', () => {
    const miniProgramPages = pageDefinitionsForPlatform('mp-weixin').map(page => page.path)
    expect(miniProgramPages[0]).toBe('pages/index/index')
    expect(miniProgramPages).not.toContain('pages/admin/index')
    expect(miniProgramPages).toContain('pages/web-login/index')
    expect(pageDefinitionsForPlatform('h5').map(page => page.path)).not.toContain('pages/web-login/index')
    expect(pageDefinitionsForPlatform('app').map(page => page.path)).not.toContain('pages/web-login/index')
  })

  it('normalizes filesystem scan order before pages.json is written', () => {
    const scanned = [
      { path: 'pages/index/index' },
      { path: 'pages/admin/index' },
      { path: 'pages/login/index' },
      { path: 'pages/share/index' },
    ]
    expect(sortPageDefinitions(scanned).map(page => page.path)).toEqual([
      'pages/index/index',
      'pages/login/index',
      'pages/share/index',
      'pages/admin/index',
    ])
    expect(sortPageDefinitions(scanned, 'mp-weixin').map(page => page.path)).toEqual([
      'pages/index/index',
      'pages/login/index',
      'pages/share/index',
      'pages/admin/index',
    ])
  })
})
