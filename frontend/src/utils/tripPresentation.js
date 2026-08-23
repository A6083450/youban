const REFERENCE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const DATE_PARTS_PATTERN = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const OUTDOOR_KEYWORDS = [
  '公园', '山', '湖', '岛', '海滩', '沙滩', '湿地', '森林', '草原',
  '古镇', '古村', '步道', '广场', '街', '园林', '动物园', '植物园',
  'park', 'mountain', 'lake', 'island', 'beach', 'forest', 'garden',
]
const ARRIVAL_KEYWORDS = ['抵达', '到达', 'arrive', 'arrival', '到着']
const AFTERNOON_KEYWORDS = ['下午', '傍晚', 'afternoon', 'evening', '午後', '夕方']
const MEAL_ANCHORS = {
  breakfast: 8 * 60,
  lunch: (12 * 60) + 30,
  dinner: (18 * 60) + 30,
  snack: (15 * 60) + 30,
}

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

export function normalizeTripCityNames(value, fallback = '') {
  const cities = Array.isArray(value) ? value : []
  const names = cities
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim()
      if (entry && typeof entry === 'object' && typeof entry.city === 'string') {
        return entry.city.trim()
      }
      return ''
    })
    .filter(Boolean)
  if (names.length) return names
  const fallbackName = typeof fallback === 'string' ? fallback.trim() : ''
  return fallbackName ? [fallbackName] : []
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

function referenceTimeToMinutes(value) {
  const time = normalizeReferenceTime(value)
  if (!time) return null
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToReferenceTime(value) {
  const safeValue = Math.max(0, Math.min(value, (23 * 60) + 59))
  return `${String(Math.floor(safeValue / 60)).padStart(2, '0')}:${String(safeValue % 60).padStart(2, '0')}`
}

function isOutdoorAttraction(attraction) {
  const searchable = `${attraction?.name || ''} ${attraction?.category || ''} ${attraction?.description || ''}`.toLowerCase()
  return OUTDOOR_KEYWORDS.some((keyword) => searchable.includes(keyword))
}

function isAfternoonArrival(day) {
  const description = String(day?.description || '').toLowerCase()
  return ARRIVAL_KEYWORDS.some((keyword) => description.includes(keyword))
    && AFTERNOON_KEYWORDS.some((keyword) => description.includes(keyword))
}

function hasWeatherForecast(weather) {
  return Boolean(
    weather
    && (weather.day_weather || weather.night_weather || weather.day_temp || weather.night_temp)
  )
}

function isHotForecast(weather) {
  return hasWeatherForecast(weather) && Number(weather.day_temp) >= 29
}

function isWeekend(rawDate) {
  const parsed = parseTripDate(rawDate)
  return parsed ? parsed.getDay() === 0 || parsed.getDay() === 6 : false
}

function recommendedAttractionStart(day, attractionIndex, outdoor, weather, previousEnd) {
  let anchor
  if (isAfternoonArrival(day)) {
    anchor = attractionIndex === 0 ? (15 * 60) + 30 : 18 * 60
  } else if (attractionIndex === 0) {
    anchor = outdoor && (isHotForecast(weather) || isWeekend(day.date)) ? 8 * 60 : 9 * 60
  } else if (outdoor && isHotForecast(weather)) {
    anchor = 16 * 60
  } else {
    anchor = (14 * 60) + ((attractionIndex - 1) * 150)
  }
  return previousEnd === null ? anchor : Math.max(anchor, previousEnd + 30)
}

function recommendedMealTime(mealType, attractionEntries) {
  const normalizedType = String(mealType || '').toLowerCase()
  let anchor = MEAL_ANCHORS[normalizedType] ?? MEAL_ANCHORS.lunch
  const timedAttractions = attractionEntries.map((entry) => ({
    start: referenceTimeToMinutes(entry.time),
    end: referenceTimeToMinutes(entry.endTime),
  }))
  if (normalizedType === 'lunch') {
    const morningEnds = timedAttractions
      .filter(({ start, end }) => start !== null && start < 13 * 60 && end !== null)
      .map(({ end }) => end)
    if (morningEnds.length) anchor = Math.max(anchor, Math.max(...morningEnds) + 30)
  }
  if (normalizedType === 'dinner') {
    const afternoonEnds = timedAttractions
      .filter(({ start, end }) => start !== null && start >= 14 * 60 && end !== null)
      .map(({ end }) => end)
    if (afternoonEnds.length) anchor = Math.max(anchor, Math.max(...afternoonEnds) + 30)
  }
  return minutesToReferenceTime(anchor)
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

export function buildDayTimeline(day, weather = null) {
  const entries = []
  let sourceOrder = 0
  let previousAttractionEnd = null

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

  for (const [attractionIndex, attraction] of (day.attractions || []).entries()) {
    const outdoor = isOutdoorAttraction(attraction)
    const duration = Math.max(30, Number(attraction.visit_duration) || 90)
    let time = normalizeReferenceTime(attraction.start_time)
    let endTime = normalizeReferenceTime(attraction.end_time)
    let timeRecommendationBasis = attraction.time_recommendation_basis || null
    let crowdRecommendationBasis = attraction.crowd_recommendation_basis || null

    if (!time) {
      const startMinutes = recommendedAttractionStart(
        day,
        attractionIndex,
        outdoor,
        weather,
        previousAttractionEnd,
      )
      time = minutesToReferenceTime(startMinutes)
      endTime = minutesToReferenceTime(startMinutes + duration)
      timeRecommendationBasis = hasWeatherForecast(weather) ? 'weather' : 'seasonal'
      crowdRecommendationBasis = 'heuristic'
    } else if (!endTime) {
      endTime = minutesToReferenceTime(referenceTimeToMinutes(time) + duration)
    }

    previousAttractionEnd = referenceTimeToMinutes(endTime)
    entries.push({
      key: `attraction-${sourceOrder}-${attraction.name}`,
      kind: 'attraction',
      time,
      endTime,
      timeRecommendationBasis,
      crowdRecommendationBasis,
      outdoor,
      sourceOrder: sourceOrder++,
      item: attraction,
    })
  }

  const attractionEntries = entries.filter((entry) => entry.kind === 'attraction')
  for (const meal of day.meals || []) {
    const existingTime = normalizeReferenceTime(meal.time)
    entries.push({
      key: `meal-${sourceOrder}-${meal.type}-${meal.name}`,
      kind: 'meal',
      time: existingTime || recommendedMealTime(meal.type, attractionEntries),
      endTime: null,
      timeRecommendationBasis: existingTime ? meal.time_recommendation_basis || null : 'schedule',
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
