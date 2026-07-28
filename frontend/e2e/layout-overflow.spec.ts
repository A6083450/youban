import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { DayPlan, TripPlan } from '../src/types'

const planId = 'layout-overflow'
const user = {
  user_id: 'layout-test-user',
  nickname: 'Layout QA',
} as const

const createDay = (index: number): DayPlan => ({
  date: `2026-08-${String(index + 1).padStart(2, '0')}`,
  day_index: index,
  city: '测试城市',
  description: '用真实长度的行程内容验证详细卡片不会改变应用外壳的滚动归属。',
  transportation: '公共交通与步行',
  accommodation: '测试酒店',
  hotel: {
    name: '测试城市中心酒店',
    address: '测试大道 100 号',
    price_range: '¥500-700',
    rating: '4.8',
    distance: '1.2km',
    type: '舒适型',
    estimated_cost: 600,
  },
  attractions: [
    {
      name: '详细行程布局压力测试景点',
      address: '测试城市一条较长但可正常换行的景点地址',
      location: { longitude: 116.4, latitude: 39.9 },
      visit_duration: 120,
      description: '景点描述用于生成足够高的概述卡片，并验证内容在结果区域内正常换行。',
      ticket_price: 40,
    },
  ],
  meals: [
    {
      type: 'lunch',
      name: '测试餐厅',
      estimated_cost: 80,
    },
  ],
})

const tripPlan = {
  city: '测试城市',
  cities: ['测试城市'],
  start_date: '2026-08-01',
  end_date: '2026-08-10',
  days: Array.from({ length: 10 }, (_, index) => createDay(index)),
  weather_info: [],
  overall_suggestions: '详细行程应只让右侧规划工作区滚动，左侧对话记录始终保持在视口内。',
  budget: {
    total_attractions: 400,
    total_hotels: 6000,
    total_meals: 800,
    total_transportation: 500,
    total: 7700,
  },
  blueprint: {
    title: '十日城市体验',
    summary: '以十个连续阶段验证长蓝图的滚动归属。',
    logic: '每一天聚焦一个独立阶段，保持信息可扫描。',
    pace: '适应 → 探索 → 收尾',
    stages: Array.from({ length: 10 }, (_, index) => ({
      title: `第 ${index + 1} 阶段`,
      cities: ['测试城市'],
      day_indices: [index],
      theme: '城市体验',
      rationale: '用足够长度的阶段理由验证蓝图在固定应用外壳内滚动，而不会推动侧栏离开视口。',
      highlights: ['详细行程布局压力测试景点'],
      transition: index < 9 ? '进入下一阶段。' : '',
    })),
  },
} satisfies TripPlan

const preparePlanPage = async (page: Page): Promise<void> => {
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
    if (path.endsWith('/conversation')) {
      await route.fulfill({ json: { plan_id: planId, messages: [] } })
      return
    }
    if (path === '/api/poi/photo') {
      await route.fulfill({
        json: {
          success: true,
          data: { photo_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
        },
      })
      return
    }
    await route.fulfill({ json: {} })
  })

  await page.goto(`/plan/${planId}`)
  await expect(page.getByRole('menuitem', { name: '行程概览' })).toBeVisible()
}

const detailedSections = [
  { label: '行程概览', cardSelector: '.overview-card' },
  { label: '旅行蓝图', cardSelector: '.flow-card' },
  { label: '预算明细', cardSelector: '.top-info-section' },
] as const

for (const section of detailedSections) {
  test(`keeps the conversation sidebar fixed when ${section.label} is taller than the viewport`, async ({ page }) => {
    await preparePlanPage(page)
    await page.getByRole('menuitem', { name: section.label }).click()
    const beforeScroll = await page.evaluate((cardSelector) => {
      const main = document.querySelector<HTMLElement>('.main-area')
      const sidebar = document.querySelector<HTMLElement>('.sidebar')
      const card = document.querySelector<HTMLElement>(cardSelector)
      const wrapper = document.querySelector<HTMLElement>('.content-wrapper')
      const cardRect = card?.getBoundingClientRect()
      const wrapperRect = wrapper?.getBoundingClientRect()
      return {
        documentFitsViewport: document.documentElement.scrollHeight === document.documentElement.clientHeight,
        mainOwnsOverflow: Boolean(
          main && main.scrollHeight > main.clientHeight && getComputedStyle(main).overflowY === 'auto',
        ),
        sidebarAtViewportTop: sidebar?.getBoundingClientRect().top === 0,
        cardInsideWrapper: cardRect && wrapperRect
          ? cardRect.left >= wrapperRect.left && cardRect.right <= wrapperRect.right
          : false,
      }
    }, section.cardSelector)
    expect(beforeScroll).toEqual({
      documentFitsViewport: true,
      mainOwnsOverflow: true,
      sidebarAtViewportTop: true,
      cardInsideWrapper: true,
    })

    await page.locator('.main-area').evaluate((main) => {
      main.scrollTop = main.scrollHeight
    })
    await expect
      .poll(() =>
        page.evaluate(() => ({
          windowScrollY: window.scrollY,
          sidebarTop: document.querySelector('.sidebar')?.getBoundingClientRect().top,
        })),
      )
      .toEqual({ windowScrollY: 0, sidebarTop: 0 })
  })
}

test('keeps the continuous itinerary scrolling inside the main pane', async ({ page }) => {
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '每日行程' }).click()
  const layout = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.main-area')
    const card = document.querySelector<HTMLElement>('.days-card')
    const wrapper = document.querySelector<HTMLElement>('.content-wrapper')
    const cardRect = card?.getBoundingClientRect()
    const wrapperRect = wrapper?.getBoundingClientRect()
    return {
      documentFitsViewport: document.documentElement.scrollHeight === document.documentElement.clientHeight,
      mainOwnsOverflow: Boolean(
        main && main.scrollHeight > main.clientHeight && getComputedStyle(main).overflowY === 'auto'
      ),
      cardInsideWrapper: cardRect && wrapperRect
        ? cardRect.left >= wrapperRect.left && cardRect.right <= wrapperRect.right
        : false,
    }
  })
  expect(layout).toEqual({
    documentFitsViewport: true,
    mainOwnsOverflow: true,
    cardInsideWrapper: true,
  })
})

test('keeps the budget card inside the main pane at a 1024px viewport', async ({ page }) => {
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '预算明细' }).click()
  const widths = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.main-area')
    const budget = document.querySelector<HTMLElement>('.top-info-section')
    return {
      document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
      main: [main?.clientWidth, main?.scrollWidth],
      budget: [budget?.clientWidth, budget?.scrollWidth],
    }
  })
  expect(widths.document).toEqual([1024, 1024])
  expect(widths.main[0]).toBe(widths.main[1])
  expect(widths.budget[0]).toBe(widths.budget[1])
})

test('centers the plan conversation panel in the desktop main pane', async ({ page }) => {
  await preparePlanPage(page)

  const centers = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.main-area')
    const panel = document.querySelector<HTMLElement>('.agent-dock')
    const mainRect = main?.getBoundingClientRect()
    const panelRect = panel?.getBoundingClientRect()

    return {
      main: mainRect ? mainRect.left + mainRect.width / 2 : 0,
      panel: panelRect ? panelRect.left + panelRect.width / 2 : 0,
    }
  })

  expect(Math.abs(centers.main - centers.panel)).toBeLessThanOrEqual(1)
})

test('renders an unframed two-column overview waterfall on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preparePlanPage(page)

  const overviewLayout = await page.locator('.overview-card').evaluate((overview) => {
    const waterfall = overview.querySelector<HTMLElement>('.overview-grid')
    return [waterfall ? getComputedStyle(waterfall).columnCount : '', overview.querySelectorAll(':scope > .ant-card-body').length] as const
  })
  expect(overviewLayout).toEqual(['2', 0])
})

test('keeps the narrow-screen budget and itinerary grouping readable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preparePlanPage(page)

  await page.getByRole('menuitem', { name: '预算明细' }).click()
  const budgetVerticalLayout = await page.evaluate(() => ({
    navigationBottom: Math.round(document.querySelector('.top-switch-nav')?.getBoundingClientRect().bottom ?? 0),
    toolbarTop: Math.round(document.querySelector('.budget-toolbar')?.getBoundingClientRect().top ?? 0),
  }))
  expect(budgetVerticalLayout.toolbarTop).toBeGreaterThanOrEqual(budgetVerticalLayout.navigationBottom)

  await page.getByRole('menuitem', { name: '每日行程' }).click()
  const dailyLayout = await page.evaluate(() => {
    const groupingControl = document.querySelector<HTMLElement>('.itinerary-mode > div')
    const panels = Array.from(document.querySelectorAll<HTMLElement>('.daily-itinerary__day-panel'))
    return {
      document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
      legacySelectors: document.querySelectorAll('.day-selector, .mobile-day-selector').length,
      groupingVisible: groupingControl ? getComputedStyle(groupingControl).display !== 'none' : false,
      groupingFits: Boolean(groupingControl && groupingControl.scrollWidth === groupingControl.clientWidth),
      panelCount: panels.length,
      panelsFit: panels.every((panel) => panel.scrollWidth === panel.clientWidth),
    }
  })
  expect(dailyLayout.document).toEqual([375, 375])
  expect(dailyLayout.legacySelectors).toBe(0)
  expect(dailyLayout.groupingVisible).toBe(true)
  expect(dailyLayout.groupingFits).toBe(true)
  expect(dailyLayout.panelCount).toBe(10)
  expect(dailyLayout.panelsFit).toBe(true)
})
