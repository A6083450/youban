<script setup lang="ts">
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHorizontalPager } from '@/composables/useHorizontalPager'
import type { TripPlan } from '@/types'
import {
  normalizeTripCityNames,
  resolveJourneyPinPhotos,
  resolveTripBlueprint,
} from '@/utils/tripPresentation.js'

const props = defineProps<{ tripPlan: TripPlan; attractionPhotos: Record<string, string> }>()
const emit = defineEmits<{ (event: 'select-day', dayArrayIndex: number): void }>()
const { t } = useI18n()

// 每天的强调色，循环使用
const ACCENTS = ['#4CAF7D', '#5B8FF9', '#B37FEB', '#F0A83C', '#E8684A', '#4FB8C9', '#D7709E']

type TripDay = TripPlan['days'][number]

const days = computed<TripDay[]>(() => (Array.isArray(props.tripPlan?.days) ? props.tripPlan.days : []))
const blueprint = computed(() => resolveTripBlueprint(props.tripPlan))

const cities = computed(() => normalizeTripCityNames(props.tripPlan?.cities, props.tripPlan?.city))
const title = computed(() => (
  blueprint.value.title
  || t('result.graph.journeyTitle', { days: days.value.length, cities: cities.value.join(' → ') })
))

// 蓝图阶段主题：hero 特征标签（AI 蓝图缺失时为空，不硬凑）
const themes = computed(() => {
  const seen = new Set<string>()
  for (const stage of blueprint.value.stages) {
    if (stage.theme) seen.add(stage.theme)
  }
  return [...seen].slice(0, 3)
})

const photoOf = (attraction?: TripDay['attractions'][number]): string => {
  if (!attraction?.name) return ''
  return attraction.image_url || props.attractionPhotos[attraction.name] || ''
}
const dayPhoto = (day: TripDay): string => {
  for (const attraction of day.attractions || []) {
    const url = photoOf(attraction)
    if (url) return url
  }
  return ''
}
const pinPhotos = computed(() => resolveJourneyPinPhotos(days.value, props.attractionPhotos))
// hero 背景：全程第一张可用的景点照片
const heroPhoto = computed(() => {
  for (const day of days.value) {
    const url = dayPhoto(day)
    if (url) return url
  }
  return ''
})
const heroStyle = computed(() => (heroPhoto.value
  ? {
      backgroundImage:
        `linear-gradient(100deg, var(--journey-hero-overlay-start) 25%, var(--journey-hero-overlay-middle) 55%, var(--journey-hero-overlay-end)), url(${heroPhoto.value})`,
    }
  : undefined))

const weatherOf = (day: TripDay) =>
  (props.tripPlan.weather_info || []).find((w) => w.date === day.date)

const accentOf = (index: number) => ACCENTS[index % ACCENTS.length]
const attractionsOf = (day: TripDay) => (day.attractions || []).slice(0, 3)
const cityOf = (day: TripDay) => day.city || props.tripPlan.city || ''

// 主题灵感卡片：每天有照片的首个景点
const highlightCards = computed(() => days.value
  .map((day, index) => ({
    index,
    photo: dayPhoto(day),
    name: day.attractions?.[0]?.name || cityOf(day),
    city: cityOf(day),
  }))
  .filter((card) => card.photo))

// 两块内容分别分页，保留按钮、拖拽和触屏横滑，不自动播放。
const trackViewportRef = ref<HTMLElement | null>(null)
const trackStripRef = ref<HTMLElement | null>(null)
const trackPager = useHorizontalPager(trackViewportRef, trackStripRef, days)

const cardsViewportRef = ref<HTMLElement | null>(null)
const cardsStripRef = ref<HTMLElement | null>(null)
const cardsPager = useHorizontalPager(cardsViewportRef, cardsStripRef, highlightCards)
</script>

<template>
  <section class="journey" :aria-label="t('result.side.graph')">
    <div v-if="!days.length" class="journey__empty">{{ t('result.graph.empty') }}</div>

    <template v-else>
      <!-- Hero -->
      <div class="journey__hero" :style="heroStyle">
        <p class="journey__eyebrow">{{ t('result.side.graph') }}</p>
        <h2>{{ title }}</h2>
        <p v-if="blueprint.summary" class="journey__summary">{{ blueprint.summary }}</p>
        <div v-if="themes.length" class="journey__pills">
          <span v-for="theme in themes" :key="theme"><i aria-hidden="true" />{{ theme }}</span>
        </div>
      </div>

      <!-- 脉络时间轴：桌面与移动端都按完整日期组手动浏览 -->
      <div class="journey__track-wrap">
        <div class="journey__track-toolbar">
          <span class="journey__marker journey__marker--start">{{ t('result.graph.journeyStart') }}</span>
          <div v-if="trackPager.overflowing.value" class="journey__pager">
            <span class="journey__pager-status" aria-live="polite">
              {{ trackPager.currentPage.value + 1 }} / {{ trackPager.pageCount.value }}
            </span>
            <button
              type="button"
              class="journey__control"
              :disabled="!trackPager.canPrevious.value"
              :aria-label="t('result.graph.previousJourney')"
              :title="t('result.graph.previousJourney')"
              @click="trackPager.previous"
            >
              <ArrowLeftOutlined aria-hidden="true" />
            </button>
            <button
              type="button"
              class="journey__control"
              :disabled="!trackPager.canNext.value"
              :aria-label="t('result.graph.nextJourney')"
              :title="t('result.graph.nextJourney')"
              @click="trackPager.next"
            >
              <ArrowRightOutlined aria-hidden="true" />
            </button>
          </div>
          <span class="journey__marker journey__marker--end">{{ t('result.graph.journeyEnd') }}</span>
        </div>
        <div
          ref="trackViewportRef"
          class="journey__track"
          :class="{
            'journey__track--dragging': trackPager.dragging.value,
            'journey__track--fit': !trackPager.overflowing.value,
          }"
          @scroll.passive="trackPager.onScroll"
          @pointerdown="trackPager.onPointerDown"
          @pointermove="trackPager.onPointerMove"
          @pointerup="trackPager.onPointerEnd"
          @pointercancel="trackPager.onPointerEnd"
          @click.capture="trackPager.onClickCapture"
          @dragstart.prevent
        >
          <div class="journey__rail" aria-hidden="true" />
          <div
            ref="trackStripRef"
            class="journey__track-strip"
          >
            <div class="journey__track-group">
              <button
                v-for="(day, index) in days"
                :key="day.day_index"
                type="button"
                class="journey__stop"
                data-pager-item
                :style="{ '--accent': accentOf(index), '--i': index }"
                @click="emit('select-day', index)"
              >
                <span class="journey__day">D{{ index + 1 }}</span>
                <span class="journey__pin">
                  <img v-if="pinPhotos[index]" :src="pinPhotos[index]" :alt="cityOf(day)" loading="lazy" />
                  <span v-else class="journey__pin-fallback">{{ cityOf(day).slice(0, 1) || '·' }}</span>
                </span>
                <span class="journey__info">
                  <strong class="journey__city">{{ cityOf(day) }}</strong>
                  <span v-if="weatherOf(day)" class="journey__weather">
                    {{ weatherOf(day)?.day_weather }} {{ weatherOf(day)?.day_temp }}°
                  </span>
                  <span class="journey__spots">
                    <span v-for="attraction in attractionsOf(day)" :key="attraction.name">
                      {{ attraction.name }}
                    </span>
                  </span>
                </span>
              </button>

              <div
                class="journey__stop journey__stop--end"
                data-pager-item
                aria-hidden="true"
                :style="{ '--i': days.length }"
              >
                <span class="journey__day">&nbsp;</span>
                <span class="journey__pin journey__pin--plane">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
                    <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                  </svg>
                </span>
              </div>
              <span class="journey__page-tail journey__page-tail--track" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      <!-- 主题灵感卡片 -->
      <div v-if="highlightCards.length" class="journey__highlights">
        <div class="journey__highlights-header">
          <h3>{{ t('result.graph.highlights') }}</h3>
          <div v-if="cardsPager.overflowing.value" class="journey__pager">
            <span class="journey__pager-status" aria-live="polite">
              {{ cardsPager.currentPage.value + 1 }} / {{ cardsPager.pageCount.value }}
            </span>
            <button
              type="button"
              class="journey__control"
              :disabled="!cardsPager.canPrevious.value"
              :aria-label="t('result.graph.previousHighlight')"
              :title="t('result.graph.previousHighlight')"
              @click="cardsPager.previous"
            >
              <ArrowLeftOutlined aria-hidden="true" />
            </button>
            <button
              type="button"
              class="journey__control"
              :disabled="!cardsPager.canNext.value"
              :aria-label="t('result.graph.nextHighlight')"
              :title="t('result.graph.nextHighlight')"
              @click="cardsPager.next"
            >
              <ArrowRightOutlined aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          ref="cardsViewportRef"
          class="journey__cards"
          :class="{
            'journey__cards--dragging': cardsPager.dragging.value,
            'journey__cards--fit': !cardsPager.overflowing.value,
          }"
          @scroll.passive="cardsPager.onScroll"
          @pointerdown="cardsPager.onPointerDown"
          @pointermove="cardsPager.onPointerMove"
          @pointerup="cardsPager.onPointerEnd"
          @pointercancel="cardsPager.onPointerEnd"
          @click.capture="cardsPager.onClickCapture"
          @dragstart.prevent
        >
          <div
            ref="cardsStripRef"
            class="journey__cards-track"
          >
            <div class="journey__cards-group">
              <button
                v-for="(card, cardIndex) in highlightCards"
                :key="card.index"
                type="button"
                class="journey__card"
                data-pager-item
                :style="{ '--i': cardIndex }"
                @click="emit('select-day', card.index)"
              >
                <span class="journey__card-photo">
                  <img :src="card.photo" :alt="card.name" loading="lazy" />
                  <span class="journey__card-badge">D{{ card.index + 1 }}</span>
                </span>
                <strong>{{ card.name }}</strong>
                <span class="journey__card-city">{{ card.city }}</span>
              </button>
              <span class="journey__page-tail journey__page-tail--cards" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.journey {
  min-inline-size: 0;
}

.journey__empty {
  padding: 48px 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
}

/* ---- Hero ---- */
.journey__hero {
  padding: 26px 28px 24px;
  border: 1px solid var(--journey-hero-border);
  border-radius: 20px;
  background-color: var(--journey-hero);
  background-position: right center;
  background-size: cover;
}

.journey__eyebrow {
  margin: 0 0 6px;
  color: var(--journey-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.journey__hero h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
}

.journey__summary {
  margin: 8px 0 0;
  max-inline-size: 560px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.journey__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-block-start: 16px;
}

.journey__pills span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 13px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.journey__pills i {
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: var(--accent-primary);
}

/* ---- 时间轴 ---- */
.journey__track-wrap {
  position: relative;
  margin-block-start: 22px;
}

.journey__track-toolbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  min-block-size: 40px;
  margin-block-end: 10px;
  padding-inline: 14px;
}

.journey__marker {
  color: var(--journey-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.journey__marker--end {
  justify-self: end;
}

.journey__pager {
  display: flex;
  align-items: center;
  gap: 8px;
}

.journey__pager-status {
  min-inline-size: 38px;
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.journey__control {
  display: inline-grid;
  inline-size: 36px;
  block-size: 36px;
  padding: 0;
  border: 1px solid var(--journey-hero-border);
  border-radius: 50%;
  background: var(--journey-card);
  color: var(--accent-primary);
  cursor: pointer;
  place-items: center;
  transition: border-color 160ms ease, background-color 160ms ease, color 160ms ease;
}

.journey__control:hover,
.journey__control:focus-visible {
  border-color: var(--accent-primary);
  background: var(--accent-soft);
  outline: none;
}

.journey__control:disabled {
  border-color: var(--border-subtle);
  background: var(--surface-soft);
  color: var(--text-secondary);
  cursor: default;
  opacity: 0.42;
}

.journey__track {
  position: relative;
  padding: 0 0 8px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  cursor: grab;
  touch-action: pan-y;
  container-type: inline-size;
}

.journey__track::-webkit-scrollbar,
.journey__cards::-webkit-scrollbar {
  display: none;
}

.journey__track--fit,
.journey__cards--fit {
  overflow-x: hidden;
  cursor: default;
}

/* 非循环时 strip/group 撑满可视区，图钉 flex-grow 均布（保持原有排版） */
.journey__track-strip {
  display: flex;
  inline-size: 100%;
}

.journey__track-group {
  display: flex;
  gap: 4px;
  inline-size: 100%;
  padding-inline-end: 4px;
}

.journey__track--dragging {
  cursor: grabbing;
  user-select: none;
}

.journey__rail {
  position: absolute;
  inset-block-start: calc(20px + 12px + 36px);
  inset-inline: 70px;
  border-block-start: 2px dashed var(--journey-rail);
}

.journey__stop {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 0 130px;
  flex-direction: column;
  align-items: center;
  min-inline-size: 130px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: center;
  cursor: pointer;
  scroll-snap-align: start;
  scroll-snap-stop: normal;
}

.journey__day {
  block-size: 20px;
  margin-block-end: 12px;
  color: var(--accent, #b09a77);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

/* 大头针：圆照片 + 下方小尾巴 */
.journey__pin {
  position: relative;
  display: grid;
  overflow: visible;
  inline-size: 72px;
  block-size: 72px;
  border: 3px solid var(--accent, #5b8ff9);
  border-radius: 50%;
  background: var(--surface-soft);
  box-shadow: var(--card-shadow);
  place-items: center;
  transition: transform 160ms ease;
}

.journey__pin::after {
  position: absolute;
  inset-block-end: -9px;
  inset-inline-start: 50%;
  border: 6px solid transparent;
  border-block-start: 8px solid var(--accent, #5b8ff9);
  content: '';
  transform: translateX(-50%);
}

.journey__stop:hover .journey__pin {
  transform: translateY(-4px);
}

/* 绝对定位填充：grid auto 行内百分比高度不解析，竖图会溢出圆圈 */
.journey__pin img {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.journey__pin-fallback {
  color: var(--text-secondary);
  font-size: 24px;
  font-weight: 700;
}

.journey__pin--plane {
  border-style: dashed;
  border-color: var(--journey-rail);
  color: var(--journey-muted);
  box-shadow: none;
}

.journey__pin--plane::after {
  border-block-start-color: var(--journey-rail);
}

.journey__info {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-block-start: 14px;
}

.journey__city {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.journey__weather {
  margin-block-start: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.journey__spots {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-block-start: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.journey__spots span {
  overflow: hidden;
  max-inline-size: 122px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.journey__stop--end {
  cursor: default;
}

/* ---- 主题灵感卡片 ---- */
.journey__highlights {
  margin-block-start: 26px;
}

.journey__highlights h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
}

.journey__highlights-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-block-end: 14px;
}

.journey__cards {
  padding-block-end: 8px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  cursor: grab;
  touch-action: pan-y;
  container-type: inline-size;
}

.journey__cards-track {
  display: flex;
  inline-size: max-content;
}

/* 组尾间距并入组内，track 宽度恰为两组，translateX(-50%) 才能无缝衔接 */
.journey__cards-group {
  display: flex;
  gap: 12px;
  padding-inline-end: 12px;
}

.journey__page-tail {
  display: block;
  flex: 0 0 auto;
  pointer-events: none;
}

.journey__page-tail--track {
  inline-size: max(0px, calc(100cqi - 134px));
}

.journey__page-tail--cards {
  inline-size: max(0px, calc(100cqi - 180px));
}

.journey__cards--dragging {
  cursor: grabbing;
  user-select: none;
}

.journey__card {
  display: flex;
  flex: 0 0 168px;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 0 0 10px;
  border: 1px solid var(--journey-hero-border);
  border-radius: 14px;
  background: var(--journey-card);
  color: inherit;
  text-align: left;
  cursor: pointer;
  scroll-snap-align: start;
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.journey__card:hover {
  box-shadow: var(--card-shadow-hover);
  transform: translateY(-3px);
}

.journey__card-photo {
  position: relative;
  overflow: hidden;
  inline-size: 100%;
  block-size: 100px;
  border-radius: 13px 13px 0 0;
}

.journey__card-photo img {
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}

.journey__card-badge {
  position: absolute;
  inset-block-start: 8px;
  inset-inline-start: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(30, 24, 16, 0.65);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.journey__card strong {
  padding-inline: 10px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.journey__card-city {
  padding-inline: 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

/* ---- 移动端：时间轴与桌面一致，横向循环轮播 ---- */
@media (max-width: 720px) {
  .journey__hero {
    padding: 20px 18px;
    border-radius: 16px;
  }

  .journey__hero h2 {
    font-size: 18px;
  }

  .journey__track-wrap {
    margin-block-start: 18px;
  }

  .journey__track-toolbar {
    display: flex;
    justify-content: flex-end;
    min-block-size: 44px;
    margin-block-end: 8px;
    padding-inline: 0;
  }

  .journey__marker {
    display: none;
  }

  .journey__control {
    inline-size: 44px;
    block-size: 44px;
  }

  .journey__track {
    margin-inline: -4px;
  }

  .journey__card {
    flex-basis: clamp(156px, 72vw, 232px);
  }
}

@media (pointer: coarse), (max-width: 900px) and (max-height: 500px) {
  .journey__control {
    inline-size: 44px;
    block-size: 44px;
  }
}

/* ---- 入场动画：backwards 填充保证延迟期间不可见，结束后不留 transform ---- */
@keyframes journey-rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.journey__hero {
  animation: journey-rise 0.35s ease;
}

.journey__marker {
  animation: journey-rise 0.3s ease 0.15s backwards;
}

.journey__stop {
  animation: journey-rise 0.35s ease backwards;
  animation-delay: calc(0.1s + var(--i, 0) * 55ms);
}

.journey__highlights h3 {
  animation: journey-rise 0.3s ease 0.2s backwards;
}

.journey__card {
  animation: journey-rise 0.3s ease backwards;
  animation-delay: calc(0.2s + var(--i, 0) * 45ms);
}

@media (prefers-reduced-motion: reduce) {
  .journey__pin,
  .journey__card {
    transition: none;
  }

  .journey__hero,
  .journey__marker,
  .journey__stop,
  .journey__highlights h3,
  .journey__card {
    animation: none;
  }

}
</style>
