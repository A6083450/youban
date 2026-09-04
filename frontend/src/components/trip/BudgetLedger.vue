<script setup lang="ts">
import type { BudgetItemTypeDto, BudgetLedgerItemDto, BudgetLedgerResponseDto } from '@youban/contracts'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { budgetCalculationDescriptor, budgetItemDisplayAmount, selectBudgetItems } from '@/features/result/budget'
import { formatResultNumber } from '@/features/result/format'
import type { BudgetFilter, BudgetSort } from '@/features/result/budget'

const props = defineProps<{
  ledger: BudgetLedgerResponseDto
  readonly?: boolean
}>()
const emit = defineEmits<{
  add: []
  addAttraction: []
  edit: [item: BudgetLedgerItemDto]
  delete: [item: BudgetLedgerItemDto]
  restore: [item: BudgetLedgerItemDto]
}>()

const { locale, t } = useI18n()
const basis = ref<'group_total' | 'per_person'>('per_person')
const filter = ref<BudgetFilter>('all')
const sort = ref<BudgetSort>('amount_desc')
const filterOptions = computed<Array<{ value: BudgetFilter, label: string }>>(() => [
  { value: 'all', label: t('result.budget.filterAll') },
  { value: 'attraction', label: t('result.budget.attraction') },
  { value: 'hotel', label: t('result.budget.hotel') },
  { value: 'meal', label: t('result.budget.meal') },
  { value: 'transport', label: t('result.budget.transport') },
  { value: 'other', label: t('result.budget.other') },
])
const sortOptions = computed<Array<{ value: BudgetSort, label: string }>>(() => [
  { value: 'amount_desc', label: t('result.budget.sortAmountDesc') },
  { value: 'amount_asc', label: t('result.budget.sortAmountAsc') },
  { value: 'day_asc', label: t('result.budget.sortDayAsc') },
  { value: 'day_desc', label: t('result.budget.sortDayDesc') },
])
const typeLabels = computed<Record<BudgetItemTypeDto, string>>(() => ({
  attraction: t('result.budget.attraction'),
  hotel: t('result.budget.hotel'),
  meal: t('result.budget.meal'),
  transport: t('result.budget.transport'),
  other: t('result.budget.other'),
}))
const activeItems = computed(() => selectBudgetItems(props.ledger.items, filter.value, sort.value))
const deletedItems = computed(() => props.ledger.items.filter(item => item.deleted))
const totals = computed(() => basis.value === 'per_person' ? props.ledger.per_person_totals : props.ledger.totals)
const amountHeader = computed(() => basis.value === 'per_person'
  ? t('result.budget.perPersonAmount')
  : t('result.budget.groupTotalAmount'))

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatAmount(value: number | null | undefined): string {
  return value === null || value === undefined
    ? t('result.budget.amountPending')
    : `¥${formatResultNumber(value, locale.value, 2)}`
}

function formatDisplayAmount(item: BudgetLedgerItemDto): string {
  const amount = budgetItemDisplayAmount(item, basis.value)
  if (amount === null)
    return t('result.budget.amountPending')
  return t(basis.value === 'per_person' ? 'result.budget.perPersonValue' : 'result.budget.groupValue', {
    amount: formatNumber(amount),
  })
}

function dayLabel(item: BudgetLedgerItemDto): string {
  if (item.day_index === null)
    return t('result.budget.wholeTrip')
  const start = item.day_index + 1
  const end = item.day_end_index === null ? start : item.day_end_index + 1
  return end > start
    ? t('result.budget.dayRange', { start, end })
    : t('common.dayNumber', { day: start })
}

function calculationLabel(item: BudgetLedgerItemDto): string {
  const descriptor = budgetCalculationDescriptor(item)
  if (descriptor.kind === 'room_night') {
    return t('result.budget.roomNightCalculation', {
      unit: formatNumber(descriptor.unit),
      rooms: descriptor.rooms,
      nights: descriptor.nights,
    })
  }
  if (descriptor.kind === 'per_person') {
    return t('result.budget.perPersonCalculation', {
      unit: formatNumber(descriptor.unit),
      travelers: descriptor.travelers,
    })
  }
  if (descriptor.kind === 'shared_total')
    return t('result.budget.sharedCalculation', { travelers: descriptor.travelers })
  return t(descriptor.kind === 'entered_per_person'
    ? 'result.budget.enteredPerPerson'
    : 'result.budget.enteredGroupTotal')
}

function sourceLabel(item: BudgetLedgerItemDto): string {
  if (!item.entity_source)
    return ''
  const provider = item.price_provider || item.entity_source
  if (provider === 'amap')
    return t('result.budget.amap')
  if (item.price_source === 'user')
    return t('result.budget.userPriceWithSource', { provider })
  return provider
}

function changeFilter(event: { detail: { value: number } }): void {
  filter.value = filterOptions.value[Number(event.detail.value)]?.value || 'all'
}

function changeSort(event: { detail: { value: number } }): void {
  sort.value = sortOptions.value[Number(event.detail.value)]?.value || 'amount_desc'
}
</script>

<template>
  <view class="ledger-layout">
    <view class="budget-card">
      <view class="budget-detail-panel">
        <view class="budget-toolbar">
          <view class="budget-toolbar-item budget-basis-control">
            <text class="budget-toolbar-label">{{ t('result.budget.amountBasis') }}</text>
            <view class="basis-switch" role="group" :aria-label="t('result.budget.amountBasis')">
              <button :class="{ active: basis === 'per_person' }" @click="basis = 'per_person'">
                {{ t('result.budget.perPerson') }}
              </button>
              <button :class="{ active: basis === 'group_total' }" @click="basis = 'group_total'">
                {{ t('result.budget.groupTotal') }}
              </button>
            </view>
          </view>
          <view class="budget-toolbar-item">
            <text class="budget-toolbar-label">{{ t('result.budget.filterLabel') }}</text>
            <!-- #ifdef H5 -->
            <select v-model="filter" class="budget-select">
              <option v-for="option in filterOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <!-- #endif -->
            <!-- #ifndef H5 -->
            <picker class="budget-picker" :range="filterOptions" range-key="label" @change="changeFilter">
              <view class="budget-select">
                {{ filterOptions.find(item => item.value === filter)?.label }}
              </view>
            </picker>
            <!-- #endif -->
          </view>
          <view class="budget-toolbar-item">
            <text class="budget-toolbar-label">{{ t('result.budget.sortLabel') }}</text>
            <!-- #ifdef H5 -->
            <select v-model="sort" class="budget-select">
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <!-- #endif -->
            <!-- #ifndef H5 -->
            <picker class="budget-picker" :range="sortOptions" range-key="label" @change="changeSort">
              <view class="budget-select">
                {{ sortOptions.find(item => item.value === sort)?.label }}
              </view>
            </picker>
            <!-- #endif -->
          </view>
          <button v-if="!readonly" class="budget-add-btn" @click="emit('add')">
            <wd-icon name="add" size="16px" />
            <text>{{ t('result.budget.addItem') }}</text>
          </button>
        </view>

        <view v-if="activeItems.length" class="budget-detail-list">
          <view class="budget-detail-row budget-detail-header" :class="{ 'budget-detail-row--readonly': readonly }">
            <text>{{ t('result.budget.detailType') }}</text>
            <text>{{ t('result.budget.detailDateRange') }}</text>
            <text>{{ t('result.budget.detailName') }}</text>
            <text>{{ t('result.budget.calculation') }}</text>
            <text>{{ amountHeader }}</text>
            <text v-if="!readonly" class="budget-detail-action-heading">{{ t('result.budget.detailAction') }}</text>
          </view>
          <view v-for="item in activeItems" :key="item.id" class="budget-detail-row" :class="{ 'budget-detail-row--readonly': readonly }">
            <text class="budget-detail-type">{{ typeLabels[item.type] }}</text>
            <text class="budget-detail-day">{{ dayLabel(item) }}</text>
            <view class="budget-detail-name">
              <view class="budget-detail-name-main">
                <text>{{ item.name }}</text>
                <text v-if="item.origin === 'user' || item.user_locked" class="budget-origin-tag">{{ t('result.budget.userDiy') }}</text>
              </view>
              <text v-if="sourceLabel(item)" class="budget-detail-source">{{ sourceLabel(item) }}</text>
            </view>
            <text class="budget-detail-calculation">{{ calculationLabel(item) }}</text>
            <text class="budget-detail-amount" :class="{ 'budget-detail-amount--pending': budgetItemDisplayAmount(item, basis) === null }">
              {{ formatDisplayAmount(item) }}
            </text>
            <view v-if="!readonly" class="budget-action-wrap">
              <button class="budget-icon-btn" :title="t('common.edit')" :aria-label="t('common.edit')" @click="emit('edit', item)">
                <wd-icon name="edit" size="18px" />
              </button>
              <button class="budget-icon-btn" :title="t('common.delete')" :aria-label="t('common.delete')" @click="emit('delete', item)">
                <wd-icon name="delete" size="18px" />
              </button>
            </view>
          </view>
        </view>
        <view v-else class="empty-ledger">
          {{ t('result.budget.noDetails') }}
        </view>
      </view>
    </view>

    <aside class="right-budget-summary">
      <view class="budget-summary-panel">
        <text class="budget-summary-title">{{ t('result.budget.title') }}</text>
        <text class="budget-summary-basis">
          {{ basis === 'per_person' ? t('result.budget.perPersonFor', { count: ledger.traveler_count }) : t('result.budget.groupFor', { count: ledger.traveler_count }) }}
        </text>
        <view class="budget-summary-total-wrap">
          <text class="budget-summary-currency">¥</text>
          <text class="budget-summary-total-value">{{ formatNumber(totals.total) }}</text>
          <text v-if="basis === 'per_person'" class="budget-summary-unit">/人</text>
        </view>
        <view v-if="ledger.over_budget_amount > 0 || ledger.projected_over_budget_amount > 0" class="budget-status-alert danger">
          <text class="status-icon">!</text>
          <text v-if="ledger.over_budget_amount > 0">{{ t('result.budget.overBudget', { amount: formatNumber(ledger.over_budget_amount) }) }}</text>
          <text v-else>{{ t('result.budget.pendingProjectedOver', { count: ledger.pending_count, buffer: formatNumber(ledger.pending_buffer), amount: formatNumber(ledger.projected_over_budget_amount) }) }}</text>
        </view>
        <view v-else-if="ledger.pending_count && ledger.budget_limit !== null" class="budget-status-alert">
          <text class="status-icon">!</text>
          <text>{{ t('result.budget.pendingWithinBudget', { count: ledger.pending_count, buffer: formatNumber(ledger.pending_buffer) }) }}</text>
        </view>
        <view v-if="ledger.adjustment_note" class="budget-adjustment-note">
          {{ ledger.adjustment_note }}
        </view>
        <view class="budget-summary-sub-grid">
          <view><text class="budget-summary-sub-value">{{ formatAmount(totals.total_attractions) }}</text><text class="budget-summary-sub-label">{{ t('result.budget.attraction') }}</text></view>
          <view><text class="budget-summary-sub-value">{{ formatAmount(totals.total_hotels) }}</text><text class="budget-summary-sub-label">{{ t('result.budget.hotel') }}</text></view>
          <view><text class="budget-summary-sub-value">{{ formatAmount(totals.total_meals) }}</text><text class="budget-summary-sub-label">{{ t('result.budget.meal') }}</text></view>
          <view><text class="budget-summary-sub-value">{{ formatAmount(totals.total_transportation) }}</text><text class="budget-summary-sub-label">{{ t('result.budget.transport') }}</text></view>
        </view>
        <view v-if="ledger.pending_count > 0 && ledger.budget_limit === null" class="budget-unpriced-status">
          {{ t('result.budget.pendingAmountCount', { count: ledger.pending_count }) }}
        </view>
        <view v-if="!readonly" class="budget-pending-wrap">
          <text class="budget-pending-title">{{ t('result.budget.deletedTitle') }}</text>
          <text v-if="!deletedItems.length" class="budget-pending-empty">{{ t('result.budget.deletedEmpty') }}</text>
          <view v-for="item in deletedItems" v-else :key="item.id" class="deleted-row">
            <text>{{ item.name }}</text>
            <button @click="emit('restore', item)">
              {{ t('result.budget.restore') }}
            </button>
          </view>
        </view>
      </view>
    </aside>
  </view>
</template>

<style scoped>
.ledger-layout {
  display: flex;
  width: 100%;
  align-items: stretch;
  gap: 20px;
  color: #3d3229;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
}
.budget-card {
  min-width: 0;
  height: fit-content;
  padding: 1px;
  flex: 1 1 auto;
}
.budget-detail-panel {
  display: flex;
  min-height: 100%;
  padding: 18px;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.6);
  flex-direction: column;
  gap: 12px;
}
.budget-toolbar {
  display: flex;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(61, 50, 41, 0.1);
  flex-wrap: wrap;
  gap: 10px;
}
.budget-toolbar-item {
  display: flex;
  height: 24px;
  align-items: center;
  gap: 8px;
}
.budget-toolbar-label {
  color: rgba(61, 50, 41, 0.6);
  font-size: 12px;
  line-height: 18.8571px;
}
.basis-switch {
  display: flex;
  height: 24px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(61, 50, 41, 0.05);
}
.basis-switch button,
.budget-add-btn,
.budget-icon-btn,
.deleted-row button {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  line-height: 1.4;
}
.basis-switch button::after,
.budget-add-btn::after,
.budget-icon-btn::after,
.deleted-row button::after {
  display: none;
}
.basis-switch button {
  min-height: 20px;
  padding: 0 8px;
  border-radius: 4px;
  color: rgba(61, 50, 41, 0.65);
  font-size: 12px;
}
.basis-switch button.active {
  background: #fff;
  color: #3d3229;
  box-shadow: 0 1px 4px rgba(61, 50, 41, 0.12);
}
.budget-select {
  box-sizing: border-box;
  width: 180px;
  height: 24px;
  padding: 0 28px 0 10px;
  border: 1px solid rgba(61, 50, 41, 0.2);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.5);
  color: #3d3229;
  font:
    300 12px / 22px -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
.budget-picker {
  height: 24px;
}
.budget-add-btn {
  display: inline-flex;
  min-height: 32px;
  margin-left: auto;
  padding: 4px 15px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 6px;
  background: var(--accent-primary);
  color: white;
  font-size: 14px;
}
.budget-add-btn::before {
  margin-right: 1px;
  font-size: 18px;
  line-height: 1;
  content: '+';
}
.budget-detail-list {
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.4);
}
.budget-detail-row {
  display: grid;
  box-sizing: border-box;
  min-width: 0;
  padding: 11px 12px;
  align-items: center;
  grid-template-columns: 64px 64px minmax(0, 1fr) 112px 72px;
  grid-template-areas: 'type day name amount actions' 'type day calculation amount actions';
  column-gap: 10px;
  row-gap: 4px;
  border-bottom: 1px solid rgba(61, 50, 41, 0.08);
  background: rgba(255, 255, 255, 0.02);
}
.budget-detail-row:not(.budget-detail-header) {
  min-height: 64.82px;
}
.budget-detail-row:last-child {
  border-bottom: 0;
}
.budget-detail-row--readonly {
  grid-template-columns: 64px 64px minmax(0, 1fr) 112px;
  grid-template-areas: 'type day name amount' 'type day calculation amount';
}
.budget-detail-header {
  min-height: 64.7px;
  background: rgba(61, 50, 41, 0.05);
  color: rgba(61, 50, 41, 0.55);
  font-size: 12px;
}
.budget-detail-header > text:nth-child(1),
.budget-detail-type {
  grid-area: type;
}
.budget-detail-header > text:nth-child(2),
.budget-detail-day {
  grid-area: day;
}
.budget-detail-header > text:nth-child(3),
.budget-detail-name {
  grid-area: name;
}
.budget-detail-header > text:nth-child(4),
.budget-detail-calculation {
  grid-area: calculation;
}
.budget-detail-header > text:nth-child(5),
.budget-detail-amount {
  grid-area: amount;
}
.budget-detail-header > text:nth-child(6),
.budget-action-wrap,
.budget-detail-action-heading {
  grid-area: actions;
}
.budget-detail-type,
.budget-detail-day,
.budget-detail-name,
.budget-detail-calculation,
.budget-detail-amount {
  color: #3d3229;
  font-size: 13px;
}
.budget-detail-name {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  flex-direction: column;
  gap: 3px;
}
.budget-detail-name-main {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 7px;
}
.budget-detail-name-main > text:first-child {
  overflow-wrap: anywhere;
}
.budget-detail-source {
  color: rgba(61, 50, 41, 0.56);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.budget-detail-calculation {
  color: rgba(61, 50, 41, 0.66);
  font-size: 12px;
  line-height: 1.45;
}
.budget-origin-tag {
  padding: 1px 5px;
  border: 1px solid rgba(45, 113, 89, 0.2);
  border-radius: 4px;
  background: rgba(45, 113, 89, 0.08);
  color: #2d7159;
  font-size: 10px;
  font-weight: 600;
}
.budget-detail-amount {
  color: #d97757;
  font-weight: 600;
}
.budget-detail-amount--pending {
  color: rgba(61, 50, 41, 0.5);
  font-weight: 500;
}
.budget-action-wrap,
.budget-detail-action-heading {
  display: flex;
  align-self: stretch;
  margin: -11px -12px -11px 0;
  padding: 11px 12px 11px 8px;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  background: #fff;
}
.budget-detail-action-heading {
  background: #f7f5f2;
}
.budget-icon-btn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  padding: 0;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: rgba(61, 50, 41, 0.5);
}
.empty-ledger {
  padding: 54px 12px;
  color: rgba(61, 50, 41, 0.55);
  text-align: center;
}
.right-budget-summary {
  width: 360px;
  min-width: 0;
  margin-bottom: -20px;
  flex: 0 0 360px;
}
.budget-summary-panel {
  display: flex;
  box-sizing: border-box;
  min-height: 100%;
  padding: 18px;
  border: 1.2px solid rgba(61, 50, 41, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.6);
  flex-direction: column;
  gap: 18px;
}
.budget-summary-title {
  color: #3d3229;
  font-size: 34px;
  font-weight: 300;
  line-height: 1;
}
.budget-summary-basis {
  margin-top: -10px;
  color: rgba(61, 50, 41, 0.6);
  font-size: 12px;
  line-height: 1.4;
}
.budget-summary-total-wrap {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.budget-summary-currency {
  color: rgba(61, 50, 41, 0.7);
  font-size: 42px;
  line-height: 1;
}
.budget-summary-total-value {
  color: #3d3229;
  font-size: 78px;
  font-weight: 300;
  line-height: 0.88;
}
.budget-summary-unit {
  padding-bottom: 5px;
  align-self: flex-end;
  color: rgba(61, 50, 41, 0.62);
  font-size: 14px;
}
.budget-status-alert,
.budget-adjustment-note {
  display: flex;
  margin-top: 12px;
  padding: 9px 10px;
  align-items: flex-start;
  gap: 7px;
  border: 1px solid rgba(181, 126, 27, 0.26);
  border-radius: 6px;
  background: rgba(255, 247, 224, 0.78);
  color: #765814;
  font-size: 12px;
  line-height: 1.5;
}
.budget-status-alert.danger {
  border-color: rgba(182, 61, 61, 0.28);
  background: rgba(255, 239, 239, 0.82);
  color: #9b3030;
}
.status-icon {
  display: inline-flex;
  box-sizing: border-box;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  align-items: center;
  justify-content: center;
  flex: 0 0 15px;
  border: 1px solid currentcolor;
  border-radius: 50%;
  font-size: 10px;
}
.budget-adjustment-note {
  border-color: rgba(45, 113, 89, 0.22);
  background: rgba(45, 113, 89, 0.07);
  color: #2d7159;
}
.budget-summary-sub-grid {
  display: grid;
  margin-top: 6px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 12px;
}
.budget-summary-sub-grid > view {
  padding-top: 8px;
  border-top: 1px solid rgba(61, 50, 41, 0.1);
}
.budget-summary-sub-value {
  display: block;
  color: #d97757;
  font-size: 32px;
  line-height: 1;
}
.budget-summary-sub-label {
  display: block;
  margin-top: 6px;
  color: rgba(61, 50, 41, 0.55);
  font-size: 12px;
  line-height: 1.4;
}
.budget-pending-wrap {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.1);
}
.budget-pending-title {
  display: block;
  color: #3d3229;
  font-size: 13px;
}
.budget-pending-empty,
.deleted-row {
  display: block;
  margin-top: 10px;
  color: rgba(61, 50, 41, 0.45);
  font-size: 12px;
}
.deleted-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.deleted-row button {
  color: #d97757;
  font-size: 12px;
}
.budget-unpriced-status {
  padding: 7px 10px;
  border-left: 3px solid #d97757;
  background: rgba(217, 119, 87, 0.07);
  font-size: 12px;
}
@media (min-width: 1900px) {
  .budget-detail-row {
    min-width: 800px;
    grid-template-columns: 82px 76px minmax(180px, 1.35fr) minmax(170px, 1fr) 128px 72px;
    grid-template-areas: 'type day name calculation amount actions';
  }
}
@media (max-width: 920px) {
  .ledger-layout {
    flex-direction: column;
  }
  .right-budget-summary {
    width: 100%;
    margin-bottom: 0;
    order: -1;
    flex-basis: auto;
  }
}
@media (max-width: 560px) {
  .budget-summary-title {
    font-size: 30px;
  }
  .budget-summary-total-value {
    font-size: 56px;
  }
  .budget-summary-sub-value {
    font-size: 24px;
  }
  .budget-detail-panel {
    padding: 14px;
  }
  .budget-toolbar-item {
    width: 100%;
    justify-content: space-between;
  }
  .budget-add-btn {
    width: 100%;
    margin-left: 0;
  }
  .budget-detail-list {
    overflow: visible;
    border: 0;
    background: transparent;
  }
  .budget-detail-header {
    display: none;
  }
  .budget-detail-row,
  .budget-detail-row--readonly {
    margin-bottom: 10px;
    padding: 13px 14px;
    border: 1px solid rgba(61, 50, 41, 0.08);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.66);
    grid-template-columns: auto auto 1fr auto;
    grid-template-areas: 'name name name amount' 'calculation calculation calculation calculation' 'type day gap actions';
    row-gap: 7px;
  }
}
</style>
