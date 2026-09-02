from __future__ import annotations

from datetime import date
from typing import Iterable

from ..models.schemas import DayPlan, WeatherInfo


_OUTDOOR_KEYWORDS = (
    "公园", "山", "湖", "岛", "海滩", "沙滩", "湿地", "森林", "草原",
    "古镇", "古村", "步道", "广场", "街", "园林", "动物园", "植物园",
    "park", "mountain", "lake", "island", "beach", "forest", "garden",
)
_ARRIVAL_KEYWORDS = ("抵达", "到达", "arrive", "arrival", "到着")
_AFTERNOON_KEYWORDS = ("下午", "傍晚", "afternoon", "evening", "午後", "夕方")
_MEAL_ANCHORS = {
    "breakfast": 8 * 60,
    "lunch": 12 * 60 + 30,
    "dinner": 18 * 60 + 30,
    "snack": 15 * 60 + 30,
}


def _to_minutes(value: str | None) -> int | None:
    if not value:
        return None
    try:
        hours, minutes = (int(part) for part in value.split(":"))
    except (TypeError, ValueError):
        return None
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        return None
    return hours * 60 + minutes


def _format_minutes(value: int) -> str:
    value = max(0, min(value, 23 * 60 + 59))
    return f"{value // 60:02d}:{value % 60:02d}"


def _is_outdoor(name: str, category: str | None, description: str) -> bool:
    searchable = f"{name} {category or ''} {description}".lower()
    return any(keyword in searchable for keyword in _OUTDOOR_KEYWORDS)


def _is_afternoon_arrival(day: DayPlan) -> bool:
    description = day.description.lower()
    return (
        any(keyword in description for keyword in _ARRIVAL_KEYWORDS)
        and any(keyword in description for keyword in _AFTERNOON_KEYWORDS)
    )


def _has_forecast(weather: WeatherInfo | None) -> bool:
    if weather is None:
        return False
    return bool(
        weather.day_weather
        or weather.night_weather
        or weather.day_temp
        or weather.night_temp
    )


def _is_hot(weather: WeatherInfo | None) -> bool:
    if not _has_forecast(weather):
        return False
    try:
        return float(weather.day_temp) >= 29
    except (TypeError, ValueError):
        return False


def _is_weekend(raw_date: str) -> bool:
    try:
        return date.fromisoformat(raw_date).weekday() >= 5
    except (TypeError, ValueError):
        return False


def _recommended_start(
    day: DayPlan,
    attraction_index: int,
    outdoor: bool,
    weather: WeatherInfo | None,
    previous_end: int | None,
) -> int:
    if _is_afternoon_arrival(day):
        anchor = 15 * 60 + 30 if attraction_index == 0 else 18 * 60
    elif attraction_index == 0:
        anchor = 8 * 60 if outdoor and (_is_hot(weather) or _is_weekend(day.date)) else 9 * 60
    elif outdoor and _is_hot(weather):
        anchor = 16 * 60
    else:
        anchor = 14 * 60 + (attraction_index - 1) * 150

    if previous_end is not None:
        anchor = max(anchor, previous_end + 30)
    return anchor


def recommend_visit_times(
    days: Iterable[DayPlan],
    weather_info: Iterable[WeatherInfo] = (),
) -> list[DayPlan]:
    """Fill missing attraction times without overwriting user/planner choices.

    Crowd guidance is deliberately marked as heuristic. This scheduler does not
    claim live crowd levels or verified venue opening hours.
    """
    weather_by_date = {item.date: item for item in weather_info}
    scheduled_days: list[DayPlan] = []

    for original_day in days:
        day = original_day.model_copy(deep=True)
        weather = weather_by_date.get(day.date)
        previous_end: int | None = None

        for index, attraction in enumerate(day.attractions):
            duration = max(30, int(attraction.visit_duration or 90))
            existing_start = _to_minutes(attraction.start_time)
            existing_end = _to_minutes(attraction.end_time)

            if existing_start is not None:
                if existing_end is None:
                    attraction.end_time = _format_minutes(existing_start + duration)
                    existing_end = existing_start + duration
                previous_end = existing_end
                continue

            outdoor = _is_outdoor(
                attraction.name,
                attraction.category,
                attraction.description,
            )
            start = _recommended_start(day, index, outdoor, weather, previous_end)
            attraction.start_time = _format_minutes(start)
            attraction.end_time = _format_minutes(start + duration)
            attraction.time_recommendation_basis = (
                "weather" if _has_forecast(weather) else "seasonal"
            )
            attraction.crowd_recommendation_basis = "heuristic"
            previous_end = start + duration

        timed_attractions = [
            (_to_minutes(item.start_time), _to_minutes(item.end_time))
            for item in day.attractions
        ]
        morning_ends = [
            end
            for start, end in timed_attractions
            if start is not None and start < 13 * 60 and end is not None
        ]
        afternoon_ends = [
            end
            for start, end in timed_attractions
            if start is not None and start >= 14 * 60 and end is not None
        ]
        latest_morning_end = max((value for value in morning_ends if value is not None), default=None)
        latest_afternoon_end = max((value for value in afternoon_ends if value is not None), default=None)

        for meal in day.meals:
            if _to_minutes(meal.time) is not None:
                continue
            anchor = _MEAL_ANCHORS.get(meal.type.lower(), 12 * 60 + 30)
            if meal.type.lower() == "lunch" and latest_morning_end is not None:
                anchor = max(anchor, latest_morning_end + 30)
            if meal.type.lower() == "dinner" and latest_afternoon_end is not None:
                anchor = max(anchor, latest_afternoon_end + 30)
            meal.time = _format_minutes(anchor)
            meal.time_recommendation_basis = "schedule"

        scheduled_days.append(day)

    return scheduled_days
