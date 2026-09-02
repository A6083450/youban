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
    '--accent-focus': 'rgba(217, 119, 87, 0.24)',
    '--accent-selected': 'rgba(217, 119, 87, 0.14)',
    '--border-subtle': 'rgba(61, 50, 41, 0.12)',
    '--status-success': '#3a9c7a',
    '--status-danger': '#c2413a',
    '--result-page-image': 'linear-gradient(180deg, #faf7f2 0%, #f5f0e8 58%, #ede6da 100%)',
    '--result-panel': 'rgba(255, 255, 255, 0.65)',
    '--result-sticky': 'rgba(255, 255, 255, 0.92)',
    '--result-panel-shadow': '0 24px 80px rgba(61, 50, 41, 0.1)',
    '--journey-hero': '#fdf8ec',
    '--journey-hero-border': '#eadfc9',
    '--journey-hero-overlay-start': 'rgba(253, 250, 243, 0.97)',
    '--journey-hero-overlay-middle': 'rgba(253, 250, 243, 0.75)',
    '--journey-hero-overlay-end': 'rgba(253, 250, 243, 0.25)',
    '--journey-muted': '#b09a77',
    '--journey-rail': '#d9c6a4',
    '--journey-card': '#fffdf8',
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
    '--accent-focus': 'rgba(59, 155, 180, 0.24)',
    '--accent-selected': 'rgba(59, 155, 180, 0.14)',
    '--border-subtle': '#d5e4ea',
    '--status-success': '#2d8c72',
    '--status-danger': '#c85c5c',
    '--result-page-image': 'linear-gradient(180deg, #f5f9fc 0%, #eef7f9 58%, #e7f1f4 100%)',
    '--result-panel': 'rgba(255, 255, 255, 0.82)',
    '--result-sticky': 'rgba(255, 255, 255, 0.94)',
    '--result-panel-shadow': '0 20px 64px rgba(34, 76, 89, 0.1)',
    '--journey-hero': '#eff8fa',
    '--journey-hero-border': '#cfe4e9',
    '--journey-hero-overlay-start': 'rgba(239, 248, 250, 0.97)',
    '--journey-hero-overlay-middle': 'rgba(239, 248, 250, 0.78)',
    '--journey-hero-overlay-end': 'rgba(239, 248, 250, 0.28)',
    '--journey-muted': '#6d8d98',
    '--journey-rail': '#bdd7de',
    '--journey-card': '#fbfeff',
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
