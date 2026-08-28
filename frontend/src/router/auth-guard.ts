interface RouteIdentity {
  name?: unknown
  path: string
}

export type AuthRouteDecision = 'allow' | 'home' | 'login'

export function shouldRestoreAuthentication(route: RouteIdentity): boolean {
  return !(
    route.path.startsWith('/admin')
    || route.name === 'Share'
    || route.name === 'Privacy'
  )
}

export function authRouteDecision(
  route: RouteIdentity,
  authenticated: boolean,
  hasAdminSession: boolean,
): AuthRouteDecision {
  const adminViewingPlan = route.path.startsWith('/plan/') && hasAdminSession
  if (!shouldRestoreAuthentication(route) || adminViewingPlan) return 'allow'
  if (!authenticated && route.path !== '/login') return 'login'
  if (authenticated && route.path === '/login') return 'home'
  return 'allow'
}
