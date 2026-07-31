<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripPlan } from '@/types'
import { resolveTripBlueprint } from '@/utils/tripPresentation.js'

const props = defineProps<{ tripPlan: TripPlan; attractionPhotos: Record<string, string> }>()
const emit = defineEmits<{ (event: 'select-day', dayArrayIndex: number): void }>()
const { t } = useI18n()

// 每天的强调色，循环使用
const ACCENTS = ['#4CAF7D', '#5B8FF9', '#B37FEB', '#F0A83C', '#E8684A', '#4FB8C9', '#D7709E']

type TripDay = TripPlan['days'][number]

const days = computed<TripDay[]>(() => (Array.isArray(props.tripPlan?.days) ? props.tripPlan.days : []))
const blueprint = computed(() => resolveTripBlueprint(props.tripPlan))

const cities = computed(() => {
  const list = props.tripPlan?.cities?.length ? props.tripPlan.cities : [props.tripPlan?.city || '']
  return list.filter(Boolean)
})
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
        `linear-gradient(100deg, rgba(253, 250, 243, 0.97) 25%, rgba(253, 250, 243, 0.75) 55%, rgba(253, 250, 243, 0.25)), url(${heroPhoto.value})`,
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

// 无缝循环轮播：单组内容宽于可视区时复制一组循环滚动，否则保持静态/手动横滑。
// 组件随 v-show 区块挂载时可能处于 display:none（量不到宽度），
// 用 ResizeObserver 覆盖：初次显示、窗口缩放、容器尺寸变化都会重新判定
const useMarqueeLoop = (
  viewportRef: Ref<HTMLElement | null>,
  stripRef: Ref<HTMLElement | null>,
  source: Ref<unknown>,
) => {
  const loop = ref(false)
  const duration = ref(20)

  const update = () => {
    const viewport = viewportRef.value
    const group = stripRef.value?.firstElementChild as HTMLElement | null | undefined
    if (!viewport || !group) {
      loop.value = false
      return
    }
    const groupWidth = Math.max(group.scrollWidth, group.offsetWidth)
    loop.value = groupWidth > viewport.clientWidth
    // 恒定速度约 45px/s；设下限避免刚溢出时转得太快
    duration.value = Math.max(14, Math.round(groupWidth / 45))
  }

  let observer: ResizeObserver | null = null
  let observedViewport: HTMLElement | null = null
  const refresh = () => void nextTick(() => {
    const viewport = viewportRef.value
    if (viewport && viewport !== observedViewport) {
      if (!observer) observer = new ResizeObserver(update)
      if (observedViewport) observer.unobserve(observedViewport)
      observer.observe(viewport)
      observedViewport = viewport
    }
    update()
  })

  onMounted(refresh)
  onBeforeUnmount(() => observer?.disconnect())
  watch(source, refresh)

  return { loop, duration }
}

// 时间轴轮播：图钉沿固定虚线轨道循环滑行（仅桌面横向布局生效）
const trackViewportRef = ref<HTMLElement | null>(null)
const trackStripRef = ref<HTMLElement | null>(null)
const { loop: trackLoop, duration: trackLoopDuration } = useMarqueeLoop(trackViewportRef, trackStripRef, days)

// 灵感卡片轮播
const cardsViewportRef = ref<HTMLElement | null>(null)
const cardsStripRef = ref<HTMLElement | null>(null)
const { loop: cardsLoop, duration: cardsLoopDuration } = useMarqueeLoop(cardsViewportRef, cardsStripRef, highlightCards)
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

      <!-- 脉络时间轴：桌面横向，移动端纵向 -->
      <div class="journey__track-wrap">
        <span class="journey__marker journey__marker--start">{{ t('result.graph.journeyStart') }}</span>
        <span class="journey__marker journey__marker--end">{{ t('result.graph.journeyEnd') }}</span>
        <div
          ref="trackViewportRef"
          class="journey__track"
          :class="{ 'journey__track--loop': trackLoop }"
        >
          <div class="journey__rail" aria-hidden="true" />
          <div
            ref="trackStripRef"
            class="journey__track-strip"
            :style="trackLoop ? { animationDuration: `${trackLoopDuration}s` } : undefined"
          >
            <div
              v-for="copy in trackLoop ? 2 : 1"
              :key="copy"
              class="journey__track-group"
              :aria-hidden="copy === 2 ? 'true' : undefined"
            >
              <button
                v-for="(day, index) in days"
                :key="day.day_index"
                type="button"
                class="journey__stop"
                :style="{ '--accent': accentOf(index), '--i': index }"
                :tabindex="copy === 2 ? -1 : undefined"
                @click="emit('select-day', index)"
              >
                <span class="journey__day">D{{ index + 1 }}</span>
                <span class="journey__pin">
                  <img v-if="dayPhoto(day)" :src="dayPhoto(day)" :alt="cityOf(day)" loading="lazy" />
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

              <div class="journey__stop journey__stop--end" aria-hidden="true" :style="{ '--i': days.length }">
                <span class="journey__day">&nbsp;</span>
                <span class="journey__pin journey__pin--plane">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
                    <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 主题灵感卡片 -->
      <div v-if="highlightCards.length" class="journey__highlights">
        <h3>{{ t('result.graph.highlights') }}</h3>
        <div
          ref="cardsViewportRef"
          class="journey__cards"
          :class="{ 'journey__cards--loop': cardsLoop }"
        >
          <div
            ref="cardsStripRef"
            class="journey__cards-track"
            :style="cardsLoop ? { animationDuration: `${cardsLoopDuration}s` } : undefined"
          >
            <div
              v-for="copy in cardsLoop ? 2 : 1"
              :key="copy"
              class="journey__cards-group"
              :aria-hidden="copy === 2 ? 'true' : undefined"
            >
              <button
                v-for="(card, cardIndex) in highlightCards"
                :key="card.index"
                type="button"
                class="journey__card"
                :style="{ '--i': cardIndex }"
                :tabindex="copy === 2 ? -1 : undefined"
                @click="emit('select-day', card.index)"
              >
                <span class="journey__card-photo">
                  <img :src="card.photo" :alt="card.name" loading="lazy" />
                  <span class="journey__card-badge">D{{ card.index + 1 }}</span>
                </span>
                <strong>{{ card.name }}</strong>
                <span class="journey__card-city">{{ card.city }}</span>
              </button>
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
  border: 1px solid #eadfc9;
  border-radius: 20px;
  background-color: #fdf8ec;
  background-position: right center;
  background-size: cover;
}

.journey__eyebrow {
  margin: 0 0 6px;
  color: #b09a77;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.journey__hero h2 {
  margin: 0;
  color: #3d3229;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
}

.journey__summary {
  margin: 8px 0 0;
  max-inline-size: 560px;
  color: #7a6a58;
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
  border: 1px solid #e8dcc4;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  color: #6b5a45;
  font-size: 12px;
  font-weight: 600;
}

.journey__pills i {
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: #e8963c;
}

/* ---- 时间轴 ---- */
.journey__track-wrap {
  position: relative;
  margin-block-start: 22px;
  padding-block-start: 26px;
}

.journey__marker {
  position: absolute;
  inset-block-start: 0;
  color: #b09a77;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.journey__marker--start {
  inset-inline-start: 14px;
}

.journey__marker--end {
  inset-inline-end: 14px;
}

.journey__track {
  position: relative;
  padding: 0 6px 8px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(120, 100, 70, 0.3) transparent;
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

/* 循环模式：strip 收缩为内容宽并做 marquee，轨道虚线固定不动 */
.journey__track--loop {
  overflow-x: hidden;
}

.journey__track--loop .journey__track-strip {
  inline-size: max-content;
  animation: track-marquee linear infinite;
}

.journey__track--loop .journey__track-group {
  inline-size: max-content;
}

/* 悬停或键盘聚焦时暂停，方便点击图钉 */
.journey__track--loop:hover .journey__track-strip,
.journey__track--loop:focus-within .journey__track-strip {
  animation-play-state: paused;
}

@keyframes track-marquee {
  to {
    transform: translateX(-50%);
  }
}

.journey__rail {
  position: absolute;
  inset-block-start: calc(20px + 12px + 36px);
  inset-inline: 70px;
  border-block-start: 2px dashed #d9c6a4;
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
  background: #f3ead7;
  box-shadow: 0 3px 10px rgba(90, 70, 40, 0.18);
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

.journey__pin img {
  inline-size: 100%;
  block-size: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.journey__pin-fallback {
  color: #a08a68;
  font-size: 24px;
  font-weight: 700;
}

.journey__pin--plane {
  border-style: dashed;
  border-color: #c9b28a;
  color: #b09a77;
  box-shadow: none;
}

.journey__pin--plane::after {
  border-block-start-color: #c9b28a;
}

.journey__info {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-block-start: 14px;
}

.journey__city {
  color: #3d3229;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.journey__weather {
  margin-block-start: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(120, 100, 70, 0.1);
  color: #8a7457;
  font-size: 11px;
  white-space: nowrap;
}

.journey__spots {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-block-start: 7px;
  color: #9a8871;
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
  margin: 0 0 14px;
  color: #3d3229;
  font-size: 16px;
  font-weight: 700;
}

.journey__cards {
  padding-block-end: 8px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
  scrollbar-color: rgba(120, 100, 70, 0.3) transparent;
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

.journey__cards--loop {
  overflow-x: hidden;
  scroll-snap-type: none;
}

.journey__cards--loop .journey__cards-track {
  animation: cards-marquee linear infinite;
}

/* 悬停或键盘聚焦时暂停，方便点击 */
.journey__cards--loop:hover .journey__cards-track,
.journey__cards--loop:focus-within .journey__cards-track {
  animation-play-state: paused;
}

@keyframes cards-marquee {
  to {
    transform: translateX(-50%);
  }
}

.journey__card {
  display: flex;
  flex: 0 0 168px;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 0 0 10px;
  border: 1px solid #eadfc9;
  border-radius: 14px;
  background: #fffdf8;
  color: inherit;
  text-align: left;
  cursor: pointer;
  scroll-snap-align: start;
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.journey__card:hover {
  box-shadow: 0 6px 16px rgba(90, 70, 40, 0.14);
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
  color: #3d3229;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

.journey__card-city {
  padding-inline: 10px;
  color: #9a8871;
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
    padding-block-start: 0;
  }

  .journey__marker {
    display: none;
  }

  .journey__card {
    flex-basis: 148px;
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

  /* 减少动态：不自动播放，退回手动横滑 */
  .journey__cards--loop,
  .journey__track--loop {
    overflow-x: auto;
  }

  .journey__cards--loop .journey__cards-track,
  .journey__track--loop .journey__track-strip {
    animation: none;
  }
}
</style>
