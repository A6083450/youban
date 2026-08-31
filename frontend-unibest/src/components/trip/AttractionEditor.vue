<script setup lang="ts">
import type { AttractionMutationInputDto, PoiSearchItemDto } from '@youban/contracts'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripAttraction, TripDay } from '@/features/result/model'
import { searchAttractionPois } from '@/services/v2'

const props = defineProps<{
  open: boolean
  planCity: string
  days: TripDay[]
  item?: { attraction: TripAttraction, dayIndex: number } | null
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [input: AttractionMutationInputDto, itemId: string]
}>()

const { t } = useI18n()
const dayIndex = ref(0)
const query = ref('')
const selectedPoi = ref<PoiSearchItemDto | null>(null)
const results = ref<PoiSearchItemDto[]>([])
const searching = ref(false)
const startTime = ref('09:00')
const visitDuration = ref('90')
const ticketPrice = ref('0')
const description = ref('')
const reservationRequired = ref(false)
const reservationTips = ref('')
const errorMessage = ref('')

const title = computed(() => t(props.item ? 'result.budget.editAttraction' : 'result.budget.addAttraction'))
const dayOptions = computed(() => props.days.map((day, index) => ({
  value: day.day_index,
  label: `${t('common.dayNumber', { day: index + 1 })} · ${day.date} · ${day.city || props.planCity}`,
})))
const selectedDay = computed(() => props.days.find(day => day.day_index === dayIndex.value))

function reset(): void {
  const current = props.item
  dayIndex.value = current?.dayIndex ?? props.days[0]?.day_index ?? 0
  query.value = current?.attraction.name || ''
  selectedPoi.value = current?.attraction.poi_id && current.attraction.location
    ? {
        id: current.attraction.poi_id,
        name: current.attraction.name,
        type: '',
        address: current.attraction.address || '',
        location: { ...current.attraction.location },
      }
    : null
  results.value = []
  startTime.value = current?.attraction.start_time || '09:00'
  visitDuration.value = String(Math.max(30, current?.attraction.visit_duration || 90))
  ticketPrice.value = String(Math.max(0, current?.attraction.ticket_price || 0))
  description.value = current?.attraction.description || ''
  reservationRequired.value = Boolean(current?.attraction.reservation_required)
  reservationTips.value = current?.attraction.reservation_tips || ''
  errorMessage.value = ''
}

function changeDay(event: { detail: { value: number } }): void {
  dayIndex.value = dayOptions.value[Number(event.detail.value)]?.value ?? dayIndex.value
  selectedPoi.value = null
  results.value = []
}

async function search(): Promise<void> {
  const keywords = query.value.trim()
  const city = selectedDay.value?.city || props.planCity
  if (!keywords || !city) {
    errorMessage.value = t('result.messages.attractionSearchRequired')
    return
  }
  searching.value = true
  errorMessage.value = ''
  try {
    results.value = await searchAttractionPois(keywords, city)
    if (!results.value.length)
      errorMessage.value = t('result.messages.attractionSearchEmpty')
  }
  catch {
    results.value = []
    errorMessage.value = t('result.messages.attractionSearchFailed')
  }
  finally {
    searching.value = false
  }
}

function selectPoi(poi: PoiSearchItemDto): void {
  selectedPoi.value = poi
  query.value = poi.name
  errorMessage.value = ''
}

function submit(): void {
  const poi = selectedPoi.value
  const duration = Number(visitDuration.value)
  const price = Number(ticketPrice.value)
  if (!poi || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime.value)) {
    errorMessage.value = t('result.messages.attractionFieldsRequired')
    return
  }
  if (!Number.isFinite(duration) || duration < 30 || duration > 720) {
    errorMessage.value = t('result.messages.attractionDurationInvalid')
    return
  }
  if (!Number.isFinite(price) || price < 0) {
    errorMessage.value = t('result.messages.budgetInvalidAmount')
    return
  }
  emit('save', {
    day_index: dayIndex.value,
    poi_id: poi.id,
    name: poi.name,
    address: poi.address,
    location: { ...poi.location },
    visit_duration: Math.round(duration),
    description: description.value.trim(),
    ticket_price: Math.round(price * 100) / 100,
    start_time: startTime.value,
    reservation_required: reservationRequired.value,
    reservation_tips: reservationTips.value.trim(),
  }, props.item?.attraction.id || '')
}

watch(() => props.open, (open) => {
  if (open)
    reset()
})
</script>

<template>
  <view v-if="open" class="modal-layer">
    <view class="modal-mask" @click="!saving && emit('close')" />
    <view class="editor-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <view class="editor-header">
        <view>
          <text class="editor-eyebrow">AMAP VERIFIED POI</text>
          <text class="editor-title">{{ title }}</text>
        </view>
        <button class="icon-command" :title="t('common.cancel')" :aria-label="t('common.cancel')" :disabled="saving" @click="emit('close')">
          <wd-icon name="close" size="20px" />
        </button>
      </view>

      <scroll-view scroll-y class="editor-body">
        <label class="field-control">
          <text>{{ t('result.daily.daySelector') }}</text>
          <picker :range="dayOptions" range-key="label" @change="changeDay">
            <view class="picker-value">{{ dayOptions.find(item => item.value === dayIndex)?.label }}</view>
          </picker>
        </label>

        <label class="field-control">
          <text>{{ t('result.budget.realAttraction') }}</text>
          <view class="search-row">
            <input v-model="query" :maxlength="120" :placeholder="t('result.budget.attractionSearchPlaceholder')" @confirm="search">
            <button :disabled="searching" @click="search">{{ searching ? t('common.loading') : t('result.budget.search') }}</button>
          </view>
        </label>

        <view v-if="results.length" class="poi-results">
          <button
            v-for="poi in results"
            :key="poi.id"
            class="poi-option"
            :class="{ selected: selectedPoi?.id === poi.id }"
            @click="selectPoi(poi)"
          >
            <view><strong>{{ poi.name }}</strong><text>{{ poi.type }}</text></view>
            <text>{{ poi.address }}</text>
          </button>
        </view>
        <view v-if="selectedPoi" class="verified-poi">
          <wd-icon name="check-circle" size="17px" />
          <view><strong>{{ selectedPoi.name }}</strong><text>{{ selectedPoi.address }}</text></view>
          <text>{{ t('result.budget.amapVerified') }}</text>
        </view>

        <view class="field-grid">
          <label class="field-control">
            <text>{{ t('result.budget.startTime') }}</text>
            <input v-model="startTime" :maxlength="5" placeholder="09:00">
          </label>
          <label class="field-control">
            <text>{{ t('result.fieldVisitDurationMinutes') }}</text>
            <input v-model="visitDuration" type="number" placeholder="90">
          </label>
          <label class="field-control">
            <text>{{ t('result.budget.ticketPricePerPerson') }}</text>
            <input v-model="ticketPrice" type="digit" placeholder="0">
          </label>
        </view>

        <label class="field-control">
          <text>{{ t('result.fieldDescription') }}</text>
          <textarea v-model="description" :maxlength="1000" auto-height />
        </label>
        <label class="switch-control">
          <switch :checked="reservationRequired" color="#c46b48" @change="reservationRequired = $event.detail.value" />
          <text>{{ t('result.reservationRequired') }}</text>
        </label>
        <label v-if="reservationRequired" class="field-control">
          <text>{{ t('result.budget.reservationTips') }}</text>
          <textarea v-model="reservationTips" :maxlength="500" auto-height />
        </label>
        <text v-if="errorMessage" class="form-error">{{ errorMessage }}</text>
      </scroll-view>

      <view class="editor-actions">
        <button class="cancel-command" :disabled="saving" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button class="save-command" :disabled="saving" @click="submit">
          {{ saving ? t('common.loading') : t('result.budget.reviewAction') }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.modal-layer,
.modal-mask {
  position: fixed;
  z-index: 130;
  inset: 0;
}
.modal-mask {
  background: rgba(38, 31, 26, 0.42);
}
.editor-dialog {
  position: absolute;
  z-index: 131;
  top: 50%;
  left: 50%;
  display: flex;
  box-sizing: border-box;
  width: min(680px, calc(100vw - 28px));
  max-height: min(820px, calc(100vh - 32px));
  border-radius: 8px;
  background: var(--surface-elevated);
  box-shadow: 0 24px 70px rgba(38, 31, 26, 0.25);
  transform: translate(-50%, -50%);
  flex-direction: column;
}
.editor-header,
.editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 17px 20px;
}
.editor-header {
  border-bottom: 1px solid var(--border-subtle);
}
.editor-header > view {
  display: flex;
  flex-direction: column;
}
.editor-eyebrow {
  color: var(--accent-strong);
  font-size: 10px;
  font-weight: 800;
}
.editor-title {
  font-size: 19px;
  font-weight: 750;
}
.editor-body {
  box-sizing: border-box;
  padding: 20px;
  min-height: 0;
}
.field-control {
  display: flex;
  margin-bottom: 15px;
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
  background: var(--surface-page);
  color: var(--text-primary);
  font-size: 14px;
}
.field-control textarea {
  min-height: 72px;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.search-row button,
.icon-command,
.cancel-command,
.save-command,
.poi-option {
  box-sizing: border-box;
  margin: 0;
}
.search-row button::after,
.icon-command::after,
.cancel-command::after,
.save-command::after,
.poi-option::after {
  display: none;
}
.search-row button {
  min-width: 78px;
  border: 0;
  border-radius: 6px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 13px;
}
.poi-results {
  display: grid;
  margin: -4px 0 15px;
  gap: 7px;
}
.poi-option {
  display: flex;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-page);
  text-align: left;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}
.poi-option > view {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.poi-option strong {
  color: var(--text-primary);
  font-size: 14px;
}
.poi-option.selected {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 6%, var(--surface-page));
}
.verified-poi {
  display: flex;
  margin-bottom: 15px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--status-success) 28%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--status-success) 7%, var(--surface-elevated));
  align-items: center;
  gap: 9px;
  color: var(--status-success);
  font-size: 12px;
}
.verified-poi > view {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.verified-poi strong {
  color: var(--text-primary);
  font-size: 14px;
}
.switch-control {
  display: flex;
  margin-bottom: 15px;
  align-items: center;
  gap: 9px;
  color: var(--text-primary);
  font-size: 13px;
}
.form-error {
  display: block;
  margin-bottom: 10px;
  color: var(--status-danger);
  font-size: 12px;
}
.icon-command {
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--surface-soft);
  place-items: center;
}
.editor-actions {
  justify-content: flex-end;
  border-top: 1px solid var(--border-subtle);
}
.cancel-command,
.save-command {
  min-height: 38px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
}
.cancel-command {
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-primary);
}
.save-command {
  border: 0;
  background: var(--accent-primary);
  color: #fff;
}
@media (max-width: 600px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
  .editor-body {
    padding: 16px;
  }
  .poi-option {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
