import { describe, expect, it } from 'vitest'
import { formatWeatherDate, formatWeatherTemperature, weatherIconKind } from './weather'

describe('weather presentation', () => {
  it('formats supported trip dates with the active product locale', () => {
    expect(formatWeatherDate('2026-08-01', 'zh-CN')).toBe('8月1日周六')
    expect(formatWeatherDate('2026年8月2日', 'zh-CN')).toBe('8月2日周日')
    expect(formatWeatherDate('not-a-date', 'zh-CN')).toBe('not-a-date')
    expect(formatWeatherDate('', 'zh-CN')).toBe('--')
  })

  it('keeps the legacy weather icon classification for every condition family', () => {
    expect(weatherIconKind('晴', '阵雨')).toBe('sun-shower')
    expect(weatherIconKind('雷阵雨', '')).toBe('thunder-storm')
    expect(weatherIconKind('雨夹雪', '')).toBe('flurries')
    expect(weatherIconKind('小雨', '')).toBe('rainy')
    expect(weatherIconKind('多云', '')).toBe('partly-cloudy')
    expect(weatherIconKind('阴', '')).toBe('cloudy')
    expect(weatherIconKind('', '')).toBe('sunny')
  })

  it('rounds finite temperatures and preserves the empty placeholder', () => {
    expect(formatWeatherTemperature(32.6)).toBe('33°')
    expect(formatWeatherTemperature(null)).toBe('--')
    expect(formatWeatherTemperature(Number.NaN)).toBe('--')
  })
})
