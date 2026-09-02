import { getCurrentLocale, setAppLocale, type AppLocale } from '@/i18n'
import {
  getAuthPreferences,
  patchAuthPreferences,
  type AuthPreferences as ApiAuthPreferences,
} from '@/services/api'
import { currentUser } from './auth'
import { applySkin, skin, type AppSkin } from './skin'
import { getSkinDefinition } from '@/themes'
import { syncMiniProgramNavigationColor } from '@/platform/miniProgramHost'

export interface AccountPreferenceValues {
  skin: AppSkin
  locale: AppLocale
}

export interface AuthPreferences extends AccountPreferenceValues {
  initialized: boolean
  updated_at: string | null
}

interface AccountPreferenceDependencies {
  isAuthenticated(): boolean
  readLocal(): AccountPreferenceValues
  applyLocal(preferences: AccountPreferenceValues): void
  getRemote(): Promise<AuthPreferences>
  patchRemote(patch: Partial<AccountPreferenceValues>): Promise<AuthPreferences>
  syncPlatformSkin(skin: AppSkin): void
}

export function createAccountPreferenceController(dependencies: AccountPreferenceDependencies) {
  const apply = (preferences: AccountPreferenceValues): AccountPreferenceValues => {
    dependencies.applyLocal(preferences)
    return preferences
  }

  const synchronizeSkin = (preferences: AccountPreferenceValues): AccountPreferenceValues => {
    dependencies.syncPlatformSkin(preferences.skin)
    return preferences
  }

  return {
    async sync(): Promise<AccountPreferenceValues> {
      const local = dependencies.readLocal()
      if (!dependencies.isAuthenticated()) return apply(local)
      try {
        const remote = await dependencies.getRemote()
        if (remote.initialized) return synchronizeSkin(apply({ skin: remote.skin, locale: remote.locale }))
        const initialized = await dependencies.patchRemote(local)
        return synchronizeSkin(apply({ skin: initialized.skin, locale: initialized.locale }))
      } catch {
        return synchronizeSkin(apply(local))
      }
    },

    async setSkin(nextSkin: AppSkin): Promise<void> {
      apply({ ...dependencies.readLocal(), skin: nextSkin })
      if (dependencies.isAuthenticated()) {
        try { await dependencies.patchRemote({ skin: nextSkin }) } catch { /* local offline fallback remains active */ }
      }
      dependencies.syncPlatformSkin(nextSkin)
    },

    async setLocale(nextLocale: AppLocale): Promise<void> {
      apply({ ...dependencies.readLocal(), locale: nextLocale })
      if (!dependencies.isAuthenticated()) return
      try { await dependencies.patchRemote({ locale: nextLocale }) } catch { /* local offline fallback remains active */ }
    },
  }
}

const controller = createAccountPreferenceController({
  isAuthenticated: () => Boolean(currentUser.value),
  readLocal: () => ({ skin: skin.value, locale: getCurrentLocale() }),
  applyLocal: (preferences) => {
    applySkin(preferences.skin)
    setAppLocale(preferences.locale)
  },
  getRemote: async () => await getAuthPreferences() as ApiAuthPreferences,
  patchRemote: async (patch) => await patchAuthPreferences(patch) as ApiAuthPreferences,
  syncPlatformSkin: (nextSkin) => {
    const color = getSkinDefinition(nextSkin).cssVariables['--surface-navigation']
    syncMiniProgramNavigationColor(color)
  },
})

let syncPromise: Promise<AccountPreferenceValues> | null = null

export function syncAccountPreferences(): Promise<AccountPreferenceValues> {
  if (syncPromise) return syncPromise
  syncPromise = controller.sync().finally(() => { syncPromise = null })
  return syncPromise
}

export const setAccountSkin = async (nextSkin: AppSkin): Promise<void> => {
  await controller.setSkin(nextSkin)
}

export const setAccountLocale = async (nextLocale: AppLocale): Promise<void> => {
  await controller.setLocale(nextLocale)
}
