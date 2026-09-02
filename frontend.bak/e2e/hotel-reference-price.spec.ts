import { expect, test, type Page } from '@playwright/test'
import type { TripPlan } from '../src/types'

const planId = 'fliggy-price-plan'
const user = {
  user_id: 'fliggy-user',
  nickname: '酒店价格验收',
  avatar_url: '/api/avatars/fliggy.jpg',
  profile_complete: true,
}

const plan: TripPlan = {
  city: '上海',
  cities: ['上海'],
  start_date: '2026-09-10',
  end_date: '2026-09-11',
  days: [
    {
      date: '2026-09-10',
      day_index: 0,
      city: '上海',
      description: '外滩城市漫步',
      transportation: '地铁与步行',
      accommodation: '上海外滩华尔道夫酒店',
      hotel: {
        name: '上海外滩华尔道夫酒店',
        address: '上海市黄浦区中山东一路2号',
        price_range: '',
        rating: '4.8',
        distance: '0.5km',
        type: '豪华型',
        estimated_cost: 2480,
        source: 'amap',
        source_hotel_id: 'B0FFG123',
        price_source: 'fliggy',
        price_status: 'estimated',
        source_url: 'https://router.feizhu.com/hotel/1',
        price_checked_at: '2026-08-26T03:00:00.000Z',
        price_method: 'lowest_nightly_browse',
      },
      attractions: [],
      meals: [],
    },
    {
      date: '2026-09-11',
      day_index: 1,
      city: '上海',
      description: '返程',
      transportation: '地铁',
      accommodation: '无需住宿',
      hotel: null,
      attractions: [],
      meals: [],
    },
  ],
  weather_info: [],
  overall_suggestions: '价格仅作浏览参考。',
  budget: {
    total_attractions: 0,
    total_hotels: 2480,
    total_meals: 0,
    total_transportation: 0,
    total: 2480,
  },
}

async function prepare(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.addInitScript(({ storedUser, storedPlan, storedPlanId }) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
    localStorage.setItem('tripstar.skin', 'google')
    sessionStorage.setItem('planId', storedPlanId)
    sessionStorage.setItem('tripPlan', JSON.stringify(storedPlan))
  }, { storedUser: user, storedPlan: plan, storedPlanId: planId })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { success: true, user } })
      return
    }
    if (path === '/api/trip/history') {
      await route.fulfill({ json: { items: [] } })
      return
    }
    if (path.endsWith('/conversation')) {
      await route.fulfill({ json: { plan_id: planId, messages: [] } })
      return
    }
    await route.fulfill({ json: {} })
  })
  await page.goto(`/plan/${planId}`)
  await page.getByRole('menuitem', { name: '详细日程' }).click()
}

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`shows a safe Fliggy nightly reference on ${viewport.name}`, async ({ page }) => {
    await prepare(page, viewport.width, viewport.height)

    await expect(page.getByText('飞猪参考价 ¥2,480/晚')).toBeVisible()
    await expect(page.getByText('房型、税费、库存及退改规则以飞猪页面为准')).toBeVisible()
    const link = page.getByRole('link', { name: '去飞猪查看' })
    await expect(link).toHaveAttribute('href', 'https://router.feizhu.com/hotel/1')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
}
