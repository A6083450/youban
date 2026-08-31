<script setup lang="ts">
import type {
  BudgetItemInputDto,
  BudgetItemTypeDto,
  BudgetLedgerItemDto,
} from '@youban/contracts'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripDay } from '@/features/result/model'

const props = defineProps<{
  open: boolean
  item?: BudgetLedgerItemDto | null
  days: TripDay[]
  saving?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [input: BudgetItemInputDto]
}>()
const { t } = useI18n()

const typeOptions = computed<Array<{ value: Exclude<BudgetItemTypeDto, 'attraction'>, label: string }>>(() => [
  { value: 'hotel', label: t('result.budget.hotel') },
  { value: 'meal', label: t('result.budget.meal') },
  { value: 'transport', label: t('result.budget.transport') },
  { value: 'other', label: t('result.budget.other') },
])
const dayOptions = computed(() => [
  { value: null as number | null, label: t('result.budget.wholeTrip') },
  ...props.days.map((day, index) => ({ value: day.day_index, label: `${t('common.dayNumber', { day: index + 1 })} · ${day.date}` })),
])
const type = ref<Exclude<BudgetItemTypeDto, 'attraction'>>('other')
const dayIndex = ref<number | null>(null)
const name = ref('')
const amount = ref('')
const amountBasis = ref<'group_total' | 'per_person'>('group_total')
const note = ref('')
const errorMessage = ref('')

const title = computed(() => t(props.item ? 'result.budget.editItem' : 'result.budget.addItem'))

function reset(): void {
  const item = props.item
  type.value = item && item.type !== 'attraction' ? item.type : 'other'
  dayIndex.value = item?.day_index ?? null
  name.value = item?.name || ''
  const currentAmount = item
    ? (item.amount_basis === 'per_person' ? item.per_person_amount : item.amount)
    : null
  amount.value = currentAmount === null || currentAmount === undefined ? '' : String(currentAmount)
  amountBasis.value = item?.amount_basis || 'group_total'
  note.value = item?.note || ''
  errorMessage.value = ''
}

function changeType(event: { detail: { value: number } }): void {
  type.value = typeOptions.value[Number(event.detail.value)]?.value || 'other'
}

function changeDay(event: { detail: { value: number } }): void {
  dayIndex.value = dayOptions.value[Number(event.detail.value)]?.value ?? null
}

function submit(): void {
  const normalizedName = name.value.trim()
  if (!normalizedName) {
    errorMessage.value = t('result.messages.budgetNameRequired')
    return
  }
  const numericAmount = amount.value.trim() ? Number(amount.value) : null
  if (numericAmount !== null && (!Number.isFinite(numericAmount) || numericAmount < 0)) {
    errorMessage.value = t('result.messages.budgetInvalidAmount')
    return
  }
  errorMessage.value = ''
  emit('save', {
    type: type.value,
    day_index: dayIndex.value,
    name: normalizedName,
    amount: numericAmount,
    amount_basis: amountBasis.value,
    note: note.value.trim(),
  })
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
          <text class="editor-eyebrow">BUDGET ITEM</text>
          <text class="editor-title">{{ title }}</text>
        </view>
        <button class="close-command" :title="t('common.cancel')" :aria-label="t('common.cancel')" :disabled="saving" @click="emit('close')">
          <wd-icon name="close" size="20px" />
        </button>
      </view>

      <view class="editor-form">
        <view class="field-row">
          <label class="field-control">
            <text>{{ t('result.budget.detailType') }}</text>
            <picker :range="typeOptions" range-key="label" @change="changeType">
              <view class="picker-value">{{ typeOptions.find(item => item.value === type)?.label }}</view>
            </picker>
          </label>
          <label class="field-control">
            <text>{{ t('result.budget.detailDay') }}</text>
            <picker :range="dayOptions" range-key="label" @change="changeDay">
              <view class="picker-value">{{ dayOptions.find(item => item.value === dayIndex)?.label }}</view>
            </picker>
          </label>
        </view>

        <label class="field-control">
          <text>{{ t('result.budget.detailName') }}</text>
          <input v-model="name" :maxlength="120" :placeholder="t('result.budget.detailName')">
        </label>

        <view class="amount-section">
          <view class="basis-switch">
            <button :class="{ active: amountBasis === 'group_total' }" @click="amountBasis = 'group_total'">
              {{ t('result.budget.groupTotal') }}
            </button>
            <button :class="{ active: amountBasis === 'per_person' }" @click="amountBasis = 'per_person'">
              {{ t('result.budget.perPerson') }}
            </button>
          </view>
          <label class="field-control amount-control">
            <text>{{ amountBasis === 'per_person' ? t('result.budget.perPersonAmount') : t('result.budget.groupTotalAmount') }}</text>
            <view class="amount-input"><text>¥</text><input v-model="amount" type="digit" :placeholder="t('result.budget.amountPending')"></view>
          </label>
        </view>

        <label class="field-control">
          <text>{{ t('result.budget.note') }}</text>
          <textarea v-model="note" :maxlength="300" auto-height :placeholder="t('result.budget.note')" />
        </label>
        <text v-if="errorMessage" class="form-error">{{ errorMessage }}</text>
      </view>

      <view class="editor-actions">
        <button class="cancel-command" :disabled="saving" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button class="save-command" :disabled="saving" @click="submit">
          {{ saving ? t('admin.loading') : t('common.save') }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.modal-layer,
.modal-mask {
  position: fixed;
  z-index: 120;
  inset: 0;
}
.modal-mask {
  background: rgba(38, 31, 26, 0.38);
}
.editor-dialog {
  position: absolute;
  z-index: 121;
  top: 50%;
  left: 50%;
  box-sizing: border-box;
  width: min(590px, calc(100vw - 28px));
  max-height: min(720px, calc(100vh - 40px));
  overflow-y: auto;
  border-radius: 8px;
  background: var(--surface-elevated);
  box-shadow: 0 24px 70px rgba(38, 31, 26, 0.24);
  transform: translate(-50%, -50%);
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
  gap: 2px;
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
.close-command,
.basis-switch button,
.cancel-command,
.save-command {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  line-height: 1.4;
}
.close-command::after,
.basis-switch button::after,
.cancel-command::after,
.save-command::after {
  display: none;
}
.close-command {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--surface-soft);
  color: var(--text-primary);
}
.editor-form {
  display: flex;
  padding: 20px;
  flex-direction: column;
  gap: 16px;
}
.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
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
.picker-value,
.amount-input {
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
  min-height: 76px;
  line-height: 1.5;
}
.amount-section {
  display: grid;
  grid-template-columns: 185px minmax(0, 1fr);
  gap: 13px;
  align-items: end;
}
.basis-switch {
  display: flex;
  padding: 3px;
  border-radius: 7px;
  background: var(--surface-soft);
}
.basis-switch button {
  flex: 1;
  min-height: 36px;
  padding: 7px;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}
.basis-switch button.active {
  background: var(--surface-elevated);
  color: var(--accent-strong);
  font-weight: 700;
}
.amount-input {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: 0;
  padding-bottom: 0;
}
.amount-input input {
  min-height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
}
.form-error {
  color: var(--status-danger);
  font-size: 12px;
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
  background: var(--surface-elevated);
  color: var(--text-primary);
}
.save-command {
  background: var(--accent-primary);
  color: white;
}
@media (max-width: 560px) {
  .field-row,
  .amount-section {
    grid-template-columns: 1fr;
  }
}
</style>
