export interface HotelPriceRequest {
  hotelName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}

export interface HotelPriceQuote {
  provider: "fliggy";
  hotel_name: string;
  nightly_price: number;
  currency: "CNY";
  source_url: string;
  checked_at: string;
  method: "lowest_nightly_browse";
}

export interface HotelPriceSource {
  quote(request: HotelPriceRequest): Promise<HotelPriceQuote | null>;
}
