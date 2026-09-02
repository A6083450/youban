const STORAGE_PREFIX = 'youban.v2.'

export const StorageKeys = {
  authToken: `${STORAGE_PREFIX}auth-token`,
  user: `${STORAGE_PREFIX}user`,
  apiBaseUrl: `${STORAGE_PREFIX}api-base-url`,
  locale: `${STORAGE_PREFIX}locale`,
  skin: `${STORAGE_PREFIX}skin`,
  activeTask: `${STORAGE_PREFIX}active-task`,
  pendingWebLoginChallenge: `${STORAGE_PREFIX}pending-web-login-challenge`,
} as const

export function getStoredValue<T>(key: string): T | null {
  const value = uni.getStorageSync(key)
  return value === '' || value === undefined || value === null ? null : value as T
}

export function setStoredValue<T>(key: string, value: T | null): void {
  if (value === null) {
    uni.removeStorageSync(key)
    return
  }
  uni.setStorageSync(key, value)
}
