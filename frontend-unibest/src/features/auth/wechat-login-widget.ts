import type { WechatWebLoginStartDto } from '@youban/contracts'

export interface WechatLoginWidgetOptions {
  id: string
  appid: string
  scope: 'snsapi_login'
  redirect_uri: string
  state: string
  style: 'black'
  self_redirect: true
}

declare global {
  interface Window {
    WxLogin?: new (options: WechatLoginWidgetOptions) => unknown
  }
}

const WECHAT_LOGIN_SCRIPT_URL = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js'
const WECHAT_LOGIN_SCRIPT_ATTRIBUTE = 'data-youban-wechat-login'
let scriptLoadPromise: Promise<void> | null = null

export function buildWechatLoginOptions(
  containerId: string,
  configuration: WechatWebLoginStartDto,
): WechatLoginWidgetOptions {
  return {
    id: containerId,
    appid: configuration.app_id,
    scope: 'snsapi_login',
    redirect_uri: encodeURIComponent(configuration.redirect_uri),
    state: configuration.state,
    style: 'black',
    self_redirect: true,
  }
}

function loadWechatLoginScript(): Promise<void> {
  if (typeof window.WxLogin === 'function')
    return Promise.resolve()
  if (scriptLoadPromise)
    return scriptLoadPromise

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[${WECHAT_LOGIN_SCRIPT_ATTRIBUTE}]`)
    const created = !script
    if (!script) {
      script = document.createElement('script')
      script.src = WECHAT_LOGIN_SCRIPT_URL
      script.async = true
      script.setAttribute(WECHAT_LOGIN_SCRIPT_ATTRIBUTE, '')
    }

    script.addEventListener('load', () => {
      if (typeof window.WxLogin !== 'function') {
        script?.remove()
        reject(new Error('微信登录组件加载失败'))
        return
      }
      resolve()
    }, { once: true })
    script.addEventListener('error', () => {
      script?.remove()
      reject(new Error('微信登录组件加载失败'))
    }, { once: true })
    if (created)
      document.head.append(script)
  }).catch((error) => {
    scriptLoadPromise = null
    throw error
  })

  return scriptLoadPromise
}

export async function mountWechatLoginWidget(
  containerId: string,
  configuration: WechatWebLoginStartDto,
): Promise<void> {
  if (!document.getElementById(containerId))
    throw new Error('微信登录组件容器不存在')
  await loadWechatLoginScript()
  const WxLogin = window.WxLogin
  if (typeof WxLogin !== 'function')
    throw new Error('微信登录组件加载失败')
  const widget = new WxLogin(buildWechatLoginOptions(containerId, configuration))
  void widget
}
