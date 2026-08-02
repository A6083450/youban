import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.api.routes import trip
from app.api.routes.trip import _ensure_item_ids, _find_plan_item, _new_item_id
from app.models.schemas import TripPlanResponse


def _dict_result():
    return {
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
                            "name": "故宫",
                            "address": "a",
                            "location": {"longitude": 116.39, "latitude": 39.91},
                            "visit_duration": 120,
                            "description": "x",
                        }
                    ],
                    "meals": [{"type": "lunch", "name": "烤鸭"}],
                }
            ],
        },
    }


class EnsureItemIdsTest(unittest.TestCase):
    def test_new_item_id_format(self):
        item_id = _new_item_id()
        self.assertTrue(item_id.startswith("itm_"))
        self.assertEqual(len(item_id), 12)

    def test_inject_ids_into_dict_result(self):
        result = _dict_result()
        changed = _ensure_item_ids(result)
        self.assertTrue(changed)
        day = result["data"]["days"][0]
        self.assertTrue(day["attractions"][0]["id"].startswith("itm_"))
        self.assertTrue(day["meals"][0]["id"].startswith("itm_"))

    def test_idempotent(self):
        result = _dict_result()
        _ensure_item_ids(result)
        first = result["data"]["days"][0]["attractions"][0]["id"]
        self.assertFalse(_ensure_item_ids(result))
        self.assertEqual(result["data"]["days"][0]["attractions"][0]["id"], first)

    def test_inject_ids_into_model_result(self):
        model = TripPlanResponse(**_dict_result())
        self.assertTrue(_ensure_item_ids(model))
        self.assertTrue(model.data.days[0].attractions[0].id.startswith("itm_"))

    def test_none_and_empty(self):
        self.assertFalse(_ensure_item_ids(None))
        self.assertFalse(_ensure_item_ids({"success": True, "data": None}))

    def test_find_plan_item(self):
        result = _dict_result()
        _ensure_item_ids(result)
        meal_id = result["data"]["days"][0]["meals"][0]["id"]
        self.assertIsNotNone(_find_plan_item(result, meal_id))
        self.assertIsNone(_find_plan_item(result, "itm_00000000"))


class LoadPersistedTasksMigrationTest(unittest.TestCase):
    """启动预载路径的懒迁移落盘:旧任务首次预载即把 id 回写磁盘,跨重启稳定。"""

    def _write_legacy_task(self, tasks_dir: Path) -> Path:
        task_file = tasks_dir / "leg123.json"
        task_file.write_text(
            json.dumps(
                {
                    "task_id": "leg123",
                    "plan_id": "leg123",
                    "status": "completed",
                    "stage": "completed",
                    "progress": 100,
                    "message": "ok",
                    "result": _dict_result(),
                    "error": None,
                    "user_id": "",
                    "share_token": "",
                    "request_payload": None,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return task_file

    def test_preload_writes_ids_back_and_stable_across_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            tasks_dir = Path(tmp)
            task_file = self._write_legacy_task(tasks_dir)

            # 落盘前:磁盘上无 id
            before = json.loads(task_file.read_text(encoding="utf-8"))
            self.assertIsNone(
                before["result"]["data"]["days"][0]["attractions"][0].get("id")
            )

            with patch.object(trip, "_TASKS_DATA_DIR", tasks_dir), patch.object(
                trip, "_migrate_legacy_tasks_dir", lambda: None
            ):
                trip._tasks.clear()
                trip._load_persisted_tasks()  # 模拟服务启动预载
                mem_id = trip._tasks["leg123"]["result"]["data"]["days"][0]["attractions"][0]["id"]

                # 懒迁移已把 id 回写磁盘
                after = json.loads(task_file.read_text(encoding="utf-8"))
                disk_id = after["result"]["data"]["days"][0]["attractions"][0]["id"]
                self.assertTrue(disk_id.startswith("itm_"))
                self.assertEqual(disk_id, mem_id)

                # 模拟重启:再次预载,id 必须与首次一致(跨重启稳定,不再重新生成)
                trip._tasks.clear()
                trip._load_persisted_tasks()
                mem_id_after_restart = (
                    trip._tasks["leg123"]["result"]["data"]["days"][0]["attractions"][0]["id"]
                )
                self.assertEqual(mem_id_after_restart, disk_id)

            trip._tasks.pop("leg123", None)


if __name__ == "__main__":
    unittest.main()
