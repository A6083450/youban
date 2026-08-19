import json
import os
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.flyai_provider import (
    FlyAIProvider,
    FlyAIProviderError,
    clear_flyai_cache,
)


SETTINGS = SimpleNamespace(
    flyai_enabled=True,
    flyai_cli_path="",
    flyai_api_key="test-key",
    flyai_timeout_seconds=8,
    flyai_cache_ttl_seconds=0,
)
MANIFEST = {
    "version": "1.0.0-youban.1",
    "runtime": {"version": "1.0.16"},
    "policy": {"timeout_seconds_max": 15, "stdout_bytes_max": 2_097_152},
}


class FlyAIProviderTest(unittest.TestCase):
    def setUp(self):
        clear_flyai_cache()

    def _patch_runtime(self, completed):
        run_patch = (
            patch("app.services.flyai_provider.subprocess.run", side_effect=completed)
            if isinstance(completed, BaseException)
            else patch("app.services.flyai_provider.subprocess.run", return_value=completed)
        )
        return (
            patch("app.services.flyai_provider.get_settings", return_value=SETTINGS),
            patch("app.services.flyai_provider.require_allowed_command", return_value=MANIFEST),
            patch("app.services.flyai_provider._resolve_executable", return_value="/bin/flyai"),
            run_patch,
            patch("app.services.flyai_provider.append_tool_trace"),
        )

    def test_maps_structured_hotel_and_starting_price(self):
        payload = {
            "status": 0,
            "message": "success",
            "data": {"itemList": [{
                "shId": "hotel-1",
                "name": "广州测试酒店",
                "address": "广州测试路1号",
                "longitude": "113.2644",
                "latitude": "23.1291",
                "price": "¥618起",
                "score": "4.8",
                "star": "舒适型",
                "mainPic": "https://example.com/hotel.jpg",
                "detailUrl": "https://example.com/hotel-1",
            }]},
        }
        completed = subprocess.CompletedProcess([], 0, json.dumps(payload), "")
        patches = self._patch_runtime(completed)
        with patches[0], patches[1], patches[2], patches[3] as run, patches[4], \
             patch.dict(os.environ, {
                 "PATH": "/usr/bin",
                 "HOME": "/tmp/test-home",
                 "OPENAI_API_KEY": "must-not-leak",
                 "VITE_AMAP_WEB_KEY": "must-not-leak",
             }, clear=True):
            result = FlyAIProvider().search_hotels(
                "广州", "舒适型酒店", "2026-09-01", "2026-09-03"
            )

        self.assertEqual(len(result), 1)
        hotel = result[0]
        self.assertEqual(hotel.id, "hotel-1")
        self.assertEqual(hotel.source, "flyai")
        self.assertEqual(hotel.starting_price, 618)
        self.assertEqual(hotel.price_status, "estimated")
        self.assertAlmostEqual(hotel.location.longitude, 113.2644)
        command = run.call_args.args[0]
        self.assertEqual(command[:2], ["/bin/flyai", "search-hotel"])
        self.assertIn("--check-in-date", command)
        self.assertNotIn("test-key", command)
        environment = run.call_args.kwargs["env"]
        self.assertEqual(environment["FLYAI_API_KEY"], "test-key")
        self.assertNotIn("OPENAI_API_KEY", environment)
        self.assertNotIn("VITE_AMAP_WEB_KEY", environment)

    def test_maps_masked_prices_to_auditable_lower_bounds(self):
        payload = {
            "status": 0,
            "message": "success",
            "data": {"itemList": [
                {"shId": "hotel-3xx", "name": "三百档酒店", "price": "¥3xx"},
                {"shId": "hotel-6x", "name": "六十档酒店", "price": "¥6x起"},
                {"shId": "hotel-none", "name": "暂无报价酒店", "price": "暂无报价"},
            ]},
        }
        completed = subprocess.CompletedProcess([], 0, json.dumps(payload), "")
        patches = self._patch_runtime(completed)
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            result = FlyAIProvider().search_hotels(
                "广州", "经济型酒店", "2026-09-01", "2026-09-03"
            )

        self.assertEqual([hotel.starting_price for hotel in result], [300, 60, None])
        self.assertEqual(
            [hotel.price_status for hotel in result],
            ["estimated", "estimated", "unavailable"],
        )
        self.assertEqual([hotel.price_raw for hotel in result], ["¥3xx", "¥6x起", "暂无报价"])

    def test_rejects_malformed_json(self):
        completed = subprocess.CompletedProcess([], 0, "not-json", "")
        patches = self._patch_runtime(completed)
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with self.assertRaisesRegex(FlyAIProviderError, "合法 JSON"):
                FlyAIProvider().search_hotels(
                    "广州", "经济型酒店", "2026-09-01", "2026-09-03"
                )

    def test_wraps_timeout_as_provider_error(self):
        timeout = subprocess.TimeoutExpired(["flyai"], 8)
        patches = self._patch_runtime(timeout)
        with patches[0], patches[1], patches[2], patches[3], patches[4]:
            with self.assertRaisesRegex(FlyAIProviderError, "查询超时"):
                FlyAIProvider().search_hotels(
                    "广州", "经济型酒店", "2026-09-01", "2026-09-03"
                )

    def test_reports_missing_cli_without_running_a_shell(self):
        with patch("app.services.flyai_provider.get_settings", return_value=SETTINGS), \
             patch("app.services.flyai_provider.require_allowed_command", return_value=MANIFEST), \
             patch("app.services.flyai_provider._resolve_executable", side_effect=FlyAIProviderError("CLI 未安装")), \
             patch("app.services.flyai_provider.subprocess.run") as run, \
             patch("app.services.flyai_provider.append_tool_trace"):
            with self.assertRaisesRegex(FlyAIProviderError, "CLI 未安装"):
                FlyAIProvider().search_hotels(
                    "广州", "经济型酒店", "2026-09-01", "2026-09-03"
                )
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
