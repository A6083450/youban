export interface MiniProgramNavigationBridge {
  navigateTo(options: { url: string; success?: () => void; fail?: () => void }): void
  reLaunch(options: { url: string; success?: () => void; fail?: () => void }): void
}

interface WechatWebViewSdk {
  miniProgram?: MiniProgramNavigationBridge
  openLocation?: (options: {
    latitude: number
    longitude: number
    name?: string
    address?: string
    scale?: number
  }) => void
}

declare global {
  interface Window {
    __wxjs_environment?: string
    wx?: WechatWebViewSdk
  }
}

type SearchLocation = Pick<Location, 'search'>

type NavigationColorLocation = Pick<Location, 'pathname' | 'search'>

export type MobileHeaderVariant = 'private' | 'public' | 'hidden'

export interface MobileHeaderState {
  variant: MobileHeaderVariant
  showMenu: boolean
  showHome: boolean
  showNewPlan: boolean
  showAccount: boolean
}

const ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const WEB_VIEW_ROUTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const WEB_VIEW_SHARE_PATTERN = /^[A-Fa-f0-9]{32}$/
const WEB_VIEW_SECTIONS = new Set(['today', 'overview', 'days', 'map', 'budget', 'weather'])

const currentLocation = (): SearchLocation =>
  typeof window === 'undefined' ? { search: '' } : window.location

export function isMiniProgramEmbedded(
  location: SearchLocation = currentLocation(),
  environment = typeof window === 'undefined' ? '' : window.__wxjs_environment,
): boolean {
  const host = new URLSearchParams(location.search).get('host')
  return host === 'miniprogram' || environment === 'miniprogram'
}

export function shouldRegisterPwa(location: SearchLocation = currentLocation()): boolean {
  return !isMiniProgramEmbedded(location)
}

export function resolveMobileHeaderState(routeName: string, embedded: boolean): MobileHeaderState {
  if (routeName === 'ChatHome' || routeName === 'PlanView') {
    return {
      variant: 'private',
      showMenu: true,
      showHome: false,
      showNewPlan: true,
      showAccount: true,
    }
  }
  if (routeName === 'Share' || routeName === 'Privacy') {
    return {
      variant: 'public',
      showMenu: false,
      showHome: !embedded,
      showNewPlan: false,
      showAccount: false,
    }
  }
  return {
    variant: 'hidden',
    showMenu: false,
    showHome: false,
    showNewPlan: false,
    showAccount: false,
  }
}

export function resolveDocumentTitle(embedded: boolean, brand: string, fullTitle: string): string {
  return embedded ? brand : fullTitle
}

export function syncMiniProgramNavigationColor(
  color: string,
  location: NavigationColorLocation = window.location,
  environment = typeof window === 'undefined' ? '' : window.__wxjs_environment,
  bridge: MiniProgramNavigationBridge | undefined = miniProgramNavigationBridge(),
): boolean {
  const normalized = color.trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(normalized) || !isMiniProgramEmbedded(location, environment) || !bridge) return false
  const queryColor = normalized.slice(1)
  const currentQuery = new URLSearchParams(location.search)
  if (currentQuery.get('mini_nav')?.toLowerCase() === queryColor) return false

  const launchQuery = new URLSearchParams({ nav_color: queryColor })
  const planMatch = location.pathname.match(/^\/plan\/([A-Za-z0-9_-]{1,128})$/)
  const shareMatch = location.pathname.match(/^\/share\/([A-Fa-f0-9]{32})$/)
  if (planMatch && WEB_VIEW_ROUTE_ID_PATTERN.test(planMatch[1]!)) {
    launchQuery.set('plan_id', planMatch[1]!)
    const section = currentQuery.get('section') || ''
    if (WEB_VIEW_SECTIONS.has(section)) launchQuery.set('section', section)
  } else if (shareMatch && WEB_VIEW_SHARE_PATTERN.test(shareMatch[1]!)) {
    launchQuery.set('share', shareMatch[1]!)
  } else if (location.pathname === '/privacy') {
    launchQuery.set('path', '/privacy')
  } else if (location.pathname === '/') {
    const conversation = currentQuery.get('conversation') || ''
    if (WEB_VIEW_ROUTE_ID_PATTERN.test(conversation)) launchQuery.set('conversation', conversation)
  }

  bridge.reLaunch({ url: `/pages/web/index?${launchQuery.toString()}` })
  return true
}

export function nativeActionPageUrl(actionId: string): string {
  const normalized = actionId.trim()
  if (!ACTION_ID_PATTERN.test(normalized)) throw new Error('动作票据无效')
  return `/pages/native-action/index?action_id=${encodeURIComponent(normalized)}`
}

export function nativeAccountActionPageUrl(mode: 'avatar' | 'logout'): string {
  return `/pages/native-action/index?mode=${mode}`
}

export function miniProgramNavigationBridge(): MiniProgramNavigationBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.wx?.miniProgram
}

export function navigateToNativeAction(
  actionId: string,
  bridge: MiniProgramNavigationBridge | undefined = miniProgramNavigationBridge(),
): boolean {
  if (!bridge) return false
  bridge.navigateTo({ url: nativeActionPageUrl(actionId) })
  return true
}

export function navigateToNativeAccountAction(
  mode: 'avatar' | 'logout',
  bridge: MiniProgramNavigationBridge | undefined = miniProgramNavigationBridge(),
): boolean {
  if (!bridge) return false
  bridge.navigateTo({ url: nativeAccountActionPageUrl(mode) })
  return true
}

export function reLaunchMiniProgramLogin(
  bridge: MiniProgramNavigationBridge | undefined = miniProgramNavigationBridge(),
): boolean {
  if (!bridge) return false
  bridge.reLaunch({ url: '/pages/login/index' })
  return true
}

export function openWechatLocation(
  location: { latitude: number; longitude: number; name?: string; address?: string },
  sdk: WechatWebViewSdk | undefined = typeof window === 'undefined' ? undefined : window.wx,
): boolean {
  if (!sdk?.openLocation || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    return false
  }
  sdk.openLocation({ ...location, scale: 16 })
  return true
}

export async function prepareMiniProgramWebView(): Promise<void> {
  if (!isMiniProgramEmbedded() || typeof document === 'undefined') return
  document.documentElement.dataset.host = 'miniprogram'
  if (!window.wx) {
    await new Promise<void>((resolve) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-youban-wechat-sdk]')
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => resolve(), { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'
      script.dataset.youbanWechatSdk = 'true'
      script.onload = () => resolve()
      script.onerror = () => resolve()
      document.head.appendChild(script)
    })
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.allSettled(registrations.map((registration) => registration.unregister()))
  }
}
