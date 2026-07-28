import asyncio
import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.api.routes import trip
from app.models.schemas import TripRequest
from app.services.trip_confirmation import clear_confirmation_ledger, register_confirm_decision


class TripConversationEndpointTest(unittest.TestCase):
    def setUp(self):
        clear_confirmation_ledger()
        trip._tasks.clear()
        self.request_data = {
            "city": "哈尔滨",
            "cities": [{"city": "哈尔滨", "days": 5}],
            "start_date": "2026-02-15",
            "end_date": "2026-02-19",
            "travel_days": 5,
            "transportation": "公共交通",
            "accommodation": "舒适型酒店",
            "preferences": ["自然风光"],
            "free_text_input": "春节看冰雪大世界",
            "origin_text": "春节去哈尔滨看冰雪大世界5天",
            "language": "zh-CN",
            "conversation": [
                {"role": "user", "content": "春节去哈尔滨看冰雪大世界5天"},
                {"role": "assistant", "content": "我先帮你整理一下。"},
                {"role": "user", "content": "好的"},
            ],
        }

    def tearDown(self):
        clear_confirmation_ledger()
        trip._tasks.clear()

    @contextmanager
    def isolated_dependencies(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            tasks_dir = Path(temp_dir) / "trip_tasks"
            tasks_dir.mkdir(parents=True, exist_ok=True)

            def close_planning_coroutine(coro):
                coro.close()
                return MagicMock()

            with patch.object(trip, "_TASKS_DATA_DIR", tasks_dir), \
                 patch.object(trip.asyncio, "create_task", side_effect=close_planning_coroutine):
                yield tasks_dir

    def test_plan_persists_the_full_creation_conversation(self):
        unsigned = TripRequest(**self.request_data)
        _, token = register_confirm_decision(unsigned, 0.95)
        request = TripRequest(**self.request_data, execution_token=token)

        with self.isolated_dependencies() as tasks_dir:
            result = asyncio.run(trip.plan_trip(request, x_user_id="user-1"))
            payload = json.loads(
                (tasks_dir.parent / "conversations" / f"{result['plan_id']}.json").read_text(encoding="utf-8")
            )

        self.assertEqual(payload["plan_id"], result["plan_id"])
        self.assertEqual(payload["user_id"], "user-1")
        self.assertEqual(payload["messages"], self.request_data["conversation"])

    def test_get_conversation_returns_saved_messages_for_the_plan(self):
        with self.isolated_dependencies() as tasks_dir:
            plan_id = "plan-123"
            trip._tasks[plan_id] = {
                **trip._create_task_state(plan_id),
                "user_id": "user-1",
            }
            conv_dir = tasks_dir.parent / "conversations"
            conv_dir.mkdir(parents=True, exist_ok=True)
            messages = [{"role": "user", "content": "你好"}]
            (conv_dir / f"{plan_id}.json").write_text(
                json.dumps({"plan_id": plan_id, "user_id": "user-1", "messages": messages}, ensure_ascii=False),
                encoding="utf-8",
            )

            result = asyncio.run(trip.get_plan_conversation(plan_id, x_user_id="user-1"))

        self.assertEqual(result, {"plan_id": plan_id, "messages": messages})

    def test_conversation_rejects_a_different_user(self):
        plan_id = "owned-conversation"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
        }

        with self.assertRaises(trip.HTTPException) as raised:
            asyncio.run(trip.get_plan_conversation(plan_id, x_user_id="other-user"))

        self.assertEqual(raised.exception.status_code, 403)

    def test_conversation_allows_an_authenticated_admin_to_read_an_owned_plan(self):
        plan_id = "admin-viewed-conversation"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
        }

        with self.isolated_dependencies() as tasks_dir:
            conv_dir = tasks_dir.parent / "conversations"
            conv_dir.mkdir(parents=True, exist_ok=True)
            messages = [{"role": "user", "content": "管理员可见"}]
            (conv_dir / f"{plan_id}.json").write_text(
                json.dumps({"plan_id": plan_id, "user_id": "owner-user", "messages": messages}, ensure_ascii=False),
                encoding="utf-8",
            )

            with patch("app.api.routes.admin.read_admin_password", return_value="admin-secret"):
                result = asyncio.run(
                    trip.get_plan_conversation(
                        plan_id,
                        x_user_id="",
                        x_admin_token="admin-secret",
                    )
                )

        self.assertEqual(result, {"plan_id": plan_id, "messages": messages})

    def test_conversation_keeps_legacy_unowned_tasks_readable(self):
        plan_id = "legacy-conversation"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "",
        }

        with self.isolated_dependencies():
            result = asyncio.run(trip.get_plan_conversation(plan_id, x_user_id="signed-in-user"))

        self.assertEqual(result, {"plan_id": plan_id, "messages": []})

    def test_task_owner_helper_rejects_other_users_and_allows_legacy_tasks(self):
        owned_task = {"user_id": "owner-user"}
        legacy_task = {"user_id": ""}

        with self.assertRaises(trip.HTTPException) as raised:
            trip._require_task_owner(owned_task, "other-user")

        self.assertEqual(raised.exception.status_code, 403)
        self.assertIsNone(trip._require_task_owner(owned_task, "owner-user"))
        self.assertIsNone(trip._require_task_owner(legacy_task, "signed-in-user"))

    def test_delete_rejects_a_different_user(self):
        plan_id = "owned-delete"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
        }

        with self.assertRaises(trip.HTTPException) as raised:
            asyncio.run(trip.delete_trip_plan(plan_id, x_user_id="other-user"))

        self.assertEqual(raised.exception.status_code, 403)
        self.assertIn(plan_id, trip._tasks)

    def test_status_rejects_a_different_user(self):
        plan_id = "owned-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "result": {"success": True, "data": {"city": "Secret City"}},
        }

        with self.assertRaises(trip.HTTPException) as raised:
            asyncio.run(trip.get_task_status(plan_id, x_user_id="other-user"))

        self.assertEqual(raised.exception.status_code, 403)

    def test_share_rejects_an_unpublished_task_id(self):
        plan_id = "shared-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "result": {"success": True, "data": {"city": "Shared City"}},
            "request_payload": {"free_text_input": "private prompt"},
        }

        with self.assertRaises(trip.HTTPException) as raised:
            asyncio.run(trip.get_shared_plan(plan_id))

        self.assertEqual(raised.exception.status_code, 404)

    def test_share_returns_only_a_completed_plan_for_its_share_token(self):
        plan_id = "shared-plan"
        share_token = "f" * 32
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "share_token": share_token,
            "result": {"success": True, "data": {"city": "Shared City"}},
            "request_payload": {"free_text_input": "private prompt"},
        }

        result = asyncio.run(trip.get_shared_plan(share_token))

        self.assertEqual(
            result,
            {
                "plan_id": plan_id,
                "status": "completed",
                "result": {"success": True, "data": {"city": "Shared City"}},
            },
        )

    def test_owner_can_create_share_token_for_a_completed_plan(self):
        plan_id = "owned-share-plan"
        share_token = "a" * 32
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "result": {"success": True, "data": {"city": "Shared City"}},
        }

        with self.isolated_dependencies(), patch.object(
            trip.secrets,
            "token_hex",
            return_value=share_token,
        ):
            result = asyncio.run(trip.create_shared_plan(plan_id, x_user_id="owner-user"))

        self.assertEqual(result, {"plan_id": plan_id, "share_code": share_token})
        self.assertEqual(trip._tasks[plan_id]["share_token"], share_token)

    def test_share_creation_rejects_a_different_user(self):
        plan_id = "private-share-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "result": {"success": True, "data": {"city": "Private City"}},
        }

        with self.assertRaises(trip.HTTPException) as raised:
            asyncio.run(trip.create_shared_plan(plan_id, x_user_id="other-user"))

        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(trip._tasks[plan_id]["share_token"], "")

    def test_share_creation_rejects_a_plan_that_is_not_completed(self):
        plan_id = "processing-share-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "processing",
        }

        with self.assertRaises(trip.HTTPException) as raised:
            asyncio.run(trip.create_shared_plan(plan_id, x_user_id="owner-user"))

        self.assertEqual(raised.exception.status_code, 409)

    def test_share_creation_reuses_the_persisted_token(self):
        plan_id = "published-plan"
        share_token = "b" * 32
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "share_token": share_token,
            "result": {"success": True, "data": {"city": "Published City"}},
        }

        with self.isolated_dependencies(), patch.object(
            trip.secrets,
            "token_hex",
            return_value="c" * 32,
        ):
            result = asyncio.run(trip.create_shared_plan(plan_id, x_user_id="owner-user"))

        self.assertEqual(result["share_code"], share_token)

    def test_share_token_survives_task_persistence(self):
        plan_id = "persisted-share-plan"
        share_token = "d" * 32
        task = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "share_token": share_token,
            "result": {"success": True, "data": {"city": "Persistent City"}},
        }

        with self.isolated_dependencies() as tasks_dir:
            trip._persist_task_state(plan_id, task)
            payload = json.loads((tasks_dir / f"{plan_id}.json").read_text(encoding="utf-8"))
            restored = trip._normalize_loaded_task(plan_id, payload)

        self.assertEqual(payload["share_token"], share_token)
        self.assertEqual(restored["share_token"], share_token)

    def test_share_rejects_a_plan_that_is_not_completed(self):
        plan_id = "processing-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "processing",
            "request_payload": {"free_text_input": "private prompt"},
        }

        with self.assertRaises(trip.HTTPException) as raised:
            asyncio.run(trip.get_shared_plan(plan_id))

        self.assertEqual(raised.exception.status_code, 404)

    def test_status_keeps_legacy_unowned_tasks_readable(self):
        plan_id = "legacy-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "",
            "status": "completed",
            "result": {"success": True, "data": {"city": "Legacy City"}},
        }

        result = asyncio.run(trip.get_task_status(plan_id, x_user_id="signed-in-user"))

        self.assertEqual(result["status"], "completed")

    def test_status_allows_an_authenticated_admin_to_read_an_owned_plan(self):
        plan_id = "admin-viewed-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "result": {"success": True, "data": {"city": "Admin City"}},
        }

        with patch("app.api.routes.admin.read_admin_password", return_value="admin-secret"):
            result = asyncio.run(
                trip.get_task_status(
                    plan_id,
                    x_user_id="",
                    x_admin_token="admin-secret",
                )
            )

        self.assertEqual(result["result"]["data"]["city"], "Admin City")

    def test_status_rejects_an_invalid_admin_token_for_an_owned_plan(self):
        plan_id = "admin-rejected-plan"
        trip._tasks[plan_id] = {
            **trip._create_task_state(plan_id),
            "user_id": "owner-user",
            "status": "completed",
            "result": {"success": True, "data": {"city": "Secret City"}},
        }

        with patch("app.api.routes.admin.read_admin_password", return_value="admin-secret"):
            with self.assertRaises(trip.HTTPException) as raised:
                asyncio.run(
                    trip.get_task_status(
                        plan_id,
                        x_user_id="",
                        x_admin_token="wrong-secret",
                    )
                )

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
