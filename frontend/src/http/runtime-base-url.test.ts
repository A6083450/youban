import { describe, expect, it } from 'vitest'
import { selectRuntimeBaseUrl } from './runtime-base-url'

const configuration = {
  fallback: 'https://youban.me',
  develop: 'http://127.0.0.1:7860',
  trial: 'https://trial.youban.me',
  release: 'https://youban.me',
}

describe('runtime API base URL', () => {
  it('uses the H5 fallback address', () => {
    expect(selectRuntimeBaseUrl('h5', undefined, configuration)).toBe('https://youban.me')
  })

  it('selects the WeChat environment-specific address', () => {
    expect(selectRuntimeBaseUrl('mp-weixin', 'develop', configuration)).toBe('http://127.0.0.1:7860')
    expect(selectRuntimeBaseUrl('mp-weixin', 'trial', configuration)).toBe('https://trial.youban.me')
    expect(selectRuntimeBaseUrl('mp-weixin', 'release', configuration)).toBe('https://youban.me')
  })
})
