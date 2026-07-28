import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './styles/global.css'
import App from './App.vue'
import ChatHome from './views/ChatHome.vue'
import PlanView from './views/PlanView.vue'
import ShareView from './views/ShareView.vue'
import AdminView from './views/AdminView.vue'
import LoginView from './views/LoginView.vue'
import { i18n } from './i18n'
import { currentUser, restoreSession } from './stores/auth'
import { hasAdminSession } from './services/api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'Login', component: LoginView },
    { path: '/', name: 'ChatHome', component: ChatHome },
    { path: '/plan/:id', name: 'PlanView', component: PlanView, props: true },
    { path: '/share/:id', name: 'Share', component: ShareView, props: true },
    { path: '/admin', name: 'Admin', component: AdminView },
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

app.mount('#app')
