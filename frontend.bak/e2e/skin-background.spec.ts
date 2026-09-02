import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const user = {
  user_id: 'skin-background-user',
  nickname: 'Skin QA',
  avatar_url: '/api/avatars/skin-background.jpg',
  profile_complete: true,
} as const

const fulfillJson = (route: Route, json: unknown) => route.fulfill({ json })

const prepareHome = async (
  page: Page,
  skin: 'default' | 'google',
  records: Array<Record<string, unknown>> = [],
) => {
  await page.addInitScript(({ storedUser, storedSkin }) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
    localStorage.setItem('tripstar.skin', storedSkin)
    sessionStorage.setItem('youban_splashed', '1')
  }, { storedUser: user, storedSkin: skin })

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/auth/me') {
      await fulfillJson(route, { success: true, user })
      return
    }
    if (url.pathname === '/api/conversations') {
      await fulfillJson(route, { items: records })
      return
    }
    if (url.pathname.startsWith('/api/conversations/')) {
      const sessionId = decodeURIComponent(url.pathname.split('/').at(-1) || '')
      const record = records.find((item) => item.session_id === sessionId)
      await fulfillJson(route, {
        ...record,
        snapshot: {
          version: 1,
          items: [],
          pendingConfirmId: null,
          pendingDraft: null,
          pendingReadinessToken: '',
          pendingUserText: null,
          nextId: 1,
        },
      })
      return
    }
    await fulfillJson(route, {})
  })

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
}

const backgroundColor = (page: Page, selector: string) =>
  page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundColor)

test('desktop app canvas and navigation backgrounds follow the selected skin', async ({ page }) => {
  await prepareHome(page, 'default')

  await expect.poll(() => backgroundColor(page, '.main-area')).toBe('rgb(250, 247, 242)')
  await expect.poll(() => backgroundColor(page, '.chat-home')).toBe('rgb(250, 247, 242)')
  await expect.poll(() => backgroundColor(page, '.sidebar')).toBe('rgb(255, 250, 246)')

  await page.getByRole('button', { name: /清朗/ }).click()

  await expect(page.locator('html')).toHaveAttribute('data-skin', 'google')
  await expect.poll(() => backgroundColor(page, '.main-area')).toBe('rgb(245, 249, 252)')
  await expect.poll(() => backgroundColor(page, '.chat-home')).toBe('rgb(245, 249, 252)')
  await expect.poll(() => backgroundColor(page, '.sidebar')).toBe('rgb(238, 247, 249)')
})

test('mobile topbar follows the selected skin', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepareHome(page, 'google')

  await expect(page.locator('.mobile-app-header')).toBeVisible()
  await expect.poll(() => backgroundColor(page, '.mobile-app-header')).toBe('rgb(238, 247, 249)')
})

test('selected conversation follows the clear and warm skin palettes', async ({ page }) => {
  const sessionId = 'skin-conversation'
  const record = {
    record_id: sessionId,
    kind: 'conversation',
    session_id: sessionId,
    plan_id: null,
    task_id: null,
    title: '带娃去三亚海边度假4天',
    title_status: 'generated',
    state: 'chatting',
    revision: 0,
    status: null,
    user_id: user.user_id,
    city: '',
    cities: [],
    start_date: '',
    end_date: '',
    travel_days: 0,
    updated_at: '2026-08-24T08:00:00.000Z',
    overall_suggestions: '',
    user_deleted_at: null,
  }
  await prepareHome(page, 'google', [record])
  await page.goto(`/?conversation=${sessionId}`)

  const selected = page.locator('.sidebar-item.active')
  const title = selected.locator('.sidebar-item-city')
  await expect(selected).toBeVisible()
  await expect(selected).toHaveCSS('background-color', 'rgba(59, 155, 180, 0.14)')
  await expect(title).toHaveCSS('color', 'rgb(34, 49, 58)')

  await page.getByRole('button', { name: /暖光/ }).click()
  await expect(selected).toHaveCSS('background-color', 'rgba(217, 119, 87, 0.14)')
  await expect(title).toHaveCSS('color', 'rgb(61, 50, 41)')
})
