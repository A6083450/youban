<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TripWeather } from '@/features/result/model'
import { formatWeatherDate, formatWeatherTemperature, weatherIconKind } from '@/features/result/weather'

const props = withDefaults(defineProps<{
  weather: TripWeather
  dayNumber: number
  active?: boolean
  localeTag?: string
}>(), {
  active: false,
  localeTag: 'zh-CN',
})

const emit = defineEmits<{
  select: [dayNumber: number]
}>()

const { t } = useI18n()
const iconKind = computed(() => weatherIconKind(props.weather.day_weather || '', props.weather.night_weather || ''))
</script>

<template>
  <view
    class="weather-day-card"
    :class="{ 'weather-day-card--active': active }"
    role="button"
    tabindex="0"
    :aria-pressed="active"
    @click="emit('select', dayNumber)"
    @keydown.enter="emit('select', dayNumber)"
    @keydown.space.prevent="emit('select', dayNumber)"
  >
    <view class="weather-day-card__header">
      <view>
        <view class="weather-day-card__date">
          {{ formatWeatherDate(weather.date, localeTag) }}
        </view>
        <view class="weather-day-card__day-number">
          {{ t('common.dayNumber', { day: dayNumber }) }}
        </view>
      </view>
      <text v-if="weather.city" class="weather-day-card__city">
        {{ weather.city }}
      </text>
    </view>

    <view class="weather-day-card__body">
      <view class="weather-day-card__icon weather-icon" :class="iconKind">
        <template v-if="iconKind === 'sun-shower'">
          <view class="cloud" />
          <view class="sun">
            <view class="rays" />
          </view>
          <view class="rain" />
        </template>
        <template v-else-if="iconKind === 'thunder-storm'">
          <view class="cloud" />
          <view class="lightning">
            <view class="bolt" />
            <view class="bolt" />
          </view>
        </template>
        <template v-else-if="iconKind === 'partly-cloudy'">
          <view class="cloud" />
          <view class="sun">
            <view class="rays" />
          </view>
        </template>
        <template v-else-if="iconKind === 'cloudy'">
          <view class="cloud" />
          <view class="cloud" />
        </template>
        <template v-else-if="iconKind === 'flurries'">
          <view class="cloud" />
          <view class="snow">
            <view class="flake" />
            <view class="flake" />
          </view>
        </template>
        <template v-else-if="iconKind === 'rainy'">
          <view class="cloud" />
          <view class="rain" />
        </template>
        <template v-else>
          <view class="sun">
            <view class="rays" />
          </view>
        </template>
      </view>
      <view class="weather-day-card__temp">
        {{ formatWeatherTemperature(weather.day_temp) }}
        <text class="weather-day-card__temp-night">/ {{ formatWeatherTemperature(weather.night_temp) }}</text>
      </view>
      <view class="weather-day-card__weather-text">
        {{ weather.day_weather || '--' }}
      </view>
    </view>

    <view class="weather-day-card__footer">
      <view class="weather-day-card__footer-row">
        <text class="weather-day-card__footer-label">{{ t('result.weatherNight') }}</text>
        <text class="weather-day-card__footer-value">
          {{ weather.night_weather || '--' }} · {{ formatWeatherTemperature(weather.night_temp) }}
        </text>
      </view>
      <view class="weather-day-card__footer-row">
        <text class="weather-day-card__footer-label">{{ t('result.weatherWind') }}</text>
        <text class="weather-day-card__footer-value">
          {{ `${weather.wind_direction || '--'} ${weather.wind_power || '--'}` }}
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.weather-day-card {
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
  padding: 18px;
  border: 1.5px solid transparent;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 8px 24px rgba(61, 50, 41, 0.06);
  cursor: pointer;
  font-family:
    -apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji',
    'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
  font-size: 14px;
  font-weight: 300;
  line-height: 1.5714285714;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
  backdrop-filter: blur(12px);
}

.weather-day-card:hover {
  box-shadow: 0 12px 32px rgba(61, 50, 41, 0.1);
  transform: translateY(-2px);
}

.weather-day-card--active {
  border: 1.5px solid #d97757;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 12px 32px rgba(217, 119, 87, 0.14);
}

.weather-day-card--active::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 4px;
  background: linear-gradient(90deg, #d97757, #c4603d);
  content: '';
}

.weather-day-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.weather-day-card__date {
  color: rgba(61, 50, 41, 0.55);
  font-size: 13px;
  font-weight: 600;
}

.weather-day-card__day-number {
  margin-top: 4px;
  color: #d97757;
  font-size: 12px;
  font-weight: 700;
}

.weather-day-card__city {
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(61, 50, 41, 0.06);
  color: rgba(61, 50, 41, 0.5);
  font-size: 11px;
}

.weather-day-card__body {
  margin: 18px 0;
  text-align: center;
}

.weather-day-card__icon.weather-icon {
  position: relative;
  display: inline-flex;
  width: 6em;
  height: 6em;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  animation: weather-float 5.5s ease-in-out infinite;
  background: linear-gradient(180deg, #e6f3ff 0%, #d4ecff 100%);
  box-shadow:
    inset 0 -4px 10px rgba(74, 144, 217, 0.12),
    0 4px 12px rgba(74, 144, 217, 0.15);
  font-size: 10px;
}

.weather-icon .cloud {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 50%;
  width: 3.6875em;
  height: 3.6875em;
  margin: -1.84375em;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    -2.1875em 0.6875em 0 -0.6875em #fff,
    2.0625em 0.9375em 0 -0.9375em #fff,
    0 0 0 0.375em rgba(180, 210, 240, 0.35),
    -2.1875em 0.6875em 0 -0.3125em rgba(180, 210, 240, 0.35),
    2.0625em 0.9375em 0 -0.5625em rgba(180, 210, 240, 0.35);
}

.weather-icon .cloud::after {
  position: absolute;
  bottom: 0;
  left: -0.5em;
  display: block;
  width: 4.5625em;
  height: 1em;
  background: #fff;
  box-shadow: 0 0.4375em 0 -0.0625em rgba(180, 210, 240, 0.35);
  content: '';
}

.weather-icon .cloud:nth-child(2) {
  z-index: 0;
  animation: weather-cloud 4s linear infinite;
  background: #eef6ff;
  box-shadow:
    -2.1875em 0.6875em 0 -0.6875em #eef6ff,
    2.0625em 0.9375em 0 -0.9375em #eef6ff,
    0 0 0 0.375em rgba(180, 210, 240, 0.25),
    -2.1875em 0.6875em 0 -0.3125em rgba(180, 210, 240, 0.25),
    2.0625em 0.9375em 0 -0.5625em rgba(180, 210, 240, 0.25);
  opacity: 0.6;
  transform: scale(0.5) translate(6em, -3em);
}

.weather-icon .cloud:nth-child(2)::after {
  background: #eef6ff;
}

.weather-icon .sun {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2.5em;
  height: 2.5em;
  margin: -1.25em;
  border-radius: 50%;
  animation: weather-spin 12s infinite linear;
  background: #fdb813;
  box-shadow:
    0 0 0 0.375em rgba(253, 184, 19, 0.22),
    0 0 1.2em rgba(253, 184, 19, 0.35);
}

.weather-icon .rays {
  position: absolute;
  top: -2em;
  left: 50%;
  display: block;
  width: 0.375em;
  height: 1.125em;
  margin-left: -0.1875em;
  border-radius: 0.25em;
  background: #fdb813;
  box-shadow: 0 5.375em #fdb813;
}

.weather-icon .rays::before,
.weather-icon .rays::after {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 0.375em;
  height: 1.125em;
  border-radius: 0.25em;
  background: #fdb813;
  box-shadow: 0 5.375em #fdb813;
  content: '';
  transform: rotate(60deg);
  transform-origin: 50% 3.25em;
}

.weather-icon .rays::before {
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

.weather-icon .rain::after {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  width: 1.125em;
  height: 1.125em;
  margin: -1em 0 0 -0.25em;
  border-radius: 100% 0 60% 50% / 60% 0 100% 50%;
  animation: weather-rain 3s linear infinite;
  background: #4a90d9;
  box-shadow:
    0.625em 0.875em 0 -0.125em rgba(74, 144, 217, 0.25),
    -0.875em 1.125em 0 -0.125em rgba(74, 144, 217, 0.25),
    -1.375em -0.125em 0 rgba(74, 144, 217, 0.25);
  content: '';
  transform: rotate(-28deg);
}

.weather-icon .bolt {
  position: absolute;
  top: 50%;
  left: 50%;
  animation: weather-lightning 2s linear infinite;
  color: #ffd700;
  margin: -0.25em 0 0 -0.125em;
  opacity: 0.6;
}

.weather-icon .bolt:nth-child(2) {
  width: 0.5em;
  height: 0.25em;
  animation: weather-lightning 1.5s linear infinite;
  margin: -1.75em 0 0 -1.875em;
  opacity: 0.4;
  transform: translate(2.5em, 2.25em);
}

.weather-icon .bolt::before,
.weather-icon .bolt::after {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  border-top: 1.25em solid transparent;
  border-right: 0.75em solid;
  border-bottom: 0.75em solid;
  border-left: 0.5em solid transparent;
  content: '';
  margin: -1.625em 0 0 -1.0125em;
  transform: skewX(-10deg);
}

.weather-icon .bolt::after {
  border-top: 0.75em solid;
  border-right: 0.5em solid transparent;
  border-bottom: 1.25em solid transparent;
  border-left: 0.75em solid;
  margin: -0.25em 0 0 -0.25em;
  transform: skewX(-10deg);
}

.weather-icon .bolt:nth-child(2)::before {
  border-top: 0.625em solid transparent;
  border-right: 0.375em solid;
  border-bottom: 0.375em solid;
  border-left: 0.25em solid transparent;
  margin: -0.75em 0 0 -0.5em;
}

.weather-icon .bolt:nth-child(2)::after {
  border-top: 0.375em solid;
  border-right: 0.25em solid transparent;
  border-bottom: 0.625em solid transparent;
  border-left: 0.375em solid;
  margin: -0.125em 0 0 -0.125em;
}

.weather-icon .flake::before,
.weather-icon .flake::after {
  position: absolute;
  top: 50%;
  left: 50%;
  animation: weather-spin 8s linear infinite reverse;
  color: #b8e6ff;
  content: '\2744';
  line-height: 1em;
  margin: -1.025em 0 0 -1.0125em;
  opacity: 0.5;
}

.weather-icon .flake::after {
  animation: weather-spin 14s linear infinite;
  font-size: 1.5em;
  margin: 0.125em 0 0 -1em;
  opacity: 0.7;
}

.weather-icon .flake:nth-child(2)::before {
  animation: weather-spin 10s linear infinite;
  font-size: 1.25em;
  margin: -0.5em 0 0 0.25em;
  opacity: 0.5;
}

.weather-icon .flake:nth-child(2)::after {
  animation: weather-spin 16s linear infinite reverse;
  font-size: 2em;
  margin: 0.375em 0 0 0.125em;
  opacity: 0.7;
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
    background: #fff5cc;
    color: #fff5cc;
    opacity: 0.3;
  }
  50% {
    background: #ffd700;
    color: #ffd700;
    opacity: 1;
  }
  55% {
    background: #fff5cc;
    color: #fff5cc;
    opacity: 0.3;
  }
}

.weather-day-card__temp {
  margin-top: 10px;
  color: #3d3229;
  font-size: 32px;
  font-weight: 800;
}

.weather-day-card__temp-night {
  color: rgba(61, 50, 41, 0.45);
  font-size: 18px;
  font-weight: 500;
}

.weather-day-card__weather-text {
  margin-top: 4px;
  color: rgba(61, 50, 41, 0.7);
  font-size: 14px;
}

.weather-day-card__footer {
  display: flex;
  padding-top: 12px;
  border-top: 1px solid rgba(61, 50, 41, 0.08);
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
  color: #3d3229;
  font-weight: 600;
}

@media (max-width: 640px) {
  .weather-day-card {
    display: flex;
    padding: 16px;
    align-items: center;
    gap: 16px;
  }
  .weather-day-card__body {
    margin: 0;
    flex: 0 0 80px;
  }
  .weather-day-card__icon.weather-icon {
    font-size: 8px;
  }
  .weather-day-card__temp {
    margin-top: 4px;
    font-size: 24px;
  }
  .weather-day-card__temp-night {
    font-size: 14px;
  }
  .weather-day-card__weather-text {
    display: none;
  }
  .weather-day-card__header {
    min-width: 0;
    margin-bottom: 0;
    flex: 1;
    flex-direction: column;
    gap: 4px;
  }
  .weather-day-card__footer {
    min-width: 0;
    padding-top: 0;
    border-top: none;
    flex: 1;
  }
  .weather-day-card__footer-row {
    justify-content: flex-start;
    gap: 8px;
  }
}
</style>
