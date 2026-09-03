<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { navigateToInterceptor } from '@/router/interceptor'
import { currentPlatform } from '@/platform/auth'
import { authRouteDecision, HOME_ROUTE, isPublicRoute, LOGIN_ROUTE } from '@/router/auth-guard'
import { h5LaunchUrl, normalizedPagePath, waitForInitialPage } from '@/router/launch-route'
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'

const preferences = usePreferencesStore()
let initialSynchronizationStarted = false
let initialSynchronizationDone = false
let latestShowOptions: Parameters<Parameters<typeof onShow>[0]>[0] | undefined

onLaunch((options) => {
  latestShowOptions = options
  void preferences.sync()
  if (initialSynchronizationStarted)
    return
  initialSynchronizationStarted = true
  void waitForInitialPage().then(() => synchronizeLaunchRoute(latestShowOptions)).finally(() => {
    initialSynchronizationDone = true
  })
})

function relaunch(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.reLaunch({
      url,
      success: () => resolve(),
      fail: error => reject(new Error(error.errMsg || `reLaunch failed: ${url}`)),
    })
  })
}

async function synchronizeLaunchRoute(options: typeof latestShowOptions): Promise<void> {
  let launchUrl = options?.path ? `/${options.path}` : HOME_ROUTE
  // #ifdef H5
  const stagedLaunchUrl = window.__YOUBAN_H5_LAUNCH_URL__ || ''
  delete window.__YOUBAN_H5_LAUNCH_URL__
  launchUrl = h5LaunchUrl(window.location.hash, stagedLaunchUrl) || launchUrl
  // #endif
  const path = normalizedPagePath(launchUrl) || HOME_ROUTE
  const allowAnonymousHome = currentPlatform() === 'mp-weixin'
  const auth = useAuthStore()
  if (!isPublicRoute(path, allowAnonymousHome))
    await auth.restore()
  await preferences.sync()
  const currentPath = normalizedPagePath(getCurrentPages().at(-1)?.route)
  const decision = authRouteDecision(path, auth.ready, allowAnonymousHome)
  if (decision === 'login') {
    if (currentPath !== LOGIN_ROUTE)
      await relaunch(LOGIN_ROUTE)
    return
  }
  if (decision === 'home') {
    if (currentPath !== HOME_ROUTE)
      await relaunch(HOME_ROUTE)
    return
  }
  if (allowAnonymousHome && path === HOME_ROUTE && currentPath === LOGIN_ROUTE)
    return
  if (currentPath !== path) {
    await relaunch(launchUrl)
    return
  }
  navigateToInterceptor.invoke({ url: launchUrl, query: options?.query })
}

onShow((options) => {
  latestShowOptions = options
  if (initialSynchronizationDone)
    void synchronizeLaunchRoute(options)
})
onHide(() => undefined)
</script>

<style lang="scss">

</style>
