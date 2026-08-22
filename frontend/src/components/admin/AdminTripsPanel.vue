<template>
  <section class="admin-trips-panel" aria-labelledby="admin-trips-title">
    <div class="admin-trips-head">
      <h1 id="admin-trips-title" class="admin-panel-title">{{ t('admin.trips.title') }}</h1>
      <div class="admin-trips-toolbar">
        <a-input
          v-model:value="tripsSearch"
          class="admin-trips-search"
          :placeholder="t('admin.trips.searchPlaceholder')"
          allow-clear
        >
          <template #prefix><SearchOutlined aria-hidden="true" /></template>
        </a-input>
        <a-select v-model:value="tripsStatusFilter" class="admin-trips-status-filter" size="middle">
          <a-select-option value="all">{{ t('admin.trips.statusAll') }}</a-select-option>
          <a-select-option value="completed">{{ t('admin.trips.statusDone') }}</a-select-option>
          <a-select-option value="processing">{{ t('admin.trips.statusProcessing') }}</a-select-option>
          <a-select-option value="failed">{{ t('admin.trips.statusFailed') }}</a-select-option>
        </a-select>
        <a-button :loading="tripsLoading" @click="loadTrips">
          {{ t('admin.trips.refresh') }}
        </a-button>
      </div>
    </div>

    <a-spin :spinning="tripsLoading" :tip="t('admin.loading')">
      <div class="trips-layout">
        <aside class="trips-users" :aria-label="t('admin.trips.userFilterLabel')">
          <button
            type="button"
            class="trips-user-item"
            :class="{ active: selectedUserKey === 'all' }"
            :aria-pressed="selectedUserKey === 'all'"
            @click="selectedUserKey = 'all'"
          >
            <span class="trips-user-avatar all" aria-hidden="true">✦</span>
            <span class="trips-user-label">{{ t('admin.trips.allUsers') }}</span>
            <span class="trips-user-count">{{ trips.length }}</span>
          </button>
          <button
            v-for="group in userGroups"
            :key="group.key"
            type="button"
            class="trips-user-item"
            :class="{ active: selectedUserKey === group.key }"
            :aria-pressed="selectedUserKey === group.key"
            @click="selectedUserKey = group.key"
          >
            <span
              class="trips-user-avatar"
              :class="{ anonymous: group.key === 'anonymous' }"
              aria-hidden="true"
            >
              {{ group.initial }}
            </span>
            <span class="trips-user-label">{{ group.label }}</span>
            <span class="trips-user-count">{{ group.count }}</span>
          </button>
        </aside>

        <div class="trips-list">
          <template v-if="filteredTrips.length">
            <div
              v-for="item in filteredTrips"
              :key="item.task_id"
              class="trip-card"
              role="button"
              tabindex="0"
              @click="openDetail(item)"
              @keydown.enter.self="openDetail(item)"
              @keydown.space.self.prevent="openDetail(item)"
            >
              <div class="trip-card-main">
                <div class="trip-card-info">
                  <div class="trip-card-city">{{ item.city }}</div>
                  <div class="trip-card-meta">
                    <span>{{ formatTripDates(item) }} · {{ t('common.dayCount', { count: item.travel_days }) }}</span>
                    <span class="trip-card-owner">
                      <span
                        class="trip-card-owner-avatar"
                        :class="{ anonymous: !item.nickname }"
                        aria-hidden="true"
                      >
                        {{ (item.nickname || '?').trim().charAt(0).toUpperCase() }}
                      </span>
                      {{ item.nickname || t('admin.trips.anonymous') }}
                    </span>
                  </div>
                </div>
                <div class="trip-card-side">
                  <span class="trip-status" :class="item.status || 'processing'">{{ statusText(item.status) }}</span>
                  <span class="trip-updated">{{ formatUpdated(item.updated_at) }}</span>
                </div>
              </div>
              <div class="trip-card-actions" @click.stop>
                <button type="button" class="trip-action-btn view" @click="openDetail(item)">
                  <ExportOutlined aria-hidden="true" />
                  {{ t('admin.trips.viewDetail') }}
                </button>
                <a-popconfirm
                  :title="t('admin.trips.deleteConfirm')"
                  :ok-text="t('common.ok')"
                  :cancel-text="t('common.cancel')"
                  ok-type="danger"
                  placement="topRight"
                  @confirm="removeTrip(item)"
                >
                  <button
                    type="button"
                    class="trip-action-btn delete"
                    :disabled="item.status === 'processing' || deletingId === item.task_id"
                    @click.stop
                  >
                    <DeleteOutlined aria-hidden="true" />
                    {{ t('admin.trips.delete') }}
                  </button>
                </a-popconfirm>
              </div>
            </div>
          </template>
          <div v-else class="trips-empty">{{ t('admin.trips.empty') }}</div>
        </div>
      </div>
    </a-spin>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { DeleteOutlined, ExportOutlined, SearchOutlined } from '@ant-design/icons-vue'
import { adminDeleteTrip, adminGetAllTrips, isAdminAuthError } from '@/services/api'
import type { AdminTripItem } from '@/types'

const props = defineProps<{
  onUnauthorized: () => void
}>()

const { t } = useI18n()
const router = useRouter()
const trips = ref<AdminTripItem[]>([])
const tripsLoading = ref(false)
const tripsSearch = ref('')
const tripsStatusFilter = ref<'all' | 'completed' | 'processing' | 'failed'>('all')
const selectedUserKey = ref<string>('all')
const deletingId = ref('')

const openDetail = (item: AdminTripItem) => {
  const planId = item.plan_id || item.task_id
  if (!planId) return
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.setItem('planId', planId)
  router.push(`/plan/${planId}`)
}

const removeTrip = async (item: AdminTripItem) => {
  if (deletingId.value) return
  deletingId.value = item.task_id
  try {
    await adminDeleteTrip(item.task_id)
    trips.value = trips.value.filter((trip) => trip.task_id !== item.task_id)
    if (
      selectedUserKey.value !== 'all' &&
      !trips.value.some((trip) => (trip.user_id || 'anonymous') === selectedUserKey.value)
    ) {
      selectedUserKey.value = 'all'
    }
    message.success(t('admin.trips.deleted'))
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      props.onUnauthorized()
      return
    }
    message.error(error?.message || t('admin.trips.deleteFailed'))
  } finally {
    deletingId.value = ''
  }
}

const statusText = (status?: string) => {
  if (status === 'completed') return t('admin.trips.statusDone')
  if (status === 'failed') return t('admin.trips.statusFailed')
  return t('admin.trips.statusProcessing')
}

const formatTripDates = (record: AdminTripItem) => {
  const start = record.start_date || ''
  const end = record.end_date || ''
  if (start.slice(0, 4) === end.slice(0, 4) && end.length >= 10) {
    return `${start} ~ ${end.slice(5)}`
  }
  return `${start} ~ ${end}`
}

const formatUpdated = (iso?: string) => (iso || '').replace('T', ' ').slice(0, 16)

interface TripUserGroup {
  key: string
  label: string
  initial: string
  count: number
}

const userGroups = computed<TripUserGroup[]>(() => {
  const groups = new Map<string, TripUserGroup>()
  for (const item of trips.value) {
    const key = item.user_id || 'anonymous'
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    const label = item.nickname || t('admin.trips.anonymous')
    groups.set(key, {
      key,
      label,
      initial: key === 'anonymous' ? '?' : label.trim().charAt(0).toUpperCase(),
      count: 1,
    })
  }
  return [...groups.values()].sort((a, b) => {
    if ((a.key === 'anonymous') !== (b.key === 'anonymous')) {
      return a.key === 'anonymous' ? 1 : -1
    }
    return b.count - a.count
  })
})

const filteredTrips = computed(() => {
  const keyword = tripsSearch.value.trim().toLowerCase()
  return trips.value.filter((item) => {
    if (selectedUserKey.value !== 'all' && (item.user_id || 'anonymous') !== selectedUserKey.value) {
      return false
    }
    if (tripsStatusFilter.value !== 'all' && (item.status || 'processing') !== tripsStatusFilter.value) {
      return false
    }
    if (!keyword) return true
    const nickname = (item.nickname || t('admin.trips.anonymous')).toLowerCase()
    const city = (item.city || '').toLowerCase()
    return nickname.includes(keyword) || city.includes(keyword)
  })
})

const loadTrips = async () => {
  tripsLoading.value = true
  try {
    trips.value = await adminGetAllTrips()
    if (
      selectedUserKey.value !== 'all' &&
      !trips.value.some((item) => (item.user_id || 'anonymous') === selectedUserKey.value)
    ) {
      selectedUserKey.value = 'all'
    }
  } catch (error: any) {
    if (isAdminAuthError(error)) {
      props.onUnauthorized()
      return
    }
    message.error(error?.message || t('admin.trips.loadFailed'))
  } finally {
    tripsLoading.value = false
  }
}

onMounted(() => {
  void loadTrips()
})
</script>

<style scoped>
.admin-trips-panel {
  width: 100%;
}

.admin-trips-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.admin-panel-title {
  margin: 0;
  color: #3d3229;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
}

.admin-trips-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.admin-trips-search {
  width: 240px;
}

.admin-trips-status-filter {
  width: 126px;
}

.trips-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.trips-users {
  display: flex;
  width: 224px;
  max-height: 560px;
  flex: 0 0 224px;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 8px;
  background: #faf9f5;
}

.trips-user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease;
}

.trips-user-item:hover {
  background: rgba(61, 50, 41, 0.05);
}

.trips-user-item:focus-visible,
.trip-card:focus-visible,
.trip-action-btn:focus-visible {
  outline: 3px solid rgba(196, 96, 61, 0.55);
  outline-offset: 2px;
}

.trips-user-item.active {
  background: #fff;
  box-shadow: 0 1px 6px rgba(61, 50, 41, 0.08);
}

.trips-user-item.active .trips-user-label {
  color: #a94d2e;
  font-weight: 600;
}

.trips-user-avatar,
.trip-card-owner-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #c4603d;
  color: #fff;
  font-weight: 700;
}

.trips-user-avatar {
  width: 30px;
  height: 30px;
  font-size: 13px;
}

.trips-user-avatar.all {
  background: #3d3229;
  font-size: 14px;
}

.trips-user-avatar.anonymous,
.trip-card-owner-avatar.anonymous {
  background: #ece7df;
  color: #8a8178;
}

.trips-user-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #3d3229;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trips-user-count {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(61, 50, 41, 0.06);
  color: #8a8178;
  font-size: 12px;
}

.trips-list {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
}

.trip-card {
  padding: 16px 20px;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.trip-card:hover {
  border-color: rgba(217, 119, 87, 0.45);
  box-shadow: 0 6px 20px rgba(61, 50, 41, 0.08);
  transform: translateY(-1px);
}

.trip-card-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.trip-card-info {
  min-width: 0;
}

.trip-card-city {
  color: #3d3229;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.45;
}

.trip-card-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 6px;
  color: #8a8178;
  font-size: 13px;
}

.trip-card-owner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #6e655d;
}

.trip-card-owner-avatar {
  width: 20px;
  height: 20px;
  font-size: 11px;
}

.trip-card-side {
  display: flex;
  align-items: flex-end;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 8px;
}

.trip-status {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.trip-status.completed {
  background: rgba(82, 160, 106, 0.12);
  color: #3e7d54;
}

.trip-status.processing {
  background: rgba(217, 119, 87, 0.14);
  color: #a94d2e;
}

.trip-status.failed {
  background: rgba(196, 74, 54, 0.1);
  color: #a53928;
}

.trip-updated {
  color: #8a8178;
  font-size: 12px;
  white-space: nowrap;
}

.trip-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.07);
}

.trip-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.trip-action-btn.view {
  border-color: rgba(217, 119, 87, 0.3);
  color: #a94d2e;
}

.trip-action-btn.view:hover {
  border-color: rgba(217, 119, 87, 0.5);
  background: rgba(217, 119, 87, 0.1);
}

.trip-action-btn.delete {
  border-color: rgba(196, 74, 54, 0.25);
  color: #a53928;
}

.trip-action-btn.delete:hover {
  border-color: rgba(196, 74, 54, 0.45);
  background: rgba(196, 74, 54, 0.08);
}

.trip-action-btn:disabled {
  border-color: rgba(61, 50, 41, 0.12);
  background: transparent;
  color: #b5ada4;
  cursor: not-allowed;
}

.trips-empty {
  padding: 56px 0;
  color: #8a8178;
  font-size: 13px;
  text-align: center;
}

@media (max-width: 900px) {
  .trips-layout {
    flex-direction: column;
  }

  .trips-users {
    width: 100%;
    max-height: none;
    flex: none;
    flex-direction: row;
    overflow-x: auto;
  }

  .trips-user-item {
    width: auto;
    flex: 0 0 auto;
  }

  .trips-user-label {
    max-width: 96px;
  }
}

@media (max-width: 760px) {
  .admin-trips-head {
    align-items: stretch;
    margin-bottom: 20px;
  }

  .admin-panel-title {
    width: 100%;
    font-size: 20px;
  }

  .admin-trips-toolbar {
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .admin-trips-search {
    width: 100%;
    grid-column: 1 / -1;
  }

  .admin-trips-status-filter {
    width: 100%;
  }

  .trip-card {
    padding: 14px;
  }

  .trip-card-main {
    flex-direction: column;
  }

  .trip-card-side {
    align-items: center;
    flex-direction: row;
  }

  .trip-card-actions {
    flex-wrap: wrap;
  }
}
</style>
