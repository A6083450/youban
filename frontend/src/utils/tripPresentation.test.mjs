import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDayTimeline,
  groupItineraryDays,
  normalizeReferenceTime,
  resolveItineraryDisplayMode,
  resolveTripBlueprint,
} from './tripPresentation.js'

process.env.TZ = 'UTC'

const days = [
  { day_index: 0, city: '上海', attractions: [{ name: '外滩' }], meals: [] },
  { day_index: 1, city: '上海', attractions: [{ name: '豫园' }], meals: [] },
  { day_index: 2, city: '杭州', attractions: [{ name: '西湖' }], meals: [] },
]

test('accepts only normalized HH:MM reference times', () => {
  assert.equal(normalizeReferenceTime(' 09:30 '), '09:30')
  assert.equal(normalizeReferenceTime('25:00'), null)
  assert.equal(normalizeReferenceTime('上午九点'), null)
})

test('uses a valid AI blueprint', () => {
  const blueprint = {
    title: '江南慢游', summary: '', logic: '', pace: '',
    stages: [
      { title: '上海', cities: ['上海'], day_indices: [0, 1], highlights: [] },
      { title: '杭州', cities: ['杭州'], day_indices: [2], highlights: [] },
    ],
  }
  const result = resolveTripBlueprint({ city: '上海', days, blueprint })
  assert.equal(result.source, 'ai')
  assert.equal(result.title, '江南慢游')
})

test('limits AI blueprint highlights to three', () => {
  const blueprint = {
    stages: [
      { day_indices: [0, 1, 2], highlights: ['外滩', '豫园', '西湖', '断桥'] },
    ],
  }
  const result = resolveTripBlueprint({ city: '上海', days, blueprint })
  assert.deepEqual(result.stages[0].highlights, ['外滩', '豫园', '西湖'])
})

test('falls back to contiguous city stages when blueprint coverage is invalid', () => {
  const result = resolveTripBlueprint({
    city: '上海', days, overall_suggestions: '路线顺行',
    blueprint: { stages: [{ day_indices: [0, 0] }] },
  })
  assert.equal(result.source, 'legacy')
  assert.deepEqual(result.stages.map((stage) => stage.day_indices), [[0, 1], [2]])
  assert.equal(result.stages[0].rationale, '')
})

test('keeps a legacy single-city trip in one conservative stage', () => {
  const result = resolveTripBlueprint({ city: '上海', days: days.slice(0, 2) })
  assert.equal(result.stages.length, 1)
  assert.deepEqual(result.stages[0].day_indices, [0, 1])
})

test('sorts transfer, attractions, and meals by valid time then source order', () => {
  const timeline = buildDayTimeline({
    is_transfer_day: true,
    transfer_info: '高铁约 1 小时',
    transfer_time: '08:30',
    attractions: [
      { name: '西湖', start_time: '14:00' },
      { name: '断桥', start_time: 'invalid' },
    ],
    meals: [{ type: 'lunch', name: '杭帮菜', time: '12:00' }],
  })
  assert.deepEqual(timeline.map((item) => item.time), ['08:30', '12:00', '14:00', null])
  assert.deepEqual(timeline.map((item) => item.kind), ['transfer', 'meal', 'attraction', 'attraction'])
})

test('chooses a display mode from trip length boundaries', () => {
  assert.equal(resolveItineraryDisplayMode(1), 'day')
  assert.equal(resolveItineraryDisplayMode(7), 'day')
  assert.equal(resolveItineraryDisplayMode(8), 'week')
  assert.equal(resolveItineraryDisplayMode(30), 'week')
  assert.equal(resolveItineraryDisplayMode(31), 'month')
})

const makeDatedDays = (count, start = '2026-08-01') => {
  const startDate = new Date(`${start}T00:00:00`)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    return {
      day_index: index,
      date: date.toISOString().slice(0, 10),
      city: index < 17 ? '大理' : '丽江',
      attractions: [],
      meals: [],
    }
  })
}

test('groups week mode into consecutive seven-day ranges', () => {
  const groups = groupItineraryDays(makeDatedDays(10), 'week')
  assert.deepEqual(groups.map(({ startDayIndex, endDayIndex }) => (
    [startDayIndex, endDayIndex]
  )), [[0, 6], [7, 9]])
  assert.deepEqual([groups[0].startDate, groups[0].endDate], ['2026-08-01', '2026-08-07'])
})

test('groups month mode by natural calendar month without week nesting', () => {
  const groups = groupItineraryDays(makeDatedDays(35, '2026-08-15'), 'month')
  assert.deepEqual(groups.map(({ startDayIndex, endDayIndex }) => (
    [startDayIndex, endDayIndex]
  )), [[0, 16], [17, 34]])
})

test('keeps repeated unknown month groups uniquely keyed', () => {
  const groups = groupItineraryDays([
    { day_index: 0, date: '日期待定' },
    { day_index: 1, date: '2026-08-01' },
    { day_index: 2, date: '日期待定' },
  ], 'month')
  assert.equal(new Set(groups.map((group) => group.key)).size, groups.length)
})
