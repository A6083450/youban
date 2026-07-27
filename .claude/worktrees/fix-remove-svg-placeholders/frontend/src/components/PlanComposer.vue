<template>
  <div class="composer">
    <!-- 解析中的提示 -->
    <div v-if="parsing" class="composer-status">
      <span class="dot-spinner"></span>
      <span>{{ t('composer.parsing') }}</span>
    </div>

    <!-- AI 追问 -->
    <div v-if="clarifyQuestion" class="clarify-card">
      <span>{{ clarifyQuestion }}</span>
    </div>

    <!-- 确认卡片 -->
    <div v-if="draft" class="confirm-card">
      <div class="confirm-title">{{ t('composer.confirmTitle') }}</div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.cities') }}</span>
        <div class="city-chips">
          <span v-for="c in draft.cities" :key="c.city" class="city-chip">{{ c.city }} · {{ c.days }}{{ t('composer.daysUnit') }}</span>
        </div>
      </div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.dates') }}</span>
        <a-range-picker
          v-model:value="dateRange"
          size="small"
          class="confirm-picker"
          :allow-clear="false"
        />
      </div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.prefs') }}</span>
        <div class="pref-chips">
          <span
            v-for="opt in preferenceOptions"
            :key="opt"
            class="pref-chip"
            :class="{ active: draft.preferences.includes(opt) }"
            @click="togglePreference(opt)"
          >{{ preferenceLabel(opt) }}</span>
        </div>
      </div>
      <div class="confirm-row">
        <span class="confirm-label">{{ t('composer.transport') }}</span>
        <a-select v-model:value="draft.transportation" size="small" class="confirm-select">
          <a-select-option value="公共交通">{{ t('home.transportation.public') }}</a-select-option>
          <a-select-option value="自驾">{{ t('home.transportation.drive') }}</a-select-option>
          <a-select-option value="步行">{{ t('home.transportation.walk') }}</a-select-option>
          <a-select-option value="混合">{{ t('home.transportation.mixed') }}</a-select-option>
        </a-select>
        <a-select v-model:value="draft.accommodation" size="small" class="confirm-select">
          <a-select-option value="经济型酒店">{{ t('home.accommodation.budget') }}</a-select-option>
          <a-select-option value="舒适型酒店">{{ t('home.accommodation.comfort') }}</a-select-option>
          <a-select-option value="豪华酒店">{{ t('home.accommodation.luxury') }}</a-select-option>
          <a-select-option value="民宿">{{ t('home.accommodation.homestay') }}</a-select-option>
        </a-select>
      </div>
      <div class="confirm-actions">
        <button type="button" class="confirm-cancel" @click="draft = null">{{ t('composer.cancel') }}</button>
        <button type="button" class="confirm-submit" :disabled="generating" @click="handleGenerate">
          {{ generating ? t('composer.generating') : t('composer.generate') }}
        </button>
      </div>
      <div v-if="generating" class="composer-progress">
        <div class="progress-track"><div class="progress-fill" :style="{ width: progress + '%' }"></div></div>
        <p class="progress-text">{{ progressText }}</p>
      </div>
    </div>

    <!-- 输入框 -->
    <div class="input-box" :class="{ disabled: generating || parsing }">
      <textarea
        v-model="inputText"
        class="input-textarea"
        :placeholder="t('composer.placeholder')"
        :disabled="generating || parsing"
        rows="2"
        @keydown.enter.exact.prevent="handleSend"
      ></textarea>
      <button
        type="button"
        class="send-btn"
        :disabled="!inputText.trim() || generating || parsing"
        :aria-label="t('composer.send')"
        @click="handleSend"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import dayjs, { type Dayjs } from 'dayjs'
import { parseTripText, generateTripPlan } from '@/services/api'
import { getCurrentLocale } from '@/i18n'
import { notifyPlansUpdated } from '@/stores/plans'
import type { ParsedTripDraft, TripFormData, TripTaskEvent, TripTaskDetail } from '@/types'

const emit = defineEmits<{
  (e: 'sent', text: string): void
  (e: 'created', planId: string): void
  (e: 'work-progress', status: {
    visible: boolean
    progress: number
    message: string
    stage: TripTaskEvent['stage']
    details: TripTaskDetail[]
  }): void
}>()

const { t } = useI18n()
const router = useRouter()

const inputText = ref('')
const parsing = ref(false)
const clarifyQuestion = ref('')
const draft = ref<ParsedTripDraft | null>(null)
const dateRange = ref<[Dayjs, Dayjs] | null>(null)
const generating = ref(false)
const progress = ref(0)
const progressText = ref('')
const taskDetails = ref<TripTaskDetail[]>([])

const preferenceOptions = ['历史文化', '自然风光', '美食', '购物', '艺术', '休闲']
const preferenceLabelKeys: Record<string, string> = {
  历史文化: 'home.interests.history',
  自然风光: 'home.interests.nature',
  美食: 'home.interests.food',
  购物: 'home.interests.shopping',
  艺术: 'home.interests.art',
  休闲: 'home.interests.leisure',
}
const preferenceLabel = (value: string) => t(preferenceLabelKeys[value] || value)

watch(draft, (val) => {
  if (val) {
    dateRange.value = [dayjs(val.start_date), dayjs(val.end_date)]
  } else {
    dateRange.value = null
  }
})

const togglePreference = (value: string) => {
  if (!draft.value) return
  const idx = draft.value.preferences.indexOf(value)
  if (idx === -1) draft.value.preferences.push(value)
  else draft.value.preferences.splice(idx, 1)
}

const handleSend = async () => {
  const text = inputText.value.trim()
  if (!text || parsing.value || generating.value) return
  emit('sent', text)
  inputText.value = ''
  clarifyQuestion.value = ''
  draft.value = null
  parsing.value = true
  try {
    const res = await parseTripText(text, getCurrentLocale())
    if (res.need_clarify || !res.trip) {
      clarifyQuestion.value = res.clarify_question || t('composer.clarifyFallback')
      return
    }
    draft.value = res.trip
  } catch (error: any) {
    message.error(error?.message || t('composer.parseFailed'))
  } finally {
    parsing.value = false
  }
}

const stageText = (stage: TripTaskEvent['stage']) => {
  if (stage === 'attraction_search') return t('home.loading.searchingAttractions')
  if (stage === 'weather_search') return t('home.loading.queryingWeather')
  if (stage === 'hotel_search') return t('home.loading.recommendingHotels')
  if (stage === 'planning' || stage === 'graph_building') return t('home.loading.generatingPlan')
  if (stage === 'completed') return t('home.loading.done')
  return t('home.loading.initializing')
}

const handleGenerate = async () => {
  if (!draft.value || !dateRange.value || generating.value) return
  const d = draft.value
  const start = dateRange.value[0].format('YYYY-MM-DD')
  const end = dateRange.value[1].format('YYYY-MM-DD')
  const travelDays = dateRange.value[1].diff(dateRange.value[0], 'day') + 1
  if (travelDays < 1 || travelDays > 30) {
    message.warning(t('home.messages.travelDaysTooLong'))
    return
  }

  generating.value = true
  progress.value = 5
  progressText.value = t('home.loading.initializing')
  taskDetails.value = []
  emit('work-progress', {
    visible: true,
    progress: 5,
    message: progressText.value,
    stage: 'submitted',
    details: [],
  })

  try {
    sessionStorage.removeItem('tripPlan')
    sessionStorage.removeItem('graphData')
    sessionStorage.removeItem('planId')

    const requestData: TripFormData = {
      city: d.city,
      cities: d.cities,
      start_date: start,
      end_date: end,
      travel_days: travelDays,
      transportation: d.transportation,
      accommodation: d.accommodation,
      preferences: d.preferences,
      free_text_input: d.free_text_input,
      origin_text: d.origin_text,
      language: getCurrentLocale(),
    }

    const response = await generateTripPlan(requestData, {
      onTaskEvent: (event) => {
        if (Number.isFinite(event.progress)) {
          progress.value = Math.max(0, Math.min(100, event.progress))
        }
        progressText.value = event.message || stageText(event.stage)

        // 收集后端推送的 details
        if (event.details?.length) {
          taskDetails.value = [...taskDetails.value, ...event.details]
        }

        emit('work-progress', {
          visible: true,
          progress: progress.value,
          message: progressText.value,
          stage: event.stage,
          details: taskDetails.value,
        })
      }
    })

    if (response.success && response.data) {
      const planId = response.plan_id || ''
      sessionStorage.setItem('tripPlan', JSON.stringify(response.data))
      if (response.graph_data) {
        sessionStorage.setItem('graphData', JSON.stringify(response.graph_data))
      }
      if (planId) {
        sessionStorage.setItem('planId', planId)
      }
      message.success(t('home.messages.generateSuccess'))
      notifyPlansUpdated()
      emit('created', planId)
      draft.value = null
      router.push(`/plan/${planId}`)
    } else {
      message.error(response.message || t('home.messages.generateFailed'))
    }
  } catch (error: any) {
    message.error(error?.message || t('home.messages.generateRetry'))
  } finally {
    generating.value = false
    progress.value = 0
    progressText.value = ''
    taskDetails.value = []
    emit('work-progress', { visible: false, progress: 0, message: '', stage: 'completed', details: [] })
  }
}

defineExpose({ inputText })
</script>

<style scoped>
.composer {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
}

.composer-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #C4603D;
  font-size: 14px;
  margin-bottom: 12px;
}

.dot-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(217, 119, 87, 0.25);
  border-top-color: #D97757;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.clarify-card {
  background: rgba(217, 119, 87, 0.08);
  border: 1px solid rgba(217, 119, 87, 0.2);
  border-radius: 14px;
  padding: 14px 18px;
  color: #3D3229;
  font-size: 14px;
  margin-bottom: 12px;
}

.confirm-card {
  background: #FFFFFF;
  border: 1px solid rgba(100, 80, 60, 0.12);
  border-radius: 16px;
  padding: 20px 22px;
  margin-bottom: 12px;
  box-shadow: 0 4px 16px rgba(100, 80, 60, 0.06);
}

.confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
  margin-bottom: 14px;
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.confirm-label {
  width: 56px;
  flex-shrink: 0;
  font-size: 13px;
  color: #6B5D52;
}

.city-chips, .pref-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.city-chip {
  background: rgba(217, 119, 87, 0.1);
  border: 1px solid rgba(217, 119, 87, 0.3);
  color: #C4603D;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 600;
}

.pref-chip {
  border: 1px solid rgba(100, 80, 60, 0.15);
  color: #6B5D52;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.pref-chip.active {
  border-color: #D97757;
  background: rgba(217, 119, 87, 0.1);
  color: #C4603D;
}

.confirm-picker {
  flex: 1;
  min-width: 240px;
}

.confirm-select {
  min-width: 140px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.confirm-cancel {
  border: 1px solid rgba(100, 80, 60, 0.15);
  background: #fff;
  color: #6B5D52;
  border-radius: 10px;
  padding: 8px 18px;
  font-size: 14px;
  cursor: pointer;
}

.confirm-submit {
  border: none;
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  color: #fff;
  border-radius: 10px;
  padding: 8px 22px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.confirm-submit:disabled {
  opacity: 0.6;
  cursor: wait;
}

.composer-progress {
  margin-top: 14px;
}

.progress-track {
  width: 100%;
  height: 6px;
  background: rgba(100, 80, 60, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #D97757, #C4603D);
  border-radius: 3px;
  transition: width 0.5s ease;
}

.progress-text {
  margin-top: 8px;
  text-align: center;
  color: #C4603D;
  font-size: 13px;
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: #FFFFFF;
  border: 1px solid rgba(100, 80, 60, 0.18);
  border-radius: 20px;
  padding: 12px 14px;
  box-shadow: 0 4px 20px rgba(100, 80, 60, 0.08);
  transition: border-color 0.2s ease;
}

.input-box:focus-within {
  border-color: #D97757;
  box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.1);
}

.input-box.disabled {
  opacity: 0.7;
}

.input-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 15px;
  color: #3D3229;
  background: transparent;
  line-height: 1.5;
}

.input-textarea::placeholder {
  color: #A89888;
}

.send-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
