import type { UserInfoDto } from '@youban/contracts'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { t } from '@/locale'
import { clearAuthSession, currentPlatform, getAuthToken, getStoredUser, setAuthSession } from '@/platform/auth'
import { isLoginReady } from '@/router/auth-guard'
import { authLogout, authMe, loginWechat, uploadAccountAvatar } from '@/services/v2'

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

  function clear(): void {
    token.value = ''
    user.value = null
    clearAuthSession()
  }

  function save(sessionToken: string, nextUser: UserInfoDto): UserInfoDto {
    if (!isLoginReady(nextUser))
      throw new Error(t('api.avatarRequiredBeforeLogin'))
    token.value = sessionToken
    user.value = nextUser
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

  async function loginMiniProgramWithAvatar(filePath: string): Promise<UserInfoDto> {
    if (!filePath.trim())
      throw new Error(t('api.avatarRequired'))
    if (loginPromise)
      return loginPromise
    clear()
    loginPromise = (async () => {
      const code = await wechatLoginCode()
      const session = await loginWechat(code)
      try {
        const completedUser = await uploadAccountAvatar(filePath, session.token)
        return save(session.token, completedUser)
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

  async function logout(): Promise<void> {
    const currentToken = token.value
    try {
      await authLogout(currentPlatform() === 'mp-weixin' ? currentToken : '')
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
    loginMiniProgramWithAvatar,
    logout,
    restore,
  }
})
