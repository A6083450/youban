import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import 'element-plus/dist/index.css'
import 'vue-element-plus-x/styles/index.css'
import 'x-markdown-vue/style'
import './styles/global.css'
import './styles/theme.css'
import App from './App.vue'
import { i18n } from './i18n'
import { currentUser, ensureSessionRestored, invalidateSession, isLoginReady } from './stores/auth'
import { initializeSkin } from './stores/skin'
import { syncAccountPreferences } from './stores/account-preferences'
import { AUTH_EXPIRED_EVENT, hasAdminSession } from './services/api'
import { authRouteDecision, shouldRestoreAuthentication } from './router/auth-guard'
import {
  isMiniProgramEmbedded,
  prepareMiniProgramWebView,
  reLaunchMiniProgramLogin,
  shouldRegisterPwa,
} from './platform/miniProgramHost'

const embeddedMiniProgram = isMiniProgramEmbedded()
if (embeddedMiniProgram) void prepareMiniProgramWebView()

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'Login', component: () => import('./views/LoginView.vue') },
    { path: '/', name: 'ChatHome', component: () => import('./views/ChatHome.vue') },
    { path: '/plan/:id', name: 'PlanView', component: () => import('./views/PlanView.vue'), props: true },
    { path: '/share/:id', name: 'Share', component: () => import('./views/ShareView.vue'), props: true },
    { path: '/privacy', name: 'Privacy', component: () => import('./views/PrivacyView.vue') },
    { path: '/admin', name: 'Admin', component: () => import('./views/AdminView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach(async (to) => {
  if (shouldRestoreAuthentication(to)) await ensureSessionRestored()
  const decision = authRouteDecision(to, isLoginReady(currentUser.value), hasAdminSession())
  if (decision === 'login') {
    if (embeddedMiniProgram && reLaunchMiniProgramLogin()) return false
    return { path: '/login' }
  }
  if (decision === 'home') return { path: '/' }
  return true
})

const app = createApp(App)

window.addEventListener(AUTH_EXPIRED_EVENT, () => {
  invalidateSession()
  if (shouldRestoreAuthentication(router.currentRoute.value)) {
    if (embeddedMiniProgram && reLaunchMiniProgramLogin()) return
    void router.replace('/login')
  }
})

app.use(router)
app.use(Antd)
app.use(i18n)

initializeSkin()
void router.isReady().then(async () => {
  if (!shouldRestoreAuthentication(router.currentRoute.value)) return
  await ensureSessionRestored()
  if (isLoginReady(currentUser.value)) await syncAccountPreferences()
})

app.mount('#app')

if (shouldRegisterPwa()) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}
