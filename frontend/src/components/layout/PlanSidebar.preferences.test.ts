import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'

const mocks = vi.hoisted(() => ({
  getConversations: vi.fn().mockResolvedValue({ items: [] }),
  logout: vi.fn(),
  setLocale: vi.fn(),
  setSkin: vi.fn(),
}))

vi.mock('@/services/v2', () => ({
  deleteConversation: vi.fn(),
  deleteTripPlan: vi.fn(),
  getConversations: mocks.getConversations,
}))

vi.mock('@/store/auth', () => ({
  useAuthStore: () => ({
    user: {
      user_id: 'wechat-user',
      nickname: '网页登录昵称',
      avatar_url: '/api/avatars/avatar.png',
      profile_complete: true,
    },
    logout: mocks.logout,
  }),
}))

vi.mock('@/store/preferences', () => ({
  usePreferencesStore: () => ({
    locale: 'zh-CN',
    skin: 'default',
    setLocale: mocks.setLocale,
    setSkin: mocks.setSkin,
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'app.preferences.label': '偏好设置',
      'app.language.label': '语言',
      'app.language.zh': '中文',
      'app.language.en': 'English',
      'app.language.fr': 'Français',
      'app.skin.label': '外观',
      'app.skin.warm': '暖光',
      'app.skin.clear': '清朗',
      'account.wechatUser': '微信用户',
      'account.logout': '退出登录',
      'user.myMemories': '我的记忆',
    } as Record<string, string>)[key] ?? key,
  }),
}))

let PlanSidebar: Component

beforeAll(async () => {
  PlanSidebar = (await import('./PlanSidebar.vue')).default
})

describe('plan sidebar preferences', () => {
  function mountSidebar() {
    return mount(PlanSidebar, {
      props: { open: true },
      global: {
        stubs: {
          'scroll-view': { template: '<div><slot /></div>' },
          'wd-icon': { template: '<span />' },
        },
      },
    })
  }

  it('opens language and appearance choices from one compact icon row', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    const toolbar = wrapper.get('.preference-toolbar')
    const triggers = toolbar.findAll('.preference-toolbar-button')
    expect(triggers).toHaveLength(2)
    const languageTrigger = toolbar.get('.preference-language-trigger')
    const skinTrigger = toolbar.get('.preference-skin-trigger')
    expect(toolbar.find('.i-carbon-language').exists()).toBe(true)
    expect(toolbar.find('.i-carbon-sun').exists()).toBe(true)

    await languageTrigger.trigger('click')
    expect(wrapper.get('.preference-choice-panel.language').text()).toContain('English')
    await wrapper.get('[data-preference-value="en-US"]').trigger('click')
    expect(mocks.setLocale).toHaveBeenCalledWith('en-US')
    expect(wrapper.find('.preference-choice-panel').exists()).toBe(false)

    await skinTrigger.trigger('click')
    expect(wrapper.get('.preference-choice-panel.skin').text()).toContain('清朗')
    await wrapper.get('[data-preference-value="google"]').trigger('click')
    expect(mocks.setSkin).toHaveBeenCalledWith('google')

    wrapper.unmount()
  })

  it('keeps the website nickname and exposes an explicit logout action', async () => {
    const wrapper = mountSidebar()
    await flushPromises()

    expect(wrapper.get('.user-name').text()).toBe('网页登录昵称')
    await wrapper.get('.account-trigger').trigger('click')
    expect(wrapper.get('.account-menu').text()).toContain('退出登录')
    await wrapper.get('.account-logout').trigger('click')
    await flushPromises()

    expect(mocks.logout).toHaveBeenCalledTimes(1)
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/login/index' })

    wrapper.unmount()
  })
})
