import { formatProductDate } from '../i18n/date'

const INFERRED_LABELS = {
  zh: {
    dates: '日期',
    transportation: '出行方式',
    accommodation: '住宿',
    preferences: '偏好',
    traveler_count: '同行人数',
  },
  en: {
    dates: 'Dates',
    transportation: 'Transportation',
    accommodation: 'Accommodation',
    preferences: 'Preferences',
    traveler_count: 'Travelers',
  },
  fr: {
    dates: 'Dates',
    transportation: 'Transport',
    accommodation: 'Hébergement',
    preferences: 'Préférences',
    traveler_count: 'Voyageurs',
  },
}

const clean = (value) => String(value ?? '')
  .replace(/[\r\n]+/g, ' ')
  .replace(/([\\`*_[\]<>])/g, '\\$1')
  .trim()

const positiveInteger = (value, fallback = 1) =>
  Number.isInteger(value) && value > 0 ? value : fallback

const formatBudget = (amount, locale) => {
  if (!Number.isFinite(amount) || amount < 0) return ''
  const localeTag = locale === 'en' ? 'en-US' : locale === 'fr' ? 'fr-FR' : 'zh-CN'
  return new Intl.NumberFormat(localeTag, {
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatChatDraft(draft, locale = 'zh-CN') {
  const english = String(locale).toLowerCase().startsWith('en')
  const french = String(locale).toLowerCase().startsWith('fr')
  const lang = english ? 'en' : french ? 'fr' : 'zh'
  const city = clean(draft?.city || draft?.cities?.[0]?.city)
  const days = positiveInteger(draft?.travel_days, draft?.cities?.[0]?.days || 1)
  const cities = Array.isArray(draft?.cities) && draft.cities.length
    ? draft.cities
    : [{ city, days }]
  const route = cities
    .map((item) => {
      const itemDays = positiveInteger(item.days)
      if (english) return `${clean(item.city)} ${itemDays} ${itemDays === 1 ? 'day' : 'days'}`
      if (french) return `${clean(item.city)} ${itemDays} ${itemDays === 1 ? 'jour' : 'jours'}`
      return `${clean(item.city)} ${itemDays}天`
    })
    .join(' → ')
  const travelerCount = positiveInteger(draft?.traveler_count)
  const roomCount = positiveInteger(draft?.room_count, Math.ceil(travelerCount / 2))
  const preferences = Array.isArray(draft?.preferences)
    ? draft.preferences.map(clean).filter(Boolean).join(english || french ? ', ' : '、')
    : ''
  const inferred = Array.isArray(draft?.inferred_fields)
    ? draft.inferred_fields.map((field) => INFERRED_LABELS[lang][field]).filter(Boolean)
    : []
  const budget = formatBudget(draft?.budget_amount, lang)

  if (english) {
    const lines = [
      `### ${city} · ${days} ${days === 1 ? 'day' : 'days'}`,
      '',
      'Here is the route draft based on what we discussed:',
      '',
      `- **Route**: ${route}`,
      `- **Dates**: ${clean(draft?.start_date)} to ${clean(draft?.end_date)}`,
      `- **Transport**: ${clean(draft?.transportation)}`,
      `- **Stay**: ${clean(draft?.accommodation)}`,
      `- **Travelers**: ${travelerCount} ${travelerCount === 1 ? 'traveler' : 'travelers'} · ${roomCount} ${roomCount === 1 ? 'room' : 'rooms'}`,
    ]
    if (budget) lines.push(`- **Budget**: ¥${budget} (${draft?.budget_basis === 'per_person' ? 'per person' : 'total'})`)
    if (preferences) lines.push(`- **Preferences**: ${preferences}`)
    if (inferred.length) lines.push('', `Suggested defaults: ${inferred.join(', ')}`)
    return lines.join('\n')
  }

  if (french) {
    const startDate = formatProductDate(draft?.start_date, 'fr-FR')
    const endDate = formatProductDate(draft?.end_date, 'fr-FR')
    const lines = [
      `### ${city} · ${days} ${days === 1 ? 'jour' : 'jours'}`,
      '',
      'Voici une première proposition basée sur notre échange :',
      '',
      `- **Itinéraire** : ${route}`,
      `- **Dates** : du ${startDate} au ${endDate}`,
      `- **Transport** : ${clean(draft?.transportation)}`,
      `- **Hébergement** : ${clean(draft?.accommodation)}`,
      `- **Voyageurs** : ${travelerCount} ${travelerCount === 1 ? 'voyageur' : 'voyageurs'} · ${roomCount} ${roomCount === 1 ? 'chambre' : 'chambres'}`,
    ]
    if (budget) lines.push(`- **Budget** : ¥${budget} (${draft?.budget_basis === 'per_person' ? 'par personne' : 'au total'})`)
    if (preferences) lines.push(`- **Préférences** : ${preferences}`)
    if (inferred.length) lines.push('', `Valeurs suggérées : ${inferred.join(', ')}`)
    return lines.join('\n')
  }

  const lines = [
    `### ${city} · ${days}天`,
    '',
    '我先按我们聊到的信息整理一份路线初稿：',
    '',
    `- **路线**：${route}`,
    `- **日期**：${clean(draft?.start_date)} 至 ${clean(draft?.end_date)}`,
    `- **出行**：${clean(draft?.transportation)}`,
    `- **住宿**：${clean(draft?.accommodation)}`,
    `- **同行**：${travelerCount}人 · ${roomCount}间房`,
  ]
  if (budget) lines.push(`- **预算**：¥${budget}（${draft?.budget_basis === 'per_person' ? '人均预算' : '总预算'}）`)
  if (preferences) lines.push(`- **偏好**：${preferences}`)
  if (inferred.length) lines.push('', `以下项目采用了建议值：${inferred.join('、')}`)
  return lines.join('\n')
}

export function shouldShowDraftActions(readyToGenerate, readinessToken) {
  return readyToGenerate === true && typeof readinessToken === 'string' && readinessToken.length > 0
}

export function migrateLegacyDraftItems(items, locale = 'zh-CN') {
  return items.map((item) => {
    if (item?.type !== 'confirm' || !item.draft) return item
    return {
      ...item,
      type: 'draft',
      text: formatChatDraft(item.draft, locale),
      ready: false,
    }
  })
}
