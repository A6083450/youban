import unittest

from app.agents.plan_parser import (
    fix_unescaped_quotes,
    parse_trip_plan,
    remove_trailing_commas,
    repair_truncated_json,
    sanitize_json_str,
)
from app.models.schemas import TripRequest

REQUEST = TripRequest(
    city="北京", start_date="2026-08-01", end_date="2026-08-03",
    travel_days=3, transportation="公共交通", accommodation="经济型酒店",
)

VALID_PLAN = """```json
{"city": "北京", "start_date": "2026-08-01", "end_date": "2026-08-03",
 "days": [{"date": "2026-08-01", "day_index": 0, "description": "第1天",
   "transportation": "公共交通", "accommodation": "经济型酒店",
   "attractions": [{"name": "故宫", "address": "东城区",
     "location": {"longitude": 116.397, "latitude": 39.916},
     "visit_duration": 120, "description": "宫殿", "category": "历史"}],
   "meals": [{"type": "breakfast", "name": "早餐", "description": "豆浆"}]}],
 "weather_info": [], "overall_suggestions": "好好玩"}
```"""


class PlanParserTest(unittest.TestCase):
    def test_parse_valid_fenced_json(self):
        plan = parse_trip_plan(VALID_PLAN, REQUEST)
        self.assertEqual(plan.city, "北京")
        self.assertEqual(len(plan.days), 1)

    def test_sanitize_strips_arithmetic_expressions(self):
        fixed = sanitize_json_str('{"total": 30+54+120=204}')
        self.assertIn('"total": 204', fixed)

    def test_remove_trailing_commas(self):
        self.assertEqual(remove_trailing_commas('{"a": 1,}'), '{"a": 1}')

    def test_fix_unescaped_quotes(self):
        fixed = fix_unescaped_quotes('{"d": "这是"好的"景点"}')
        self.assertEqual(fixed, '{"d": "这是\'好的\'景点"}')

    def test_repair_truncated_json(self):
        repaired = repair_truncated_json('{"a": [{"b": "text')
        import json
        self.assertEqual(json.loads(repaired), {"a": [{"b": "text"}]})

    def test_unparseable_raises_value_error(self):
        with self.assertRaises(ValueError):
            parse_trip_plan("完全不是JSON", REQUEST)


if __name__ == "__main__":
    unittest.main()
