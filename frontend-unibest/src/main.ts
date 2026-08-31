import { createSSRApp } from 'vue'
import App from './App.vue'
import { routeInterceptor } from './router/interceptor'
import { stageH5LaunchRoute } from './router/launch-route'

import store from './store'
import '@/style/index.scss'
import 'virtual:uno.css'
import i18n from './locale/index'

// #ifdef H5
const stagedLaunchRoute = stageH5LaunchRoute(window.location.hash)
if (stagedLaunchRoute) {
  window.__YOUBAN_H5_LAUNCH_URL__ = stagedLaunchRoute.launchUrl
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${stagedLaunchRoute.bootstrapHash}`,
  )
}
// #endif

export function createApp() {
  const app = createSSRApp(App)
  app.use(store)
  app.use(routeInterceptor)
  app.use(i18n)

  return {
    app,
  }
}
