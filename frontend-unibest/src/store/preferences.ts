import type {
  UserLocaleDto,
  UserPreferencesDto,
  UserPreferencesPatchDto,
  UserSkinDto,
} from '@youban/contracts'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getCurrentLocale, normalizeAppLocale, setAppLocale } from '@/locale'
import { getStoredValue, setStoredValue, StorageKeys } from '@/platform/storage'
import { getAuthPreferences, patchAuthPreferences } from '@/services/v2'
import { useAuthStore } from './auth'

export interface PreferenceValues {
  skin: UserSkinDto
  locale: UserLocaleDto
}

interface PreferenceControllerDependencies {
  authenticated: () => boolean
  local: () => PreferenceValues
  remote: () => Promise<UserPreferencesDto>
  patch: (patch: UserPreferencesPatchDto) => Promise<UserPreferencesDto>
  apply: (values: PreferenceValues) => void
}

export function createPreferenceController(dependencies: PreferenceControllerDependencies) {
  return {
    async sync(): Promise<PreferenceValues> {
      const local = dependencies.local()
      if (!dependencies.authenticated()) {
        dependencies.apply(local)
        return local
      }
      try {
        const remote = await dependencies.remote()
        const resolved = remote.initialized
          ? { skin: remote.skin, locale: remote.locale }
          : await dependencies.patch(local)
        const values = { skin: resolved.skin, locale: resolved.locale }
        dependencies.apply(values)
        return values
      }
      catch {
        dependencies.apply(local)
        return local
      }
    },
    async set(patch: UserPreferencesPatchDto): Promise<void> {
      const next = { ...dependencies.local(), ...patch }
      dependencies.apply(next)
      if (dependencies.authenticated())
        await dependencies.patch(patch).catch(() => undefined)
    },
  }
}

const themeVariables: Record<UserSkinDto, Record<string, string>> = {
  default: {
    '--surface-page': '#faf7f2',
    '--surface-navigation': '#fffaf6',
    '--surface-soft': '#f5f0e8',
    '--surface-elevated': '#ffffff',
    '--text-primary': '#3d3229',
    '--text-secondary': '#6b5d52',
    '--accent-primary': '#d97757',
    '--accent-strong': '#c4603d',
    '--accent-soft': 'rgba(217, 119, 87, 0.1)',
    '--border-subtle': 'rgba(61, 50, 41, 0.12)',
    '--status-danger': '#c2413a',
  },
  google: {
    '--surface-page': '#f5f9fc',
    '--surface-navigation': '#eef7f9',
    '--surface-soft': '#eaf3f7',
    '--surface-elevated': '#ffffff',
    '--text-primary': '#22313a',
    '--text-secondary': '#61727b',
    '--accent-primary': '#3b9bb4',
    '--accent-strong': '#267a93',
    '--accent-soft': 'rgba(59, 155, 180, 0.1)',
    '--border-subtle': '#d5e4ea',
    '--status-danger': '#c85c5c',
  },
}

function normalizeSkin(value: unknown): UserSkinDto {
  return value === 'google' ? 'google' : 'default'
}

export const usePreferencesStore = defineStore('youban-preferences', () => {
  const auth = useAuthStore()
  const skin = ref<UserSkinDto>(normalizeSkin(getStoredValue(StorageKeys.skin)))
  const locale = ref<UserLocaleDto>(normalizeAppLocale(getStoredValue(StorageKeys.locale) || getCurrentLocale()))
  const themeClass = computed(() => skin.value === 'google' ? 'theme-clear' : 'theme-warm')

  function apply(values: PreferenceValues): void {
    skin.value = normalizeSkin(values.skin)
    locale.value = normalizeAppLocale(values.locale)
    setStoredValue(StorageKeys.skin, skin.value)
    setStoredValue(StorageKeys.locale, locale.value)
    setAppLocale(locale.value)
    const colors = themeVariables[skin.value]
    // #ifdef H5
    const root = document.documentElement
    root.dataset.skin = skin.value
    Object.entries(colors).forEach(([name, value]) => root.style.setProperty(name, value))
    // #endif
    uni.setNavigationBarColor({
      frontColor: '#000000',
      backgroundColor: colors['--surface-navigation'],
      animation: { duration: 180, timingFunc: 'easeIn' },
      fail: () => undefined,
    })
  }

  const controller = createPreferenceController({
    authenticated: () => auth.ready,
    local: () => ({ skin: skin.value, locale: locale.value }),
    remote: getAuthPreferences,
    patch: patchAuthPreferences,
    apply,
  })

  async function sync(): Promise<void> {
    await controller.sync()
  }

  async function setSkin(value: UserSkinDto): Promise<void> {
    await controller.set({ skin: value })
  }

  async function setLocale(value: UserLocaleDto): Promise<void> {
    await controller.set({ locale: value })
  }

  apply({ skin: skin.value, locale: locale.value })

  return { locale, setLocale, setSkin, skin, sync, themeClass }
})
