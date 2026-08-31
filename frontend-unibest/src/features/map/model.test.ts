import { describe, expect, it } from 'vitest'
import { buildArcPath, buildMapProjection, detectRouteMode, getMapDayColor } from './model'
import type { TripPlan } from '@/features/result/model'

const plan: TripPlan = {
  city: '杭州',
  start_date: '2026-08-01',
  end_date: '2026-08-02',
  overall_suggestions: '',
  weather_info: [],
  days: [
    {
      date: '2026-08-01',
      day_index: 0,
      description: '',
      transportation: '步行',
      accommodation: '',
      hotel: { name: '湖边酒店', location: { longitude: 120.1, latitude: 30.2 } },
      attractions: [
        { name: '西湖', location: { longitude: 120.11, latitude: 30.21 } },
        { name: '无坐标景点' },
      ],
      meals: [],
    },
    {
      date: '2026-08-02',
      day_index: 1,
      description: '',
      transportation: '出租车',
      accommodation: '',
      attractions: [
        { name: '灵隐寺', location: { longitude: 120.12, latitude: 30.22 } },
      ],
      meals: [],
    },
  ],
}

describe('map projection', () => {
  it('keeps stable per-day numbering and filters attractions and hotels together', () => {
    expect(buildMapProjection(plan, null)).toMatchObject({
      attractions: [
        { name: '西湖', dayIndex: 0, attractionIndex: 0, stopNumber: 1 },
        { name: '灵隐寺', dayIndex: 1, attractionIndex: 0, stopNumber: 1 },
      ],
      hotels: [{ name: '湖边酒店', dayIndex: 0 }],
    })
    expect(buildMapProjection(plan, 1)).toMatchObject({
      attractions: [{ name: '灵隐寺', dayIndex: 1, stopNumber: 1 }],
      hotels: [],
    })
  })

  it('uses the same repeatable day palette as the legacy map', () => {
    expect(getMapDayColor(1)).toBe('#D97757')
    expect(getMapDayColor(9)).toBe('#D97757')
  })
})

describe('map route fallback', () => {
  it('detects walking while all other transport defaults to driving', () => {
    expect(detectRouteMode('步行 + 地铁')).toBe('walking')
    expect(detectRouteMode('walking')).toBe('walking')
    expect(detectRouteMode('自驾')).toBe('driving')
  })

  it('builds an arc that preserves both endpoints', () => {
    const path = buildArcPath([120, 30], [121, 31], 4)
    expect(path).toHaveLength(5)
    expect(path[0]).toEqual([120, 30])
    expect(path.at(-1)).toEqual([121, 31])
  })
})
