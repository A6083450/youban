<template>
  <section class="admin-runtime-panel" aria-labelledby="admin-runtime-title">
    <h1 id="admin-runtime-title" class="admin-panel-title">{{ t('admin.configTitle') }}</h1>
    <a-spin :spinning="settingsLoading" :tip="t('admin.loading')">
      <a-form layout="vertical">
        <a-form-item :label="t('settings.labels.apiBaseUrl')">
          <a-input
            v-model:value="settingsForm.api_base_url"
            :placeholder="t('settings.placeholders.apiBaseUrl')"
            allow-clear
          />
        </a-form-item>
        <a-form-item :label="t('settings.labels.amapJsKey')">
          <a-input-password v-model:value="settingsForm.vite_amap_web_js_key" allow-clear />
        </a-form-item>
        <a-form-item :label="t('settings.labels.amapWebKey')">
          <a-input-password v-model:value="settingsForm.vite_amap_web_key" allow-clear />
        </a-form-item>
        <a-form-item :label="t('settings.labels.openaiBaseUrl')">
          <a-input
            v-model:value="settingsForm.openai_base_url"
            :placeholder="t('settings.placeholders.openaiBaseUrl')"
            allow-clear
          />
        </a-form-item>
        <a-form-item :label="t('settings.labels.openaiModel')">
          <a-input
            v-model:value="settingsForm.openai_model"
            :placeholder="t('settings.placeholders.openaiModel')"
            allow-clear
          />
        </a-form-item>
        <a-form-item :label="t('settings.labels.openaiApiKey')">
          <a-input-password v-model:value="settingsForm.openai_api_key" allow-clear />
        </a-form-item>
      </a-form>
    </a-spin>
    <div class="admin-runtime-actions">
      <a-button type="primary" :loading="settingsSaving" @click="saveNow">
        {{ t('settings.saveApply') }}
      </a-button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import {
  getAdminRuntimeSettings,
  isAdminAuthError,
  saveAdminRuntimeSettings,
} from '@/services/api'
import type { RuntimeSettings } from '@/types'

const props = defineProps<{
  onUnauthorized: () => void
}>()

const { t } = useI18n()
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

const loadSettings = async () => {
  settingsLoading.value = true
  try {
    const settings = await getAdminRuntimeSettings()
    Object.assign(settingsForm, settings)
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      props.onUnauthorized()
      return
    }
    message.error(error?.message || t('settings.messages.loadFailed'))
  } finally {
    settingsLoading.value = false
  }
}

const saveNow = async () => {
  settingsSaving.value = true
  try {
    const saved = await saveAdminRuntimeSettings({ ...settingsForm })
    Object.assign(settingsForm, saved)
    message.success(t('settings.messages.saved'))
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      props.onUnauthorized()
      return
    }
    message.error(error?.message || t('settings.messages.saveFailed'))
  } finally {
    settingsSaving.value = false
  }
}

onMounted(() => {
  void loadSettings()
})
</script>

<style scoped>
.admin-runtime-panel {
  width: 100%;
  max-width: 720px;
}

.admin-panel-title {
  margin: 0 0 24px;
  color: #3d3229;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
}

.admin-runtime-panel :deep(.ant-form) {
  max-width: 680px;
}

.admin-runtime-actions {
  display: flex;
  justify-content: flex-end;
  max-width: 680px;
  padding-top: 4px;
}

@media (max-width: 760px) {
  .admin-panel-title {
    margin-bottom: 20px;
    font-size: 20px;
  }
}
</style>
