import { ref } from 'vue'

export type AppSkin = 'default' | 'google'

export const SKIN_STORAGE_KEY = 'tripstar.skin'

export const normalizeSkin = (value: unknown): AppSkin =>
  value === 'google' ? 'google' : 'default'

export const readStoredSkin = (): AppSkin => {
  try {
    return normalizeSkin(globalThis.localStorage?.getItem(SKIN_STORAGE_KEY))
  } catch {
    return 'default'
  }
}

export const skin = ref<AppSkin>('default')

export const applySkin = (nextSkin: AppSkin): void => {
  skin.value = normalizeSkin(nextSkin)
  try {
    globalThis.localStorage?.setItem(SKIN_STORAGE_KEY, skin.value)
  } catch {
    // Persistence is optional in privacy-restricted browser contexts.
  }
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.dataset.skin = skin.value
  }
}

export const initializeSkin = (): void => applySkin(readStoredSkin())
