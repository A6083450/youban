import type { Router } from 'vue-router'
import { authRouteDecision, HOME_ROUTE, isPublicRoute, LOGIN_ROUTE } from './auth-guard'
import { useAuthStore } from '@/store/auth'

export const permission = {
  install(router: Router) {
    router.beforeEach(async (to) => {
      const auth = useAuthStore()
      if (!isPublicRoute(to.path))
        await auth.restore()
      const decision = authRouteDecision(to.path, auth.ready)
      if (decision === 'login')
        return { path: LOGIN_ROUTE, replace: true }
      if (decision === 'home')
        return { path: HOME_ROUTE, replace: true }
      return true
    })
  },
}
