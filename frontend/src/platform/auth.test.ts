import type { UserInfoDto } from '@youban/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthHeaders,
  clearAuthSession,
  getAuthToken,
  getStoredUser,
  setAuthSession,
} from './auth'

const readyUser: UserInfoDto = {
  user_id: 'legacy-user',
  nickname: '升级用户',
  avatar_url: '/api/avatars/avatar.png',
  profile_complete: true,
}

const storage = new Map<string, unknown>()

beforeEach(() => {
  storage.clear()
  vi.mocked(uni.getStorageSync).mockImplementation(key => storage.get(String(key)) ?? null)
  vi.mocked(uni.setStorageSync).mockImplementation((key, value) => {
    storage.set(String(key), value)
  })
  vi.mocked(uni.removeStorageSync).mockImplementation((key) => {
    storage.delete(String(key))
  })
})

describe('platform auth headers', () => {
  it('uses the HttpOnly cookie session on H5', () => {
    expect(buildAuthHeaders('h5', 'mini-token')).toEqual({})
  })

  it('uses a bearer token in the WeChat mini program', () => {
    expect(buildAuthHeaders('mp-weixin', 'mini-token')).toEqual({
      Authorization: 'Bearer mini-token',
    })
  })

  it('does not emit an empty bearer header', () => {
    expect(buildAuthHeaders('mp-weixin', '')).toEqual({})
  })

  it('recovers the legacy mini-program session after a 2.0 upgrade', () => {
    storage.set('youban.auth_token', 'legacy-token')
    storage.set('youban.user', readyUser)

    expect(getAuthToken()).toBe('legacy-token')
    expect(getStoredUser()).toEqual(readyUser)

    setAuthSession('legacy-token', readyUser)

    expect(storage.get('youban.v2.auth-token')).toBe('legacy-token')
    expect(storage.get('youban.v2.user')).toEqual(readyUser)
    expect(storage.has('youban.auth_token')).toBe(false)
    expect(storage.has('youban.user')).toBe(false)
  })

  it('clears both current and legacy mini-program sessions', () => {
    for (const key of [
      'youban.v2.auth-token',
      'youban.v2.user',
      'youban.auth_token',
      'youban.user',
    ]) {
      storage.set(key, 'stored')
    }

    clearAuthSession()

    expect([...storage.keys()]).toEqual([])
  })
})
