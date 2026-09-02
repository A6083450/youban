import { ref } from 'vue'
import type { UserInfo } from '@/types'
import { authLogout, authMe, getStoredUser, setStoredUser } from '@/services/api'

export const AUTH_UPDATED_EVENT = 'tripstar:auth-updated'

export const currentUser = ref<UserInfo | null>(null)
let restorePromise: Promise<void> | null = null

export const isLoginReady = (user: UserInfo | null | undefined): user is UserInfo =>
  Boolean(user?.user_id && user.profile_complete && user.avatar_url)

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

export async function completeWebLogin(user: UserInfo): Promise<UserInfo> {
  if (!isLoginReady(user)) {
    setStoredUser(null)
    currentUser.value = null
    throw new Error('请先在小程序选择微信头像完成登录')
  }
  await waitForBeforeAuthTransition()
  setStoredUser(user)
  currentUser.value = user
  emitAuthUpdated()
  return user
}

export async function logout(): Promise<void> {
  await waitForBeforeAuthTransition()
  try { await authLogout() } catch { /* local logout remains available offline */ }
  setStoredUser(null)
  currentUser.value = null
  emitAuthUpdated()
}

export function invalidateSession(): boolean {
  const hadSession = Boolean(currentUser.value || getStoredUser())
  setStoredUser(null)
  currentUser.value = null
  if (hadSession) emitAuthUpdated()
  return hadSession
}

/** 启动时静默校验本地会话;用户已被后端删除时清除本地状态 */
export async function restoreSession(): Promise<void> {
  const previousUserId = currentUser.value?.user_id || ''
  const user = await authMe()
  if (isLoginReady(user)) {
    setStoredUser(user)
    currentUser.value = user
    if (previousUserId !== user.user_id) emitAuthUpdated()
  } else {
    setStoredUser(null)
    currentUser.value = null
  }
}

export function ensureSessionRestored(): Promise<void> {
  if (!restorePromise) restorePromise = restoreSession()
  return restorePromise
}
