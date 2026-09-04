import type { UserInfoDto } from '@youban/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/auth'
import { apiRequest } from './client'

const readyUser: UserInfoDto = {
  user_id: 'user-1',
  nickname: '微信用户',
  avatar_url: '/api/avatars/avatar.png',
  profile_complete: true,
}

const storage = new Map<string, unknown>()

function respondWithStatus(statusCode: number): void {
  vi.mocked(uni.request).mockImplementation((options) => {
    options.success?.({
      data: { detail: '登录已失效' },
      statusCode,
      header: {},
      cookies: [],
      errMsg: 'request:ok',
    })
    return {} as UniApp.RequestTask
  })
}

describe('api authentication expiry', () => {
  beforeEach(() => {
    storage.clear()
    storage.set('youban.v2.auth-token', 'stale-token')
    storage.set('youban.v2.user', readyUser)
    vi.mocked(uni.getStorageSync).mockImplementation(key => storage.get(String(key)) ?? null)
    vi.mocked(uni.setStorageSync).mockImplementation((key, value) => {
      storage.set(String(key), value)
    })
    vi.mocked(uni.removeStorageSync).mockImplementation((key) => {
      storage.delete(String(key))
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps proxied H5 requests on the current origin', async () => {
    vi.stubEnv('VITE_APP_PROXY_ENABLE', 'true')
    vi.stubEnv('VITE_SERVER_BASEURL', 'https://youban.me')
    let requestUrl = ''
    vi.mocked(uni.request).mockImplementation((options) => {
      requestUrl = options.url
      options.success?.({
        data: { success: true },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: 'request:ok',
      })
      return {} as UniApp.RequestTask
    })

    await apiRequest('/api/v2/auth/web/challenges', { public: true })

    expect(requestUrl).toBe('/api/v2/auth/web/challenges')
  })

  it('clears the active session and returns to login after a private 401', async () => {
    const auth = useAuthStore()
    respondWithStatus(401)

    await expect(apiRequest('/api/v2/conversations')).rejects.toMatchObject({ status: 401 })

    expect(auth.ready).toBe(false)
    expect(auth.token).toBe('')
    expect(auth.user).toBeNull()
    expect(storage.has('youban.v2.auth-token')).toBe(false)
    expect(storage.has('youban.auth_token')).toBe(false)
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
  })

  it('does not clear a session for a public endpoint 401', async () => {
    const auth = useAuthStore()
    respondWithStatus(401)

    await expect(apiRequest('/api/v2/auth/wechat/login', { public: true })).rejects.toMatchObject({ status: 401 })

    expect(auth.ready).toBe(true)
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })
})
