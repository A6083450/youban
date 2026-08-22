import { createI18n } from 'vue-i18n'
import { DEFAULT_LOCALE, messages, type AppLocale } from './messages'
import { normalizeLocale } from './locale'

export type { AppLocale } from './messages'

const LOCALE_STORAGE_KEY = 'tripstar-locale'

const resolveInitialLocale = (): AppLocale => {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE
  }

  const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (saved) {
    return normalizeLocale(saved)
  }

  const browserLocale = window.navigator.language ?? DEFAULT_LOCALE
  return normalizeLocale(browserLocale)
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveInitialLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  globalInjection: true,
  messages,
})

export const setAppLocale = (locale: AppLocale) => {
  i18n.global.locale.value = locale

  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }
}

export const getCurrentLocale = (): AppLocale => i18n.global.locale.value as AppLocale

if (typeof window !== 'undefined') {
  document.documentElement.lang = getCurrentLocale()
}
