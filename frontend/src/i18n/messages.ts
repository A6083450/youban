import en from './locales/en.json'
import zh from './locales/zh.json'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

export const messages = {
  'zh-CN': zh,
  'en-US': en,
}
