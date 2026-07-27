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
    def __init__(self, replies):
        self._replies = list(replies)
        self.calls = []

    async def ainvoke(self, messages, **kwargs):
        self.calls.append(messages)
        return _FakeMessage(self._replies.pop(0))


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
        plan, events, model = self._run(_FakeChatModel([PLAN_JSON]))
        self.assertEqual(plan.city, "北京")
        stages = [s for s, _ in events]
        for stage in ("attraction_search", "weather_search", "hotel_search", "planning"):
            self.assertIn(stage, stages)

    def test_memory_context_injected_into_planner_prompt(self):
        _, _, model = self._run(_FakeChatModel([PLAN_JSON]), recall_text="- 用户喜欢自然风光")
        prompt_text = str(model.calls[0])
        self.assertIn("用户喜欢自然风光", prompt_text)

    def test_repair_loop_recovers_from_bad_json(self):
        model = _FakeChatModel(["这不是JSON{{{", PLAN_JSON])
        plan, _, _ = self._run(model)
        self.assertEqual(plan.city, "北京")
        self.assertEqual(len(model.calls), 2)  # 首次失败 → repair 重新规划


if __name__ == "__main__":
    unittest.main()
