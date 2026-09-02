<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AdminRuntimeSettings from '@/components/admin/AdminRuntimeSettings.vue'
import AdminSkills from '@/components/admin/AdminSkills.vue'
import AdminTrips from '@/components/admin/AdminTrips.vue'
import { adminLogin, adminLogout, getAdminToken } from '@/services/admin'
import type { AdminSection } from '@/services/admin'
import { usePreferencesStore } from '@/store/preferences'

definePage({
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '后台管理',
  },
})

const { t } = useI18n()
const preferences = usePreferencesStore()
const loggedIn = ref(Boolean(getAdminToken()))
const loggingIn = ref(false)
const password = ref('')
const activeSection = ref<AdminSection>('settings')
const sections: Array<{ id: AdminSection, icon: string, labelKey: string }> = [
  { id: 'settings', icon: 'setting', labelKey: 'admin.navigation.settings' },
  { id: 'skills', icon: 'tools', labelKey: 'admin.navigation.skills' },
  { id: 'trips', icon: 'list', labelKey: 'admin.navigation.trips' },
]

async function login(): Promise<void> {
  if (loggingIn.value)
    return
  loggingIn.value = true
  try {
    await adminLogin(password.value)
    loggedIn.value = true
    password.value = ''
  }
  catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : t('admin.loginFailed'), icon: 'none' })
  }
  finally {
    loggingIn.value = false
  }
}

function logout(): void {
  adminLogout()
  loggedIn.value = false
  password.value = ''
}

function unauthorized(): void {
  logout()
  uni.showToast({ title: t('admin.sessionExpired'), icon: 'none' })
}

function goHome(): void {
  uni.reLaunch({ url: '/pages/index/index' })
}

onLoad(() => void preferences.sync())
</script>

<template>
  <view class="admin-page" :class="preferences.themeClass">
    <view v-if="!loggedIn" class="login-shell">
      <view class="login-panel">
        <text class="brand">{{ t('app.brand') }}</text>
        <text class="login-title">{{ t('admin.loginTitle') }}</text>
        <label class="password-control"><text>{{ t('admin.passwordLabel') }}</text><input v-model="password" password :placeholder="t('admin.passwordPlaceholder')" confirm-type="done" @confirm="login"></label>
        <button class="login-command" :disabled="loggingIn || !password" @click="login">
          {{ loggingIn ? t('admin.loading') : t('admin.login') }}
        </button>
        <button class="home-link" @click="goHome">
          {{ t('admin.backHome') }}
        </button>
      </view>
    </view>

    <template v-else>
      <header class="admin-header">
        <view class="header-brand">
          <strong>{{ t('app.brand') }}</strong><text>/</text><text>{{ t('admin.title') }}</text>
        </view>
        <view class="header-actions">
          <button @click="goHome">
            {{ t('admin.backHome') }}
          </button><button @click="logout">
            {{ t('admin.logout') }}
          </button>
        </view>
      </header>
      <view class="admin-shell">
        <aside class="admin-navigation" :aria-label="t('admin.navigation.label')">
          <button v-for="section in sections" :key="section.id" :class="{ active: activeSection === section.id }" @click="activeSection = section.id">
            <wd-icon :name="section.icon" size="17px" /><text>{{ t(section.labelKey) }}</text>
          </button>
        </aside>
        <main class="admin-workspace">
          <AdminRuntimeSettings v-if="activeSection === 'settings'" @unauthorized="unauthorized" />
          <AdminSkills v-else-if="activeSection === 'skills'" @unauthorized="unauthorized" />
          <AdminTrips v-else @unauthorized="unauthorized" />
        </main>
      </view>
    </template>
  </view>
</template>

<style scoped>
.admin-page {
  box-sizing: border-box;
  min-height: 100vh;
  background: var(--surface-page);
  color: var(--text-primary);
}
.login-shell {
  display: grid;
  box-sizing: border-box;
  min-height: 100vh;
  padding: 24px;
  place-items: center;
}
.login-panel {
  display: flex;
  box-sizing: border-box;
  width: min(380px, 100%);
  padding: 30px 28px 24px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  box-shadow: 0 8px 32px rgba(61, 50, 41, 0.06);
  flex-direction: column;
}
.brand {
  color: var(--accent-strong);
  font-size: 18px;
  font-weight: 800;
  text-align: center;
}
.login-title {
  margin: 9px 0 22px;
  font-size: 22px;
  font-weight: 750;
  text-align: center;
}
.password-control {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
}
.password-control input {
  box-sizing: border-box;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-page);
  color: var(--text-primary);
}
.login-command,
.home-link,
.header-actions button,
.admin-navigation button {
  box-sizing: border-box;
  margin: 0;
}
.login-command::after,
.home-link::after,
.header-actions button::after,
.admin-navigation button::after {
  display: none;
}
.login-command {
  min-height: 42px;
  margin-top: 18px;
  border: 0;
  border-radius: 6px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 14px;
}
.home-link {
  margin-top: 12px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}
.admin-header {
  display: flex;
  box-sizing: border-box;
  max-width: 1480px;
  min-height: 58px;
  margin: 0 auto;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border-subtle);
  align-items: center;
  justify-content: space-between;
}
.header-brand,
.header-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.header-brand strong {
  color: var(--accent-strong);
}
.header-brand text {
  color: var(--text-secondary);
  font-size: 13px;
}
.header-actions button {
  padding: 5px 8px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}
.admin-shell {
  display: grid;
  box-sizing: border-box;
  max-width: 1480px;
  margin: 0 auto;
  padding: 20px 24px 48px;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 24px;
}
.admin-navigation {
  display: flex;
  align-self: start;
  padding-right: 18px;
  border-right: 1px solid var(--border-subtle);
  flex-direction: column;
  gap: 5px;
}
.admin-navigation button {
  display: flex;
  min-height: 40px;
  padding: 9px 11px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
}
.admin-navigation button.active {
  background: var(--surface-soft);
  color: var(--accent-strong);
  font-weight: 700;
}
.admin-workspace {
  min-width: 0;
}
@media (max-width: 760px) {
  .admin-header {
    padding: 10px 14px;
  }
  .header-brand text:nth-child(2),
  .header-actions button:first-child {
    display: none;
  }
  .admin-shell {
    padding: 14px;
    grid-template-columns: 1fr;
  }
  .admin-navigation {
    overflow-x: auto;
    padding: 0 0 10px;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-direction: row;
  }
  .admin-navigation button {
    min-width: 120px;
  }
  .admin-workspace {
    padding-top: 6px;
  }
}
</style>
