import { describe, expect, it } from 'vitest'
import { selectRuntimeBaseUrl } from './runtime-base-url'

const configuration = {
  fallback: 'https://youban.me',
  trial: 'https://trial.youban.me',
  release: 'https://youban.me',
}

describe('runtime API base URL', () => {
  it('allows an explicit H5 override', () => {
    expect(selectRuntimeBaseUrl({
      platform: 'h5',
      storedBaseUrl: 'http://127.0.0.1:9000',
    }, configuration)).toBe('http://127.0.0.1:9000')
  })

  it('uses an explicit local override only inside WeChat DevTools', () => {
    expect(selectRuntimeBaseUrl({
      platform: 'mp-weixin',
      envVersion: 'develop',
      hostPlatform: 'devtools',
      storedBaseUrl: 'http://127.0.0.1:7860',
    }, configuration)).toBe('http://127.0.0.1:7860')
  })

  it('defaults WeChat development builds to the complete online service', () => {
    expect(selectRuntimeBaseUrl({
      platform: 'mp-weixin',
      envVersion: 'develop',
      hostPlatform: 'devtools',
    }, configuration)).toBe('https://youban.me')
  })

  it('ignores stale local overrides on physical devices', () => {
    expect(selectRuntimeBaseUrl({
      platform: 'mp-weixin',
      envVersion: 'develop',
      hostPlatform: 'ios',
      storedBaseUrl: 'http://127.0.0.1:7860',
    }, configuration)).toBe('https://youban.me')
  })

  it('keeps trial and release routing explicit', () => {
    expect(selectRuntimeBaseUrl({
      platform: 'mp-weixin',
      envVersion: 'trial',
      hostPlatform: 'ios',
    }, configuration)).toBe('https://trial.youban.me')
    expect(selectRuntimeBaseUrl({
      platform: 'mp-weixin',
      envVersion: 'release',
      hostPlatform: 'android',
    }, configuration)).toBe('https://youban.me')
  })
})
