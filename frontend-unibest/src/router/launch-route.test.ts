import { describe, expect, it } from 'vitest'
import {
  h5HashLaunchUrl,
  h5LaunchUrl,
  needsH5LaunchRecovery,
  normalizedPagePath,
  stageH5LaunchRoute,
  waitForInitialPage,
} from './launch-route'

describe('h5 launch route recovery', () => {
  it('recovers valid uni-app page routes and preserves their query', () => {
    expect(h5HashLaunchUrl('#/pages/admin/index')).toBe('/pages/admin/index')
    expect(h5HashLaunchUrl('#/pages/plan/index?id=plan%201')).toBe('/pages/plan/index?id=plan%201')
  })

  it('ignores non-page and malformed fragments', () => {
    expect(h5HashLaunchUrl('#section')).toBe('')
    expect(h5HashLaunchUrl('#/https://evil.example')).toBe('')
  })

  it('normalizes a current page route for comparison', () => {
    expect(normalizedPagePath('pages/admin/index')).toBe('/pages/admin/index')
    expect(normalizedPagePath('/pages/admin/index?tab=skills')).toBe('/pages/admin/index')
  })

  it('recovers a deep link when the mounted uni page is still home', () => {
    expect(needsH5LaunchRecovery('#/pages/admin/index?tab=skills', 'pages/index/index')).toBe(true)
  })

  it('does not relaunch a deep link that is already mounted', () => {
    expect(needsH5LaunchRecovery('#/pages/admin/index?tab=skills', 'pages/admin/index')).toBe(false)
  })

  it('stages a deep link behind the home route until the uni page stack is mounted', () => {
    expect(stageH5LaunchRoute('#/pages/admin/index?tab=skills')).toEqual({
      bootstrapHash: '#/pages/index/index',
      launchUrl: '/pages/admin/index?tab=skills',
    })
    expect(h5LaunchUrl('#/pages/index/index', '/pages/admin/index?tab=skills')).toBe(
      '/pages/admin/index?tab=skills',
    )
    expect(h5LaunchUrl('#/pages/index/index')).toBe('/pages/index/index')
  })

  it('waits for the initial uni page before startup navigation', async () => {
    const pages: object[] = []
    let pauses = 0
    const ready = await waitForInitialPage(
      () => pages,
      async () => {
        pauses += 1
        if (pauses === 2)
          pages.push({})
      },
      3,
    )

    expect(ready).toBe(true)
    expect(pauses).toBe(2)
  })

  it('reports when the initial uni page never becomes available', async () => {
    const ready = await waitForInitialPage(() => [], async () => undefined, 2)

    expect(ready).toBe(false)
  })
})
