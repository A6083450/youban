import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WechatLoginSheet from './WechatLoginSheet.vue'

const mocks = vi.hoisted(() => ({
  disagree: vi.fn(),
  install: vi.fn(),
  login: vi.fn(),
  openContract: vi.fn(),
  privacyVisible: { value: false },
}))

vi.mock('@/platform/wechat-privacy', () => ({
  wechatPrivacyAuthorization: {
    agree: vi.fn(),
    disagree: mocks.disagree,
    install: mocks.install,
    openContract: mocks.openContract,
    visible: mocks.privacyVisible,
  },
}))

vi.mock('@/store/auth', () => ({
  useAuthStore: () => ({ loginMiniProgramWithAvatar: mocks.login }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('wechat login sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.privacyVisible.value = false
    mocks.login.mockResolvedValue({ user_id: 'user-1' })
  })

  it('keeps the pending prompt visible and completes avatar login in place', async () => {
    const wrapper = mount(WechatLoginSheet, {
      props: { open: true, prompt: '去杭州玩三天' },
    })

    expect(wrapper.text()).toContain('去杭州玩三天')
    await wrapper.get('.sheet-avatar-action').trigger('chooseavatar', {
      detail: { avatarUrl: '/tmp/avatar.png' },
    })

    expect(mocks.login).toHaveBeenCalledWith('/tmp/avatar.png')
    expect(wrapper.emitted('authenticated')).toHaveLength(1)
  })

  it('renders privacy authorization inside the same sheet', async () => {
    mocks.privacyVisible.value = true
    const wrapper = mount(WechatLoginSheet, {
      props: { open: true, prompt: '去杭州玩三天' },
    })

    expect(wrapper.find('.sheet-privacy-state').exists()).toBe(true)
    await wrapper.get('.sheet-cancel-action').trigger('click')

    expect(mocks.disagree).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
