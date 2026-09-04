import type { UserInfoDto } from '@youban/contracts'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { t } from '@/locale'
import {
  clearAuthSession,
  currentPlatform,
  getAuthToken,
  getStoredUser,
  registerAuthSessionInvalidation,
  setAuthSession,
} from '@/platform/auth'
import { isLoginReady, LOGIN_ROUTE } from '@/router/auth-guard'
import { authLogout, authMe, loginWechat } from '@/services/v2'

function wechatLoginCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success(result) {
        const code = String(result.code || '').trim()
        if (code)
          resolve(code)
        else
          reject(new Error(t('api.wechatCodeInvalid')))
      },
      fail() {
        reject(new Error(t('login.miniFailed')))
      },
    })
  })
}

export const useAuthStore = defineStore('youban-auth', () => {
  const token = ref(getAuthToken())
  const user = ref<UserInfoDto | null>(getStoredUser())
  const restored = ref(false)
  const ready = computed(() => isLoginReady(user.value) && (currentPlatform() !== 'mp-weixin' || Boolean(token.value)))
  let restorePromise: Promise<void> | null = null
  let loginPromise: Promise<UserInfoDto> | null = null
  let expiryRedirected = false

  registerAuthSessionInvalidation(() => {
    token.value = ''
    user.value = null
    restored.value = true
    if (expiryRedirected)
      return
    expiryRedirected = true
    uni.reLaunch({ url: LOGIN_ROUTE })
  })

  function clear(): void {
    token.value = ''
    user.value = null
    clearAuthSession()
  }

  function save(sessionToken: string, nextUser: UserInfoDto): UserInfoDto {
    if (!isLoginReady(nextUser))
      throw new Error(t('login.identityError'))
    token.value = sessionToken
    user.value = nextUser
    expiryRedirected = false
    setAuthSession(sessionToken, nextUser)
    return nextUser
  }

  async function restore(force = false): Promise<void> {
    if (restored.value && !force)
      return
    if (restorePromise)
      return restorePromise
    restorePromise = (async () => {
      if (currentPlatform() === 'mp-weixin' && !token.value) {
        clear()
        return
      }
      const nextUser = await authMe()
      if (isLoginReady(nextUser)) {
        user.value = nextUser
        setAuthSession(token.value, nextUser)
      }
      else {
        clear()
      }
    })().finally(() => {
      restored.value = true
      restorePromise = null
    })
    return restorePromise
  }

  async function loginMiniProgram(): Promise<UserInfoDto> {
    if (loginPromise)
      return loginPromise
    clear()
    loginPromise = (async () => {
      const code = await wechatLoginCode()
      const session = await loginWechat(code)
      try {
        return save(session.token, session.user)
      }
      catch (error) {
        await authLogout(session.token).catch(() => undefined)
        clear()
        throw error
      }
    })().finally(() => {
      loginPromise = null
      restored.value = true
    })
    return loginPromise
  }

  function acceptWebsiteSession(nextUser: UserInfoDto): UserInfoDto {
    if (currentPlatform() !== 'h5')
      throw new Error('Website sessions are unavailable on this platform')
    restored.value = true
    return save('', nextUser)
  }

  async function logout(): Promise<void> {
    const currentToken = token.value
    try {
      if (currentPlatform() === 'mp-weixin') {
        if (currentToken)
          await authLogout(currentToken).catch(() => undefined)
      }
      else {
        await authLogout('').catch(() => undefined)
      }
    }
    finally {
      clear()
      restored.value = true
    }
  }

  return {
    token,
    user,
    restored,
    ready,
    clear,
    acceptWebsiteSession,
    loginMiniProgram,
    logout,
    restore,
  }
})
