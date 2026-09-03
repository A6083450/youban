import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WebLoginExperience from '@/components/login/WebLoginExperience.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const readyProps = {
  state: 'ready' as const,
  statusText: '使用微信扫码登录',
  qrCodeDataUrl: 'data:image/png;base64,AAAA',
  skin: 'default' as const,
  locale: 'zh-CN' as const,
}

describe('web login experience', () => {
  it('starts the background motion and lets the user pause it', async () => {
    const wrapper = mount(WebLoginExperience, { props: readyProps })

    expect(wrapper.find('.route-flow').exists()).toBe(true)
    expect(wrapper.get('.web-login-experience').classes()).not.toContain('motion-paused')

    await wrapper.get('.motion-toggle').trigger('click')
    expect(wrapper.get('.web-login-experience').classes()).toContain('motion-paused')

    await wrapper.get('.motion-toggle').trigger('click')
    expect(wrapper.get('.web-login-experience').classes()).not.toContain('motion-paused')
  })

  it('emits theme and language changes before login', async () => {
    const wrapper = mount(WebLoginExperience, { props: readyProps })

    await wrapper.get('[data-skin="google"]').trigger('click')
    await wrapper.get('[data-locale="en-US"]').trigger('click')

    expect(wrapper.emitted('changeSkin')).toEqual([['google']])
    expect(wrapper.emitted('changeLocale')).toEqual([['en-US']])
  })

  it('covers the QR code with the waiting state after scanning', () => {
    const wrapper = mount(WebLoginExperience, {
      props: {
        ...readyProps,
        state: 'scanned',
        statusText: '已扫码，请在小程序中确认',
      },
    })

    expect(wrapper.get('.wechat-login-code').classes()).toContain('is-scanned')
    expect(wrapper.find('.scan-waiting-state').exists()).toBe(true)
  })
})
