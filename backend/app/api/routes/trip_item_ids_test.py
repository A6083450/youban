import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from app.api.routes import trip
from app.api.routes.trip import _ensure_item_ids, _find_plan_item, _new_item_id
from app.models.schemas import TripPlan, TripPlanResponse


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


def _checkpoint():
    return {
        "version": 1,
        "search": {
            "attractions": {"北京": ["完整搜索正文"]},
            "weather": {"北京": {"forecast": "晴"}},
            "hotels": {},
        },
        "segments": {
            "seg-01": {
                "day_indices": [0],
                "status": "completed",
                "output": [{"description": "完整分段正文"}],
                "attempts": 1,
                "error": "",
            },
            "seg-02": {
                "day_indices": [1],
                "status": "pending",
                "output": [],
                "attempts": 0,
                "error": "",
            },
        },
        "summary": {"status": "completed", "output": "完整总结正文", "error": ""},
        "review": {"status": "pending", "output": None, "error": ""},
    }


class TaskCheckpointPersistenceTest(unittest.TestCase):
    def tearDown(self):
        trip._tasks.clear()

    def test_new_task_has_empty_checkpoint(self):
        self.assertEqual(trip._create_task_state("new123")["checkpoint"], {})

    def test_checkpoint_round_trips_through_task_json(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            trip, "_TASKS_DATA_DIR", Path(tmp)
        ):
            task = trip._create_task_state("chk123")
            task.update(status="failed", checkpoint=_checkpoint())
            trip._persist_task_state("chk123", task)
            trip._tasks.clear()

            loaded = trip._load_task_from_disk("chk123")

            self.assertEqual(loaded["checkpoint"], _checkpoint())

    def test_restart_marks_processing_failed_without_losing_checkpoint(self):
        checkpoint = _checkpoint()
        loaded = trip._normalize_loaded_task(
            "chk123",
            {
                "status": "processing",
                "stage": "segments",
                "checkpoint": checkpoint,
            },
        )

        self.assertEqual(loaded["status"], "failed")
        self.assertEqual(loaded["checkpoint"], checkpoint)

    def test_task_event_exposes_summary_but_not_full_checkpoint(self):
        task = trip._create_task_state("chk123")
        task.update(status="failed", checkpoint=_checkpoint())

        event = trip._build_task_event("chk123", task)

        self.assertNotIn("checkpoint", event)
        self.assertEqual(
            event["checkpoint_summary"],
            {
                "completed_segments": 1,
                "total_segments": 2,
                "last_successful_stage": "summary",
            },
        )
        serialized = json.dumps(event, ensure_ascii=False)
        self.assertNotIn("完整搜索正文", serialized)
        self.assertNotIn("完整分段正文", serialized)
        self.assertNotIn("完整总结正文", serialized)

    def test_failed_status_exposes_summary_but_not_full_checkpoint(self):
        task = trip._create_task_state("chk123")
        task.update(status="failed", checkpoint=_checkpoint())
        trip._tasks["chk123"] = task

        response = asyncio.run(trip.get_task_status("chk123"))

        self.assertNotIn("checkpoint", response)
        self.assertEqual(response["checkpoint_summary"]["completed_segments"], 1)

    def test_regular_state_update_broadcasts_when_persistence_fails(self):
        task = trip._create_task_state("chk123")
        queue = asyncio.Queue()
        task["subscribers"].append(queue)
        trip._tasks["chk123"] = task

        with tempfile.TemporaryDirectory() as tmp, patch.object(
            trip, "_TASKS_DATA_DIR", Path(tmp)
        ), patch.object(Path, "replace", side_effect=OSError("disk full")):
            asyncio.run(
                trip._update_task_state(
                    "chk123", stage="segments", progress=50, message="处理中"
                )
            )

        event = queue.get_nowait()
        self.assertEqual(event["stage"], "segments")
        self.assertEqual(event["progress"], 50)

    def test_checkpoint_persistence_failure_reaches_callback(self):
        previous = {"old": True}
        task = trip._create_task_state("chk123")
        task["checkpoint"] = previous
        trip._tasks["chk123"] = task

        with tempfile.TemporaryDirectory() as tmp, patch.object(
            trip, "_TASKS_DATA_DIR", Path(tmp)
        ), patch.object(Path, "replace", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                trip._save_task_checkpoint("chk123", _checkpoint())

        self.assertIs(task["checkpoint"], previous)

    def test_checkpoint_callback_rejects_missing_task(self):
        with self.assertRaisesRegex(RuntimeError, "任务不存在"):
            trip._save_task_checkpoint("missing", _checkpoint())

    def test_run_planning_passes_saved_checkpoint_and_callback(self):
        checkpoint = _checkpoint()
        task = trip._create_task_state("chk123")
        task["checkpoint"] = checkpoint
        trip._tasks["chk123"] = task
        request = object()
        agent = Mock()
        plan = TripPlan(
            city="北京",
            cities=["北京"],
            start_date="2026-08-01",
            end_date="2026-08-01",
            days=[],
            overall_suggestions="",
        )
        agent.plan_trip = AsyncMock(return_value=plan)

        with patch.object(trip, "get_trip_planner_agent", return_value=agent), patch.object(
            trip, "_update_task_state", new=AsyncMock()
        ):
            asyncio.run(trip._run_trip_planning("chk123", request, "user-1"))

        kwargs = agent.plan_trip.await_args.kwargs
        self.assertIs(kwargs["checkpoint"], checkpoint)
        self.assertTrue(callable(kwargs["checkpoint_callback"]))


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
