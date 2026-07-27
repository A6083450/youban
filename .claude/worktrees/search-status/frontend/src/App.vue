<template>
  <div id="app">
    <aside class="sidebar">
      <div class="sidebar-header">
        <router-link to="/" class="sidebar-brand">{{ t('app.brand') }}</router-link>
      </div>

      <div class="sidebar-new">
        <button type="button" class="new-plan-btn" @click="goNewPlan">
          <span class="new-plan-plus">+</span>
          <span>{{ t('sidebar.newPlan') }}</span>
        </button>
      </div>

      <div class="sidebar-section-title">{{ t('sidebar.plans') }}</div>
      <div class="sidebar-list">
        <div v-if="plansLoading" class="sidebar-hint">{{ t('common.loading') }}</div>
        <div v-else-if="plans.length === 0" class="sidebar-hint">{{ t('sidebar.empty') }}</div>
        <button
          v-for="item in plans"
          :key="item.plan_id"
          type="button"
          class="sidebar-item"
          :class="{ active: activePlanId === item.plan_id }"
          @click="openPlan(item.plan_id)"
        >
          <span class="sidebar-item-city">{{ item.city }}</span>
          <span class="sidebar-item-date">
            {{ item.start_date }} ~ {{ item.end_date }}
            <span v-if="item.status === 'processing'" class="sidebar-item-badge processing">{{ t('sidebar.processing') }}</span>
            <span v-else-if="item.status === 'failed'" class="sidebar-item-badge failed">{{ t('sidebar.failed') }}</span>
          </span>
        </button>
      </div>

      <div class="sidebar-footer">
        <a-select v-model:value="locale" size="small" class="sidebar-lang" :aria-label="t('app.language.label')">
          <a-select-option value="zh-CN">{{ t('app.language.zh') }}</a-select-option>
          <a-select-option value="ja-JP">{{ t('app.language.ja') }}</a-select-option>
          <a-select-option value="en-US">{{ t('app.language.en') }}</a-select-option>
        </a-select>
        <button type="button" class="sidebar-settings" :title="t('settings.open')" :aria-label="t('settings.open')" @click="openSettingsDialog">
          <svg width="20" height="20" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M600.704 64a32 32 0 0 1 30.464 22.208l35.2 109.376c14.784 7.232 28.928 15.36 42.432 24.512l112.384-24.192a32 32 0 0 1 34.432 15.36L944.32 364.8a32 32 0 0 1-4.032 37.504l-77.12 85.12a357.12 357.12 0 0 1 0 49.024l77.12 85.248a32 32 0 0 1 4.032 37.504l-88.704 153.6a32 32 0 0 1-34.432 15.296L708.8 803.904c-13.44 9.088-27.648 17.28-42.368 24.512l-35.264 109.376A32 32 0 0 1 600.704 960H423.296a32 32 0 0 1-30.464-22.208L357.696 828.48a351.616 351.616 0 0 1-42.56-24.64l-112.32 24.256a32 32 0 0 1-34.432-15.36L79.68 659.2a32 32 0 0 1 4.032-37.504l77.12-85.248a357.12 357.12 0 0 1 0-48.896l-77.12-85.248A32 32 0 0 1 79.68 364.8l88.704-153.6a32 32 0 0 1 34.432-15.296l112.32 24.256c13.568-9.152 27.776-17.408 42.56-24.64l35.2-109.312A32 32 0 0 1 423.232 64H600.64zm-23.424 64H446.72l-36.352 113.088-24.512 11.968a294.113 294.113 0 0 0-34.816 20.096l-22.656 15.36-116.224-25.088-65.28 113.152 79.68 88.192-1.92 27.136a293.12 293.12 0 0 0 0 40.192l1.92 27.136-79.808 88.192 65.344 113.152 116.224-25.024 22.656 15.296a294.113 294.113 0 0 0 34.816 20.096l24.512 11.968L446.72 896h130.688l36.48-113.152 24.448-11.904a288.282 288.282 0 0 0 34.752-20.096l22.592-15.296 116.288 25.024 65.28-113.152-79.744-88.192 1.92-27.136a293.12 293.12 0 0 0 0-40.256l-1.92-27.136 79.808-88.128-65.344-113.152-116.288 24.96-22.592-15.232a287.616 287.616 0 0 0-34.752-20.096l-24.448-11.904L577.344 128zM512 320a192 192 0 1 1 0 384 192 192 0 0 1-384zm0 64a128 128 0 1 0 0 256 128 128 0 0 0 0-256z"/></svg>
        </button>
      </div>
    </aside>

    <main class="main-area">
      <router-view />
    </main>

    <a-modal
      v-model:open="settingsVisible"
      :title="t('settings.title')"
      :width="720"
      :confirm-loading="settingsSaving"
      :ok-text="t('settings.saveApply')"
      :cancel-text="t('settings.cancel')"
      @ok="saveSettingsNow"
    >
      <a-spin :spinning="settingsLoading">
        <a-form layout="vertical">
          <a-form-item :label="t('settings.labels.apiBaseUrl')">
            <a-input v-model:value="settingsForm.api_base_url" :placeholder="t('settings.placeholders.apiBaseUrl')" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.amapJsKey')">
            <a-input-password v-model:value="settingsForm.vite_amap_web_js_key" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.amapWebKey')">
            <a-input-password v-model:value="settingsForm.vite_amap_web_key" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.openaiBaseUrl')">
            <a-input v-model:value="settingsForm.openai_base_url" :placeholder="t('settings.placeholders.openaiBaseUrl')" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.openaiModel')">
            <a-input v-model:value="settingsForm.openai_model" :placeholder="t('settings.placeholders.openaiModel')" allow-clear />
          </a-form-item>
          <a-form-item :label="t('settings.labels.openaiApiKey')">
            <a-input-password v-model:value="settingsForm.openai_api_key" allow-clear />
          </a-form-item>
        </a-form>
      </a-spin>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { setAppLocale, type AppLocale } from '@/i18n'
import { getRuntimeSettings, saveRuntimeSettings } from '@/services/api'
import { plans, plansLoading, refreshPlans, PLANS_UPDATED_EVENT } from '@/stores/plans'
import type { RuntimeSettings } from '@/types'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()

const activePlanId = computed(() => (route.name === 'PlanView' ? String(route.params.id || '') : ''))

watch(
  locale,
  (nextLocale) => {
    setAppLocale(nextLocale as AppLocale)
    document.title = t('app.title')
  },
  { immediate: true }
)

const goNewPlan = () => {
  router.push('/')
}

const openPlan = (planId: string) => {
  if (!planId) return
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.setItem('planId', planId)
  router.push(`/plan/${planId}`)
}

// ===== 设置弹窗 =====
const settingsVisible = ref(false)
const settingsLoading = ref(false)
const settingsSaving = ref(false)
const settingsForm = reactive<RuntimeSettings>({
  api_base_url: '',
  vite_amap_web_key: '',
  vite_amap_web_js_key: '',
  google_maps_api_key: '',
  google_maps_proxy: '',
  xhs_cookie: '',
  openai_api_key: '',
  openai_base_url: '',
  openai_model: '',
})

const openSettingsDialog = async () => {
  settingsVisible.value = true
  settingsLoading.value = true
  try {
    const settings = await getRuntimeSettings()
    Object.assign(settingsForm, settings)
  } catch (error: any) {
    message.error(error?.message || t('settings.messages.loadFailed'))
  } finally {
    settingsLoading.value = false
  }
}

const saveSettingsNow = async () => {
  settingsSaving.value = true
  try {
    const saved = await saveRuntimeSettings({ ...settingsForm })
    Object.assign(settingsForm, saved)
    message.success(t('settings.messages.saved'))
    settingsVisible.value = false
  } catch (error: any) {
    message.error(error?.message || t('settings.messages.saveFailed'))
  } finally {
    settingsSaving.value = false
  }
}

const onPlansUpdated = () => {
  void refreshPlans()
}

onMounted(() => {
  void refreshPlans()
  window.addEventListener(PLANS_UPDATED_EVENT, onPlansUpdated)
})

onUnmounted(() => {
  window.removeEventListener(PLANS_UPDATED_EVENT, onPlansUpdated)
})
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');

* {
  box-sizing: border-box;
}

#app {
  font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Noto Sans', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  display: flex;
  min-height: 100vh;
}

/* ─── 固定左侧栏（Codex 式会话列表） ─── */
.sidebar {
  width: 260px;
  flex-shrink: 0;
  height: 100vh;
  position: sticky;
  top: 0;
  background: #F5F0E8;
  border-right: 1px solid rgba(61, 50, 41, 0.08);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 18px 16px 10px;
}

.sidebar-brand {
  color: #3D3229;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-decoration: none;
}

.sidebar-new {
  padding: 4px 12px 12px;
}

.new-plan-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 12px;
  background: rgba(217, 119, 87, 0.08);
  color: #C4603D;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.new-plan-btn:hover {
  background: rgba(217, 119, 87, 0.16);
}

.new-plan-plus {
  font-size: 18px;
  line-height: 1;
}

.sidebar-section-title {
  padding: 4px 16px 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(61, 50, 41, 0.45);
  letter-spacing: 0.06em;
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-hint {
  color: rgba(61, 50, 41, 0.5);
  font-size: 13px;
  padding: 12px 8px;
}

.sidebar-item {
  width: 100%;
  border: none;
  border-radius: 10px;
  background: transparent;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-item:hover {
  background: rgba(217, 119, 87, 0.08);
}

.sidebar-item.active {
  background: rgba(217, 119, 87, 0.14);
}

.sidebar-item-city {
  color: #3D3229;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item-date {
  color: rgba(61, 50, 41, 0.5);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 1.5;
}

.sidebar-item-badge.processing {
  color: #d46b08;
  background: rgba(255, 165, 0, 0.15);
}

.sidebar-item-badge.failed {
  color: rgba(61, 50, 41, 0.55);
  background: rgba(61, 50, 41, 0.1);
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.08);
}

.sidebar-lang {
  flex: 1;
}

.sidebar-settings {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(61, 50, 41, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.sidebar-settings:hover {
  background: rgba(61, 50, 41, 0.06);
  color: #3D3229;
}

/* ─── 主内容区 ─── */
.main-area {
  flex: 1;
  min-width: 0;
  background: #FAF7F2;
}

@media (max-width: 768px) {
  #app {
    flex-direction: column;
  }
  .sidebar {
    width: 100%;
    height: auto;
    position: static;
    border-right: none;
    border-bottom: 1px solid rgba(61, 50, 41, 0.08);
  }
  .sidebar-list {
    max-height: 200px;
  }
}
</style>
