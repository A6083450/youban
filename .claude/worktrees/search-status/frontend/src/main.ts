import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './styles/global.css'
import App from './App.vue'
import ChatHome from './views/ChatHome.vue'
import PlanView from './views/PlanView.vue'
import { i18n } from './i18n'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'ChatHome', component: ChatHome },
    { path: '/plan/:id', name: 'PlanView', component: PlanView, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

const app = createApp(App)

app.use(router)
app.use(Antd)
app.use(i18n)

app.mount('#app')
