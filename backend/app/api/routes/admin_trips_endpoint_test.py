import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


def _task_payload(task_id, user_id, city):
    return {
        "task_id": task_id,
        "status": "completed",
        "user_id": user_id,
        "request_payload": {
            "city": city,
            "cities": [{"city": city, "days": 3}],
            "start_date": "2026-08-01",
            "end_date": "2026-08-03",
            "travel_days": 3,
        },
        "result": {"data": {"city": city, "days": []}},
    }


class AdminTripsEndpointTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tasks_dir = Path(self._tmp.name) / "trip_tasks"
        tasks_dir.mkdir(parents=True)
        for tid, uid, city in (
            ("t-alice", "u-alice", "北京"),
            ("t-bob", "u-bob", "杭州"),
            ("t-legacy", "", "西安"),
        ):
            (tasks_dir / f"{tid}.json").write_text(
                json.dumps(_task_payload(tid, uid, city), ensure_ascii=False),
                encoding="utf-8",
            )

        from app.api.routes import admin, trip

        patchers = [
            patch.object(trip, "_TASKS_DATA_DIR", tasks_dir),
            patch.object(admin, "read_admin_password", return_value="pw123"),
            patch(
                "app.services.user_service.list_users",
                return_value=[
                    {"user_id": "u-alice", "nickname": "小艾"},
                    {"user_id": "u-bob", "nickname": "Bob"},
                ],
            ),
        ]
        for p in patchers:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self._tmp.cleanup)

        from fastapi import FastAPI
        app = FastAPI()
        app.include_router(admin.router, prefix="/api")
        self.client = TestClient(app)

    def test_requires_admin_token(self):
        resp = self.client.get("/api/admin/trips")
        self.assertEqual(resp.status_code, 401)

    def test_returns_all_users_trips_with_nicknames(self):
        resp = self.client.get("/api/admin/trips", headers={"X-Admin-Token": "pw123"})
        self.assertEqual(resp.status_code, 200)
        items = resp.json()["items"]
        self.assertEqual(len(items), 3)
        by_task = {it["task_id"]: it for it in items}
        self.assertEqual(by_task["t-alice"]["nickname"], "小艾")
        self.assertEqual(by_task["t-bob"]["nickname"], "Bob")
        self.assertEqual(by_task["t-legacy"]["nickname"], "")
        self.assertEqual(by_task["t-alice"]["city"], "北京")


if __name__ == "__main__":
    unittest.main()
