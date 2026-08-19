import unittest
from unittest.mock import patch

from app.models.schemas import HotelCandidateInfo, Location
from app.services.flyai_provider import FlyAIProviderError
from app.services.hotel_search_service import search_hotel_candidates


class HotelSearchServiceTest(unittest.TestCase):
    def test_prefers_flyai_priced_inventory(self):
        flyai = HotelCandidateInfo(
            id="flyai-1",
            name="广州真实酒店",
            address="广州市越秀区测试路1号",
            location=Location(longitude=113.26, latitude=23.13),
            source="flyai",
            starting_price=450,
            price_status="estimated",
        )
        with patch("app.services.hotel_search_service.FlyAIProvider.search_hotels", return_value=[flyai]), \
             patch("app.services.hotel_search_service._amap_candidates") as amap:
            result = search_hotel_candidates(
                "广州", "舒适型酒店", "2026-09-01", "2026-09-03"
            )
        self.assertEqual(result, [flyai])
        amap.assert_not_called()

    def test_falls_back_to_amap_identity_without_price(self):
        amap_hotel = HotelCandidateInfo(
            id="amap-1",
            name="高德真实酒店",
            address="广州市天河区测试路2号",
            location=Location(longitude=113.32, latitude=23.14),
            source="amap",
            price_status="unavailable",
        )
        with patch(
            "app.services.hotel_search_service.FlyAIProvider.search_hotels",
            side_effect=FlyAIProviderError("provider unavailable"),
        ), patch(
            "app.services.hotel_search_service._amap_candidates",
            return_value=[amap_hotel],
        ):
            result = search_hotel_candidates(
                "广州", "经济型酒店", "2026-09-01", "2026-09-03"
            )
        self.assertEqual(result[0].source, "amap")
        self.assertIsNone(result[0].starting_price)
        self.assertEqual(result[0].price_status, "unavailable")

    def test_enriches_missing_flyai_location_from_amap(self):
        flyai = HotelCandidateInfo(
            id="flyai-1",
            name="广州花园酒店",
            source="flyai",
            starting_price=618,
            price_status="estimated",
        )
        amap = HotelCandidateInfo(
            id="amap-1",
            name="广州花园酒店",
            address="广州市越秀区环市东路368号",
            location=Location(longitude=113.285, latitude=23.138),
            source="amap",
        )
        with patch("app.services.hotel_search_service.FlyAIProvider.search_hotels", return_value=[flyai]), \
             patch("app.services.hotel_search_service._amap_candidates", return_value=[amap]):
            result = search_hotel_candidates(
                "广州", "豪华型酒店", "2026-09-01", "2026-09-03"
            )
        self.assertEqual(result[0].source, "flyai")
        self.assertEqual(result[0].starting_price, 618)
        self.assertEqual(result[0].address, amap.address)
        self.assertEqual(result[0].location, amap.location)


if __name__ == "__main__":
    unittest.main()
