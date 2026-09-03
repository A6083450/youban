import type { VueWrapper } from '@vue/test-utils'
import { flushPromises, mount } from '@vue/test-utils'
import type { Component } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const challengeId = 'a'.repeat(32)
function challenge(image = 'AAAA') {
  return {
    challenge_id: challengeId,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    qr_code_data_url: `data:image/png;base64,${image}`,
  }
}
const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  create: vi.fn(),
  exchange: vi.fn(),
  loginMiniProgramWithAvatar: vi.fn(),
  restore: vi.fn(),
  setLocale: vi.fn(),
  setSkin: vi.fn(),
  status: vi.fn(),
}))

vi.mock('@/services/v2', () => ({
  createWebLoginChallenge: mocks.create,
  exchangeWebLoginChallenge: mocks.exchange,
  getWebLoginChallengeStatus: mocks.status,
}))
vi.mock('@/store/auth', () => ({
  useAuthStore: () => ({
    ready: false,
    loginMiniProgramWithAvatar: mocks.loginMiniProgramWithAvatar,
    restore: mocks.restore,
  }),
}))
vi.mock('@/store/preferences', () => ({
  usePreferencesStore: () => ({
    locale: 'zh-CN',
    setLocale: mocks.setLocale,
    setSkin: mocks.setSkin,
    skin: 'default',
    themeClass: 'theme-warm',
  }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'app.brand': '游伴',
      'common.loading': '加载中',
      'login.loading': '正在连接微信',
      'login.pending': '使用微信扫码登录',
      'login.scanned': '已扫码，请在小程序中确认',
      'login.scannedTitle': '已扫码',
      'login.scannedHint': '请在小程序中确认登录，请勿重复扫码。',
      'login.failed': '微信扫码登录暂时不可用',
      'login.retry': '重新加载二维码',
      'login.expired': '二维码已失效，请重新加载',
      'login.webSuccess': '登录成功，正在进入',
      'login.loggingIn': '正在登录',
    } as Record<string, string>)[key] ?? key,
  }),
}))

let LoginPage: Component
let wrapper: VueWrapper | undefined

beforeAll(async () => {
  Object.defineProperty(globalThis, 'definePage', {
    value: vi.fn(),
    configurable: true,
  })
  LoginPage = (await import('./index.vue')).default
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
})

describe('login page', () => {
  it('renders the server mini-program code and exchanges an approved challenge', async () => {
    vi.useFakeTimers()
    mocks.create.mockResolvedValue(challenge())
    mocks.status.mockResolvedValue({ status: 'approved' })
    mocks.exchange.mockResolvedValue({ success: true, user: { user_id: 'user-1' } })
    mocks.restore.mockResolvedValue(undefined)

    wrapper = mount(LoginPage)
    await flushPromises()

    expect(wrapper.get('.wechat-login-code').attributes('src')).toBe('data:image/png;base64,AAAA')
    expect(wrapper.text()).toContain('使用微信扫码登录')
    expect(wrapper.find('#wechat-login-container').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('分享码')
    expect(wrapper.text()).not.toContain(challengeId)

    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(mocks.status).toHaveBeenCalledWith(challengeId)
    expect(mocks.exchange).toHaveBeenCalledWith(challengeId)
    expect(mocks.restore).toHaveBeenCalledWith(true)
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('shows a stable failure and retries with a fresh challenge', async () => {
    mocks.create
      .mockRejectedValueOnce(new Error('raw network detail'))
      .mockResolvedValueOnce(challenge('BBBB'))

    wrapper = mount(LoginPage)
    await flushPromises()

    expect(wrapper.text()).toContain('微信扫码登录暂时不可用')
    expect(wrapper.text()).not.toContain('raw network detail')
    await wrapper.get('.refresh-button').trigger('click')
    await flushPromises()
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.wechat-login-code').attributes('src')).toBe('data:image/png;base64,BBBB')
  })

  it('changes theme and language before login', async () => {
    mocks.create.mockResolvedValue(challenge())
    wrapper = mount(LoginPage)
    await flushPromises()

    await wrapper.get('[data-skin="google"]').trigger('click')
    await wrapper.get('[data-locale="en-US"]').trigger('click')

    expect(mocks.setSkin).toHaveBeenCalledWith('google')
    expect(mocks.setLocale).toHaveBeenCalledWith('en-US')
  })

  it('lets only the latest mounted login page create a Web challenge', async () => {
    mocks.create.mockResolvedValue(challenge())

    const first = mount(LoginPage)
    const second = mount(LoginPage)
    await flushPromises()

    expect(mocks.create).toHaveBeenCalledTimes(1)
    first.unmount()
    second.unmount()
  })

  it('hides the QR code behind a clear waiting state after scanning', async () => {
    vi.useFakeTimers()
    mocks.create.mockResolvedValue(challenge())
    mocks.status.mockResolvedValue({ status: 'scanned' })

    wrapper = mount(LoginPage)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()

    expect(wrapper.text()).toContain('已扫码，请在小程序中确认')
    expect(wrapper.text()).toContain('请在小程序中确认登录，请勿重复扫码。')
    expect(wrapper.get('.wechat-login-code').classes()).toContain('is-scanned')
    expect(wrapper.find('.scan-waiting-state').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('retries a temporary polling failure until expiry and labels an expired code', async () => {
    vi.useFakeTimers()
    mocks.create.mockResolvedValue(challenge())
    mocks.status
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ status: 'expired' })

    wrapper = mount(LoginPage)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(wrapper.text()).toContain('使用微信扫码登录')

    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(mocks.status).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('二维码已失效，请重新加载')
  })

  it('returns to a pending confirmation after avatar login', async () => {
    mocks.create.mockRejectedValue(new Error('unused on mini program'))
    mocks.loginMiniProgramWithAvatar.mockResolvedValue({ user_id: 'user-1' })
    vi.mocked(uni.getStorageSync).mockImplementation(key => (
      key === 'youban.v2.pending-web-login-challenge' ? challengeId : null
    ))

    wrapper = mount(LoginPage)
    await wrapper.get('.mini-login-button').trigger('chooseavatar', {
      detail: { avatarUrl: '/tmp/avatar.png' },
    })
    await flushPromises()

    expect(uni.removeStorageSync).toHaveBeenCalledWith('youban.v2.pending-web-login-challenge')
    expect(uni.reLaunch).toHaveBeenCalledWith({
      url: `/pages/web-login/index?scene=${challengeId}`,
    })
  })
})
