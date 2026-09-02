import type { UserInfoDto } from '@youban/contracts'
import { describe, expect, it } from 'vitest'
import { authRouteDecision, isLoginReady, isPublicRoute } from './auth-guard'

const readyUser: UserInfoDto = {
  user_id: 'user-1',
  nickname: '旅行者',
  avatar_url: '/api/v2/avatars/avatar.png',
  profile_complete: true,
}

describe('authentication route guard', () => {
  it('keeps login, privacy, public shares and H5 admin public', () => {
    expect(isPublicRoute('/pages/login/index')).toBe(true)
    expect(isPublicRoute('/pages/privacy/index')).toBe(true)
    expect(isPublicRoute('/pages/share/index?code=public-code')).toBe(true)
    expect(isPublicRoute('/pages/admin/index')).toBe(true)
    expect(isPublicRoute('/pages/web-login/index?scene=challenge')).toBe(true)
  })

  it('redirects private routes until a complete profile exists', () => {
    expect(authRouteDecision('/pages/index/index', false)).toBe('login')
    expect(authRouteDecision('/pages/plan/index?id=plan-1', false)).toBe('login')
    expect(authRouteDecision('/pages/index/index', true)).toBe('allow')
  })

  it('redirects an authenticated login visit home', () => {
    expect(authRouteDecision('/pages/login/index', true)).toBe('home')
    expect(authRouteDecision('/pages/privacy/index', true)).toBe('allow')
  })

  it('requires a completed profile while allowing an unavailable website avatar', () => {
    expect(isLoginReady(readyUser)).toBe(true)
    expect(isLoginReady({ ...readyUser, avatar_url: null })).toBe(true)
    expect(isLoginReady({ ...readyUser, profile_complete: false })).toBe(false)
    expect(isLoginReady(null)).toBe(false)
  })
})
