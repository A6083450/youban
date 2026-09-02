import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './auth'

const mocks = vi.hoisted(() => ({
  authLogout: vi.fn(),
  clearAuthSession: vi.fn(),
  token: '',
}))

vi.mock('@/platform/auth', () => ({
  clearAuthSession: mocks.clearAuthSession,
  currentPlatform: () => 'mp-weixin',
  getAuthToken: () => mocks.token,
  getStoredUser: () => null,
  setAuthSession: vi.fn(),
}))

vi.mock('@/services/v2', () => ({
  authLogout: mocks.authLogout,
  authMe: vi.fn(),
  loginWechat: vi.fn(),
  uploadAccountAvatar: vi.fn(),
}))

describe('mini-program authentication boundary', () => {
  beforeEach(() => {
    mocks.token = ''
    vi.clearAllMocks()
  })

  it('does not expose website nickname login through the mini-program auth store', () => {
    const store = useAuthStore()

    expect(store).not.toHaveProperty('loginWebsiteWithNickname')
    expect(store.ready).toBe(false)
  })

  it('logs out locally without requesting the server when no token exists', async () => {
    const store = useAuthStore()

    await expect(store.logout()).resolves.toBeUndefined()

    expect(mocks.authLogout).not.toHaveBeenCalled()
    expect(mocks.clearAuthSession).toHaveBeenCalledTimes(1)
  })

  it('completes local logout when the remote session is already invalid', async () => {
    mocks.token = 'stale-token'
    mocks.authLogout.mockRejectedValue(new Error('登录已失效'))
    const store = useAuthStore()

    await expect(store.logout()).resolves.toBeUndefined()

    expect(mocks.authLogout).toHaveBeenCalledWith('stale-token')
    expect(mocks.clearAuthSession).toHaveBeenCalledTimes(1)
    expect(store.token).toBe('')
    expect(store.user).toBeNull()
  })
})
