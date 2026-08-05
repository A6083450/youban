import asyncio
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routes import trip


class RetryTripPlanEndpointTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        trip._tasks.clear()
        self.task_id = "failed-1"
        self.request_payload = {
            "city": "成都",
            "cities": [{"city": "成都", "days": 3}],
            "start_date": "2026-08-10",
            "end_date": "2026-08-12",
            "travel_days": 3,
            "transportation": "公共交通",
            "accommodation": "舒适型酒店",
            "preferences": ["美食"],
            "execution_token": "already-consumed-token",
        }
        trip._tasks[self.task_id] = {
            **trip._create_task_state(self.task_id),
            "status": "failed",
            "stage": "failed",
            "progress": 100,
            "message": "旧错误",
            "details": [{"type": "error"}],
            "result": {"stale": True},
            "error": "旧错误",
            "user_id": "owner-1",
            "request_payload": self.request_payload,
            "checkpoint": {"segments": {"day:1": {"status": "completed"}}},
        }

    def tearDown(self):
        trip._tasks.clear()

    async def retry(self, restart_all=False, user_id="owner-1"):
        return await trip.retry_trip_plan(
            self.task_id,
            trip.TripRetryRequest(restart_all=restart_all),
            x_user_id=user_id,
        )

    async def test_reuses_task_and_clears_execution_token(self):
        original_checkpoint = trip._tasks[self.task_id]["checkpoint"]
        observed = []

        def persist(task_id, task):
            observed.append(("persist", task_id, task["status"]))

        def broadcast(task_id, event):
            observed.append(("broadcast", task_id, event["status"]))

        def start_task(task_id, request, user_id):
            observed.append(("start", task_id, trip._tasks[task_id]["status"]))

        with patch.object(trip, "consume_execution_token") as consume, \
             patch.object(trip, "_persist_task_state", side_effect=persist), \
             patch.object(trip, "_broadcast_task_event", side_effect=broadcast), \
             patch.object(trip, "_start_trip_planning_task", side_effect=start_task) as start:
            result = await self.retry()

        task = trip._tasks[self.task_id]
        self.assertEqual(result["task_id"], self.task_id)
        self.assertEqual(result["plan_id"], self.task_id)
        self.assertEqual(result["status"], "processing")
        self.assertEqual(result["ws_url"], f"/api/trip/ws/{self.task_id}")
        self.assertEqual(task["status"], "processing")
        self.assertEqual(task["stage"], "submitted")
        self.assertEqual(task["progress"], 5)
        self.assertEqual(task["details"], [])
        self.assertIsNone(task["result"])
        self.assertIsNone(task["error"])
        self.assertIs(task["checkpoint"], original_checkpoint)
        self.assertEqual(observed, [
            ("persist", self.task_id, "processing"),
            ("broadcast", self.task_id, "processing"),
            ("start", self.task_id, "processing"),
        ])
        consume.assert_not_called()
        start.assert_called_once()
        started_task_id, started_request, started_user_id = start.call_args.args
        self.assertEqual(started_task_id, self.task_id)
        self.assertEqual(started_request.execution_token, "")
        self.assertEqual(started_user_id, "owner-1")

    async def test_restart_all_clears_checkpoint(self):
        with patch.object(trip, "_persist_task_state"), \
             patch.object(trip, "_broadcast_task_event"), \
             patch.object(trip, "_start_trip_planning_task"):
            await self.retry(restart_all=True)

        self.assertEqual(trip._tasks[self.task_id]["checkpoint"], {})

    async def test_missing_is_404(self):
        trip._tasks.clear()
        with self.assertRaises(HTTPException) as raised:
            await self.retry()
        self.assertEqual(raised.exception.status_code, 404)

    async def test_non_owner_is_403(self):
        with self.assertRaises(HTTPException) as raised:
            await self.retry(user_id="other-user")
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(trip._tasks[self.task_id]["status"], "failed")

    async def test_non_failed_is_409(self):
        for status in ("processing", "completed"):
            with self.subTest(status=status):
                trip._tasks[self.task_id]["status"] = status
                with self.assertRaises(HTTPException) as raised:
                    await self.retry()
                self.assertEqual(raised.exception.status_code, 409)

    async def test_second_retry_while_processing_is_409(self):
        with patch.object(trip, "_persist_task_state"), \
             patch.object(trip, "_broadcast_task_event"), \
             patch.object(trip, "_start_trip_planning_task") as start:
            await self.retry()
            with self.assertRaises(HTTPException) as raised:
                await self.retry()

        self.assertEqual(raised.exception.status_code, 409)
        start.assert_called_once()

    async def test_concurrent_retries_only_start_once(self):
        barrier = threading.Barrier(2)
        started = []
        original_lock = trip._TASK_STATE_LOCK

        class BarrierLock:
            def __enter__(self):
                barrier.wait()
                original_lock.acquire()

            def __exit__(self, exc_type, exc, tb):
                original_lock.release()

        def invoke_retry():
            try:
                asyncio.run(self.retry())
                return 200
            except HTTPException as exc:
                return exc.status_code

        with patch.object(trip, "_TASK_STATE_LOCK", BarrierLock()), \
             patch.object(trip, "_persist_task_state"), \
             patch.object(trip, "_broadcast_task_event"), \
             patch.object(trip, "_start_trip_planning_task", side_effect=lambda *args: started.append(args)):
            with ThreadPoolExecutor(max_workers=2) as executor:
                statuses = list(executor.map(lambda _: invoke_retry(), range(2)))

        self.assertCountEqual(statuses, [200, 409])
        self.assertEqual(len(started), 1)

    async def test_create_task_failure_rolls_back_and_allows_retry(self):
        created_coroutines = []

        def fail_create_task(coro):
            created_coroutines.append(coro)
            raise RuntimeError("event loop closed")

        with patch.object(trip, "_persist_task_state") as persist, \
             patch.object(trip, "_broadcast_task_event") as broadcast, \
             patch.object(trip.asyncio, "create_task", side_effect=fail_create_task):
            with self.assertRaisesRegex(RuntimeError, "event loop closed"):
                await self.retry()

        task = trip._tasks[self.task_id]
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["stage"], "failed")
        self.assertEqual(task["progress"], 100)
        self.assertEqual(task["error"], "event loop closed")
        self.assertTrue(created_coroutines[0].cr_frame is None)
        self.assertEqual(persist.call_count, 2)
        self.assertEqual(broadcast.call_count, 2)

        with patch.object(trip, "_persist_task_state"), \
             patch.object(trip, "_broadcast_task_event"), \
             patch.object(trip, "_start_trip_planning_task") as start:
            result = await self.retry()
        self.assertEqual(result["status"], "processing")
        start.assert_called_once()

    async def test_first_submit_uses_shared_start_helper(self):
        request = trip.TripRequest(**self.request_payload)
        with tempfile.TemporaryDirectory() as temp_dir, \
             patch.object(trip, "_TASKS_DATA_DIR", Path(temp_dir) / "trip_tasks"), \
             patch.object(trip, "consume_execution_token", return_value=(True, "ok")), \
             patch.object(trip, "_persist_task_state"), \
             patch.object(trip, "_update_task_state"), \
             patch.object(trip, "_start_trip_planning_task") as start:
            result = await trip.plan_trip(request, x_user_id="owner-1")

        start.assert_called_once_with(result["task_id"], request, "owner-1")
