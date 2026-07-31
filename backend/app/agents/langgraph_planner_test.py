import asyncio
import json
import unittest
from unittest.mock import patch

from app.models.schemas import TripRequest

REQUEST = TripRequest(
    city="北京", start_date="2026-08-01", end_date="2026-08-03",
    travel_days=3, transportation="公共交通", accommodation="经济型酒店",
    preferences=["历史文化"],
)

PLAN_JSON = json.dumps({
    "city": "北京", "start_date": "2026-08-01", "end_date": "2026-08-03",
    "days": [{
        "date": "2026-08-01", "day_index": 0, "description": "第1天",
        "transportation": "公共交通", "accommodation": "经济型酒店",
        "attractions": [{"name": "故宫", "address": "东城区",
                         "location": {"longitude": 116.397, "latitude": 39.916},
                         "visit_duration": 120, "description": "宫殿", "category": "历史"}],
        "meals": [{"type": "breakfast", "name": "早餐", "description": "豆浆"}],
    }],
    "weather_info": [], "overall_suggestions": "祝旅途愉快",
}, ensure_ascii=False)


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChatModel:
    def __init__(self, replies, fail_at=None):
        self._replies = list(replies)
        self.calls = []
        self._fail_at = fail_at  # 第 N 次调用(0 起)抛异常,模拟评审者故障

    async def ainvoke(self, messages, **kwargs):
        if self._fail_at is not None and len(self.calls) == self._fail_at:
            self.calls.append(messages)
            raise RuntimeError("LLM 故障")
        self.calls.append(messages)
        return _FakeMessage(self._replies.pop(0))


APPROVED = json.dumps({"approved": True, "issues": []}, ensure_ascii=False)
REJECTED = json.dumps({"approved": False, "issues": ["第1天节奏太紧,景点时间重叠"]}, ensure_ascii=False)


class LangGraphPlannerTest(unittest.TestCase):
    def _run(self, fake_model, recall_text=""):
        from app.agents import trip_planner_agent as tpa

        events = []

        async def cb(stage, message, progress, details=None):
            events.append((stage, progress))

        with patch.object(tpa, "get_chat_model", return_value=fake_model), \
             patch.object(tpa, "_fetch_attractions_text", return_value="故宫|天安门"), \
             patch.object(tpa, "_fetch_weather_text", return_value="晴 25°C"), \
             patch.object(tpa, "_fetch_hotels_text", return_value="如家酒店"), \
             patch.object(tpa, "_recall_memory", return_value=recall_text), \
             patch.object(tpa, "_remember_plan", return_value=None), \
             patch("app.agents.plan_parser.llm_repair_json", side_effect=lambda s: s):
            planner = tpa.LangGraphTripPlanner()
            plan = asyncio.run(planner.plan_trip(REQUEST, progress_callback=cb, user_id="u1"))
        return plan, events, fake_model

    def test_happy_path_produces_plan_and_progress(self):
        plan, events, model = self._run(_FakeChatModel([PLAN_JSON, APPROVED]))
        self.assertEqual(plan.city, "北京")
        stages = [s for s, _ in events]
        for stage in ("attraction_search", "weather_search", "hotel_search", "planning", "reviewing"):
            self.assertIn(stage, stages)

    def test_memory_context_injected_into_planner_prompt(self):
        _, _, model = self._run(_FakeChatModel([PLAN_JSON, APPROVED]), recall_text="- 用户喜欢自然风光")
        prompt_text = str(model.calls[0])
        self.assertIn("用户喜欢自然风光", prompt_text)

    def test_repair_loop_recovers_from_bad_json(self):
        model = _FakeChatModel(["这不是JSON{{{", PLAN_JSON, APPROVED])
        plan, _, _ = self._run(model)
        self.assertEqual(plan.city, "北京")
        self.assertEqual(len(model.calls), 3)  # 首次失败 → repair 重新规划 → 评审

    def test_review_rejection_triggers_revision(self):
        model = _FakeChatModel([PLAN_JSON, REJECTED, PLAN_JSON, APPROVED])
        plan, events, _ = self._run(model)
        self.assertEqual(plan.city, "北京")
        self.assertEqual(len(model.calls), 4)  # 规划 → 评审拒绝 → 修订 → 评审通过
        revise_prompt = str(model.calls[2])
        self.assertIn("评审意见", revise_prompt)
        self.assertIn("节奏太紧", revise_prompt)

    def test_reviewer_failure_still_yields_plan(self):
        model = _FakeChatModel([PLAN_JSON], fail_at=1)
        plan, _, _ = self._run(model)
        self.assertEqual(plan.city, "北京")  # 评审者异常 → 静默放行


if __name__ == "__main__":
    unittest.main()
