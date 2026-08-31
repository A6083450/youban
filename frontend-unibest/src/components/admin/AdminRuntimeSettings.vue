<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@/http/client'
import { getAdminSettings, saveAdminSettings } from '@/services/admin'
import type { AdminRuntimeSettings } from '@/services/admin'

const emit = defineEmits<{ unauthorized: [] }>()
const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const form = reactive<AdminRuntimeSettings>({
  vite_amap_web_key: '',
  vite_amap_web_js_key: '',
  google_maps_api_key: '',
  google_maps_proxy: '',
  xhs_cookie: '',
  openai_api_key: '',
  openai_base_url: '',
  openai_model: '',
  trip_segment_days: 5,
  trip_segment_concurrency: 8,
  trip_review_enabled: true,
  llm_thinking_enabled: false,
  llm_thinking_visible: false,
  trip_planner_timeout: 120,
  trip_duplicate_repair_rounds: 2,
  pi_parent_session_limit: 64,
  pi_parent_session_idle_seconds: 1800,
  llm_api_style: 'responses',
  chat_edit_agent: 'pi',
})

function handleError(error: unknown, fallback: string): void {
  if (error instanceof ApiError && error.status === 401) {
    emit('unauthorized')
    return
  }
  uni.showToast({ title: error instanceof Error ? error.message : fallback, icon: 'none' })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    Object.assign(form, await getAdminSettings())
  }
  catch (error) {
    handleError(error, t('settings.messages.loadFailed'))
  }
  finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (saving.value)
    return
  if (!form.llm_thinking_enabled)
    form.llm_thinking_visible = false
  saving.value = true
  try {
    Object.assign(form, await saveAdminSettings({ ...form }))
    uni.showToast({ title: t('settings.messages.saved'), icon: 'success' })
  }
  catch (error) {
    handleError(error, t('settings.messages.saveFailed'))
  }
  finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <section class="settings-panel">
    <view class="panel-heading">
      <view><text class="panel-eyebrow">RUNTIME</text><text class="panel-title">{{ t('admin.configTitle') }}</text></view>
      <button class="refresh-command" :disabled="loading" :title="t('admin.trips.refresh')" @click="load">
        <wd-icon name="refresh" size="17px" />
      </button>
    </view>
    <view v-if="loading" class="panel-state">
      {{ t('admin.loading') }}
    </view>
    <view v-else class="settings-form">
      <view class="form-section">
        <text class="section-title">LLM</text>
        <label class="field-control"><text>{{ t('settings.labels.openaiBaseUrl') }}</text><input v-model="form.openai_base_url" :placeholder="t('settings.placeholders.openaiBaseUrl')"></label>
        <view class="field-grid">
          <label class="field-control"><text>{{ t('settings.labels.openaiModel') }}</text><input v-model="form.openai_model" :placeholder="t('settings.placeholders.openaiModel')"></label>
          <label class="field-control"><text>{{ t('settings.labels.openaiApiKey') }}</text><input v-model="form.openai_api_key" password></label>
        </view>
        <view class="switch-grid">
          <label><switch :checked="form.llm_thinking_enabled" color="#c46b48" @change="form.llm_thinking_enabled = $event.detail.value" /><text>{{ t('settings.labels.thinkingEnabled') }}</text></label>
          <label><switch :checked="form.llm_thinking_visible" :disabled="!form.llm_thinking_enabled" color="#c46b48" @change="form.llm_thinking_visible = $event.detail.value" /><text>{{ t('settings.labels.thinkingVisible') }}</text></label>
          <label><switch :checked="form.trip_review_enabled" color="#c46b48" @change="form.trip_review_enabled = $event.detail.value" /><text>Trip review</text></label>
        </view>
      </view>

      <view class="form-section">
        <text class="section-title">MAPS & SOURCES</text>
        <view class="field-grid">
          <label class="field-control"><text>{{ t('settings.labels.amapWebKey') }}</text><input v-model="form.vite_amap_web_key" password></label>
          <label class="field-control"><text>{{ t('settings.labels.amapJsKey') }}</text><input v-model="form.vite_amap_web_js_key" password></label>
          <label class="field-control"><text>{{ t('settings.labels.googleMapsApiKey') }}</text><input v-model="form.google_maps_api_key" password></label>
          <label class="field-control"><text>{{ t('settings.labels.googleMapsProxy') }}</text><input v-model="form.google_maps_proxy" :placeholder="t('settings.placeholders.googleMapsProxy')"></label>
        </view>
        <label class="field-control"><text>{{ t('settings.labels.xhsCookie') }}</text><textarea v-model="form.xhs_cookie" :maxlength="10000" auto-height :placeholder="t('settings.placeholders.xhsCookie')" /></label>
      </view>

      <view class="form-section">
        <text class="section-title">PLANNING PIPELINE</text>
        <view class="number-grid">
          <label class="field-control"><text>Segment days</text><input v-model.number="form.trip_segment_days" type="number"></label>
          <label class="field-control"><text>Segment concurrency</text><input v-model.number="form.trip_segment_concurrency" type="number"></label>
          <label class="field-control"><text>Planner timeout (s)</text><input v-model.number="form.trip_planner_timeout" type="number"></label>
          <label class="field-control"><text>Duplicate repair rounds</text><input v-model.number="form.trip_duplicate_repair_rounds" type="number"></label>
          <label class="field-control"><text>Parent session limit</text><input v-model.number="form.pi_parent_session_limit" type="number"></label>
          <label class="field-control"><text>Parent idle seconds</text><input v-model.number="form.pi_parent_session_idle_seconds" type="number"></label>
        </view>
        <view class="field-grid">
          <label class="field-control"><text>LLM API style</text><picker :range="['responses', 'completions']" @change="form.llm_api_style = ['responses', 'completions'][$event.detail.value] as AdminRuntimeSettings['llm_api_style']"><view class="picker-value">{{ form.llm_api_style }}</view></picker></label>
          <label class="field-control"><text>Chat edit agent</text><picker :range="['pi', 'simple']" @change="form.chat_edit_agent = ['pi', 'simple'][$event.detail.value] as AdminRuntimeSettings['chat_edit_agent']"><view class="picker-value">{{ form.chat_edit_agent }}</view></picker></label>
        </view>
      </view>
      <view class="form-actions">
        <button :disabled="saving" @click="save">
          {{ saving ? t('admin.loading') : t('settings.saveApply') }}
        </button>
      </view>
    </view>
  </section>
</template>

<style scoped>
.settings-panel {
  max-width: 820px;
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}
.panel-heading > view {
  display: flex;
  flex-direction: column;
}
.panel-eyebrow,
.section-title {
  color: var(--accent-strong);
  font-size: 10px;
  font-weight: 800;
}
.panel-title {
  font-size: 22px;
  font-weight: 750;
}
.refresh-command {
  display: grid;
  width: 34px;
  height: 34px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  background: var(--surface-elevated);
  place-items: center;
}
.refresh-command::after {
  display: none;
}
.panel-state {
  padding: 70px 0;
  color: var(--text-secondary);
  text-align: center;
}
.settings-form,
.form-section {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.form-section {
  padding: 0 0 24px;
  border-bottom: 1px solid var(--border-subtle);
}
.field-grid,
.number-grid,
.switch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}
.number-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.switch-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.switch-grid label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}
.field-control {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
}
.field-control input,
.field-control textarea,
.picker-value {
  box-sizing: border-box;
  width: 100%;
  min-height: 42px;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 14px;
}
.field-control textarea {
  min-height: 72px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
}
.form-actions button {
  min-height: 40px;
  margin: 0;
  padding: 8px 18px;
  border: 0;
  border-radius: 6px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 13px;
}
.form-actions button::after {
  display: none;
}
@media (max-width: 700px) {
  .field-grid,
  .number-grid,
  .switch-grid {
    grid-template-columns: 1fr;
  }
}
</style>
