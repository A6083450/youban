import { describe, expect, it } from 'bun:test'
import { authRouteDecision, shouldRestoreAuthentication } from './auth-guard'

describe('Web authentication route guard', () => {
  it('keeps public shares and admin routes open without a WeChat session', () => {
    expect(authRouteDecision({ name: 'Share', path: '/share/token' }, false, false)).toBe('allow')
    expect(authRouteDecision({ name: 'Admin', path: '/admin' }, false, false)).toBe('allow')
    expect(authRouteDecision({ name: 'Privacy', path: '/privacy' }, false, false)).toBe('allow')
  })

  it('does not restore a private session while booting public routes', () => {
    expect(shouldRestoreAuthentication({ name: 'Share', path: '/share/token' })).toBeFalse()
    expect(shouldRestoreAuthentication({ name: 'Privacy', path: '/privacy' })).toBeFalse()
    expect(shouldRestoreAuthentication({ name: 'Admin', path: '/admin' })).toBeFalse()
    expect(shouldRestoreAuthentication({ name: 'ChatHome', path: '/' })).toBeTrue()
  })

  it('redirects private routes to login until a completed profile is restored', () => {
    expect(authRouteDecision({ name: 'ChatHome', path: '/' }, false, false)).toBe('login')
    expect(authRouteDecision({ name: 'ChatHome', path: '/' }, true, false)).toBe('allow')
    expect(authRouteDecision({ name: 'Login', path: '/login' }, true, false)).toBe('home')
  })
})
