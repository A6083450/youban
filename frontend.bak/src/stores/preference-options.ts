import type { AppLocale } from '@/i18n'
import type { AppSkin } from './skin'

export const VISIBLE_LOCALE_OPTIONS: ReadonlyArray<{
  value: AppLocale
  labelKey: 'app.language.zh' | 'app.language.en' | 'app.language.fr'
}> = [
  { value: 'zh-CN', labelKey: 'app.language.zh' },
  { value: 'en-US', labelKey: 'app.language.en' },
  { value: 'fr-FR', labelKey: 'app.language.fr' },
]

export const VISIBLE_SKIN_OPTIONS: ReadonlyArray<{
  value: AppSkin
  labelKey: 'app.skin.warm' | 'app.skin.clear'
  swatch: 'warm' | 'clear'
}> = [
  { value: 'default', labelKey: 'app.skin.warm', swatch: 'warm' },
  { value: 'google', labelKey: 'app.skin.clear', swatch: 'clear' },
]
