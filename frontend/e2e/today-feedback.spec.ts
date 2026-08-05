import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { ExecutionMap, TripPlan } from '../src/types'

const planId = 'today-feedback-plan'
const user = { user_id: 'today-feedback-user', nickname: 'Today QA' } as const
const today = new Date().toLocaleDateString('en-CA')

const tripPlan = {
  city: '可可托海',
  cities: ['可可托海'],
  start_date: today,
  end_date: today,
  days: [
    {
      date: today,
      day_index: 0,
      city: '可可托海',
      description: '在山水与矿业遗迹之间慢慢行走。',
      transportation: '包车与步行',
      accommodation: '可可托海镇酒店',
      attractions: [
        {
          id: 'lake',
          name: '可可苏里湖',
          address: '富蕴县可可苏里景区',
          location: { longitude: 89.72, latitude: 47.2 },
          visit_duration: 90,
          description: '芦苇与湿地湖泊相间。',
          start_time: '15:00',
          end_time: '16:30',
        },
        {
          id: 'mine',
          name: '可可托海三号矿坑',
          address: '可可托海镇',
          location: { longitude: 89.89, latitude: 47.22 },
          visit_duration: 90,
          description: '了解新疆工业历史。',
          start_time: '17:00',
          end_time: '18:30',
        },
        {
          id: 'park',
          name: '可可托海国家地质公园',
          address: '额尔齐斯大峡谷',
          location: { longitude: 89.7, latitude: 47.3 },
          visit_duration: 120,
          description: '峡谷、河流和花岗岩地貌。',
          start_time: '19:00',
          end_time: '21:00',
        },
      ],
      meals: [
        { id: 'breakfast', type: 'breakfast', name: '布尔津酒店早餐', time: '07:30' },
        { id: 'lunch', type: 'lunch', name: '富蕴县途中拌面', time: '12:30' },
      ],
    },
  ],
  weather_info: [{ date: today, day_weather: '多云', day_temp: 27, night_temp: 15 }],
  overall_suggestions: '按自己的节奏感受可可托海。',
} satisfies TripPlan

const prepareToday = async (
  page: Page,
  execution: ExecutionMap,
  options: { failStatusUpdate?: boolean } = {},
): Promise<void> => {
  await page.addInitScript(
    ({ storedUser, storedPlanId, storedPlan }) => {
      localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
      localStorage.setItem('tripstar-locale', 'zh-CN')
      sessionStorage.setItem('planId', storedPlanId)
      sessionStorage.setItem('tripPlan', JSON.stringify(storedPlan))
    },
    { storedUser: user, storedPlanId: planId, storedPlan: tripPlan },
  )

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
    if (path === `/api/trip/status/${planId}`) {
      await route.fulfill({
        json: {
          status: 'completed',
          execution,
          result: { success: true, message: 'ok', plan_id: planId, data: tripPlan },
        },
      })
      return
    }
    if (path.includes('/items/') && path.endsWith('/status')) {
      if (options.failStatusUpdate) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        await route.fulfill({ status: 500, json: { detail: 'save failed' } })
        return
      }
      const status = String((await route.request().postDataJSON()).status)
      await route.fulfill({ json: { execution: { status, updated_at: new Date().toISOString() } } })
      return
    }
    if (path === '/api/poi/photo') {
      await route.fulfill({ json: { success: true, data: { photo_url: '' } } })
      return
    }
    if (path.endsWith('/conversation')) {
      await route.fulfill({ json: { plan_id: planId, messages: [] } })
      return
    }
    await route.fulfill({ json: {} })
  })

  await page.goto(`/plan/${planId}?section=today`)
  await expect(page.getByRole('menuitem', { name: '今日行程' })).toBeVisible()
}

const done = (ids: string[]): ExecutionMap => Object.fromEntries(
  ids.map((id) => [id, { status: 'done', updated_at: '2026-08-05T08:00:00+08:00' }]),
)

test('gives warm credit for completed plans without making a skipped plan feel like failure', async ({ page }) => {
  await prepareToday(page, {
    ...done(['breakfast', 'lake', 'mine', 'park']),
    lunch: { status: 'skipped', updated_at: '2026-08-05T12:30:00+08:00' },
  })

  const reflection = page.locator('.today-reflection')
  await expect(reflection).toContainText('今日探索 · 80%')
  await expect(reflection).toContainText('今天走得很扎实')
  await expect(reflection).toContainText('完成 4 项，1 项留给下次，也不算遗憾。')
  await expect(reflection).toContainText('可可苏里湖')
  await expect(page.locator('.today-item.is-done').first()).toHaveCSS('opacity', '1')
})

test('celebrates the final check-in with a place-specific echo and a completed-day summary', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await prepareToday(page, done(['breakfast', 'lunch', 'lake', 'mine']))

  const park = page.locator('.today-item').filter({ hasText: '可可托海国家地质公园' })
  await park.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认完成' }).click()

  const feedback = page.getByRole('status')
  await expect(feedback).toContainText('可可托海国家地质公园已打卡，又收下一段好风景')
  await expect(page.getByRole('status')).toHaveCSS('transition-property', 'opacity')
  await expect(page.locator('.today-reflection')).toContainText('今日行程圆满收官')
  await expect(page.locator('.today-reflection')).toContainText('完成全部 5 项，今天的每一步都值得记住。')
  await expect(page.locator('.today-reflection-story-compact')).toHaveText('今天已留下 5 个旅行足迹。')
  await expect(page.locator('.today-reflection-story-wide')).toBeHidden()

  const feedbackLines = await feedback.evaluate((element) => {
    const name = element.querySelector('strong')?.getBoundingClientRect()
    const message = element.querySelector('.today-action-feedback-message')?.getBoundingClientRect()
    return {
      nameAboveMessage: Boolean(name && message && name.bottom <= message.top),
      messageFitsOneLine: Boolean(message && message.height < 24),
    }
  })
  expect(feedbackLines).toEqual({ nameAboveMessage: true, messageFitsOneLine: true })

  const feedbackPlacement = await page.evaluate(() => {
    const feedback = document.querySelector<HTMLElement>('.today-action-feedback')?.getBoundingClientRect()
    const navigation = document.querySelector<HTMLElement>('.top-switch-nav')?.getBoundingClientRect()
    const dock = document.querySelector<HTMLElement>('.agent-dock')?.getBoundingClientRect()
    return {
      belowNavigation: Boolean(feedback && navigation && feedback.top >= navigation.bottom + 8),
      aboveDock: Boolean(feedback && dock && feedback.bottom <= dock.top - 8),
    }
  })
  expect(feedbackPlacement).toEqual({ belowNavigation: true, aboveDock: true })
})

test('does not celebrate an update that the server rejected', async ({ page }) => {
  await prepareToday(page, done(['breakfast']), { failStatusUpdate: true })

  const lunch = page.locator('.today-item').filter({ hasText: '富蕴县途中拌面' })
  await lunch.getByRole('button', { name: '跳过', exact: true }).click()

  await expect(page.locator('.today-action-feedback')).toHaveCount(0, { timeout: 200 })
  await expect(page.getByText('状态保存失败,请稍后重试')).toBeVisible()
  await expect(lunch.getByRole('button', { name: '跳过', exact: true })).toBeVisible()
  await expect(page.locator('.today-action-feedback')).toHaveCount(0)
})
