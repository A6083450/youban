import type { Meal, TripPlan } from '@/types'
import { normalizeReferenceTime, parseTripDate } from './tripPresentation.js'

/** RFC 5545 要求 CRLF 换行，且单行内容超 75 字节需折行 */
const CRLF = '\r\n'
const MAX_LINE_OCTETS = 75

/** 无 start_time 的景点按此时长排布，与 visit_duration 缺省值一致 */
const DEFAULT_DURATION_MINUTES = 90

const MEAL_DEFAULT_TIME: Record<Meal['type'], string> = {
  breakfast: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  snack: '15:00',
}

/** 转义 TEXT 类型值：反斜杠、分号、逗号、换行 */
const escapeText = (value: unknown): string =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')

/**
 * 按 UTF-8 字节折行，避免把多字节字符（中文）截断成乱码。
 * 续行以单个空格开头。
 */
const foldLine = (line: string): string => {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line

  const segments: string[] = []
  let current = ''
  let currentOctets = 0
  // 首行限 75 字节，续行因前导空格实际可用 74 字节
  let limit = MAX_LINE_OCTETS

  for (const char of line) {
    const charOctets = encoder.encode(char).length
    if (currentOctets + charOctets > limit) {
      segments.push(current)
      current = char
      currentOctets = charOctets
      limit = MAX_LINE_OCTETS - 1
      continue
    }
    current += char
    currentOctets += charOctets
  }
  if (current) segments.push(current)

  return segments.join(`${CRLF} `)
}

/** 本地时间格式，配合 TZID 参数使用，避免时区换算把行程挪日期 */
const formatLocalDateTime = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `T${pad(date.getHours())}${pad(date.getMinutes())}00`
  )
}

const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000)

const applyTime = (baseDate: Date, time: string): Date => {
  const [hours, minutes] = time.split(':').map(Number)
  const result = new Date(baseDate)
  result.setHours(hours, minutes, 0, 0)
  return result
}

interface CalendarEvent {
  uid: string
  start: Date
  end: Date
  summary: string
  location?: string
  description?: string
}

/**
 * 抽取一天里的日程事件。景点按 start_time 排布，缺省则从上一项结束时间顺延；
 * 餐饮用 meal.time，缺省落到该餐别的常规时间。
 */
const collectDayEvents = (plan: TripPlan, dayIndex: number): CalendarEvent[] => {
  const day = plan.days[dayIndex]
  const baseDate = parseTripDate(day?.date)
  if (!baseDate) return []

  const events: CalendarEvent[] = []
  // 无明确时间的景点从 09:00 起顺延排布
  let cursor = applyTime(baseDate, '09:00')

  for (const [index, attraction] of (day.attractions || []).entries()) {
    const startTime = normalizeReferenceTime(attraction.start_time)
    const start = startTime ? applyTime(baseDate, startTime) : cursor
    const endTime = normalizeReferenceTime(attraction.end_time)
    const duration = attraction.visit_duration || DEFAULT_DURATION_MINUTES
    const end = endTime ? applyTime(baseDate, endTime) : addMinutes(start, duration)

    events.push({
      uid: `d${dayIndex + 1}-a${index + 1}`,
      start,
      end,
      summary: attraction.name,
      location: attraction.address,
      description: attraction.description,
    })
    cursor = addMinutes(end, 30)
  }

  for (const [index, meal] of (day.meals || []).entries()) {
    const time = normalizeReferenceTime(meal.time) || MEAL_DEFAULT_TIME[meal.type]
    if (!time) continue
    const start = applyTime(baseDate, time)
    events.push({
      uid: `d${dayIndex + 1}-m${index + 1}`,
      start,
      end: addMinutes(start, 60),
      summary: meal.name,
      location: meal.address,
      description: meal.description,
    })
  }

  return events.sort((left, right) => left.start.getTime() - right.start.getTime())
}

/**
 * 生成 iCalendar 文本。时区固定 Asia/Shanghai —— 行程与 POI 均为国内数据源。
 * ponytail: 单时区，出境游支持时按 plan 城市推导 TZID
 */
export const buildTripCalendar = (
  plan: TripPlan,
  options: { alarmMinutesBefore?: number } = {},
): string => {
  const { alarmMinutesBefore = 30 } = options
  const days = Array.isArray(plan?.days) ? plan.days : []
  const events = days.flatMap((_, index) => collectDayEvents(plan, index))

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Youban//Trip Planner//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${plan?.city ?? ''} ${plan?.start_date ?? ''}`.trim())}`,
    'X-WR-TIMEZONE:Asia/Shanghai',
  ]

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}-${plan.start_date}@youban`,
      // DTSTAMP 用行程开始日而非当前时间，保证同一行程重复导出内容稳定
      `DTSTAMP:${formatLocalDateTime(event.start)}Z`,
      `DTSTART;TZID=Asia/Shanghai:${formatLocalDateTime(event.start)}`,
      `DTEND;TZID=Asia/Shanghai:${formatLocalDateTime(event.end)}`,
      `SUMMARY:${escapeText(event.summary)}`,
    )
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
    if (alarmMinutesBefore > 0) {
      lines.push(
        'BEGIN:VALARM',
        `TRIGGER:-PT${alarmMinutesBefore}M`,
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(event.summary)}`,
        'END:VALARM',
      )
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  return lines.map(foldLine).join(CRLF) + CRLF
}

export const countCalendarEvents = (plan: TripPlan): number => {
  const days = Array.isArray(plan?.days) ? plan.days : []
  return days.reduce((total, _, index) => total + collectDayEvents(plan, index).length, 0)
}

