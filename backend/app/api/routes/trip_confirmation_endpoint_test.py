import asyncio
import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.api.routes import trip
from app.models.schemas import TripRequest
from app.services.trip_confirmation import clear_confirmation_ledger, register_confirm_decision


class FakeResponse:
    def __init__(self, content):
        self.output_text = content


class FakeResponses:
    def __init__(self, content):
        self.content = content

    def create(self, **_kwargs):
        return FakeResponse(self.content)


class FakeClient:
    def __init__(self, content):
        self.responses = FakeResponses(content)


FAKE_LLM_SETTINGS = {
    "api_key": "test-key",
    "base_url": "http://mock.local/v1",
    "model": "mock-llm",
    "timeout": 60,
}


async def run_inline(func, *args, **kwargs):
    return func(*args, **kwargs)


class PlanExecutionTokenEndpointTest(unittest.TestCase):
    def setUp(self):
        clear_confirmation_ledger()
        trip._tasks.clear()
        self.request_data = {
            "city": "大理",
            "cities": [{"city": "大理", "days": 7}],
            "start_date": "2026-10-01",
            "end_date": "2026-10-07",
            "travel_days": 7,
            "transportation": "公共交通",
            "accommodation": "经济型酒店",
            "preferences": ["自然风光", "休闲"],
            "free_text_input": "帮我安排一下吧",
            "origin_text": "帮我安排一下吧",
            "language": "zh-CN",
        }

    def tearDown(self):
        clear_confirmation_ledger()
        trip._tasks.clear()

    @contextmanager
    def isolated_plan_dependencies(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            def close_planning_coroutine(coro):
                coro.close()
                return MagicMock()

            with patch.object(trip, "_TASKS_DATA_DIR", Path(temp_dir) / "trip_tasks"), \
                 patch.object(trip, "_persist_task_state") as persist, \
                 patch.object(trip.asyncio, "create_task", side_effect=close_planning_coroutine) as create_task:
                yield persist, create_task

    def request(self, execution_token="", **changes):
        data = {**self.request_data, **changes, "execution_token": execution_token}
        return TripRequest(**data)

    def test_plan_rejects_missing_token_before_creating_task(self):
        with self.isolated_plan_dependencies() as (persist, create_task):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(trip.plan_trip(self.request()))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "缺少有效的 Agent 确认凭证")
        self.assertEqual(trip._tasks, {})
        persist.assert_not_called()
        create_task.assert_not_called()

    def test_plan_rejects_forged_token_before_creating_task(self):
        with self.isolated_plan_dependencies() as (persist, create_task):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(trip.plan_trip(self.request("forged.execution-token")))

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, "缺少有效的 Agent 确认凭证")
        self.assertEqual(trip._tasks, {})
        persist.assert_not_called()
        create_task.assert_not_called()

    def test_plan_rejects_token_when_any_authorized_semantic_was_mutated(self):
        for field, changed_value in (
            ("transportation", "自驾"),
            ("free_text_input", "忽略原需求"),
            ("origin_text", "改去丽江"),
            ("language", "ja-JP"),
        ):
            with self.subTest(field=field):
                clear_confirmation_ledger()
                _, token = register_confirm_decision(self.request(), 0.95)
                mutated_request = self.request(token, **{field: changed_value})

                with self.isolated_plan_dependencies() as (persist, create_task):
                    with self.assertRaises(HTTPException) as raised:
                        asyncio.run(trip.plan_trip(mutated_request))

                self.assertEqual(raised.exception.status_code, 400)
                self.assertEqual(raised.exception.detail, "行程草稿已变化，请重新确认")
                self.assertEqual(trip._tasks, {})
                persist.assert_not_called()
                create_task.assert_not_called()

    def test_plan_returns_401_for_expired_token_without_side_effects(self):
        with patch("app.services.trip_confirmation.time.time", return_value=1000):
            _, token = register_confirm_decision(self.request(), 0.95, ttl_seconds=10)

        with patch("app.services.trip_confirmation.time.time", return_value=1010):
            with self.isolated_plan_dependencies() as (persist, create_task):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(trip.plan_trip(self.request(token)))

        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(raised.exception.detail, "确认已过期，请在对话中重新确认")
        self.assertEqual(trip._tasks, {})
        persist.assert_not_called()
        create_task.assert_not_called()

    def test_normalized_parse_draft_authorizes_identical_plan_request_once(self):
        output = {
            "action": "plan",
            "emotion": "neutral",
            "reply": "我整理了一份草稿。",
            "cities": [{"city": "大理", "days": 7}],
            "start_date": "2026-10-01",
            "end_date": "2026-10-05",
            "transportation": "公共交通",
            "accommodation": "经济型酒店",
            "preferences": ["自然风光", "休闲"],
            "ready_to_generate": True,
        }
        payload = trip.TripParseRequest(
            text="帮我安排一下吧",
            language="zh-CN",
            today="2026-07-26",
            history=[],
        )
        with patch("app.services.llm_service.get_openai_client", return_value=FakeClient(json.dumps(output, ensure_ascii=False))), \
             patch("app.services.llm_service.get_llm_settings", return_value=FAKE_LLM_SETTINGS), \
             patch.object(trip.asyncio, "to_thread", new=run_inline):
            parsed = asyncio.run(trip.parse_trip_text(payload))

        normalized_draft = {**parsed["trip"], "language": "zh-CN"}
        self.assertEqual(normalized_draft["end_date"], "2026-10-07")
        _, token = register_confirm_decision(normalized_draft, 0.95)
        request = TripRequest(**normalized_draft, execution_token=token)

        with self.isolated_plan_dependencies() as (persist, create_task):
            result = asyncio.run(trip.plan_trip(request))

        self.assertEqual(result["status"], "processing")
        self.assertEqual(len(trip._tasks), 1)
        self.assertIn(result["task_id"], trip._tasks)
        self.assertEqual(persist.call_count, 2)
        create_task.assert_called_once()

    def test_plan_accepts_valid_token_once(self):
        request = self.request()
        _, token = register_confirm_decision(request, 0.95)

        with self.isolated_plan_dependencies() as (persist, create_task):
            result = asyncio.run(trip.plan_trip(self.request(token)))

        self.assertEqual(result["status"], "processing")
        self.assertEqual(len(trip._tasks), 1)
        self.assertIn(result["task_id"], trip._tasks)
        persist.assert_called()
        create_task.assert_called_once()

    def test_plan_rejects_second_use_of_same_token_without_new_task(self):
        request = self.request()
        _, token = register_confirm_decision(request, 0.95)

        with self.isolated_plan_dependencies() as (persist, create_task):
            first_result = asyncio.run(trip.plan_trip(self.request(token)))
            task_count = len(trip._tasks)
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(trip.plan_trip(self.request(token)))

        self.assertEqual(first_result["status"], "processing")
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail, "该确认已执行，请勿重复提交")
        self.assertEqual(len(trip._tasks), task_count)
        self.assertEqual(task_count, 1)
        persist.assert_called()
        create_task.assert_called_once()


class TripConfirmationEndpointTest(unittest.TestCase):
    def setUp(self):
        self.draft = {
            "city": "大理",
            "cities": [{"city": "大理", "days": 7}],
            "start_date": "2026-10-01",
            "end_date": "2026-10-07",
            "travel_days": 7,
            "transportation": "公共交通",
            "accommodation": "经济型酒店",
            "preferences": ["自然风光", "休闲"],
            "free_text_input": "帮我安排一下吧",
            "origin_text": "帮我安排一下吧",
            "language": "zh-CN",
        }

    def reply(self, output, text="继续", history=None):
        return self.reply_content(json.dumps(output, ensure_ascii=False), text, history)

    def reply_content(self, content, text="继续", history=None):
        payload = trip.TripConfirmReplyRequest(
            text=text,
            draft=self.draft,
            language="zh-CN",
            today="2026-07-26",
            history=history or [],
        )
        with patch("app.services.llm_service.get_openai_client", return_value=FakeClient(content)), \
             patch("app.services.llm_service.get_llm_settings", return_value=FAKE_LLM_SETTINGS), \
             patch.object(trip.asyncio, "to_thread", new=run_inline), \
             patch.object(
                 trip,
                 "register_confirm_decision",
                 return_value=("decision-123", "execution-token-123"),
                 create=True,
             ) as register:
            result = asyncio.run(trip.confirm_trip_reply(payload))
        return result, register

    def test_high_confidence_confirm_signs_decision(self):
        result, register = self.reply({
            "action": "confirm",
            "confidence": 0.94,
            "message": "我会按当前草稿开始生成。",
            **self.draft,
        }, text="照这个执行", history=[
            {"role": "assistant", "content": "要按这份草稿开始生成计划吗？"},
        ])

        self.assertEqual(result["action"], "confirm")
        self.assertEqual(result["confidence"], 0.94)
        self.assertEqual(result["decision_id"], "decision-123")
        self.assertEqual(result["execution_token"], "execution-token-123")
        register.assert_called_once_with({**result["trip"], "language": "zh-CN"}, 0.94)

    def test_confirm_uses_current_draft_for_response_and_authorization(self):
        result, register = self.reply({
            "action": "confirm",
            "confidence": 0.94,
            "message": "开始生成丽江豪华自驾行程。",
            "cities": [{"city": "丽江", "days": 3}],
            "start_date": "2026-11-01",
            "end_date": "2026-11-03",
            "transportation": "自驾",
            "accommodation": "豪华酒店",
            "preferences": ["购物"],
            "free_text_input": "嗯",
            "origin_text": "嗯",
        }, text="嗯")

        self.assertEqual(result["trip"], self.draft)
        register.assert_called_once_with({**self.draft, "language": "zh-CN"}, 0.94)

    def test_low_confidence_confirm_downgrades_to_ask_confirmation(self):
        result, register = self.reply({
            "action": "confirm",
            "confidence": 0.70,
            "message": "",
            **self.draft,
        }, text="嗯")

        self.assertEqual(result["action"], "ask_confirmation")
        self.assertEqual(result["confidence"], 0.70)
        self.assertTrue(result["message"])
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_non_number_confidence_fails_closed(self):
        for confidence in (True, False, "0.94", None, [0.94]):
            with self.subTest(confidence=confidence):
                result, register = self.reply({
                    "action": "confirm",
                    "confidence": confidence,
                    "message": "开始生成。",
                    **self.draft,
                }, text="照这个执行")

                self.assertEqual(result["action"], "ask_confirmation")
                self.assertEqual(result["confidence"], 0.0)
                self.assertEqual(result["trip"], self.draft)
                self.assertEqual(result["decision_id"], "")
                self.assertEqual(result["execution_token"], "")
                register.assert_not_called()

    def test_chat_preserves_draft_and_never_signs(self):
        result, register = self.reply({
            "action": "chat",
            "confidence": -2,
            "message": "十月的大理早晚温差会比较明显。",
        }, text="十月天气怎么样？")

        self.assertEqual(result["action"], "chat")
        self.assertEqual(result["confidence"], 0.0)
        self.assertEqual(result["trip"], self.draft)
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_update_returns_full_trip_without_signing(self):
        result, register = self.reply({
            "action": "update",
            "confidence": 1.8,
            "message": "已改成大理和丽江共 7 天。",
            "cities": [{"city": "大理", "days": 4}, {"city": "丽江", "days": 3}],
            "start_date": "2026-10-02",
            "end_date": "2026-10-08",
            "transportation": "自驾",
            "accommodation": "舒适型酒店",
            "preferences": ["自然风光", "美食"],
            "inferred_fields": [],
            "suggestions": [],
        }, text="加上丽江，改成自驾")

        self.assertEqual(result["action"], "update")
        self.assertEqual(result["confidence"], 1.0)
        self.assertEqual(result["trip"]["city"], "大理")
        self.assertEqual(result["trip"]["cities"], [
            {"city": "大理", "days": 4},
            {"city": "丽江", "days": 3},
        ])
        self.assertEqual(result["trip"]["travel_days"], 7)
        self.assertEqual(result["trip"]["transportation"], "自驾")
        self.assertNotIn("confirmation_token", result["trip"])
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_update_recalculates_end_date_when_new_duration_omits_it(self):
        result, register = self.reply({
            "action": "update",
            "confidence": 0.4,
            "message": "已改成 10 天。",
            "cities": [{"city": "大理", "days": 10}],
            "start_date": "2026-10-01",
            "transportation": "公共交通",
            "accommodation": "经济型酒店",
            "preferences": ["自然风光", "休闲"],
            "inferred_fields": [],
            "suggestions": [],
        }, text="改成十天")

        self.assertEqual(result["trip"]["travel_days"], 10)
        self.assertEqual(result["trip"]["end_date"], "2026-10-10")
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_update_explicit_empty_lists_clear_existing_values(self):
        draft = {
            **self.draft,
            "inferred_fields": ["preferences"],
            "suggestions": ["保留慢节奏"],
        }
        payload = trip.TripConfirmReplyRequest(
            text="清空偏好",
            draft=draft,
            language="zh-CN",
            today="2026-07-26",
            history=[],
        )
        output = {
            "action": "update",
            "confidence": 0.6,
            "message": "已清空。",
            "preferences": [],
            "inferred_fields": [],
            "suggestions": [],
        }
        with patch("app.services.llm_service.get_openai_client", return_value=FakeClient(json.dumps(output, ensure_ascii=False))), \
             patch("app.services.llm_service.get_llm_settings", return_value=FAKE_LLM_SETTINGS), \
             patch.object(trip.asyncio, "to_thread", new=run_inline):
            result = asyncio.run(trip.confirm_trip_reply(payload))

        self.assertEqual(result["trip"]["preferences"], [])
        self.assertEqual(result["trip"]["inferred_fields"], [])
        self.assertEqual(result["trip"]["suggestions"], [])

    def test_update_invalid_list_types_safely_fall_back_to_existing_values(self):
        draft = {
            **self.draft,
            "inferred_fields": ["preferences"],
            "suggestions": ["保留慢节奏"],
        }
        payload = trip.TripConfirmReplyRequest(
            text="调整一下",
            draft=draft,
            language="zh-CN",
            today="2026-07-26",
            history=[],
        )
        output = {
            "action": "update",
            "confidence": 0.6,
            "message": "已调整。",
            "preferences": "美食",
            "inferred_fields": {"preferences": True},
            "suggestions": "保留慢节奏",
        }
        with patch("app.services.llm_service.get_openai_client", return_value=FakeClient(json.dumps(output, ensure_ascii=False))), \
             patch("app.services.llm_service.get_llm_settings", return_value=FAKE_LLM_SETTINGS), \
             patch.object(trip.asyncio, "to_thread", new=run_inline):
            result = asyncio.run(trip.confirm_trip_reply(payload))

        self.assertEqual(result["trip"]["preferences"], self.draft["preferences"])
        self.assertEqual(result["trip"]["inferred_fields"], ["preferences"])
        self.assertEqual(result["trip"]["suggestions"], ["保留慢节奏"])

    def test_japanese_fallback_is_natural_japanese(self):
        payload = trip.TripConfirmReplyRequest(
            text="続けて",
            draft=self.draft,
            language="ja-JP",
            today="2026-07-26",
            history=[],
        )
        with patch("app.services.llm_service.get_openai_client", return_value=FakeClient("not-json")), \
             patch("app.services.llm_service.get_llm_settings", return_value=FAKE_LLM_SETTINGS), \
             patch.object(trip.asyncio, "to_thread", new=run_inline):
            result = asyncio.run(trip.confirm_trip_reply(payload))

        self.assertEqual(result["action"], "ask_confirmation")
        self.assertEqual(result["message"], "現在の下書きで旅行プランの作成を開始しますか？")

    def test_cancel_preserves_draft_and_never_signs(self):
        result, register = self.reply({
            "action": "cancel",
            "confidence": 0.1,
            "message": "可以，先保留这份草稿。",
        }, text="暂时不生成")

        self.assertEqual(result["action"], "cancel")
        self.assertEqual(result["trip"], self.draft)
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_model_ask_confirmation_never_signs(self):
        result, register = self.reply({
            "action": "ask_confirmation",
            "confidence": 0.82,
            "message": "你希望我现在按这份草稿开始生成吗？",
        }, text="继续")

        self.assertEqual(result["action"], "ask_confirmation")
        self.assertEqual(result["trip"], self.draft)
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_llm_json_error_asks_confirmation_without_signing(self):
        result, register = self.reply_content("not-json", text="继续")

        self.assertEqual(result["action"], "ask_confirmation")
        self.assertTrue(result["message"])
        self.assertEqual(result["trip"], self.draft)
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_llm_non_object_json_asks_confirmation_without_signing(self):
        for content in ("[]", "null"):
            with self.subTest(content=content):
                result, register = self.reply_content(content, text="继续")

                self.assertEqual(result["action"], "ask_confirmation")
                self.assertTrue(result["message"])
                self.assertEqual(result["trip"], self.draft)
                self.assertEqual(result["decision_id"], "")
                self.assertEqual(result["execution_token"], "")
                register.assert_not_called()

    def test_contextual_confirmation_scenario_matrix(self):
        scenarios = [
            {
                "name": "pending short acknowledgment after explicit confirmation request",
                "text": "嗯",
                "history": [
                    {"role": "assistant", "content": "要按这份草稿开始生成计划吗？"},
                ],
                "output": {
                    "action": "confirm",
                    "confidence": 0.92,
                    "message": "好，我现在按这份草稿开始生成。",
                    **self.draft,
                },
                "expected_action": "confirm",
                "expected_confidence": 0.92,
                "expected_days": 7,
                "signs": True,
            },
            {
                "name": "pending short acknowledgment with neutral history",
                "text": "嗯",
                "history": [
                    {"role": "assistant", "content": "十月的大理早晚温差会比较明显。"},
                ],
                "output": {
                    "action": "ask_confirmation",
                    "confidence": 0.55,
                    "message": "你希望我现在按这份草稿开始生成吗？",
                },
                "expected_action": "ask_confirmation",
                "expected_confidence": 0.55,
                "expected_days": 7,
                "signs": False,
            },
            {
                "name": "pending questioning acknowledgment",
                "text": "嗯？",
                "history": [
                    {"role": "assistant", "content": "要按这份草稿开始生成计划吗？"},
                ],
                "output": {
                    "action": "ask_confirmation",
                    "confidence": 0.31,
                    "message": "你是想再了解一下，还是按当前草稿开始生成？",
                },
                "expected_action": "ask_confirmation",
                "expected_confidence": 0.31,
                "expected_days": 7,
                "signs": False,
            },
            {
                "name": "pending destination question",
                "text": "有什么玩",
                "history": [
                    {"role": "assistant", "content": "要按这份草稿开始生成计划吗？"},
                ],
                "output": {
                    "action": "chat",
                    "confidence": 0.08,
                    "message": "大理可以逛古城、环洱海，也可以去苍山。",
                },
                "expected_action": "chat",
                "expected_confidence": 0.08,
                "expected_days": 7,
                "signs": False,
            },
            {
                "name": "pending duration update",
                "text": "改成5天",
                "history": [
                    {"role": "assistant", "content": "要按这份草稿开始生成计划吗？"},
                ],
                "output": {
                    "action": "update",
                    "confidence": 0.96,
                    "message": "已改成 5 天，请确认新的草稿。",
                    "cities": [{"city": "大理", "days": 5}],
                    "start_date": "2026-10-01",
                    "transportation": "公共交通",
                    "accommodation": "经济型酒店",
                    "preferences": ["自然风光", "休闲"],
                    "inferred_fields": [],
                    "suggestions": [],
                },
                "expected_action": "update",
                "expected_confidence": 0.96,
                "expected_days": 5,
                "signs": False,
            },
        ]

        for scenario in scenarios:
            with self.subTest(scenario=scenario["name"]):
                result, register = self.reply(
                    scenario["output"],
                    text=scenario["text"],
                    history=scenario["history"],
                )

                self.assertEqual(result["action"], scenario["expected_action"])
                self.assertEqual(result["confidence"], scenario["expected_confidence"])
                self.assertEqual(result["trip"]["travel_days"], scenario["expected_days"])
                if scenario["signs"]:
                    self.assertEqual(result["decision_id"], "decision-123")
                    self.assertEqual(result["execution_token"], "execution-token-123")
                    register.assert_called_once_with({**result["trip"], "language": "zh-CN"}, 0.92)
                else:
                    self.assertEqual(result["decision_id"], "")
                    self.assertEqual(result["execution_token"], "")
                    register.assert_not_called()

    def test_non_finite_confirm_confidence_fails_closed(self):
        for confidence in (float("inf"), float("nan"), float("-inf")):
            with self.subTest(confidence=confidence):
                result, register = self.reply({
                    "action": "confirm",
                    "confidence": confidence,
                    "message": "开始生成。",
                    **self.draft,
                }, text="照这个执行")

                self.assertEqual(result["action"], "ask_confirmation")
                self.assertEqual(result["confidence"], 0.0)
                self.assertEqual(result["message"], "你是想按当前这份草稿开始生成计划吗？")
                self.assertEqual(result["trip"], self.draft)
                self.assertEqual(result["decision_id"], "")
                self.assertEqual(result["execution_token"], "")
                register.assert_not_called()

    def test_invalid_action_fails_closed_to_ask_confirmation(self):
        result, register = self.reply({
            "action": "not-a-real-action",
            "confidence": 0.99,
            "message": "开始生成。",
        }, text="继续")

        self.assertEqual(result["action"], "ask_confirmation")
        self.assertEqual(result["confidence"], 0.99)
        self.assertEqual(result["message"], "你是想按当前这份草稿开始生成计划吗？")
        self.assertEqual(result["trip"], self.draft)
        self.assertEqual(result["decision_id"], "")
        self.assertEqual(result["execution_token"], "")
        register.assert_not_called()

    def test_parse_normalizes_conflicting_valid_end_date(self):
        output = {
            "action": "plan",
            "emotion": "neutral",
            "reply": "我整理了一份草稿。",
            "cities": [{"city": "大理", "days": 7}],
            "start_date": "2026-10-01",
            "end_date": "2026-10-05",
        }
        payload = trip.TripParseRequest(
            text="规划大理七天",
            language="zh-CN",
            today="2026-07-26",
            history=[],
        )
        with patch("app.services.llm_service.get_openai_client", return_value=FakeClient(json.dumps(output, ensure_ascii=False))), \
             patch("app.services.llm_service.get_llm_settings", return_value=FAKE_LLM_SETTINGS), \
             patch.object(trip.asyncio, "to_thread", new=run_inline):
            result = asyncio.run(trip.parse_trip_text(payload))

        self.assertEqual(result["trip"]["travel_days"], 7)
        self.assertEqual(result["trip"]["end_date"], "2026-10-07")

    def test_parse_route_never_signs(self):
        output = {
            "action": "plan",
            "emotion": "neutral",
            "reply": "我整理了一份草稿。",
            "follow_up_question": "",
            "cities": [{"city": "大理", "days": 7}],
            "start_date": "2026-10-01",
            "end_date": "2026-10-07",
            "transportation": "公共交通",
            "accommodation": "经济型酒店",
            "preferences": ["自然风光"],
            "need_clarify": False,
            "clarify_question": "",
            "summary": "大理七日游",
            "ready_to_generate": True,
            "suggestions": [],
            "inferred_fields": [],
            "recommendations": [],
        }
        payload = trip.TripParseRequest(
            text="规划大理七天",
            language="zh-CN",
            today="2026-07-26",
            history=[],
        )
        with patch("app.services.llm_service.get_openai_client", return_value=FakeClient(json.dumps(output, ensure_ascii=False))), \
             patch("app.services.llm_service.get_llm_settings", return_value=FAKE_LLM_SETTINGS), \
             patch.object(trip.asyncio, "to_thread", new=run_inline), \
             patch.object(trip, "register_confirm_decision") as register:
            result = asyncio.run(trip.parse_trip_text(payload))

        self.assertNotIn("decision_id", result)
        self.assertNotIn("execution_token", result)
        self.assertNotIn("confirmation_token", result["trip"])
        register.assert_not_called()


if __name__ == "__main__":
    unittest.main()
