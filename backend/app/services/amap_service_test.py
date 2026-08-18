import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.amap_service import AmapService


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class AmapServiceTest(unittest.TestCase):
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
