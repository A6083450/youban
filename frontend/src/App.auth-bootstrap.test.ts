import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'

const hooks = vi.hoisted(() => ({
  launch: undefined as ((options?: { path?: string }) => void) | undefined,
  show: undefined as ((options?: { path?: string }) => void) | undefined,
}))

const auth = vi.hoisted(() => ({
  ready: false,
  restore: vi.fn().mockResolvedValue(undefined),
}))

const preferences = vi.hoisted(() => ({
  sync: vi.fn().mockResolvedValue(undefined),
}))

const platform = vi.hoisted(() => ({ current: 'mp-weixin' }))

vi.mock('@dcloudio/uni-app', () => ({
  onHide: vi.fn(),
  onLaunch: (callback: typeof hooks.launch) => {
    hooks.launch = callback
  },
  onShow: (callback: typeof hooks.show) => {
    hooks.show = callback
  },
}))

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return { ...actual, onMounted: vi.fn() }
})

vi.mock('@/store/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/store/preferences', () => ({ usePreferencesStore: () => preferences }))
vi.mock('@/platform/auth', () => ({ currentPlatform: () => platform.current }))
vi.mock('@/router/launch-route', () => ({
  h5LaunchUrl: vi.fn(() => ''),
  normalizedPagePath: (value: string | undefined) => value ? `/${value.replace(/^\//, '')}` : '',
  waitForInitialPage: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/router/interceptor', () => ({ navigateToInterceptor: { invoke: vi.fn() } }))

describe('app authentication bootstrap', () => {
  beforeEach(() => {
    hooks.launch = undefined
    hooks.show = undefined
    auth.ready = false
    platform.current = 'mp-weixin'
    auth.restore.mockClear()
    preferences.sync.mockClear()
    vi.mocked(getCurrentPages).mockReturnValue([{ route: '/pages/index/index' }] as never)
  })

  it('opens the mini-program home without forcing login', async () => {
    ;(App as unknown as {
      setup: (props: Record<string, never>, context: { expose: () => void }) => void
    }).setup({}, { expose: () => undefined })

    hooks.launch?.({ path: 'pages/index/index' })
    await flushPromises()

    expect(auth.restore).not.toHaveBeenCalled()
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('keeps the website home behind login', async () => {
    platform.current = 'h5'
    ;(App as unknown as {
      setup: (props: Record<string, never>, context: { expose: () => void }) => void
    }).setup({}, { expose: () => undefined })

    hooks.launch?.({ path: 'pages/index/index' })
    await flushPromises()

    expect(auth.restore).toHaveBeenCalledTimes(1)
    expect(uni.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/login/index' }))
  })

  it('does not relaunch login when an app show event repeats the private launch path', async () => {
    vi.mocked(getCurrentPages).mockReturnValue([{ route: 'pages/login/index' }] as never)
    vi.mocked(uni.reLaunch).mockImplementation((options) => {
      options.success?.({ errMsg: 'reLaunch:ok' })
      return {} as UniApp.GeneralCallbackResult
    })
    ;(App as unknown as {
      setup: (props: Record<string, never>, context: { expose: () => void }) => void
    }).setup({}, { expose: () => undefined })

    hooks.launch?.({ path: 'pages/index/index' })
    await flushPromises()
    vi.mocked(uni.reLaunch).mockClear()

    hooks.show?.({ path: 'pages/index/index' })
    await flushPromises()

    expect(uni.reLaunch).not.toHaveBeenCalled()
  })
})
