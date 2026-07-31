import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { TripPlan } from '../src/types'

const planId = 'map-loading-plan'
const user = { user_id: 'map-loading-user', nickname: 'Map Loading QA' } as const

const tripPlan = {
  city: '北京',
  start_date: '2026-07-29',
  end_date: '2026-07-29',
  weather_info: [],
  overall_suggestions: '地图加载回归场景',
  days: [{
    date: '2026-07-29',
    day_index: 0,
    city: '北京',
    description: '地图加载回归场景',
    transportation: '步行',
    accommodation: '北京市中心',
    meals: [],
    attractions: [
      {
        name: '故宫博物院',
        address: '北京市东城区景山前街4号',
        location: { longitude: 116.397026, latitude: 39.918058 },
        visit_duration: 180,
        description: '故宫',
      },
      {
        name: '景山公园',
        address: '北京市西城区景山西街44号',
        location: { longitude: 116.3964, latitude: 39.9251 },
        visit_duration: 60,
        description: '景山',
      },
    ],
  }],
} satisfies TripPlan

const amapScript = String.raw`
(() => {
  window.__mapConstructCount = 0;
  window.__pendingRouteCallbacks = [];
  window.__fitViewCount = 0;

  class FakeMap {
    constructor(containerId) {
      window.__mapConstructCount += 1;
      this.container = document.getElementById(containerId);
      this.surface = document.createElement('div');
      this.surface.dataset.fakeAmapSurface = 'true';
      this.surface.style.cssText = 'position:absolute;inset:0;background:#eef1e8';
      this.container.appendChild(this.surface);
    }
    add() {}
    setFitView() { window.__fitViewCount += 1; }
    resize() {}
    destroy() { this.surface.remove(); }
  }

  class FakeMarker {
    constructor(options) { this.options = options; }
    on() {}
    getPosition() { return this.options.position; }
  }
  class FakeInfoWindow { open() {} close() {} }
  class FakePixel {}
  class FakePolyline { constructor(options) { this.options = options; } }
  class FakeRouteService {
    search(_start, _end, callback) { window.__pendingRouteCallbacks.push(callback); }
  }

  window.AMap = {
    Map: FakeMap,
    Marker: FakeMarker,
    InfoWindow: FakeInfoWindow,
    Pixel: FakePixel,
    Polyline: FakePolyline,
    Walking: FakeRouteService,
    Driving: FakeRouteService,
    DrivingPolicy: { LEAST_TIME: 0 },
    plugin(_plugins, callback) { callback(); },
  };
  window.___onAPILoaded();
})();
`

const mockCommonApi = async (page: Page): Promise<void> => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { success: true, user } })
      return
    }
    if (path === '/api/trip/history') {
      await route.fulfill({ json: { success: true, items: [] } })
      return
    }
    if (path.endsWith('/conversation')) {
      await route.fulfill({ json: { plan_id: planId, messages: [] } })
      return
    }
    if (path === '/api/poi/photo') {
      await route.fulfill({ json: { success: true, data: {} } })
      return
    }
    await route.fulfill({ json: {} })
  })
}

const preparePlanPage = async (page: Page): Promise<void> => {
  await page.addInitScript(
    ({ storedUser, storedPlan, storedPlanId }) => {
      localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
      localStorage.setItem('tripstar-locale', 'zh-CN')
      localStorage.setItem('tripstar.runtime.amap_web_js_key', 'map-loading-test-key')
      sessionStorage.setItem('planId', storedPlanId)
      sessionStorage.setItem('tripPlan', JSON.stringify(storedPlan))
    },
    { storedUser: user, storedPlan: tripPlan, storedPlanId: planId },
  )
  await mockCommonApi(page)
  await page.goto(`/plan/${planId}`)
  await expect(page.getByRole('menuitem', { name: '行程概览' })).toBeVisible()
}

const installDelayedAmap = async (page: Page) => {
  let releaseSdk = () => {}
  const sdkGate = new Promise<void>((resolve) => { releaseSdk = resolve })
  let markRequested = () => {}
  const sdkRequested = new Promise<void>((resolve) => { markRequested = resolve })

  await page.route('https://webapi.amap.com/maps**', async (route: Route) => {
    markRequested()
    await sdkGate
    await route.fulfill({ contentType: 'application/javascript', body: amapScript })
  })

  return { sdkRequested, releaseSdk }
}

test('constructs one map when the map section is re-entered during SDK loading', async ({ page }) => {
  const sdk = await installDelayedAmap(page)
  await preparePlanPage(page)

  await page.getByRole('menuitem', { name: '景点地图' }).click()
  await sdk.sdkRequested
  await page.getByRole('menuitem', { name: '行程概览' }).click()
  await page.getByRole('menuitem', { name: '景点地图' }).click()
  sdk.releaseSdk()

  await expect(page.locator('[data-fake-amap-surface]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__mapConstructCount)).toBe(1)
})

test('reveals the base map before route enhancement completes', async ({ page }) => {
  await page.route('https://webapi.amap.com/maps**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: amapScript }),
  )
  await preparePlanPage(page)

  await page.getByRole('menuitem', { name: '景点地图' }).click()
  await expect(page.locator('[data-fake-amap-surface]')).toBeVisible()
  await expect(page.locator('.map-loading-mask')).toBeHidden({ timeout: 750 })
  await expect.poll(() => page.evaluate(() => window.__pendingRouteCallbacks.length)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.__fitViewCount)).toBeGreaterThan(0)
})

declare global {
  interface Window {
    __mapConstructCount: number
    __fitViewCount: number
    __pendingRouteCallbacks: Array<(status: string, result: unknown) => void>
  }
}
