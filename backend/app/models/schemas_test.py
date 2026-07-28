import unittest

from app.models.schemas import TripPlan


def plan_payload() -> dict:
    return {
        "city": "上海",
        "cities": ["上海", "杭州"],
        "start_date": "2026-08-01",
        "end_date": "2026-08-02",
        "days": [
            {
                "date": "2026-08-01",
                "day_index": 0,
                "city": "上海",
                "description": "城市文化",
                "transportation": "地铁",
                "accommodation": "市中心酒店",
                "attractions": [{
                    "name": "外滩",
                    "address": "中山东一路",
                    "location": {"longitude": 121.49, "latitude": 31.24},
                    "visit_duration": 120,
                    "description": "建筑群",
                    "start_time": "09:00",
                    "end_time": "11:00",
                }],
                "meals": [{"type": "lunch", "name": "本帮菜", "time": "12:00"}],
            },
            {
                "date": "2026-08-02",
                "day_index": 1,
                "city": "杭州",
                "is_transfer_day": True,
                "transfer_info": "建议乘坐高铁，约 1 小时",
                "transfer_time": "08:30",
                "description": "西湖慢游",
                "transportation": "高铁与步行",
                "accommodation": "湖滨酒店",
                "attractions": [{
                    "name": "西湖",
                    "address": "西湖区",
                    "location": {"longitude": 120.14, "latitude": 30.25},
                    "visit_duration": 180,
                    "description": "湖滨景观",
                    "start_time": "14:00",
                    "end_time": "17:00",
                }],
                "meals": [],
            },
        ],
        "weather_info": [],
        "overall_suggestions": "路线顺行，减少折返。",
        "blueprint": {
            "title": "城市与湖滨",
            "summary": "从上海城市文化进入杭州湖滨慢游。",
            "logic": "先紧后松。",
            "pace": "城市探索 → 湖滨慢游",
            "stages": [
                {
                    "title": "城市序章",
                    "cities": ["上海"],
                    "day_indices": [0],
                    "theme": "海派文化",
                    "rationale": "先适应城市节奏。",
                    "highlights": ["外滩"],
                    "transition": "高铁前往杭州。",
                },
                {
                    "title": "湖滨收尾",
                    "cities": ["杭州"],
                    "day_indices": [1],
                    "theme": "自然慢游",
                    "rationale": "用舒缓体验收尾。",
                    "highlights": ["西湖"],
                    "transition": "",
                },
            ],
        },
    }


class TripPlanBlueprintTest(unittest.TestCase):
    def test_accepts_blueprint_and_reference_times(self):
        plan = TripPlan(**plan_payload())
        self.assertEqual(plan.blueprint.stages[1].day_indices, [1])
        self.assertEqual(plan.days[0].attractions[0].start_time, "09:00")
        self.assertEqual(plan.days[1].transfer_time, "08:30")

    def test_keeps_legacy_plan_without_blueprint(self):
        payload = plan_payload()
        payload.pop("blueprint")
        for day in payload["days"]:
            day.pop("transfer_time", None)
            for attraction in day["attractions"]:
                attraction.pop("start_time", None)
                attraction.pop("end_time", None)
        plan = TripPlan(**payload)
        self.assertIsNone(plan.blueprint)
        self.assertIsNone(plan.days[0].attractions[0].start_time)

    def test_normalizes_invalid_times_without_rejecting_plan(self):
        payload = plan_payload()
        payload["days"][0]["attractions"][0]["start_time"] = "上午九点"
        payload["days"][0]["meals"][0]["time"] = "25:10"
        plan = TripPlan(**payload)
        self.assertIsNone(plan.days[0].attractions[0].start_time)
        self.assertIsNone(plan.days[0].meals[0].time)

    def test_discards_blueprint_with_duplicate_or_missing_days(self):
        payload = plan_payload()
        payload["blueprint"]["stages"][1]["day_indices"] = [0]
        plan = TripPlan(**payload)
        self.assertIsNone(plan.blueprint)

    def test_limits_each_blueprint_stage_to_three_highlights(self):
        payload = plan_payload()
        payload["blueprint"]["stages"][0]["highlights"] = ["外滩", "豫园", "武康路", "陆家嘴"]
        plan = TripPlan(**payload)
        self.assertEqual(plan.blueprint.stages[0].highlights, ["外滩", "豫园", "武康路"])


if __name__ == "__main__":
    unittest.main()
