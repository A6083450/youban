import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import type { TripDay, TripPlan } from '@/features/result/model'

vi.mock('vue-i18n', async importOriginal => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({
    locale: { value: '_' },
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'result.graph.journeyTitle')
        return `${values?.days}天 ${values?.cities}`
      if (key === 'result.dateRange')
        return `${values?.start} - ${values?.end}`
      return key
    },
  }),
}))

vi.mock('@/http/client', () => ({
  getApiBaseUrl: () => '',
}))

let TripResult: Component

beforeAll(async () => {
  TripResult = (await import('./TripResult.vue')).default
})

function planWithoutFlatMap(): TripPlan {
  const days: TripDay[] = [{
    date: '2026-09-03',
    day_index: 0,
    city: '厦门',
    description: '鼓浪屿漫步',
    transportation: '步行',
    accommodation: '中山路附近',
    attractions: [{ name: '鼓浪屿', description: '沿海步行与老建筑' }],
    meals: [{ name: '沙茶面' }],
  }]
  Object.defineProperty(days, 'flatMap', { value: undefined })
  return {
    city: '厦门',
    start_date: '2026-09-03',
    end_date: '2026-09-08',
    days,
    weather_info: [],
    overall_suggestions: '穿舒适的鞋。',
  }
}

function mountResult(stubs: Record<string, unknown> = {}) {
  const query = {
    in: () => query,
    select: () => query,
    boundingClientRect: () => query,
    exec: (callback: (results: Array<{ width: number }>) => void) => callback([{ width: 342 }, { width: 342 }]),
  }
  Object.assign(uni, {
    createSelectorQuery: () => query,
    getWindowInfo: () => ({ windowWidth: 390 }),
    offWindowResize: vi.fn(),
    onWindowResize: vi.fn(),
  })
  return mount(TripResult, {
    props: { plan: planWithoutFlatMap() },
    global: {
      stubs: {
        'BudgetLedger': true,
        'DailyItinerary': true,
        'TripMap': true,
        'TripToday': true,
        'WeatherDayCard': true,
        'scroll-view': { template: '<div><slot /></div>' },
        'wd-icon': true,
        ...stubs,
      },
    },
  })
}

describe('trip result mini-program runtime compatibility', () => {
  it('renders the completed overview without flatMap or a working Intl locale', async () => {
    const wrapper = mountResult()
    await flushPromises()

    expect(wrapper.get('.journey-title').text()).toBe('1天 厦门')
    expect(wrapper.get('.overview-attraction-name').text()).toBe('鼓浪屿')
    expect(wrapper.get('.overview-meta').text()).toContain('2026.09.03')

    wrapper.unmount()
  })

  it('keeps inactive result sections mounted so their local state survives tab switches', () => {
    const mounted = vi.fn()
    const inactiveStub = (name: string) => ({
      setup() {
        mounted(name)
        return () => null
      },
    })
    const wrapper = mountResult({
      BudgetLedger: inactiveStub('budget'),
      DailyItinerary: inactiveStub('days'),
      TripMap: inactiveStub('map'),
      TripToday: inactiveStub('today'),
      WeatherDayCard: inactiveStub('weather'),
    })

    expect(mounted.mock.calls).toEqual([['today'], ['days'], ['map']])
    wrapper.unmount()
  })
})
