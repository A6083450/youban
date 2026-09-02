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
    auth.restore.mockClear()
    preferences.sync.mockClear()
  })

  it('validates a private mini-program session from the App launch lifecycle', async () => {
    ;(App as unknown as {
      setup: (props: Record<string, never>, context: { expose: () => void }) => void
    }).setup({}, { expose: () => undefined })

    hooks.launch?.({ path: 'pages/index/index' })
    await flushPromises()

    expect(auth.restore).toHaveBeenCalledTimes(1)
    expect(uni.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/login/index' }))
  })
})
