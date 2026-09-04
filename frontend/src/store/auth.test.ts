import type { UserInfoDto } from '@youban/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './auth'

const readyUser: UserInfoDto = {
  user_id: 'user-1',
  nickname: '微信用户',
  avatar_url: '/api/v2/avatars/avatar.png',
  profile_complete: true,
}

const authApi = vi.hoisted(() => ({
  authLogout: vi.fn(),
  authMe: vi.fn(),
  loginWechat: vi.fn(),
}))

vi.mock('@/services/v2', () => authApi)

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(uni.getStorageSync).mockReturnValue(null)
  })

  it('rejects an incomplete mini-program identity response', async () => {
    authApi.loginWechat.mockResolvedValue({ token: 'pending-token', user: { ...readyUser, avatar_url: null, profile_complete: false } })
    authApi.authLogout.mockResolvedValue(undefined)
    const store = useAuthStore()

    await expect(store.loginMiniProgram()).rejects.toThrow()

    expect(store.user).toBeNull()
    expect(store.token).toBe('')
    expect(uni.setStorageSync).not.toHaveBeenCalled()
    expect(authApi.authLogout).toHaveBeenCalledWith('pending-token')
  })

  it('persists the mini-program session without requesting an avatar', async () => {
    const account = { ...readyUser, avatar_url: null }
    authApi.loginWechat.mockResolvedValue({ token: 'ready-token', user: account })
    const store = useAuthStore()

    await expect(store.loginMiniProgram()).resolves.toEqual(account)

    expect(store.ready).toBe(true)
    expect(store.token).toBe('ready-token')
    expect(store.user).toEqual(account)
  })

  it('restores a complete website profile when its authorized avatar is unavailable', async () => {
    const websiteUser = { ...readyUser, avatar_url: null }
    authApi.authMe.mockResolvedValue(websiteUser)
    const store = useAuthStore()

    await store.restore()

    expect(store.user).toEqual(websiteUser)
    expect(store.ready).toBe(true)
  })

  it('accepts a ready website session without exposing a bearer token', () => {
    const nicknameUser = { ...readyUser, nickname: '旅行者', avatar_url: null }
    const store = useAuthStore() as ReturnType<typeof useAuthStore> & {
      acceptWebsiteSession?: (user: UserInfoDto) => UserInfoDto
    }

    expect(store.acceptWebsiteSession).toEqual(expect.any(Function))
    expect(store.acceptWebsiteSession!(nicknameUser)).toEqual(nicknameUser)
    expect(store.ready).toBe(true)
    expect(store.token).toBe('')
    expect(store.user).toEqual(nicknameUser)
  })

  it('finishes website logout when the server session is already expired', async () => {
    const nicknameUser = { ...readyUser, nickname: '旅行者', avatar_url: null }
    const store = useAuthStore()
    store.acceptWebsiteSession(nicknameUser)
    authApi.authLogout.mockRejectedValue(new Error('登录已失效'))

    await expect(store.logout()).resolves.toBeUndefined()

    expect(authApi.authLogout).toHaveBeenCalledWith('')
    expect(store.user).toBeNull()
    expect(store.token).toBe('')
    expect(store.ready).toBe(false)
    expect(store.restored).toBe(true)
  })
})
