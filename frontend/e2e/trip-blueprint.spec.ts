import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { TripPlan } from '../src/types'

const planId = 'blueprint-plan'
const user = {
  user_id: 'blueprint-user',
  nickname: 'Blueprint QA',
  avatar_url: '/api/avatars/blueprint.jpg',
  profile_complete: true,
} as const
const tinyImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
const attractionImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#dceae6"/>
    <circle cx="500" cy="86" r="40" fill="#f4c56f"/>
    <path d="M0 215L130 112L228 190L330 82L472 216Z" fill="#799b86"/>
    <path d="M210 216L380 132L520 218L640 150V360H210Z" fill="#507d70"/>
    <rect y="216" width="640" height="144" fill="#76a9ad"/>
    <path d="M0 270C110 238 208 300 316 266C426 232 526 284 640 252V360H0Z" fill="#5f949d"/>
  </svg>
`)}`

type PlanApiMocks = {
  budgetResponse?: unknown
  attractionDeleteResponse?: unknown
  onChatEditRequest?: (body: Record<string, unknown>) => void
  onPhotoRequest?: (name: string, city: string) => void
}

const tripPlanWithBlueprint = {
  city: '上海',
  cities: ['上海', '杭州'],
  start_date: '2026-08-01',
  end_date: '2026-08-03',
  days: [
    {
      date: '2026-08-01',
      day_index: 0,
      city: '上海',
      description: '城市文化序章',
      transportation: '地铁与步行',
      accommodation: '市中心住宿',
      hotel: {
        name: '测试酒店', address: '上海测试路 1 号', price_range: '¥500-700',
        rating: '4.8', distance: '1km', type: '舒适型',
      },
      attractions: [
        {
          name: '外滩', address: '中山东一路',
          location: { longitude: 121.49, latitude: 31.24 },
          visit_duration: 120, description: '城市建筑群',
          start_time: '09:00', end_time: '11:00',
        },
      ],
      meals: [{ type: 'lunch', name: '测试餐厅', time: '12:00' }],
    },
    {
      date: '2026-08-02',
      day_index: 1,
      city: '杭州',
      is_transfer_day: true,
      transfer_info: '建议乘坐高铁，约 1 小时',
      transfer_time: '08:30',
      description: '抵达杭州后湖滨慢游',
      transportation: '高铁与步行',
      accommodation: '湖滨住宿',
      attractions: [
        {
          name: '西湖', address: '西湖区',
          location: { longitude: 120.14, latitude: 30.25 },
          visit_duration: 180, description: '湖滨景观',
          start_time: '14:00', end_time: '17:00',
        },
      ],
      meals: [{ type: 'lunch', name: '杭帮菜', time: '12:00', estimated_cost: 80 }],
    },
    {
      date: '2026-08-03',
      day_index: 2,
      city: '杭州',
      description: '湖滨收尾',
      transportation: '步行',
      accommodation: '湖滨住宿',
      attractions: [
        {
          name: '断桥', address: '北山街',
          location: { longitude: 120.15, latitude: 30.26 },
          visit_duration: 60, description: '清晨散步',
        },
        {
          name: '曲院风荷', address: '北山路',
          location: { longitude: 120.13, latitude: 30.25 },
          visit_duration: 90, description: '园林景观',
        },
      ],
      meals: [],
    },
  ],
  weather_info: [],
  overall_suggestions: '先城市探索，再以湖滨慢游收尾。',
  blueprint: {
    title: '江南慢游',
    summary: '从上海城市文化进入杭州湖滨慢游。',
    logic: '上午错峰，跨城后放慢节奏。',
    pace: '城市序章 → 湖滨体验 → 从容收尾',
    stages: [
      {
        title: '城市序章', cities: ['上海', '杭州'], day_indices: [0, 1],
        theme: '城市文化', rationale: '先适应城市节奏。',
        highlights: ['外滩', '西湖'], transition: '转入湖滨慢游。',
      },
      {
        title: '湖滨收尾', cities: ['杭州'], day_indices: [2],
        theme: '自然慢游', rationale: '用舒缓体验收尾。',
        highlights: ['断桥', '曲院风荷'], transition: '',
      },
    ],
  },
} satisfies TripPlan

const legacyTripPlan: TripPlan = {
  ...tripPlanWithBlueprint,
  days: [tripPlanWithBlueprint.days[2]],
  city: '杭州',
  cities: ['杭州'],
  start_date: '2026-08-03',
  end_date: '2026-08-03',
  blueprint: undefined,
}

const makeLongTripPlan = (dayCount: number, startDate: string): TripPlan => {
  const start = new Date(`${startDate}T12:00:00Z`)
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    const sourceDay = tripPlanWithBlueprint.days[index % tripPlanWithBlueprint.days.length]
    return {
      ...sourceDay,
      day_index: index,
      date: date.toISOString().slice(0, 10),
      city: index < 17 ? '大理' : '丽江',
      description: `第 ${index + 1} 天完整安排`,
      attractions: sourceDay.attractions.map((attraction) => ({
        ...attraction,
        name: `${attraction.name}-${index + 1}`,
      })),
    }
  })

  return {
    ...tripPlanWithBlueprint,
    city: '大理',
    cities: ['大理', '丽江'],
    start_date: days[0]?.date || startDate,
    end_date: days.at(-1)?.date || startDate,
    days,
    blueprint: undefined,
  }
}

const mockCommonApi = async (page: Page, mocks: PlanApiMocks = {}): Promise<void> => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (
      path === `/api/trip/plan/${planId}/budget-items`
      && route.request().method() === 'GET'
      && mocks.budgetResponse
    ) {
      await route.fulfill({ json: mocks.budgetResponse })
      return
    }
    if (
      path.startsWith(`/api/trip/plan/${planId}/attractions/`)
      && route.request().method() === 'DELETE'
      && mocks.attractionDeleteResponse
    ) {
      await route.fulfill({ json: mocks.attractionDeleteResponse })
      return
    }
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { success: true, user } })
      return
    }
    if (path === '/api/trip/history') {
      await route.fulfill({ json: { items: [] } })
      return
    }
    if (path === '/api/chat/edit' && route.request().method() === 'POST') {
      mocks.onChatEditRequest?.(route.request().postDataJSON() as Record<string, unknown>)
      await route.fulfill({
        json: {
          success: true,
          reply: '已记录请求。',
          updated_plan: null,
          changes: [],
          revision: 'mock-revision',
        },
      })
      return
    }
    if (path.endsWith('/conversation')) {
      await route.fulfill({ json: { plan_id: planId, messages: [] } })
      return
    }
    if (path === '/api/poi/photo') {
      const url = new URL(route.request().url())
      mocks.onPhotoRequest?.(url.searchParams.get('name') || '', url.searchParams.get('city') || '')
      await route.fulfill({ json: { success: true, data: { photo_url: attractionImage } } })
      return
    }
    await route.fulfill({ json: {} })
  })
}

const preparePlanPage = async (
  page: Page,
  plan: TripPlan = tripPlanWithBlueprint,
  locale = 'zh-CN',
  mocks: PlanApiMocks = {},
  skin: 'default' | 'google' = 'default',
): Promise<void> => {
  await page.addInitScript(
    ({ storedUser, storedPlanId, storedPlan, storedLocale, storedSkin }) => {
      localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
      localStorage.setItem('tripstar-locale', storedLocale)
      localStorage.setItem('tripstar.skin', storedSkin)
      sessionStorage.setItem('planId', storedPlanId)
      sessionStorage.setItem('tripPlan', JSON.stringify(storedPlan))
    },
    { storedUser: user, storedPlanId: planId, storedPlan: plan, storedLocale: locale, storedSkin: skin },
  )
  await mockCommonApi(page, mocks)
  await page.goto(`/plan/${planId}`)
  await expect(page.locator('.top-switch-menu')).toBeVisible()
}

test('applies the clear skin palette throughout the plan overview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await preparePlanPage(page, tripPlanWithBlueprint, 'zh-CN', {}, 'google')
  await page.getByRole('menuitem', { name: '行程总览' }).click()

  const overviewTab = page.getByRole('menuitem', { name: '行程总览' })
  const todayTab = page.getByRole('menuitem', { name: '今日行程' })
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'google')
  await expect(page.locator('.result-container')).toHaveCSS('background-color', 'rgb(245, 249, 252)')
  await expect(page.locator('.content-wrapper')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.82)')
  await expect(page.locator('.journey__hero')).toHaveCSS('background-color', 'rgb(239, 248, 250)')
  await expect(overviewTab).toHaveCSS('color', 'rgb(38, 122, 147)')
  await expect(overviewTab).toHaveCSS('background-color', 'rgba(59, 155, 180, 0.14)')
  await expect(overviewTab).toHaveCSS('border-color', 'rgba(59, 155, 180, 0.24)')
  await expect(todayTab).toHaveCSS('border-color', 'rgb(213, 228, 234)')
})

const mockSharedPlan = async (page: Page, plan: TripPlan): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem('tripstar-locale', 'zh-CN')
  })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/trip/share/blueprint') {
      await route.fulfill({
        json: {
          plan_id: 'blueprint',
          status: 'completed',
          result: { success: true, message: 'ok', plan_id: 'blueprint', data: plan },
        },
      })
      return
    }
    if (path === '/api/poi/photo') {
      await route.fulfill({ json: { success: true, data: { photo_url: attractionImage } } })
      return
    }
    await route.fulfill({ json: {} })
  })
}

test('merges journey context into the trip overview without a separate navigation item', async ({ page }) => {
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await expect(page.getByRole('menuitem', { name: '行程脉络图' })).toHaveCount(0)
  const blueprint = page.locator('.overview-card')
  await expect(blueprint.getByRole('heading', { name: '江南慢游' })).toBeVisible()
  await expect(blueprint.getByText('从上海城市文化进入杭州湖滨慢游。')).toBeVisible()
  await expect(blueprint.getByText('城市文化', { exact: true })).toBeVisible()
  await expect(blueprint.getByRole('button', { name: /D1 上海.*外滩/ })).toBeVisible()
  await expect(blueprint.getByText('测试酒店')).toHaveCount(0)
  await expect(blueprint.getByText('测试餐厅')).toHaveCount(0)
})

test('binds result-page agent requests to the persisted plan id', async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined
  await preparePlanPage(page, tripPlanWithBlueprint, 'zh-CN', {
    onChatEditRequest: (body) => { requestBody = body },
  })

  const editor = page.locator('.agent-sender [contenteditable]').first()
  await editor.fill('把第一天安排得轻松一点')
  await page.getByRole('button', { name: '发送' }).last().click()

  await expect.poll(() => requestBody?.plan_id).toBe(planId)
  expect(requestBody?.message).toBe('把第一天安排得轻松一点')
})

test('uses distinct overview and detailed itinerary labels in French', async ({ page }) => {
  await preparePlanPage(page, tripPlanWithBlueprint, 'fr-FR')

  await expect(page.getByRole('menuitem', { name: 'Aperçu du voyage' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Itinéraire détaillé' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: "Aperçu de l'itinéraire" })).toHaveCount(0)
})

test('keeps the journey and inspiration browsers stationary, independent, and item-aligned', async ({ page }) => {
  await preparePlanPage(page, makeLongTripPlan(10, '2026-08-01'))
  await page.getByRole('menuitem', { name: '行程总览' }).click()

  const track = page.locator('.journey__track')
  const cards = page.locator('.journey__cards')
  await track.evaluate((element) => { element.scrollLeft = 0 })
  await cards.evaluate((element) => { element.scrollLeft = 0 })
  await page.mouse.move(5, 5)
  await page.waitForTimeout(4_300)
  expect(await track.evaluate((element) => element.scrollLeft)).toBe(0)
  expect(await cards.evaluate((element) => element.scrollLeft)).toBe(0)

  const touchSession = await page.context().newCDPSession(page)
  await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  const trackBox = await track.boundingBox()
  expect(trackBox).not.toBeNull()
  const touchY = trackBox!.y + Math.min(trackBox!.height / 2, 80)
  const touchStartX = trackBox!.x + Math.min(trackBox!.width - 40, 640)
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: touchStartX, y: touchY }],
  })
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: touchStartX - 220, y: touchY }],
  })
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20)
  await page.waitForTimeout(600)
  const touchAligned = await track.evaluate((viewport) => {
    const viewportLeft = viewport.getBoundingClientRect().left
    return [...viewport.querySelectorAll<HTMLElement>('.journey__stop')]
      .some((item) => Math.abs(item.getBoundingClientRect().left - viewportLeft) <= 2)
  })
  expect(touchAligned).toBe(true)
  expect(await cards.evaluate((element) => element.scrollLeft)).toBe(0)
  await track.evaluate((element) => { element.scrollLeft = 0 })
  await page.waitForTimeout(100)

  await page.getByRole('button', { name: '下一段行程' }).click()
  await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20)
  await page.waitForTimeout(600)
  expect(await cards.evaluate((element) => element.scrollLeft)).toBe(0)
  const trackAfterJourneyStep = await track.evaluate((element) => element.scrollLeft)

  await page.getByRole('button', { name: '下一组灵感' }).click()
  await expect.poll(() => cards.evaluate((element) => element.scrollLeft)).toBeGreaterThan(20)
  await page.waitForTimeout(600)
  expect(await track.evaluate((element) => element.scrollLeft)).toBe(trackAfterJourneyStep)

  for (const rail of [
    { viewport: track, items: '.journey__stop' },
    { viewport: cards, items: '.journey__card' },
  ]) {
    const aligned = await rail.viewport.evaluate((viewport, itemSelector) => {
      const viewportLeft = viewport.getBoundingClientRect().left
      return [...viewport.querySelectorAll<HTMLElement>(itemSelector)]
        .some((item) => Math.abs(item.getBoundingClientRect().left - viewportLeft) <= 2)
    }, rail.items)
    expect(aligned).toBe(true)
  }

  await expect(page.locator('.journey__pager-status')).toHaveCount(2)
})

test('loads city photos for journey days that have no attractions', async ({ page }) => {
  const requestedPhotos: Array<[string, string]> = []
  const cityOnlyPlan: TripPlan = {
    ...makeLongTripPlan(3, '2026-08-01'),
    city: '喀纳斯',
    cities: ['喀纳斯', '赛里木湖'],
    days: makeLongTripPlan(3, '2026-08-01').days.map((day, index) => ({
      ...day,
      city: index < 2 ? '喀纳斯' : '赛里木湖',
      attractions: [],
    })),
  }

  await preparePlanPage(page, cityOnlyPlan, 'zh-CN', {
    onPhotoRequest: (name, city) => requestedPhotos.push([name, city]),
  })
  await page.getByRole('menuitem', { name: '行程总览' }).click()

  await expect.poll(() => requestedPhotos).toContainEqual(['喀纳斯', '喀纳斯'])
  await expect.poll(() => requestedPhotos).toContainEqual(['赛里木湖', '赛里木湖'])
  await expect(page.locator('.journey__stop:not(.journey__stop--end) .journey__pin img')).toHaveCount(3)
})

test('stops overview image effects after the finite entrance transition', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0
  })
  await preparePlanPage(page, tripPlanWithBlueprint)
  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await expect(page.locator('.card-img img').first()).toBeVisible()
  await page.waitForTimeout(1_200)

  const readImageEffects = () => page.locator('.overview-card-item').evaluateAll((cards) => cards.map((card) => {
    const image = card.querySelector<HTMLElement>('.card-img img')
    const glow = card.querySelector<HTMLElement>('.img-glow')
    return {
      imageTransform: image?.style.transform || '',
      glowOpacity: glow?.style.opacity || '',
    }
  }))

  const settled = await readImageEffects()
  await page.waitForTimeout(400)
  expect(await readImageEffects()).toEqual(settled)
})

test('scrolls the continuous itinerary to a selected journey day', async ({ page }) => {
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await page.getByRole('button', { name: /D3 杭州.*断桥/ }).click()
  await expect(page.getByRole('menuitem', { name: '详细日程' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(3)
  await expect.poll(() => page.evaluate(() => {
    const navigation = document.querySelector<HTMLElement>('.top-switch-nav')
    const target = document.querySelector<HTMLElement>('#daily-day-2')
    const main = document.querySelector<HTMLElement>('.main-area')
    if (!navigation || !target || !main) return false
    const navigationRect = navigation.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    return targetRect.top >= navigationRect.bottom && targetRect.top < mainRect.bottom
  })).toBe(true)
})

test('renders every day with its own ordered reference timeline', async ({ page }) => {
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.locator('#daily-day-1 .daily-timeline__time')).toHaveText(['08:30', '12:00', '14:00'])
  await expect(page.getByText('以下时间为参考时间，开放时间以景点当日公告为准').first()).toBeVisible()
  await expect(page.locator('.daily-itinerary__day-panel')).toHaveCount(3)
})

test('adds suggested times to untimed legacy items', async ({ page }) => {
  await preparePlanPage(page, legacyTripPlan)
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.getByRole('radiogroup', { name: '日程分组' })).toHaveCount(0)
  await expect(page.locator('.daily-timeline__time')).toHaveText(['09:00', '14:00'])
  await expect(page.getByText('建议 09:00–10:00')).toBeVisible()
  await expect(page.getByText('季节性建议，临近出发时根据天气更新').first()).toBeVisible()
})

test('deleting a budget attraction updates budget, overview, and detailed itinerary together', async ({ page }) => {
  const initialPlan = JSON.parse(JSON.stringify(tripPlanWithBlueprint)) as TripPlan
  const attraction = initialPlan.days[0].attractions[0]
  attraction.id = 'attr-bund'
  attraction.poi_id = 'amap-bund'
  attraction.ticket_price = 80
  initialPlan.budget = {
    total_attractions: 80,
    total_hotels: 0,
    total_meals: 0,
    total_transportation: 0,
    total: 80,
  }

  const updatedPlan = JSON.parse(JSON.stringify(initialPlan)) as TripPlan
  updatedPlan.days[0].attractions = []
  updatedPlan.blueprint!.stages[0].highlights = ['西湖']
  updatedPlan.budget = {
    total_attractions: 0,
    total_hotels: 0,
    total_meals: 0,
    total_transportation: 0,
    total: 0,
  }

  const budgetItem = {
    id: 'itinerary:attraction:attr-bund',
    type: 'attraction',
    day_index: 0,
    day_end_index: 0,
    name: '外滩',
    amount: 80,
    amount_basis: 'per_person',
    traveler_count: 1,
    per_person_amount: 80,
    calculation_summary: '¥80/人 × 1人',
    unit_amount: 80,
    room_count: null,
    nights: null,
    origin: 'itinerary',
    price_source: 'estimated',
    linked_item_id: 'attr-bund',
    entity_source: 'amap',
    source_url: '',
    price_checked_at: '',
    note: '',
    user_locked: false,
    deleted: false,
  }
  const zeroBudget = updatedPlan.budget

  await preparePlanPage(page, initialPlan, 'zh-CN', {
    budgetResponse: {
      plan_id: planId,
      items: [budgetItem],
      totals: initialPlan.budget,
      per_person_totals: initialPlan.budget,
      traveler_count: 1,
      room_count: 1,
      pending_count: 0,
    },
    attractionDeleteResponse: {
      plan_id: planId,
      plan: updatedPlan,
      items: [],
      totals: zeroBudget,
      per_person_totals: zeroBudget,
      traveler_count: 1,
      room_count: 1,
      pending_count: 0,
    },
  })

  await page.getByRole('menuitem', { name: '预算明细' }).click()
  const budgetRow = page.locator('.budget-detail-row').filter({ hasText: '外滩' })
  await expect(budgetRow).toBeVisible()
  await budgetRow.locator('.budget-delete-btn').click()
  await expect(page.getByText('将从今日行程、行程总览、详细日程、景点地图和预算中同时删除「外滩」。')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click()
  await expect(budgetRow).toHaveCount(0)

  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await expect(page.locator('.overview-card')).not.toContainText('外滩')
  await expect(page.locator('.overview-card')).toContainText('西湖')

  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.locator('.days-card')).not.toContainText('外滩')
  await expect(page.locator('.days-card')).toContainText('西湖')

  const storedPlan = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tripPlan') || '{}'))
  expect(storedPlan.days.flatMap((day: TripPlan['days'][number]) => day.attractions)
    .some((item: TripPlan['days'][number]['attractions'][number]) => item.name === '外滩')).toBe(false)
  expect(storedPlan.blueprint.stages[0].highlights).toEqual(['西湖'])
})

test('uses the same blueprint and daily views on a readonly share page', async ({ page }) => {
  await mockSharedPlan(page, tripPlanWithBlueprint)
  await page.goto('/share/blueprint')
  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await expect(page.getByRole('heading', { name: '江南慢游' })).toBeVisible()
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.getByText('以下时间为参考时间，开放时间以景点当日公告为准').first()).toBeVisible()
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '分享' })).toHaveCount(0)
})

test('keeps blueprint and daily views inside a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preparePlanPage(page)
  for (const label of ['行程总览', '详细日程']) {
    await page.getByRole('menuitem', { name: label }).click()
    const layout = await page.evaluate((sectionLabel) => {
      const navigation = document.querySelector<HTMLElement>('.top-switch-nav')
      const content = document.querySelector<HTMLElement>(
        sectionLabel === '行程总览' ? '.journey__hero' : '.itinerary-mode',
      )
      return {
        widths: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
        navigationBottom: Math.round(navigation?.getBoundingClientRect().bottom ?? 0),
        contentTop: Math.round(content?.getBoundingClientRect().top ?? 0),
      }
    }, label)
    expect(layout.widths[0]).toBe(layout.widths[1])
    expect(layout.contentTop).toBeGreaterThanOrEqual(layout.navigationBottom)
  }
})

test('keeps the mobile result navigation pinned while the plan scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await page.locator('.main-area').evaluate((main) => {
    main.scrollTop = main.scrollHeight
  })

  await expect.poll(() => page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.main-area')
    const navigation = document.querySelector<HTMLElement>('.top-switch-nav')
    return {
      mainTop: Math.round(main?.getBoundingClientRect().top ?? -1),
      navigationTop: Math.round(navigation?.getBoundingClientRect().top ?? -2),
      scrolled: (main?.scrollTop ?? 0) > 0,
    }
  })).toEqual({ mainTop: 53, navigationTop: 53, scrolled: true })
})

test('uses one mobile grouping control and keeps all day media directly visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '详细日程' }).click()

  const groupingControl = page.locator('.itinerary-mode > div')
  await expect(groupingControl).toBeVisible()
  await expect(page.locator('.mobile-day-selector, .day-selector')).toHaveCount(0)
  await expect(page.locator('.daily-timeline details')).toHaveCount(0)
  await expect(page.locator('.daily-timeline__details img').first()).toBeVisible()
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(3)

  await page.getByRole('radio', { name: '周' }).click()
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(3)
  await expect(page.getByRole('heading', { name: /抵达杭州/ })).toBeVisible()

  const widths = await groupingControl.evaluate((control) => [control.clientWidth, control.scrollWidth])
  expect(widths[0]).toBe(widths[1])
})

test('keeps all five days visible while display grouping changes', async ({ page }) => {
  await preparePlanPage(page, makeLongTripPlan(5, '2026-08-01'))
  await page.getByRole('menuitem', { name: '详细日程' }).click()

  await expect(page.getByRole('radiogroup', { name: '日程分组' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '日' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(5)
  await page.getByRole('radio', { name: '周' }).click()
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(5)
  await expect(page.getByText('第 1 周 · 第 1～5 天 · 8月1日—8月5日')).toBeVisible()

  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.getByRole('radio', { name: '周' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(5)
})

test('uses concrete weekly ranges for a ten-day plan', async ({ page }) => {
  await preparePlanPage(page, makeLongTripPlan(10, '2026-08-01'))
  await page.getByRole('menuitem', { name: '详细日程' }).click()

  await expect(page.getByRole('radio', { name: '周' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.daily-itinerary__group-heading')).toHaveText([
    '第 1 周 · 第 1～7 天 · 8月1日—8月7日',
    '第 2 周 · 第 8～10 天 · 8月8日—8月10日',
  ])
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(10)
})

test('defaults a thirty-five-day plan to month grouping', async ({ page }) => {
  await preparePlanPage(page, makeLongTripPlan(35, '2026-08-15'))
  await page.getByRole('menuitem', { name: '详细日程' }).click()

  await expect(page.getByRole('radio', { name: '月' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(35)
  await expect(page.locator('.daily-itinerary__month-heading')).toHaveCount(2)
  await expect(page.locator('.daily-itinerary__week-heading')).toHaveCount(0)

  await page.getByRole('radio', { name: '周' }).click()
  await expect(page.locator('.daily-itinerary__week-heading').nth(2)).toHaveText(
    '第 3 周 · 第 15～21 天 · 8月29日—9月4日',
  )
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(35)
})

test('renders blueprint and daily sections without nested Ant cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await preparePlanPage(page)

  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await expect(page.locator('.flow-card > .ant-card-body')).toHaveCount(0)
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.locator('.days-card > .ant-card-body')).toHaveCount(0)
})

test('exports a non-empty itinerary image', async ({ page }, testInfo) => {
  await preparePlanPage(page)
  await page.route('https://api.qrserver.com/**', async (route) => {
    await route.fulfill({ body: Buffer.from(tinyImage.split(',')[1], 'base64'), contentType: 'image/gif' })
  })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出攻略' }).click()
  await page.getByRole('menuitem', { name: /攻略长图/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^旅行计划_.*\.png$/)
  const path = await download.path()
  expect(path).not.toBeNull()
  const size = await import('node:fs/promises').then((fs) => fs.stat(path as string).then((stat) => stat.size))
  expect(size).toBeGreaterThan(0)
  const artifactPath = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(artifactPath)
  await testInfo.attach('exported-itinerary', { path: artifactPath, contentType: 'image/png' })
})

test('supports keyboard day selection and captures visual QA artifacts', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '行程总览' }).click()
  const firstDay = page.getByRole('button', { name: /D1 上海.*外滩/ }).first()
  await firstDay.focus()
  await expect(firstDay).toBeFocused()
  await page.screenshot({
    path: testInfo.outputPath('trip-blueprint-desktop.png'),
    animations: 'disabled',
  })

  await firstDay.press('Enter')
  await expect(page.getByRole('menuitem', { name: '详细日程' })).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({
    path: testInfo.outputPath('daily-itinerary-desktop.png'),
    animations: 'disabled',
  })

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('menuitem', { name: '行程总览' }).click()
  await page.screenshot({
    path: testInfo.outputPath('trip-blueprint-mobile.png'),
    animations: 'disabled',
  })
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await page.screenshot({
    path: testInfo.outputPath('daily-itinerary-mobile.png'),
    animations: 'disabled',
  })
  await page.locator('.daily-timeline__details img').first().evaluate((image) => {
    image.scrollIntoView({ block: 'center' })
  })
  await page.screenshot({
    path: testInfo.outputPath('daily-itinerary-mobile-media.png'),
    animations: 'disabled',
  })
})

const adaptiveVisualCases = [
  { name: 'desktop-week-10', width: 1440, height: 900, days: 10, start: '2026-08-01', mode: '周' },
  { name: 'desktop-month-35', width: 1440, height: 900, days: 35, start: '2026-08-15', mode: '月' },
  { name: 'tablet-week-10', width: 768, height: 1024, days: 10, start: '2026-08-01', mode: '周' },
  { name: 'mobile-day-5', width: 375, height: 812, days: 5, start: '2026-08-01', mode: '日' },
  { name: 'mobile-week-10', width: 375, height: 812, days: 10, start: '2026-08-01', mode: '周' },
  { name: 'mobile-month-35', width: 375, height: 812, days: 35, start: '2026-08-15', mode: '月' },
] as const

for (const visualCase of adaptiveVisualCases) {
  test(`captures adaptive itinerary ${visualCase.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: visualCase.width, height: visualCase.height })
    await preparePlanPage(page, makeLongTripPlan(visualCase.days, visualCase.start))
    await page.getByRole('menuitem', { name: '详细日程' }).click()
    await expect(page.getByRole('radio', { name: visualCase.mode })).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.daily-itinerary__day')).toHaveCount(visualCase.days)
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.clientWidth === document.documentElement.scrollWidth
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`${visualCase.name}.png`),
      animations: 'disabled',
    })

    if (visualCase.name === 'mobile-day-5') {
      await page.getByRole('radio', { name: '周' }).click()
      await expect(page.locator('.daily-itinerary__day')).toHaveCount(visualCase.days)
      await page.screenshot({
        path: testInfo.outputPath('mobile-week-5-switched.png'),
        animations: 'disabled',
      })
      await page.locator('.daily-timeline__details img').first().evaluate((image) => {
        image.scrollIntoView({ block: 'center' })
      })
      await page.screenshot({
        path: testInfo.outputPath('mobile-week-5-media.png'),
        animations: 'disabled',
      })
    }
  })
}
