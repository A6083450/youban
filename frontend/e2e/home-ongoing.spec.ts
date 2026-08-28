import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const user = {
  user_id: 'ongoing-mobile-user',
  nickname: '移动端用户',
  avatar_url: '/api/avatars/ongoing-mobile.jpg',
  profile_complete: true,
} as const

const mockOngoingTrips = async (page: Page): Promise<void> => {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
    sessionStorage.setItem('youban_splashed', '1')
  }, user)

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { success: true, user } })
      return
    }
    if (path === '/api/trip/history') {
      await route.fulfill({
        json: {
          items: [
            {
              plan_id: 'long-route',
              status: 'completed',
              city: '乌鲁木齐 → 吐鲁番 → 库尔勒 → 库车 → 阿克苏 → 喀什 → 塔县 → 和田',
              start_date: '2026-08-01',
              end_date: '2026-08-12',
              updated_at: '2026-08-05T09:00:00+08:00',
            },
            {
              plan_id: 'short-route',
              status: 'completed',
              city: '西双版纳',
              start_date: '2026-08-01',
              end_date: '2026-08-08',
              updated_at: '2026-08-05T08:00:00+08:00',
            },
            {
              plan_id: 'family-route',
              status: 'completed',
              city: '三亚',
              start_date: '2026-08-05',
              end_date: '2026-08-10',
              updated_at: '2026-08-05T07:00:00+08:00',
            },
          ],
        },
      })
      return
    }
    await route.fulfill({ json: {} })
  })
}

const mobileViewports = [
  { name: 'narrow', width: 375, height: 812 },
  { name: 'reference', width: 430, height: 930 },
] as const

for (const viewport of mobileViewports) {
  test(`keeps ongoing trips compact inside the ${viewport.name} mobile viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.clock.setFixedTime(new Date('2026-08-05T12:00:00+08:00'))
    await mockOngoingTrips(page)
    await page.goto('/')

    const splash = page.locator('.youban-splash')
    await expect(splash).toHaveCount(0, { timeout: 15_000 })

    const cards = page.locator('.ongoing-card')
    await expect(cards).toHaveCount(3)
    await expect(cards.first()).toContainText('进入今日行程')

    const layout = await page.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>('.mobile-app-header')
      const inputArea = document.querySelector<HTMLElement>('.chat-input-area')
      const cardElements = Array.from(document.querySelectorAll<HTMLElement>('.ongoing-card'))
      const inputRect = inputArea?.getBoundingClientRect()
      const firstRect = cardElements[0]?.getBoundingClientRect()
      const longTitle = cardElements[0]?.querySelector<HTMLElement>('.ongoing-title')
      const titleText = longTitle?.firstChild
      let placeNameLineCount = -1
      if (titleText instanceof Text) {
        const placeName = '阿克苏'
        const start = titleText.data.indexOf(placeName)
        if (start >= 0) {
          const range = document.createRange()
          range.setStart(titleText, start)
          range.setEnd(titleText, start + placeName.length)
          placeNameLineCount = new Set(
            Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
          ).size
        }
      }
      return {
        documentWidth: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
        cardsInsideInput: Boolean(inputRect) && cardElements.every((card) => {
          const rect = card.getBoundingClientRect()
          return rect.left >= inputRect!.left && rect.right <= inputRect!.right
        }),
        firstCardOffset: firstRect && topbar
          ? Math.round(firstRect.top - topbar.getBoundingClientRect().bottom)
          : -1,
        placeNameLineCount,
      }
    })

    expect(layout.documentWidth[1]).toBe(layout.documentWidth[0])
    expect(layout.cardsInsideInput).toBe(true)
    expect(layout.firstCardOffset).toBeGreaterThanOrEqual(16)
    expect(layout.firstCardOffset).toBeLessThanOrEqual(64)
    expect(layout.placeNameLineCount).toBe(1)

    await page.screenshot({
      path: testInfo.outputPath(`mobile-ongoing-trips-${viewport.width}.png`),
      animations: 'disabled',
      fullPage: true,
    })
  })
}

test('uses one compact row for ongoing trips on desktop without a duplicate welcome panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.setFixedTime(new Date('2026-08-05T12:00:00+08:00'))
  await mockOngoingTrips(page)
  await page.goto('/')

  const cards = page.locator('.ongoing-card')
  await expect(cards).toHaveCount(3)
  await expect(page.locator('.welcome')).toHaveCount(0)

  const layout = await cards.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { top: Math.round(rect.top), height: Math.round(rect.height) }
  }))

  expect(new Set(layout.map(({ top }) => top)).size).toBe(1)
  expect(Math.max(...layout.map(({ height }) => height))).toBeLessThanOrEqual(112)

  const suggestions = page.locator('.suggestions .elx-prompts__item')
  await expect(suggestions).toHaveCount(5)
  const suggestionHeights = await suggestions.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().height)),
  )
  expect(Math.max(...suggestionHeights)).toBeLessThanOrEqual(64)
})
