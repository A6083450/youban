import unittest

from app.api.routes.trip import _build_history_item


def _payload(user_id):
    return {
        "status": "completed",
        "user_id": user_id,
        "request_payload": {
            "city": "北京",
            "cities": [{"city": "北京", "days": 3}],
            "start_date": "2026-08-01",
            "end_date": "2026-08-03",
            "travel_days": 3,
        },
        "result": {"data": {"city": "北京", "days": []}},
    }


class HistoryFilterTest(unittest.TestCase):
    def test_item_carries_user_id(self):
        item = _build_history_item("t1", _payload("u123"), "2026-07-26T00:00:00")
        self.assertEqual(item["user_id"], "u123")

    def test_item_legacy_task_user_id_empty(self):
        payload = _payload("")
        payload.pop("user_id")
        item = _build_history_item("t2", payload, "2026-07-26T00:00:00")
        self.assertEqual(item["user_id"], "")


if __name__ == "__main__":
    unittest.main()
