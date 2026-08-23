import { ref } from 'vue'
import type { UserInfo } from '@/types'
import { authLogin, authMe, getStoredUser, setStoredUser } from '@/services/api'

export const AUTH_UPDATED_EVENT = 'tripstar:auth-updated'

export const currentUser = ref<UserInfo | null>(getStoredUser())

type BeforeAuthTransition = () => unknown | Promise<unknown>
const beforeAuthTransitionListeners = new Set<BeforeAuthTransition>()

export const registerBeforeAuthTransition = (listener: BeforeAuthTransition): (() => void) => {
  beforeAuthTransitionListeners.add(listener)
  return () => { beforeAuthTransitionListeners.delete(listener) }
}

const waitForBeforeAuthTransition = async (): Promise<void> => {
  await Promise.allSettled([...beforeAuthTransitionListeners].map((listener) => listener()))
}

const emitAuthUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_UPDATED_EVENT))
  }
}

export async function loginWithNickname(nickname: string): Promise<UserInfo> {
  const user = await authLogin(nickname)
  await waitForBeforeAuthTransition()
  setStoredUser(user)
  currentUser.value = user
  emitAuthUpdated()
  return user
}

export async function logout(): Promise<void> {
  await waitForBeforeAuthTransition()
  setStoredUser(null)
  currentUser.value = null
  emitAuthUpdated()
}

/** 启动时静默校验本地会话;用户已被后端删除时清除本地状态 */
export async function restoreSession(): Promise<void> {
  if (!currentUser.value) return
  const user = await authMe()
  if (!user) {
    await logout()
  } else {
    setStoredUser(user)
    currentUser.value = user
  }
}
