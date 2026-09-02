import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import trip
from app.api.routes.trip_budget_items_endpoint_test import _completed_task
from app.models.schemas import Location, POIInfo


class TripAttractionsEndpointTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        patcher = patch.object(trip, "_TASKS_DATA_DIR", Path(self._tmp.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        trip._tasks.clear()
        self.addCleanup(trip._tasks.clear)
        trip._tasks["t1"] = _completed_task()

        self.poi = POIInfo(
            id="B0NEWPOI",
            name="广州塔",
            type="风景名胜;风景名胜相关;旅游景点",
            address="广州市海珠区阅江西路222号",
            location=Location(longitude=113.3307, latitude=23.1135),
        )
        service = Mock()
        service.search_poi.return_value = [self.poi]
        service_patcher = patch.object(trip, "get_amap_service", return_value=service)
        service_patcher.start()
        self.addCleanup(service_patcher.stop)
        self.service = service

        app = FastAPI()
        app.include_router(trip.router, prefix="/api")
        self.client = TestClient(app)
        self.headers = {"X-User-Id": "u1"}

        plan = trip._tasks["t1"]["result"]["data"]
        plan["blueprint"] = {
            "title": "广州两日游",
            "stages": [
                {"day_indices": [0], "highlights": ["陈家祠"]},
                {"day_indices": [1], "highlights": []},
            ],
        }

    def payload(self, **overrides):
        value = {
            "day_index": 1,
            "poi_id": self.poi.id,
            "name": self.poi.name,
            "address": self.poi.address,
            "location": self.poi.location.model_dump(),
            "visit_duration": 120,
            "description": "登塔俯瞰城市",
            "ticket_price": 20,
            "start_time": "16:30",
            "reservation_required": False,
            "reservation_tips": "",
        }
        value.update(overrides)
        return value

    def post(self, payload=None):
        return self.client.post(
            "/api/trip/plan/t1/attractions",
            json=payload or self.payload(),
            headers=self.headers,
        )

    def test_create_real_poi_updates_plan_and_budget_together(self):
        response = self.post()

        self.assertEqual(response.status_code, 200)
        body = response.json()
        created = body["plan"]["days"][1]["attractions"][0]
        self.assertTrue(created["id"].startswith("itm_"))
        self.assertEqual(created["poi_id"], self.poi.id)
        self.assertEqual(created["name"], self.poi.name)
        self.assertEqual(created["end_time"], "18:30")
        ledger = next(item for item in body["items"] if item["linked_item_id"] == created["id"])
        self.assertEqual(ledger["day_index"], 1)
        self.assertEqual(ledger["per_person_amount"], 20)
        self.assertEqual(ledger["entity_source"], "amap")
        self.assertEqual(body["totals"]["total_attractions"], 80)
        self.assertEqual(
            body["plan"]["blueprint"]["stages"][1]["highlights"],
            ["广州塔"],
        )

    def test_update_moves_attraction_and_rebuilds_ticket_row(self):
        original = trip._tasks["t1"]["result"]["data"]["days"][0]["attractions"][0]
        original.update({
            "poi_id": "B0CHEN",
            "name": "陈家祠",
            "address": "中山七路恩龙里34号",
            "location": {"longitude": 113.245, "latitude": 23.129},
            "visit_duration": 90,
            "description": "岭南建筑",
        })
        response = self.client.put(
            "/api/trip/plan/t1/attractions/itm_attr0001",
            json=self.payload(
                poi_id="B0CHEN",
                name="陈家祠",
                address=original["address"],
                location=original["location"],
                ticket_price=25,
                start_time="10:00",
                visit_duration=90,
            ),
            headers=self.headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["plan"]["days"][0]["attractions"], [])
        moved = body["plan"]["days"][1]["attractions"][0]
        self.assertEqual((moved["id"], moved["start_time"], moved["end_time"]), (
            "itm_attr0001", "10:00", "11:30",
        ))
        ledger = next(item for item in body["items"] if item["linked_item_id"] == "itm_attr0001")
        self.assertEqual((ledger["day_index"], ledger["per_person_amount"]), (1, 25))
        self.assertEqual(body["plan"]["blueprint"]["stages"][0]["highlights"], [])
        self.assertEqual(
            body["plan"]["blueprint"]["stages"][1]["highlights"],
            ["陈家祠"],
        )

    def test_delete_removes_attraction_execution_and_budget_row(self):
        task = trip._tasks["t1"]
        task["execution"] = {"itm_attr0001": {"status": "done"}}
        response = self.client.delete(
            "/api/trip/plan/t1/attractions/itm_attr0001",
            headers=self.headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["plan"]["days"][0]["attractions"], [])
        self.assertFalse(any(item["linked_item_id"] == "itm_attr0001" for item in body["items"]))
        self.assertEqual(body["totals"]["total_attractions"], 0)
        self.assertNotIn("itm_attr0001", task["execution"])
        self.assertEqual(body["plan"]["blueprint"]["stages"][0]["highlights"], [])

    def test_allows_same_poi_on_different_days_but_rejects_same_day_duplicate(self):
        trip._tasks["t1"]["result"]["data"]["days"][0]["attractions"][0]["poi_id"] = self.poi.id

        first_visit_on_day_two = self.post()
        self.assertEqual(first_visit_on_day_two.status_code, 200)
        repeated_on_same_day = self.post()
        self.assertEqual(repeated_on_same_day.status_code, 409)
        self.assertEqual(repeated_on_same_day.json()["detail"], "该景点已经在所选日期中")

    def test_rejects_unverified_poi(self):

        self.service.search_poi.return_value = []
        unverified = self.post(self.payload(poi_id="NOT-AMAP"))
        self.assertEqual(unverified.status_code, 422)

    def test_rejects_invalid_time_and_non_owner(self):
        invalid = self.post(self.payload(start_time="25:00"))
        self.assertEqual(invalid.status_code, 422)
        forbidden = self.client.post(
            "/api/trip/plan/t1/attractions",
            json=self.payload(),
            headers={"X-User-Id": "other"},
        )
        self.assertEqual(forbidden.status_code, 403)


if __name__ == "__main__":
    unittest.main()
