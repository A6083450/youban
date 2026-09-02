<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { onMounted } from 'vue'
import { navigateToInterceptor } from '@/router/interceptor'
import { authRouteDecision, HOME_ROUTE, isPublicRoute, LOGIN_ROUTE } from '@/router/auth-guard'
import { h5LaunchUrl, normalizedPagePath, waitForInitialPage } from '@/router/launch-route'
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'

const preferences = usePreferencesStore()
let appMounted = false
let initialSynchronizationDone = false
let latestShowOptions: Parameters<Parameters<typeof onShow>[0]>[0] | undefined

onLaunch(() => {
  void preferences.sync()
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
  const auth = useAuthStore()
  if (!isPublicRoute(path))
    await auth.restore()
  await preferences.sync()
  const decision = authRouteDecision(path, auth.ready)
  if (decision === 'login') {
    await relaunch(LOGIN_ROUTE)
    return
  }
  if (decision === 'home') {
    await relaunch(HOME_ROUTE)
    return
  }
  const currentPath = normalizedPagePath(getCurrentPages().at(-1)?.route)
  if (currentPath !== path) {
    await relaunch(launchUrl)
    return
  }
  navigateToInterceptor.invoke({ url: launchUrl, query: options?.query })
}

onShow((options) => {
  latestShowOptions = options
  if (appMounted && initialSynchronizationDone)
    void synchronizeLaunchRoute(options)
})

onMounted(() => {
  appMounted = true
  void waitForInitialPage().then(() => synchronizeLaunchRoute(latestShowOptions)).finally(() => {
    initialSynchronizationDone = true
  })
})
onHide(() => undefined)
</script>

<style lang="scss">

</style>
