export type AdminSection = 'settings' | 'skills' | 'trips'

export interface AdminSectionItem {
  id: AdminSection
  labelKey: `admin.navigation.${AdminSection}`
}

export const ADMIN_SECTIONS: readonly AdminSectionItem[] = [
  { id: 'settings', labelKey: 'admin.navigation.settings' },
  { id: 'skills', labelKey: 'admin.navigation.skills' },
  { id: 'trips', labelKey: 'admin.navigation.trips' },
]

export const ADMIN_SECTION_STORAGE_KEY = 'youban.admin.section'

type AdminSectionReader = Pick<Storage, 'getItem'>
type AdminSectionWriter = Pick<Storage, 'setItem'>

export const normalizeAdminSection = (value: unknown): AdminSection =>
  value === 'settings' || value === 'skills' || value === 'trips' ? value : 'settings'

export const readStoredAdminSection = (storage?: AdminSectionReader | null): AdminSection => {
  try {
    return normalizeAdminSection(storage?.getItem(ADMIN_SECTION_STORAGE_KEY))
  } catch {
    return 'settings'
  }
}

export const storeAdminSection = (
  section: AdminSection,
  storage?: AdminSectionWriter | null,
): void => {
  try {
    storage?.setItem(ADMIN_SECTION_STORAGE_KEY, section)
  } catch {
    // Storage can be unavailable in private browsing or test environments.
  }
}
