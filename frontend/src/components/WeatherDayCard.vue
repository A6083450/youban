<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WeatherInfo } from '@/types'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    weather: WeatherInfo
    dayNumber: number
    active?: boolean
    localeTag?: string
  }>(),
  { active: false, localeTag: 'zh-CN' }
)

const emit = defineEmits<{ (e: 'select', dayNumber: number): void }>()

const parseWeatherDate = (rawDate: string): Date | null => {
  if (!rawDate) return null
  const normalized = rawDate
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-')
    .trim()
  const parsedDate = new Date(normalized)
  if (!Number.isNaN(parsedDate.getTime())) return parsedDate
  const matched = rawDate.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!matched) return null
  const [, year, month, day] = matched
  const fallbackDate = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate
}

const formatDate = (rawDate: string): string => {
  const date = parseWeatherDate(rawDate)
  if (!date) return rawDate || '--'
  return new Intl.DateTimeFormat(props.localeTag, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

const formatTemp = (temperature: number | null | undefined): string => {
  if (temperature == null || !Number.isFinite(Number(temperature))) return '--'
  return `${Math.round(Number(temperature))}°`
}

type WeatherIconKind = 'sun-shower' | 'thunder-storm' | 'partly-cloudy' | 'cloudy' | 'flurries' | 'sunny' | 'rainy'

const getWeatherIconKind = (weatherText: string): WeatherIconKind => {
  const text = (weatherText || '').trim()
  const hasRain = /(雨|rain|shower|drizzle|sprinkle|阵雨|小雨|中雨|大雨|暴雨)/i.test(text)
  const hasSun = /(晴|sun|clear)/i.test(text)

  if (/(雷|thunder|storm|lightning|雷暴|雷阵雨)/i.test(text)) return 'thunder-storm'
  if (/(雪|snow|sleet|hail|冰雹|冻雨|雨夹雪)/i.test(text)) return 'flurries'
  if (hasRain && hasSun) return 'sun-shower'
  if (hasRain) return 'rainy'
  // 多云 → 太阳躲在云后;阴/雾霾/大风 → 纯云
  if (/(多云|云|partly|cloud)/i.test(text)) return 'partly-cloudy'
  if (/(阴|overcast|雾|霾|fog|mist|haze|wind|breeze|gale)/i.test(text)) return 'cloudy'
  return 'sunny'
}

const iconKind = computed<WeatherIconKind>(() =>
  getWeatherIconKind(`${props.weather.day_weather || ''} ${props.weather.night_weather || ''}`)
)
</script>

<template>
  <div
    class="weather-day-card"
    :class="{ 'weather-day-card--active': active }"
    role="button"
    tabindex="0"
    :aria-pressed="active"
    @click="emit('select', dayNumber)"
    @keydown.enter="emit('select', dayNumber)"
    @keydown.space.prevent="emit('select', dayNumber)"
  >
    <div class="weather-day-card__header">
      <div>
        <div class="weather-day-card__date">{{ formatDate(weather.date) }}</div>
        <div class="weather-day-card__day-number">{{ t('common.dayNumber', { day: dayNumber }) }}</div>
      </div>
      <span v-if="weather.city" class="weather-day-card__city">{{ weather.city }}</span>
    </div>

    <div class="weather-day-card__body">
      <div class="weather-day-card__icon weather-icon" :class="iconKind">
        <template v-if="iconKind === 'sun-shower'">
          <div class="cloud"></div>
          <div class="sun"><div class="rays"></div></div>
          <div class="rain"></div>
        </template>
        <template v-else-if="iconKind === 'thunder-storm'">
          <div class="cloud"></div>
          <div class="lightning">
            <div class="bolt"></div>
            <div class="bolt"></div>
          </div>
        </template>
        <template v-else-if="iconKind === 'partly-cloudy'">
          <div class="cloud"></div>
          <div class="sun"><div class="rays"></div></div>
        </template>
        <template v-else-if="iconKind === 'cloudy'">
          <div class="cloud"></div>
          <div class="cloud"></div>
        </template>
        <template v-else-if="iconKind === 'flurries'">
          <div class="cloud"></div>
          <div class="snow">
            <div class="flake"></div>
            <div class="flake"></div>
          </div>
        </template>
        <template v-else-if="iconKind === 'rainy'">
          <div class="cloud"></div>
          <div class="rain"></div>
        </template>
        <template v-else>
          <div class="sun"><div class="rays"></div></div>
        </template>
      </div>
      <div class="weather-day-card__temp">
        {{ formatTemp(weather.day_temp) }}
        <span class="weather-day-card__temp-night">/ {{ formatTemp(weather.night_temp) }}</span>
      </div>
      <div class="weather-day-card__weather-text">{{ weather.day_weather || '--' }}</div>
    </div>

    <div class="weather-day-card__footer">
      <div class="weather-day-card__footer-row">
        <span class="weather-day-card__footer-label">{{ t('result.weatherNight') }}</span>
        <span class="weather-day-card__footer-value"
          >{{ weather.night_weather || '--' }} · {{ formatTemp(weather.night_temp) }}</span
        >
      </div>
      <div class="weather-day-card__footer-row">
        <span class="weather-day-card__footer-label">{{ t('result.weatherWind') }}</span>
        <span class="weather-day-card__footer-value"
          >{{ (weather.wind_direction || '--') + ' ' + (weather.wind_power || '--') }}</span
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.weather-day-card {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  border: 1.5px solid transparent;
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 8px 24px rgba(61, 50, 41, 0.06);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}

.weather-day-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(61, 50, 41, 0.1);
}

.weather-day-card--active {
  background: rgba(255, 255, 255, 0.85);
  border: 1.5px solid #D97757;
  box-shadow: 0 12px 32px rgba(217, 119, 87, 0.14);
}

.weather-day-card--active::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #D97757, #C4603D);
}

.weather-day-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.weather-day-card__date {
  font-size: 13px;
  color: rgba(61, 50, 41, 0.55);
  font-weight: 600;
}

.weather-day-card__day-number {
  font-size: 12px;
  color: #D97757;
  font-weight: 700;
  margin-top: 4px;
}

.weather-day-card__city {
  font-size: 11px;
  color: rgba(61, 50, 41, 0.5);
  background: rgba(61, 50, 41, 0.06);
  padding: 3px 8px;
  border-radius: 999px;
}

.weather-day-card__body {
  text-align: center;
  margin: 18px 0;
}

.weather-day-card__icon.weather-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 6em;
  height: 6em;
  font-size: 10px;
  border-radius: 50%;
  background: linear-gradient(180deg, #e6f3ff 0%, #d4ecff 100%);
  box-shadow: inset 0 -4px 10px rgba(74, 144, 217, 0.12), 0 4px 12px rgba(74, 144, 217, 0.15);
  animation: weather-float 5.5s ease-in-out infinite;
}

.weather-icon .cloud {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  width: 3.6875em;
  height: 3.6875em;
  margin: -1.84375em;
  background: #fff;
  border-radius: 50%;
  box-shadow:
    -2.1875em 0.6875em 0 -0.6875em #fff,
    2.0625em 0.9375em 0 -0.9375em #fff,
    0 0 0 0.375em rgba(180, 210, 240, 0.35),
    -2.1875em 0.6875em 0 -0.3125em rgba(180, 210, 240, 0.35),
    2.0625em 0.9375em 0 -0.5625em rgba(180, 210, 240, 0.35);
}

.weather-icon .cloud:after {
  content: '';
  position: absolute;
  bottom: 0;
  left: -0.5em;
  display: block;
  width: 4.5625em;
  height: 1em;
  background: #fff;
  box-shadow: 0 0.4375em 0 -0.0625em rgba(180, 210, 240, 0.35);
}

.weather-icon .cloud:nth-child(2) {
  z-index: 0;
  background: #eef6ff;
  box-shadow:
    -2.1875em 0.6875em 0 -0.6875em #eef6ff,
    2.0625em 0.9375em 0 -0.9375em #eef6ff,
    0 0 0 0.375em rgba(180, 210, 240, 0.25),
    -2.1875em 0.6875em 0 -0.3125em rgba(180, 210, 240, 0.25),
    2.0625em 0.9375em 0 -0.5625em rgba(180, 210, 240, 0.25);
  opacity: 0.6;
  transform: scale(0.5) translate(6em, -3em);
  animation: weather-cloud 4s linear infinite;
}

.weather-icon .cloud:nth-child(2):after {
  background: #eef6ff;
}

.weather-icon .sun {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2.5em;
  height: 2.5em;
  margin: -1.25em;
  background: #fdb813;
  border-radius: 50%;
  box-shadow: 0 0 0 0.375em rgba(253, 184, 19, 0.22), 0 0 1.2em rgba(253, 184, 19, 0.35);
  animation: weather-spin 12s infinite linear;
}

.weather-icon .rays {
  position: absolute;
  top: -2em;
  left: 50%;
  display: block;
  width: 0.375em;
  height: 1.125em;
  margin-left: -0.1875em;
  background: #fdb813;
  border-radius: 0.25em;
  box-shadow: 0 5.375em #fdb813;
}

.weather-icon .rays:before,
.weather-icon .rays:after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 0.375em;
  height: 1.125em;
  transform: rotate(60deg);
  transform-origin: 50% 3.25em;
  background: #fdb813;
  border-radius: 0.25em;
  box-shadow: 0 5.375em #fdb813;
}

.weather-icon .rays:before {
  transform: rotate(120deg);
}

.weather-icon .cloud + .sun {
  margin: -2em 1em;
}

.weather-icon .rain,
.weather-icon .lightning,
.weather-icon .snow {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  width: 3.75em;
  height: 3.75em;
  margin: 0.375em 0 0 -2em;
  background: transparent;
}

.weather-icon .rain:after {
  content: '';
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  width: 1.125em;
  height: 1.125em;
  margin: -1em 0 0 -0.25em;
  background: #4a90d9;
  border-radius: 100% 0 60% 50% / 60% 0 100% 50%;
  box-shadow:
    0.625em 0.875em 0 -0.125em rgba(74, 144, 217, 0.25),
    -0.875em 1.125em 0 -0.125em rgba(74, 144, 217, 0.25),
    -1.375em -0.125em 0 rgba(74, 144, 217, 0.25);
  transform: rotate(-28deg);
  animation: weather-rain 3s linear infinite;
}

.weather-icon .bolt {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: -0.25em 0 0 -0.125em;
  color: #ffd700;
  opacity: 0.6;
  animation: weather-lightning 2s linear infinite;
}

.weather-icon .bolt:nth-child(2) {
  width: 0.5em;
  height: 0.25em;
  margin: -1.75em 0 0 -1.875em;
  transform: translate(2.5em, 2.25em);
  opacity: 0.4;
  animation: weather-lightning 1.5s linear infinite;
}

.weather-icon .bolt:before,
.weather-icon .bolt:after {
  content: '';
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  margin: -1.625em 0 0 -1.0125em;
  border-top: 1.25em solid transparent;
  border-right: 0.75em solid;
  border-bottom: 0.75em solid;
  border-left: 0.5em solid transparent;
  transform: skewX(-10deg);
}

.weather-icon .bolt:after {
  margin: -0.25em 0 0 -0.25em;
  border-top: 0.75em solid;
  border-right: 0.5em solid transparent;
  border-bottom: 1.25em solid transparent;
  border-left: 0.75em solid;
  transform: skewX(-10deg);
}

.weather-icon .bolt:nth-child(2):before {
  margin: -0.75em 0 0 -0.5em;
  border-top: 0.625em solid transparent;
  border-right: 0.375em solid;
  border-bottom: 0.375em solid;
  border-left: 0.25em solid transparent;
}

.weather-icon .bolt:nth-child(2):after {
  margin: -0.125em 0 0 -0.125em;
  border-top: 0.375em solid;
  border-right: 0.25em solid transparent;
  border-bottom: 0.625em solid transparent;
  border-left: 0.375em solid;
}

.weather-icon .flake:before,
.weather-icon .flake:after {
  content: '\2744';
  position: absolute;
  top: 50%;
  left: 50%;
  margin: -1.025em 0 0 -1.0125em;
  color: #b8e6ff;
  line-height: 1em;
  opacity: 0.5;
  animation: weather-spin 8s linear infinite reverse;
}

.weather-icon .flake:after {
  margin: 0.125em 0 0 -1em;
  font-size: 1.5em;
  opacity: 0.7;
  animation: weather-spin 14s linear infinite;
}

.weather-icon .flake:nth-child(2):before {
  margin: -0.5em 0 0 0.25em;
  font-size: 1.25em;
  opacity: 0.5;
  animation: weather-spin 10s linear infinite;
}

.weather-icon .flake:nth-child(2):after {
  margin: 0.375em 0 0 0.125em;
  font-size: 2em;
  opacity: 0.7;
  animation: weather-spin 16s linear infinite reverse;
}

@keyframes weather-spin {
  100% {
    transform: rotate(360deg);
  }
}

@keyframes weather-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-2px);
  }
}

@keyframes weather-cloud {
  0% {
    opacity: 0;
  }

  50% {
    opacity: 0.4;
  }

  100% {
    opacity: 0;
    transform: scale(0.5) translate(-200%, -3em);
  }
}

@keyframes weather-rain {
  0% {
    background: #4a90d9;
    box-shadow:
      0.625em 0.875em 0 -0.125em rgba(74, 144, 217, 0.25),
      -0.875em 1.125em 0 -0.125em rgba(74, 144, 217, 0.25),
      -1.375em -0.125em 0 #4a90d9;
  }

  25% {
    box-shadow:
      0.625em 0.875em 0 -0.125em rgba(74, 144, 217, 0.25),
      -0.875em 1.125em 0 -0.125em #4a90d9,
      -1.375em -0.125em 0 rgba(74, 144, 217, 0.25);
  }

  50% {
    background: rgba(74, 144, 217, 0.3);
    box-shadow:
      0.625em 0.875em 0 -0.125em #4a90d9,
      -0.875em 1.125em 0 -0.125em rgba(74, 144, 217, 0.25),
      -1.375em -0.125em 0 rgba(74, 144, 217, 0.25);
  }

  100% {
    box-shadow:
      0.625em 0.875em 0 -0.125em rgba(74, 144, 217, 0.25),
      -0.875em 1.125em 0 -0.125em rgba(74, 144, 217, 0.25),
      -1.375em -0.125em 0 #4a90d9;
  }
}

@keyframes weather-lightning {
  45% {
    color: #fff5cc;
    background: #fff5cc;
    opacity: 0.3;
  }

  50% {
    color: #ffd700;
    background: #ffd700;
    opacity: 1;
  }

  55% {
    color: #fff5cc;
    background: #fff5cc;
    opacity: 0.3;
  }
}

.weather-day-card__temp {
  font-size: 32px;
  font-weight: 800;
  color: #3D3229;
  margin-top: 10px;
}

.weather-day-card__temp-night {
  font-size: 18px;
  color: rgba(61, 50, 41, 0.45);
  font-weight: 500;
}

.weather-day-card__weather-text {
  font-size: 14px;
  color: rgba(61, 50, 41, 0.7);
  margin-top: 4px;
}

.weather-day-card__footer {
  border-top: 1px solid rgba(61, 50, 41, 0.08);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.weather-day-card__footer-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.weather-day-card__footer-label {
  color: rgba(61, 50, 41, 0.55);
}

.weather-day-card__footer-value {
  color: #3D3229;
  font-weight: 600;
}

@media (max-width: 640px) {
  .weather-day-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
  }

  .weather-day-card__body {
    flex: 0 0 80px;
    margin: 0;
  }

  .weather-day-card__icon.weather-icon {
    font-size: 8px;
  }

  .weather-day-card__temp {
    font-size: 24px;
    margin-top: 4px;
  }

  .weather-day-card__temp-night {
    font-size: 14px;
  }

  .weather-day-card__weather-text {
    display: none;
  }

  .weather-day-card__header {
    flex: 1;
    min-width: 0;
    margin-bottom: 0;
    flex-direction: column;
    gap: 4px;
  }

  .weather-day-card__footer {
    flex: 1;
    min-width: 0;
    border-top: none;
    padding-top: 0;
  }

  .weather-day-card__footer-row {
    justify-content: flex-start;
    gap: 8px;
  }
}
</style>
