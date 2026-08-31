<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@/http/client'
import { deleteAdminRecord, getAdminRecords } from '@/services/admin'
import type { AdminConversationRecord } from '@/services/admin'

const emit = defineEmits<{ unauthorized: [] }>()
const { t } = useI18n()
const records = ref<AdminConversationRecord[]>([])
const loading = ref(false)
const deletingId = ref('')
const search = ref('')
const visibility = ref<'all' | 'active' | 'user_deleted'>('all')
const statusFilter = ref<'all' | 'completed' | 'processing' | 'failed'>('all')
const selectedUser = ref('all')
const visibilityOptions = computed(() => [
  { value: 'all' as const, label: t('admin.trips.visibilityAll') },
  { value: 'active' as const, label: t('admin.trips.visibilityActive') },
  { value: 'user_deleted' as const, label: t('admin.trips.visibilityUserDeleted') },
])
const statusOptions = computed(() => [
  { value: 'all' as const, label: t('admin.trips.statusAll') },
  { value: 'completed' as const, label: t('admin.trips.statusDone') },
  { value: 'processing' as const, label: t('admin.trips.statusProcessing') },
  { value: 'failed' as const, label: t('admin.trips.statusFailed') },
])
const users = computed(() => {
  const groups = new Map<string, { key: string, label: string, count: number }>()
  for (const item of records.value) {
    const key = item.user_id || 'anonymous'
    const group = groups.get(key) || { key, label: item.nickname || t('admin.trips.anonymous'), count: 0 }
    group.count += 1
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label))
})
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return records.value.filter((item) => {
    if (selectedUser.value !== 'all' && item.user_id !== selectedUser.value)
      return false
    const status = item.state === 'generating' ? 'processing' : item.status
    if (statusFilter.value !== 'all' && status !== statusFilter.value)
      return false
    return !query || `${item.title}\n${item.city}\n${item.nickname}`.toLowerCase().includes(query)
  })
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
    records.value = await getAdminRecords(visibility.value)
  }
  catch (error) {
    handleError(error, t('admin.trips.loadFailed'))
  }
  finally {
    loading.value = false
  }
}

function changeVisibility(event: { detail: { value: number } }): void {
  visibility.value = visibilityOptions.value[Number(event.detail.value)]?.value || 'all'
  selectedUser.value = 'all'
  void load()
}

function changeStatus(event: { detail: { value: number } }): void {
  statusFilter.value = statusOptions.value[Number(event.detail.value)]?.value || 'all'
}

function statusLabel(item: AdminConversationRecord): string {
  if (item.state === 'generating' || item.status === 'processing')
    return t('admin.trips.statusProcessing')
  if (item.status === 'completed')
    return t('admin.trips.statusDone')
  if (item.status === 'failed')
    return t('admin.trips.statusFailed')
  return t('admin.trips.statusChatting')
}

function openPlan(item: AdminConversationRecord): void {
  if (item.kind !== 'plan' || !item.plan_id)
    return
  uni.navigateTo({ url: `/pages/plan/index?id=${encodeURIComponent(item.plan_id)}` })
}

async function remove(item: AdminConversationRecord): Promise<void> {
  if (item.status === 'processing' || item.state === 'generating')
    return
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: t('admin.trips.permanentDelete'),
      content: t('admin.trips.permanentDeleteConfirm'),
      confirmColor: '#c2413a',
      success: result => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed)
    return
  deletingId.value = item.record_id
  try {
    await deleteAdminRecord(item.record_id)
    records.value = records.value.filter(record => record.record_id !== item.record_id)
    uni.showToast({ title: t('admin.trips.deleted'), icon: 'success' })
  }
  catch (error) {
    handleError(error, t('admin.trips.deleteFailed'))
  }
  finally {
    deletingId.value = ''
  }
}

onMounted(() => void load())
</script>

<template>
  <section class="trips-panel">
    <view class="panel-heading">
      <view><text class="panel-eyebrow">RECORDS</text><text class="panel-title">{{ t('admin.trips.title') }}</text></view><button :disabled="loading" :title="t('admin.trips.refresh')" @click="load">
        <wd-icon name="refresh" size="17px" />
      </button>
    </view>
    <view class="records-toolbar">
      <view class="search-control">
        <wd-icon name="search" size="17px" /><input v-model="search" :placeholder="t('admin.trips.searchPlaceholder')">
      </view>
      <picker :range="visibilityOptions" range-key="label" @change="changeVisibility">
        <view class="picker-command">
          {{ visibilityOptions.find(item => item.value === visibility)?.label }}
        </view>
      </picker>
      <picker :range="statusOptions" range-key="label" @change="changeStatus">
        <view class="picker-command">
          {{ statusOptions.find(item => item.value === statusFilter)?.label }}
        </view>
      </picker>
    </view>
    <view class="records-layout">
      <aside class="user-list">
        <button :class="{ active: selectedUser === 'all' }" @click="selectedUser = 'all'">
          <text>{{ t('admin.trips.allUsers') }}</text><text>{{ records.length }}</text>
        </button>
        <button v-for="user in users" :key="user.key" :class="{ active: selectedUser === user.key }" @click="selectedUser = user.key">
          <text>{{ user.label }}</text><text>{{ user.count }}</text>
        </button>
      </aside>
      <view class="record-list">
        <view v-if="loading" class="empty-state">
          {{ t('admin.loading') }}
        </view>
        <view v-else-if="!filtered.length" class="empty-state">
          {{ t('admin.trips.empty') }}
        </view>
        <view v-for="item in filtered" v-else :key="item.record_id" class="record-row">
          <view class="record-main">
            <view class="record-heading">
              <strong>{{ item.title || item.city || (item.kind === 'plan' ? t('admin.trips.untitledPlan') : t('admin.trips.untitledConversation')) }}</strong><text>{{ item.kind === 'plan' ? t('admin.trips.kindPlan') : t('admin.trips.kindConversation') }}</text><text v-if="item.user_deleted_at" class="deleted-tag">{{ t('admin.trips.userDeletedBadge') }}</text>
            </view>
            <text>{{ item.nickname || t('admin.trips.anonymous') }} · {{ item.start_date || t('admin.trips.datePending') }}<template v-if="item.end_date"> ~ {{ item.end_date }}</template></text>
          </view>
          <view class="record-status">
            <text :data-status="item.status">{{ statusLabel(item) }}</text><text>{{ item.updated_at.replace('T', ' ').slice(0, 16) }}</text>
          </view>
          <view class="record-actions">
            <button v-if="item.kind === 'plan'" :title="t('admin.trips.viewDetail')" @click="openPlan(item)">
              <wd-icon name="view" size="17px" />
            </button>
            <button :disabled="item.status === 'processing' || item.state === 'generating' || deletingId === item.record_id" :title="t('admin.trips.permanentDelete')" @click="remove(item)">
              <wd-icon name="delete" size="17px" />
            </button>
          </view>
        </view>
      </view>
    </view>
  </section>
</template>

<style scoped>
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.panel-heading > view {
  display: flex;
  flex-direction: column;
}
.panel-eyebrow {
  color: var(--accent-strong);
  font-size: 10px;
  font-weight: 800;
}
.panel-title {
  font-size: 22px;
  font-weight: 750;
}
.panel-heading button,
.user-list button,
.record-actions button {
  box-sizing: border-box;
  margin: 0;
}
.panel-heading button::after,
.user-list button::after,
.record-actions button::after {
  display: none;
}
.panel-heading button {
  display: grid;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 50%;
  background: var(--surface-elevated);
  place-items: center;
}
.records-toolbar {
  display: flex;
  margin-bottom: 16px;
  align-items: center;
  gap: 8px;
}
.search-control {
  display: flex;
  min-height: 38px;
  min-width: 240px;
  flex: 1;
  padding: 0 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-elevated);
  align-items: center;
  gap: 7px;
}
.search-control input {
  min-width: 0;
  flex: 1;
  font-size: 13px;
}
.picker-command {
  min-height: 38px;
  padding: 9px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-elevated);
  font-size: 12px;
}
.records-layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 18px;
}
.user-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.user-list button {
  display: flex;
  min-height: 37px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  justify-content: space-between;
  font-size: 12px;
  text-align: left;
}
.user-list button.active {
  background: var(--surface-soft);
  color: var(--accent-strong);
  font-weight: 700;
}
.record-list {
  min-width: 0;
  border-top: 1px solid var(--border-subtle);
}
.record-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 130px 70px;
  gap: 12px;
  align-items: center;
  padding: 15px 8px;
  border-bottom: 1px solid var(--border-subtle);
}
.record-main,
.record-status {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}
.record-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}
.record-heading strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-heading > text {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-soft);
  font-size: 9px;
}
.record-heading .deleted-tag {
  background: rgba(194, 65, 58, 0.1);
  color: var(--status-danger);
}
.record-status {
  align-items: flex-end;
}
.record-status > text:first-child {
  color: var(--accent-strong);
  font-weight: 700;
}
.record-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
.record-actions button {
  display: grid;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--surface-soft);
  color: var(--text-secondary);
  place-items: center;
}
.empty-state {
  padding: 70px 12px;
  color: var(--text-secondary);
  text-align: center;
}
@media (max-width: 750px) {
  .records-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .search-control {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
  }
  .records-layout {
    grid-template-columns: 1fr;
  }
  .user-list {
    overflow-x: auto;
    flex-direction: row;
  }
  .user-list button {
    min-width: 130px;
  }
  .record-row {
    grid-template-columns: minmax(0, 1fr) 70px;
  }
  .record-status {
    display: none;
  }
  .record-actions {
    grid-column: 2;
  }
}
</style>
