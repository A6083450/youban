import unittest

from app.models.schemas import Attraction, DayPlan, Location, Meal, WeatherInfo
from app.services.itinerary_scheduler import recommend_visit_times


def _attraction(name: str, duration: int = 120, **overrides) -> Attraction:
    payload = {
        "name": name,
        "address": "测试地址",
        "location": Location(longitude=113.26, latitude=23.14),
        "visit_duration": duration,
        "description": "户外漫步",
    }
    payload.update(overrides)
    return Attraction(**payload)


def _day(
    *attractions: Attraction,
    description: str = "全天游览",
    meals: list[Meal] | None = None,
) -> DayPlan:
    return DayPlan(
        date="2026-09-10",
        day_index=0,
        city="广州",
        description=description,
        transportation="公共交通",
        accommodation="经济型酒店",
        attractions=list(attractions),
        meals=meals or [],
    )


class ItinerarySchedulerTest(unittest.TestCase):
    def test_fills_missing_times_and_marks_non_live_sources(self):
        result = recommend_visit_times([
            _day(
                _attraction("越秀公园"),
                _attraction("沙面岛", duration=150),
                description="抵达广州，下午游览越秀公园，傍晚前往沙面岛",
            )
        ])[0]

        self.assertEqual(result.attractions[0].start_time, "15:30")
        self.assertEqual(result.attractions[0].end_time, "17:30")
        self.assertEqual(result.attractions[1].start_time, "18:00")
        self.assertEqual(result.attractions[1].end_time, "20:30")
        self.assertEqual(result.attractions[0].time_recommendation_basis, "seasonal")
        self.assertEqual(result.attractions[0].crowd_recommendation_basis, "heuristic")

    def test_uses_forecast_basis_and_avoids_hot_afternoon_for_first_outdoor_stop(self):
        weather = WeatherInfo(
            date="2026-09-10",
            city="广州",
            day_weather="晴",
            night_weather="多云",
            day_temp=34,
            night_temp=27,
        )
        attraction = recommend_visit_times(
            [_day(_attraction("越秀公园"))],
            [weather],
        )[0].attractions[0]

        self.assertEqual(attraction.start_time, "08:00")
        self.assertEqual(attraction.time_recommendation_basis, "weather")

    def test_preserves_existing_user_time_and_only_derives_missing_end(self):
        attraction = recommend_visit_times([
            _day(_attraction("越秀公园", start_time="10:00"))
        ])[0].attractions[0]

        self.assertEqual(attraction.start_time, "10:00")
        self.assertEqual(attraction.end_time, "12:00")
        self.assertIsNone(attraction.time_recommendation_basis)
        self.assertIsNone(attraction.crowd_recommendation_basis)

    def test_schedules_missing_meals_around_attractions(self):
        day = recommend_visit_times([
            _day(
                _attraction("越秀公园"),
                _attraction("沙面岛", duration=150),
                description="抵达广州，下午游览越秀公园，傍晚前往沙面岛",
                meals=[
                    Meal(type="lunch", name="午餐", estimated_cost=50),
                    Meal(type="dinner", name="晚餐", estimated_cost=80),
                ],
            )
        ])[0]

        self.assertEqual(day.meals[0].time, "12:30")
        self.assertEqual(day.meals[1].time, "21:00")
        self.assertEqual(day.meals[1].time_recommendation_basis, "schedule")


if __name__ == "__main__":
    unittest.main()
