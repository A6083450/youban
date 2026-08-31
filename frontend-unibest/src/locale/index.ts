import { createI18n } from 'vue-i18n'

import demoEn from './en.json'
import productEn from './product-en.json'
import productFr from './product-fr.json'
import productZh from './product-zh.json'
import demoZh from './zh-Hans.json'
import { formatRuntimeMessage } from './message-compiler'

const messages = {
  'en': { ...productEn, ...demoEn },
  'en-US': { ...productEn, ...demoEn },
  'fr': productFr,
  'fr-FR': productFr,
  'zh-CN': { ...productZh, ...demoZh },
  'zh-Hans': { ...productZh, ...demoZh },
}

export type AppLocale = 'zh-CN' | 'en-US' | 'fr-FR'

export function normalizeAppLocale(value: unknown): AppLocale {
  const text = String(value || '').trim().toLowerCase()
  if (text.startsWith('en'))
    return 'en-US'
  if (text.startsWith('fr'))
    return 'fr-FR'
  return 'zh-CN'
}

function uniLocale(locale: AppLocale): 'zh-Hans' | 'en' | 'fr' {
  if (locale === 'en-US')
    return 'en'
  if (locale === 'fr-FR')
    return 'fr'
  return 'zh-Hans'
}

type I18nData = Record<string, unknown>

function resolvePath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) {
      return undefined
    }
    return (value as Record<string, unknown>)[segment]
  }, source)
}

const i18n = createI18n({
  locale: normalizeAppLocale(uni.getLocale()),
  fallbackLocale: 'zh-CN',
  messages,
  allowComposition: true,
})

export function getCurrentLocale(): AppLocale {
  return normalizeAppLocale(i18n.global.locale)
}

export function setAppLocale(locale: AppLocale): void {
  const normalized = normalizeAppLocale(locale)
  i18n.global.locale = normalized
  try {
    uni.setLocale(uniLocale(normalized))
  }
  catch {
    // Some H5 browsers expose locale as read-only; vue-i18n remains authoritative.
  }
  // #ifdef H5
  document.documentElement.lang = normalized
  // #endif
}

/**
 * 可以拿到原始的语言模板，非 vue 文件使用这个方法，
 * @param { string } key 多语言的key，eg: "app.name"
 * @returns {string} 返回原始的多语言模板，eg: "{heavy}KG"
 */
export function getTemplateByKey(key: string) {
  if (!key) {
    console.error(`[i18n] Function getTemplateByKey(), key param is required`)
    return ''
  }
  const locale = getCurrentLocale() as keyof typeof messages

  const message = messages[locale] ?? messages['zh-Hans']
  const directTemplate = (message as Record<string, unknown>)[key]
  const template = directTemplate ?? resolvePath(message, key)
  if (typeof template === 'string') {
    return template
  }

  console.error(`[i18n] Function getTemplateByKey(), key param ${key} is not existed.`)
  return ''
}

/**
 * formatI18n('我是{name},身高{detail.height},体重{detail.weight}',{name:'张三',detail:{height:178,weight:'75kg'}})
 * 暂不支持数组
 * @param template 多语言模板字符串，eg: `我是{name}`
 * @param {object | undefined} data 需要传递的数据对象，里面的key与多语言字符串对应，eg: `{name:'菲鸽'}`
 * @returns
 */
function formatI18n(template: string, data?: I18nData) {
  return formatRuntimeMessage(template, data)
}

/**
 * t('introduction',{name:'张三',detail:{height:178,weight:'75kg'}})
 * => formatI18n('我是{name},身高{detail.height},体重{detail.weight}',{name:'张三',detail:{height:178,weight:'75kg'}})
 * 没有key的，可以不传 data；暂不支持数组
 * @param template 多语言模板字符串，eg: `我是{name}`
 * @param {object | undefined} data 需要传递的数据对象，里面的key与多语言字符串对应，eg: `{name:'菲鸽'}`
 * @returns
 */
export function t(key: string, data?: I18nData) {
  return formatI18n(getTemplateByKey(key), data)
}

type RuntimeTranslate = (key: string, values?: I18nData | unknown[]) => string
interface MutableI18nGlobal {
  t: RuntimeTranslate
  __composer?: { t: RuntimeTranslate }
}

function installRuntimeMessageInterpolation(): void {
  const runtimeTranslate: RuntimeTranslate = (key, values) => formatRuntimeMessage(getTemplateByKey(key), values)
  const global = i18n.global as unknown as MutableI18nGlobal
  global.t = runtimeTranslate
  if (global.__composer)
    global.__composer.t = runtimeTranslate
}

installRuntimeMessageInterpolation()
export default i18n
