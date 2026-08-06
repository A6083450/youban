<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CarOutlined,
  ClockCircleOutlined,
  CompassOutlined,
  EnvironmentOutlined,
  HomeOutlined,
  ShopOutlined,
  StarOutlined,
  SwapOutlined,
  TagOutlined,
} from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import type { DayPlan, Location, TripPlan } from '@/types'
import type { ItineraryDayGroup, ItineraryDisplayMode } from '@/utils/tripPresentation.js'
import {
  buildDayTimeline,
  groupItineraryDays,
  parseTripDate,
  resolveItineraryDisplayMode,
} from '@/utils/tripPresentation.js'
import { buildAmapNavigationUrl } from '@/utils/tripNavigation'

const props = defineProps<{
  tripPlan: TripPlan
  attractionPhotos: Record<string, string>
}>()

const emit = defineEmits<{
  (event: 'image-error', name: string): void
}>()

const { t, locale } = useI18n()
const displayMode = ref<ItineraryDisplayMode>(
  resolveItineraryDisplayMode(props.tripPlan.days.length),
)

const groups = computed(() => groupItineraryDays(props.tripPlan.days, displayMode.value))
const modeOptions = computed<Array<{ value: ItineraryDisplayMode; label: string }>>(() => [
  { value: 'day', label: t('result.daily.groupByDay') },
  { value: 'week', label: t('result.daily.groupByWeek') },
  { value: 'month', label: t('result.daily.groupByMonth') },
])

const localeTag = computed(() => {
  const current = String(locale.value || 'zh-CN').toLowerCase()
  if (current.startsWith('zh')) return 'zh-CN'
  if (current.startsWith('ja')) return 'ja-JP'
  return 'en-US'
})

const formatDate = (raw: string | null): string => {
  const date = parseTripDate(raw)
  if (!date) return raw || t('result.daily.dateUnknown')
  return new Intl.DateTimeFormat(localeTag.value, { month: 'short', day: 'numeric' }).format(date)
}

const formatWeekday = (raw: string): string => {
  const date = parseTripDate(raw)
  if (!date) return ''
  return new Intl.DateTimeFormat(localeTag.value, { weekday: 'short' }).format(date)
}

const formatMonth = (raw: string | null): string => {
  const date = parseTripDate(raw)
  if (!date) return t('result.daily.dateUnknown')
  return new Intl.DateTimeFormat(localeTag.value, { year: 'numeric', month: 'long' }).format(date)
}

const groupHeading = (group: ItineraryDayGroup): string => {
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

const timelineFor = (day: DayPlan) => buildDayTimeline(day)

const mealLabel = (type: string): string => {
  const key = `result.meals.${type}`
  const translated = t(key)
  return translated === key ? type : translated
}

const navigationUrl = (name: string, location?: Location | null): string | null =>
  buildAmapNavigationUrl(name, location)
</script>

<template>
  <section class="daily-itinerary" :aria-label="t('result.side.days')">
    <fieldset v-if="tripPlan.days.length > 1" class="itinerary-mode">
      <legend>{{ t('result.daily.groupingLabel') }}</legend>
      <div role="radiogroup" :aria-label="t('result.daily.groupingLabel')">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="displayMode === option.value"
          :class="{ 'is-active': displayMode === option.value }"
          @click="displayMode = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </fieldset>

    <section
      v-for="group in groups"
      :key="group.key"
      class="daily-itinerary__group"
      :class="`daily-itinerary__group--${group.kind}`"
    >
      <h2
        v-if="group.kind !== 'day'"
        class="daily-itinerary__group-heading"
        :class="`daily-itinerary__${group.kind}-heading`"
      >
        {{ groupHeading(group) }}
      </h2>

      <article
        v-for="item in group.items"
        :id="`daily-day-${item.index}`"
        :key="item.day.day_index"
        class="daily-itinerary__day daily-itinerary__day-panel"
        :aria-labelledby="`daily-day-title-${item.index}`"
      >
        <header class="daily-itinerary__summary">
          <div class="daily-itinerary__day-meta">
            <strong>{{ t('common.dayNumber', { day: item.index + 1 }) }}</strong>
            <span>{{ formatDate(item.day.date) }}<template v-if="formatWeekday(item.day.date)"> · {{ formatWeekday(item.day.date) }}</template></span>
            <span>{{ item.day.city || tripPlan.city }}</span>
          </div>
          <p class="daily-itinerary__notice">
            <ClockCircleOutlined aria-hidden="true" />
            {{ t('result.daily.referenceTimeNotice') }}
          </p>
          <component
            :is="group.kind === 'day' ? 'h2' : 'h3'"
            :id="`daily-day-title-${item.index}`"
          >
            {{ item.day.description }}
          </component>
          <dl>
            <div>
              <dt><CarOutlined aria-hidden="true" /> {{ t('result.dayTransport') }}</dt>
              <dd>{{ item.day.transportation }}</dd>
            </div>
            <div>
              <dt><HomeOutlined aria-hidden="true" /> {{ t('result.dayAccommodation') }}</dt>
              <dd>
                <strong v-if="item.day.hotel?.name">{{ item.day.hotel.name }}</strong>
                <span>{{ item.day.accommodation }}</span>
                <span v-if="item.day.hotel?.address">{{ item.day.hotel.address }}</span>
                <span v-if="item.day.hotel?.price_range">{{ item.day.hotel.price_range }}</span>
              </dd>
            </div>
          </dl>
        </header>

        <ol v-if="timelineFor(item.day).length" class="daily-timeline">
          <li v-for="entry in timelineFor(item.day)" :key="entry.key" :data-kind="entry.kind">
          <time class="daily-timeline__time">
            {{ entry.time || t('result.daily.timePending') }}
          </time>
          <span class="daily-timeline__marker" aria-hidden="true"></span>
          <div class="daily-timeline__content">
            <template v-if="entry.kind === 'transfer'">
              <strong><SwapOutlined aria-hidden="true" /> {{ t('result.daily.transfer') }}</strong>
              <p>{{ entry.item }}</p>
            </template>

            <template v-else-if="entry.kind === 'meal'">
              <strong><ShopOutlined aria-hidden="true" /> {{ mealLabel(entry.item.type) }}</strong>
              <p>{{ entry.item.name }}</p>
              <p v-if="entry.item.description" class="daily-timeline__description">
                {{ entry.item.description }}
              </p>
              <span v-if="entry.item.estimated_cost" class="daily-timeline__meta">
                ¥{{ entry.item.estimated_cost }}
              </span>
              <a
                v-if="navigationUrl(entry.item.name, entry.item.location)"
                class="daily-timeline__navigate"
                :href="navigationUrl(entry.item.name, entry.item.location)!"
                target="_blank"
                rel="noopener noreferrer"
              >
                <CompassOutlined aria-hidden="true" />
                {{ t('result.daily.navigate') }}
                <span class="sr-only">{{ entry.item.name }}</span>
              </a>
            </template>

            <template v-else>
              <div class="daily-timeline__title-row">
                <strong><EnvironmentOutlined aria-hidden="true" /> {{ entry.item.name }}</strong>
                <span v-if="entry.endTime" class="daily-timeline__range">
                  {{ entry.time }}–{{ entry.endTime }}
                </span>
              </div>
              <div
                class="daily-timeline__details"
                :class="{ 'daily-timeline__details--with-image': attractionPhotos[entry.item.name] }"
              >
                <img
                  v-if="attractionPhotos[entry.item.name]"
                  :src="attractionPhotos[entry.item.name]"
                  :alt="entry.item.name"
                  loading="lazy"
                  @error="emit('image-error', entry.item.name)"
                />
                <div class="daily-timeline__details-copy">
                  <p v-if="entry.item.address" class="daily-timeline__address">
                    <EnvironmentOutlined aria-hidden="true" /> {{ entry.item.address }}
                  </p>
                  <p v-if="entry.item.description" class="daily-timeline__description">
                    {{ entry.item.description }}
                  </p>
                  <div class="daily-timeline__metadata">
                    <span v-if="entry.item.visit_duration">
                      <ClockCircleOutlined aria-hidden="true" />
                      {{ entry.item.visit_duration }} {{ t('result.minuteUnit') }}
                    </span>
                    <span v-if="entry.item.rating">
                      <StarOutlined aria-hidden="true" /> {{ entry.item.rating }}
                    </span>
                    <span v-if="entry.item.ticket_price">
                      <TagOutlined aria-hidden="true" /> ¥{{ entry.item.ticket_price }}
                    </span>
                  </div>
                  <p v-if="entry.item.reservation_required" class="daily-timeline__reservation">
                    {{ entry.item.reservation_tips || t('result.reservationRequired') }}
                  </p>
                  <a
                    v-if="navigationUrl(entry.item.name, entry.item.location)"
                    class="daily-timeline__navigate"
                    :href="navigationUrl(entry.item.name, entry.item.location)!"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <CompassOutlined aria-hidden="true" />
                    {{ t('result.daily.navigate') }}
                    <span class="sr-only">{{ entry.item.name }}</span>
                  </a>
                </div>
              </div>
            </template>
          </div>
        </li>
        </ol>

        <p v-else class="daily-itinerary__empty">{{ t('result.daily.empty') }}</p>
      </article>
    </section>
  </section>
</template>

<style scoped>
.daily-itinerary {
  display: grid;
  gap: 0;
  min-inline-size: 0;
  padding: 4px;
  color: var(--text-primary);
}

.itinerary-mode {
  display: flex;
  justify-content: flex-end;
  min-inline-size: 0;
  margin: 0 0 24px;
  padding: 0;
  border: 0;
}

.itinerary-mode legend {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.itinerary-mode > div {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  inline-size: min(100%, 280px);
  min-inline-size: 0;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-soft);
}

.itinerary-mode button {
  min-inline-size: 0;
  min-block-size: 36px;
  padding: 6px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.itinerary-mode button:hover {
  color: var(--text-primary);
}

.itinerary-mode button.is-active {
  background: var(--surface-elevated);
  color: var(--accent-strong);
  box-shadow: 0 1px 3px rgba(61, 50, 41, 0.08);
}

.itinerary-mode button:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}

.daily-itinerary__group + .daily-itinerary__group {
  margin-block-start: 36px;
}

.daily-itinerary__group-heading {
  margin: 0;
  padding: 12px 0;
  border-block: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.daily-itinerary__month-heading {
  border-block-start: 3px solid var(--accent-primary);
  font-size: 17px;
}

.daily-itinerary__day {
  min-inline-size: 0;
  padding-block: 28px;
  border-block-end: 1px solid var(--border-subtle);
  scroll-margin-block-start: 172px;
}

.daily-itinerary__group--day .daily-itinerary__day:first-child {
  padding-block-start: 0;
}

.daily-itinerary__day-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 12px;
  min-inline-size: 0;
}

.daily-itinerary__day-meta strong {
  color: var(--accent-strong);
  font-size: 15px;
  font-weight: 700;
}

.daily-itinerary__day-meta span {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.daily-itinerary__summary {
  display: grid;
  gap: 12px;
  padding-block-end: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.daily-itinerary__notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}

.daily-itinerary__summary h2,
.daily-itinerary__summary h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.daily-itinerary__summary dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 12px;
  margin: 0;
}

.daily-itinerary__summary dl > div {
  min-inline-size: 0;
}

.daily-itinerary__summary dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.daily-itinerary__summary dd {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 4px 0 0;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.daily-itinerary__summary dd strong {
  font-weight: 700;
}

.daily-timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 24px 0 0;
  list-style: none;
}

.daily-timeline > li {
  display: grid;
  grid-template-columns: 72px 16px minmax(0, 1fr);
  gap: 8px;
  min-inline-size: 0;
  padding-block-end: 24px;
}

.daily-timeline__time {
  padding-block-start: 1px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.daily-timeline__marker {
  position: relative;
  display: block;
  inline-size: 12px;
  min-block-size: 100%;
}

.daily-timeline__marker::before {
  content: '';
  position: absolute;
  inset-block-start: 3px;
  inset-inline-start: 0;
  inline-size: 12px;
  block-size: 12px;
  border: 3px solid var(--surface-page);
  border-radius: 50%;
  background: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
  z-index: 1;
}

.daily-timeline__marker::after {
  content: '';
  position: absolute;
  inset-block: 16px -24px;
  inset-inline-start: 6px;
  inline-size: 1px;
  background: var(--border-subtle);
}

.daily-timeline > li:last-child .daily-timeline__marker::after {
  display: none;
}

.daily-timeline > li[data-kind='meal'] .daily-timeline__marker::before {
  background: var(--status-success);
  box-shadow: 0 0 0 1px var(--status-success);
}

.daily-timeline__content {
  min-inline-size: 0;
  padding-block-end: 4px;
}

.daily-timeline__content > strong,
.daily-timeline__title-row strong {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.daily-timeline__content > p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.daily-timeline__title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-inline-size: 0;
}

.daily-timeline__range,
.daily-timeline__meta {
  flex: 0 0 auto;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}

.daily-timeline__details {
  display: grid;
  gap: 12px;
  margin-block-start: 12px;
  padding-block: 12px 4px;
  border-block-start: 1px solid var(--border-subtle);
}

.daily-timeline__details--with-image {
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  align-items: start;
}

.daily-timeline__details-copy {
  display: grid;
  gap: 10px;
  min-inline-size: 0;
}

.daily-timeline__details img {
  inline-size: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  object-fit: cover;
}

.daily-timeline__address,
.daily-timeline__description,
.daily-timeline__reservation {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.daily-timeline__metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.daily-timeline__metadata span,
.daily-timeline__address {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.daily-timeline__reservation {
  color: var(--text-primary);
  font-weight: 600;
}

.daily-timeline__navigate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-self: start;
  min-block-size: 32px;
  margin-block-start: 2px;
  padding: 6px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-soft);
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.daily-timeline__navigate:hover {
  border-color: var(--accent-primary);
  background: var(--surface-elevated);
}

.daily-timeline__navigate:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.daily-itinerary__empty {
  margin: 0;
  padding: 24px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

@media (max-width: 720px) {
  .itinerary-mode > div {
    inline-size: 100%;
  }

  .itinerary-mode button {
    min-block-size: 44px;
  }

  .daily-timeline__details--with-image {
    grid-template-columns: minmax(0, 1fr);
  }

  .daily-timeline__navigate {
    min-block-size: 44px;
    padding-inline: 16px;
  }
}

@media (max-width: 480px) {
  .daily-timeline > li {
    grid-template-columns: 56px 12px minmax(0, 1fr);
    gap: 6px;
  }

  .daily-timeline__title-row {
    display: grid;
    gap: 4px;
  }

  .daily-timeline__range {
    justify-self: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .itinerary-mode button {
    transition: none;
  }
}
</style>
