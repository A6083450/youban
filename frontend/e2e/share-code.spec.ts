import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { TripPlan } from '../src/types'

const validCode = '0f321b259a867c4d1029384756abcdef'
const ownedPlanId = 'owned-plan'
const user = { user_id: 'share-code-user', nickname: 'Share QA' }

const ownedPlan = {
  city: '杭州',
  cities: ['杭州'],
  start_date: '2026-08-01',
  end_date: '2026-08-01',
  days: [{
    date: '2026-08-01',
    day_index: 1,
    city: '杭州',
    description: '西湖一日游',
    transportation: '步行',
    accommodation: '无需住宿',
    attractions: [{
      name: '西湖',
      address: '杭州市西湖区',
      location: { longitude: 120.15, latitude: 30.25 },
      visit_duration: 180,
      description: '沿湖游览',
      ticket_price: 0,
    }],
    meals: [{ type: 'lunch', name: '湖滨餐厅', estimated_cost: 80 }],
  }],
  weather_info: [],
  overall_suggestions: '穿舒适的鞋。',
  budget: {
    total_attractions: 0,
    total_hotels: 0,
    total_meals: 80,
    total_transportation: 20,
    total: 100,
  },
} satisfies TripPlan

const mockCommonApis = async (page: Page): Promise<void> => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/trip/history') {
      await route.fulfill({ json: { items: [] } })
      return
    }
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { success: true, user } })
      return
    }
    if (
      path === `/api/trip/share/${ownedPlanId}`
      && route.request().method() === 'POST'
    ) {
      await route.fulfill({ json: { plan_id: ownedPlanId, share_code: validCode } })
      return
    }
    await route.fulfill({ status: 404, json: { detail: '分享计划不存在或尚未完成' } })
  })
}

const prepareOwnedPlan = async (page: Page, planId: string): Promise<void> => {
  await page.addInitScript(({ storedUser, storedPlan, storedPlanId }) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    sessionStorage.setItem('planId', storedPlanId)
    sessionStorage.setItem('tripPlan', JSON.stringify(storedPlan))
  }, { storedUser: user, storedPlan: ownedPlan, storedPlanId: planId })
  await page.goto(`/plan/${planId}`)
  await expect(page.getByRole('button', { name: /分享$/ })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('tripstar-locale')) {
      localStorage.setItem('tripstar-locale', 'zh-CN')
    }
  })
  await mockCommonApis(page)
})

test('shows a prominent share-code entry on the logged-out login page', async ({ page }) => {
  await page.goto('/login')
  const input = page.getByRole('textbox', { name: '分享码' })
  await expect(page.getByText('查看朋友分享的计划')).toBeVisible()
  await expect(input).toBeVisible()

  await input.fill('xyz')
  await page.getByRole('button', { name: '查看' }).click()
  await expect(page.getByText('请输入 32 位分享码')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)

  await input.fill(' 0F321B25 9A867C4D 10293847 56ABCDEF ')
  await page.getByRole('button', { name: '查看' }).click()
  await expect(page).toHaveURL(`/share/${validCode}`)
})

test('preserves and rejects an overlength share code instead of opening another plan', async ({ page }) => {
  await page.goto('/login')
  const input = page.getByRole('textbox', { name: '分享码' })
  await input.fill(`${validCode}0`)
  await expect(input).toHaveValue(`${validCode}0`)
  await page.getByRole('button', { name: '查看' }).click()
  await expect(page.getByText('请输入 32 位分享码')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

for (const locale of [
  {
    value: 'en-US',
    title: 'View a shared trip',
    label: 'Share code',
    placeholder: '32-character code',
    submit: 'View',
  },
  {
    value: 'ja-JP',
    title: '友だちの共有プランを見る',
    label: '共有コード',
    placeholder: '32文字の共有コード',
    submit: '表示',
  },
] as const) {
  test(`renders the ${locale.value} share-code entry at 375px without overflow`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.addInitScript((value) => localStorage.setItem('tripstar-locale', value), locale.value)
    await page.goto('/login')
    await expect(page.getByText(locale.title)).toBeVisible()
    await expect(page.getByRole('textbox', { name: locale.label })).toHaveAttribute(
      'placeholder',
      locale.placeholder,
    )
    await expect(page.getByRole('button', { name: locale.submit })).toBeVisible()
    const widths = await page.evaluate(() => [
      document.documentElement.clientWidth,
      document.documentElement.scrollWidth,
    ])
    expect(widths).toEqual([375, 375])
  })
}

test('keeps share-code entry in a collapsible sidebar utility area', async ({ page }) => {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
  }, user)
  await page.goto('/')
  const desktopTrigger = page.getByRole('button', { name: '查看朋友分享的计划' })
  const input = page.getByRole('textbox', { name: '分享码' })
  await expect(desktopTrigger).toBeVisible()
  await expect(desktopTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(input).toBeHidden()
  await desktopTrigger.click()
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await desktopTrigger.click()
  await expect(input).toBeHidden()

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: '游玩计划' }).click()
  const mobileTrigger = page.getByRole('button', { name: '查看朋友分享的计划' })
  await expect(mobileTrigger).toBeVisible()
  await expect(input).toBeHidden()
  await mobileTrigger.click()
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
})

test('publishes and copies a high-entropy code from the share modal', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  })
  await prepareOwnedPlan(page, ownedPlanId)
  const publishRequest = page.waitForRequest((request) => {
    const path = new URL(request.url()).pathname
    return path === `/api/trip/share/${ownedPlanId}` && request.method() === 'POST'
  })
  await page.getByRole('button', { name: /分享$/ }).click()
  await publishRequest

  const dialog = page.getByRole('dialog', { name: '分享游玩计划' })
  await expect(dialog.getByText('分享码', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: '分享码' })).toHaveValue(validCode)
  await expect(dialog.locator('.share-link-input').first()).toHaveValue(
    `http://127.0.0.1:4173/share/${validCode}`,
  )
  await dialog.getByRole('button', { name: '复制分享码' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(validCode)
  await expect(page.getByText('分享码已复制')).toBeVisible()
})

test('keeps an invalid share code on a retryable public error page', async ({ page }) => {
  await page.route('**/api/trip/share/deadbeef', (route) =>
    route.fulfill({ status: 404, json: { detail: '分享计划不存在或尚未完成' } }),
  )
  await page.goto('/share/deadbeef')
  await expect(page.getByText('分享码无效或计划尚未完成')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '分享码' })).toHaveValue('deadbeef')
  await expect(page.getByText('输入其他分享码')).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
})

test('shows a retryable network error without exposing internal details', async ({ page }) => {
  await page.route('**/api/trip/share/facefeed', (route) => route.abort('failed'))
  await page.goto('/share/facefeed')
  await expect(page.getByText('暂时无法读取分享计划')).toBeVisible()
  await expect(page.getByRole('textbox', { name: '分享码' })).toHaveValue('facefeed')
  await expect(page.locator('body')).not.toContainText('AxiosError')
})
