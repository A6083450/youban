import { describe, expect, it } from 'bun:test'
import {
  currentUser,
  invalidateSession,
  isLoginReady,
  logout,
  registerBeforeAuthTransition,
} from './auth'

describe('WeChat profile login boundary', () => {
  it('accepts only a completed WeChat account with an avatar', () => {
    expect(isLoginReady(null)).toBe(false)
    expect(isLoginReady({
      user_id: 'user-1', nickname: '微信用户', avatar_url: null, profile_complete: true,
    })).toBe(false)
    expect(isLoginReady({
      user_id: 'user-1', nickname: '微信用户', avatar_url: '/api/avatars/avatar.png', profile_complete: false,
    })).toBe(false)
    expect(isLoginReady({
      user_id: 'user-1', nickname: '微信用户', avatar_url: '/api/avatars/avatar.png', profile_complete: true,
    })).toBe(true)
  })

  it('clears the visible account as soon as the server session expires', () => {
    currentUser.value = {
      user_id: 'user-1', nickname: '微信用户', avatar_url: '/api/avatars/avatar.png', profile_complete: true,
    }
    expect(invalidateSession()).toBe(true)
    expect(currentUser.value).toBeNull()
    expect(invalidateSession()).toBe(false)
  })
})

describe('auth transition persistence boundary', () => {
  it('awaits registered persistence work before clearing the current user', async () => {
    currentUser.value = {
      user_id: 'user-1', nickname: 'Jason', avatar_url: '/api/avatars/avatar.png', profile_complete: true,
    }
    let release: (() => void) | undefined
    const unregister = registerBeforeAuthTransition(() => new Promise<void>((resolve) => {
      release = resolve
    }))

    const pendingLogout = logout()
    await Promise.resolve()
    expect(currentUser.value?.user_id).toBe('user-1')

    release?.()
    await pendingLogout
    expect(currentUser.value).toBeNull()
    unregister()
  })
})
