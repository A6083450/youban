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
import { currentUser, restoreSession } from './stores/auth'
import { initializeSkin } from './stores/skin'
import { hasAdminSession } from './services/api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'Login', component: () => import('./views/LoginView.vue') },
    { path: '/', name: 'ChatHome', component: () => import('./views/ChatHome.vue') },
    { path: '/plan/:id', name: 'PlanView', component: () => import('./views/PlanView.vue'), props: true },
    { path: '/share/:id', name: 'Share', component: () => import('./views/ShareView.vue'), props: true },
    { path: '/admin', name: 'Admin', component: () => import('./views/AdminView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach((to) => {
  const isAdmin = to.path.startsWith('/admin')
  const isPublicShare = to.name === 'Share'
  // 管理员(持后台会话)可从后台直接查看任意用户的计划详情,无需普通用户登录
  const adminViewingPlan = to.path.startsWith('/plan/') && hasAdminSession()
  if (!currentUser.value && to.path !== '/login' && !isAdmin && !isPublicShare && !adminViewingPlan) {
    return { path: '/login' }
  }
  if (currentUser.value && to.path === '/login') {
    return { path: '/' }
  }
  return true
})

const app = createApp(App)

app.use(router)
app.use(Antd)
app.use(i18n)

restoreSession()
initializeSkin()

app.mount('#app')
