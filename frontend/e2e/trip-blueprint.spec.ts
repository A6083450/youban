import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { TripPlan } from '../src/types'

const planId = 'blueprint-plan'
const user = { user_id: 'blueprint-user', nickname: 'Blueprint QA' } as const
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

const mockCommonApi = async (page: Page): Promise<void> => {
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
      await route.fulfill({ json: { success: true, data: { photo_url: attractionImage } } })
      return
    }
    await route.fulfill({ json: {} })
  })
}

const preparePlanPage = async (page: Page, plan: TripPlan = tripPlanWithBlueprint): Promise<void> => {
  await page.addInitScript(
    ({ storedUser, storedPlanId, storedPlan }) => {
      localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
      localStorage.setItem('tripstar-locale', 'zh-CN')
      sessionStorage.setItem('planId', storedPlanId)
      sessionStorage.setItem('tripPlan', JSON.stringify(storedPlan))
    },
    { storedUser: user, storedPlanId: planId, storedPlan: plan },
  )
  await mockCommonApi(page)
  await page.goto(`/plan/${planId}`)
  await expect(page.getByRole('menuitem', { name: '行程概览' })).toBeVisible()
}

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

test('shows journey context without duplicating daily logistics', async ({ page }) => {
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
  const blueprint = page.locator('.flow-card')
  await expect(blueprint.getByRole('heading', { name: '江南慢游' })).toBeVisible()
  await expect(blueprint.getByText('从上海城市文化进入杭州湖滨慢游。')).toBeVisible()
  await expect(blueprint.getByText('城市文化', { exact: true })).toBeVisible()
  await expect(blueprint.getByRole('button', { name: /D1 上海.*外滩/ })).toBeVisible()
  await expect(blueprint.getByText('测试酒店')).toHaveCount(0)
  await expect(blueprint.getByText('测试餐厅')).toHaveCount(0)
})

test('scrolls the continuous itinerary to a selected journey day', async ({ page }) => {
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
  await page.getByRole('button', { name: /D3 杭州.*断桥/ }).click()
  await expect(page.getByRole('menuitem', { name: '每日行程' })).toHaveAttribute('aria-selected', 'true')
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
  await page.getByRole('menuitem', { name: '每日行程' }).click()
  await expect(page.locator('#daily-day-1 .daily-timeline__time')).toHaveText(['08:30', '12:00', '14:00'])
  await expect(page.getByText('以下时间为参考时间').first()).toBeVisible()
  await expect(page.locator('.daily-itinerary__day-panel')).toHaveCount(3)
})

test('shows untimed legacy items after timed items', async ({ page }) => {
  await preparePlanPage(page, legacyTripPlan)
  await page.getByRole('menuitem', { name: '每日行程' }).click()
  await expect(page.getByRole('radiogroup', { name: '日程分组' })).toHaveCount(0)
  await expect(page.locator('.daily-timeline__time')).toHaveText(['时间待定', '时间待定'])
})

test('uses the same blueprint and daily views on a readonly share page', async ({ page }) => {
  await mockSharedPlan(page, tripPlanWithBlueprint)
  await page.goto('/share/blueprint')
  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
  await expect(page.getByRole('heading', { name: '江南慢游' })).toBeVisible()
  await page.getByRole('menuitem', { name: '每日行程' }).click()
  await expect(page.getByText('以下时间为参考时间').first()).toBeVisible()
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '分享' })).toHaveCount(0)
})

test('keeps blueprint and daily views inside a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preparePlanPage(page)
  for (const label of ['行程脉络图', '每日行程']) {
    await page.getByRole('menuitem', { name: label }).click()
    const layout = await page.evaluate((sectionLabel) => {
      const navigation = document.querySelector<HTMLElement>('.top-switch-nav')
      const content = document.querySelector<HTMLElement>(
        sectionLabel === '行程脉络图' ? '.journey__hero' : '.itinerary-mode',
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
  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
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
  })).toEqual({ mainTop: 52, navigationTop: 52, scrolled: true })
})

test('uses one mobile grouping control and keeps all day media directly visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preparePlanPage(page)
  await page.getByRole('menuitem', { name: '每日行程' }).click()

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
  await page.getByRole('menuitem', { name: '每日行程' }).click()

  await expect(page.getByRole('radiogroup', { name: '日程分组' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '日' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(5)
  await page.getByRole('radio', { name: '周' }).click()
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(5)
  await expect(page.getByText('第 1 周 · 第 1～5 天 · 8月1日—8月5日')).toBeVisible()

  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
  await page.getByRole('menuitem', { name: '每日行程' }).click()
  await expect(page.getByRole('radio', { name: '周' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(5)
})

test('uses concrete weekly ranges for a ten-day plan', async ({ page }) => {
  await preparePlanPage(page, makeLongTripPlan(10, '2026-08-01'))
  await page.getByRole('menuitem', { name: '每日行程' }).click()

  await expect(page.getByRole('radio', { name: '周' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.daily-itinerary__group-heading')).toHaveText([
    '第 1 周 · 第 1～7 天 · 8月1日—8月7日',
    '第 2 周 · 第 8～10 天 · 8月8日—8月10日',
  ])
  await expect(page.locator('.daily-itinerary__day')).toHaveCount(10)
})

test('defaults a thirty-five-day plan to month grouping', async ({ page }) => {
  await preparePlanPage(page, makeLongTripPlan(35, '2026-08-15'))
  await page.getByRole('menuitem', { name: '每日行程' }).click()

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

  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
  await expect(page.locator('.flow-card > .ant-card-body')).toHaveCount(0)
  await page.getByRole('menuitem', { name: '每日行程' }).click()
  await expect(page.locator('.days-card > .ant-card-body')).toHaveCount(0)
})

test('exports a non-empty itinerary image', async ({ page }, testInfo) => {
  await preparePlanPage(page)
  await page.route('https://api.qrserver.com/**', async (route) => {
    await route.fulfill({ body: Buffer.from(tinyImage.split(',')[1], 'base64'), contentType: 'image/gif' })
  })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出攻略' }).click()
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
  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
  const firstDay = page.getByRole('button', { name: /D1 上海.*外滩/ }).first()
  await firstDay.focus()
  await expect(firstDay).toBeFocused()
  await page.screenshot({
    path: testInfo.outputPath('trip-blueprint-desktop.png'),
    animations: 'disabled',
  })

  await firstDay.press('Enter')
  await expect(page.getByRole('menuitem', { name: '每日行程' })).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({
    path: testInfo.outputPath('daily-itinerary-desktop.png'),
    animations: 'disabled',
  })

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('menuitem', { name: '行程脉络图' }).click()
  await page.screenshot({
    path: testInfo.outputPath('trip-blueprint-mobile.png'),
    animations: 'disabled',
  })
  await page.getByRole('menuitem', { name: '每日行程' }).click()
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
    await page.getByRole('menuitem', { name: '每日行程' }).click()
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
