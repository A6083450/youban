import type { UserInfoDto } from '@youban/contracts'
import { isH5, isMpWeixin } from '@uni-helper/uni-env'
import { getStoredValue, setStoredValue, StorageKeys } from './storage'

export type AppPlatform = 'h5' | 'mp-weixin'

const LegacyStorageKeys = {
  authToken: 'youban.auth_token',
  user: 'youban.user',
} as const

let invalidationListener: (() => void) | null = null

export function currentPlatform(): AppPlatform {
  if (isMpWeixin)
    return 'mp-weixin'
  if (isH5)
    return 'h5'
  return 'h5'
}

export function buildAuthHeaders(platform: AppPlatform, token: string): Record<string, string> {
  if (platform !== 'mp-weixin' || !token.trim())
    return {}
  return { Authorization: `Bearer ${token.trim()}` }
}

export function getAuthToken(): string {
  return getStoredValue<string>(StorageKeys.authToken)
    ?? getStoredValue<string>(LegacyStorageKeys.authToken)
    ?? ''
}

export function setAuthSession(token: string, user: UserInfoDto): void {
  setStoredValue(StorageKeys.authToken, token.trim() || null)
  setStoredValue(StorageKeys.user, user)
  setStoredValue(LegacyStorageKeys.authToken, null)
  setStoredValue(LegacyStorageKeys.user, null)
}

export function clearAuthSession(): void {
  setStoredValue(StorageKeys.authToken, null)
  setStoredValue(StorageKeys.user, null)
  setStoredValue(LegacyStorageKeys.authToken, null)
  setStoredValue(LegacyStorageKeys.user, null)
}

export function getStoredUser(): UserInfoDto | null {
  return getStoredValue<UserInfoDto>(StorageKeys.user)
    ?? getStoredValue<UserInfoDto>(LegacyStorageKeys.user)
}

export function authHeaders(): Record<string, string> {
  return buildAuthHeaders(currentPlatform(), getAuthToken())
}

export function registerAuthSessionInvalidation(listener: () => void): void {
  invalidationListener = listener
}

export function expireAuthSession(): void {
  clearAuthSession()
  invalidationListener?.()
}
