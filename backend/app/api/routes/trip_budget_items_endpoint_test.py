import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import trip


def _completed_task(user_id="u1"):
    return {
        "plan_id": "t1",
        "status": "completed",
        "stage": "completed",
        "progress": 100,
        "message": "",
        "user_id": user_id,
        "share_token": "",
        "subscribers": [],
        "budget_items": None,
        "result": {
            "success": True,
            "data": {
                "city": "广州",
                "start_date": "2026-08-18",
                "end_date": "2026-08-19",
                "overall_suggestions": "s",
                "budget": {
                    "total_attractions": 60,
                    "total_hotels": 0,
                    "total_meals": 10,
                    "total_transportation": 0,
                    "total": 70,
                },
                "days": [
                    {
                        "date": "2026-08-18",
                        "day_index": 0,
                        "description": "d1",
                        "transportation": "地铁",
                        "accommodation": "经济型酒店",
                        "hotel": {
                            "name": "高德酒店",
                            "estimated_cost": 0,
                            "source": "amap",
                            "source_hotel_id": "amap-1",
                            "price_status": "unavailable",
                        },
                        "attractions": [{
                            "id": "itm_attr0001",
                            "name": "陈家祠",
                            "ticket_price": 60,
                        }],
                        "meals": [{
                            "id": "itm_meal0001",
                            "type": "lunch",
                            "name": "早茶",
                            "estimated_cost": 10,
                        }],
                    },
                    {
                        "date": "2026-08-19",
                        "day_index": 1,
                        "description": "d2",
                        "transportation": "公交",
                        "accommodation": "无需住宿",
                        "hotel": None,
                        "attractions": [],
                        "meals": [],
                    },
                ],
            },
        },
    }


class BudgetItemsEndpointTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        patcher = patch.object(trip, "_TASKS_DATA_DIR", Path(self._tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        trip._tasks.clear()
        self.addCleanup(trip._tasks.clear)
        trip._tasks["t1"] = _completed_task()

        app = FastAPI()
        app.include_router(trip.router, prefix="/api")
        self.client = TestClient(app)
        self.headers = {"X-User-Id": "u1"}

    def _get(self):
        return self.client.get("/api/trip/plan/t1/budget-items", headers=self.headers)

    def test_get_derives_all_rows_and_keeps_unpriced_hotel(self):
        response = self._get()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        hotel = next(item for item in body["items"] if item["type"] == "hotel")
        self.assertIsNone(hotel["amount"])
        self.assertEqual(hotel["entity_source"], "amap")
        self.assertEqual(body["totals"]["total"], 70)
        self.assertEqual(body["pending_count"], 3)

    def test_edit_hotel_price_updates_totals_and_survives_reload(self):
        hotel = next(item for item in self._get().json()["items"] if item["type"] == "hotel")
        response = self.client.patch(
            f"/api/trip/plan/t1/budget-items/{hotel['id']}",
            json={"name": "用户选择的酒店", "amount": 320, "day_index": 0},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200)
        changed = next(item for item in response.json()["items"] if item["id"] == hotel["id"])
        self.assertEqual(changed["price_source"], "user")
        self.assertTrue(changed["user_locked"])
        self.assertEqual(response.json()["totals"]["total_hotels"], 320)

        trip._tasks.clear()
        reloaded = self._get()
        persisted = next(item for item in reloaded.json()["items"] if item["id"] == hotel["id"])
        self.assertEqual(persisted["name"], "用户选择的酒店")
        self.assertEqual(persisted["amount"], 320)

    def test_create_update_delete_and_restore_diy_item(self):
        created = self.client.post(
            "/api/trip/plan/t1/budget-items",
            json={"type": "other", "day_index": None, "name": "伴手礼", "amount": 125.5},
            headers=self.headers,
        )
        self.assertEqual(created.status_code, 200)
        item = next(item for item in created.json()["items"] if item["origin"] == "user")
        self.assertEqual(created.json()["totals"]["total_other"], 125.5)

        updated = self.client.patch(
            f"/api/trip/plan/t1/budget-items/{item['id']}",
            json={"type": "transport", "day_index": 1, "name": "返程打车", "amount": 88},
            headers=self.headers,
        )
        current = next(entry for entry in updated.json()["items"] if entry["id"] == item["id"])
        self.assertEqual((current["type"], current["day_index"], current["name"]), ("transport", 1, "返程打车"))

        deleted = self.client.delete(
            f"/api/trip/plan/t1/budget-items/{item['id']}",
            headers=self.headers,
        )
        self.assertTrue(next(entry for entry in deleted.json()["items"] if entry["id"] == item["id"])["deleted"])

        restored = self.client.patch(
            f"/api/trip/plan/t1/budget-items/{item['id']}",
            json={"deleted": False},
            headers=self.headers,
        )
        self.assertFalse(next(entry for entry in restored.json()["items"] if entry["id"] == item["id"])["deleted"])

    def test_user_override_is_not_replaced_by_later_itinerary_sync(self):
        attraction = next(item for item in self._get().json()["items"] if item["type"] == "attraction")
        self.client.patch(
            f"/api/trip/plan/t1/budget-items/{attraction['id']}",
            json={"name": "我的陈家祠安排", "amount": 35},
            headers=self.headers,
        )
        trip._tasks["t1"]["result"]["data"]["days"][0]["attractions"][0]["name"] = "Agent 新名称"
        current = next(item for item in self._get().json()["items"] if item["id"] == attraction["id"])
        self.assertEqual(current["name"], "我的陈家祠安排")
        self.assertEqual(current["amount"], 35)

    def test_rejects_invalid_day_and_non_owner(self):
        bad_day = self.client.post(
            "/api/trip/plan/t1/budget-items",
            json={"type": "other", "day_index": 9, "name": "错误条目"},
            headers=self.headers,
        )
        self.assertEqual(bad_day.status_code, 422)
        forbidden = self.client.get(
            "/api/trip/plan/t1/budget-items",
            headers={"X-User-Id": "intruder"},
        )
        self.assertEqual(forbidden.status_code, 403)


if __name__ == "__main__":
    unittest.main()
