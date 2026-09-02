import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  startWechatWebLogin: vi.fn(),
  loginNickname: vi.fn(),
  mountWechatLoginWidget: vi.fn(),
  acceptWebsiteSession: vi.fn(),
}))

vi.mock('@/services/v2', () => ({
  loginNickname: mocks.loginNickname,
  startWechatWebLogin: mocks.startWechatWebLogin,
}))
vi.mock('@/features/auth/wechat-login-widget', () => ({
  mountWechatLoginWidget: mocks.mountWechatLoginWidget,
}))
vi.mock('@/store/auth', () => ({
  useAuthStore: () => ({
    ready: false,
    acceptWebsiteSession: mocks.acceptWebsiteSession,
    loginMiniProgramWithAvatar: vi.fn(),
  }),
}))
vi.mock('@/store/preferences', () => ({
  usePreferencesStore: () => ({ themeClass: 'theme-warm' }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'app.brand': '游伴',
      'common.loading': '加载中',
      'login.loading': '正在连接微信',
      'login.pending': '使用微信扫码登录',
      'login.failed': '微信扫码登录暂时不可用',
      'login.retry': '重新加载二维码',
      'login.denied': '你已取消微信登录',
      'login.nicknameLabel': '昵称登录',
      'login.nicknamePlaceholder': '请输入昵称',
      'login.nicknameButton': '登录',
      'login.nicknameRequired': '请输入昵称',
      'login.nicknameTooLong': '昵称不能超过 20 个字符',
      'login.nicknameDivider': '或使用微信扫码登录',
      'shareCode.label': '分享码',
      'shareCode.placeholder': '32 位分享码',
      'shareCode.submit': '查看',
    } as Record<string, string>)[key] ?? key,
  }),
}))

const configuration = {
  app_id: 'wx-web-app',
  scope: 'snsapi_login' as const,
  redirect_uri: 'https://youban.me/api/v2/auth/wechat-web/callback',
  state: 'opaque-state-with-at-least-32-bytes',
}

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
  window.location.hash = ''
  vi.clearAllMocks()
})

describe('h5 login page', () => {
  it('logs in with a nickname and navigates home without hiding WeChat login', async () => {
    mocks.startWechatWebLogin.mockRejectedValue(new Error('not configured'))
    const user = {
      user_id: 'nickname-user',
      nickname: '旅行者',
      avatar_url: null,
      profile_complete: true,
    }
    mocks.loginNickname.mockResolvedValue({ success: true, user })

    wrapper = mount(LoginPage)
    await flushPromises()

    expect(wrapper.get('.nickname-label').text()).toBe('昵称登录')
    expect(wrapper.find('#wechat-login-container').exists()).toBe(true)
    await wrapper.get('.nickname-input').trigger('input', { detail: { value: '旅行者' } })
    await wrapper.get('.nickname-login-button').trigger('click')
    await flushPromises()

    expect(mocks.loginNickname).toHaveBeenCalledWith('旅行者')
    expect(mocks.acceptWebsiteSession).toHaveBeenCalledWith(user)
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('rejects an empty website nickname before requesting login', async () => {
    mocks.startWechatWebLogin.mockRejectedValue(new Error('not configured'))

    wrapper = mount(LoginPage)
    await flushPromises()
    await wrapper.get('.nickname-login-button').trigger('click')

    expect(wrapper.text()).toContain('请输入昵称')
    expect(mocks.loginNickname).not.toHaveBeenCalled()
  })

  it('starts official website login and renders its widget container', async () => {
    mocks.startWechatWebLogin.mockResolvedValue(configuration)
    mocks.mountWechatLoginWidget.mockResolvedValue(undefined)

    wrapper = mount(LoginPage)
    await flushPromises()

    expect(wrapper.get('#wechat-login-container').isVisible()).toBe(true)
    expect(wrapper.text()).toContain('使用微信扫码登录')
    expect(mocks.startWechatWebLogin).toHaveBeenCalledTimes(1)
    expect(mocks.mountWechatLoginWidget).toHaveBeenCalledWith(
      'wechat-login-container',
      configuration,
    )
    expect(wrapper.text()).not.toContain('短码')
  })

  it('shows a stable failure and retries with a fresh start request', async () => {
    mocks.startWechatWebLogin
      .mockRejectedValueOnce(new Error('raw network detail'))
      .mockResolvedValueOnce(configuration)
    mocks.mountWechatLoginWidget.mockResolvedValue(undefined)

    wrapper = mount(LoginPage)
    await flushPromises()

    expect(wrapper.text()).toContain('微信扫码登录暂时不可用')
    expect(wrapper.text()).not.toContain('raw network detail')
    await wrapper.get('.refresh-button').trigger('click')
    await flushPromises()
    expect(mocks.startWechatWebLogin).toHaveBeenCalledTimes(2)
  })

  it('maps an allowlisted callback error without starting another flow', async () => {
    window.location.hash = '#/pages/login/index?wechat_error=denied'

    wrapper = mount(LoginPage)
    await flushPromises()

    expect(wrapper.text()).toContain('你已取消微信登录')
    expect(mocks.startWechatWebLogin).not.toHaveBeenCalled()
  })
})
