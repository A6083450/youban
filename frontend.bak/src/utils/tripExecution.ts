// 今日行程执行:时间线构建/进度统计纯函数(与组件解耦,便于维护)
import type { DayPlan, ExecutionMap, ItemExecutionStatus, TripPlan } from '@/types'

export interface TodayTimelineItem {
  kind: 'attraction' | 'meal'
  /** 后端注入的稳定 id;旧缓存数据可能缺失,缺失时操作不可用 */
  id: string
  name: string
  /** "09:00 – 11:00" / "12:30" / '' */
  timeLabel: string
  /** 排序键:起始分钟;无时间的项排在有时间项之后并保持原序 */
  sortKey: number
  /** 完成弹层预填金额:门票价/餐饮预估 */
  costHint?: number
  category?: string
  description?: string
  status: ItemExecutionStatus
}

const parseMinutes = (value?: string | null): number | null => {
  if (!value) return null
  const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  if (!matched) return null
  return Number(matched[1]) * 60 + Number(matched[2])
}

/** 在计划中定位"今天"对应的数组下标;不在行程期内返回 -1 */
export const findTodayArrayIndex = (plan: TripPlan, todayStr: string): number =>
  plan.days.findIndex((day) => day.date === todayStr)

export const buildTodayTimeline = (day: DayPlan, execution: ExecutionMap): TodayTimelineItem[] => {
  const NO_TIME_BASE = 24 * 60
  const items: TodayTimelineItem[] = []

  day.attractions.forEach((attraction, index) => {
    const start = parseMinutes(attraction.start_time)
    const end = parseMinutes(attraction.end_time)
    items.push({
      kind: 'attraction',
      id: attraction.id || '',
      name: attraction.name,
      timeLabel:
        start !== null && end !== null
          ? `${attraction.start_time} – ${attraction.end_time}`
          : attraction.start_time || '',
      sortKey: start ?? NO_TIME_BASE + index,
      costHint: attraction.ticket_price || undefined,
      category: attraction.category,
      description: attraction.description,
      status: (attraction.id && execution[attraction.id]?.status) || 'pending',
    })
  })

  day.meals.forEach((meal, index) => {
    const start = parseMinutes(meal.time)
    items.push({
      kind: 'meal',
      id: meal.id || '',
      name: meal.name,
      timeLabel: meal.time || '',
      sortKey: start ?? NO_TIME_BASE + day.attractions.length + index,
      costHint: meal.estimated_cost || undefined,
      category: meal.type,
      description: meal.description,
      status: (meal.id && execution[meal.id]?.status) || 'pending',
    })
  })

  return items.sort((a, b) => a.sortKey - b.sortKey)
}

export const todayProgress = (items: TodayTimelineItem[]): { done: number; total: number } => ({
  done: items.filter((item) => item.status === 'done').length,
  total: items.length,
})
