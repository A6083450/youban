import type { UserInfoDto } from '@youban/contracts'
import { isH5, isMpWeixin } from '@uni-helper/uni-env'
import { getStoredValue, setStoredValue, StorageKeys } from './storage'

export type AppPlatform = 'h5' | 'mp-weixin'

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
  return getStoredValue<string>(StorageKeys.authToken) ?? ''
}

export function setAuthSession(token: string, user: UserInfoDto): void {
  setStoredValue(StorageKeys.authToken, token.trim() || null)
  setStoredValue(StorageKeys.user, user)
}

export function clearAuthSession(): void {
  setStoredValue(StorageKeys.authToken, null)
  setStoredValue(StorageKeys.user, null)
}

export function getStoredUser(): UserInfoDto | null {
  return getStoredValue<UserInfoDto>(StorageKeys.user)
}

export function authHeaders(): Record<string, string> {
  return buildAuthHeaders(currentPlatform(), getAuthToken())
}
