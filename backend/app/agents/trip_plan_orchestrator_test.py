import json
import unittest
from datetime import date, timedelta

from app.agents.trip_plan_orchestrator import (
    build_budget,
    build_segments,
    build_weather_info,
    empty_checkpoint,
    merge_segment_days,
    normalize_checkpoint,
    parse_segment_output,
)
from app.models.schemas import CityStay, DayPlan, TripRequest


def _request(days, start_date="2026-08-01"):
    start = date.fromisoformat(start_date)
    return TripRequest(
        city="北京",
        start_date=start_date,
        end_date=(start + timedelta(days=days - 1)).isoformat(),
        travel_days=days,
        transportation="公共交通",
        accommodation="经济型酒店",
    )


def _request_with_cities(cities, start_date="2026-08-01"):
    days = sum(city_days for _, city_days in cities)
    request = _request(days, start_date)
    request.cities = [CityStay(city=city, days=city_days) for city, city_days in cities]
    return request


def _sizes(segments):
    return [len(segment["day_indices"]) for segment in segments]


def _day(day_index, city="北京", attraction_cost=0, hotel_cost=0, meal_cost=0):
    return {
        "date": (date(2026, 8, 1) + timedelta(days=day_index)).isoformat(),
        "day_index": day_index,
        "city": city,
        "description": "当日行程",
        "transportation": "公共交通",
        "accommodation": "经济型酒店",
        "hotel": {
            "name": "测试酒店",
            "estimated_cost": hotel_cost,
        },
        "attractions": [{
            "name": "测试景点",
            "address": "测试地址",
            "location": {"longitude": 116.4, "latitude": 39.9},
            "visit_duration": 120,
            "description": "景点描述",
            "ticket_price": attraction_cost,
        }],
        "meals": [{
            "type": "lunch",
            "name": "测试餐厅",
            "estimated_cost": meal_cost,
        }],
    }


def _segment(day_indices, segment_id="seg-01"):
    return {
        "segment_id": segment_id,
        "day_indices": day_indices,
        "city": "北京",
        "start_date": "2026-08-01",
        "end_date": "2026-08-01",
    }


class SegmentBuilderTest(unittest.TestCase):
    def test_single_city_sizes(self):
        self.assertEqual(_sizes(build_segments(_request(1))), [1])
        self.assertEqual(_sizes(build_segments(_request(3))), [3])
        self.assertEqual(_sizes(build_segments(_request(4))), [2, 2])
        self.assertEqual(_sizes(build_segments(_request(7))), [3, 2, 2])
        self.assertEqual(_sizes(build_segments(_request(15))), [3, 3, 3, 3, 3])

    def test_every_day_is_covered_once(self):
        segments = build_segments(_request(15))
        indices = [i for segment in segments for i in segment["day_indices"]]
        self.assertEqual(indices, list(range(15)))

    def test_city_boundary_is_preserved_when_possible(self):
        request = _request_with_cities([("北京", 3), ("西安", 4)])
        segments = build_segments(request)
        self.assertEqual([s["city"] for s in segments], ["北京", "西安", "西安"])
        self.assertEqual([s["day_indices"] for s in segments], [[0, 1, 2], [3, 4], [5, 6]])

    def test_rejects_city_days_not_equal_to_travel_days(self):
        for city_days in (2, 4):
            request = _request(3)
            request.cities = [CityStay(city="北京", days=city_days)]
            with self.subTest(city_days=city_days), self.assertRaisesRegex(ValueError, "travel_days"):
                build_segments(request)


class CheckpointTest(unittest.TestCase):
    def test_unknown_or_invalid_checkpoint_falls_back(self):
        self.assertEqual(normalize_checkpoint({"version": 2}), empty_checkpoint())
        self.assertEqual(normalize_checkpoint("broken"), empty_checkpoint())

    def test_valid_checkpoint_is_copied(self):
        checkpoint = empty_checkpoint()
        checkpoint["search"]["weather"] = {"北京": "[]"}
        checkpoint["segments"]["seg-01"] = {
            "day_indices": [0],
            "status": "completed",
            "output": [_day(0)],
            "attempts": 1,
            "error": "",
        }
        normalized = normalize_checkpoint(checkpoint)
        self.assertEqual(normalized["search"]["weather"], {"北京": "[]"})
        self.assertIsNot(normalized, checkpoint)

    def test_processing_segment_resumes_as_pending(self):
        checkpoint = empty_checkpoint()
        checkpoint["segments"] = {
            "seg-01": {
                "day_indices": [0],
                "status": "completed",
                "output": [_day(0)],
                "attempts": 1,
                "error": "",
            },
            "seg-02": {
                "day_indices": [1],
                "status": "processing",
                "output": [],
                "attempts": 2,
                "error": "interrupted",
            },
        }
        normalized = normalize_checkpoint(checkpoint)
        self.assertEqual(normalized["segments"]["seg-01"]["status"], "completed")
        self.assertEqual(normalized["segments"]["seg-02"], {
            "day_indices": [1],
            "status": "pending",
            "output": [],
            "attempts": 2,
            "error": "interrupted",
        })

    def test_invalid_nested_checkpoint_falls_back(self):
        invalid_values = []
        for version in (True, 1.0):
            checkpoint = empty_checkpoint()
            checkpoint["version"] = version
            invalid_values.append(checkpoint)
        checkpoint = empty_checkpoint()
        checkpoint["future"] = 1
        invalid_values.append(checkpoint)
        checkpoint = empty_checkpoint()
        checkpoint["search"]["weather"] = []
        invalid_values.append(checkpoint)
        checkpoint = empty_checkpoint()
        checkpoint["segments"]["seg-01"] = "broken"
        invalid_values.append(checkpoint)
        checkpoint = empty_checkpoint()
        checkpoint["summary"] = {"status": "pending", "output": None}
        invalid_values.append(checkpoint)
        checkpoint = empty_checkpoint()
        checkpoint["summary"]["status"] = []
        invalid_values.append(checkpoint)
        checkpoint = empty_checkpoint()
        checkpoint["segments"]["seg-01"] = {
            "day_indices": [0],
            "status": {},
            "output": [],
            "attempts": 0,
            "error": "",
        }
        invalid_values.append(checkpoint)
        for value in invalid_values:
            with self.subTest(value=value):
                self.assertEqual(normalize_checkpoint(value), empty_checkpoint())


class SegmentOutputTest(unittest.TestCase):
    def test_parse_valid_segment(self):
        days = parse_segment_output(
            json.dumps({"segment_id": "seg-01", "days": [_day(0)]}),
            _segment([0]),
        )
        self.assertEqual([day["day_index"] for day in days], [0])

    def test_parse_tolerates_fenced_json_and_trailing_comma(self):
        payload = json.dumps({"segment_id": "seg-01", "days": [_day(0)]})
        text = f"```json\n{payload[:-1]},}}\n```"
        days = parse_segment_output(text, _segment([0]))
        self.assertEqual([day["day_index"] for day in days], [0])

    def test_rejects_missing_or_extra_day(self):
        with self.assertRaisesRegex(ValueError, "day_index"):
            parse_segment_output(
                json.dumps({"segment_id": "seg-01", "days": [_day(1)]}),
                _segment([0]),
            )

    def test_rejects_wrong_segment_id(self):
        with self.assertRaisesRegex(ValueError, "segment_id"):
            parse_segment_output(
                json.dumps({"segment_id": "seg-02", "days": [_day(0)]}),
                _segment([0]),
            )

    def test_rejects_multiple_top_level_json_values(self):
        text = " ".join([
            json.dumps({"segment_id": "seg-01", "days": [_day(0)]}),
            json.dumps({"segment_id": "seg-02", "days": [_day(0)]}),
        ])
        with self.assertRaisesRegex(ValueError, "额外 JSON"):
            parse_segment_output(text, _segment([0]))

    def test_rejects_unknown_segment_field(self):
        payload = {"segment_id": "seg-01", "days": [_day(0)], "budget": {}}
        with self.assertRaisesRegex(ValueError, "未知字段"):
            parse_segment_output(json.dumps(payload), _segment([0]))

    def test_rejects_repaired_object_followed_by_another_json_value(self):
        valid = json.dumps({"segment_id": "seg-01", "days": [_day(0)]})
        broken = valid.replace('", "days"', '" "days"', 1)
        with self.assertRaisesRegex(ValueError, "额外 JSON"):
            parse_segment_output(f"{broken} {{}}", _segment([0]))

    def test_rejects_non_object_top_level_with_value_error(self):
        with self.assertRaisesRegex(ValueError, "JSON object"):
            parse_segment_output(json.dumps([{"segment_id": "seg-01", "days": []}]), _segment([0]))


class MergeAndBudgetTest(unittest.TestCase):
    def _checkpoint(self, outputs):
        checkpoint = empty_checkpoint()
        checkpoint["segments"] = {
            f"seg-{position:02d}": {
                "status": "completed",
                "output": output,
            }
            for position, output in enumerate(outputs, start=1)
        }
        return checkpoint

    def test_merge_completed_segments_in_day_order(self):
        request = _request_with_cities([("北京", 1), ("西安", 1)])
        checkpoint = empty_checkpoint()
        checkpoint["segments"] = {
            "seg-02": {"status": "completed", "output": [_day(1, city="西安")]},
            "seg-01": {"status": "completed", "output": [_day(0)]},
        }
        days = merge_segment_days(request, build_segments(request), checkpoint)
        self.assertEqual([day.day_index for day in days], [0, 1])

    def test_merge_rejects_duplicate_missing_and_wrong_date(self):
        request = _request(2)
        invalid_outputs = [
            [[_day(0)], [_day(0)]],
            [[_day(0)]],
            [[_day(0)], [{**_day(1), "date": "2026-08-04"}]],
        ]
        for outputs in invalid_outputs:
            with self.subTest(outputs=outputs), self.assertRaises(ValueError):
                merge_segment_days(request, build_segments(request), self._checkpoint(outputs))

    def test_merge_rejects_wrong_city(self):
        request = _request_with_cities([("北京", 1), ("西安", 1)])
        checkpoint = self._checkpoint([[_day(0)], [_day(1, city="北京")]])
        with self.assertRaisesRegex(ValueError, "城市"):
            merge_segment_days(request, build_segments(request), checkpoint)

    def test_merge_rejects_unknown_completed_segment(self):
        request = _request(2)
        checkpoint = empty_checkpoint()
        checkpoint["segments"]["stale-segment"] = {
            "status": "completed",
            "output": [_day(0), _day(1)],
        }
        with self.assertRaisesRegex(ValueError, "segment_id"):
            merge_segment_days(request, build_segments(request), checkpoint)

    def test_merge_rejects_cross_segment_output(self):
        request = _request(4)
        segments = build_segments(request)
        checkpoint = self._checkpoint([
            [_day(0), _day(1), _day(2), _day(3)],
            [],
        ])
        with self.assertRaisesRegex(ValueError, "day_indices"):
            merge_segment_days(request, segments, checkpoint)

    def test_budget_sums_only_modeled_cost_fields(self):
        days = [DayPlan(**_day(0, attraction_cost=20, hotel_cost=300, meal_cost=80))]
        budget = build_budget(days)
        self.assertEqual(budget.total_attractions, 20)
        self.assertEqual(budget.total_hotels, 300)
        self.assertEqual(budget.total_meals, 80)
        self.assertEqual(budget.total_transportation, 0)
        self.assertEqual(budget.total_inter_city_transport, 0)
        self.assertEqual(budget.total, 400)


class WeatherInfoTest(unittest.TestCase):
    def test_build_weather_skips_invalid_out_of_range_and_duplicates(self):
        request = _request(2)
        weather = {
            "北京": json.dumps([
                {"date": "2026-08-02", "city": "北京", "day_weather": "晴"},
                {"date": "2026-08-01", "city": "北京", "day_temp": "30°C"},
                {"date": "2026-08-01", "city": "北京", "day_temp": 99},
                {"date": "2026-08-03", "city": "北京"},
                {"date": "broken", "city": "北京"},
            ]),
            "西安": "not-json",
        }
        result = build_weather_info(request, weather)
        self.assertEqual([item.date for item in result], ["2026-08-01", "2026-08-02"])
        self.assertEqual(result[0].day_temp, 30)
