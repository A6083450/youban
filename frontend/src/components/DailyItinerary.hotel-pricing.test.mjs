import { describe, expect, test } from 'bun:test'

import { fliggyHotelPricePresentation } from '@/utils/hotelPricing'

const hotel = {
  name: '上海外滩华尔道夫酒店',
  address: '上海市黄浦区',
  price_range: '',
  rating: '4.8',
  distance: '1km',
  type: '豪华型',
  estimated_cost: 2480,
  source: 'amap',
  source_hotel_id: 'B0FFG123',
  price_source: 'fliggy',
  price_status: 'estimated',
  source_url: 'https://router.feizhu.com/hotel/1',
  price_checked_at: '2026-08-26T03:00:00.000Z',
}

describe('daily itinerary Fliggy hotel pricing', () => {
  test('presents a positive estimated nightly quote with a safe link', () => {
    expect(fliggyHotelPricePresentation(hotel)).toEqual({
      nightlyPrice: 2480,
      sourceUrl: 'https://router.feizhu.com/hotel/1',
    })
  })

  test('keeps a valid quote while dropping a non-HTTPS link', () => {
    expect(fliggyHotelPricePresentation({ ...hotel, source_url: 'http://example.com/hotel' }))
      .toEqual({ nightlyPrice: 2480, sourceUrl: null })
  })

  test('does not present zero, unavailable, or non-Fliggy prices', () => {
    expect(fliggyHotelPricePresentation({ ...hotel, estimated_cost: 0 })).toBeNull()
    expect(fliggyHotelPricePresentation({ ...hotel, price_status: 'unavailable' })).toBeNull()
    expect(fliggyHotelPricePresentation({ ...hotel, price_source: 'other' })).toBeNull()
  })
})
