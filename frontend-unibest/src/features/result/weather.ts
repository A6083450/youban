export type WeatherIconKind
  = | 'sun-shower'
    | 'thunder-storm'
    | 'partly-cloudy'
    | 'cloudy'
    | 'flurries'
    | 'sunny'
    | 'rainy'

function parseWeatherDate(rawDate: string): Date | null {
  if (!rawDate)
    return null

  const normalized = rawDate
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/[./]/g, '-')
    .trim()
  const matched = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (matched) {
    const [, year, month, day] = matched
    const parsed = new Date(Number(year), Number(month) - 1, Number(day))
    if (parsed.getFullYear() === Number(year)
      && parsed.getMonth() === Number(month) - 1
      && parsed.getDate() === Number(day)) {
      return parsed
    }
  }

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatWeatherDate(rawDate: string, localeTag = 'zh-CN'): string {
  const date = parseWeatherDate(rawDate)
  if (!date)
    return rawDate || '--'
  return new Intl.DateTimeFormat(localeTag, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

export function formatWeatherTemperature(temperature: number | null | undefined): string {
  if (temperature == null || !Number.isFinite(Number(temperature)))
    return '--'
  return `${Math.round(Number(temperature))}°`
}

export function weatherIconKind(dayWeather: string, nightWeather: string): WeatherIconKind {
  const text = `${dayWeather || ''} ${nightWeather || ''}`.trim()
  const hasRain = /雨|rain|shower|drizzle|sprinkle|阵雨|小雨|中雨|大雨|暴雨/i.test(text)
  const hasSun = /晴|sun|clear/i.test(text)

  if (/雷|thunder|storm|lightning/i.test(text))
    return 'thunder-storm'
  if (/雪|snow|sleet|hail|冰雹|冻雨|雨夹雪/i.test(text))
    return 'flurries'
  if (hasRain && hasSun)
    return 'sun-shower'
  if (hasRain)
    return 'rainy'
  if (/多云|云|partly|cloud/i.test(text))
    return 'partly-cloudy'
  if (/[阴雾霾]|overcast|fog|mist|haze|wind|breeze|gale/i.test(text))
    return 'cloudy'
  return 'sunny'
}
