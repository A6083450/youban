import { expect, test } from '@playwright/test'
import type { Route } from '@playwright/test'

const user = {
  user_id: 'language-layout-user',
  nickname: 'Language QA',
  avatar_url: '/api/avatars/language-layout.jpg',
  profile_complete: true,
} as const

test('keeps all three language choices on one compact row', async ({ page }) => {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'fr-FR')
    localStorage.setItem('tripstar.skin', 'google')
    sessionStorage.setItem('youban_splashed', '1')
  }, user)
  await page.route('**/api/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') return route.fulfill({ json: { success: true, user } })
    if (path === '/api/conversations') return route.fulfill({ json: { items: [] } })
    return route.fulfill({ json: {} })
  })

  await page.goto('/')

  const group = page.getByRole('group', { name: 'Langue' })
  const choices = group.getByRole('button')
  await expect(group).toBeVisible()
  await expect(choices).toHaveCount(3)

  const boxes = await choices.evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, width: box.width }
  }))
  expect(Math.max(...boxes.map(({ top }) => top)) - Math.min(...boxes.map(({ top }) => top))).toBeLessThan(1)
  expect(Math.max(...boxes.map(({ bottom }) => bottom)) - Math.min(...boxes.map(({ bottom }) => bottom))).toBeLessThan(1)
  expect(Math.min(...boxes.map(({ width }) => width))).toBeGreaterThan(60)
  await expect(group).toHaveCSS('grid-template-columns', /.+ .+ .+/)
  expect((await group.boundingBox())?.height).toBeLessThanOrEqual(48)
})
