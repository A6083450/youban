<template>
  <div class="result-container" :class="{ 'result-container--readonly': props.readonly }">
    <div class="lower-shade"></div>

    <main class="result-main">
      <div v-if="tripPlan" class="content-wrapper">
        <div class="top-switch-nav">
          <div class="top-switch-menu-wrap">
            <a-menu class="top-switch-menu" mode="horizontal" :disabled-overflow="true" :selected-keys="[activeSection]" @click="scrollToSection">
              <a-menu-item v-if="!props.readonly" key="today" :aria-selected="activeSection === 'today'">
                <span>{{ t('result.side.today') }}</span>
              </a-menu-item>
              <a-menu-item key="overview" :aria-selected="activeSection === 'overview'">
                <span>{{ t('result.side.overview') }}</span>
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
              <a-button type="default" @click="exportAsCalendar" class="action-btn">
                <CalendarOutlined class="action-icon" />
                {{ t('result.exportCalendar') }}
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
          ref="overviewSection"
          class="overview-card"
          :aria-label="t('result.side.overview')"
        >
          <div class="overview-journey">
            <TripJourney
              :trip-plan="tripPlan"
              :attraction-photos="attractionPhotos"
              @select-day="goToDayFromOverview"
            />
          </div>
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
                  <div class="budget-toolbar-item budget-basis-control">
                    <span class="budget-toolbar-label">{{ t('result.budget.amountBasis') }}</span>
                    <a-segmented
                      v-model:value="budgetDisplayBasis"
                      :options="budgetBasisOptions"
                      size="small"
                    />
                  </div>
                  <div class="budget-toolbar-item">
                    <span class="budget-toolbar-label">{{ t('result.budget.filterLabel') }}</span>
                    <a-select v-model:value="budgetFilterType" size="small" class="budget-select">
                      <a-select-option value="all">{{ t('result.budget.filterAll') }}</a-select-option>
                      <a-select-option value="attraction">{{ t('result.budget.attraction') }}</a-select-option>
                      <a-select-option value="hotel">{{ t('result.budget.hotel') }}</a-select-option>
                      <a-select-option value="meal">{{ t('result.budget.meal') }}</a-select-option>
                      <a-select-option value="transport">{{ t('result.budget.transport') }}</a-select-option>
                      <a-select-option value="other">{{ t('result.budget.other') }}</a-select-option>
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
                  <a-button
                    v-if="!props.readonly"
                    type="primary"
                    class="budget-add-btn"
                    :disabled="budgetLoading"
                    @click="openBudgetEditor()"
                  >
                    <template #icon><PlusOutlined /></template>
                    {{ t('result.budget.addItem') }}
                  </a-button>
                </div>

                <div v-if="filteredBudgetItems.length > 0" class="budget-detail-list">
                  <div
                    class="budget-detail-row budget-detail-header"
                    :class="{ 'budget-detail-row--readonly': props.readonly }"
                  >
                    <span>{{ t('result.budget.detailType') }}</span>
                    <span>{{ t('result.budget.detailDateRange') }}</span>
                    <span>{{ t('result.budget.detailName') }}</span>
                    <span>{{ t('result.budget.calculation') }}</span>
                    <span>{{ budgetAmountHeader }}</span>
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
                      {{ formatBudgetDayRange(item) }}
                    </span>
                    <span class="budget-detail-name">
                      <span class="budget-detail-name-main">
                        <span>{{ item.name }}</span>
                        <span v-if="item.origin === 'user' || item.user_locked" class="budget-origin-tag">
                          {{ t('result.budget.userDiy') }}
                        </span>
                      </span>
                      <span v-if="item.entity_source" class="budget-detail-source">
                        {{ formatBudgetSource(item) }}
                      </span>
                    </span>
                    <span class="budget-detail-calculation">
                      {{ formatBudgetCalculation(item) }}
                    </span>
                    <span class="budget-detail-amount" :class="{ 'budget-detail-amount--pending': displayBudgetItemAmount(item) === null }">
                      {{ displayBudgetItemAmount(item) === null
                        ? t('result.budget.amountPending')
                        : formatBudgetDisplayAmount(displayBudgetItemAmount(item)) }}
                    </span>
                    <span v-if="!props.readonly" class="budget-action-wrap">
                      <button
                        type="button"
                        class="budget-icon-btn budget-edit-btn"
                        :title="t('result.budget.editItem')"
                        @click="openBudgetEditor(item)"
                      >
                        <EditOutlined />
                      </button>
                      <button
                        type="button"
                        class="budget-icon-btn budget-delete-btn"
                        :title="t('common.delete')"
                        @click="removeBudgetItem(item)"
                      >
                        <DeleteOutlined />
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
              <div class="budget-summary-basis">
                {{ budgetDisplayBasis === 'per_person'
                  ? t('result.budget.perPersonFor', { count: effectiveBudgetTravelerCount })
                  : t('result.budget.groupFor', { count: effectiveBudgetTravelerCount }) }}
              </div>
              <div class="budget-summary-total-wrap">
                <span class="budget-summary-currency">¥</span>
                <span class="budget-summary-total-value">{{ formatBudgetAmount(displayBudgetTotals.total) }}</span>
                <span v-if="budgetDisplayBasis === 'per_person'" class="budget-summary-unit">/人</span>
              </div>
              <div class="budget-summary-sub-grid">
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(displayBudgetTotals.total_attractions) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.attraction') }}</div>
                </div>
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(displayBudgetTotals.total_hotels) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.hotel') }}</div>
                </div>
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(displayBudgetTotals.total_meals) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.meal') }}</div>
                </div>
                <div class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(displayBudgetTotals.total_transportation) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.transport') }}</div>
                </div>
                <div v-if="displayBudgetTotals.total_other" class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(displayBudgetTotals.total_other) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.budget.other') }}</div>
                </div>
                <div v-if="displayBudgetTotals.total_inter_city_transport" class="budget-summary-sub-item">
                  <div class="budget-summary-sub-value">¥{{ formatBudgetAmount(displayBudgetTotals.total_inter_city_transport) }}</div>
                  <div class="budget-summary-sub-label">{{ t('result.interCityTransport') }}</div>
                </div>
              </div>

              <div v-if="budgetPendingCount > 0" class="budget-unpriced-status">
                {{ t('result.budget.pendingAmountCount', { count: budgetPendingCount }) }}
              </div>

              <div v-if="!props.readonly" class="budget-pending-wrap">
                <div class="budget-pending-title">{{ t('result.budget.deletedTitle') }}</div>
                <div v-if="deletedBudgetItems.length === 0" class="budget-pending-empty">
                  {{ t('result.budget.deletedEmpty') }}
                </div>
                <div v-else class="budget-pending-list">
                  <div
                    v-for="pendingItem in deletedBudgetItems"
                    :key="pendingItem.id"
                    class="budget-pending-item"
                  >
                    <span class="budget-pending-name">{{ pendingItem.name }}</span>
                    <a-button
                      type="link"
                      size="small"
                      class="budget-restore-btn"
                      @click="restoreBudgetItem(pendingItem)"
                    >
                      <template #icon><UndoOutlined /></template>
                      {{ t('result.budget.restore') }}
                    </a-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <TripMap
            v-show="activeSection === 'map'"
            ref="tripMapRef"
            :trip-plan="tripPlan"
            :active="activeSection === 'map'"
            :focus-day-index="mapFocusDay"
          />
        </div>

        <!-- 今日行程 -->
        <section v-show="activeSection === 'today'" v-if="!props.readonly" class="today-section flow-card">
          <TripToday
            :trip-plan="tripPlan"
            :execution="executionMap"
            :day-array-index="todayArrayIndex"
            :attraction-photos="attractionPhotos"
            :confirmed-status-feedback="todayStatusFeedback"
            @update-status="handleUpdateItemStatus"
          />
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
        <TripGenerationFailure
          v-if="failedTaskEvent && !props.readonly"
          :task-id="failedTaskEvent.task_id"
          :city="failedTaskCity"
          :date-range="failedTaskDateRange"
          :error="failedTaskError"
          :checkpoint-summary="failedTaskEvent.checkpoint_summary"
          :loading="retryingFailedPlan"
          @retry="retryFailedPlan(false)"
          @restart-all="retryFailedPlan(true)"
        />
        <div v-else-if="loadingPlan && !props.readonly" class="result-task-loading">
          <YoubanLoader :message="t('tripFailure.retrying')" />
        </div>
        <a-empty v-else :description="t('result.noTripPlan')">
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
    <a-modal
      v-if="!props.readonly"
      v-model:open="budgetEditorOpen"
      :title="budgetEditorTitle"
      :ok-text="t('common.ok')"
      :cancel-text="t('common.cancel')"
      :confirm-loading="budgetSaving"
      @ok="saveBudgetEditor"
    >
      <a-form layout="vertical" class="budget-editor-form">
        <a-form-item :label="t('result.budget.detailType')" required>
          <a-select v-model:value="budgetEditor.type" :disabled="editingItineraryAttraction">
            <a-select-option
              value="attraction"
              :disabled="Boolean(budgetEditor.id) && budgetEditor.type !== 'attraction'"
            >
              {{ t('result.budget.attraction') }}
            </a-select-option>
            <a-select-option value="hotel">{{ t('result.budget.hotel') }}</a-select-option>
            <a-select-option value="meal">{{ t('result.budget.meal') }}</a-select-option>
            <a-select-option value="transport">{{ t('result.budget.transport') }}</a-select-option>
            <a-select-option value="other">{{ t('result.budget.other') }}</a-select-option>
          </a-select>
        </a-form-item>

        <template v-if="isAttractionEditorMode">
          <a-form-item :label="t('result.budget.detailDay')" required>
            <a-select v-model:value="attractionEditor.dayIndex">
              <a-select-option
                v-for="day in tripPlan?.days ?? []"
                :key="day.day_index"
                :value="day.day_index"
              >
                {{ t('common.dayNumber', { day: day.day_index + 1 }) }} · {{ day.city || tripPlan?.city }}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item :label="t('result.budget.realAttraction')" required>
            <a-input-search
              v-model:value="attractionEditor.query"
              :placeholder="t('result.budget.attractionSearchPlaceholder')"
              :enter-button="t('result.budget.search')"
              :loading="attractionSearchLoading"
              @search="searchAttractionPoiOptions"
            />
            <div v-if="attractionPoiResults.length" class="attraction-poi-results">
              <button
                v-for="poi in attractionPoiResults"
                :key="poi.id"
                type="button"
                class="attraction-poi-option"
                :class="{ 'is-selected': attractionEditor.poi?.id === poi.id }"
                @click="selectAttractionPoi(poi)"
              >
                <EnvironmentOutlined aria-hidden="true" />
                <span>
                  <strong>{{ poi.name }}</strong>
                  <small>{{ poi.address || poi.type }}</small>
                </span>
              </button>
            </div>
            <div v-if="attractionEditor.poi" class="attraction-poi-selected">
              <EnvironmentOutlined aria-hidden="true" />
              <span>
                <strong>{{ attractionEditor.poi.name }}</strong>
                <small>{{ attractionEditor.poi.address }}</small>
              </span>
              <span>{{ t('result.budget.amapVerified') }}</span>
            </div>
          </a-form-item>
          <div class="attraction-schedule-grid">
            <a-form-item :label="t('result.budget.startTime')" required>
              <a-input v-model:value="attractionEditor.startTime" type="time" />
            </a-form-item>
            <a-form-item :label="t('result.fieldVisitDurationMinutes')" required>
              <a-input-number
                v-model:value="attractionEditor.visitDuration"
                :min="30"
                :max="720"
                :step="30"
                class="budget-amount-input"
              />
            </a-form-item>
          </div>
          <a-form-item :label="t('result.budget.ticketPricePerPerson')">
            <a-input-number
              v-model:value="attractionEditor.ticketPrice"
              :min="0"
              :max="1000000"
              :precision="0"
              class="budget-amount-input"
            />
          </a-form-item>
          <a-form-item :label="t('result.fieldDescription')">
            <a-textarea
              v-model:value="attractionEditor.description"
              :maxlength="1000"
              :rows="3"
            />
          </a-form-item>
          <a-form-item>
            <a-checkbox v-model:checked="attractionEditor.reservationRequired">
              {{ t('result.reservationRequired') }}
            </a-checkbox>
          </a-form-item>
          <a-form-item
            v-if="attractionEditor.reservationRequired"
            :label="t('result.budget.reservationTips')"
          >
            <a-input
              v-model:value="attractionEditor.reservationTips"
              :maxlength="500"
            />
          </a-form-item>
        </template>

        <template v-else>
          <a-form-item :label="t('result.budget.detailDay')" required>
            <a-select v-model:value="budgetEditor.dayIndex">
              <a-select-option :value="-1">{{ t('result.budget.wholeTrip') }}</a-select-option>
              <a-select-option
                v-for="day in tripPlan?.days ?? []"
                :key="day.day_index"
                :value="day.day_index"
              >
                {{ t('common.dayNumber', { day: day.day_index + 1 }) }}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item :label="t('result.budget.detailName')" required>
            <a-input v-model:value="budgetEditor.name" :maxlength="120" />
          </a-form-item>
          <a-form-item :label="t('result.budget.amountBasis')" required>
            <a-segmented
              v-model:value="budgetEditor.amountBasis"
              :options="budgetBasisOptions"
              block
            />
          </a-form-item>
          <a-form-item :label="budgetEditor.amountBasis === 'per_person'
            ? t('result.budget.perPersonAmount')
            : t('result.budget.groupTotalAmount')">
            <a-input-number
              v-model:value="budgetEditor.amount"
              :min="0"
              :max="100000000"
              :precision="2"
              :placeholder="t('result.budget.amountPending')"
              class="budget-amount-input"
            />
          </a-form-item>
          <a-form-item :label="t('result.budget.note')">
            <a-input v-model:value="budgetEditor.note" :maxlength="300" />
          </a-form-item>
        </template>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message, Modal } from 'ant-design-vue'
import {
  CalendarOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  ShareAltOutlined,
  UndoOutlined,
} from '@ant-design/icons-vue'
import { gsap } from 'gsap'
import html2canvas from 'html2canvas'
import dayjs from 'dayjs'
import OverviewAttractionCard from '@/components/OverviewAttractionCard.vue'
import PlanChatPanel from '@/components/PlanChatPanel.vue'
import SharePlanModal from '@/components/SharePlanModal.vue'
import WeatherDayCard from '@/components/WeatherDayCard.vue'
import TripJourney from '@/components/TripJourney.vue'
import DailyItinerary from '@/components/DailyItinerary.vue'
import TripMap from '@/components/TripMap.vue'
import TripToday from '@/components/TripToday.vue'
import TripGenerationFailure from '@/components/TripGenerationFailure.vue'
import YoubanLoader from '@/components/YoubanLoader.vue'
import type {
  Attraction,
  Budget,
  BudgetAmountBasis,
  BudgetItemInput,
  BudgetItemType,
  BudgetLedgerItem,
  BudgetLedgerResponse,
  ExecutionMap,
  ItemExecutionStatus,
  ItineraryAttractionInput,
  ItineraryMutationResponse,
  PoiSearchItem,
  ShareLoadErrorKind,
  TripPlan,
  TripPlanResponse,
  TripTaskEvent,
  WeatherInfo,
} from '@/types'
import {
  createBudgetItem,
  createItineraryAttraction,
  createTripShare,
  deleteBudgetItem as deleteBudgetLedgerItem,
  deleteItineraryAttraction,
  getBudgetItems,
  getRuntimeApiBaseUrl,
  getSharedTripPlan,
  pollTaskStatus,
  retryTripPlan,
  searchAttractionPois,
  SharedTripPlanError,
  TripShareCreationError,
  updateItemStatus,
  updateBudgetItem,
  updateItineraryAttraction,
  watchTripTask,
} from '@/services/api'
import { currentUser } from '@/stores/auth'
import { notifyPlansUpdated } from '@/stores/plans'
import { canUseCachedPlan } from '@/utils/planConversation.js'
import {
  buildDayTimeline,
  normalizeReferenceTime,
  resolveTripBlueprint,
} from '@/utils/tripPresentation.js'
import { findTodayArrayIndex } from '@/utils/tripExecution'
import { buildTripCalendar, countCalendarEvents } from '@/utils/tripCalendar'

const props = withDefaults(defineProps<{ planId?: string; readonly?: boolean }>(), {
  readonly: false,
})
const emit = defineEmits<{
  (event: 'share-load-error', kind: ShareLoadErrorKind): void
}>()
const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const tripPlan = ref<TripPlan | null>(null)
const planId = ref('')
const attractionPhotos = ref<Record<string, string>>({})
const activeSection = ref('overview')
const pendingDayScrollIndex = ref<number | null>(null)
const failedTaskEvent = ref<TripTaskEvent | null>(null)
const retryingFailedPlan = ref(false)
const loadingPlan = ref(false)
let isAlive = true
let planOperationToken = 0

type PlanOperation = {
  token: number
  lookupId: string
  ownerId: string
  readonly: boolean
}

let activeLookupId = ''

const planOperation = (lookupId: string, token = planOperationToken): PlanOperation => ({
  token,
  lookupId,
  ownerId: props.readonly ? '' : (currentUser.value?.user_id || ''),
  readonly: props.readonly,
})

const beginPlanOperation = (lookupId: string): PlanOperation => {
  activeLookupId = lookupId
  return planOperation(lookupId, ++planOperationToken)
}

const ownsPlanOperation = (operation: PlanOperation): boolean =>
  isAlive
  && operation.token === planOperationToken
  && operation.lookupId === activeLookupId
  && operation.readonly === props.readonly
  && (operation.readonly || operation.ownerId === (currentUser.value?.user_id || ''))

const failedTaskCity = computed(() => {
  const request = failedTaskEvent.value?.request_payload
  if (request?.city) return request.city
  return request?.cities?.map((item) => item.city).filter(Boolean).join(' / ') || ''
})
const failedTaskDateRange = computed(() => {
  const request = failedTaskEvent.value?.request_payload
  return request?.start_date && request.end_date
    ? `${request.start_date} ${t('common.to')} ${request.end_date}`
    : ''
})
const failedTaskError = computed(() =>
  failedTaskEvent.value?.error || failedTaskEvent.value?.message || t('result.noTripPlanDesc')
)

// ─── 今日行程执行状态(V1.1) ───
const executionMap = ref<ExecutionMap>({})
const todayStatusFeedback = ref<{ id: number; itemId: string; status: ItemExecutionStatus }>()
let todayStatusFeedbackSequence = 0
const mapFocusDay = ref<number | null>(null)

const todayArrayIndex = computed(() =>
  tripPlan.value ? findTodayArrayIndex(tripPlan.value, dayjs().format('YYYY-MM-DD')) : -1,
)

// 加载完成后的初始落点:URL ?section= 优先;行程期内默认进今日视图
const applyInitialSection = () => {
  if (props.readonly) return
  const requested = String(route.query.section || '')
  if (requested === 'knowledge-graph') {
    activeSection.value = 'overview'
    return
  }
  const valid = ['overview', 'days', 'map', 'budget', 'weather', 'today']
  if (requested && valid.includes(requested)) {
    activeSection.value = requested
    return
  }
  if (todayArrayIndex.value >= 0) activeSection.value = 'today'
}

// 后台刷新 execution;缓存计划缺 id 时顺带换成后端带 id 版本
const refreshExecutionFromBackend = async (targetPlanId: string, operation?: PlanOperation) => {
  if (!targetPlanId || (operation && !ownsPlanOperation(operation))) return
  try {
    const task = await pollTaskStatus(targetPlanId)
    if (task?.status !== 'completed' || (operation && !ownsPlanOperation(operation))) return
    executionMap.value = task.execution || {}
    const missingIds = tripPlan.value?.days.some((day) =>
      day.attractions.some((a) => !a.id) || day.meals.some((m) => !m.id),
    )
    if (missingIds && task.result?.data) {
      tripPlan.value = task.result.data
      sessionStorage.setItem('tripPlan', JSON.stringify(task.result.data))
    }
  } catch {
    /* 静默:execution 非关键路径 */
  }
}

// 乐观更新 + 失败回滚
const handleUpdateItemStatus = async (payload: { itemId: string; status: ItemExecutionStatus; actualCost?: number }) => {
  const operation = planOperation(activeLookupId)
  const targetPlanId = planId.value
  const prev = executionMap.value[payload.itemId]
  const optimistic: ExecutionMap = { ...executionMap.value }
  if (payload.status === 'pending') {
    delete optimistic[payload.itemId]
  } else {
    optimistic[payload.itemId] = {
      status: payload.status,
      updated_at: new Date().toISOString(),
      ...(payload.actualCost !== undefined ? { actual_cost: payload.actualCost } : {}),
    }
  }
  executionMap.value = optimistic
  try {
    const entry = await updateItemStatus(targetPlanId, payload.itemId, payload.status, payload.actualCost)
    if (!ownsPlanOperation(operation)) return
    const confirmed: ExecutionMap = { ...executionMap.value }
    if (entry) confirmed[payload.itemId] = entry
    else delete confirmed[payload.itemId]
    executionMap.value = confirmed
    todayStatusFeedback.value = {
      id: ++todayStatusFeedbackSequence,
      itemId: payload.itemId,
      status: payload.status,
    }
  } catch {
    if (!ownsPlanOperation(operation)) return
    const rollback: ExecutionMap = { ...executionMap.value }
    if (prev) rollback[payload.itemId] = prev
    else delete rollback[payload.itemId]
    executionMap.value = rollback
    message.error(t('result.today.updateFailed'))
  }
}

const shareModalOpen = ref(false)
const sharePublishing = ref(false)
const shareCode = ref('')

type TripMapHandle = {
  captureScreenshot: () => Promise<string>
}

const tripMapRef = ref<TripMapHandle | null>(null)

// ─── 行程概览动画:GSAP 驱动,简约暖风格 ───
const overviewSection = ref<HTMLElement | null>(null)
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let overviewGsapCtx: gsap.Context | undefined

// 入场:卡片上浮淡入 + 图片 clip-path 柔雾揭幕,expo 缓动,编辑级排版感;
// 每次切回概览 tab 重播
const playOverviewIntro = (): void => {
  if (prefersReducedMotion || !overviewSection.value) return
  overviewGsapCtx?.revert()
  overviewGsapCtx = gsap.context(() => {
    const tl = gsap.timeline()
    tl.fromTo(
      '.overview-card-item',
      { autoAlpha: 0, y: 18 },
      { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.06 },
    ).fromTo(
      '.card-img',
      { clipPath: 'inset(8% 8% 8% 8% round 14px)', scale: 0.985 },
      { clipPath: 'inset(0% 0% 0% 0% round 10px)', scale: 1, duration: 0.75, ease: 'expo.out', stagger: 0.06 },
      '<0.08',
    )
    startOverviewAmbient()
  }, overviewSection.value)
}

// 图片极缓慢推近+微移;延迟随机,避免整列同相位
const animateCardImg = (img: Element): void => {
  gsap.fromTo(img,
    { scale: 1.02 },
    {
      scale: 1.07,
      xPercent: 0.8,
      yPercent: -0.8,
      duration: 14,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      delay: Math.random() * 5,
    })
}

// 持续氛围:暖金色微光呼吸(慢、软、随机错峰),图片极缓慢推近。
// 微光层始终存在不依赖图片加载;后到位的图片由 attractionPhotos 监听补挂推近动画
const startOverviewAmbient = (): void => {
  gsap.to('.img-glow', {
    opacity: 1,
    duration: 5.5,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
    stagger: { each: 2.1, from: 'random' },
  })
  gsap.utils.toArray<Element>('.card-img img').forEach(animateCardImg)
}

onMounted(() => {
  playOverviewIntro()
})

watch(activeSection, async (section) => {
  if (section !== 'overview') return
  await nextTick()  // 等 v-show 恢复布局后再量取/回放
  playOverviewIntro()
})

// 图片异步到位:给后渲染的 img 补挂推近动画(已在动的不重复挂)
watch(() => Object.keys(attractionPhotos.value).length, async () => {
  if (prefersReducedMotion || !overviewSection.value) return
  await nextTick()
  overviewSection.value.querySelectorAll('.card-img img').forEach((img) => {
    if (!gsap.isTweening(img)) animateCardImg(img)
  })
})

onBeforeUnmount(() => {
  isAlive = false
  planOperationToken += 1
  overviewGsapCtx?.revert()
})

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

type BudgetSortMode = 'amountDesc' | 'amountAsc' | 'dayAsc' | 'dayDesc'

type BudgetDetailItem = BudgetLedgerItem & {
  dayNumber: number | null
  endDayNumber: number | null
}

type BudgetEditorState = {
  id: string
  type: BudgetItemType
  dayIndex: number
  name: string
  amount: number | null
  amountBasis: BudgetAmountBasis
  note: string
}

type AttractionEditorState = {
  itemId: string
  dayIndex: number
  query: string
  poi: PoiSearchItem | null
  startTime: string
  visitDuration: number
  ticketPrice: number
  description: string
  reservationRequired: boolean
  reservationTips: string
}

const budgetFilterType = ref<'all' | BudgetItemType>('all')
const budgetSortMode = ref<BudgetSortMode>('amountDesc')
const budgetDisplayBasis = ref<BudgetAmountBasis>('per_person')
const budgetLedgerItems = ref<BudgetLedgerItem[]>([])
const budgetPerPersonTotals = ref<Budget | null>(null)
const budgetTravelerCount = ref(0)
const budgetPendingCount = ref(0)
const budgetLoading = ref(false)
const budgetSaving = ref(false)
const budgetEditorOpen = ref(false)
const budgetEditor = ref<BudgetEditorState>({
  id: '',
  type: 'other',
  dayIndex: -1,
  name: '',
  amount: null,
  amountBasis: 'per_person',
  note: '',
})
const editingItineraryAttraction = ref(false)
const attractionSearchLoading = ref(false)
const attractionPoiResults = ref<PoiSearchItem[]>([])
const attractionEditor = ref<AttractionEditorState>({
  itemId: '',
  dayIndex: 0,
  query: '',
  poi: null,
  startTime: '09:00',
  visitDuration: 90,
  ticketPrice: 0,
  description: '',
  reservationRequired: false,
  reservationTips: '',
})
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

// 数据异步到位:content-wrapper 是 v-if="tripPlan",onMounted 时概览区块尚不存在,
// 首次出现景点卡片时补一次入场+持续动画(必须定义在 overviewAttractions 之后,
// watch 会立即求值一次 getter)
watch(() => overviewAttractions.value.length, async (len) => {
  if (len === 0 || activeSection.value !== 'overview') return
  await nextTick()
  playOverviewIntro()
})

// 加载所有景点图片
const loadAttractionPhotos = async (operation?: PlanOperation) => {
  if (!tripPlan.value || (operation && !ownsPlanOperation(operation))) return

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
          if (data.success && data.data.photo_url && (!operation || ownsPlanOperation(operation))) {
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
  budgetLedgerItems.value = []
  budgetPerPersonTotals.value = null
  budgetTravelerCount.value = 0
  budgetPendingCount.value = 0

  if (payload.planId) {
    planId.value = payload.planId
    sessionStorage.setItem('planId', payload.planId)
  }

  sessionStorage.setItem('tripPlan', JSON.stringify(payload.plan))

  await loadAttractionPhotos()
  if (!props.readonly && planId.value) await loadBudgetLedger(planId.value)
}

// Agent 对话修改计划后重新同步台账；用户锁定和 DIY 条目由后端保留。
const applyAgentPlan = async (plan: TripPlan) => {
  await applyTripPlanPayload({
    plan,
    planId: planId.value,
  })
  message.success(t('result.agent.changesTitle'))
}

const restoreTripPlanFromResponse = async (
  response?: TripPlanResponse | null,
  operation?: PlanOperation,
) => {
  if (!response?.data || (operation && !ownsPlanOperation(operation))) return false
  tripPlan.value = response.data
  budgetLedgerItems.value = []
  budgetPerPersonTotals.value = null
  budgetTravelerCount.value = 0
  budgetPendingCount.value = 0
  const responsePlanId = String(response.plan_id || planId.value || '')
  if (responsePlanId) {
    planId.value = responsePlanId
    sessionStorage.setItem('planId', responsePlanId)
  }
  sessionStorage.setItem('tripPlan', JSON.stringify(response.data))
  await loadAttractionPhotos(operation)
  if (!props.readonly && responsePlanId) await loadBudgetLedger(responsePlanId, operation)
  return !operation || ownsPlanOperation(operation)
}

const failedEvent = (
  taskId: string,
  error: unknown,
  latest?: TripTaskEvent,
  fallback?: TripTaskEvent,
): TripTaskEvent => ({
  task_id: taskId,
  plan_id: taskId,
  status: 'failed',
  stage: 'failed',
  progress: 100,
  message: error instanceof Error ? error.message : t('result.noTripPlanDesc'),
  error: error instanceof Error ? error.message : t('result.noTripPlanDesc'),
  checkpoint_summary: latest?.checkpoint_summary || fallback?.checkpoint_summary,
  request_payload: latest?.request_payload || fallback?.request_payload,
})

const focusFailedPlan = (operation: PlanOperation) => nextTick(() => {
  if (!ownsPlanOperation(operation)) return
  document.getElementById(`trip-failure-${operation.lookupId}`)
    ?.querySelector<HTMLButtonElement>('button')?.focus()
})

const watchPlanUntilSettled = async (
  operation: PlanOperation,
  wsPath?: string,
  fallbackEvent?: TripTaskEvent,
) => {
  if (!ownsPlanOperation(operation)) return
  loadingPlan.value = true
  let latestEvent = fallbackEvent
  try {
    const response = await watchTripTask(operation.lookupId, {
      onTaskEvent: (event) => {
        if (!ownsPlanOperation(operation)) return
        latestEvent = event
        if (event.status === 'failed') failedTaskEvent.value = event
      },
    }, wsPath)
    if (!ownsPlanOperation(operation)) return
    const restored = await restoreTripPlanFromResponse(response, operation)
    if (!restored || !ownsPlanOperation(operation)) return
    failedTaskEvent.value = null
    applyInitialSection()
    notifyPlansUpdated()
  } catch (error: unknown) {
    if (!ownsPlanOperation(operation)) return
    failedTaskEvent.value = failedEvent(
      operation.lookupId,
      error,
      failedTaskEvent.value || latestEvent,
      fallbackEvent,
    )
    if (fallbackEvent) focusFailedPlan(operation)
  } finally {
    if (ownsPlanOperation(operation)) {
      loadingPlan.value = false
      retryingFailedPlan.value = false
    }
  }
}

const retryFailedPlan = async (restartAll: boolean) => {
  if (retryingFailedPlan.value || !failedTaskEvent.value || props.readonly) return
  const failedSnapshot = failedTaskEvent.value
  const targetPlanId = failedSnapshot.task_id
  const operation = beginPlanOperation(targetPlanId)
  retryingFailedPlan.value = true
  try {
    const task = await retryTripPlan(targetPlanId, restartAll)
    if (!ownsPlanOperation(operation)) return
    if (task.task_id !== targetPlanId) throw new Error(t('result.noTripPlanDesc'))
    failedTaskEvent.value = null
    await watchPlanUntilSettled(operation, task.ws_url, failedSnapshot)
  } catch (error: unknown) {
    if (!ownsPlanOperation(operation)) return
    failedTaskEvent.value = failedEvent(targetPlanId, error, failedTaskEvent.value || undefined, failedSnapshot)
    retryingFailedPlan.value = false
    focusFailedPlan(operation)
  }
}

const loadPlanById = async (targetPlanId: string) => {
  planId.value = targetPlanId
  const operation = beginPlanOperation(targetPlanId)
  tripPlan.value = null
  failedTaskEvent.value = null
  loadingPlan.value = false
  retryingFailedPlan.value = false
  budgetLedgerItems.value = []
  budgetPerPersonTotals.value = null
  budgetTravelerCount.value = 0
  budgetPendingCount.value = 0
  attractionPhotos.value = {}
  activeSection.value = 'overview'
  executionMap.value = {}
  pendingDayScrollIndex.value = null

  const data = sessionStorage.getItem('tripPlan')
  const storedPlanId = String(sessionStorage.getItem('planId') || '')
  const canUseCachedData = canUseCachedPlan(data, storedPlanId, targetPlanId)
  if (targetPlanId) sessionStorage.setItem('planId', targetPlanId)

  if (props.readonly) {
    try {
      const task = await getSharedTripPlan(targetPlanId)
      if (!ownsPlanOperation(operation)) return
      if (task?.status === 'completed' && task.result) {
        await restoreTripPlanFromResponse(task.result, operation)
      }
    } catch (error: unknown) {
      if (!ownsPlanOperation(operation)) return
      const kind = error instanceof SharedTripPlanError ? error.kind : 'network'
      emit('share-load-error', kind)
    }
    return
  }

  if (data && canUseCachedData) {
    const restored = await restoreTripPlanFromResponse({
      success: true,
      message: '',
      plan_id: targetPlanId || storedPlanId,
      data: JSON.parse(data),
    }, operation)
    if (!restored || !ownsPlanOperation(operation)) return
    applyInitialSection()
    void refreshExecutionFromBackend(targetPlanId || storedPlanId, operation)
    return
  }

  if (!targetPlanId) return
  loadingPlan.value = true
  try {
    const task = await pollTaskStatus(targetPlanId)
    if (!ownsPlanOperation(operation)) return
    if (task?.status === 'completed' && task.result) {
      const restored = await restoreTripPlanFromResponse(task.result, operation)
      if (!restored || !ownsPlanOperation(operation)) return
      executionMap.value = task.execution || {}
      loadingPlan.value = false
      applyInitialSection()
      return
    }
    if (task?.status === 'failed') {
      failedTaskEvent.value = task as TripTaskEvent
      loadingPlan.value = false
      return
    }
    if (task?.status === 'processing') {
      await watchPlanUntilSettled(operation, undefined, task as TripTaskEvent)
      return
    }
    loadingPlan.value = false
  } catch (error: unknown) {
    if (!ownsPlanOperation(operation)) return
    loadingPlan.value = false
    console.error('结果页从后端回补旅行计划失败:', error)
  }
}

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

watch(() => currentUser.value?.user_id, async () => {
  if (props.readonly) return
  planOperationToken += 1
  tripPlan.value = null
  failedTaskEvent.value = null
  loadingPlan.value = false
  retryingFailedPlan.value = false
  executionMap.value = {}
  attractionPhotos.value = {}
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('planId')
  const targetPlanId = String(props.planId || '')
  if (targetPlanId) await loadPlanById(targetPlanId)
})

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
})

const goBack = () => {
  router.push('/')
}

// 滚动到指定区域
const scrollToSection = ({ key }: { key: string }) => {
  // 从今日视图切到地图时,记录今日下标供地图聚焦(Task 7 消费)
  if (key === 'map' && activeSection.value === 'today' && todayArrayIndex.value >= 0) {
    mapFocusDay.value = todayArrayIndex.value
  }

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
    other: t('result.budget.other'),
  }
  return labels[type]
}

const budgetBasisOptions = computed(() => [
  { label: t('result.budget.perPerson'), value: 'per_person' },
  { label: t('result.budget.groupTotal'), value: 'group_total' },
])

const effectiveBudgetTravelerCount = computed(() => Math.max(
  1,
  budgetTravelerCount.value || tripPlan.value?.traveler_count || 1,
))

const emptyBudget = (): Budget => ({
  total_attractions: 0,
  total_hotels: 0,
  total_meals: 0,
  total_transportation: 0,
  total_inter_city_transport: 0,
  total_other: 0,
  total: 0,
})

const divideBudget = (budget: Budget, divisor: number): Budget => ({
  total_attractions: roundBudgetAmount((budget.total_attractions || 0) / divisor),
  total_hotels: roundBudgetAmount((budget.total_hotels || 0) / divisor),
  total_meals: roundBudgetAmount((budget.total_meals || 0) / divisor),
  total_transportation: roundBudgetAmount((budget.total_transportation || 0) / divisor),
  total_inter_city_transport: roundBudgetAmount((budget.total_inter_city_transport || 0) / divisor),
  total_other: roundBudgetAmount((budget.total_other || 0) / divisor),
  total: roundBudgetAmount((budget.total || 0) / divisor),
})

const displayBudgetTotals = computed<Budget>(() => {
  const groupTotals = tripPlan.value?.budget || emptyBudget()
  if (budgetDisplayBasis.value === 'group_total') return groupTotals
  return budgetPerPersonTotals.value
    || divideBudget(groupTotals, effectiveBudgetTravelerCount.value)
})

const budgetAmountHeader = computed(() => budgetDisplayBasis.value === 'per_person'
  ? t('result.budget.perPersonAmount')
  : t('result.budget.groupTotalAmount'))

const displayBudgetItemAmount = (item: BudgetLedgerItem): number | null => (
  budgetDisplayBasis.value === 'per_person' ? item.per_person_amount : item.amount
)

const formatBudgetDisplayAmount = (value: number | null): string => {
  if (value === null) return t('result.budget.amountPending')
  const amount = formatBudgetAmount(value)
  return budgetDisplayBasis.value === 'per_person'
    ? t('result.budget.perPersonValue', { amount })
    : t('result.budget.groupValue', { amount })
}

const formatBudgetDayRange = (item: BudgetLedgerItem): string => {
  if (item.day_index === null) return t('result.budget.wholeTrip')
  const start = item.day_index + 1
  const end = item.day_end_index === null ? start : item.day_end_index + 1
  return end > start
    ? t('result.budget.dayRange', { start, end })
    : t('common.dayNumber', { day: start })
}

const formatBudgetCalculation = (item: BudgetLedgerItem): string => {
  if (item.calculation_summary === 'room_night'
    && item.unit_amount !== null && item.room_count && item.nights) {
    return t('result.budget.roomNightCalculation', {
      unit: formatBudgetAmount(item.unit_amount),
      rooms: item.room_count,
      nights: item.nights,
    })
  }
  if (item.calculation_summary === 'per_person' && item.unit_amount !== null) {
    return t('result.budget.perPersonCalculation', {
      unit: formatBudgetAmount(item.unit_amount),
      travelers: item.traveler_count,
    })
  }
  if (item.calculation_summary === 'shared_total' && item.amount !== null) {
    return t('result.budget.sharedCalculation', {
      travelers: item.traveler_count,
    })
  }
  return item.amount_basis === 'per_person'
    ? t('result.budget.enteredPerPerson')
    : t('result.budget.enteredGroupTotal')
}

const formatBudgetSource = (item: BudgetLedgerItem): string => {
  const provider = item.entity_source === 'flyai'
    ? 'FlyAI'
    : item.entity_source === 'amap'
      ? t('result.budget.amap')
      : item.entity_source
  if (item.price_source === 'user') {
    return provider
      ? t('result.budget.userPriceWithSource', { provider })
      : t('result.budget.userPrice')
  }
  const checked = dayjs(item.price_checked_at)
  return checked.isValid()
    ? t('result.budget.sourceChecked', { provider, date: checked.format('YYYY-MM-DD') })
    : provider
}

const applyBudgetLedgerResponse = (response: BudgetLedgerResponse) => {
  budgetLedgerItems.value = response.items
  budgetPendingCount.value = response.pending_count
  budgetPerPersonTotals.value = response.per_person_totals
  budgetTravelerCount.value = response.traveler_count
  if (tripPlan.value) {
    tripPlan.value.budget = response.totals
    sessionStorage.setItem('tripPlan', JSON.stringify(tripPlan.value))
  }
}

const loadBudgetLedger = async (targetPlanId: string, operation?: PlanOperation) => {
  if (!targetPlanId || props.readonly) return
  budgetLoading.value = true
  try {
    const response = await getBudgetItems(targetPlanId)
    if (operation && !ownsPlanOperation(operation)) return
    applyBudgetLedgerResponse(response)
  } catch {
    if (!operation || ownsPlanOperation(operation)) {
      message.error(t('result.messages.budgetLoadFailed'))
    }
  } finally {
    if (!operation || ownsPlanOperation(operation)) budgetLoading.value = false
  }
}

const budgetItems = computed<BudgetDetailItem[]>(() =>
  budgetLedgerItems.value
    .filter((item) => !item.deleted)
    .map((item) => ({
      ...item,
      dayNumber: item.day_index === null ? null : item.day_index + 1,
      endDayNumber: item.day_end_index === null ? null : item.day_end_index + 1,
    })),
)

const deletedBudgetItems = computed<BudgetLedgerItem[]>(() =>
  budgetLedgerItems.value.filter((item) => item.deleted),
)

const filteredBudgetItems = computed<BudgetDetailItem[]>(() => {
  let items = budgetItems.value

  if (budgetFilterType.value !== 'all') {
    items = items.filter((item) => item.type === budgetFilterType.value)
  }

  const sorted = [...items]
  sorted.sort((a, b) => {
    const dayA = a.dayNumber ?? Number.MAX_SAFE_INTEGER
    const dayB = b.dayNumber ?? Number.MAX_SAFE_INTEGER
    const amountA = displayBudgetItemAmount(a)
    const amountB = displayBudgetItemAmount(b)

    switch (budgetSortMode.value) {
      case 'amountAsc':
        return (amountA ?? Number.MAX_SAFE_INTEGER) - (amountB ?? Number.MAX_SAFE_INTEGER)
      case 'dayAsc':
        return dayA - dayB || (amountB ?? -1) - (amountA ?? -1)
      case 'dayDesc':
        return dayB - dayA || (amountB ?? -1) - (amountA ?? -1)
      case 'amountDesc':
      default:
        return (amountB ?? -1) - (amountA ?? -1)
    }
  })

  return sorted
})

const isAttractionEditorMode = computed(() =>
  editingItineraryAttraction.value
  || (!budgetEditor.value.id && budgetEditor.value.type === 'attraction'),
)

const budgetEditorTitle = computed(() => {
  if (isAttractionEditorMode.value) {
    return t(attractionEditor.value.itemId
      ? 'result.budget.editAttraction'
      : 'result.budget.addAttraction')
  }
  return t(budgetEditor.value.id ? 'result.budget.editItem' : 'result.budget.addItem')
})

const findPlanAttraction = (attractionId: string): { attraction: Attraction; dayIndex: number } | null => {
  for (const day of tripPlan.value?.days ?? []) {
    const attraction = day.attractions.find((candidate) => candidate.id === attractionId)
    if (attraction) return { attraction, dayIndex: day.day_index }
  }
  return null
}

const resetAttractionEditor = () => {
  attractionPoiResults.value = []
  attractionEditor.value = {
    itemId: '',
    dayIndex: tripPlan.value?.days[0]?.day_index ?? 0,
    query: '',
    poi: null,
    startTime: '09:00',
    visitDuration: 90,
    ticketPrice: 0,
    description: '',
    reservationRequired: false,
    reservationTips: '',
  }
}

const selectedAttractionDay = () =>
  tripPlan.value?.days.find((day) => day.day_index === attractionEditor.value.dayIndex)

const searchAttractionPoiOptions = async (rawQuery?: string) => {
  const query = String(rawQuery ?? attractionEditor.value.query).trim()
  const day = selectedAttractionDay()
  const city = day?.city || tripPlan.value?.city || ''
  if (!query || !city) {
    message.warning(t('result.messages.attractionSearchRequired'))
    return
  }
  attractionSearchLoading.value = true
  try {
    attractionPoiResults.value = await searchAttractionPois(query, city)
    if (!attractionPoiResults.value.length) {
      message.info(t('result.messages.attractionSearchEmpty'))
    }
  } catch {
    attractionPoiResults.value = []
    message.error(t('result.messages.attractionSearchFailed'))
  } finally {
    attractionSearchLoading.value = false
  }
}

const selectAttractionPoi = (poi: PoiSearchItem) => {
  attractionEditor.value.poi = poi
  attractionEditor.value.query = poi.name
}

const openBudgetEditor = (item?: BudgetDetailItem) => {
  editingItineraryAttraction.value = false
  resetAttractionEditor()
  budgetEditor.value = item
    ? {
        id: item.id,
        type: item.type,
        dayIndex: item.day_index ?? -1,
        name: item.name,
        amount: item.amount_basis === 'per_person' ? item.per_person_amount : item.amount,
        amountBasis: item.amount_basis,
        note: item.note || '',
      }
    : {
        id: '',
        type: 'other',
        dayIndex: -1,
        name: '',
        amount: null,
        amountBasis: budgetDisplayBasis.value,
        note: '',
      }

  if (item?.type === 'attraction' && item.linked_item_id) {
    const linked = findPlanAttraction(item.linked_item_id)
    if (linked) {
      const attraction = linked.attraction
      const day = tripPlan.value?.days.find((candidate) => candidate.day_index === linked.dayIndex)
      const weather = day
        ? tripPlan.value?.weather_info?.find((item) => item.date === day.date) || null
        : null
      const timelineStart = day
        ? buildDayTimeline(day, weather).find((entry) =>
            entry.kind === 'attraction' && entry.item.id === item.linked_item_id)?.time
        : null
      editingItineraryAttraction.value = true
      attractionEditor.value = {
        itemId: item.linked_item_id,
        dayIndex: linked.dayIndex,
        query: attraction.name,
        poi: attraction.poi_id && attraction.location
          ? {
              id: attraction.poi_id,
              name: attraction.name,
              type: attraction.category || '',
              address: attraction.address,
              location: attraction.location,
            }
          : null,
        startTime: normalizeReferenceTime(attraction.start_time) || timelineStart || '09:00',
        visitDuration: Math.max(30, Number(attraction.visit_duration) || 90),
        ticketPrice: Math.max(0, Number(attraction.ticket_price) || 0),
        description: attraction.description || '',
        reservationRequired: Boolean(attraction.reservation_required),
        reservationTips: attraction.reservation_tips || '',
      }
    }
  }
  budgetEditorOpen.value = true
}

const applyItineraryMutationResponse = async (response: ItineraryMutationResponse) => {
  tripPlan.value = response.plan
  applyBudgetLedgerResponse(response)
  sessionStorage.setItem('tripPlan', JSON.stringify(response.plan))
  await loadAttractionPhotos()
}

const saveItineraryAttraction = async () => {
  const targetPlanId = planId.value
  const editor = attractionEditor.value
  const startTime = normalizeReferenceTime(editor.startTime)
  if (!targetPlanId || !editor.poi || editor.dayIndex < 0 || !startTime) {
    message.warning(t('result.messages.attractionFieldsRequired'))
    return
  }
  if (!Number.isFinite(editor.visitDuration) || editor.visitDuration < 30) {
    message.warning(t('result.messages.attractionDurationInvalid'))
    return
  }
  if (!Number.isFinite(editor.ticketPrice) || editor.ticketPrice < 0) {
    message.warning(t('result.messages.budgetInvalidAmount'))
    return
  }

  const payload: ItineraryAttractionInput = {
    day_index: editor.dayIndex,
    poi_id: editor.poi.id,
    name: editor.poi.name,
    address: editor.poi.address,
    location: editor.poi.location,
    visit_duration: Math.round(editor.visitDuration),
    description: editor.description.trim(),
    ticket_price: Math.round(editor.ticketPrice),
    start_time: startTime,
    reservation_required: editor.reservationRequired,
    reservation_tips: editor.reservationTips.trim(),
  }

  budgetSaving.value = true
  try {
    const response = editor.itemId
      ? await updateItineraryAttraction(targetPlanId, editor.itemId, payload)
      : await createItineraryAttraction(targetPlanId, payload)
    await applyItineraryMutationResponse(response)
    budgetEditorOpen.value = false
    message.success(t(editor.itemId
      ? 'result.messages.attractionUpdated'
      : 'result.messages.attractionAdded'))
  } catch {
    message.error(t('result.messages.attractionSaveFailed'))
  } finally {
    budgetSaving.value = false
  }
}

const saveBudgetEditor = async () => {
  if (isAttractionEditorMode.value) {
    await saveItineraryAttraction()
    return
  }
  const targetPlanId = planId.value
  const name = budgetEditor.value.name.trim()
  if (!targetPlanId || !name) {
    message.warning(t('result.messages.budgetNameRequired'))
    return
  }
  const amount = budgetEditor.value.amount
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    message.warning(t('result.messages.budgetInvalidAmount'))
    return
  }
  const payload: BudgetItemInput = {
    type: budgetEditor.value.type,
    day_index: budgetEditor.value.dayIndex < 0 ? null : budgetEditor.value.dayIndex,
    name,
    amount: amount === null ? null : roundBudgetAmount(amount),
    amount_basis: budgetEditor.value.amountBasis,
    note: budgetEditor.value.note.trim(),
  }

  budgetSaving.value = true
  try {
    const response = budgetEditor.value.id
      ? await updateBudgetItem(targetPlanId, budgetEditor.value.id, payload)
      : await createBudgetItem(targetPlanId, payload)
    applyBudgetLedgerResponse(response)
    budgetEditorOpen.value = false
    message.success(
      t(budgetEditor.value.id
        ? 'result.messages.budgetItemUpdated'
        : 'result.messages.budgetItemAdded'),
    )
  } catch {
    message.error(t('result.messages.budgetSaveFailed'))
  } finally {
    budgetSaving.value = false
  }
}

const removeBudgetOnlyItem = async (item: BudgetDetailItem) => {
  if (!planId.value || budgetSaving.value) return
  budgetSaving.value = true
  try {
    applyBudgetLedgerResponse(await deleteBudgetLedgerItem(planId.value, item.id))
    message.success(t('result.messages.budgetItemDeleted'))
  } catch {
    message.error(t('result.messages.budgetSaveFailed'))
  } finally {
    budgetSaving.value = false
  }
}

const removeItineraryAttraction = async (item: BudgetDetailItem) => {
  if (!planId.value || !item.linked_item_id || budgetSaving.value) return
  budgetSaving.value = true
  try {
    const response = await deleteItineraryAttraction(planId.value, item.linked_item_id)
    await applyItineraryMutationResponse(response)
    message.success(t('result.messages.attractionDeletedEverywhere'))
  } catch {
    message.error(t('result.messages.attractionSaveFailed'))
  } finally {
    budgetSaving.value = false
  }
}

const removeBudgetItem = (item: BudgetDetailItem) => {
  if (item.type === 'attraction' && item.linked_item_id) {
    Modal.confirm({
      title: t('result.budget.deleteAttractionTitle'),
      content: t('result.budget.deleteAttractionContent', { name: item.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okType: 'danger',
      onOk: () => removeItineraryAttraction(item),
    })
    return
  }
  void removeBudgetOnlyItem(item)
}

const restoreBudgetItem = async (item: BudgetLedgerItem) => {
  if (!planId.value || budgetSaving.value) return
  budgetSaving.value = true
  try {
    applyBudgetLedgerResponse(await updateBudgetItem(planId.value, item.id, { deleted: false }))
    message.success(t('result.messages.budgetItemRestored'))
  } catch {
    message.error(t('result.messages.budgetSaveFailed'))
  } finally {
    budgetSaving.value = false
  }
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
          ${b.total_other ? budgetCard(t('result.budget.other'), b.total_other) : ''}
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

// 导出为图片
const exportAsImage = async () => {
  try {
    message.loading({ content: t('result.messages.generatingImage'), key: 'export', duration: 0 })

    // 1. 先捕获地图截图
    const mapDataUrl = await tripMapRef.value?.captureScreenshot() || ''

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
// 导出为日历订阅文件（.ics）
const exportAsCalendar = () => {
  const plan = tripPlan.value
  if (!plan) return

  if (countCalendarEvents(plan) === 0) {
    message.warning(t('result.messages.calendarEmpty'))
    return
  }

  let url = ''
  try {
    const blob = new Blob([buildTripCalendar(plan)], {
      type: 'text/calendar;charset=utf-8',
    })
    url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `${t('result.export.filePrefix')}_${plan.city}_${plan.start_date}.ics`
    link.href = url
    link.click()
    message.success(t('result.messages.calendarSuccess'))
  } catch (error: any) {
    console.error('导出日历失败:', error)
    message.error(t('result.messages.calendarFailed', { error: error.message }))
  } finally {
    if (url) URL.revokeObjectURL(url)
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

.result-task-loading {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(61, 50, 41, 0.65);
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

/* 行程总览:路线总览 + 景点瀑布流 */
.overview-card {
  width: 100%;
  min-width: 0;
  margin-bottom: 20px;
}

.overview-journey {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-subtle);
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

.budget-add-btn {
  margin-left: auto;
  min-height: 32px;
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
  grid-template-columns: 92px 82px minmax(160px, 1fr) minmax(180px, 0.9fr) 118px 64px;
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
  grid-template-columns: 92px 82px minmax(160px, 1fr) minmax(180px, 0.9fr) 118px;
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
.budget-detail-calculation,
.budget-detail-amount {
  color: #3D3229;
  font-size: 13px;
}

.budget-detail-name {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  overflow: hidden;
}

.budget-detail-name-main {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.budget-detail-name-main > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.budget-detail-source {
  max-width: 100%;
  overflow: hidden;
  color: rgba(61, 50, 41, 0.56);
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.budget-detail-calculation {
  color: rgba(61, 50, 41, 0.66);
  font-size: 12px;
  line-height: 1.45;
}

.budget-origin-tag {
  flex: 0 0 auto;
  border: 1px solid rgba(45, 113, 89, 0.2);
  background: rgba(45, 113, 89, 0.08);
  color: #2d7159;
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 600;
}

.budget-detail-amount {
  font-weight: 600;
  color: #D97757;
}

.budget-detail-amount--pending {
  color: rgba(61, 50, 41, 0.5);
  font-weight: 500;
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
    min-width: 860px;
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

.budget-summary-unit {
  align-self: flex-end;
  padding-bottom: 5px;
  color: rgba(61, 50, 41, 0.62);
  font-size: 14px;
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

.budget-unpriced-status {
  border-left: 3px solid #d97757;
  padding: 7px 10px;
  background: rgba(217, 119, 87, 0.07);
  color: rgba(61, 50, 41, 0.72);
  font-size: 12px;
}

.budget-editor-form {
  max-height: clamp(240px, calc(100vh - 260px), 620px);
  padding-top: 8px;
  padding-right: 4px;
  overflow-y: auto;
}

.attraction-poi-results {
  display: grid;
  gap: 6px;
  max-height: 220px;
  margin-top: 8px;
  overflow-y: auto;
}

.attraction-poi-option,
.attraction-poi-selected {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-soft);
  color: var(--text-primary);
  text-align: left;
}

.attraction-poi-option {
  cursor: pointer;
}

.attraction-poi-option:hover,
.attraction-poi-option.is-selected {
  border-color: var(--accent-primary);
  background: var(--surface-elevated);
}

.attraction-poi-option > span,
.attraction-poi-selected > span {
  display: grid;
  min-width: 0;
}

.attraction-poi-option strong,
.attraction-poi-selected strong {
  overflow-wrap: anywhere;
}

.attraction-poi-option small,
.attraction-poi-selected small {
  color: var(--text-secondary);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.attraction-poi-selected {
  margin-top: 8px;
  border-color: var(--status-success);
}

.attraction-poi-selected > span:last-child {
  color: var(--status-success);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.attraction-schedule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.budget-amount-input {
  width: 100%;
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

/* 蓝图与每日行程直接使用结果框架,不再嵌套卡片壳 */
.flow-card,
.days-card {
  min-width: 0;
  margin-top: 20px;
}

.today-section {
  padding: 18px 20px 24px;
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

/* tab 区块切换：v-show 从 display:none 恢复时动画自动重播；
   不带 fill-mode，结束后不残留 transform，避免影响内部 sticky/fixed 元素 */
.overview-card,
.top-info-section,
.flow-card,
.days-card,
.weather-section-card {
  animation: section-enter 0.26s ease;
}

/* 预算/地图面板互切时外层容器不重建，给内层面板补一个纯淡入（不动 transform，保护地图渲染） */
.left-info,
.right-map {
  animation: section-fade 0.22s ease;
}

@keyframes section-enter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes section-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .overview-card,
  .top-info-section,
  .flow-card,
  .days-card,
  .weather-section-card,
  .left-info,
  .right-map {
    animation: none;
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .result-main {
    /* 底部 padding 预留悬浮 AI 输入框(.agent-dock 约 90px)+ iPhone 安全区,避免滚到底被遮 */
    padding: 12px 10px calc(110px + env(safe-area-inset-bottom, 0px));
  }

  .content-wrapper {
    padding: 14px;
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
    order: -1;
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

  .budget-add-btn {
    width: 100%;
    margin-left: 0;
  }

  .budget-select {
    width: 170px;
  }

  /* ── V1.1 移动端预算卡片化:表格行 → 两行卡片 ── */
  .budget-detail-list {
    overflow: visible;
    border: none;
    background: transparent;
  }

  .budget-detail-row.budget-detail-header {
    display: none;
  }

  .budget-detail-row,
  .budget-detail-row--readonly {
    min-width: 0;
    grid-template-columns: auto auto 1fr auto;
    grid-template-areas:
      'name name name amount'
      'calculation calculation calculation calculation'
      'type day gap actions';
    row-gap: 7px;
    padding: 13px 14px;
    border: 1px solid rgba(61, 50, 41, 0.08);
    border-radius: 12px;
    margin-bottom: 10px;
    background: rgba(255, 255, 255, 0.66);
  }

  .budget-detail-row:last-child {
    border-bottom: 1px solid rgba(61, 50, 41, 0.08);
  }

  .budget-detail-name {
    grid-area: name;
    font-weight: 600;
    font-size: 14.5px;
  }

  .budget-detail-source {
    font-weight: 400;
  }

  .budget-detail-calculation {
    grid-area: calculation;
    font-size: 12px;
  }

  .budget-detail-amount {
    grid-area: amount;
    font-weight: 700;
    justify-self: end;
  }

  .budget-detail-type {
    grid-area: type;
    font-size: 12px;
    opacity: 0.72;
  }

  .budget-detail-day {
    grid-area: day;
    font-size: 12px;
    opacity: 0.72;
  }

  .budget-action-wrap {
    grid-area: actions;
    justify-self: end;
  }

}

@media (max-width: 480px) {
  .attraction-schedule-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .attraction-poi-option,
  .attraction-poi-selected {
    grid-template-columns: 18px minmax(0, 1fr);
  }

  .attraction-poi-selected > span:last-child {
    grid-column: 2;
    white-space: normal;
  }

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
