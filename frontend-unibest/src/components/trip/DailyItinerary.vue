<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApiBaseUrl } from '@/http/client'
import {
  buildDayTimeline,
  groupItineraryDays,
  parseTripDate,
  resolveItineraryDisplayMode,
  resolveMediaUrl,
} from '@/features/result/model'
import type {
  DayTimelineEntry,
  ItineraryDayGroup,
  ItineraryDisplayMode,
  TripAttraction,
  TripDay,
  TripPlan,
} from '@/features/result/model'

const props = defineProps<{ plan: TripPlan }>()
const { locale, t } = useI18n()
const displayMode = ref<ItineraryDisplayMode>(resolveItineraryDisplayMode(props.plan.days.length))
const groups = computed(() => groupItineraryDays(props.plan.days, displayMode.value))
const modeOptions = computed<Array<{ value: ItineraryDisplayMode, label: string }>>(() => [
  { value: 'day', label: t('result.daily.groupByDay') },
  { value: 'week', label: t('result.daily.groupByWeek') },
  { value: 'month', label: t('result.daily.groupByMonth') },
])

function formatDate(raw: string | null): string {
  const date = parseTripDate(raw)
  if (!date)
    return raw || t('result.daily.dateUnknown')
  return new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }).format(date)
}

function formatWeekday(raw: string): string {
  const date = parseTripDate(raw)
  return date ? new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(date) : ''
}

function formatMonth(raw: string | null): string {
  const date = parseTripDate(raw)
  return date
    ? new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(date)
    : t('result.daily.dateUnknown')
}

function groupHeading(group: ItineraryDayGroup): string {
  if (group.kind === 'week') {
    return t('result.daily.weekHeading', {
      week: group.groupIndex + 1,
      startDay: group.startDayIndex + 1,
      endDay: group.endDayIndex + 1,
      startDate: formatDate(group.startDate),
      endDate: formatDate(group.endDate),
    })
  }
  return t('result.daily.monthHeading', {
    month: formatMonth(group.startDate),
    startDay: group.startDayIndex + 1,
    endDay: group.endDayIndex + 1,
  })
}

function weatherFor(day: TripDay) {
  return props.plan.weather_info.find(weather => weather.date === day.date) || null
}

function timelineFor(day: TripDay): DayTimelineEntry[] {
  return buildDayTimeline(day, weatherFor(day))
}

function mealLabel(type: string): string {
  const key = `result.meals.${type}`
  const translated = t(key)
  return translated === key ? type : translated
}

function durationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(total / 60)
  const remainder = total % 60
  if (hours && remainder)
    return t('result.daily.durationHoursMinutes', { hours, minutes: remainder })
  if (hours)
    return t('result.daily.durationHours', { hours })
  return t('result.daily.durationMinutes', { minutes: remainder })
}

function attractionImage(item: TripAttraction): string {
  return resolveMediaUrl(item.image_url, getApiBaseUrl())
}

function openLocation(item: { name: string, address?: string, location?: { latitude: number, longitude: number } }): void {
  if (!item.location)
    return
  uni.openLocation({
    latitude: item.location.latitude,
    longitude: item.location.longitude,
    name: item.name,
    address: item.address || '',
    scale: 16,
  })
}
</script>

<template>
  <view class="daily-itinerary">
    <view v-if="plan.days.length > 1" class="itinerary-mode">
      <text class="sr-only">{{ t('result.daily.groupingLabel') }}</text>
      <view class="itinerary-mode-options" role="radiogroup" :aria-label="t('result.daily.groupingLabel')">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          role="radio"
          :aria-checked="displayMode === option.value"
          :class="{ 'is-active': displayMode === option.value }"
          @click="displayMode = option.value"
        >
          {{ option.label }}
        </button>
      </view>
    </view>

    <view v-for="group in groups" :key="group.key" class="daily-group" :class="`daily-group-${group.kind}`">
      <text v-if="group.kind !== 'day'" class="daily-group-heading" :class="`daily-${group.kind}-heading`">
        {{ groupHeading(group) }}
      </text>

      <article v-for="item in group.items" :key="item.day.day_index" class="daily-day">
        <view class="daily-summary">
          <view class="daily-day-meta">
            <text class="daily-day-number">{{ t('common.dayNumber', { day: item.index + 1 }) }}</text>
            <text>{{ formatDate(item.day.date) }}<template v-if="formatWeekday(item.day.date)"> · {{ formatWeekday(item.day.date) }}</template></text>
            <text>{{ item.day.city || plan.city }}</text>
          </view>
          <view class="daily-notice">
            <wd-icon name="time" size="14px" />
            <text>{{ t('result.daily.referenceTimeNotice') }}</text>
          </view>
          <text class="daily-description">{{ item.day.description }}</text>
          <view class="daily-facts">
            <view>
              <text class="daily-fact-label"><wd-icon name="car" size="14px" /> {{ t('result.dayTransport') }}</text>
              <text class="daily-fact-value">{{ item.day.transportation }}</text>
            </view>
            <view>
              <text class="daily-fact-label"><wd-icon name="home" size="14px" /> {{ t('result.dayAccommodation') }}</text>
              <view class="daily-hotel-copy">
                <text v-if="item.day.hotel?.name" class="daily-hotel-name">{{ item.day.hotel.name }}</text>
                <text>{{ item.day.accommodation }}</text>
                <text v-if="item.day.hotel?.address">{{ item.day.hotel.address }}</text>
                <text v-if="item.day.hotel?.source === 'amap'">{{ t('result.hotelVerifiedByAmap') }}</text>
                <text v-if="item.day.hotel?.price_range" class="daily-hotel-price">
                  {{ t('result.hotelReferencePrice', { price: item.day.hotel.price_range }) }}
                </text>
              </view>
            </view>
          </view>
        </view>

        <view v-if="timelineFor(item.day).length" class="daily-timeline">
          <view v-for="entry in timelineFor(item.day)" :key="entry.key" class="daily-timeline-item" :data-kind="entry.kind">
            <text class="daily-time">{{ entry.time || t('result.daily.timePending') }}</text>
            <text class="daily-marker" />
            <view class="daily-timeline-content">
              <template v-if="entry.kind === 'transfer'">
                <text class="daily-entry-title"><wd-icon name="switch" size="15px" /> {{ t('result.daily.transfer') }}</text>
                <text class="daily-entry-description">{{ entry.item }}</text>
              </template>

              <template v-else-if="entry.kind === 'meal'">
                <text class="daily-entry-title"><wd-icon name="shop" size="15px" /> {{ mealLabel(entry.item.type || '') }}</text>
                <text class="daily-entry-description">{{ entry.item.name }}</text>
                <text v-if="entry.item.description" class="daily-entry-detail">{{ entry.item.description }}</text>
                <text v-if="entry.item.estimated_cost" class="daily-entry-meta">¥{{ entry.item.estimated_cost }}</text>
                <button v-if="entry.item.location" class="daily-navigate" @click="openLocation(entry.item)">
                  <wd-icon name="location" size="14px" />{{ t('result.daily.navigate') }}<text class="sr-only">{{ entry.item.name }}</text>
                </button>
              </template>

              <template v-else>
                <view class="daily-title-row">
                  <text class="daily-entry-title"><wd-icon name="location" size="15px" /> {{ entry.item.name }}</text>
                  <text v-if="entry.endTime && !entry.timeRecommendationBasis" class="daily-range">{{ entry.time }}–{{ entry.endTime }}</text>
                </view>
                <view class="daily-entry-details" :class="{ 'with-image': attractionImage(entry.item) }">
                  <image v-if="attractionImage(entry.item)" :src="attractionImage(entry.item)" mode="aspectFill" />
                  <view class="daily-entry-copy">
                    <text v-if="entry.item.address" class="daily-entry-detail"><wd-icon name="location" size="14px" /> {{ entry.item.address }}</text>
                    <text v-if="entry.item.description" class="daily-entry-detail">{{ entry.item.description }}</text>
                    <view v-if="entry.timeRecommendationBasis" class="daily-guidance">
                      <text class="daily-guidance-title">{{ t('result.daily.recommendedTimeRange', { start: entry.time, end: entry.endTime }) }}</text>
                      <text>{{ t(entry.outdoor ? 'result.daily.outdoorReason' : 'result.daily.weekdayReason') }}</text>
                      <text>{{ t(entry.timeRecommendationBasis === 'weather' ? 'result.daily.weatherUpdateNote' : 'result.daily.seasonalUpdateNote') }}</text>
                    </view>
                    <view class="daily-metadata">
                      <text v-if="entry.item.visit_duration"><wd-icon name="time" size="14px" /> {{ t('result.daily.recommendedVisitDuration', { duration: durationLabel(entry.item.visit_duration) }) }}</text>
                      <text v-if="entry.item.rating">★ {{ entry.item.rating }}</text>
                      <text v-if="entry.item.ticket_price">¥{{ entry.item.ticket_price }}</text>
                    </view>
                    <text v-if="entry.item.reservation_required" class="daily-reservation">{{ entry.item.reservation_tips || t('result.reservationRequired') }}</text>
                    <button v-if="entry.item.location" class="daily-navigate" @click="openLocation(entry.item)">
                      <wd-icon name="location" size="14px" />{{ t('result.daily.navigate') }}<text class="sr-only">{{ entry.item.name }}</text>
                    </button>
                  </view>
                </view>
              </template>
            </view>
          </view>
        </view>
        <text v-else class="daily-empty">{{ t('result.daily.empty') }}</text>
      </article>
    </view>
  </view>
</template>

<style scoped>
.daily-itinerary {
  display: grid;
  min-width: 0;
  padding: 4px;
  color: var(--text-primary);
}
.itinerary-mode {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  margin: 0 0 24px;
}
.itinerary-mode-options {
  display: grid;
  box-sizing: border-box;
  width: min(100%, 280px);
  min-width: 0;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-soft);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.itinerary-mode button {
  box-sizing: border-box;
  height: 36px;
  min-width: 0;
  min-height: 36px;
  margin: 0;
  padding: 6px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.15;
}
.itinerary-mode button.is-active {
  background: var(--surface-elevated);
  color: var(--accent-strong);
  box-shadow: 0 1px 3px rgba(61, 50, 41, 0.08);
}
.daily-group + .daily-group {
  margin-top: 36px;
}
.daily-group-heading {
  display: block;
  padding: 12px 0;
  border-block: 1px solid var(--border-subtle);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
}
.daily-month-heading {
  border-top: 3px solid var(--accent-primary);
  font-size: 17px;
}
.daily-day {
  display: block;
  min-width: 0;
  padding: 28px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.daily-group-day .daily-day:first-child {
  padding-top: 0;
}
.daily-summary {
  display: grid;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
  gap: 12px;
}
.daily-day-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  min-width: 0;
  gap: 6px 12px;
}
.daily-day-meta text {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.15;
}
.daily-day-meta .daily-day-number {
  color: var(--accent-strong);
  font-size: 15px;
  font-weight: 700;
}
.daily-notice {
  display: flex;
  align-items: center;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
  gap: 8px;
}
.daily-description {
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
}
.daily-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 12px;
}
.daily-facts > view {
  min-width: 0;
}
.daily-fact-label {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  gap: 6px;
}
.daily-fact-value,
.daily-hotel-copy {
  display: flex;
  flex-wrap: wrap;
  margin-top: 3px;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.55;
  gap: 4px 8px;
}
.daily-hotel-name {
  font-weight: 700;
}
.daily-hotel-price {
  color: var(--accent-strong);
  font-weight: 700;
}
.daily-timeline {
  display: grid;
  padding-top: 24px;
}
.daily-timeline-item {
  display: grid;
  min-width: 0;
  padding-bottom: 24px;
  grid-template-columns: 72px 16px minmax(0, 1fr);
  gap: 8px;
}
.daily-time {
  padding-top: 1px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}
.daily-marker {
  position: relative;
  display: block;
  width: 12px;
  min-height: 100%;
}
.daily-marker::before {
  position: absolute;
  z-index: 1;
  top: 3px;
  left: 0;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 3px solid var(--surface-page);
  border-radius: 50%;
  background: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
  content: '';
}
.daily-marker::after {
  position: absolute;
  top: 16px;
  bottom: -24px;
  left: 6px;
  width: 1px;
  background: var(--border-subtle);
  content: '';
}
.daily-timeline-item:last-child .daily-marker::after {
  display: none;
}
.daily-timeline-item[data-kind='meal'] .daily-marker::before {
  background: var(--status-success);
  box-shadow: 0 0 0 1px var(--status-success);
}
.daily-timeline-content {
  min-width: 0;
  padding-bottom: 4px;
}
.daily-timeline-item[data-kind='meal'] .daily-timeline-content {
  margin-bottom: -3px;
}
.daily-entry-title {
  display: flex;
  align-items: center;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  gap: 8px;
}
.daily-entry-description {
  display: block;
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}
.daily-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-width: 0;
  gap: 12px;
}
.daily-range,
.daily-entry-meta {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
}
.daily-entry-details {
  display: grid;
  margin-top: 12px;
  padding: 12px 0 4px;
  border-top: 1px solid var(--border-subtle);
  gap: 12px;
}
.daily-entry-details.with-image {
  align-items: start;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
}
.daily-entry-details > image {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
}
.daily-entry-copy {
  display: grid;
  min-width: 0;
  gap: 10px;
}
.daily-entry-detail,
.daily-reservation {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.daily-guidance {
  display: grid;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
  gap: 2px;
}
.daily-guidance-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}
.daily-metadata {
  display: flex;
  flex-wrap: wrap;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.15;
  gap: 8px 16px;
}
.daily-reservation {
  color: var(--text-primary);
  font-weight: 600;
}
.daily-navigate {
  display: inline-flex;
  box-sizing: border-box;
  height: 32px;
  min-height: 32px;
  margin: 2px 0 0;
  padding: 6px 12px;
  align-items: center;
  justify-self: start;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-soft);
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  gap: 6px;
}
.daily-empty {
  display: block;
  padding: 24px 0;
  color: var(--text-secondary);
  font-size: 14px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
button::after {
  display: none;
}
@media (max-width: 720px) {
  .itinerary-mode-options {
    width: 100%;
  }
  .itinerary-mode button {
    min-height: 44px;
  }
  .daily-entry-details.with-image {
    grid-template-columns: minmax(0, 1fr);
  }
  .daily-navigate {
    min-height: 44px;
    padding-inline: 16px;
  }
}
@media (max-width: 480px) {
  .daily-timeline-item {
    grid-template-columns: 56px 12px minmax(0, 1fr);
    gap: 6px;
  }
  .daily-title-row {
    display: grid;
    gap: 4px;
  }
  .daily-range {
    justify-self: start;
  }
}
</style>
