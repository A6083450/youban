<template>
  <div class="result-container" :class="{ 'result-container--readonly': props.readonly }">
    <div class="lower-shade"></div>

    <main class="result-main">
      <div v-if="tripPlan" class="content-wrapper">
        <div class="top-switch-nav">
          <div class="top-switch-menu-wrap">
            <a-menu class="top-switch-menu" mode="horizontal" :disabled-overflow="true" :selected-keys="[activeSection]" @click="scrollToSection">
              <a-menu-item key="overview" :aria-selected="activeSection === 'overview'">
                <span>{{ t('result.side.overview') }}</span>
              </a-menu-item>
              <a-menu-item key="knowledge-graph" :aria-selected="activeSection === 'knowledge-graph'">
                <span>{{ t('result.side.graph') }}</span>
              </a-menu-item>
              <a-menu-item key="days" :aria-selected="activeSection === 'days'">
                <span>{{ t('result.side.days') }}</span>
              </a-menu-item>
              <a-menu-item key="map" :aria-selected="activeSection === 'map'">
                <span>{{ t('result.side.map') }}</span>
              </a-menu-item>
              <a-menu-item key="budget" v-if="tripPlan.budget" :aria-selected="activeSection === 'budget'">
                <span>{{ t('result.side.budget') }}</span>
              </a-menu-item>
              <a-menu-item
                key="weather"
                v-if="tripPlan.weather_info && tripPlan.weather_info.length > 0"
                :aria-selected="activeSection === 'weather'"
              >
                <span>{{ t('result.side.weather') }}</span>
              </a-menu-item>
            </a-menu>
          </div>

          <div class="top-switch-actions">
            <a-space :size="4" wrap>
              <a-button
                v-if="!props.readonly && planId"
                type="default"
                class="action-btn"
                :loading="sharePublishing"
                @click="openShareModal"
              >
                <ShareAltOutlined class="action-icon" />
                {{ t('result.share.button') }}
              </a-button>
              <a-button type="default" @click="exportAsImage" class="action-btn">
                <svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {{ t('result.exportImage') }}
              </a-button>
            </a-space>
          </div>
        </div>

        <a-alert
          v-if="props.readonly"
          type="info"
          show-icon
          :message="t('result.share.readonlyBanner')"
          class="readonly-banner"
        >
          <template #action>
            <a-button type="link" size="small" @click="goBack">
              {{ t('result.share.readonlyCta') }}
            </a-button>
          </template>
        </a-alert>

      <!-- 主内容区 -->
        <section
          v-show="activeSection === 'overview'"
          id="overview"
          class="overview-card"
          :aria-label="t('result.side.overview')"
        >
          <div v-if="overviewAttractions.length > 0" class="overview-grid">
            <OverviewAttractionCard
              v-for="(item, index) in overviewAttractions"
              :key="`${item.dayArrayIndex}-${item.order}-${item.name}`"
              :item="item"
              :image-src="getAttractionImage(item.name, index)"
              :visual-index="index"
              @image-error="handleImageError"
              @select-day="goToDayFromOverview"
            />
          </div>
          <a-empty v-else :description="t('common.noData')" />
          <div class="overview-meta">
            <span class="overview-meta-item overview-meta-item--accent">
              {{ t('result.dateRange', { start: tripPlan.start_date, end: tripPlan.end_date }) }}
            </span>
            <span v-if="planId" class="overview-meta-item">
              Plan ID: {{ planId }}
            </span>
            <span v-if="tripPlan.overall_suggestions" class="overview-meta-item">
              {{ tripPlan.overall_suggestions }}
            </span>
          </div>
        </section>

        <!-- 顶部信息区:预算/地图 -->
        <div class="top-info-section" v-show="['budget', 'map'].includes(activeSection)">
          <div class="left-info" v-show="activeSection === 'budget'">
            <a-card
              v-show="activeSection === 'budget' && !!tripPlan.budget"
              id="budget"
              v-if="tripPlan.budget"
              :bordered="false"
              class="budget-card section-shellless"
            >
              <div class="budget-detail-panel">
                <div class="budget-toolbar">
                  <div class="budget-toolbar-item">
                    <span class="budget-toolbar-label">{{ t('result.budget.filterLabel') }}</span>
                    <a-select v-model:value="budgetFilterType" size="small" class="budget-select">
                      <a-select-option value="all">{{ t('result.budget.filterAll') }}</a-select-option>
                      <a-select-option value="attraction">{{ t('result.budget.attraction') }}</a-select-option>
                      <a-select-option value="hotel">{{ t('result.budget.hotel') }}</a-select-option>
                      <a-select-option value="meal">{{ t('result.budget.meal') }}</a-select-option>
                      <a-select-option value="transport">{{ t('result.budget.transport') }}</a-select-option>
                    </a-select>
                  </div>
                  <div class="budget-toolbar-item">
                    <span class="budget-toolbar-label">{{ t('result.budget.sortLabel') }}</span>
                    <a-select v-model:value="budgetSortMode" size="small" class="budget-select">
                      <a-select-option value="amountDesc">{{ t('result.budget.sortAmountDesc') }}</a-select-option>
                      <a-select-option value="amountAsc">{{ t('result.budget.sortAmountAsc') }}</a-select-option>
                      <a-select-option value="dayAsc">{{ t('result.budget.sortDayAsc') }}</a-select-option>
                      <a-select-option value="dayDesc">{{ t('result.budget.sortDayDesc') }}</a-select-option>
                    </a-select>
                  </div>
                </div>

                <div v-if="filteredBudgetItems.length > 0" class="budget-detail-list">
                  <div
                    class="budget-detail-row budget-detail-header"
                    :class="{ 'budget-detail-row--readonly': props.readonly }"
                  >
                    <span>{{ t('result.budget.detailType') }}</span>
                    <span>{{ t('result.budget.detailDay') }}</span>
                    <span>{{ t('result.budget.detailName') }}</span>
                    <span>{{ t('result.budget.detailAmount') }}</span>
                    <span v-if="!props.readonly">{{ t('result.budget.detailAction') }}</span>
                  </div>
                  <div
                    v-for="item in filteredBudgetItems"
                    :key="item.id"
                    class="budget-detail-row"
                    :class="{ 'budget-detail-row--readonly': props.readonly }"
                  >
                    <span class="budget-detail-type">{{ getBudgetTypeLabel(item.type) }}</span>
                    <span class="budget-detail-day">
                      {{ item.dayNumber ? t('common.dayNumber', { day: item.dayNumber }) : '--' }}
                    </span>
                    <span class="budget-detail-name">{{ item.name }}</span>
                    <span class="budget-detail-amount">¥{{ formatBudgetAmount(item.amount) }}</span>
                    <span v-if="!props.readonly" class="budget-action-wrap">
                      <button
                        type="button"
                        class="budget-icon-btn budget-edit-btn"
                        :title="t('result.budget.editPrice')"
                        @click="editBudgetItemAmount(item)"
                      >
                        <svg fill="currentColor" width="20px" height="20px" viewBox="0 0 256.00098 256.00098" id="Flat" xmlns="http://www.w3.org/2000/svg">
                          <path d="M216.001,203.833h-76l27.91015-27.90967.00684-.00635.00635-.00683,56.563-56.5625a28.03348,28.03348,0,0,0-.001-39.59766L179.23145,34.49512a28.03347,28.03347,0,0,0-39.59766,0L83.07471,91.0542l-.01026.00928-.00927.01025L26.49609,147.63281a28.03171,28.03171,0,0,0,0,39.59766L63.585,224.31836a12.00286,12.00286,0,0,0,8.48535,3.51465H216.001a12,12,0,0,0,0-24ZM156.60449,51.46582a4.00207,4.00207,0,0,1,5.65625,0L207.51562,96.7207a4.005,4.005,0,0,1,0,5.65723l-48.083,48.083L108.521,99.54932ZM106.05957,203.833H77.041L43.4668,170.25977a4.00385,4.00385,0,0,1,0-5.65625L91.55029,116.52l50.91114,50.91113Z"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="budget-icon-btn budget-delete-btn"
                        :title="t('common.delete')"
                        @click="deleteBudgetItem(item)"
                      >
                        <svg fill="currentColor" width="21px" height="21px" viewBox="0 0 256 256" id="Flat" xmlns="http://www.w3.org/2000/svg">
                          <path d="M215.99609,48H180V36A28.03146,28.03146,0,0,0,152,8H104A28.03146,28.03146,0,0,0,76,36V48H39.99609a12,12,0,0,0,0,24h4V208a20.0226,20.0226,0,0,0,20,20h128a20.0226,20.0226,0,0,0,20-20V72h4a12,12,0,0,0,0-24ZM100,36a4.00458,4.00458,0,0,1,4-4h48a4.00458,4.00458,0,0,1,4,4V48H100Zm87.99609,168h-120V72h120ZM116,104v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Zm48,0v64a12,12,0,0,1-24,0V104a12,12,0,0,1,24,0Z"/>
                        </svg>
                      </button>
                    </span>
                  </div>
                </div>
                <a-empty v-else :description="t('result.budget.noDetails')" />
              </div>
            </a-card>
          </div>

          <div class="right-budget-summary" v-show="activeSection === 'budget' && !!tripPlan.budget">
            <div class="budget-summary-panel">
              <div class="budget-summary-title">{{ t('result.budget.title') }}</div>
              <div class="budget-summary-total-wrap">
                <span class="budget-summary-currency">¥</span>
                <span class="budget-summary-total-value">{{ formatBudgetAmount(tripPlan.budget?.total ?? 0) }}</span>
              </div>
              <div class="budget-summary-sub-grid">
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(tripPlan.budget?.total_attractions ?? 0) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.attraction') }}</div>
                </div>
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(tripPlan.budget?.total_hotels ?? 0) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.hotel') }}</div>
                </div>
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(tripPlan.budget?.total_meals ?? 0) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.meal') }}</div>
                </div>
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(tripPlan.budget?.total_transportation ?? 0) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.transport') }}</div>
                </div>
                <div v-if="tripPlan.budget?.total_inter_city_transport" class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(tripPlan.budget.total_inter_city_transport) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.interCityTransport') }}</div>
                </div>
              </div>

              <div v-if="!props.readonly" class="budget-pending-wrap">
                <div class="budget-pending-title">{{ t('result.budget.pendingTitle') }}</div>
                <div v-if="pendingBudgetItems.length === 0" class="budget-pending-empty">
                  {{ t('result.budget.pendingEmpty') }}
                </div>
                <div v-else class="budget-pending-list">
                  <div
                    v-for="pendingItem in pendingBudgetItems"
                    :key="pendingItem.uid"
                    class="budget-pending-item"
                  >
                    <span class="budget-pending-name">{{ pendingItem.base.name }}</span>
                    <a-button
                      type="link"
                      size="small"
                      class="budget-restore-btn"
                      @click="restoreBudgetItem(pendingItem)"
                    >
                      {{ t('result.budget.restore') }}
                    </a-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="right-map" v-show="activeSection === 'map'">
            <a-card id="map" :bordered="false" class="map-card section-shellless">
              <div v-show="mapProviderType === 'google'" id="google-map-container" style="width: 100%; height: 100%"></div>
              <div v-show="mapProviderType === 'amap'" id="amap-container" style="width: 100%; height: 100%"></div>
              <transition name="map-loading-fade">
                <div v-if="mapLoading" class="map-loading-mask">
                  <div class="map-loading-spinner" aria-hidden="true">
                    <span class="map-loading-spinner__ring"></span>
                    <span class="map-loading-spinner__pin"></span>
                  </div>
                  <transition name="map-loading-text" mode="out-in">
                    <div :key="mapLoadingText" class="map-loading-text">{{ mapLoadingText }}</div>
                  </transition>
                </div>
              </transition>
              <div v-if="tripPlan && tripPlan.days.length > 1" class="map-day-legend">
                <span v-for="(_, di) in tripPlan.days" :key="di" class="map-day-legend__item">
                  <span class="map-day-legend__dot" :style="{ backgroundColor: getMapDayColor(di + 1) }"></span>{{ t('result.mapInfo.dayTitle', { day: di + 1 }) }}
                </span>
              </div>
            </a-card>
          </div>
        </div>

        <!-- 旅行蓝图 -->
        <section v-show="activeSection === 'knowledge-graph'" id="knowledge-graph" class="flow-card">
          <TripFlow :trip-plan="tripPlan" @select-day="goToDayFromOverview" />
        </section>

        <!-- 每日行程 -->
        <section v-show="activeSection === 'days'" class="days-card">
          <DailyItinerary
            :trip-plan="tripPlan"
            :attraction-photos="attractionPhotos"
            @image-error="handleImageError"
          />
        </section>

        <a-card
          v-show="activeSection === 'weather' && tripPlan.weather_info && tripPlan.weather_info.length > 0"
          id="weather"
          v-if="tripPlan.weather_info && tripPlan.weather_info.length > 0"
          :bordered="false"
          class="section-shellless weather-section-card"
        >
          <div v-if="selectedWeather" class="weather-dashboard">
            <div class="weather-grid">
              <WeatherDayCard
                v-for="(item, index) in weatherList"
                :key="`${item.date}-${index}`"
                :weather="item"
                :day-number="index + 1"
                :active="index === activeWeatherIndex"
                :locale-tag="localeTag"
                @select="(dayNumber) => selectWeatherDay(dayNumber - 1)"
              />
            </div>
          </div>
        </a-card>
      </div>

      <div v-else class="empty-state-panel">
        <a-empty :description="t('result.noTripPlan')">
          <template #description>
            <span class="empty-desc">{{ t('result.noTripPlanDesc') }}</span>
          </template>
          <a-button class="empty-back-btn" type="primary" @click="goBack">{{ t('result.backCreateTrip') }}</a-button>
        </a-empty>
      </div>
    </main>

    <!-- 回到顶部按钮 -->
    <a-back-top :visibility-height="300">
      <div class="back-top-button">
        Top
      </div>
    </a-back-top>

    <PlanChatPanel
      v-if="!props.readonly"
      :trip-plan="tripPlan"
      :plan-id="planId"
      @apply-plan="applyAgentPlan"
      @restore-plan="applyAgentPlan"
    />
    <SharePlanModal
      v-if="!props.readonly"
      v-model:open="shareModalOpen"
      :share-code="shareCode"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { ShareAltOutlined } from '@ant-design/icons-vue'
import AMapLoader from '@amap/amap-jsapi-loader'
import { Loader as GoogleMapsLoader } from '@googlemaps/js-api-loader'
import html2canvas from 'html2canvas'
import OverviewAttractionCard from '@/components/OverviewAttractionCard.vue'
import PlanChatPanel from '@/components/PlanChatPanel.vue'
import SharePlanModal from '@/components/SharePlanModal.vue'
import WeatherDayCard from '@/components/WeatherDayCard.vue'
import TripFlow from '@/components/TripFlow.vue'
import DailyItinerary from '@/components/DailyItinerary.vue'
import type {
  Attraction,
  Hotel,
  Meal,
  ShareLoadErrorKind,
  TripPlan,
  TripPlanResponse,
  WeatherInfo,
} from '@/types'
import {
  createTripShare,
  getRuntimeApiBaseUrl,
  getRuntimeMapJsKey,
  getRuntimeGoogleMapsApiKey,
  getBackendRuntimeSettings,
  getSharedTripPlan,
  pollTaskStatus,
  RUNTIME_SETTINGS_UPDATED_EVENT,
  SharedTripPlanError,
  TripShareCreationError,
} from '@/services/api'
import { canUseCachedPlan } from '@/utils/planConversation.js'
import { normalizeReferenceTime, resolveTripBlueprint } from '@/utils/tripPresentation.js'

const props = withDefaults(defineProps<{ planId?: string; readonly?: boolean }>(), {
  readonly: false,
})
const emit = defineEmits<{
  (event: 'share-load-error', kind: ShareLoadErrorKind): void
}>()
const router = useRouter()
const { t, locale } = useI18n()
const tripPlan = ref<TripPlan | null>(null)
const planId = ref('')
const attractionPhotos = ref<Record<string, string>>({})
const activeSection = ref('overview')
const pendingDayScrollIndex = ref<number | null>(null)
const shareModalOpen = ref(false)
const sharePublishing = ref(false)
const shareCode = ref('')
let map: any = null
let googleMap: google.maps.Map | null = null
let googleMarkers: google.maps.Marker[] = []
let googlePolylines: google.maps.Polyline[] = []
let googleInfoWindows: google.maps.InfoWindow[] = []
let googleDirectionsRenderers: google.maps.DirectionsRenderer[] = []
const mapProviderType = ref<'google' | 'amap'>('amap')
const mapLoading = ref(false)
const mapLoadingText = ref('')

const openShareModal = async (): Promise<void> => {
  if (!planId.value || sharePublishing.value) return

  sharePublishing.value = true
  try {
    const publication = await createTripShare(planId.value)
    shareCode.value = publication.share_code
    shareModalOpen.value = true
  } catch (error: unknown) {
    message.error(
      error instanceof TripShareCreationError
        ? error.message
        : t('result.share.createFailed'),
    )
  } finally {
    sharePublishing.value = false
  }
}

type OverviewAttractionItem = {
  name: string
  address: string
  visit_duration: number
  description: string
  ticket_price?: number
  dayNumber: number
  dayArrayIndex: number
  order: number
}

type BudgetItemType = 'attraction' | 'hotel' | 'meal' | 'transport'
type BudgetSortMode = 'amountDesc' | 'amountAsc' | 'dayAsc' | 'dayDesc'

type BudgetDetailItem = {
  id: string
  type: BudgetItemType
  dayIndex: number | null
  dayNumber: number | null
  name: string
  amount: number
  sourceIndex?: number
}

type BudgetRestorePayload =
  | {
      type: 'attraction'
      attraction: Attraction
      insertIndex: number
    }
  | {
      type: 'meal'
      meal: Meal
      insertIndex: number
    }
  | {
      type: 'hotel'
      hotel: Hotel
      accommodation: string
    }
  | {
      type: 'transport'
      transportation: string
    }

type BudgetRestoreItem = {
  uid: string
  base: BudgetDetailItem
  payload: BudgetRestorePayload
}

const budgetFilterType = ref<'all' | BudgetItemType>('all')
const budgetSortMode = ref<BudgetSortMode>('amountDesc')
const pendingBudgetItems = ref<BudgetRestoreItem[]>([])
const activeWeatherIndex = ref(0)

const localeTag = computed(() => {
  const currentLocale = String(locale.value || 'en').toLowerCase()
  if (currentLocale.startsWith('zh')) return 'zh-CN'
  if (currentLocale.startsWith('ja')) return 'ja-JP'
  return 'en-US'
})

const weatherList = computed<WeatherInfo[]>(() => tripPlan.value?.weather_info ?? [])

const selectedWeather = computed<WeatherInfo | null>(() => {
  const list = weatherList.value
  if (list.length === 0) return null
  const safeIndex = Math.min(Math.max(activeWeatherIndex.value, 0), list.length - 1)
  return list[safeIndex]
})

const selectWeatherDay = (index: number) => {
  if (index < 0 || index >= weatherList.value.length) return
  activeWeatherIndex.value = index
}

watch(
  weatherList,
  (list) => {
    if (list.length === 0) {
      activeWeatherIndex.value = 0
      return
    }

    if (activeWeatherIndex.value > list.length - 1) {
      activeWeatherIndex.value = 0
    }
  },
  { immediate: true }
)

const overviewAttractions = computed<OverviewAttractionItem[]>(() => {
  if (!tripPlan.value) return []

  const items: OverviewAttractionItem[] = []
  tripPlan.value.days.forEach((day, dayArrayIndex) => {
    const dayNumber = dayArrayIndex + 1

    day.attractions.forEach((attraction, order) => {
      items.push({
        name: attraction.name,
        address: attraction.address,
        visit_duration: attraction.visit_duration,
        description: attraction.description,
        ticket_price: attraction.ticket_price,
        dayNumber,
        dayArrayIndex,
        order,
      })
    })
  })
  return items
})

// 加载所有景点图片
const loadAttractionPhotos = async () => {
  if (!tripPlan.value) return

  const apiBase = getRuntimeApiBaseUrl()
  const uniqueNames = Array.from(
    new Set(
      tripPlan.value.days.flatMap((day) => day.attractions.map((attraction) => attraction.name))
    )
  ).filter((name) => name && !attractionPhotos.value[name])

  if (uniqueNames.length === 0) return

  // 多城市行程按景点所在城市查询，单城市回退到整体城市
  const cityOfAttraction = (name: string): string => {
    for (const day of tripPlan.value!.days) {
      if (day.attractions.some((a) => a.name === name)) {
        return (day as { city?: string }).city || tripPlan.value!.city
      }
    }
    return tripPlan.value!.city
  }

  // 并发 2:高德 Web 服务有 QPS 限制,并发过高会导致部分景点取不到图
  const concurrencyLimit = 2

  const sweep = async (names: string[]) => {
    let currentIndex = 0

    const loadNextPhoto = async () => {
      while (currentIndex < names.length) {
        const index = currentIndex
        currentIndex += 1
        const name = names[index]
        const city = cityOfAttraction(name)

        try {
          const response = await fetch(
            `${apiBase}/api/poi/photo?name=${encodeURIComponent(name)}&city=${encodeURIComponent(city)}`
          )
          const data = await response.json()
          if (data.success && data.data.photo_url) {
            const url = String(data.data.photo_url)
            attractionPhotos.value[name] = url.startsWith('/') ? `${apiBase}${url}` : url
          }
        } catch (err) {
          console.error(`获取${name}图片失败:`, err)
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrencyLimit, names.length) },
      () => loadNextPhoto()
    )
    await Promise.all(workers)
  }

  await sweep(uniqueNames)

  // 高德限流/网络抖动可能漏图,延迟后自动补一轮,避免必须刷新页面才能看到
  const missing = uniqueNames.filter((name) => !attractionPhotos.value[name])
  if (missing.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await sweep(missing)
  }
}

// 获取景点图片（仅返回高德真实图片，无图片时返回空字符串）
const getAttractionImage = (name: string, _index: number): string => {
  return attractionPhotos.value[name] || ''
}

// 图片加载失败时清空缓存，让卡片回退到占位图（重新进入页面会重新拉取）
const handleImageError = (name: string) => {
  delete attractionPhotos.value[name]
}

const applyTripPlanPayload = async (payload: {
  plan: TripPlan
  planId?: string
}) => {
  tripPlan.value = payload.plan
  pendingBudgetItems.value = []

  if (payload.planId) {
    planId.value = payload.planId
    sessionStorage.setItem('planId', payload.planId)
  }

  sessionStorage.setItem('tripPlan', JSON.stringify(payload.plan))

  await loadAttractionPhotos()
  if (activeSection.value === 'map') await ensureMapReady()
}

// Agent 对话修改计划:应用新计划并重算预算、刷新当前区块
const applyAgentPlan = async (plan: TripPlan) => {
  await applyTripPlanPayload({
    plan,
    planId: planId.value,
  })
  recalculateBudgetTotals()
  if (tripPlan.value) {
    sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))
  }
  message.success(t('result.agent.changesTitle'))
}

const restoreTripPlanFromResponse = async (response?: TripPlanResponse | null) => {
  if (!response?.data) return false
  await applyTripPlanPayload({
    plan: response.data,
    planId: String(response.plan_id || planId.value || ''),
  })
  return true
}

const destroyCurrentMap = () => {
  // 清理 Google Maps
  googleInfoWindows.forEach((iw) => { try { iw.close() } catch {} })
  googleInfoWindows = []
  googleMarkers.forEach((m) => { try { m.setMap(null) } catch {} })
  googleMarkers = []
  googlePolylines.forEach((p) => { try { p.setMap(null) } catch {} })
  googlePolylines = []
  googleDirectionsRenderers.forEach((r) => { try { r.setMap(null) } catch {} })
  googleDirectionsRenderers = []
  googleMap = null

  // 清理高德地图
  if (map) {
    try { map.destroy() } catch {}
    map = null
  }
}

const ensureMapReady = async () => {
  await nextTick()
  // Google Maps 优先检测
  if (mapProviderType.value === 'google' && googleMap) {
    google.maps.event.trigger(googleMap, 'resize')
    return
  }
  if (mapProviderType.value === 'amap' && map) {
    if (typeof map.resize === 'function') {
      map.resize()
    }
    return
  }
  // 都不存在则初始化
  await initMap()
}

const handleRuntimeSettingsUpdated = () => {
  destroyCurrentMap()
  if (activeSection.value === 'map') {
    void nextTick(async () => {
      await ensureMapReady()
    })
  }
}

const loadPlanById = async (targetPlanId: string) => {
  destroyCurrentMap()
  tripPlan.value = null
  pendingBudgetItems.value = []
  attractionPhotos.value = {}
  activeSection.value = 'overview'
  pendingDayScrollIndex.value = null

  const data = sessionStorage.getItem('tripPlan')
  const storedPlanId = String(sessionStorage.getItem('planId') || '')
  const canUseCachedData = canUseCachedPlan(data, storedPlanId, targetPlanId)

  planId.value = targetPlanId
  if (targetPlanId) {
    sessionStorage.setItem('planId', targetPlanId)
  }

  if (props.readonly) {
    try {
      const task = await getSharedTripPlan(targetPlanId)
      if (task?.status === 'completed' && task.result) {
        await restoreTripPlanFromResponse(task.result)
      }
    } catch (error: unknown) {
      const kind = error instanceof SharedTripPlanError ? error.kind : 'network'
      emit('share-load-error', kind)
    }
    return
  }

  if (data && canUseCachedData) {
    await applyTripPlanPayload({
      plan: JSON.parse(data),
      planId: targetPlanId || storedPlanId,
    })
    return
  }

  if (targetPlanId) {
    try {
      const task = await pollTaskStatus(targetPlanId)
      if (task?.status === 'completed' && task.result) {
        const restored = await restoreTripPlanFromResponse(task.result)
        if (restored) return
      }
      if (task?.status === 'failed') {
        message.error(task.error || t('result.noTripPlanDesc'))
      }
    } catch (error) {
      console.error('结果页从后端回补旅行计划失败:', error)
    }
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener(RUNTIME_SETTINGS_UPDATED_EVENT, handleRuntimeSettingsUpdated)
  }
})

watch(
  () => props.planId,
  async (newId) => {
    const storedPlanId = String(sessionStorage.getItem('planId') || '')
    const targetPlanId = String(newId || storedPlanId || '')
    if (!targetPlanId || targetPlanId === planId.value) return
    await loadPlanById(targetPlanId)
  },
  { immediate: true }
)

watch(activeSection, async (section) => {
  if (!tripPlan.value) return
  await nextTick()
  const main = document.querySelector<HTMLElement>('.main-area')
  const targetIndex = pendingDayScrollIndex.value
  if (section === 'days' && targetIndex !== null && main) {
    const target = document.getElementById(`daily-day-${targetIndex}`)
    const navigation = document.querySelector<HTMLElement>('.top-switch-nav')
    if (target && navigation) {
      const offset = target.getBoundingClientRect().top - navigation.getBoundingClientRect().bottom
      main.scrollTo({ top: Math.max(0, main.scrollTop + offset - 12), behavior: 'auto' })
    } else {
      main.scrollTo({ top: 0, behavior: 'auto' })
    }
    pendingDayScrollIndex.value = null
  } else {
    main?.scrollTo({ top: 0, behavior: 'auto' })
  }
  if (section === 'map') await ensureMapReady()
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener(RUNTIME_SETTINGS_UPDATED_EVENT, handleRuntimeSettingsUpdated)
  }
  destroyCurrentMap()
})

const goBack = () => {
  router.push('/')
}

// 滚动到指定区域
const scrollToSection = ({ key }: { key: string }) => {
  if (key.startsWith('day-')) {
    const dayIndex = Number(key.replace('day-', ''))
    if (!Number.isNaN(dayIndex)) {
      pendingDayScrollIndex.value = dayIndex
      activeSection.value = 'days'
      return
    }
  }

  activeSection.value = key
}

const goToDayFromOverview = (dayArrayIndex: number) => {
  pendingDayScrollIndex.value = dayArrayIndex
  activeSection.value = 'days'
}

const getMealLabel = (type: string): string => {
  const labels: Record<string, string> = {
    breakfast: t('result.meals.breakfast'),
    lunch: t('result.meals.lunch'),
    dinner: t('result.meals.dinner'),
    snack: t('result.meals.snack')
  }
  return labels[type] || type
}

const toBudgetNumber = (value: unknown): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return numeric
}

const roundBudgetAmount = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const formatBudgetAmount = (value: number): string => {
  const rounded = roundBudgetAmount(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
}

const getBudgetTypeLabel = (type: BudgetItemType): string => {
  const labels: Record<BudgetItemType, string> = {
    attraction: t('result.budget.attraction'),
    hotel: t('result.budget.hotel'),
    meal: t('result.budget.meal'),
    transport: t('result.budget.transport'),
  }
  return labels[type]
}

const cloneData = <T>(data: T): T => JSON.parse(JSON.stringify(data)) as T

const recalculateBudgetTotals = (transportationOverride?: number) => {
  if (!tripPlan.value) return

  let attractionTotal = 0
  let hotelTotal = 0
  let mealTotal = 0

  tripPlan.value.days.forEach((day) => {
    day.attractions.forEach((attraction) => {
      attractionTotal += toBudgetNumber(attraction.ticket_price)
    })

    if (day.hotel) {
      hotelTotal += toBudgetNumber(day.hotel.estimated_cost)
    }

    (day.meals ?? []).forEach((meal) => {
      mealTotal += toBudgetNumber(meal.estimated_cost)
    })
  })

  const transportationTotal = roundBudgetAmount(
    transportationOverride ?? toBudgetNumber(tripPlan.value.budget?.total_transportation)
  )

  tripPlan.value.budget = {
    total_attractions: roundBudgetAmount(attractionTotal),
    total_hotels: roundBudgetAmount(hotelTotal),
    total_meals: roundBudgetAmount(mealTotal),
    total_transportation: transportationTotal,
    total: roundBudgetAmount(attractionTotal + hotelTotal + mealTotal + transportationTotal),
  }
}

const budgetItems = computed<BudgetDetailItem[]>(() => {
  if (!tripPlan.value) return []

  const items: BudgetDetailItem[] = []

  tripPlan.value.days.forEach((day, dayIndex) => {
    const dayNumber = dayIndex + 1

    day.attractions.forEach((attraction, attractionIndex) => {
      const amount = roundBudgetAmount(toBudgetNumber(attraction.ticket_price))
      if (amount <= 0) return
      items.push({
        id: `attraction-${dayIndex}-${attractionIndex}`,
        type: 'attraction',
        dayIndex,
        dayNumber,
        name: attraction.name,
        amount,
        sourceIndex: attractionIndex,
      })
    })

    if (day.hotel) {
      const amount = roundBudgetAmount(toBudgetNumber(day.hotel.estimated_cost))
      if (amount > 0) {
        items.push({
          id: `hotel-${dayIndex}`,
          type: 'hotel',
          dayIndex,
          dayNumber,
          name: day.hotel.name,
          amount,
        })
      }
    }

    (day.meals ?? []).forEach((meal, mealIndex) => {
      const amount = roundBudgetAmount(toBudgetNumber(meal.estimated_cost))
      if (amount <= 0) return
      items.push({
        id: `meal-${dayIndex}-${mealIndex}`,
        type: 'meal',
        dayIndex,
        dayNumber,
        name: `${getMealLabel(meal.type)} · ${meal.name}`,
        amount,
        sourceIndex: mealIndex,
      })
    })
  })

  const transportTotal = roundBudgetAmount(toBudgetNumber(tripPlan.value.budget?.total_transportation))
  const transportDays = tripPlan.value.days
    .map((day, dayIndex) => ({ day, dayIndex }))
    .filter(({ day }) => Boolean(day.transportation && day.transportation.trim()))

  if (transportTotal > 0 && transportDays.length > 0) {
    const avg = roundBudgetAmount(transportTotal / transportDays.length)
    let remaining = transportTotal

    transportDays.forEach(({ day, dayIndex }, index) => {
      const amount = index === transportDays.length - 1 ? remaining : Math.min(avg, remaining)
      remaining = roundBudgetAmount(remaining - amount)
      items.push({
        id: `transport-${dayIndex}`,
        type: 'transport',
        dayIndex,
        dayNumber: day.day_index + 1,
        name: day.transportation,
        amount: roundBudgetAmount(amount),
      })
    })
  }

  return items
})

const filteredBudgetItems = computed<BudgetDetailItem[]>(() => {
  let items = budgetItems.value

  if (budgetFilterType.value !== 'all') {
    items = items.filter((item) => item.type === budgetFilterType.value)
  }

  const sorted = [...items]
  sorted.sort((a, b) => {
    const dayA = a.dayNumber ?? Number.MAX_SAFE_INTEGER
    const dayB = b.dayNumber ?? Number.MAX_SAFE_INTEGER

    switch (budgetSortMode.value) {
      case 'amountAsc':
        return a.amount - b.amount
      case 'dayAsc':
        return dayA - dayB || b.amount - a.amount
      case 'dayDesc':
        return dayB - dayA || b.amount - a.amount
      case 'amountDesc':
      default:
        return b.amount - a.amount
    }
  })

  return sorted
})

const editBudgetItemAmount = (item: BudgetDetailItem) => {
  if (!tripPlan.value || item.dayIndex === null) return

  const day = tripPlan.value.days[item.dayIndex]
  if (!day) return

  const input = window.prompt(
    t('result.budget.editPrompt', {
      name: item.name,
      amount: formatBudgetAmount(item.amount),
    }),
    formatBudgetAmount(item.amount)
  )

  if (input === null) return

  const numeric = Number(input.trim())
  if (!Number.isFinite(numeric) || numeric < 0) {
    message.warning(t('result.messages.budgetInvalidAmount'))
    return
  }

  const nextAmount = roundBudgetAmount(numeric)
  if (nextAmount === roundBudgetAmount(item.amount)) return

  const confirmed = window.confirm(
    t('result.budget.editConfirm', {
      name: item.name,
      amount: formatBudgetAmount(nextAmount),
    })
  )
  if (!confirmed) return

  let changed = false

  if (item.type === 'attraction' && typeof item.sourceIndex === 'number' && day.attractions[item.sourceIndex]) {
    day.attractions[item.sourceIndex].ticket_price = nextAmount
    changed = true
  }

  if (item.type === 'meal' && typeof item.sourceIndex === 'number' && day.meals[item.sourceIndex]) {
    day.meals[item.sourceIndex].estimated_cost = nextAmount
    changed = true
  }

  if (item.type === 'hotel' && day.hotel) {
    day.hotel.estimated_cost = nextAmount
    changed = true
  }

  const transportationTotal =
    item.type === 'transport'
      ? Math.max(
          0,
          roundBudgetAmount(toBudgetNumber(tripPlan.value.budget?.total_transportation) - item.amount + nextAmount)
        )
      : undefined

  if (item.type === 'transport' && day.transportation && day.transportation.trim()) {
    changed = true
  }

  if (!changed) return

  recalculateBudgetTotals(transportationTotal)
  sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))
  message.success(t('result.messages.budgetAmountUpdated'))
}

const deleteBudgetItem = (item: BudgetDetailItem) => {
  if (!tripPlan.value || item.dayIndex === null) return

  const day = tripPlan.value.days[item.dayIndex]
  if (!day) return

  let changed = false
  let restorePayload: BudgetRestorePayload | null = null

  if (item.type === 'attraction' && typeof item.sourceIndex === 'number') {
    const attraction = day.attractions[item.sourceIndex]
    if (attraction) {
      restorePayload = {
        type: 'attraction',
        attraction: cloneData(attraction),
        insertIndex: item.sourceIndex,
      }
      day.attractions.splice(item.sourceIndex, 1)
      changed = true
    }
  }

  if (item.type === 'meal' && typeof item.sourceIndex === 'number') {
    const meal = day.meals[item.sourceIndex]
    if (meal) {
      restorePayload = {
        type: 'meal',
        meal: cloneData(meal),
        insertIndex: item.sourceIndex,
      }
      day.meals.splice(item.sourceIndex, 1)
      changed = true
    }
  }

  if (item.type === 'hotel') {
    if (day.hotel) {
      restorePayload = {
        type: 'hotel',
        hotel: cloneData(day.hotel),
        accommodation: day.accommodation || '',
      }
      day.hotel = undefined
      day.accommodation = ''
      changed = true
    }
  }

  if (item.type === 'transport') {
    if (day.transportation && day.transportation.trim()) {
      restorePayload = {
        type: 'transport',
        transportation: day.transportation,
      }
      day.transportation = ''
      changed = true
    }
  }

  if (!changed || !restorePayload) return

  pendingBudgetItems.value.unshift({
    uid: `${item.id}-${Date.now()}`,
    base: cloneData(item),
    payload: restorePayload,
  })

  const transportationTotal =
    item.type === 'transport'
      ? Math.max(
          0,
          roundBudgetAmount(
            toBudgetNumber(tripPlan.value.budget?.total_transportation) - roundBudgetAmount(item.amount)
          )
        )
      : undefined

  recalculateBudgetTotals(transportationTotal)
  sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))

  destroyCurrentMap()

  message.success(t('result.messages.budgetItemDeleted'))
}

const restoreBudgetItem = (pendingItem: BudgetRestoreItem) => {
  if (!tripPlan.value || pendingItem.base.dayIndex === null) return

  const day = tripPlan.value.days[pendingItem.base.dayIndex]
  if (!day) return

  let changed = false

  if (pendingItem.payload.type === 'attraction') {
    const insertAt = Math.max(0, Math.min(pendingItem.payload.insertIndex, day.attractions.length))
    day.attractions.splice(insertAt, 0, cloneData(pendingItem.payload.attraction))
    changed = true
  }

  if (pendingItem.payload.type === 'meal') {
    const insertAt = Math.max(0, Math.min(pendingItem.payload.insertIndex, day.meals.length))
    day.meals.splice(insertAt, 0, cloneData(pendingItem.payload.meal))
    changed = true
  }

  if (pendingItem.payload.type === 'hotel') {
    day.hotel = cloneData(pendingItem.payload.hotel)
    day.accommodation = pendingItem.payload.accommodation
    changed = true
  }

  if (pendingItem.payload.type === 'transport') {
    day.transportation = pendingItem.payload.transportation
    changed = true
  }

  if (!changed) return

  const transportationTotal =
    pendingItem.base.type === 'transport'
      ? roundBudgetAmount(toBudgetNumber(tripPlan.value.budget?.total_transportation) + pendingItem.base.amount)
      : undefined

  recalculateBudgetTotals(transportationTotal)
  pendingBudgetItems.value = pendingBudgetItems.value.filter((item) => item.uid !== pendingItem.uid)
  sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))

  destroyCurrentMap()

  message.success(t('result.messages.budgetItemRestored'))
}



// ========== 构建导出用的纯净 HTML ==========
const buildExportHTML = (mapDataUrl: string = ''): string => {
  if (!tripPlan.value) return ''
  const tp = tripPlan.value as TripPlan & {
    hotel_recommendations?: Array<{
      name?: string
      price?: number | string
      address?: string
    }>
  }

  const mealLabels: Record<string, string> = {
    breakfast: t('result.meals.breakfast'),
    lunch: t('result.meals.lunch'),
    dinner: t('result.meals.dinner'),
    snack: t('result.meals.snack'),
  }

  const blueprint = resolveTripBlueprint(tp)
  const blueprintStagesHTML = blueprint.stages.map((stage, index) => {
    const firstDay = stage.day_indices[0]
    const lastDay = stage.day_indices.at(-1)
    const dayRange = firstDay === undefined || lastDay === undefined
      ? ''
      : t('result.blueprint.dayRange', { start: firstDay + 1, end: lastDay + 1 })
    const title = stage.title || stage.cities.join(' / ') || `${index + 1}`
    const highlights = stage.highlights
      .slice(0, 3)
      .map((highlight) => `<span style="font-size:12px;color:#3D3229;background:#F5F0E8;padding:4px 8px;border-radius:4px;">${escapeHtml(highlight)}</span>`)
      .join('')

    return `
      <div style="flex:1;min-width:210px;border:1px solid #EBE3D8;border-top:3px solid #D97757;border-radius:6px;background:#FFFFFF;padding:16px;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;font-size:12px;font-weight:700;color:#C4603D;">
          <span>${String(index + 1).padStart(2, '0')}</span>
          <span>${escapeHtml(dayRange)}</span>
        </div>
        <h4 style="margin:0;font-size:17px;font-weight:700;color:#3D3229;line-height:1.4;">${escapeHtml(title)}</h4>
        ${stage.cities.length ? `<p style="margin:5px 0 0;font-size:12px;color:#6B5D52;">${escapeHtml(stage.cities.join(' / '))}</p>` : ''}
        ${stage.theme ? `<p style="margin:8px 0 0;font-size:13px;font-weight:600;color:#C4603D;">${escapeHtml(stage.theme)}</p>` : ''}
        ${stage.rationale ? `<p style="margin:8px 0 0;font-size:13px;color:#6B5D52;line-height:1.6;">${escapeHtml(stage.rationale)}</p>` : ''}
        ${highlights ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">${highlights}</div>` : ''}
        ${stage.transition ? `<p style="margin:12px 0 0;padding-top:10px;border-top:1px solid #EBE3D8;font-size:12px;color:#6B5D52;line-height:1.5;">${escapeHtml(stage.transition)}</p>` : ''}
      </div>`
  }).join('')

  const blueprintHTML = blueprint.stages.length ? `
    <div style="margin-bottom:30px;">
      <div style="margin-bottom:14px;">
        <p style="margin:0 0 5px;font-size:12px;font-weight:700;color:#C4603D;">${escapeHtml(t('result.blueprint.eyebrow'))}</p>
        <h3 style="margin:0;font-size:21px;font-weight:700;color:#3D3229;">${escapeHtml(blueprint.title || t('result.blueprint.legacyTitle'))}</h3>
        ${blueprint.summary ? `<p style="margin:8px 0 0;font-size:13px;color:#6B5D52;line-height:1.6;">${escapeHtml(blueprint.summary)}</p>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;">${blueprintStagesHTML}</div>
      ${blueprint.logic ? `<p style="margin:14px 0 0;padding:12px 0;border-top:1px solid #EBE3D8;font-size:13px;color:#6B5D52;line-height:1.6;"><b style="color:#3D3229;">${escapeHtml(t('result.blueprint.planningLogic'))}</b> ${escapeHtml(blueprint.logic)}</p>` : ''}
      ${blueprint.pace ? `<p style="margin:0;padding:8px 0;font-size:13px;color:#6B5D52;"><b style="color:#3D3229;">${escapeHtml(t('result.blueprint.pace'))}</b> ${escapeHtml(blueprint.pace)}</p>` : ''}
    </div>` : ''

  // 每日行程 HTML
  let daysHTML = ''
  tp.days.forEach((day, index) => {
    let attractionsHTML = ''
    day.attractions.forEach((a, ai) => {
      const photoUrl = a.image_url || attractionPhotos.value[a.name] || ''
      const durationText = t('result.export.durationLine', { duration: a.visit_duration || '—' })
      const startTime = normalizeReferenceTime(a.start_time)
      const endTime = normalizeReferenceTime(a.end_time)
      const referenceTime = startTime
        ? `${startTime}${endTime ? `–${endTime}` : ''}`
        : t('result.daily.timePending')
      // 图片自适应：不压缩不裁剪，保持原始比例
      const imgTag = photoUrl
        ? `<img src="${photoUrl}" style="width:100%;height:auto;max-height:360px;object-fit:contain;border-radius:10px;margin-bottom:10px;" crossorigin="anonymous" />`
        : `<div style="width:100%;height:110px;background:linear-gradient(135deg,#E8D5C4,#D4B59A);border-radius:10px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:600;text-align:center;padding:0 12px;box-sizing:border-box;">${a.name}</div>`
      const metaPills =
        `<span style="font-size:12px;color:#A66A47;background:#F5EDE4;padding:3px 10px;border-radius:20px;">${escapeHtml(referenceTime)}</span>` +
        `<span style="font-size:12px;color:#A66A47;background:#F5EDE4;padding:3px 10px;border-radius:20px;">${durationText}</span>` +
        (a.ticket_price ? `<span style="font-size:12px;color:#A66A47;background:#F5EDE4;padding:3px 10px;border-radius:20px;">¥${a.ticket_price}</span>` : '')
      attractionsHTML += `
        <div style="flex:0 0 48%;box-sizing:border-box;background:#FFFFFF;border:1px solid #EBE3D8;border-radius:14px;padding:14px;">
          ${imgTag}
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="flex:none;width:22px;height:22px;border-radius:50%;background:#C17F59;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;">${ai + 1}</span>
            <h4 style="margin:0;font-size:16px;font-weight:700;color:#3D3229;">${a.name}</h4>
          </div>
          ${a.address ? `<p style="margin:0 0 8px;font-size:13px;color:#8B7D6B;line-height:1.5;">${a.address}</p>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${metaPills}</div>
          ${a.description ? `<p style="margin:10px 0 0;font-size:13px;color:#6B5D4E;line-height:1.6;">${a.description}</p>` : ''}
        </div>`
    })

    // 餐饮推荐
    let mealsHTML = ''
    if (day.meals && day.meals.length) {
      let mealPills = ''
      day.meals.forEach(m => {
        const mealTime = normalizeReferenceTime(m.time) || t('result.daily.timePending')
        mealPills += `<span style="background:#F5EDE4;color:#5C4B3E;font-size:12px;padding:6px 12px;border-radius:8px;"><b style="color:#A66A47;">${escapeHtml(mealTime)} · ${escapeHtml(mealLabels[m.type] || m.type)}</b> ${escapeHtml(m.name || t('result.export.noMealRecommendation'))}${m.estimated_cost ? ` · ¥${m.estimated_cost}` : ''}</span>`
      })
      mealsHTML = `
        <div style="margin-top:14px;padding-top:12px;border-top:1px dashed #EBE3D8;">
          <div style="font-size:13px;font-weight:600;color:#A66A47;margin-bottom:8px;">${t('result.export.mealTitle')}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${mealPills}</div>
        </div>`
    }

    const transferTime = normalizeReferenceTime(day.transfer_time) || t('result.daily.timePending')
    const transferHTML = day.is_transfer_day && day.transfer_info
      ? `<div style="margin-bottom:14px;padding:10px 12px;border-left:3px solid #D97757;background:#F5F0E8;font-size:13px;color:#6B5D52;line-height:1.6;"><b style="color:#3D3229;">${escapeHtml(transferTime)} · ${escapeHtml(t('result.daily.transfer'))}</b> ${escapeHtml(day.transfer_info)}</div>`
      : ''

    daysHTML += `
      <div style="margin-bottom:26px;">
        <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #EBE3D8;">
          <span style="font-size:20px;font-weight:700;color:#C17F59;">${t('result.export.dayTitle', { day: index + 1 })}</span>
          ${day.date ? `<span style="font-size:13px;color:#8B7D6B;">${day.date}</span>` : ''}
        </div>
        ${transferHTML}
        <div style="display:flex;flex-wrap:wrap;gap:14px;">
          ${attractionsHTML}
        </div>
        ${mealsHTML}
      </div>`
  })

  // 预算 HTML
  let budgetHTML = ''
  if (tp.budget) {
    const b = tp.budget
    const budgetCard = (label: string, amount: number | string) =>
      `<div style="flex:1;min-width:110px;background:#FFFFFF;border:1px solid #EBE3D8;border-radius:12px;padding:14px;text-align:center;">
        <div style="font-size:12px;color:#8B7D6B;margin-bottom:6px;">${label}</div>
        <div style="font-size:19px;font-weight:700;color:#3D3229;">¥${amount}</div>
      </div>`
    budgetHTML = `
      <div style="margin-bottom:28px;">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#3D3229;display:flex;align-items:center;gap:10px;"><span style="flex:none;width:4px;height:18px;background:#C17F59;border-radius:2px;"></span>${t('result.budget.title')}</h3>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
          ${budgetCard(t('result.budget.attraction'), b.total_attractions || 0)}
          ${budgetCard(t('result.budget.hotel'), b.total_hotels || 0)}
          ${budgetCard(t('result.budget.meal'), b.total_meals || 0)}
          ${budgetCard(t('result.budget.transport'), b.total_transportation || 0)}
        </div>
        <div style="background:linear-gradient(135deg,#C17F59,#A66A47);color:#fff;padding:16px 22px;border-radius:14px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:15px;">${t('result.budget.total')}</span>
          <span style="font-size:26px;font-weight:700;">¥${b.total || 0}</span>
        </div>
      </div>`
  }

  // 地图截图 HTML
  let mapHTML = ''
  if (mapDataUrl) {
    mapHTML = `
      <div style="margin-bottom:28px;">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#3D3229;display:flex;align-items:center;gap:10px;"><span style="flex:none;width:4px;height:18px;background:#C17F59;border-radius:2px;"></span>${t('result.side.map')}</h3>
        <img src="${mapDataUrl}" style="width:100%;height:auto;border-radius:14px;border:1px solid #EBE3D8;" />
      </div>`
  }

  // 天气 HTML
  let weatherHTML = ''
  if (tp.weather_info) {
    if (Array.isArray(tp.weather_info) && tp.weather_info.length > 0) {
      let weatherCards = ''
      tp.weather_info.forEach((w: any) => {
        weatherCards += `
          <div style="flex:1;min-width:150px;background:#FFFFFF;border:1px solid #EBE3D8;border-radius:12px;padding:14px;">
            <div style="text-align:center;color:#C17F59;font-weight:700;font-size:14px;margin-bottom:12px;">${w.date}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:8px;">
              <span style="color:#8B7D6B;">${t('result.export.daytime')}</span>
              <span style="color:#3D3229;font-weight:600;">${w.day_weather} ${w.day_temp}°C</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
              <span style="color:#8B7D6B;">${t('result.export.nighttime')}</span>
              <span style="color:#3D3229;font-weight:600;">${w.night_weather} ${w.night_temp}°C</span>
            </div>
            <div style="border-top:1px solid #EBE3D8;margin-top:10px;padding-top:8px;text-align:center;font-size:12px;color:#8B7D6B;">${w.wind_direction} ${w.wind_power}</div>
          </div>`
      })
      weatherHTML = `
        <div style="margin-bottom:28px;">
          <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#3D3229;display:flex;align-items:center;gap:10px;"><span style="flex:none;width:4px;height:18px;background:#C17F59;border-radius:2px;"></span>${t('result.export.weatherTitle')}</h3>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">${weatherCards}</div>
        </div>`
    } else {
      weatherHTML = `
        <div style="margin-bottom:28px;">
          <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#3D3229;display:flex;align-items:center;gap:10px;"><span style="flex:none;width:4px;height:18px;background:#C17F59;border-radius:2px;"></span>${t('result.export.weatherTitle')}</h3>
          <div style="background:#FFFFFF;border:1px solid #EBE3D8;border-radius:12px;padding:16px;font-size:14px;color:#3D3229;line-height:1.8;">${typeof tp.weather_info === 'string' ? tp.weather_info : JSON.stringify(tp.weather_info)}</div>
        </div>`
    }
  }

  // 酒店 HTML
  let hotelHTML = ''
  if (tp.hotel_recommendations && tp.hotel_recommendations.length) {
    let hotelItems = ''
    tp.hotel_recommendations.forEach((h) => {
      hotelItems += `
        <div style="background:#FFFFFF;border:1px solid #EBE3D8;border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div style="min-width:0;">
            <b style="color:#3D3229;font-size:15px;">${h.name || t('result.export.hotelFallback')}</b>
            ${h.address ? `<p style="margin:4px 0 0;font-size:12px;color:#8B7D6B;">${h.address}</p>` : ''}
          </div>
          ${h.price ? `<span style="flex:none;color:#C17F59;font-weight:700;font-size:16px;white-space:nowrap;">¥${h.price}<span style="font-size:12px;color:#8B7D6B;font-weight:400;">${t('result.export.perNight')}</span></span>` : ''}
        </div>`
    })
    hotelHTML = `
      <div style="margin-bottom:28px;">
        <h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#3D3229;display:flex;align-items:center;gap:10px;"><span style="flex:none;width:4px;height:18px;background:#C17F59;border-radius:2px;"></span>${t('result.hotelTitle')}</h3>
        ${hotelItems}
      </div>`
  }

  // 底部二维码 — 当前页面地址
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(window.location.href)}`
  const footerHTML = `
    <div style="text-align:center;padding:28px 16px 8px;margin-top:4px;border-top:1px solid #EBE3D8;">
      <img src="${qrUrl}" style="width:92px;height:92px;background:#fff;border:1px solid #EBE3D8;border-radius:10px;padding:6px;box-sizing:border-box;" crossorigin="anonymous" />
      <div style="font-size:14px;color:#C17F59;font-weight:700;letter-spacing:2px;margin-top:12px;">游伴</div>
      <div style="font-size:11px;color:#B8A99A;margin-top:6px;">${t('result.export.footer')}</div>
    </div>`

  return `
    <div style="width:800px;padding:36px 30px;background:#FAF7F2;font-family:'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif;color:#3D3229;">
      <div style="text-align:center;margin-bottom:30px;">
        <h1 style="margin:0;font-size:30px;font-weight:700;color:#3D3229;letter-spacing:1px;">${t('result.export.title', { city: tp.city })}</h1>
        <div style="width:44px;height:3px;background:#C17F59;border-radius:2px;margin:14px auto;"></div>
        <p style="margin:0;font-size:14px;color:#8B7D6B;">${t('result.export.subtitle', {
          start: tp.start_date || '',
          end: tp.end_date || '',
          days: tp.days?.length || 0,
        })}</p>
        ${tp.overall_suggestions ? `<p style="margin:16px auto 0;max-width:580px;font-size:13px;color:#8B7D6B;line-height:1.7;">${tp.overall_suggestions}</p>` : ''}
      </div>
      ${blueprintHTML}
      ${daysHTML}
      ${mapHTML}
      ${hotelHTML}
      ${weatherHTML}
      ${budgetHTML}
      ${footerHTML}
    </div>`
}

// ========== 捕获地图截图 ==========
const captureMapScreenshot = async (): Promise<string> => {
  try {
    // 根据当前地图供应商选择对应的 DOM 容器
    const containerId = mapProviderType.value === 'google' ? 'google-map-container' : 'amap-container'
    const mapEl = document.getElementById(containerId)
    if (!mapEl || mapEl.clientHeight === 0) {
      console.warn('⚠️ 地图容器不可见或未初始化，跳过地图截图')
      return ''
    }

    // 临时将地图容器显示出来以便截图（可能被 v-show 隐藏）
    const parentCard = document.querySelector('.right-map') as HTMLElement | null
    const wasHidden = parentCard && parentCard.style.display === 'none'
    if (parentCard && wasHidden) {
      parentCard.style.display = 'block'
      parentCard.style.position = 'absolute'
      parentCard.style.left = '-9999px'
    }

    // 等待一帧让渲染生效
    await new Promise(resolve => setTimeout(resolve, 300))

    const mapCanvas = await html2canvas(mapEl, {
      backgroundColor: '#1a1a2e',
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true,
      ignoreElements: (element) => {
        // 忽略地图控制组件（比如 Google 的 +- 缩放按钮、高德控制条）
        // html2canvas 对地图原生 SVG UI 的渲染支持极差，容易出现白底色块
        if (element && element.className && typeof element.className === 'string') {
          if (element.className.includes('gmnoprint') || element.className.includes('amap-controls')) {
            return true
          }
        }
        return false
      }
    })

    // 还原隐藏状态
    if (parentCard && wasHidden) {
      parentCard.style.display = 'none'
      parentCard.style.position = ''
      parentCard.style.left = ''
    }

    return mapCanvas.toDataURL('image/png')
  } catch (err) {
    console.warn('⚠️ 地图截图失败，导出将不包含地图:', err)
    return ''
  }
}

// 导出为图片
const exportAsImage = async () => {
  try {
    message.loading({ content: t('result.messages.generatingImage'), key: 'export', duration: 0 })

    // 1. 先捕获地图截图
    const mapDataUrl = await captureMapScreenshot()

    // 2. 构建包含地图的完整导出 HTML
    const exportContainer = document.createElement('div')
    exportContainer.innerHTML = buildExportHTML(mapDataUrl)
    exportContainer.style.position = 'absolute'
    exportContainer.style.left = '-9999px'
    document.body.appendChild(exportContainer)

    // 3. 等待二维码等外部图片加载完成
    const images = exportContainer.querySelectorAll('img')
    await Promise.all(
      Array.from(images).map(img =>
        img.complete
          ? Promise.resolve()
          : new Promise(resolve => {
              img.onload = resolve
              img.onerror = resolve
            })
      )
    )

    const canvas = await html2canvas(exportContainer, {
      backgroundColor: '#FAF7F2',
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true
    })

    document.body.removeChild(exportContainer)

    const link = document.createElement('a')
    link.download = `${t('result.export.filePrefix')}_${tripPlan.value?.city}_${new Date().getTime()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()

    message.success({ content: t('result.messages.imageSuccess'), key: 'export' })
  } catch (error: any) {
    console.error('导出图片失败:', error)
    message.error({ content: t('result.messages.imageFailed', { error: error.message }), key: 'export' })
  }
}
const escapeHtml = (value: unknown): string => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 地图标记按天配色，超出后循环取色
const MAP_DAY_COLORS = ['#D97757', '#3E7CB1', '#5B9A68', '#8961A7', '#B07D3F', '#B85C79', '#4F9A94', '#7A7265']

// 路线统一用导航绿，Pin 仍按天配色
const MAP_ROUTE_GREEN = '#07C160'

const getMapDayColor = (dayNo: number): string => MAP_DAY_COLORS[(dayNo - 1) % MAP_DAY_COLORS.length]

// 水滴 Pin 轮廓（viewBox 0 0 36 46，针尖在 (18, 44)），高德与 Google 共用
const MAP_PIN_PATH = 'M18 2C9.44 2 2.5 8.94 2.5 17.5c0 3.31 1.04 6.38 2.8 8.9L18 44l12.7-17.6c1.76-2.52 2.8-5.59 2.8-8.9C33.5 8.94 26.56 2 18 2Z'

const buildMarkerContent = (dayNo: number, stopNo: number): string => {
  const color = getMapDayColor(dayNo)
  const fontSize = stopNo >= 10 ? 12 : 14
  return `
    <div class="tripstar-map-pin">
      <svg class="tripstar-map-pin__svg" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="18" cy="44" rx="5" ry="1.8" fill="rgba(61, 50, 41, 0.28)"/>
        <path d="${MAP_PIN_PATH}" fill="${color}" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>
      </svg>
      <span class="tripstar-map-pin__num" style="font-size:${fontSize}px" aria-hidden="true">${stopNo}</span>
    </div>
  `
}

// Material “hotel” 床形图标（24x24），用于酒店 Pin
const MAP_HOTEL_GLYPH = 'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z'

// 酒店 Pin：白底 + 当天配色描边与床形图标，与景点的实色数字 Pin 形成明显区分
const buildHotelMarkerContent = (dayNo: number): string => {
  const color = getMapDayColor(dayNo)
  return `
    <div class="tripstar-map-pin">
      <svg class="tripstar-map-pin__svg" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <ellipse cx="18" cy="44" rx="5" ry="1.8" fill="rgba(61, 50, 41, 0.28)"/>
        <path d="${MAP_PIN_PATH}" fill="#FFFDF9" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
        <g transform="translate(10.8, 10.3) scale(0.6)">
          <path d="${MAP_HOTEL_GLYPH}" fill="${color}"/>
        </g>
      </svg>
    </div>
  `
}

const buildInfoWindowContent = (attraction: any): string => {
  const name = escapeHtml(attraction.name || t('common.noData'))
  const address = escapeHtml(attraction.address || t('common.noData'))
  const visitDuration = Number.isFinite(attraction.visit_duration) ? attraction.visit_duration : '—'
  const dayAttractionText = escapeHtml(
    t('result.mapInfo.dayAttraction', { day: attraction.dayIndex + 1, index: attraction.attrIndex + 1 })
  )
  const minuteUnit = escapeHtml(t('result.minuteUnit'))

  const dayColor = getMapDayColor(attraction.dayIndex + 1)

  return `
    <div class="tripstar-map-tooltip tripstar-map-tooltip--plain">
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--day" style="color:${dayColor}">${dayAttractionText}</p>
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--title">${name}</p>
      <p class="tripstar-map-tooltip__line">${address}</p>
      <p class="tripstar-map-tooltip__line">${visitDuration}${minuteUnit}</p>
    </div>
  `
}

const buildHotelInfoWindowContent = (hotel: any, dayIndex: number): string => {
  const name = escapeHtml(hotel?.name || t('common.noData'))
  const address = escapeHtml(hotel?.address || t('common.noData'))
  const price = escapeHtml(hotel?.price_range || '')
  const label = escapeHtml(t('result.mapInfo.hotelLabel', { day: dayIndex + 1 }))
  const dayColor = getMapDayColor(dayIndex + 1)
  const priceLine = price ? `<p class="tripstar-map-tooltip__line">${price}</p>` : ''

  return `
    <div class="tripstar-map-tooltip tripstar-map-tooltip--plain">
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--day" style="color:${dayColor}">${label}</p>
      <p class="tripstar-map-tooltip__line tripstar-map-tooltip__line--title">${name}</p>
      <p class="tripstar-map-tooltip__line">${address}</p>
      ${priceLine}
    </div>
  `
}

type RouteMode = 'driving' | 'walking' | 'straight'
type RoutePoint = [number, number]

const ROUTE_STYLE_PRESETS: Record<
  RouteMode,
  {
    strokeColor: string
    strokeWeight: number
    strokeOpacity: number
    strokeStyle: 'solid' | 'dashed'
    strokeDasharray?: number[]
    lineJoin?: 'round' | 'miter' | 'bevel'
    lineCap?: 'butt' | 'round' | 'square'
    outlineColor?: string
    borderWeight?: number
  }
> = {
  driving: {
    strokeColor: MAP_ROUTE_GREEN,
    strokeWeight: 6,
    strokeOpacity: 0.98,
    strokeStyle: 'solid',
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(255, 255, 255, 0.95)',
    borderWeight: 2.8,
  },
  walking: {
    strokeColor: MAP_ROUTE_GREEN,
    strokeWeight: 5.5,
    strokeOpacity: 0.95,
    strokeStyle: 'dashed',
    strokeDasharray: [16, 12],
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(255, 255, 255, 0.95)',
    borderWeight: 2.8,
  },
  straight: {
    strokeColor: MAP_ROUTE_GREEN,
    strokeWeight: 4.5,
    strokeOpacity: 0.95,
    strokeStyle: 'dashed',
    strokeDasharray: [2, 12],
    lineJoin: 'round',
    lineCap: 'round',
    outlineColor: 'rgba(255, 255, 255, 0.95)',
    borderWeight: 2,
  },
}

const detectRouteMode = (transportation: string): RouteMode => {
  const normalized = (transportation || '').toLowerCase()
  if (/(步行|徒步|散步|walk|walking)/i.test(normalized)) return 'walking'
  if (/(驾车|开车|自驾|打车|出租车|car|drive|driving|taxi)/i.test(normalized)) return 'driving'
  return 'driving'
}

// 两点间的二次贝塞尔弧线采样点：向行进方向左侧拱起，代替生硬的两点直线
const buildArcPath = (start: RoutePoint, end: RoutePoint, segments = 32): RoutePoint[] => {
  const [x1, y1] = start
  const [x2, y2] = end
  // 经度按纬度缩放到近似等距平面，保证弧线视觉上对称
  const latScale = Math.cos(((y1 + y2) / 2) * Math.PI / 180) || 1e-6
  const ux = (x2 - x1) * latScale
  const uy = y2 - y1
  if (Math.hypot(ux, uy) === 0) return [start, end]
  const bend = 0.18
  const cx = (x1 + x2) / 2 - (uy * bend) / latScale
  const cy = (y1 + y2) / 2 + ux * bend
  const path: RoutePoint[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const mt = 1 - t
    path.push([
      mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
      mt * mt * y1 + 2 * mt * t * cy + t * t * y2,
    ])
  }
  return path
}

const toRoutePoint = (raw: any): RoutePoint | null => {
  if (!raw) return null

  if (Array.isArray(raw) && raw.length >= 2) {
    const lng = Number(raw[0])
    const lat = Number(raw[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  if (typeof raw.getLng === 'function' && typeof raw.getLat === 'function') {
    const lng = Number(raw.getLng())
    const lat = Number(raw.getLat())
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  if ('lng' in raw && 'lat' in raw) {
    const lng = Number(raw.lng)
    const lat = Number(raw.lat)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  if ('longitude' in raw && 'latitude' in raw) {
    const lng = Number(raw.longitude)
    const lat = Number(raw.latitude)
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  return null
}

const parsePolylineString = (polyline: string): RoutePoint[] => {
  if (!polyline) return []

  return polyline
    .split(';')
    .map((pair) => pair.split(','))
    .map((parts) => {
      const lng = Number(parts[0])
      const lat = Number(parts[1])
      return Number.isFinite(lng) && Number.isFinite(lat) ? ([lng, lat] as RoutePoint) : null
    })
    .filter((point): point is RoutePoint => Boolean(point))
}

const dedupeRoutePath = (points: RoutePoint[]): RoutePoint[] => {
  if (points.length <= 1) return points
  return points.filter((point, index, array) => {
    if (index === 0) return true
    const prev = array[index - 1]
    return point[0] !== prev[0] || point[1] !== prev[1]
  })
}

const extractRoutePath = (result: any): RoutePoint[] => {
  const route =
    result?.routes?.[0] ||
    result?.route?.paths?.[0] ||
    result?.route?.routes?.[0] ||
    null

  if (!route) return []

  const steps = route.steps || []
  const points: RoutePoint[] = []

  steps.forEach((step: any) => {
    if (Array.isArray(step?.path)) {
      step.path.forEach((node: any) => {
        const point = toRoutePoint(node)
        if (point) points.push(point)
      })
      return
    }

    if (typeof step?.polyline === 'string') {
      points.push(...parsePolylineString(step.polyline))
    }
  })

  if (points.length > 1) return dedupeRoutePath(points)

  if (typeof route?.polyline === 'string') {
    const fromRoute = dedupeRoutePath(parsePolylineString(route.polyline))
    if (fromRoute.length > 1) return fromRoute
  }

  return []
}

const searchRoutePath = (
  AMap: any,
  mode: Exclude<RouteMode, 'straight'>,
  start: RoutePoint,
  end: RoutePoint
): Promise<RoutePoint[] | null> => {
  return new Promise((resolve) => {
    const ServiceCtor = mode === 'walking' ? AMap.Walking : AMap.Driving
    if (!ServiceCtor) {
      resolve(null)
      return
    }

    // 插件服务异常时回调可能不触发，超时兜底防止后续路段全部卡住
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: RoutePoint[] | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    timer = setTimeout(() => finish(null), 4000)

    const service =
      mode === 'driving'
        ? new ServiceCtor({
            policy: AMap.DrivingPolicy?.LEAST_TIME ?? 0,
          })
        : new ServiceCtor({})

    service.search(start, end, (status: string, result: any) => {
      if (status !== 'complete') {
        finish(null)
        return
      }
      const path = extractRoutePath(result)
      finish(path.length > 1 ? path : null)
    })
  })
}

// JS API 路线插件依赖有效安全密钥，失败时降级走 Web 服务 REST 接口（复用已配置的 vite_amap_web_key）
let cachedAmapRestKey: string | null = null

const getAmapRestKey = async (): Promise<string> => {
  if (cachedAmapRestKey !== null) return cachedAmapRestKey
  try {
    const backend = await getBackendRuntimeSettings()
    cachedAmapRestKey = backend.vite_amap_web_key || ''
  } catch {
    cachedAmapRestKey = ''
  }
  return cachedAmapRestKey
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

let lastRestCallAt = 0

// 已取得的沿路路径缓存（切换 tab 重绘时不再重复请求消耗配额），以及插件连续失败计数
const routeSegmentCache = new Map<string, RoutePoint[]>()
let amapPluginRouteFailures = 0

const searchRoutePathRest = async (
  mode: Exclude<RouteMode, 'straight'>,
  start: RoutePoint,
  end: RoutePoint,
  attempt = 0
): Promise<RoutePoint[] | null> => {
  const key = await getAmapRestKey()
  if (!key) return null

  // 免费 key 的 QPS 配额很低，请求间强制留出间隔，否则第三天起会被批量限流
  const gap = lastRestCallAt + 380 - Date.now()
  if (gap > 0) await sleep(gap)
  lastRestCallAt = Date.now()

  const url =
    `https://restapi.amap.com/v3/direction/${mode}` +
    `?origin=${start[0].toFixed(6)},${start[1].toFixed(6)}` +
    `&destination=${end[0].toFixed(6)},${end[1].toFixed(6)}` +
    `&extensions=base&key=${key}`

  try {
    const resp = await fetch(url)
    const data = await resp.json()
    if (data?.status !== '1') {
      const reason = `${data?.info ?? ''} ${data?.infocode ?? ''}`
      if (attempt < 2 && /qps|exceed|limit|frequen/i.test(reason)) {
        await sleep(700 * (attempt + 1))
        return searchRoutePathRest(mode, start, end, attempt + 1)
      }
      console.warn('高德 REST 路线规划失败:', reason.trim() || data)
      return null
    }

    const steps = data?.route?.paths?.[0]?.steps
    if (!Array.isArray(steps)) return null

    const path: RoutePoint[] = []
    steps.forEach((step: any) => {
      String(step?.polyline || '').split(';').forEach(pair => {
        const [lng, lat] = pair.split(',').map(Number)
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
        const last = path[path.length - 1]
        if (!last || last[0] !== lng || last[1] !== lat) path.push([lng, lat])
      })
    })
    return path.length > 1 ? path : null
  } catch {
    return null
  }
}

// 初始化地图入口
const initMap = async () => {
  mapLoading.value = true
  mapLoadingText.value = t('result.mapInfo.loadingMap')
  // 地图固定使用高德；Google Maps 逻辑保留为死代码，不再执行
  const enableGoogle = false

  // 1. 先尝试从 localStorage 读取 Google Maps API Key
  let googleKey = enableGoogle ? getRuntimeGoogleMapsApiKey() : ''

  // 2. 如果 localStorage 没有缓存，主动从后端拉取一次
  if (enableGoogle && !googleKey) {
    try {
      const backendSettings = await getBackendRuntimeSettings()
      if (backendSettings.google_maps_api_key) {
        googleKey = backendSettings.google_maps_api_key
        // 同步到 localStorage，下次不再需要请求后端
        const { setRuntimeGoogleMapsApiKey: syncKey } = await import('@/services/api')
        syncKey(googleKey)
      }
    } catch (err) {
      console.warn('从后端获取 Google Maps 配置失败:', err)
    }
  }

  // 3. 尝试初始化 Google Maps（已停用：固定高德）
  if (enableGoogle && googleKey) {
    try {
      // 超时控制：如果 5 秒内未加载完，强制 reject 以触发降级
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Google Maps 加载超时，可能由于网络环境限制')), 5000)
      })
      const initPromise = initGoogleMap(googleKey)
      await Promise.race([initPromise, timeoutPromise])
      return
    } catch (error) {
      console.warn('Google Maps 加载失败，即将降级到高德地图:', error)
      destroyCurrentMap()
      // 等待 DOM 更新，确保高德容器可以显示
      await nextTick()
    }
  }

  // 4. 降级/默认：初始化高德地图
  await initAMap()
}

// 初始化 Google Maps
const initGoogleMap = async (apiKey: string) => {
  mapProviderType.value = 'amap'
  const loader = new GoogleMapsLoader({
    apiKey,
    version: 'weekly',
    language: 'zh-CN', // 保持语言为中文体验较好
  })

  // 这会抛出异常，如由于网络、无代理引起等，正好会被上层捕捉
  const googleApi = await loader.importLibrary('maps')
  const { Map } = googleApi as google.maps.MapsLibrary

  // 加载可能用到的模块
  await loader.importLibrary('routes')
  await loader.importLibrary('marker')

  const container = document.getElementById('google-map-container')
  if (!container) throw new Error('Cannot find google-map-container')

  googleMap = new Map(container, {
    center: { lat: 39.916527, lng: 116.397128 },
    zoom: 12,
    mapTypeId: 'roadmap',
    // 隐藏默认控件，让其风格更接近我们的自定义风格
    disableDefaultUI: true,
    zoomControl: true,
    styles: [
      { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
      { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
      { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
      { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
      { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
      { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
      { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
      { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
      { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
      { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
    ],
  })

  // 添加景点标记
  await addGoogleAttractionMarkers()

  mapLoading.value = false
}

// 添加 Google Maps 景点标记
const addGoogleAttractionMarkers = async () => {
  if (!tripPlan.value || !googleMap) return

  const allAttractions: any[] = []
  let globalIndex = 0

  tripPlan.value.days.forEach((day, dayIndex) => {
    day.attractions.forEach((attraction, attrIndex) => {
      globalIndex++
      if (attraction.location && attraction.location.longitude && attraction.location.latitude) {
        allAttractions.push({
          ...attraction,
          dayIndex,
          attrIndex,
          globalIndex,
        })
      }
    })
  })

  const bounds = new google.maps.LatLngBounds()

  allAttractions.forEach((attraction, index) => {
    const position = { lat: attraction.location.latitude, lng: attraction.location.longitude }
    bounds.extend(position)

    // 与高德一致的「按天配色」水滴 Pin（SVG data URI）
    const stopNo = attraction.attrIndex + 1
    const pinColor = getMapDayColor(attraction.dayIndex + 1)
    const svgIcon = `data:image/svg+xml;charset=UTF-8,` + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
        <ellipse cx="18" cy="44" rx="5" ry="1.8" fill="rgba(61, 50, 41, 0.28)"/>
        <path d="${MAP_PIN_PATH}" fill="${pinColor}" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>
        <text x="18" y="${stopNo >= 10 ? 21.8 : 22.4}" font-family="Arial, sans-serif" font-size="${stopNo >= 10 ? 12 : 14}" font-weight="700" fill="#ffffff" text-anchor="middle">${stopNo}</text>
      </svg>
    `)

    const marker = new google.maps.Marker({
      position,
      map: googleMap,
      icon: {
        url: svgIcon,
        scaledSize: new google.maps.Size(36, 46),
        anchor: new google.maps.Point(18, 44),
      },
      zIndex: 120 + index
    })

    const infoWindow = new google.maps.InfoWindow({
      content: buildInfoWindowContent(attraction),
      disableAutoPan: true,
    })

    marker.addListener('mouseover', () => { infoWindow.open({ anchor: marker, map: googleMap }) })
    marker.addListener('mouseout', () => { infoWindow.close() })
    marker.addListener('click', () => { infoWindow.open({ anchor: marker, map: googleMap }) })

    googleMarkers.push(marker)
    googleInfoWindows.push(infoWindow)
  })

  // 绘制 Google Maps 路线
  await drawGoogleRoutes(allAttractions)

  if (allAttractions.length > 0 && googleMap) {
    googleMap.fitBounds(bounds)
    // 防止过于放大
    const currentZoom = googleMap.getZoom()
    if (currentZoom && currentZoom > 15) googleMap.setZoom(15)
  }
}

// 绘制 Google Maps 路线
const drawGoogleRoutes = async (attractions: any[]) => {
  if (attractions.length < 2 || !tripPlan.value || !googleMap) return

  const dayGroups: Record<number, any[]> = {}
  attractions.forEach(attr => {
    if (!dayGroups[attr.dayIndex]) dayGroups[attr.dayIndex] = []
    dayGroups[attr.dayIndex].push(attr)
  })

  const directionsService = new google.maps.DirectionsService()

  // 降级弧线：珠点样式，与 DirectionsRenderer 的实线区分
  const addDottedArcFallback = (origin: any, destination: any, color: string) => {
    const arcPath = buildArcPath([origin.lng, origin.lat], [destination.lng, destination.lat])
      .map(([lng, lat]) => ({ lat, lng }))
    const poly = new google.maps.Polyline({
      path: arcPath,
      strokeOpacity: 0,
      icons: [{
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 2.4, fillColor: color, fillOpacity: 0.95, strokeColor: '#ffffff', strokeWeight: 1 },
        offset: '0',
        repeat: '13px',
      }],
      map: googleMap,
      zIndex: 88,
    })
    googlePolylines.push(poly)
  }

  for (const dayAttractions of Object.values(dayGroups)) {
    if (dayAttractions.length < 2) continue

    dayAttractions.sort((a: any, b: any) => a.attrIndex - b.attrIndex)
    const dayIndex = dayAttractions[0].dayIndex
    const transportation = tripPlan.value.days?.[dayIndex]?.transportation || ''
    const preferredMode = detectRouteMode(transportation)

    let gTravelMode = google.maps.TravelMode.DRIVING
    if (preferredMode === 'walking') gTravelMode = google.maps.TravelMode.WALKING

    for (let i = 0; i < dayAttractions.length - 1; i++) {
      const start = dayAttractions[i]
      const end = dayAttractions[i + 1]
      const origin = { lat: start.location.latitude, lng: start.location.longitude }
      const destination = { lat: end.location.latitude, lng: end.location.longitude }

      if (preferredMode === 'straight') {
        addDottedArcFallback(origin, destination, MAP_ROUTE_GREEN)
        continue
      }

      try {
        const response = await directionsService.route({
          origin,
          destination,
          travelMode: gTravelMode,
        })

        const renderer = new google.maps.DirectionsRenderer({
          map: googleMap,
          directions: response,
          suppressMarkers: true, // 我们已经有了自定义 Marker
          polylineOptions: {
            strokeColor: MAP_ROUTE_GREEN,
            strokeWeight: preferredMode === 'walking' ? 5.5 : 6,
            strokeOpacity: 0.95,
            zIndex: 90,
          }
        })
        googleDirectionsRenderers.push(renderer)
      } catch (err: any) {
        console.warn('Google 路线规划失败, 降级为弧线:', err)
        addDottedArcFallback(origin, destination, MAP_ROUTE_GREEN)
      }
    }
  }
}

// 初始化高德地图
const initAMap = async () => {
  try {
    mapProviderType.value = 'amap'
    const mapJsKey = getRuntimeMapJsKey() || (await getBackendRuntimeSettings()).vite_amap_web_js_key
    if (!mapJsKey) {
      mapLoading.value = false
      message.warning('请先在设置中配置高德地图 JS Key')
      return
    }

    // 2021-12 后申请的高德 key 若缺失安全密钥配置，JS API 会直接加载失败。
    // 未配置真实密钥时补一个占位值：地图可正常显示，路线规划自动走 REST 降级。
    const w = window as any
    if (!w._AMapSecurityConfig?.securityJsCode) {
      w._AMapSecurityConfig = { securityJsCode: 'tripstar-placeholder' }
    }

    const AMap = await AMapLoader.load({
      key: mapJsKey,  // 高德地图Web端(JS API) Key
      version: '2.0',
      plugins: ['AMap.Marker', 'AMap.Polyline', 'AMap.InfoWindow', 'AMap.Driving', 'AMap.Walking']
    })

    // 创建地图实例
    map = new AMap.Map('amap-container', {
      zoom: 12,
      center: [116.397128, 39.916527], // 默认中心点(北京)
      viewMode: '3D',
      mapStyle: 'amap://styles/normal',
      // 开启 preserveDrawingBuffer 才能让 html2canvas 在 WebGL 下截屏成功！
      WebGLParams: {
        preserveDrawingBuffer: true
      }
    })

    // 地图底图就绪，进入标注与路线绘制阶段
    mapLoadingText.value = t('result.mapInfo.loadingRoute')

    // 标注与路线绘制失败不应把整张地图判为加载失败
    try {
      await addAttractionMarkers(AMap)
    } catch (overlayError) {
      console.error('地图标注/路线绘制失败:', overlayError)
    }
    mapLoading.value = false
  } catch (error) {
    mapLoading.value = false
    console.error('地图加载失败:', error)
    message.error(t('result.messages.mapLoadFailed'))
  }
}

// 添加景点标记
const addAttractionMarkers = async (AMap: any) => {
  if (!tripPlan.value) return

  const markers: any[] = []
  const allAttractions: any[] = []

  // 收集所有景点（保留全局编号）
  let globalIndex = 0
  tripPlan.value.days.forEach((day, dayIndex) => {
    day.attractions.forEach((attraction, attrIndex) => {
      globalIndex++
      if (attraction.location && attraction.location.longitude && attraction.location.latitude) {
        allAttractions.push({
          ...attraction,
          dayIndex,
          attrIndex,
          globalIndex   // 全局编号（从1开始）
        })
      }
    })
  })

  // 创建标记
  allAttractions.forEach((attraction, index) => {
    const marker = new AMap.Marker({
      position: [attraction.location.longitude, attraction.location.latitude],
      content: buildMarkerContent(attraction.dayIndex + 1, attraction.attrIndex + 1),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, 0),
      zIndex: 120 + index,
    })

    // 创建信息窗口
    const infoWindow = new AMap.InfoWindow({
      isCustom: true,
      content: buildInfoWindowContent(attraction),
      offset: new AMap.Pixel(0, -52),
      closeWhenClickMap: true,
    })

    // 悬停显示纯文本tooltip，移出关闭
    marker.on('mouseover', () => {
      infoWindow.open(map, marker.getPosition())
    })
    marker.on('mouseout', () => {
      infoWindow.close()
    })
    // 点击也显示，兼容触屏设备
    marker.on('click', () => {
      infoWindow.open(map, marker.getPosition())
    })

    markers.push(marker)
  })

  // 酒店标记：白底反色 Pin，当天配色描边 + 床形图标；连住同一酒店只标一次
  const hotelSeen = new Set<string>()
  tripPlan.value.days.forEach((day, dayIndex) => {
    const loc = day.hotel?.location
    if (!loc?.longitude || !loc?.latitude) return
    const coordKey = `${loc.longitude},${loc.latitude}`
    if (hotelSeen.has(coordKey)) return
    hotelSeen.add(coordKey)

    const hotelMarker = new AMap.Marker({
      position: [loc.longitude, loc.latitude],
      content: buildHotelMarkerContent(dayIndex + 1),
      anchor: 'bottom-center',
      offset: new AMap.Pixel(0, 0),
      zIndex: 118,
    })

    const hotelInfoWindow = new AMap.InfoWindow({
      isCustom: true,
      content: buildHotelInfoWindowContent(day.hotel, dayIndex),
      offset: new AMap.Pixel(0, -52),
      closeWhenClickMap: true,
    })
    hotelMarker.on('mouseover', () => { hotelInfoWindow.open(map, hotelMarker.getPosition()) })
    hotelMarker.on('mouseout', () => { hotelInfoWindow.close() })
    hotelMarker.on('click', () => { hotelInfoWindow.open(map, hotelMarker.getPosition()) })

    markers.push(hotelMarker)
  })

  // 添加标记到地图
  map.add(markers)

  // 绘制路线（优先真实道路路线，失败时回退直线）
  const routePolylines = await drawRoutes(AMap, allAttractions)

  // 自动调整视野以包含所有标记
  if (allAttractions.length > 0) {
    const overlaysForFit = routePolylines.length > 0 ? [...markers, ...routePolylines] : markers
    map.setFitView(overlaysForFit)
  }
}

// 绘制路线：根据交通方式选择 driving / walking；失败时降级为直线
const drawRoutes = async (AMap: any, attractions: any[]): Promise<any[]> => {
  if (attractions.length < 1 || !tripPlan.value) return []

  // 按天分组绘制路线
  const dayGroups: Record<number, any[]> = {}
  attractions.forEach(attr => {
    if (!dayGroups[attr.dayIndex]) {
      dayGroups[attr.dayIndex] = []
    }
    dayGroups[attr.dayIndex].push(attr)
  })

  const polylines: any[] = []

  // 为每天的景点逐段绘制路线
  for (const dayAttractions of Object.values(dayGroups)) {
    if (dayAttractions.length < 1) continue

    dayAttractions.sort((a: any, b: any) => a.attrIndex - b.attrIndex)
    const dayIndex = dayAttractions[0].dayIndex
    const transportation = tripPlan.value.days?.[dayIndex]?.transportation || ''
    const preferredMode = detectRouteMode(transportation)

    // 当天线路站点：有坐标的酒店纳入，从酒店出发游完回酒店
    const stops: RoutePoint[] = dayAttractions.map(
      (attr: any): RoutePoint => [attr.location.longitude, attr.location.latitude]
    )
    const hotelLoc = tripPlan.value.days?.[dayIndex]?.hotel?.location
    if (hotelLoc?.longitude && hotelLoc?.latitude) {
      const hotelPoint: RoutePoint = [hotelLoc.longitude, hotelLoc.latitude]
      stops.unshift(hotelPoint)
      stops.push(hotelPoint)
    }
    if (stops.length < 2) continue

    for (let i = 0; i < stops.length - 1; i++) {
      const startPoint = stops[i]
      const endPoint = stops[i + 1]

      const routeMode = preferredMode as Exclude<RouteMode, 'straight'>
      const cacheKey = `${routeMode}:${startPoint.join(',')}|${endPoint.join(',')}`
      let plannedPath: RoutePoint[] | null = routeSegmentCache.get(cacheKey) ?? null

      if (!plannedPath && preferredMode !== 'straight') {
        // 安全密钥无效时插件必然全败，连败两次后直接走 REST，避免整体绘制被拖慢
        if (amapPluginRouteFailures < 2) {
          plannedPath = await searchRoutePath(AMap, routeMode, startPoint, endPoint)
          amapPluginRouteFailures = plannedPath ? 0 : amapPluginRouteFailures + 1
        }
        if (!plannedPath) {
          plannedPath = await searchRoutePathRest(routeMode, startPoint, endPoint)
        }
        if (plannedPath) {
          routeSegmentCache.set(cacheKey, plannedPath)
        }
      }

      const usePlannedRoute = Array.isArray(plannedPath) && plannedPath.length > 1
      const routeModeForStyle: RouteMode = usePlannedRoute ? preferredMode : 'straight'
      // 无真实路线时画珠点弧线，与实路实线明确区分
      const path = usePlannedRoute ? plannedPath : buildArcPath(startPoint, endPoint)
      const style = ROUTE_STYLE_PRESETS[routeModeForStyle]

      // 导航绿 + 白描边，在浅色底图上足够醒目
      const polyline = new AMap.Polyline({
        path,
        ...style,
        isOutline: true,
        showDir: usePlannedRoute,
        zIndex: usePlannedRoute ? 90 : 88,
      })

      polylines.push(polyline)
    }
  }

  if (polylines.length > 0) {
    map.add(polylines)
  }

  return polylines
}
</script>

<style scoped>
/* ===== Landing 同款视觉基底 - 结果页 ===== */

.result-container {
  width: 100%;
  min-width: 0;
  min-height: 100vh;
  background: linear-gradient(180deg, #FAF7F2 0%, #F5F0E8 58%, #EDE6DA 100%);
  color: #3D3229;
  position: relative;
  isolation: isolate;
}

.lower-shade {
  position: fixed;
  inset: 0% 0 -1px 0;
  z-index: 0;
  pointer-events: none;
  background: rgba(250, 247, 242, 0.72);
}

.lower-shade::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -28px;
  height: 28px;
  background: linear-gradient(to bottom, rgba(250, 247, 242, 0), rgba(250, 247, 242, 0.92));
}

.result-main {
  position: relative;
  z-index: 2;
  width: 100%;
  min-width: 0;
  padding: 20px 20px 44px;
}

.content-wrapper {
  width: 100%;
  min-width: 0;
  max-width: 1240px;
  margin: 0 auto;
  display: block;
  border: 1.2px solid rgba(61, 50, 41, 0.12);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 80px rgba(61, 50, 41, 0.1);
  padding: 20px;
  container-name: result-content;
  container-type: inline-size;
}

.top-switch-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  margin: -20px -20px 16px;
  padding: 10px 20px 0;
  border-radius: 22px 22px 0 0;
  border-bottom: 1px solid rgba(61, 50, 41, 0.12);
}

.top-switch-menu-wrap {
  flex: 1;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: hidden;
}

.top-switch-menu {
  width: 100%;
  min-width: 0;
  border-bottom: none !important;
  background: transparent !important;
}

.top-switch-menu :deep(.ant-menu-item) {
  color: rgba(61, 50, 41, 0.65) !important;
  border-radius: 10px 10px 0 0;
  margin-right: 4px !important;
  transition: all 0.2s ease;
}

.top-switch-menu :deep(.ant-menu-item:hover) {
  color: #3D3229 !important;
}

.top-switch-menu :deep(.ant-menu-item-selected) {
  color: #D97757 !important;
}

.top-switch-menu :deep(.ant-menu-item-selected::after),
.top-switch-menu :deep(.ant-menu-item-active::after),
.top-switch-menu :deep(.ant-menu-item:hover::after) {
  border-bottom-color: #D97757 !important;
}

.top-switch-menu :deep(.ant-menu-overflow) {
  flex-wrap: nowrap;
}

.top-switch-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding-bottom: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.action-icon {
  flex-shrink: 0;
}

.top-switch-actions :deep(.ant-btn-default) {
  border: none !important;
  background: transparent !important;
  color: #6B5D52 !important;
  border-radius: 10px !important;
  height: 34px !important;
  padding: 0 12px !important;
  font-size: 13px !important;
  font-weight: 600;
  box-shadow: none !important;
  transition: all 0.15s ease;
}

.top-switch-actions :deep(.ant-btn-default:hover) {
  background: rgba(217, 119, 87, 0.1) !important;
  color: #C4603D !important;
}

.top-switch-actions :deep(.ant-btn-primary) {
  border: none !important;
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%) !important;
  color: #fff !important;
  border-radius: 10px !important;
  height: 34px !important;
  padding: 0 14px !important;
  font-size: 13px !important;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(217, 119, 87, 0.35) !important;
}

.readonly-banner {
  margin-bottom: 16px;
}

.empty-state-panel {
  max-width: 900px;
  margin: 0 auto;
  border: 1.2px solid rgba(61, 50, 41, 0.12);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 80px rgba(61, 50, 41, 0.1);
  padding: 44px 20px;
  text-align: center;
}

.empty-desc {
  color: rgba(61, 50, 41, 0.6);
}

.empty-back-btn {
  border: 1.2px solid rgba(217, 119, 87, 0.5) !important;
  background: rgba(217, 119, 87, 0.18) !important;
  color: #C4603D !important;
  border-radius: 999px !important;
  min-height: 34px !important;
  padding: 0 14px !important;
  font-size: 12px !important;
  font-weight: 600;
  letter-spacing: 0.04em;
  box-shadow: none !important;
}

/* ===== 景点时间轴卡片 ===== */
.attr-timeline-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-left: 34px;
}

.attr-timeline-list::before {
  content: '';
  position: absolute;
  left: 15px;
  top: 12px;
  bottom: 12px;
  width: 2px;
  background: linear-gradient(180deg, rgba(217, 119, 87, 0.4), rgba(217, 119, 87, 0.08));
  border-radius: 1px;
}

.attr-card {
  position: relative;
  display: flex;
  gap: 16px;
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 14px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.attr-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--card-shadow-hover);
}

.attr-order-dot {
  position: absolute;
  left: -34px;
  top: 18px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--chat-user-bubble);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(217, 119, 87, 0.35);
}

.attr-image-wrapper {
  position: relative;
  width: 180px;
  flex-shrink: 0;
  border-radius: 12px;
  overflow: hidden;
  align-self: flex-start;
  aspect-ratio: 16 / 10;
  background: #F0E8DC;
}

.attr-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
}

.attr-image-wrapper .image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #E8DFD5 0%, #D9CBB8 100%);
  color: #8B7B6E;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  padding: 10px;
}

.attr-card:hover .attr-image {
  transform: scale(1.05);
}

.attr-img-badges {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}

.attr-badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  backdrop-filter: blur(8px);
  background: rgba(61, 50, 41, 0.55);
}

.attr-badge--price {
  background: rgba(217, 119, 87, 0.9);
}

.attr-info {
  flex: 1;
  min-width: 0;
}

.attr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.attr-name {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
}

.attr-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.attr-meta-addr {
  font-size: 12.5px;
  color: #6B5D52;
  max-width: 60%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attr-chip {
  font-size: 12px;
  color: #C4603D;
  background: rgba(217, 119, 87, 0.1);
  border-radius: 999px;
  padding: 2px 10px;
  flex-shrink: 0;
}

.attr-desc {
  margin: 8px 0 0;
  font-size: 13px;
  color: #6B5D52;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: break-word;
  word-break: auto-phrase;
  text-wrap: balance;
}

.attr-desc.expanded {
  display: block;
}

.attr-desc-toggle {
  border: none;
  background: none;
  padding: 4px 0 0;
  font-size: 12px;
  color: #D97757;
  cursor: pointer;
}

.attr-reservation {
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(255, 152, 0, 0.08);
  border-left: 3px solid rgba(255, 152, 0, 0.5);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.attr-reservation-label {
  font-size: 12.5px;
  font-weight: 700;
  color: #C4603D;
}

.attr-reservation-tips {
  font-size: 12px;
  color: rgba(61, 50, 41, 0.65);
  line-height: 1.5;
}

/* ===== 酒店信息卡 ===== */
.hotel-info-card {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 16px 18px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.hotel-info-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--card-shadow-hover);
}

.hotel-info-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.hotel-info-icon {
  font-size: 20px;
}

.hotel-info-name {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
  flex: 1;
  min-width: 0;
}

.hotel-info-price {
  font-size: 13px;
  font-weight: 700;
  color: #C4603D;
  background: rgba(217, 119, 87, 0.1);
  border-radius: 999px;
  padding: 3px 12px;
  flex-shrink: 0;
}

.hotel-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 20px;
}

.hotel-info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hotel-info-label {
  font-size: 12px;
  color: #A89888;
}

.hotel-info-value {
  font-size: 13px;
  color: #3D3229;
}

/* ===== 餐饮小卡 ===== */
.meal-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.meal-card {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 14px 16px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.meal-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--card-shadow-hover);
}

.meal-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.meal-icon {
  font-size: 18px;
}

.meal-type {
  font-size: 13px;
  font-weight: 700;
  color: #6B5D52;
  flex: 1;
}

.meal-cost {
  font-size: 12.5px;
  font-weight: 700;
  color: #C4603D;
}

.meal-name {
  font-size: 14px;
  font-weight: 600;
  color: #3D3229;
}

.meal-desc {
  margin-top: 4px;
  font-size: 12.5px;
  color: #6B5D52;
  line-height: 1.6;
}

/* ===== day-header 景点数 ===== */
.day-attr-count {
  font-size: 12px;
  color: #A89888;
}

@media (max-width: 640px) {
  .attr-card {
    flex-direction: column;
  }

  .attr-image-wrapper {
    width: 100%;
  }

  .attr-meta-addr {
    max-width: 100%;
  }
}

/* 天气看板样式 */
.weather-section-card {
  /* margin-top: 14px; */
  overflow: hidden;
}

.weather-dashboard {
  padding: 8px 0 16px;
}

.weather-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

@media (max-width: 1023px) {
  .weather-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .weather-grid {
    grid-template-columns: 1fr;
  }
}

/* 回到顶部按钮 */
.back-top-button {
  width: 50px;
  height: 50px;
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  box-shadow: 0 4px 20px rgba(217, 119, 87, 0.38);
  cursor: pointer;
  transition: all 0.3s ease;
}

.back-top-button:hover {
  transform: scale(1.15);
  box-shadow: 0 6px 28px rgba(217, 119, 87, 0.48);
}

/* 顶部信息区布局 */
.top-info-section {
  display: flex;
  width: 100%;
  min-width: 0;
  gap: 20px;
  margin-bottom: 20px;
}

.left-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.right-map {
  flex: 1;
  height: calc(100vh - 185px);
  height: calc(100dvh - 185px);
  min-height: 520px;
}

/* 行程概览瀑布流 */
.overview-card {
  width: 100%;
  min-width: 0;
  margin-bottom: 20px;
}

.section-shellless {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.section-shellless:hover {
  box-shadow: none !important;
  border-color: transparent !important;
}

:deep(.section-shellless > .ant-card-head) {
  display: none !important;
}

:deep(.section-shellless > .ant-card-body) {
  min-width: 0;
  max-width: 100%;
  padding: 0 !important;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 14px;
}

.overview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.overview-meta-item {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.overview-meta-item--accent {
  color: var(--accent-primary);
  font-weight: 700;
}

.overview-grid {
  width: 100%;
  min-width: 0;
  column-count: 5;
  column-gap: 16px;
  padding: 4px 0 12px;
}

@container result-content (max-width: 1120px) {
  .overview-grid {
    column-count: 4;
  }
}

@container result-content (max-width: 900px) {
  .overview-grid {
    column-count: 3;
  }
}

@container result-content (max-width: 640px) {
  .overview-grid {
    column-count: 2;
  }
}


/* 预算卡片 */
.budget-card {
  height: fit-content;
}

.budget-detail-panel {
  min-height: 100%;
  border-radius: 14px;
  border: 1px solid rgba(61, 50, 41, 0.1);
  background: rgba(255, 255, 255, 0.6);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.budget-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(61, 50, 41, 0.1);
}

.budget-toolbar-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.budget-toolbar-label {
  font-size: 12px;
  color: rgba(61, 50, 41, 0.6);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.budget-select {
  width: 180px;
}

.budget-select :deep(.ant-select-selector) {
  border-radius: 10px !important;
  border-color: rgba(61, 50, 41, 0.2) !important;
  background: rgba(255, 255, 255, 0.5) !important;
  color: #3D3229 !important;
}

.budget-select :deep(.ant-select-arrow) {
  color: rgba(61, 50, 41, 0.6) !important;
}

.budget-detail-list {
  max-width: 100%;
  border: 1px solid rgba(61, 50, 41, 0.1);
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.4);
}

.budget-detail-row {
  display: grid;
  grid-template-columns: 112px 96px minmax(0, 1fr) 120px 86px;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-bottom: 1px solid rgba(61, 50, 41, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.budget-detail-row:last-child {
  border-bottom: none;
}

.budget-detail-row--readonly {
  grid-template-columns: 112px 96px minmax(0, 1fr) 120px;
}

.budget-detail-header {
  background: rgba(61, 50, 41, 0.05);
  font-size: 12px;
  color: rgba(61, 50, 41, 0.55);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.budget-detail-type,
.budget-detail-day,
.budget-detail-name,
.budget-detail-amount {
  color: #3D3229;
  font-size: 13px;
}

.budget-detail-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.budget-detail-amount {
  font-weight: 600;
  color: #D97757;
}

.budget-action-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.budget-icon-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.budget-icon-btn svg {
  width: 16px;
  height: 16px;
}

.budget-edit-btn {
  color: rgba(61, 50, 41, 0.55);
}

.budget-delete-btn {
  color: rgba(61, 50, 41, 0.55);
}

.budget-edit-btn:hover,
.budget-delete-btn:hover {
  color: #D97757;
  transform: scale(1.1);
  /* background: rgba(217, 119, 87, 0.12); */
}

.right-budget-summary {
  flex: 0 0 360px;
  min-width: 0;
  max-width: 100%;
}

@container result-content (max-width: 900px) {
  .top-info-section {
    flex-direction: column;
  }

  .right-budget-summary {
    flex-basis: auto;
    width: 100%;
  }

  .budget-detail-list {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .budget-detail-row {
    min-width: 620px;
  }
}

.budget-summary-panel {
  min-height: 100%;
  border-radius: 14px;
  border: 1.2px solid rgba(61, 50, 41, 0.1);
  background: rgba(255, 255, 255, 0.6);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.budget-summary-title {
  color: #3D3229;
  font-size: 34px;
  font-weight: 300;
  letter-spacing: 0.02em;
  line-height: 1;
}

.budget-summary-total-wrap {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.budget-summary-currency {
  font-size: 42px;
  line-height: 1;
  color: rgba(61, 50, 41, 0.7);
}

.budget-summary-total-value {
  font-size: 78px;
  line-height: 0.88;
  font-weight: 300;
  color: #3D3229;
  letter-spacing: 0.01em;
}

.budget-summary-sub-grid {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 12px;
}

.budget-summary-sub-item {
  border-top: 1px solid rgba(61, 50, 41, 0.1);
  padding-top: 8px;
}

.budget-summary-sub-value {
  font-size: 32px;
  line-height: 1;
  color: #D97757;
}

.budget-summary-sub-label {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
  letter-spacing: 0.04em;
  color: rgba(61, 50, 41, 0.55);
  text-transform: uppercase;
}

.budget-pending-wrap {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.1);
}

.budget-pending-title {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: rgba(61, 50, 41, 0.6);
  margin-bottom: 8px;
  text-transform: uppercase;
}

.budget-pending-empty {
  font-size: 12px;
  color: rgba(61, 50, 41, 0.4);
  padding: 8px 0;
}

.budget-pending-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.budget-pending-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(61, 50, 41, 0.08);
}

.budget-pending-name {
  flex: 1;
  min-width: 0;
  color: #3D3229;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.budget-restore-btn {
  padding: 0 !important;
}

/* 地图卡片 */
.map-card {
  position: relative;
  height: 100%;
  min-height: 500px;
  overflow: hidden;
}

/* body 用绝对定位铺满卡片：百分比高度在移动端 flex 布局下会解析失败导致地图 0 高 */
.map-card :deep(.ant-card-body) {
  position: absolute;
  inset: 0;
  padding: 0;
}

/* 蓝图与每日行程直接使用结果框架,不再嵌套卡片壳 */
.flow-card,
.days-card {
  min-width: 0;
  margin-top: 20px;
}

.day-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.day-title {
  font-size: 18px;
  font-weight: 600;
  color: #3D3229;
}

.day-date {
  font-size: 14px;
  color: rgba(61, 50, 41, 0.4);
  margin-left: auto;
}

.day-city-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 6px;
  background: rgba(90, 216, 166, 0.12);
  border: 1px solid rgba(90, 216, 166, 0.25);
  color: #3a9c7a;
  font-size: 12px;
  font-weight: 600;
  margin-left: 10px;
}

.day-transfer-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 6px;
  background: rgba(246, 189, 22, 0.12);
  border: 1px solid rgba(246, 189, 22, 0.25);
  color: #b8860b;
  font-size: 12px;
  font-weight: 600;
  margin-left: 6px;
}

.transfer-info-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: rgba(246, 189, 22, 0.08);
  border: 1px solid rgba(246, 189, 22, 0.2);
  font-size: 13px;
  color: rgba(61, 50, 41, 0.75);
}

.transfer-info-icon {
  font-size: 18px;
}

.transfer-info-label {
  font-weight: 600;
  color: #b8860b;
}

.day-info {
  margin-bottom: 20px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.45);
  border-radius: 12px;
  border: 1px solid rgba(61, 50, 41, 0.08);
}

.info-row {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-row .label {
  font-weight: 600;
  color: rgba(61, 50, 41, 0.5);
  min-width: 100px;
}

.info-row .value {
  color: #3D3229;
  flex: 1;
  overflow-wrap: break-word;
  word-break: auto-phrase;
  text-wrap: pretty;
}

/* 卡片样式 - 玻璃拟态浅色 */
:deep(.ant-card) {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.55) !important;
  backdrop-filter: blur(20px);
  border: 1px solid rgba(61, 50, 41, 0.1) !important;
  box-shadow: 0 8px 32px rgba(61, 50, 41, 0.08);
  margin-bottom: 20px;
  transition: all 0.3s ease;
  animation: fadeInUp 0.6s ease-out;
  color: #3D3229;
}

:deep(.ant-card:hover) {
  box-shadow: 0 12px 40px rgba(61, 50, 41, 0.12);
  border-color: rgba(217, 119, 87, 0.3) !important;
}

:deep(.ant-card-head) {
  background: linear-gradient(135deg, rgba(217, 119, 87, 0.15) 0%, rgba(196, 96, 61, 0.1) 100%) !important;
  color: #3D3229 !important;
  border-radius: 16px 16px 0 0;
  font-weight: 600;
  border-bottom: 1px solid rgba(61, 50, 41, 0.08) !important;
}

:deep(.ant-card-head-title) {
  color: #3D3229 !important;
  font-size: 18px;
}

:deep(.ant-card-head-title span) {
  color: #3D3229 !important;
}

:deep(.ant-card-body) {
  color: #3D3229;
}

:deep(.ant-card-body p) {
  color: rgba(61, 50, 41, 0.75);
}

:deep(.ant-card-body strong) {
  color: rgba(61, 50, 41, 0.55);
}

/* Collapse 样式 - 浅色 */
:deep(.ant-collapse) {
  border: none;
  background: transparent;
}

:deep(.ant-collapse-item) {
  margin-bottom: 16px;
  border: 1px solid rgba(61, 50, 41, 0.1) !important;
  border-radius: 16px !important;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.45);
  scroll-margin-top: 72px; /* 吸顶导航高度补偿 */
}

:deep(.ant-collapse-header) {
  background: rgba(255, 255, 255, 0.4) !important;
  padding: 16px 20px !important;
  font-weight: 600;
  color: #3D3229 !important;
}

:deep(.ant-collapse-expand-icon) {
  color: rgba(61, 50, 41, 0.45) !important;
}

:deep(.ant-collapse-content) {
  border-top: 1px solid rgba(61, 50, 41, 0.08) !important;
  background: transparent !important;
}

:deep(.ant-collapse-content-box) {
  padding: 20px;
  color: rgba(61, 50, 41, 0.75);
}

/* Descriptions 浅色 */
:deep(.ant-descriptions) {
  background: transparent;
}

:deep(.ant-descriptions-bordered .ant-descriptions-item-label) {
  background: rgba(61, 50, 41, 0.05) !important;
  color: rgba(61, 50, 41, 0.55) !important;
  border-color: rgba(61, 50, 41, 0.1) !important;
}

:deep(.ant-descriptions-bordered .ant-descriptions-item-content) {
  background: transparent !important;
  color: #3D3229 !important;
  border-color: rgba(61, 50, 41, 0.1) !important;
}

:deep(.ant-descriptions-item-label) {
  color: rgba(61, 50, 41, 0.55) !important;
}

:deep(.ant-descriptions-item-content) {
  color: #3D3229 !important;
}

/* Divider 浅色 */
:deep(.ant-divider) {
  border-color: rgba(61, 50, 41, 0.1) !important;
  color: rgba(61, 50, 41, 0.6) !important;
}

:deep(.ant-divider-inner-text) {
  color: rgba(61, 50, 41, 0.6) !important;
}

/* Empty 浅色 */
:deep(.ant-empty-description) {
  color: rgba(61, 50, 41, 0.45) !important;
}

/* 景点卡片样式 */
:deep(.ant-list-item) {
  transition: all 0.3s ease;
}

:deep(.ant-list-item:hover) {
  transform: scale(1.02);
}

/* 动画 */
@keyframes fadeInDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .result-main {
    padding: 12px 10px 24px;
  }

  .content-wrapper {
    padding: 14px;
  }

  .right-map {
    height: calc(100vh - 230px);
    height: calc(100dvh - 230px);
    min-height: 420px;
  }

  /* 图例单行横向滑动：15 天行程不再换行成大色块压掉地图 */
  .map-day-legend {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 6px 12px;
    gap: 12px;
  }

  .map-day-legend::-webkit-scrollbar {
    display: none;
  }

  .map-day-legend__item {
    font-size: 11px;
    flex-shrink: 0;
  }

  .top-switch-nav {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    margin: -14px -14px 12px;
    padding: 8px 14px 0;
    border-radius: 22px 22px 0 0;
    top: 0;
    z-index: 40;
    background: var(--surface-elevated);
    box-shadow: 0 8px 18px rgba(61, 50, 41, 0.08);
  }

  .top-switch-actions {
    justify-content: flex-end;
    padding-bottom: 8px;
  }

  /* tab 改为换行 chip 网格:全部可见直接点,无需横向滑动 */
  .top-switch-menu-wrap {
    overflow: visible;
  }

  .top-switch-menu {
    min-width: 0;
    border-bottom: none !important;
    display: grid !important;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  /* ant-menu 的 clearfix 伪元素和溢出占位会抢占网格格子,移除 */
  .top-switch-menu::before,
  .top-switch-menu::after {
    display: none !important;
  }

  .top-switch-menu :deep(.ant-menu-overflow-item-rest) {
    display: none !important;
  }

  .top-switch-menu :deep(.ant-menu-item) {
    margin: 0 !important;
    padding: 0 4px !important;
    height: 36px !important;
    line-height: 36px !important;
    text-align: center;
    border: 1px solid rgba(100, 80, 60, 0.15);
    border-radius: 10px;
    background: #fff;
    font-size: 13px;
    overflow: hidden;
  }

  .top-switch-menu :deep(.ant-menu-item::after) {
    display: none !important;
  }

  .top-switch-menu :deep(.ant-menu-item-selected) {
    background: rgba(217, 119, 87, 0.12);
    border-color: rgba(217, 119, 87, 0.5);
  }

  :deep(.ant-collapse-item) {
    scroll-margin-top: 210px; /* 移动端顶栏 + 两行 tab + 按钮行 */
  }

  .top-switch-actions :deep(.ant-space) {
    column-gap: 6px !important;
    row-gap: 6px !important;
  }

  .top-switch-actions :deep(.ant-btn-default),
  .top-switch-actions :deep(.ant-btn-primary) {
    height: 32px !important;
    padding: 0 10px !important;
    font-size: 11px !important;
  }

  .top-info-section {
    flex-direction: column;
  }

  .left-info {
    flex: auto;
  }

  .right-budget-summary {
    flex: auto;
    width: 100%;
  }

  .budget-summary-panel {
    min-height: auto;
  }

  .budget-summary-title {
    font-size: 30px;
  }

  .budget-summary-total-value {
    font-size: 56px;
  }

  .budget-summary-sub-value {
    font-size: 24px;
  }

  .overview-meta {
    gap: 8px;
    margin-top: 4px;
    padding-top: 12px;
  }

  .overview-meta-item {
    width: 100%;
  }

  .overview-grid {
    column-count: 2;
    column-gap: 10px;
  }

  .budget-toolbar {
    gap: 8px;
  }

  .budget-detail-panel {
    min-height: auto;
    padding: 14px;
  }

  .budget-toolbar-item {
    width: 100%;
    justify-content: space-between;
  }

  .budget-select {
    width: 170px;
  }

  .budget-detail-list {
    overflow-x: auto;
  }

  .budget-detail-row {
    min-width: 620px;
  }

}

@media (max-width: 480px) {
  :deep(.ant-collapse-header) {
    align-items: flex-start !important;
    padding: 12px !important;
  }

  .day-header {
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .day-title,
  .day-city-tag,
  .day-transfer-tag,
  .day-attr-count,
  .day-date {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .day-city-tag {
    margin-left: 0;
  }

  .day-date {
    flex-basis: 100%;
    margin-left: 0;
    font-size: 12px;
  }

  .day-info .info-row {
    flex-direction: column;
    gap: 4px;
  }

  .day-info .info-row .label {
    min-width: 0;
  }
}

</style>

<style>
:root {
  --tripstar-map-accent: #D97757;
  --tripstar-map-accent-strong: #C4603D;
  --tripstar-map-surface: rgba(255, 255, 255, 0.92);
  --tripstar-map-border: rgba(217, 119, 87, 0.35);
  --tripstar-map-text-main: #3D3229;
  --tripstar-map-text-sub: rgba(61, 50, 41, 0.7);
}

.tripstar-map-pin {
  position: relative;
  width: 36px;
  height: 46px;
  cursor: pointer;
  transform-origin: 50% 100%;
  transition: transform 0.18s ease;
  filter: drop-shadow(0 4px 8px rgba(61, 50, 41, 0.3));
}

.tripstar-map-pin:hover {
  transform: scale(1.12);
}

.tripstar-map-pin__svg {
  display: block;
  width: 100%;
  height: 100%;
}

.tripstar-map-pin__num {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 35px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(61, 50, 41, 0.35);
  pointer-events: none;
}

.tripstar-map-tooltip {
  max-width: min(320px, calc(100vw - 40px));
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(61, 50, 41, 0.18);
  padding: 10px 14px;
  color: #3D3229;
  pointer-events: none;
}

.tripstar-map-tooltip__line {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(61, 50, 41, 0.68);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tripstar-map-tooltip__line + .tripstar-map-tooltip__line {
  margin-top: 2px;
}

.tripstar-map-tooltip__line--day {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.tripstar-map-tooltip__line--title {
  font-size: 14px;
  font-weight: 700;
  color: #3D3229;
}

.map-day-legend {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  max-width: calc(100% - 24px);
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(61, 50, 41, 0.08);
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(61, 50, 41, 0.12);
  pointer-events: none;
}

.map-day-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #3D3229;
  white-space: nowrap;
}

.map-day-legend__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(61, 50, 41, 0.35);
  flex-shrink: 0;
}

/* 地图加载遮罩：底图与路线就绪前覆盖，淡出过渡 */
.map-loading-mask {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: rgba(250, 247, 242, 0.92);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.map-loading-spinner {
  position: relative;
  width: 52px;
  height: 52px;
}

.map-loading-spinner__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid rgba(217, 119, 87, 0.18);
  border-top-color: #D97757;
  animation: map-loading-rotate 0.9s linear infinite;
}

.map-loading-spinner__pin {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 16px;
  height: 16px;
  background: #D97757;
  border-radius: 50% 50% 50% 4px;
  transform: translate(-50%, -62%) rotate(-45deg);
  box-shadow: inset 0 0 0 4px rgba(255, 255, 255, 0.85);
  animation: map-loading-pin-bounce 1.2s ease-in-out infinite;
}

.map-loading-text {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: #8a7d70;
}

@keyframes map-loading-rotate {
  to { transform: rotate(360deg); }
}

@keyframes map-loading-pin-bounce {
  0%, 100% { transform: translate(-50%, -62%) rotate(-45deg) scale(1); }
  50% { transform: translate(-50%, -78%) rotate(-45deg) scale(1.08); }
}

.map-loading-fade-enter-active,
.map-loading-fade-leave-active {
  transition: opacity 0.45s ease;
}

.map-loading-fade-enter-from,
.map-loading-fade-leave-to {
  opacity: 0;
}

.map-loading-text-enter-active,
.map-loading-text-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.map-loading-text-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.map-loading-text-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

#amap-container .amap-info-content {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
}

#amap-container .amap-info-sharp {
  display: none !important;
}
</style>
