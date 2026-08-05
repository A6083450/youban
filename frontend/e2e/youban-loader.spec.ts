import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('shows the Youban loader before the Vue entry module is ready', async ({ page }, testInfo) => {
  let releaseEntry: (() => void) | undefined
  const entryBlocked = new Promise<void>((resolve) => {
    releaseEntry = resolve
  })

  await page.route('**/src/main.ts', async (route) => {
    await entryBlocked
    await route.continue()
  })

  const navigation = page.goto('/')
  const bootLoader = page.locator('.youban-boot-loader')

  await expect(bootLoader).toBeVisible()
  await expect(bootLoader).toContainText('游伴')
  await expect(bootLoader).toContainText('正在准备你的旅程')

  const animation = await bootLoader.evaluate((element) => {
    const left = element.querySelector<SVGGElement>('.youban-boot-loader__foot--left')
    const right = element.querySelector<SVGGElement>('.youban-boot-loader__foot--right')
    return {
      left: left ? getComputedStyle(left).animationName : '',
      right: right ? getComputedStyle(right).animationName : '',
      rightDelay: right ? getComputedStyle(right).animationDelay : '',
    }
  })
  expect(animation.left).toContain('youban-boot-foot-step')
  expect(animation.right).toContain('youban-boot-foot-step')
  expect(animation.rightDelay).toBe('-0.7s')

  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 800 })
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(hasOverflow).toBe(false)
    await page.screenshot({ path: testInfo.outputPath(`boot-loader-${width}.png`) })
  }

  releaseEntry?.()
  await navigation
  await expect(bootLoader).toHaveCount(0)
})

const taskId = 'loader-preview-task'
const user = { user_id: 'loader-preview-user', nickname: 'Loader QA' } as const

const prepareActiveGeneration = async (page: Page): Promise<void> => {
  await page.addInitScript(({ activeTaskId, storedUser }) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
    localStorage.setItem(`tripstar.active_task.${storedUser.user_id}`, JSON.stringify({
      taskId: activeTaskId,
      city: '川西环线',
      days: 7,
      userText: '规划川西七日行程',
      startDate: '2026-08-10',
      endDate: '2026-08-16',
    }))
    sessionStorage.setItem('youban_splashed', '1')
  }, { activeTaskId: taskId, storedUser: user })

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
    await route.fulfill({ json: {} })
  })

  await page.routeWebSocket(`**/api/trip/ws/${taskId}**`, (socket) => {
    setTimeout(() => {
      socket.send(JSON.stringify({
        task_id: taskId,
        plan_id: taskId,
        status: 'processing',
        stage: 'planning',
        progress: 48,
        message: '正在生成专属行程…',
        details: [],
      }))
    }, 80)
  })

  await page.goto('/')
  await expect(page.locator('.youban-splash')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.locator('.youban-loader')).toBeVisible()
  await expect(page.locator('.youban-loader__message')).toHaveText('正在生成专属行程…')
}

test('shows the animated paired-foot Youban loader during generation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1222, height: 974 })
  await prepareActiveGeneration(page)

  const loader = page.locator('.youban-loader')
  const animation = await loader.evaluate((element) => {
    const left = element.querySelector<SVGGElement>('.youban-loader__foot--left')
    const right = element.querySelector<SVGGElement>('.youban-loader__foot--right')
    const mark = element.querySelector<SVGElement>('.youban-loader__mark')
    return {
      left: left ? getComputedStyle(left).animationName : '',
      right: right ? getComputedStyle(right).animationName : '',
      rightDelay: right ? getComputedStyle(right).animationDelay : '',
      mark: mark ? getComputedStyle(mark).animationName : '',
    }
  })

  expect(animation.left).toContain('youban-foot-step')
  expect(animation.right).toContain('youban-foot-step')
  expect(animation.mark).toContain('youban-mark-sway')
  expect(animation.rightDelay).toBe('-0.7s')
  await expect(page.locator('.wp-progress-pct')).toHaveText('48%')
  await page.screenshot({ path: testInfo.outputPath('youban-loader-frame-a.png'), fullPage: true })
  await page.waitForTimeout(350)
  await page.screenshot({ path: testInfo.outputPath('youban-loader-frame-b.png'), fullPage: true })
  await page.waitForTimeout(350)
  await page.screenshot({ path: testInfo.outputPath('youban-loader-frame-c.png'), fullPage: true })
})

test('keeps the loader readable without overflow on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await prepareActiveGeneration(page)

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
  await expect(page.locator('.youban-loader__brand')).toHaveText('游伴')
  await page.screenshot({ path: testInfo.outputPath('youban-loader-mobile.png'), fullPage: true })
})

test('uses a non-moving fallback when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await prepareActiveGeneration(page)

  const animationNames = await page.locator('.youban-loader').evaluate((element) => {
    const foot = element.querySelector<SVGGElement>('.youban-loader__foot')
    const mark = element.querySelector<SVGElement>('.youban-loader__mark')
    return [
      foot ? getComputedStyle(foot).animationName : '',
      mark ? getComputedStyle(mark).animationName : '',
    ]
  })
  expect(animationNames).toEqual(['none', 'none'])
})
