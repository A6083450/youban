const REFERENCE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const DATE_PARTS_PATTERN = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

function createLocalDate(year, month, day) {
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null
  return date
}

export function normalizeReferenceTime(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return REFERENCE_TIME_PATTERN.test(normalized) ? normalized : null
}

export function parseTripDate(value) {
  if (typeof value !== 'string') return null

  const rawDate = value.trim()
  if (!rawDate) return null

  const normalized = rawDate
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-')
    .trim()

  const dateOnlyMatch = normalized.match(DATE_ONLY_PATTERN)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    return createLocalDate(Number(year), Number(month), Number(day))
  }

  const parsedDate = new Date(normalized)
  if (!Number.isNaN(parsedDate.getTime())) return parsedDate

  const matched = rawDate.match(DATE_PARTS_PATTERN)
  if (!matched) return null
  const [, year, month, day] = matched
  return createLocalDate(Number(year), Number(month), Number(day))
}

export function resolveItineraryDisplayMode(dayCount) {
  if (dayCount <= 7) return 'day'
  if (dayCount <= 30) return 'week'
  return 'month'
}

function getDayDate(day) {
  return typeof day?.date === 'string' ? day.date : null
}

function getCalendarMonthKey(day) {
  const date = parseTripDate(getDayDate(day))
  if (!date) return 'unknown'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

function createGroup(key, kind, groupIndex, items) {
  if (!items.length) return null
  const first = items[0]
  const last = items.at(-1)
  return {
    key,
    kind,
    groupIndex,
    startDayIndex: first.index,
    endDayIndex: last.index,
    startDate: getDayDate(first.day),
    endDate: getDayDate(last.day),
    items,
  }
}

function groupByCalendarMonth(items) {
  const groups = []
  let currentKey = null

  for (const item of items) {
    const monthKey = getCalendarMonthKey(item.day)
    const currentGroup = groups.at(-1)
    if (!currentGroup || monthKey !== currentKey) {
      currentKey = monthKey
      const group = createGroup(
        `month-${monthKey}-${groups.length}`,
        'month',
        groups.length,
        [item],
      )
      if (group) groups.push(group)
      continue
    }

    const group = createGroup(
      currentGroup.key,
      currentGroup.kind,
      currentGroup.groupIndex,
      [...currentGroup.items, item],
    )
    if (group) groups[groups.length - 1] = group
  }

  return groups
}

export function groupItineraryDays(days, mode) {
  const items = (Array.isArray(days) ? days : []).map((day, index) => ({ day, index }))
  if (mode === 'day') {
    const group = createGroup('day-all', 'day', 0, items)
    return group ? [group] : []
  }
  if (mode === 'week') {
    const groups = []
    for (let index = 0; index < items.length; index += 7) {
      const group = createGroup(
        `week-${index / 7}`,
        'week',
        index / 7,
        items.slice(index, index + 7),
      )
      if (group) groups.push(group)
    }
    return groups
  }

  return groupByCalendarMonth(items)
}

export function resolveTripBlueprint(plan) {
  const days = Array.isArray(plan.days) ? plan.days : []
  const expected = days.map((day) => day.day_index)
  const stages = Array.isArray(plan.blueprint?.stages) ? plan.blueprint.stages : []
  const referenced = stages.flatMap((stage) => (
    Array.isArray(stage.day_indices) ? stage.day_indices : []
  ))
  const validAiBlueprint = Boolean(
    plan.blueprint
      && stages.length > 0
      && referenced.length === expected.length
      && new Set(referenced).size === referenced.length
      && expected.every((dayIndex) => referenced.includes(dayIndex)),
  )
  if (validAiBlueprint) {
    return {
      ...plan.blueprint,
      source: 'ai',
      stages: stages.map((stage) => ({
        ...stage,
        highlights: Array.isArray(stage.highlights) ? stage.highlights.slice(0, 3) : [],
      })),
    }
  }

  const groups = []
  for (const day of days) {
    const city = day.city || plan.city || ''
    const current = groups.at(-1)
    if (!current || current.cities[0] !== city) {
      groups.push({
        title: city,
        cities: city ? [city] : [],
        day_indices: [day.day_index],
        theme: '',
        rationale: '',
        highlights: [],
        transition: '',
      })
    } else {
      current.day_indices.push(day.day_index)
    }

    const stage = groups.at(-1)
    for (const attraction of day.attractions || []) {
      if (
        attraction.name
        && !stage.highlights.includes(attraction.name)
        && stage.highlights.length < 3
      ) {
        stage.highlights.push(attraction.name)
      }
    }
  }

  return {
    source: 'legacy',
    title: '',
    summary: '',
    logic: plan.overall_suggestions || '',
    pace: '',
    stages: groups,
  }
}

export function buildDayTimeline(day) {
  const entries = []
  let sourceOrder = 0

  if (day.is_transfer_day && day.transfer_info) {
    entries.push({
      key: 'transfer',
      kind: 'transfer',
      time: normalizeReferenceTime(day.transfer_time),
      endTime: null,
      sourceOrder: sourceOrder++,
      item: day.transfer_info,
    })
  }

  for (const attraction of day.attractions || []) {
    entries.push({
      key: `attraction-${sourceOrder}-${attraction.name}`,
      kind: 'attraction',
      time: normalizeReferenceTime(attraction.start_time),
      endTime: normalizeReferenceTime(attraction.end_time),
      sourceOrder: sourceOrder++,
      item: attraction,
    })
  }

  for (const meal of day.meals || []) {
    entries.push({
      key: `meal-${sourceOrder}-${meal.type}-${meal.name}`,
      kind: 'meal',
      time: normalizeReferenceTime(meal.time),
      endTime: null,
      sourceOrder: sourceOrder++,
      item: meal,
    })
  }

  return entries.sort((left, right) => {
    if (left.time && right.time) {
      return left.time.localeCompare(right.time) || left.sourceOrder - right.sourceOrder
    }
    if (left.time) return -1
    if (right.time) return 1
    return left.sourceOrder - right.sourceOrder
  })
}
