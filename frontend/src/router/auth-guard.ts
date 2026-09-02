import type { UserInfoDto } from '@youban/contracts'

export const LOGIN_ROUTE = '/pages/login/index'
export const HOME_ROUTE = '/pages/index/index'

const PUBLIC_ROUTES = [
  LOGIN_ROUTE,
  '/pages/privacy/index',
  '/pages/share/index',
  '/pages/admin/index',
  '/pages/web-login/index',
] as const

function pathname(route: string): string {
  const path = route.split(/[?#]/, 1)[0] || '/'
  return path === '/' ? HOME_ROUTE : path
}

export function isPublicRoute(route: string): boolean {
  const path = pathname(route)
  return PUBLIC_ROUTES.some(publicPath => path === publicPath || path.startsWith(`${publicPath}/`))
}

export function isLoginReady(user: UserInfoDto | null | undefined): user is UserInfoDto {
  return Boolean(user?.user_id && user.profile_complete)
}

export type AuthRouteDecision = 'allow' | 'home' | 'login'

export function authRouteDecision(route: string, authenticated: boolean): AuthRouteDecision {
  const path = pathname(route)
  if (path === LOGIN_ROUTE && authenticated)
    return 'home'
  if (isPublicRoute(path))
    return 'allow'
  return authenticated ? 'allow' : 'login'
}
