import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type AppLocale } from './messages'

export const normalizeLocale = (value: unknown): AppLocale => {
  if (typeof value !== 'string') return DEFAULT_LOCALE
  if (SUPPORTED_LOCALES.includes(value as AppLocale)) {
    return value as AppLocale
  }

  const language = value.trim().toLowerCase().split('-')[0]
  const matched = SUPPORTED_LOCALES.find((item) =>
    item.toLowerCase().startsWith(`${language}-`),
  )
  return matched ?? DEFAULT_LOCALE
}
