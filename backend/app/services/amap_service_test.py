import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.amap_service import AmapService, search_amap_attractions


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class AmapServiceTest(unittest.TestCase):
    @patch("app.services.llm_service.llm_complete")
    @patch("httpx.get")
    @patch("app.services.amap_service.get_settings")
    def test_attraction_research_preserves_trusted_poi_identity(
        self, settings, httpx_get, llm_complete
    ):
        settings.return_value = SimpleNamespace(vite_amap_web_key="test-web-key")
        httpx_get.return_value = _FakeResponse({
            "status": "1",
            "pois": [{
                "id": "B0MOGAO",
                "name": "莫高窟",
                "type": "风景名胜",
                "address": "甘肃省敦煌市",
                "location": "94.809000,40.041000",
            }],
        })
        llm_complete.return_value = """[{
            "name": "莫高窟",
            "name_zh": "莫高窟",
            "name_en": "Mogao Caves",
            "reason": "世界文化遗产",
            "duration": 240,
            "reservation_required": true,
            "reservation_tips": "提前预约"
        }]"""

        result = search_amap_attractions("敦煌", "历史文化")
        attraction = json.loads(result.splitlines()[-1])

        self.assertEqual(attraction["poi_id"], "B0MOGAO")
        self.assertEqual(attraction["address"], "甘肃省敦煌市")
        self.assertEqual(attraction["location"], {
            "longitude": 94.809,
            "latitude": 40.041,
        })
        extract_prompt = llm_complete.call_args.args[0]
        self.assertIn("最多 12 个", extract_prompt)
        self.assertIn("不要为了凑数重复景点", extract_prompt)

    @patch("app.services.amap_service.get_settings")
    @patch("app.services.amap_service.requests.get")
    def test_search_hotels_returns_only_valid_amap_pois(self, request_get, settings):
        settings.return_value = SimpleNamespace(vite_amap_web_key="test-web-key")
        request_get.return_value = _FakeResponse({
            "status": "1",
            "pois": [
                {
                    "id": "B000A1",
                    "name": "真实测试酒店",
                    "type": "住宿服务;宾馆酒店",
                    "address": "北京市测试路1号",
                    "location": "116.410000,39.910000",
                    "tel": "010-12345678",
                },
                {"id": "missing-location", "name": "无坐标酒店"},
            ],
        })

        result = AmapService().search_hotels("北京", "经济型酒店")

        self.assertEqual(1, len(result))
        self.assertEqual("B000A1", result[0].id)
        self.assertEqual("真实测试酒店", result[0].name)
        self.assertEqual(116.41, result[0].location.longitude)
        params = request_get.call_args.kwargs["params"]
        self.assertEqual("100000", params["types"])
        self.assertEqual("北京", params["region"])
        self.assertEqual("true", params["city_limit"])

    @patch("app.services.amap_service.get_settings")
    @patch("app.services.amap_service.requests.get")
    def test_search_poi_returns_empty_on_amap_api_error(self, request_get, settings):
        settings.return_value = SimpleNamespace(vite_amap_web_key="test-web-key")
        request_get.return_value = _FakeResponse({
            "status": "0",
            "info": "INVALID_USER_KEY",
            "infocode": "10001",
        })

        self.assertEqual([], AmapService().search_poi("酒店", "北京"))

    @patch("app.services.amap_service.get_settings")
    @patch("app.services.amap_service.requests.get")
    def test_search_poi_does_not_call_network_without_key(self, request_get, settings):
        settings.return_value = SimpleNamespace(vite_amap_web_key="")

        self.assertEqual([], AmapService().search_poi("酒店", "北京"))
        request_get.assert_not_called()


if __name__ == "__main__":
    unittest.main()
