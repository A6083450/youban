"""行程分段与聚合的确定性基础函数。"""

import copy
import json
import unicodedata
from datetime import date, timedelta
from typing import Any, Optional

from ..models.schemas import Budget, DayPlan, HotelCandidateInfo, TripRequest, WeatherInfo
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


def allocate_segment_attraction_candidates(
    segments: list[dict],
    attractions: dict[str, Any],
) -> list[dict]:
    """Give concurrent segments disjoint, deterministic POI candidate pools."""
    allocated = copy.deepcopy(segments)
    indices_by_city: dict[str, list[int]] = {}
    for index, segment in enumerate(allocated):
        indices_by_city.setdefault(segment["city"], []).append(index)

    for city, segment_indices in indices_by_city.items():
        candidate_ids = list(
            parse_attraction_candidates(attractions.get(city, "")).keys()
        )
        if not candidate_ids:
            continue
        weights = [len(allocated[index]["day_indices"]) for index in segment_indices]
        total_weight = max(1, sum(weights))
        raw_quotas = [len(candidate_ids) * weight / total_weight for weight in weights]
        quotas = [int(value) for value in raw_quotas]
        remainder = len(candidate_ids) - sum(quotas)
        remainder_order = sorted(
            range(len(segment_indices)),
            key=lambda index: (-(raw_quotas[index] - quotas[index]), index),
        )
        for index in remainder_order[:remainder]:
            quotas[index] += 1

        pools = [[] for _ in segment_indices]
        cursor = 0
        for candidate_id in candidate_ids:
            for _ in range(len(segment_indices)):
                pool_index = cursor % len(segment_indices)
                cursor += 1
                if len(pools[pool_index]) < quotas[pool_index]:
                    pools[pool_index].append(candidate_id)
                    break
        for pool_index, segment_index in enumerate(segment_indices):
            allocated[segment_index]["attraction_candidate_ids"] = pools[pool_index]
    return allocated


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


def parse_hotel_candidates(value: Any) -> dict[str, dict]:
    """Parse provider-neutral hotel candidates collected by controlled tools."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    if not isinstance(value, list):
        return {}

    candidates = {}
    for item in value:
        try:
            candidate = HotelCandidateInfo.model_validate(item)
        except (TypeError, ValueError):
            continue
        candidates[candidate.id] = candidate.model_dump(mode="json")
    return candidates


def parse_attraction_candidates(value: Any) -> dict[str, dict]:
    """Parse trusted attraction candidates collected from the AMap REST API."""
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            values = decoded if isinstance(decoded, list) else []
        except json.JSONDecodeError:
            values = []
            for line in value.splitlines():
                try:
                    item = json.loads(line)
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(item, dict):
                    values.append(item)
    elif isinstance(value, list):
        values = value
    else:
        values = []

    candidates: dict[str, dict] = {}
    for item in values:
        if not isinstance(item, dict):
            continue
        poi_id = str(item.get("poi_id") or "").strip()
        name = str(item.get("name") or "").strip()
        location = item.get("location")
        try:
            normalized_location = {
                "longitude": float(location["longitude"]),
                "latitude": float(location["latitude"]),
            }
        except (KeyError, TypeError, ValueError):
            continue
        if not poi_id or not name:
            continue
        candidates[poi_id] = {
            **item,
            "poi_id": poi_id,
            "name": name,
            "address": str(item.get("address") or "").strip(),
            "location": normalized_location,
        }
    return candidates


def _resolve_day_attractions(
    day: dict,
    candidates: dict[str, dict],
    enforce_candidates: bool = False,
) -> None:
    attractions = day.get("attractions")
    if not isinstance(attractions, list):
        raise ValueError("attractions 必须为列表")
    if not candidates:
        if enforce_candidates and attractions:
            raise ValueError("本分段没有可用景点候选，attractions 必须为空")
        return

    for attraction in attractions:
        if not isinstance(attraction, dict):
            raise ValueError("attraction 必须为 JSON object")
        poi_id = str(attraction.get("poi_id") or "").strip()
        if poi_id not in candidates:
            raise ValueError("景点 poi_id 不在高德候选列表中")
        candidate = candidates[poi_id]
        attraction["poi_id"] = poi_id
        attraction["name"] = candidate["name"]
        attraction["address"] = candidate["address"] or str(
            attraction.get("address") or ""
        )
        attraction["location"] = candidate["location"]
        for key in ("reservation_required", "reservation_tips"):
            if key in candidate:
                attraction[key] = candidate[key]


def _verified_hotel(candidate: dict) -> dict:
    starting_price = candidate.get("starting_price")
    has_price = isinstance(starting_price, (int, float)) and starting_price > 0
    return {
        "name": candidate["name"],
        "address": candidate.get("address", ""),
        "location": candidate.get("location"),
        "price_range": candidate.get("price_raw", ""),
        "rating": candidate.get("rating", ""),
        "distance": "",
        "type": candidate.get("star") or candidate.get("type", ""),
        "estimated_cost": round(float(starting_price), 2) if has_price else 0,
        "source": candidate.get("source", "amap"),
        "source_hotel_id": candidate["id"],
        "source_url": candidate.get("source_url", ""),
        "image_url": candidate.get("image_url", ""),
        "price_checked_at": candidate.get("price_checked_at", ""),
        "price_method": "provider_starting_price" if has_price else "",
        "price_status": "estimated" if has_price else "unavailable",
    }


def _resolve_day_hotel(
    day: dict,
    candidates: dict[str, dict],
    trusted_hotel_data: bool,
    hotel_required: bool = True,
) -> None:
    if not isinstance(day, dict):
        raise ValueError("day 必须为 JSON object")

    if not hotel_required:
        day.pop("hotel_id", None)
        day["hotel"] = None
        return

    if trusted_hotel_data:
        hotel = day.get("hotel")
        if hotel is None:
            if candidates:
                raise ValueError("checkpoint 缺少已验证酒店")
            return
        if not isinstance(hotel, dict):
            raise ValueError("checkpoint 酒店结构无效")
        source_id = str(hotel.get("source_hotel_id") or "").strip()
        candidate = candidates.get(source_id)
        candidate_source = str((candidate or {}).get("source") or "amap")
        if candidate is not None and hotel.get("source") == candidate_source:
            day["hotel"] = _verified_hotel(candidate)
            return
        raise ValueError("checkpoint 酒店未通过受控来源验证")

    selected_id = str(day.pop("hotel_id", "") or "").strip()
    generated_hotel = day.get("hotel")
    if generated_hotel is not None:
        raise ValueError("Agent 不得生成酒店名称、坐标或价格")

    if not selected_id:
        if candidates:
            selected_id = next(iter(candidates))
        else:
            day["hotel"] = None
            return
    if selected_id not in candidates:
        raise ValueError("hotel_id 不在受控酒店候选列表中")
    day["hotel"] = _verified_hotel(candidates[selected_id])


def parse_segment_output(
    text: str,
    expected: dict,
    attraction_candidates: Optional[dict[str, dict]] = None,
    hotel_candidates: Optional[dict[str, dict]] = None,
    trusted_hotel_data: bool = False,
    last_travel_day_index: Optional[int] = None,
    enforce_attraction_candidates: bool = False,
) -> list[dict]:
    data = _decode_single_object(_extract_json_object(text))
    if set(data) != {"segment_id", "days"}:
        raise ValueError("segment 顶层包含未知字段")
    if data.get("segment_id") != expected["segment_id"]:
        raise ValueError("segment_id 与预期不符")
    days = data.get("days")
    if not isinstance(days, list):
        raise ValueError("days 必须为列表")
    candidates = hotel_candidates or {}
    for day in days:
        _resolve_day_attractions(
            day,
            attraction_candidates or {},
            enforce_attraction_candidates,
        )
        _resolve_day_hotel(
            day,
            candidates,
            trusted_hotel_data,
            hotel_required=(
                last_travel_day_index is None
                or day.get("day_index") != last_travel_day_index
            ),
        )
    validated = [DayPlan.model_validate(day) for day in days]
    if [day.day_index for day in validated] != expected["day_indices"]:
        raise ValueError("day_index 与分段范围不符")
    return [day.model_dump() for day in validated]


def _normalized_attraction_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(char for char in normalized if char.isalnum())


def duplicate_attraction_issues(
    days: list[DayPlan],
    segments: list[dict],
) -> dict[str, list[str]]:
    """Return deterministic repair feedback for later duplicate attractions."""
    segment_by_day = {
        day_index: segment["segment_id"]
        for segment in segments
        for day_index in segment["day_indices"]
    }
    seen: dict[tuple[str, str], tuple[int, str]] = {}
    issues: dict[str, list[str]] = {}
    for day in sorted(days, key=lambda item: item.day_index):
        city = day.city.strip()
        for attraction in day.attractions:
            poi_id = str(attraction.poi_id or "").strip()
            identity = f"poi:{poi_id}" if poi_id else (
                f"name:{_normalized_attraction_name(attraction.name)}"
            )
            if identity == "name:":
                continue
            key = (city, identity)
            previous = seen.get(key)
            if previous is None:
                seen[key] = (day.day_index, attraction.name)
                continue
            first_day_index, first_name = previous
            segment_id = segment_by_day.get(day.day_index)
            if not segment_id:
                raise ValueError("景点所在 day_index 不属于任何分段")
            source = f"，高德 POI ID={poi_id}" if poi_id else ""
            issues.setdefault(segment_id, []).append(
                f"D{day.day_index + 1} 的“{attraction.name}”与 "
                f"D{first_day_index + 1} 的“{first_name}”重复{source}；"
                "必须改为尚未使用的真实景点"
            )
    return issues


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


def build_budget(
    days: list[DayPlan],
    traveler_count: int = 1,
    room_count: int = 1,
) -> Budget:
    travelers = max(1, traveler_count)
    rooms = max(1, room_count)
    attractions = sum(
        item.ticket_price * travelers for day in days for item in day.attractions
    )
    hotels = sum(day.hotel.estimated_cost * rooms for day in days if day.hotel)
    meals = sum(
        meal.estimated_cost * travelers for day in days for meal in day.meals
    )
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
