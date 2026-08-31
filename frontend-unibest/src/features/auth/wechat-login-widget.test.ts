import { beforeEach, describe, expect, it, vi } from 'vitest'

const configuration = {
  app_id: 'wx-web-app',
  scope: 'snsapi_login' as const,
  redirect_uri: 'https://youban.me/api/v2/auth/wechat-web/callback',
  state: 'opaque-state-with-at-least-32-bytes',
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="wechat-login-container"></div>'
  delete (window as Window & { WxLogin?: unknown }).WxLogin
  vi.resetModules()
})

describe('official WeChat login widget', () => {
  it('builds only official website widget options', async () => {
    const { buildWechatLoginOptions } = await import('./wechat-login-widget')

    expect(buildWechatLoginOptions('wechat-login-container', configuration)).toEqual({
      id: 'wechat-login-container',
      appid: 'wx-web-app',
      scope: 'snsapi_login',
      redirect_uri: encodeURIComponent('https://youban.me/api/v2/auth/wechat-web/callback'),
      state: 'opaque-state-with-at-least-32-bytes',
      style: 'black',
      self_redirect: true,
    })
  })

  it('loads the official script once for concurrent mounts', async () => {
    const widgetOptions: unknown[] = []
    const { mountWechatLoginWidget } = await import('./wechat-login-widget')
    const first = mountWechatLoginWidget('wechat-login-container', configuration)
    const second = mountWechatLoginWidget('wechat-login-container', configuration)
    const scripts = document.querySelectorAll('script[src="https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js"]')
    expect(scripts).toHaveLength(1)

    Object.defineProperty(window, 'WxLogin', {
      value: class {
        constructor(options: unknown) {
          widgetOptions.push(options)
        }
      },
      configurable: true,
    })
    scripts[0]!.dispatchEvent(new Event('load'))

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(widgetOptions).toHaveLength(2)
  })

  it('rejects a failed official script load and permits a later retry', async () => {
    const { mountWechatLoginWidget } = await import('./wechat-login-widget')
    const mounting = mountWechatLoginWidget('wechat-login-container', configuration)
    const script = document.querySelector('script[data-youban-wechat-login]')
    script!.dispatchEvent(new Event('error'))

    await expect(mounting).rejects.toThrow('微信登录组件加载失败')
    expect(document.querySelector('script[data-youban-wechat-login]')).toBeNull()
  })
})
