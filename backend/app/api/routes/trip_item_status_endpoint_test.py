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
        "result": {
            "success": True,
            "data": {
                "city": "北京",
                "start_date": "2026-08-01",
                "end_date": "2026-08-02",
                "overall_suggestions": "s",
                "days": [
                    {
                        "date": "2026-08-01",
                        "day_index": 0,
                        "description": "d",
                        "transportation": "公共交通",
                        "accommodation": "酒店",
                        "attractions": [
                            {
                                "id": "itm_aaaa0001",
                                "name": "故宫",
                                "address": "a",
                                "location": {"longitude": 116.39, "latitude": 39.91},
                                "visit_duration": 120,
                                "description": "x",
                                "ticket_price": 60,
                            }
                        ],
                        "meals": [{"id": "itm_bbbb0001", "type": "lunch", "name": "烤鸭"}],
                    }
                ],
            },
        },
    }


class ItemStatusEndpointTest(unittest.TestCase):
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

    def _patch(self, item_id, body, user="u1"):
        return self.client.patch(
            f"/api/trip/plan/t1/items/{item_id}/status",
            json=body,
            headers={"X-User-Id": user},
        )

    def test_done_with_cost(self):
        resp = self._patch("itm_aaaa0001", {"status": "done", "actual_cost": 55})
        self.assertEqual(resp.status_code, 200)
        entry = resp.json()["execution"]
        self.assertEqual(entry["status"], "done")
        self.assertEqual(entry["actual_cost"], 55)
        self.assertIn("updated_at", entry)

    def test_status_response_carries_execution(self):
        self._patch("itm_aaaa0001", {"status": "done"})
        resp = self.client.get("/api/trip/status/t1", headers={"X-User-Id": "u1"})
        self.assertEqual(resp.json()["execution"]["itm_aaaa0001"]["status"], "done")

    def test_pending_removes_entry(self):
        self._patch("itm_aaaa0001", {"status": "skipped"})
        resp = self._patch("itm_aaaa0001", {"status": "pending"})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()["execution"])
        status = self.client.get("/api/trip/status/t1", headers={"X-User-Id": "u1"})
        self.assertNotIn("itm_aaaa0001", status.json()["execution"])

    def test_non_owner_403(self):
        resp = self._patch("itm_aaaa0001", {"status": "done"}, user="intruder")
        self.assertEqual(resp.status_code, 403)

    def test_unknown_item_404(self):
        resp = self._patch("itm_missing0", {"status": "done"})
        self.assertEqual(resp.status_code, 404)

    def test_unknown_plan_404(self):
        resp = self.client.patch(
            "/api/trip/plan/ghost/items/itm_aaaa0001/status",
            json={"status": "done"},
            headers={"X-User-Id": "u1"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_processing_409(self):
        trip._tasks["t1"]["status"] = "processing"
        resp = self._patch("itm_aaaa0001", {"status": "done"})
        self.assertEqual(resp.status_code, 409)

    def test_invalid_status_422(self):
        resp = self._patch("itm_aaaa0001", {"status": "later"})
        self.assertEqual(resp.status_code, 422)

    def test_execution_survives_reload(self):
        self._patch("itm_bbbb0001", {"status": "postponed"})
        trip._tasks.clear()
        resp = self.client.get("/api/trip/status/t1", headers={"X-User-Id": "u1"})
        self.assertEqual(resp.json()["execution"]["itm_bbbb0001"]["status"], "postponed")


if __name__ == "__main__":
    unittest.main()
