import type { Hotel } from '@/types'

export interface FliggyHotelPricePresentation {
  nightlyPrice: number
  sourceUrl: string | null
}

const httpsUrl = (value: unknown): string | null => {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export const fliggyHotelPricePresentation = (
  hotel: Hotel | null | undefined,
): FliggyHotelPricePresentation | null => {
  const price = Number(hotel?.estimated_cost)
  if (
    hotel?.price_source !== 'fliggy'
    || hotel.price_status !== 'estimated'
    || !Number.isFinite(price)
    || price <= 0
  ) return null
  return {
    nightlyPrice: price,
    sourceUrl: httpsUrl(hotel.source_url),
  }
}
