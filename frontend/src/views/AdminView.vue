<template>
  <div class="admin-page">
    <div v-if="!loggedIn" class="admin-login-wrap">
      <div class="admin-login-card">
        <div class="admin-brand">{{ t('app.brand') }}</div>
        <h1 class="admin-title">{{ t('admin.loginTitle') }}</h1>
        <a-form layout="vertical" @submit.prevent>
          <a-form-item :label="t('admin.passwordLabel')">
            <a-input-password
              v-model:value="password"
              :placeholder="t('admin.passwordPlaceholder')"
              size="large"
              @pressEnter="doLogin"
            />
          </a-form-item>
          <a-button
            type="primary"
            size="large"
            block
            :loading="loggingIn"
            @click="doLogin"
          >
            {{ t('admin.login') }}
          </a-button>
        </a-form>
        <router-link to="/" class="admin-back-link">{{ t('admin.backHome') }}</router-link>
      </div>
    </div>

    <div v-else class="admin-main">
      <header class="admin-header">
        <div class="admin-header-left">
          <span class="admin-brand">{{ t('app.brand') }}</span>
          <span class="admin-header-divider" aria-hidden="true">/</span>
          <span class="admin-header-title">{{ t('admin.title') }}</span>
        </div>
        <div class="admin-header-actions">
          <router-link to="/" class="admin-back-link">{{ t('admin.backHome') }}</router-link>
          <a-button size="small" @click="doLogout">{{ t('admin.logout') }}</a-button>
        </div>
      </header>

      <div class="admin-shell">
        <AdminNavigation :active-section="activeSection" @select="selectSection" />
        <main class="admin-workspace">
          <AdminRuntimeSettingsPanel
            v-show="activeSection === 'settings'"
            :on-unauthorized="handleUnauthorized"
          />
          <section
            v-show="activeSection === 'skills'"
            class="admin-skills-placeholder"
            aria-labelledby="admin-skills-title"
          >
            <h1 id="admin-skills-title" class="admin-panel-title">{{ t('admin.navigation.skills') }}</h1>
          </section>
          <AdminTripsPanel
            v-show="activeSection === 'trips'"
            :on-unauthorized="handleUnauthorized"
          />
        </main>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import AdminNavigation from '@/components/admin/AdminNavigation.vue'
import AdminRuntimeSettingsPanel from '@/components/admin/AdminRuntimeSettingsPanel.vue'
import AdminTripsPanel from '@/components/admin/AdminTripsPanel.vue'
import {
  readStoredAdminSection,
  storeAdminSection,
} from '@/admin/navigation'
import type { AdminSection } from '@/admin/navigation'
import {
  adminLogin,
  clearAdminToken,
  hasAdminSession,
  isAdminAuthError,
} from '@/services/api'

const { t } = useI18n()
const loggedIn = ref(false)
const password = ref('')
const loggingIn = ref(false)

const sessionStorageOrNull = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

const activeSection = ref<AdminSection>(readStoredAdminSection(sessionStorageOrNull()))

const selectSection = (section: AdminSection) => {
  activeSection.value = section
  storeAdminSection(section, sessionStorageOrNull())
}

const backToLogin = () => {
  clearAdminToken()
  loggedIn.value = false
  password.value = ''
}

const handleUnauthorized = () => {
  if (!loggedIn.value) return
  message.warning(t('admin.sessionExpired'))
  backToLogin()
}

const doLogin = async () => {
  if (loggingIn.value) return
  loggingIn.value = true
  try {
    await adminLogin(password.value)
    loggedIn.value = true
    password.value = ''
  } catch (error: any) {
    message.error(isAdminAuthError(error) ? t('admin.wrongPassword') : error?.message || t('admin.loginFailed'))
  } finally {
    loggingIn.value = false
  }
}

const doLogout = () => {
  backToLogin()
}

onMounted(() => {
  if (hasAdminSession()) {
    loggedIn.value = true
  }
})
</script>

<style scoped>
.admin-page {
  min-height: 100vh;
  background: #faf9f5;
  color: #3d3229;
}

.admin-login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
}

.admin-login-card {
  width: 100%;
  max-width: 380px;
  padding: 32px 28px 24px;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 32px rgba(61, 50, 41, 0.06);
  text-align: center;
}

.admin-brand {
  color: #c4603d;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0;
}

.admin-title {
  margin: 10px 0 22px;
  color: #3d3229;
  font-size: 22px;
  font-weight: 700;
}

.admin-login-card :deep(.ant-form-item-label > label) {
  color: rgba(61, 50, 41, 0.75);
}

.admin-back-link {
  display: inline-block;
  margin-top: 16px;
  color: rgba(61, 50, 41, 0.62);
  font-size: 13px;
  text-decoration: none;
}

.admin-back-link:hover {
  color: #a94d2e;
}

.admin-back-link:focus-visible {
  outline: 3px solid rgba(196, 96, 61, 0.45);
  outline-offset: 3px;
}

.admin-main {
  width: 100%;
  max-width: 1480px;
  margin: 0 auto;
  padding: 20px 24px 48px;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 0 4px 16px;
}

.admin-header-left,
.admin-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.admin-header-divider {
  color: rgba(61, 50, 41, 0.3);
}

.admin-header-title {
  color: rgba(61, 50, 41, 0.75);
  font-size: 15px;
  font-weight: 600;
}

.admin-header-actions .admin-back-link {
  margin-top: 0;
}

.admin-shell {
  display: flex;
  align-items: stretch;
  min-height: calc(100vh - 136px);
  border: 1px solid rgba(61, 50, 41, 0.1);
  background: #fff;
}

.admin-workspace {
  min-width: 0;
  flex: 1;
  padding: 32px 36px 48px;
}

.admin-skills-placeholder {
  width: 100%;
}

.admin-panel-title {
  margin: 0;
  color: #3d3229;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
}

@media (max-width: 760px) {
  .admin-main {
    padding: 12px 0 32px;
  }

  .admin-header {
    min-height: 56px;
    padding: 0 14px 12px;
  }

  .admin-header-left {
    min-width: 0;
  }

  .admin-header-title,
  .admin-header-divider {
    display: none;
  }

  .admin-header-actions {
    gap: 8px;
  }

  .admin-header-actions .admin-back-link {
    font-size: 12px;
  }

  .admin-shell {
    display: block;
    min-height: calc(100vh - 68px);
    border-right: 0;
    border-left: 0;
  }

  .admin-workspace {
    padding: 24px 16px 36px;
  }

  .admin-panel-title {
    font-size: 20px;
  }
}

@media (max-width: 350px) {
  .admin-brand {
    font-size: 16px;
  }

  .admin-header-actions .admin-back-link {
    display: none;
  }

  .admin-workspace {
    padding-right: 12px;
    padding-left: 12px;
  }
}
</style>
