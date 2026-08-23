import { describe, expect, it } from 'bun:test'
import {
  currentUser,
  logout,
  registerBeforeAuthTransition,
} from './auth'

describe('auth transition persistence boundary', () => {
  it('awaits registered persistence work before clearing the current user', async () => {
    currentUser.value = { user_id: 'user-1', nickname: 'Jason' }
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
