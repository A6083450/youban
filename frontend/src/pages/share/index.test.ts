import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises, mount } from '@vue/test-utils'
import type { Component } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let loadPage: ((query: Record<string, string>) => void) | undefined
const mocks = vi.hoisted(() => ({ getSharedTripPlan: vi.fn(), sync: vi.fn() }))
const auth = vi.hoisted(() => ({ ready: true }))

vi.mock('@dcloudio/uni-app', () => ({
  onLoad: vi.fn((handler: (query: Record<string, string>) => void) => {
    loadPage = handler
  }),
  onShareAppMessage: vi.fn(),
  onShareTimeline: vi.fn(),
}))
vi.mock('@/services/v2', () => ({ getSharedTripPlan: mocks.getSharedTripPlan }))
vi.mock('@/store/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/store/preferences', () => ({
  usePreferencesStore: () => ({ sync: mocks.sync, themeClass: 'theme-warm' }),
}))
vi.mock('@/features/result/model', () => ({
  addCalendarEventsSequentially: vi.fn(),
  buildCalendarEvents: vi.fn(() => []),
  buildTripCalendar: vi.fn(() => ''),
  extractTripPlan: (result: unknown) => result,
}))
vi.mock('@/features/result/guide-image', () => ({
  renderTripGuideImage: vi.fn(),
  saveImageToAlbum: vi.fn(),
}))
vi.mock('@/platform/native-actions', () => ({ addCalendarEventsSequentially: vi.fn() }))
vi.mock('@/utils/systemInfo', () => ({
  safeAreaInsets: { top: 47 },
  systemInfo: { windowWidth: 390 },
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

let SharePage: Component
let wrapper: VueWrapper | undefined

beforeAll(async () => {
  Object.defineProperty(globalThis, 'definePage', {
    value: vi.fn(),
    configurable: true,
  })
  Object.assign(uni, {
    getMenuButtonBoundingClientRect: vi.fn(() => ({ left: 279, top: 48, height: 32, bottom: 80 })),
  })
  SharePage = (await import('./index.vue')).default
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  auth.ready = true
})

async function openSharedPlan(): Promise<VueWrapper> {
  mocks.getSharedTripPlan.mockResolvedValue({ result: { city: '厦门' } })
  wrapper = mount(SharePage, {
    global: {
      stubs: {
        TripResult: {
          props: ['readonlyActionLabel'],
          emits: ['readonly-action'],
          template: '<button v-if="readonlyActionLabel" class="readonly-plan-action-proxy" @click="$emit(\'readonly-action\')">{{ readonlyActionLabel }}</button>',
        },
        WdIcon: true,
      },
    },
  })
  loadPage?.({ code: 'a'.repeat(32) })
  await flushPromises()
  return wrapper
}

describe('shared trip navigation', () => {
  it('uses a standard share title with home as the only header action', async () => {
    const page = await openSharedPlan()

    expect(page.get('.share-navigation-title').text()).toBe('result.share.pageTitle')
    expect(page.find('.share-plans-action').exists()).toBe(false)

    await page.get('.share-home-action').trigger('click')
    expect(uni.reLaunch).toHaveBeenLastCalledWith({ url: '/pages/index/index' })
  })

  it('opens the existing plan list from the readonly banner', async () => {
    const page = await openSharedPlan()

    expect(page.get('.readonly-plan-action-proxy').text()).toBe('sidebar.plans')
    await page.get('.readonly-plan-action-proxy').trigger('click')
    expect(uni.reLaunch).toHaveBeenLastCalledWith({ url: '/pages/index/index?plans=1' })
  })

  it('keeps the result toolbar below the share header and preserves the plan drawer route', () => {
    const shareSource = readFileSync(resolve(process.cwd(), 'src/pages/share/index.vue'), 'utf8')
    const homeSource = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')
    const resultSource = readFileSync(resolve(process.cwd(), 'src/components/trip/TripResult.vue'), 'utf8')

    expect(shareSource).toMatch(/class="share-page"[^>]*:style="shareHeaderStyle"/)
    expect(shareSource).toMatch(/\.share-navigation\s*\{[^}]*position:\s*sticky;/)
    expect(shareSource).toMatch(/class="share-navigation-title"/)
    expect(shareSource).toMatch(/'--mobile-menu-center':\s*headerMetrics\.menuCenter/)
    expect(shareSource).toMatch(/'--result-toolbar-top':\s*headerMetrics\.headerHeight/)
    expect(shareSource).toMatch(/margin-top:\s*calc\(var\(--mobile-menu-center\) - 20px\)/)
    expect(resultSource).toMatch(/readonlyActionLabel\?:\s*string/)
    expect(resultSource).toMatch(/class="readonly-banner-action"/)
    expect(resultSource.match(/top:\s*var\(--result-toolbar-top, 0px\);/g)).toHaveLength(2)
    expect(homeSource).toMatch(/drawerOpen\.value\s*=\s*auth\.ready\s*&&\s*query\?\.plans\s*===\s*'1'/)
  })

  it('does not send signed-out visitors to an empty plan drawer', async () => {
    auth.ready = false
    const page = await openSharedPlan()

    expect(page.find('.readonly-plan-action-proxy').exists()).toBe(false)
  })
})
