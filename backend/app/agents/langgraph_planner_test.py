import asyncio
import json
import re
import unittest
from collections import Counter
from datetime import date, timedelta
from unittest.mock import patch

from app.agents.trip_plan_orchestrator import build_segments, empty_checkpoint
from app.models.schemas import TripRequest


def _request(days=6, language="zh"):
    start = date(2026, 8, 1)
    return TripRequest(
        city="北京",
        start_date=start.isoformat(),
        end_date=(start + timedelta(days=days - 1)).isoformat(),
        travel_days=days,
        transportation="公共交通",
        accommodation="经济型酒店",
        preferences=["历史文化"],
        language=language,
    )


def _day(day_index, city="北京"):
    return {
        "date": (date(2026, 8, 1) + timedelta(days=day_index)).isoformat(),
        "day_index": day_index,
        "city": city,
        "description": f"第{day_index + 1}天",
        "transportation": "公共交通",
        "accommodation": "经济型酒店",
        "hotel": {"name": "测试酒店", "estimated_cost": 300},
        "attractions": [{
            "name": f"景点{day_index + 1}",
            "address": "测试地址",
            "location": {"longitude": 116.397, "latitude": 39.916},
            "visit_duration": 120,
            "description": "景点描述",
            "ticket_price": 20,
        }],
        "meals": [{"type": "lunch", "name": "测试餐厅", "estimated_cost": 50}],
    }


class _FakeMessage:
    def __init__(self, content):
        self.content = content
        self.text = content


class _OrchestrationModel:
    def __init__(self, request, invalid_once=None, fail_summary=False,
                 fail_review=False, review_segment_ids=None, invalid_on_calls=None,
                 wrong_city_once=None, wrong_date_once=None):
        self._segments = {item["segment_id"]: item for item in build_segments(request)}
        self._invalid_once = set(invalid_once or [])
        self._fail_summary = fail_summary
        self._fail_review = fail_review
        self._review_segment_ids = list(review_segment_ids or [])
        self._invalid_on_calls = set(invalid_on_calls or [])
        self._wrong_city_once = set(wrong_city_once or [])
        self._wrong_date_once = set(wrong_date_once or [])
        self.segment_calls = []
        self.summary_calls = 0
        self.review_calls = 0
        self.active = 0
        self.peak = 0
        self.calls = []
        self.review_payloads = []

    async def ainvoke(self, messages, **kwargs):
        self.calls.append(messages)
        system = str(messages[0]["content"])
        user = str(messages[-1]["content"])
        if "只规划指定分段" in system:
            return await self._segment_reply(user)
        if "总体建议与旅行蓝图" in system:
            self.summary_calls += 1
            if self._fail_summary:
                raise RuntimeError("summary 故障")
            return _FakeMessage(json.dumps({
                "overall_suggestions": "按计划出行并留意天气变化",
                "blueprint": None,
            }, ensure_ascii=False))
        if "分段行程评审" in system:
            self.review_calls += 1
            self.review_payloads.append(json.loads(user))
            if self._fail_review:
                raise RuntimeError("review 故障")
            rejected = bool(self._review_segment_ids)
            return _FakeMessage(json.dumps({
                "approved": not rejected,
                "issues": ["节奏需要调整"] if rejected else [],
                "segment_ids": self._review_segment_ids,
            }, ensure_ascii=False))
        raise AssertionError(f"未知模型调用: {system[:80]}")

    async def _segment_reply(self, prompt):
        match = re.search(r"seg-\d{2}", prompt)
        if not match:
            raise AssertionError("segment prompt 缺少 segment_id")
        segment_id = match.group()
        self.segment_calls.append(segment_id)
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            await asyncio.sleep(0.01)
            if segment_id in self._invalid_once:
                self._invalid_once.remove(segment_id)
                return _FakeMessage("invalid json")
            if len(self.segment_calls) in self._invalid_on_calls:
                return _FakeMessage("invalid json")
            segment = self._segments[segment_id]
            days = [_day(index, segment["city"]) for index in segment["day_indices"]]
            if segment_id in self._wrong_city_once:
                self._wrong_city_once.remove(segment_id)
                days[0]["city"] = "上海"
            if segment_id in self._wrong_date_once:
                self._wrong_date_once.remove(segment_id)
                days[0]["date"] = "2026-08-31"
            payload = {"segment_id": segment_id, "days": days}
            return _FakeMessage(json.dumps(payload, ensure_ascii=False))
        finally:
            self.active -= 1


class _Runtime:
    def __init__(self, context=None):
        self.context = context or {}


class LangGraphPlannerTest(unittest.TestCase):
    def _run(self, request, model, checkpoint=None, checkpoint_callback=None,
             recall_text=""):
        from app.agents import trip_planner_agent as tpa

        events = []

        async def progress(stage, message, value, details=None):
            events.append((stage, value, details))

        with patch.object(tpa, "get_chat_model", return_value=model), \
             patch.object(tpa, "_fetch_attractions_text", return_value="故宫|天安门"), \
             patch.object(tpa, "_fetch_weather_text", return_value="[]"), \
             patch.object(tpa, "_fetch_hotels_text", return_value="如家酒店"), \
             patch.object(tpa, "_recall_memory", return_value=recall_text), \
             patch.object(tpa, "_remember_plan", return_value=None):
            planner = tpa.LangGraphTripPlanner()
            plan = asyncio.run(planner.plan_trip(
                request,
                progress_callback=progress,
                user_id="u1",
                checkpoint=checkpoint,
                checkpoint_callback=checkpoint_callback,
            ))
        return plan, events

    def test_completed_search_checkpoint_skips_all_research_agents(self):
        from app.agents import trip_planner_agent as tpa

        checkpoint = empty_checkpoint()
        checkpoint["search"]["attractions"]["北京"] = "cached"
        checkpoint["search"]["weather"]["北京"] = "cached"
        checkpoint["search"]["hotels"]["北京"] = "cached"
        state = {"request_data": _request(3).model_dump(mode="json"), "checkpoint": checkpoint}
        with patch.object(tpa, "_fetch_attractions_text", side_effect=AssertionError("不应搜索")), \
             patch.object(tpa, "_fetch_weather_text", side_effect=AssertionError("不应搜索")), \
             patch.object(tpa, "_fetch_hotels_text", side_effect=AssertionError("不应搜索")):
            result = asyncio.run(tpa.research_trip(state, _Runtime()))
        self.assertEqual(result["attractions"], {"北京": "cached"})
        self.assertEqual(result["weather"], {"北京": "cached"})
        self.assertEqual(result["hotels"], {"北京": "cached"})

    def test_segments_run_concurrently_and_merge_stably(self):
        request = _request(15)
        model = _OrchestrationModel(request)
        plan, _ = self._run(request, model)
        self.assertEqual(model.peak, 4)
        self.assertEqual(model.segment_calls, [f"seg-{index:02d}" for index in range(1, 6)])
        self.assertEqual([day.day_index for day in plan.days], list(range(15)))

    def test_segment_failure_saves_other_results_and_snapshots(self):
        request = _request(9)
        model = _OrchestrationModel(request, invalid_once={"seg-02"})
        snapshots = []

        async def save(checkpoint):
            json.dumps(checkpoint)
            snapshots.append(checkpoint)

        with self.assertRaisesRegex(RuntimeError, "seg-02"):
            self._run(request, model, checkpoint_callback=save)
        final = snapshots[-1]
        self.assertEqual(final["segments"]["seg-02"]["status"], "failed")
        self.assertEqual(final["segments"]["seg-01"]["status"], "completed")
        self.assertEqual(final["segments"]["seg-03"]["status"], "completed")
        completed_counts = [
            sum(item["status"] == "completed" for item in snap["segments"].values())
            for snap in snapshots
        ]
        self.assertLess(min(completed_counts), completed_counts[-1])

    def test_resume_only_runs_failed_segment(self):
        request = _request(9)
        first_model = _OrchestrationModel(request, invalid_once={"seg-02"})
        snapshots = []

        async def save(checkpoint):
            snapshots.append(checkpoint)

        with self.assertRaises(RuntimeError):
            self._run(request, first_model, checkpoint_callback=save)
        resumed_model = _OrchestrationModel(request)
        plan, _ = self._run(request, resumed_model, checkpoint=snapshots[-1])
        self.assertEqual(resumed_model.segment_calls, ["seg-02"])
        self.assertEqual([day.day_index for day in plan.days], list(range(9)))

    def test_generated_segment_with_wrong_city_is_failed(self):
        request = _request(3)
        model = _OrchestrationModel(request, wrong_city_once={"seg-01"})
        snapshots = []

        async def save(checkpoint):
            snapshots.append(checkpoint)

        with self.assertRaisesRegex(RuntimeError, "seg-01"):
            self._run(request, model, checkpoint_callback=save)
        self.assertEqual(snapshots[-1]["segments"]["seg-01"]["status"], "failed")

    def test_completed_segment_with_wrong_date_is_regenerated(self):
        request = _request(3)
        segment = build_segments(request)[0]
        checkpoint = empty_checkpoint()
        days = [_day(index) for index in segment["day_indices"]]
        days[0]["date"] = "2026-08-31"
        checkpoint["segments"]["seg-01"] = {
            "day_indices": segment["day_indices"], "status": "completed",
            "output": days, "attempts": 1, "error": "",
        }
        model = _OrchestrationModel(request)
        plan, _ = self._run(request, model, checkpoint=checkpoint)
        self.assertEqual(model.segment_calls, ["seg-01"])
        self.assertEqual(plan.days[0].date, "2026-08-01")

    def test_memory_context_is_injected_into_segment_prompt(self):
        request = _request(3)
        model = _OrchestrationModel(request)
        self._run(request, model, recall_text="用户喜欢自然风光")
        self.assertIn("用户喜欢自然风光", str(model.calls[0]))

    def test_english_request_prompts_and_fallback_use_english(self):
        request = _request(3, language="en")
        model = _OrchestrationModel(request, fail_summary=True)
        plan, _ = self._run(request, model)
        segment_call = next(call for call in model.calls if "只规划指定分段" in str(call[0]["content"]))
        summary_call = next(call for call in model.calls if "总体建议与旅行蓝图" in str(call[0]["content"]))
        self.assertIn("English", str(segment_call))
        self.assertIn("English", str(summary_call))
        self.assertIn("This trip covers 北京 (3 days)", plan.overall_suggestions)
        self.assertNotIn("天", plan.overall_suggestions)

    def test_japanese_request_prompts_and_fallback_use_japanese(self):
        request = _request(3, language="ja")
        model = _OrchestrationModel(request, fail_summary=True)
        plan, _ = self._run(request, model)
        self.assertTrue(any("Japanese" in str(call) for call in model.calls))
        self.assertIn("この旅行は北京3日間", plan.overall_suggestions)
        self.assertNotIn("天", plan.overall_suggestions)

    def test_summary_failure_uses_deterministic_fallback(self):
        request = _request(3)
        model = _OrchestrationModel(request, fail_summary=True)
        snapshots = []

        async def save(checkpoint):
            snapshots.append(checkpoint)

        plan, _ = self._run(request, model, checkpoint_callback=save)
        self.assertTrue(plan.overall_suggestions)
        self.assertIsNone(plan.blueprint)
        self.assertEqual(snapshots[-1]["summary"]["status"], "failed")

    def test_review_failure_still_yields_plan(self):
        request = _request(3)
        model = _OrchestrationModel(request, fail_review=True)
        snapshots = []

        async def save(checkpoint):
            snapshots.append(checkpoint)

        plan, _ = self._run(request, model, checkpoint_callback=save)
        self.assertEqual(plan.city, "北京")
        self.assertEqual(snapshots[-1]["review"]["status"], "failed")

    def test_review_prompt_contains_segment_mapping(self):
        request = _request(6)
        model = _OrchestrationModel(request)
        self._run(request, model)
        self.assertEqual(model.review_payloads[0]["segments"], [
            {"segment_id": "seg-01", "day_indices": [0, 1, 2], "city": "北京"},
            {"segment_id": "seg-02", "day_indices": [3, 4, 5], "city": "北京"},
        ])
        self.assertIn("plan", model.review_payloads[0])

    def test_review_revises_only_selected_segment_once(self):
        request = _request(6)
        model = _OrchestrationModel(request, review_segment_ids=["seg-02"])
        plan, _ = self._run(request, model)
        self.assertEqual(Counter(model.segment_calls), Counter({"seg-01": 1, "seg-02": 2}))
        self.assertEqual(model.review_calls, 1)
        self.assertEqual(model.summary_calls, 2)
        self.assertEqual([day.day_index for day in plan.days], list(range(6)))

    def test_resume_after_failed_revision_does_not_review_again(self):
        request = _request(6)
        first_model = _OrchestrationModel(
            request,
            review_segment_ids=["seg-02"],
            invalid_on_calls={3},
        )
        snapshots = []

        async def save(checkpoint):
            snapshots.append(checkpoint)

        with self.assertRaisesRegex(RuntimeError, "seg-02"):
            self._run(request, first_model, checkpoint_callback=save)
        self.assertEqual(first_model.review_calls, 1)

        resumed_model = _OrchestrationModel(request, review_segment_ids=["seg-02"])
        plan, _ = self._run(request, resumed_model, checkpoint=snapshots[-1])
        self.assertEqual(resumed_model.segment_calls, ["seg-02"])
        self.assertEqual(resumed_model.review_calls, 0)
        self.assertEqual([day.day_index for day in plan.days], list(range(6)))

    def test_completed_summary_and_review_checkpoint_are_reused(self):
        request = _request(3)
        first_model = _OrchestrationModel(request)
        snapshots = []

        async def save(checkpoint):
            snapshots.append(checkpoint)

        first_plan, _ = self._run(request, first_model, checkpoint_callback=save)
        resumed_model = _OrchestrationModel(request, fail_summary=True, fail_review=True)
        resumed_plan, _ = self._run(request, resumed_model, checkpoint=snapshots[-1])
        self.assertEqual(resumed_model.segment_calls, [])
        self.assertEqual(resumed_model.summary_calls, 0)
        self.assertEqual(resumed_model.review_calls, 0)
        self.assertEqual(resumed_plan.model_dump(), first_plan.model_dump())

    def test_regenerated_segment_invalidates_completed_summary_and_review(self):
        request = _request(3)
        checkpoint = empty_checkpoint()
        segment = build_segments(request)[0]
        checkpoint["segments"]["seg-01"] = {
            "day_indices": segment["day_indices"], "status": "completed",
            "output": [], "attempts": 1, "error": "",
        }
        checkpoint["summary"].update(status="completed", output={
            "overall_suggestions": "旧行程建议", "blueprint": None,
        }, error="")
        checkpoint["review"].update(status="completed", output={
            "approved": True, "issues": [], "segment_ids": [],
        }, error="")
        model = _OrchestrationModel(request)
        plan, _ = self._run(request, model, checkpoint=checkpoint)
        self.assertEqual(model.segment_calls, ["seg-01"])
        self.assertEqual(model.summary_calls, 1)
        self.assertEqual(model.review_calls, 1)
        self.assertNotEqual(plan.overall_suggestions, "旧行程建议")

    def test_invalid_completed_summary_and_review_are_regenerated(self):
        request = _request(3)
        checkpoint = empty_checkpoint()
        segment = build_segments(request)[0]
        checkpoint["segments"]["seg-01"] = {
            "day_indices": segment["day_indices"],
            "status": "completed",
            "output": [_day(index) for index in segment["day_indices"]],
            "attempts": 1,
            "error": "",
        }
        checkpoint["summary"].update(status="completed", output={}, error="")
        checkpoint["review"].update(status="completed", output={}, error="")
        model = _OrchestrationModel(request)
        plan, _ = self._run(request, model, checkpoint=checkpoint)
        self.assertTrue(plan.overall_suggestions)
        self.assertEqual(model.summary_calls, 1)
        self.assertEqual(model.review_calls, 1)

    def test_multiple_segment_revision_progress_never_decreases(self):
        request = _request(9)
        model = _OrchestrationModel(request, review_segment_ids=["seg-01", "seg-02"])
        _, events = self._run(request, model)
        progress = [value for _stage, value, _details in events]
        self.assertEqual(progress, sorted(progress))

    def test_future_returned_by_checkpoint_callback_is_awaited(self):
        request = _request(3)
        model = _OrchestrationModel(request)

        def fail(_checkpoint):
            future = asyncio.get_running_loop().create_future()
            future.set_exception(RuntimeError("Future checkpoint 写入失败"))
            return future

        with self.assertRaisesRegex(RuntimeError, "Future checkpoint 写入失败"):
            self._run(request, model, checkpoint_callback=fail)

    def test_generic_checkpoint_callback_failure_is_not_retried(self):
        request = _request(3)
        model = _OrchestrationModel(request)
        checkpoint = empty_checkpoint()
        for kind in ("attractions", "weather", "hotels"):
            checkpoint["search"][kind]["北京"] = "cached"
        calls = 0

        def fail_once(_checkpoint):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise Exception("generic checkpoint failure")

        with self.assertRaisesRegex(RuntimeError, "generic checkpoint failure"):
            self._run(request, model, checkpoint=checkpoint, checkpoint_callback=fail_once)
        self.assertEqual(calls, 1)
        self.assertEqual(model.segment_calls, [])

    def test_checkpoint_callback_failure_propagates(self):
        request = _request(3)
        model = _OrchestrationModel(request)

        async def fail(_checkpoint):
            raise RuntimeError("checkpoint 写入失败")

        with self.assertRaisesRegex(RuntimeError, "checkpoint 写入失败"):
            self._run(request, model, checkpoint_callback=fail)


if __name__ == "__main__":
    unittest.main()
