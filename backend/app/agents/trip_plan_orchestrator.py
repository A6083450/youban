"""行程分段与聚合的确定性基础函数。"""

import copy
import json
from datetime import date, timedelta
from typing import Any

from ..models.schemas import Budget, DayPlan, TripRequest, WeatherInfo
from .plan_parser import error_guided_json_fix, fix_unescaped_quotes, sanitize_json_str


def empty_checkpoint() -> dict:
    return {
        "version": 1,
        "search": {"attractions": {}, "weather": {}, "hotels": {}},
        "segments": {},
        "summary": {"status": "pending", "output": None, "error": ""},
        "review": {"status": "pending", "output": None, "error": ""},
    }


def _valid_stage_record(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"status", "output", "error"}
        and isinstance(value["status"], str)
        and value["status"] in {"pending", "completed", "failed"}
        and isinstance(value["error"], str)
    )


def _valid_segment_record(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"day_indices", "status", "output", "attempts", "error"}
        and isinstance(value["day_indices"], list)
        and all(type(index) is int for index in value["day_indices"])
        and isinstance(value["status"], str)
        and value["status"] in {"pending", "processing", "completed", "failed"}
        and isinstance(value["output"], list)
        and type(value["attempts"]) is int
        and value["attempts"] >= 0
        and isinstance(value["error"], str)
    )


def normalize_checkpoint(value: Any) -> dict:
    valid = (
        isinstance(value, dict)
        and set(value) == {"version", "search", "segments", "summary", "review"}
        and type(value["version"]) is int
        and value["version"] == 1
        and isinstance(value["search"], dict)
        and set(value["search"]) == {"attractions", "weather", "hotels"}
        and all(isinstance(item, dict) for item in value["search"].values())
        and isinstance(value["segments"], dict)
        and all(_valid_segment_record(item) for item in value["segments"].values())
        and _valid_stage_record(value["summary"])
        and _valid_stage_record(value["review"])
    )
    if not valid:
        return empty_checkpoint()
    normalized = copy.deepcopy(value)
    for segment in normalized["segments"].values():
        if segment["status"] == "processing":
            segment["status"] = "pending"
    return normalized


def _segment_sizes(day_count: int) -> list[int]:
    sizes = []
    remaining = day_count
    while remaining:
        size = remaining if remaining <= 3 else 2 if remaining == 4 else 3
        sizes.append(size)
        remaining -= size
    return sizes


def build_segments(request: TripRequest) -> list[dict]:
    if sum(stay.days for stay in request.cities) != request.travel_days:
        raise ValueError("cities 天数总和必须等于 travel_days")
    segments = []
    day_index = 0
    start = date.fromisoformat(request.start_date)
    for stay in request.cities:
        for size in _segment_sizes(stay.days):
            indices = list(range(day_index, day_index + size))
            segments.append({
                "segment_id": f"seg-{len(segments) + 1:02d}",
                "day_indices": indices,
                "city": stay.city,
                "start_date": (start + timedelta(days=indices[0])).isoformat(),
                "end_date": (start + timedelta(days=indices[-1])).isoformat(),
            })
            day_index += size
    return segments


def _extract_json_object(text: str) -> str:
    cleaned = sanitize_json_str(text)
    object_start = cleaned.find("{")
    array_start = cleaned.find("[")
    if array_start >= 0 and (object_start < 0 or array_start < object_start):
        raise ValueError("segment 顶层必须为 JSON object")
    if object_start < 0:
        raise ValueError("响应中未找到 JSON object")
    depth, in_string, escaped = 0, False, False
    for index, char in enumerate(cleaned[object_start:], start=object_start):
        if escaped:
            escaped = False
        elif char == "\\" and in_string:
            escaped = True
        elif char == '"':
            in_string = not in_string
        elif not in_string and char == "{":
            depth += 1
        elif not in_string and char == "}":
            depth -= 1
            if depth == 0:
                if cleaned[index + 1:].strip():
                    raise ValueError("响应包含额外 JSON 值")
                return cleaned[object_start:index + 1]
    return cleaned[object_start:].strip()


def _decode_single_object(candidate: str) -> dict:
    decoder = json.JSONDecoder()
    errors = []
    for value in (candidate, fix_unescaped_quotes(candidate)):
        try:
            data, end = decoder.raw_decode(value)
        except json.JSONDecodeError as error:
            if error.msg == "Extra data":
                raise ValueError("响应包含额外 JSON 值") from error
            errors.append(error)
            continue
        if value[end:].strip():
            raise ValueError("响应包含额外 JSON 值")
        if not isinstance(data, dict):
            raise ValueError("segment 顶层必须为 JSON object")
        return data
    data = error_guided_json_fix(candidate)
    if not isinstance(data, dict):
        raise errors[-1]
    return data


def parse_segment_output(text: str, expected: dict) -> list[dict]:
    data = _decode_single_object(_extract_json_object(text))
    if set(data) != {"segment_id", "days"}:
        raise ValueError("segment 顶层包含未知字段")
    if data.get("segment_id") != expected["segment_id"]:
        raise ValueError("segment_id 与预期不符")
    days = data.get("days")
    if not isinstance(days, list):
        raise ValueError("days 必须为列表")
    validated = [DayPlan.model_validate(day) for day in days]
    if [day.day_index for day in validated] != expected["day_indices"]:
        raise ValueError("day_index 与分段范围不符")
    return [day.model_dump() for day in validated]


def _request_day_cities(request: TripRequest) -> list[str]:
    return [stay.city for stay in request.cities for _ in range(stay.days)]


def merge_segment_days(
    request: TripRequest,
    segments: list[dict],
    checkpoint: dict,
) -> list[DayPlan]:
    expected = {segment["segment_id"]: segment for segment in segments}
    raw_days = []
    for segment_id, saved in checkpoint.get("segments", {}).items():
        if not isinstance(saved, dict):
            raise ValueError("checkpoint segment 结构无效")
        if saved.get("status") != "completed":
            continue
        if segment_id not in expected:
            raise ValueError("checkpoint 包含未知 segment_id")
        segment_days = [DayPlan.model_validate(day) for day in saved.get("output", [])]
        if [day.day_index for day in segment_days] != expected[segment_id]["day_indices"]:
            raise ValueError("segment output 与 day_indices 不符")
        raw_days.extend(segment_days)
    days = sorted(raw_days, key=lambda day: day.day_index)
    if len(days) != request.travel_days or [day.day_index for day in days] != list(range(request.travel_days)):
        raise ValueError("day_index 存在重复或缺失")
    start = date.fromisoformat(request.start_date)
    for day, city in zip(days, _request_day_cities(request)):
        if day.date != (start + timedelta(days=day.day_index)).isoformat():
            raise ValueError("日期与 day_index 不符")
        if day.city != city:
            raise ValueError("城市与请求不符")
    return days


def build_budget(days: list[DayPlan]) -> Budget:
    attractions = sum(item.ticket_price for day in days for item in day.attractions)
    hotels = sum(day.hotel.estimated_cost for day in days if day.hotel)
    meals = sum(meal.estimated_cost for day in days for meal in day.meals)
    return Budget(
        total_attractions=attractions,
        total_hotels=hotels,
        total_meals=meals,
        total=attractions + hotels + meals,
    )


def build_weather_info(
    request: TripRequest,
    weather: dict[str, str],
) -> list[WeatherInfo]:
    start = date.fromisoformat(request.start_date)
    end = date.fromisoformat(request.end_date)
    by_date = {}
    for raw in weather.values():
        try:
            entries = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(entries, list):
            continue
        for entry in entries:
            try:
                item = WeatherInfo.model_validate(entry)
                item_date = date.fromisoformat(item.date)
            except (ValueError, TypeError):
                continue
            if start <= item_date <= end and item.date not in by_date:
                by_date[item.date] = item
    return [by_date[item_date] for item_date in sorted(by_date)]
