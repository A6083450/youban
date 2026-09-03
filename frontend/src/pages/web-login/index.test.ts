import type { VueWrapper } from '@vue/test-utils'
import { flushPromises, mount } from '@vue/test-utils'
import type { Component } from 'vue'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const challengeId = 'b'.repeat(32)
let loadPage: ((query: Record<string, string>) => void) | undefined
const auth = { ready: true, restore: vi.fn(), user: { nickname: '微信用户' } }
const mocks = vi.hoisted(() => ({ approve: vi.fn(), scan: vi.fn() }))

vi.mock('@dcloudio/uni-app', () => ({
  onLoad: vi.fn((handler: (query: Record<string, string>) => void) => {
    loadPage = handler
  }),
}))
vi.mock('@/services/v2', () => ({
  approveWebLoginChallenge: mocks.approve,
  scanWebLoginChallenge: mocks.scan,
}))
vi.mock('@/store/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/store/preferences', () => ({
  usePreferencesStore: () => ({ themeClass: 'theme-warm' }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'app.brand': '游伴',
      'login.confirmTitle': '确认网页登录',
      'login.confirmDescription': '确认后，电脑将登录为当前微信账号。',
      'login.confirmButton': '确认登录',
      'login.confirmLoginButton': '登录并继续确认',
      'login.confirmCancel': '取消',
      'login.confirmInvalid': '登录二维码无效',
      'login.confirmExpired': '登录二维码已失效',
      'login.confirmFailed': '确认失败，请重试',
      'login.confirmSuccess': '已确认，请返回电脑继续',
      'login.confirmBackHome': '返回首页',
      'login.confirmClaimed': '该二维码已被其他微信账号扫码，请返回电脑刷新二维码。',
    } as Record<string, string>)[key] ?? key,
  }),
}))

let WebLoginPage: Component
let wrapper: VueWrapper | undefined

beforeAll(async () => {
  Object.defineProperty(globalThis, 'definePage', {
    value: vi.fn(),
    configurable: true,
  })
  WebLoginPage = (await import('./index.vue')).default
})

beforeEach(() => {
  mocks.scan.mockResolvedValue({ success: true })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  auth.ready = true
  auth.restore.mockReset().mockResolvedValue(undefined)
  mocks.approve.mockReset()
  mocks.scan.mockReset()
  vi.mocked(uni.getStorageSync).mockReturnValue(null)
})

async function open(scene = challengeId): Promise<VueWrapper> {
  wrapper = mount(WebLoginPage)
  loadPage?.({ scene })
  await flushPromises()
  return wrapper
}

describe('mini-program Web login confirmation', () => {
  it('claims the challenge when an authenticated user opens the confirmation page', async () => {
    const page = await open()

    expect(mocks.scan).toHaveBeenCalledWith(challengeId)
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(page.text()).toContain('确认后，电脑将登录为当前微信账号。')
  })

  it('waits for explicit confirmation before approving', async () => {
    mocks.approve.mockResolvedValue({ success: true })
    const page = await open()

    expect(mocks.approve).not.toHaveBeenCalled()
    await page.get('.confirm-button').trigger('click')
    await flushPromises()

    expect(mocks.approve).toHaveBeenCalledWith(challengeId)
    expect(page.text()).toContain('已确认，请返回电脑继续')
    expect(uni.removeStorageSync).toHaveBeenCalledWith('youban.v2.pending-web-login-challenge')
  })

  it('hands an unauthenticated user to avatar login and resumes later', async () => {
    auth.ready = false
    const page = await open()

    expect(page.text()).toContain('登录并继续确认')
    await page.get('.confirm-button').trigger('click')
    await flushPromises()

    expect(uni.setStorageSync).toHaveBeenCalledWith(
      'youban.v2.pending-web-login-challenge',
      challengeId,
    )
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('revalidates a cached session before approving', async () => {
    auth.restore.mockImplementation(async () => {
      auth.ready = false
    })
    const page = await open()
    await page.get('.confirm-button').trigger('click')
    await flushPromises()

    expect(auth.restore).toHaveBeenCalledWith(true)
    expect(uni.setStorageSync).toHaveBeenCalledWith(
      'youban.v2.pending-web-login-challenge',
      challengeId,
    )
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('rejects invalid scenes and maps an expired challenge', async () => {
    const invalid = await open('not-a-challenge')
    expect(invalid.text()).toContain('登录二维码无效')
    expect(invalid.get('.confirm-button').attributes()).toHaveProperty('disabled')
    invalid.unmount()

    mocks.approve.mockRejectedValue(Object.assign(new Error('登录挑战已过期'), { status: 422 }))
    const expired = await open()
    await expired.get('.confirm-button').trigger('click')
    await flushPromises()
    expect(expired.text()).toContain('登录二维码已失效')
    expect(uni.removeStorageSync).toHaveBeenCalledWith('youban.v2.pending-web-login-challenge')
  })

  it('cancels without approving', async () => {
    const page = await open()
    await page.get('.cancel-button').trigger('click')
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' })
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('blocks confirmation when another WeChat account already scanned the code', async () => {
    mocks.scan.mockRejectedValue(Object.assign(new Error('登录挑战已由其他账号扫码'), { status: 409 }))
    const page = await open()

    expect(page.text()).toContain('该二维码已被其他微信账号扫码，请返回电脑刷新二维码。')
    expect(page.get('.confirm-button').attributes()).toHaveProperty('disabled')
  })
})
