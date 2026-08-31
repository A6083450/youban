import { describe, expect, it } from 'vitest'
import type { TripPlan } from './model'
import {
  buildWebGuideHtml,
  escapeExportHtml,
  shouldStartNewPdfPage,
  waitForExportImages,
  webGuideFileName,
} from './web-export'

const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`

const plan: TripPlan = {
  city: '上海 <杭州>',
  start_date: '2026-08-01',
  end_date: '2026-08-03',
  days: [{
    date: '2026-08-01',
    day_index: 0,
    city: '上海',
    description: '城市探索',
    transportation: '步行',
    accommodation: '酒店',
    attractions: [{ name: '外滩 & 夜景', start_time: '09:00', visit_duration: 120 }],
    meals: [{ name: '本帮菜', type: 'lunch', time: '12:00' }],
  }],
  weather_info: [{ date: '2026-08-01', day_weather: '晴', night_weather: '多云', day_temp: 33, night_temp: 26 }],
  overall_suggestions: '慢慢走',
  budget: { total_attractions: 10, total_hotels: 20, total_meals: 30, total_transportation: 40, total: 100 },
}

describe('web guide export', () => {
  it('escapes user-controlled content and preserves all legacy sections', () => {
    const html = buildWebGuideHtml(plan, t, { footerQrDataUrl: 'data:image/png;base64,qr' })
    expect(escapeExportHtml('<script>&"')).toBe('&lt;script&gt;&amp;&quot;')
    expect(html).toContain('上海 &lt;杭州&gt;')
    expect(html).toContain('外滩 &amp; 夜景')
    expect(html).toContain('data-export-day="true"')
    expect(html).toContain('result.export.mealTitle')
    expect(html).toContain('result.export.weatherTitle')
    expect(html).toContain('result.budget.title')
    expect(html).toContain('data-export-final-footer="true"')
  })

  it('keeps the legacy timestamped filenames', () => {
    expect(webGuideFileName('旅行计划', '上海', 123, 'png')).toBe('旅行计划_上海_123.png')
    expect(webGuideFileName('旅行计划', '上海', 123, 'pdf')).toBe('旅行计划_上海_123.pdf')
  })

  it('waits for a cloned export image before measuring its layout', async () => {
    const image = document.createElement('img')
    Object.defineProperty(image, 'complete', { configurable: true, get: () => false })
    const root = document.createElement('div')
    root.appendChild(image)
    let settled = false

    const pending = waitForExportImages(root).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    image.dispatchEvent(new Event('load'))
    await pending
    expect(settled).toBe(true)
  })

  it('does not miss an image that completes while its load listener is being attached', async () => {
    const image = document.createElement('img')
    let completeReads = 0
    Object.defineProperty(image, 'complete', {
      configurable: true,
      get: () => ++completeReads > 1,
    })
    const root = document.createElement('div')
    root.appendChild(image)
    let settled = false

    void waitForExportImages(root).then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(true)
  })

  it('starts a new page instead of shrinking several guide sections below a readable scale', () => {
    expect(shouldStartNewPdfPage(0.82, 4, false)).toBe(true)
    expect(shouldStartNewPdfPage(0.96, 4, false)).toBe(false)
    expect(shouldStartNewPdfPage(0.5, 1, false)).toBe(false)
  })
})
