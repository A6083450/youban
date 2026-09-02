import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/trip/DailyItinerary.vue'), 'utf8')

describe('daily itinerary legacy copy', () => {
  it('falls back to the original meal type when no translation exists', () => {
    expect(source).toContain('translated && translated !== key ? translated : type')
  })

  it('retains photo and unavailable hotel-price presentation', () => {
    expect(source).toContain('attractionPhotos?: Record<string, string>')
    expect(source).toContain('item.day.hotel?.price_status === \'unavailable\'')
  })

  it('matches the legacy timeline icons and 16:9 photo height', () => {
    expect(source).toContain('<wd-icon name="time-line"')
    expect(source).toContain('<wd-icon name="swap"')
    expect(source).toContain('<wd-icon name="store"')
    expect(source).toMatch(/\.daily-entry-details > image \{[\s\S]*height: auto;/)
    expect(source).toMatch(/\.daily-entry-details > image \{[\s\S]*aspect-ratio: 16 \/ 9;/)
  })
})
