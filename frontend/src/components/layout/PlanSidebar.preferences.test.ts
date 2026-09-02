import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'

const mocks = vi.hoisted(() => ({
  getConversations: vi.fn().mockResolvedValue({ items: [] }),
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
      nickname: '微信用户',
      avatar_url: '/api/avatars/avatar.png',
    },
    logout: vi.fn(),
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
    } as Record<string, string>)[key] ?? key,
  }),
}))

let PlanSidebar: Component

beforeAll(async () => {
  PlanSidebar = (await import('./PlanSidebar.vue')).default
})

describe('plan sidebar preferences', () => {
  it('uses the bottom sidebar slot for preferences without rendering the WeChat user card', async () => {
    const wrapper = mount(PlanSidebar, {
      props: { open: true },
      global: {
        stubs: {
          'scroll-view': { template: '<div><slot /></div>' },
          'wd-icon': { template: '<span />' },
        },
      },
    })
    await flushPromises()

    const tools = wrapper.get('.sidebar-tools')
    expect(tools.element.lastElementChild).toBe(tools.get('.sidebar-preferences').element)
    expect(wrapper.find('.sidebar-user').exists()).toBe(false)
    expect(wrapper.text()).toContain('语言')
    expect(wrapper.text()).toContain('外观')
    expect(wrapper.text()).not.toContain('微信用户')

    wrapper.unmount()
  })
})
