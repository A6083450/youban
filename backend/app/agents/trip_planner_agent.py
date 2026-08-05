"""LangGraph 多 Agent 旅行规划工作流。

图结构:
START → load_memories → research_trip(景点/天气/酒店并行)
      → plan_itinerary → parse_plan ─(失败且未重试)→ plan_itinerary(带 parse_error 重新规划)
                              └(成功)→ review_plan ─(通过/已修订上限)→ save_memories → END
                                               └(有问题)→ revise_itinerary → parse_plan(再评审)
"""

import asyncio
import copy
import inspect
import json
import os
import re
import time
from datetime import date, timedelta
from typing import Any, Awaitable, Callable, Dict, Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import RetryPolicy

from ..models.schemas import TripPlan, TripRequest
from ..services.llm_service import get_chat_model
from .trip_plan_orchestrator import (
    build_budget,
    build_segments,
    build_weather_info,
    merge_segment_days,
    normalize_checkpoint,
    parse_segment_output,
)
from .trip_research_agents import (
    ResearchCallbacks,
    ResearchContext,
    ResearchSources,
    run_parallel_research,
)

PLANNER_AGENT_PROMPT = """你是行程规划专家。你的任务是根据景点信息和天气信息,生成详细的旅行计划。支持单城市和多城市行程。

请严格按照以下JSON格式返回旅行计划:
```json
{
  "city": "首个城市名称(兼容字段)",
  "cities": ["城市1", "城市2"],
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "day_index": 0,
      "city": "当天所在城市",
      "is_transfer_day": false,
      "transfer_info": "",
      "transfer_time": "08:30",
      "description": "第1天行程概述",
      "transportation": "交通方式",
      "accommodation": "住宿类型",
      "hotel": {
        "name": "酒店名称",
        "address": "酒店地址",
        "location": {"longitude": 116.397128, "latitude": 39.916527},
        "price_range": "300-500元",
        "rating": "4.5",
        "distance": "距离景点2公里",
        "type": "经济型酒店",
        "estimated_cost": 400
      },
      "attractions": [
        {
          "name": "景点名称",
          "address": "详细地址",
          "location": {"longitude": 116.397128, "latitude": 39.916527},
          "visit_duration": 120,
          "description": "景点详细描述",
          "category": "景点类别",
          "ticket_price": 60,
          "reservation_required": false,
          "reservation_tips": "",
          "start_time": "09:00",
          "end_time": "11:00"
        }
      ],
      "meals": [
        {"type": "breakfast", "name": "早餐推荐", "description": "早餐描述", "estimated_cost": 30, "time": "08:00"},
        {"type": "lunch", "name": "午餐推荐", "description": "午餐描述", "estimated_cost": 50, "time": "12:00"},
        {"type": "dinner", "name": "晚餐推荐", "description": "晚餐描述", "estimated_cost": 80, "time": "18:00"}
      ]
    }
  ],
  "weather_info": [
    {
      "date": "YYYY-MM-DD",
      "city": "当天所在城市",
      "day_weather": "晴",
      "night_weather": "多云",
      "day_temp": 25,
      "night_temp": 15,
      "wind_direction": "南风",
      "wind_power": "1-3级"
    }
  ],
  "overall_suggestions": "总体建议",
  "budget": {
    "total_attractions": 180,
    "total_hotels": 1200,
    "total_meals": 480,
    "total_transportation": 200,
    "total_inter_city_transport": 0,
    "total": 2060
  },
  "blueprint": {
    "title": "旅行主题",
    "summary": "旅程如何展开的摘要",
    "logic": "路线与体力安排理由",
    "pace": "阶段一 → 阶段二 → 阶段三",
    "stages": [{
      "title": "阶段标题",
      "cities": ["城市"],
      "day_indices": [0, 1],
      "theme": "阶段体验主题",
      "rationale": "为什么这样安排",
      "highlights": ["代表体验1", "代表体验2"],
      "transition": "如何衔接下一阶段"
    }]
  }
}
```

**⚠️ JSON 格式关键约束（违反将导致系统崩溃）：**
- budget 中所有费用字段（total_attractions、total_hotels、total_meals、total_transportation、total_inter_city_transport、total）必须是**纯数字**，绝对禁止出现算术表达式！
  - ✅ 正确: "total_attractions": 324
  - ❌ 错误: "total_attractions": 30+54+120+120=324
  - ❌ 错误: "total_attractions": "324元"
- ticket_price、estimated_cost 等所有价格字段也必须是纯数字，不带单位

**重要提示:**
1. weather_info数组必须包含每一天的天气信息，每条记录必须包含 city 字段标明该天所在城市
2. 温度必须是纯数字(不要带°C等单位)
3. 每天安排2-3个景点(城际移动日可减少为1-2个)
4. 考虑景点之间的距离和游览时间
5. 每天必须包含早中晚三餐
6. 提供实用的旅行建议
7. **必须包含预算信息**:
   - 景点门票价格(ticket_price)
   - 餐饮预估费用(estimated_cost)
   - 酒店预估费用(estimated_cost)
   - 预算汇总(budget)包含各项总费用
8. **预约信息透传**: 如果景点搜索数据中包含 reservation_required 和 reservation_tips 字段，请务必将它们完整保留在对应景点的JSON中。需要预约的景点请在 description 中也提醒游客提前预约
9. **景点图片**: 不需要在JSON中填写 image_url 字段，图片由前端根据景点名称自动从高德地图获取。
10. **多城市行程要求**:
    - 每个 day 对象中必须包含 "city" 字段标明当天所在城市
    - 城市切换当天设置 "is_transfer_day": true，并在 "transfer_info" 中**仅给出交通方式建议和大致时长**（如"建议乘坐高铁，约2-3小时"）。
    - 城际移动日的景点数量可适当减少为1-2个
    - budget 中的 "total_inter_city_transport" 统计城际交通费用(单城市时为0)
    - "cities" 数组列出所有途经城市(单城市时只有一个元素)
11. transfer_time、景点 start_time/end_time 和餐饮 time 都是 HH:MM 格式的**参考时间**，仅用于安排节奏，不是实时班次、到达或预约确认；不得编造火车/航班号、具体班次、座位、实时出到达信息或任何预约结果。
12. 必须生成完整 blueprint：所有 day_index 必须恰好出现一次；每个 stage 的 highlights 最多 3 项；blueprint 只说明旅行主题、阶段、路线和体力逻辑，不得复制酒店名称、住宿信息、餐饮推荐或菜品等明细。
"""


REVIEWER_AGENT_PROMPT = """你是旅行计划评审专家。规划者(agent)生成了一份旅行计划 JSON,你负责审查其合理性与数据质量。

审查要点:
1. 时间安排: 每天景点 start_time/end_time 是否重叠、是否与 visit_duration 匹配、节奏是否过紧(正常一天2-3个景点)
2. 餐饮: 每天是否都有早中晚三餐,用餐时间是否合理
3. 城际移动: 城市切换日是否正确标记 is_transfer_day、移动日景点是否过多(应1-2个)
4. 预算: budget 各项是否为纯数字、各项之和与 total 是否基本一致
5. blueprint: 所有 day_index 是否恰好各出现一次、每个 stage 是否有实质内容
6. 预约: reservation_required 为 true 的景点是否保留了预约提示
7. 数据一致性: 日期连续且与 day_index 对应、每天 city 字段正确

只输出严格 JSON,不要输出任何其他文字:
{"approved": true 或 false, "issues": ["问题1", "问题2"]}
没有问题或只有可忽略的小瑕疵时 approved=true;issues 最多5条,每条一句话说明问题和修改方向。"""


class PlannerState(TypedDict, total=False):
    request_data: dict
    memory_context: str
    attractions: Dict[str, str]
    weather: Dict[str, str]
    hotels: Dict[str, str]
    checkpoint: dict
    trip_plan: Optional[dict]
    review_feedback: str
    revision_attempts: int


class PlannerContext(TypedDict, total=False):
    progress_callback: Optional[Callable[..., Awaitable[None]]]
    checkpoint: dict
    checkpoint_callback: Optional[Callable[[dict], Awaitable[None]]]
    user_id: str


# ---------- 可打桩的数据源适配层(测试直接 patch 这四个函数) ----------

def _fetch_attractions_text(city: str, keywords: str, language: str) -> str:
    from ..services.amap_service import search_amap_attractions
    return search_amap_attractions(city, keywords, language)


def _fetch_weather_text(city: str) -> str:
    from ..services.amap_service import get_amap_service
    try:
        items = get_amap_service().get_weather(city)
        if not items:
            return f"{city} 天气信息暂缺"
        return json.dumps([w.model_dump() for w in items], ensure_ascii=False)
    except Exception as e:
        return f"{city} 天气查询失败: {e}"


def _fetch_hotels_text(city: str, accommodation: str) -> str:
    from ..services.amap_service import get_amap_service
    try:
        svc = get_amap_service()
        pois = svc.search_poi(accommodation or "酒店", city)
        if not pois:
            pois = svc.search_poi("酒店", city)
        return json.dumps([p.model_dump() for p in pois[:10]], ensure_ascii=False)
    except Exception as e:
        return f"{city} 酒店搜索失败: {e}"


def _recall_memory(user_id: str, query: str) -> str:
    """读取用户长期记忆;失败/缺席返回空串。"""
    if not user_id:
        return ""
    try:
        from ..services.memory_service import recall_sync
        return recall_sync(user_id, query)
    except Exception:
        return ""


def _remember_plan(user_id: str, request: TripRequest, plan: TripPlan) -> None:
    if not user_id:
        return
    try:
        from ..services.memory_service import remember_background
        cities = " → ".join(cs.city for cs in request.cities)
        prefs = "、".join(request.preferences) if request.preferences else "无特别偏好"
        remember_background(
            user_id,
            [{"role": "user",
              "content": f"我生成了旅行计划:{cities},{request.start_date} 至 {request.end_date} 共 {request.travel_days} 天;偏好:{prefs};交通:{request.transportation};住宿:{request.accommodation}。"}],
            metadata={"source": "trip_planned"},
        )
    except Exception:
        pass


async def _emit(runtime: "Runtime[PlannerContext]", stage: str, message: str,
                progress: int, details: Optional[list] = None) -> None:
    cb = (runtime.context or {}).get("progress_callback")
    if cb is None:
        return
    result = cb(stage, message, progress, details) if details is not None else cb(stage, message, progress)
    if asyncio.iscoroutine(result):
        await result


async def _save_checkpoint(runtime: "Runtime[PlannerContext]", checkpoint: dict) -> None:
    cb = (runtime.context or {}).get("checkpoint_callback")
    if cb is None:
        return
    try:
        result = cb(copy.deepcopy(checkpoint))
        if inspect.isawaitable(result):
            await result
    except Exception as error:
        raise RuntimeError(f"checkpoint 写入失败: {error}") from error


def _request_from(state: PlannerState) -> TripRequest:
    return TripRequest(**state["request_data"])


# ---------- 图节点 ----------

async def load_memories(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    context = runtime.context or {}
    user_id = context.get("user_id") or ""
    cities = " ".join(cs.city for cs in request.cities)
    query = f"旅行偏好 兴趣 口味 出行习惯 {cities}"
    memory_context = await asyncio.to_thread(_recall_memory, user_id, query)
    if memory_context:
        print(f"🧠 已载入用户记忆 {len(memory_context)} 字")
    return {
        "memory_context": memory_context,
        "revision_attempts": 0,
        "review_feedback": "",
        "attractions": {},
        "weather": {},
        "hotels": {},
        "checkpoint": normalize_checkpoint(context.get("checkpoint")),
    }


async def research_trip(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    checkpoint = state["checkpoint"]

    async def save_checkpoint() -> None:
        await _save_checkpoint(runtime, checkpoint)

    async def emit_progress(stage: str, message: str, progress: int,
                            details: Optional[list[dict[str, str]]]) -> None:
        await _emit(runtime, stage, message, progress, details)

    bundle = await run_parallel_research(ResearchContext(
        request=request,
        search=checkpoint["search"],
        sources=ResearchSources(
            attractions=_fetch_attractions_text,
            weather=_fetch_weather_text,
            hotels=_fetch_hotels_text,
        ),
        callbacks=ResearchCallbacks(
            save_checkpoint=save_checkpoint,
            emit_progress=emit_progress,
        ),
    ))
    return {
        "attractions": bundle.attractions,
        "weather": bundle.weather,
        "hotels": bundle.hotels,
        "checkpoint": checkpoint,
    }


SEGMENT_AGENT_PROMPT = """你是分段行程规划者。只规划指定分段并输出严格 JSON，禁止输出解释文字：
{"segment_id":"seg-01","days":[{"date":"YYYY-MM-DD","day_index":0,"city":"城市",\
"description":"当日概述","transportation":"市内交通","accommodation":"住宿安排",\
"hotel":{"name":"酒店","estimated_cost":300},\
"attractions":[{"name":"景点","address":"地址","location":{"longitude":116.4,"latitude":39.9},\
"visit_duration":120,"description":"说明","ticket_price":0}],\
"meals":[{"type":"lunch","name":"餐厅","estimated_cost":50}]}]}
禁止输出 budget、overall_suggestions、blueprint、weather_info。每天必须严格使用指定的 day_index、date、city，
并生成可执行的景点、餐饮、交通和住宿安排；所有价格只能是数字。"""

SUMMARY_AGENT_PROMPT = """你负责根据完整行程生成总体建议与旅行蓝图。
只输出严格 JSON：{"overall_suggestions":"...","blueprint":null}。不得修改或重写 days。"""

SEGMENT_REVIEW_PROMPT = """你负责分段行程评审。只输出严格 JSON：
{"approved":true,"issues":[],"segment_ids":[]}。segment_ids 只能填写输入中已知的分段编号。"""

_REVISION_CONSUMED = "revision_consumed"


def _completed_previous_boundary(segment: dict, checkpoint: dict) -> str:
    previous_id = f"seg-{int(segment['segment_id'][4:]) - 1:02d}"
    record = checkpoint["segments"].get(previous_id, {})
    days = record.get("output", []) if record.get("status") == "completed" else []
    if not days:
        return "无已完成的前一段边界"
    day = days[-1]
    return json.dumps({
        "city": day.get("city"), "hotel": day.get("hotel"),
        "accommodation": day.get("accommodation"),
    }, ensure_ascii=False)


def _next_city(request: TripRequest, segment: dict) -> str:
    last_index = segment["day_indices"][-1]
    cities = [stay.city for stay in request.cities for _ in range(stay.days)]
    return cities[last_index + 1] if last_index + 1 < len(cities) else "无"


def _language_instruction(request: TripRequest) -> str:
    language = (request.language or "zh").strip().lower().split("-")[0]
    names = {"en": "English", "ja": "Japanese", "ko": "Korean",
             "fr": "French", "de": "German", "es": "Spanish"}
    if language == "zh":
        return "所有文字内容使用中文，JSON key 保持英文。"
    return f"Use {names.get(language, language)} for all text values; keep JSON keys in English."


def _build_segment_query(request, segment, attractions, weather, hotels,
                         memory_context, previous_error="", checkpoint=None) -> str:
    start = date.fromisoformat(request.start_date)
    days = [{
        "day_index": index,
        "date": (start + timedelta(days=index)).isoformat(),
        "city": segment["city"],
    } for index in segment["day_indices"]]
    boundary = _completed_previous_boundary(segment, checkpoint or {"segments": {}})
    return (
        f"segment_id: {segment['segment_id']}\n精确日期与城市: {json.dumps(days, ensure_ascii=False)}\n"
        f"前一段边界: {boundary}\n下一段请求城市: {_next_city(request, segment)}\n"
        f"景点: {attractions.get(segment['city'], '无')}\n天气: {weather.get(segment['city'], '无')}\n"
        f"酒店: {hotels.get(segment['city'], '无')}\n用户记忆: {memory_context or '无'}\n"
        f"交通: {request.transportation};住宿偏好: {request.accommodation};"
        f"额外要求: {request.free_text_input or '无'}\n上次错误: {previous_error or '无'}\n"
        f"语言要求: {_language_instruction(request)}"
    )


async def _generate_segment(model, request, segment, state) -> list[dict]:
    query = _build_segment_query(
        request, segment, state.get("attractions", {}), state.get("weather", {}),
        state.get("hotels", {}), state.get("memory_context", ""),
        state["checkpoint"]["segments"][segment["segment_id"]]["error"],
        state["checkpoint"],
    )
    response = await model.ainvoke([
        {"role": "system", "content": SEGMENT_AGENT_PROMPT},
        {"role": "user", "content": query},
    ])
    output = parse_segment_output(response.text, segment)
    _validate_segment_days(request, segment, output)
    return output


def _validate_segment_days(request: TripRequest, segment: dict, days: list[dict]) -> None:
    start = date.fromisoformat(request.start_date)
    for day, day_index in zip(days, segment["day_indices"]):
        expected_date = (start + timedelta(days=day_index)).isoformat()
        if day.get("date") != expected_date:
            raise ValueError("日期与分段范围不符")
        if day.get("city") != segment["city"]:
            raise ValueError("城市与分段范围不符")


def _prepare_segments(request: TripRequest, checkpoint: dict) -> tuple[list[dict], bool]:
    segments = build_segments(request)
    changed = False
    for segment in segments:
        saved = checkpoint["segments"].get(segment["segment_id"])
        if saved and saved.get("day_indices") == segment["day_indices"]:
            try:
                if saved["status"] == "completed":
                    output = parse_segment_output(json.dumps({
                        "segment_id": segment["segment_id"], "days": saved["output"],
                    }), segment)
                    _validate_segment_days(request, segment, output)
                    continue
            except (ValueError, TypeError):
                pass
        changed = True
        checkpoint["segments"][segment["segment_id"]] = {
            "day_indices": segment["day_indices"], "status": "pending",
            "output": [], "attempts": saved.get("attempts", 0) if saved else 0,
            "error": saved.get("error", "") if saved else "",
        }
    return segments, changed


async def _run_one_segment(model, request, segment, state, runtime, semaphore, lock,
                           progress_state) -> Optional[str]:
    record = state["checkpoint"]["segments"][segment["segment_id"]]
    async with semaphore:
        async with lock:
            record["attempts"] += 1
            record["status"] = "processing"
            await _save_checkpoint(runtime, state["checkpoint"])
        try:
            output = await _generate_segment(model, request, segment, state)
        except Exception as error:
            async with lock:
                record["status"], record["error"] = "failed", str(error)
                await _save_checkpoint(runtime, state["checkpoint"])
            return segment["segment_id"]
        async with lock:
            record["output"], record["status"], record["error"] = output, "completed", ""
            progress_state["completed"] += 1
            calculated = 75 + int(15 * progress_state["completed"] / progress_state["total"])
            progress_state["floor"] = max(progress_state["floor"], calculated)
            await _save_checkpoint(runtime, state["checkpoint"])
            await _emit(runtime, "planning", f"✅ {segment['segment_id']} 规划完成",
                        progress_state["floor"])
    return None


async def _run_segments(model, request, segments, state, runtime, progress_floor=75) -> int:
    pending = [item for item in segments
               if state["checkpoint"]["segments"][item["segment_id"]]["status"] != "completed"]
    progress_state = {
        "total": len(segments), "completed": len(segments) - len(pending),
        "floor": progress_floor,
    }
    semaphore, lock = asyncio.Semaphore(4), asyncio.Lock()
    results = await asyncio.gather(*[
        _run_one_segment(model, request, item, state, runtime, semaphore, lock, progress_state)
        for item in pending
    ], return_exceptions=True)
    callback_errors = [item for item in results if isinstance(item, BaseException)]
    if callback_errors:
        raise callback_errors[0]
    failed = [item for item in results if isinstance(item, str)]
    if failed:
        raise RuntimeError(f"分段生成失败: {', '.join(failed)}")
    return progress_state["floor"]


def _parse_object(text: str, required: set[str]) -> dict:
    match = re.search(r"\{[\s\S]*\}", text)
    data = json.loads(match.group() if match else text)
    if not isinstance(data, dict) or set(data) != required:
        raise ValueError("输出 JSON 字段不符")
    return data


def _fallback_suggestions(request: TripRequest) -> str:
    language = (request.language or "zh").strip().lower().split("-")[0]
    if language == "en":
        cities = ", ".join(
            f"{stay.city} ({stay.days} {'day' if stay.days == 1 else 'days'})"
            for stay in request.cities
        )
        return f"This trip covers {cities}. Follow the daily plan and allow flexibility for weather and local conditions."
    if language == "ja":
        cities = "、".join(f"{stay.city}{stay.days}日間" for stay in request.cities)
        return f"この旅行は{cities}を巡ります。毎日の計画に沿い、気象や現地状況に応じて余裕を持ってください。"
    cities = "、".join(f"{stay.city}{stay.days}天" for stay in request.cities)
    return f"本次行程覆盖{cities}，请按每日安排出行，并根据天气与现场情况预留机动时间。"


def _valid_summary(output, request, days, state) -> bool:
    try:
        if set(output) != {"overall_suggestions", "blueprint"}:
            return False
        if not isinstance(output["overall_suggestions"], str) or not output["overall_suggestions"].strip():
            return False
        TripPlan.model_validate(_assemble_plan(request, days, state, output))
        return True
    except (KeyError, TypeError, ValueError):
        return False


async def _run_summary(model, request, days, state, runtime) -> dict:
    checkpoint = state["checkpoint"]
    record = checkpoint["summary"]
    if record["status"] == "completed" and _valid_summary(record["output"], request, days, state):
        return record["output"]
    record.update(status="pending", output=None, error="")
    await _save_checkpoint(runtime, checkpoint)
    try:
        response = await model.ainvoke([
            {"role": "system", "content": SUMMARY_AGENT_PROMPT},
            {"role": "user", "content": (
                f"语言要求: {_language_instruction(request)}\n"
                f"行程: {json.dumps([day.model_dump() for day in days], ensure_ascii=False)}"
            )},
        ])
        output = _parse_object(response.text, {"overall_suggestions", "blueprint"})
        if not _valid_summary(output, request, days, state):
            raise ValueError("summary 输出无效")
        record.update(status="completed", output=output, error="")
    except Exception as error:
        output = {"overall_suggestions": _fallback_suggestions(request), "blueprint": None}
        record.update(status="failed", output=None, error=str(error))
    await _save_checkpoint(runtime, checkpoint)
    return output


def _assemble_plan(request, days, state, summary) -> dict:
    return {
        "city": request.cities[0].city,
        "cities": [stay.city for stay in request.cities],
        "start_date": request.start_date,
        "end_date": request.end_date,
        "days": [day.model_dump() for day in days],
        "weather_info": [item.model_dump() for item in build_weather_info(request, state.get("weather", {}))],
        "overall_suggestions": summary["overall_suggestions"],
        "budget": build_budget(days).model_dump(),
        "blueprint": summary["blueprint"],
    }


def _valid_review(output, segments) -> bool:
    if not isinstance(output, dict) or set(output) != {"approved", "issues", "segment_ids"}:
        return False
    known = {item["segment_id"] for item in segments}
    return (
        isinstance(output["approved"], bool)
        and isinstance(output["issues"], list)
        and all(isinstance(item, str) for item in output["issues"])
        and isinstance(output["segment_ids"], list)
        and all(isinstance(item, str) for item in output["segment_ids"])
        and set(output["segment_ids"]) <= known
    )


async def _run_review(model, segments, plan, state, runtime) -> Optional[dict]:
    checkpoint = state["checkpoint"]
    record = checkpoint["review"]
    if record["status"] == "completed" and _valid_review(record["output"], segments):
        return record["output"]
    record.update(status="pending", output=None, error="")
    await _save_checkpoint(runtime, checkpoint)
    try:
        payload = {
            "segments": [{key: segment[key] for key in ("segment_id", "day_indices", "city")}
                         for segment in segments],
            "plan": plan,
        }
        response = await model.ainvoke([
            {"role": "system", "content": SEGMENT_REVIEW_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ])
        output = _parse_object(response.text, {"approved", "issues", "segment_ids"})
        if not _valid_review(output, segments):
            raise ValueError("review 输出无效")
        record.update(status="completed", output=output, error="")
    except Exception as error:
        print(f"⚠️ 评审者异常,直接放行计划: {error}")
        record.update(status="failed", output=None, error=str(error))
        output = None
    await _save_checkpoint(runtime, checkpoint)
    return output


async def _revise_selected(model, request, segments, review, state, runtime,
                           progress_floor=90) -> tuple[list, dict]:
    if not review or review["approved"] or not review["segment_ids"]:
        days = merge_segment_days(request, segments, state["checkpoint"])
        return days, await _run_summary(model, request, days, state, runtime)
    error = "；".join(str(item) for item in review["issues"] if str(item).strip())
    for segment_id in review["segment_ids"]:
        state["checkpoint"]["segments"][segment_id].update(status="pending", error=error)
    state["checkpoint"]["summary"].update(status="pending", output=None, error="")
    state["checkpoint"]["review"].update(
        status="completed",
        output={"approved": True, "issues": review["issues"], "segment_ids": []},
        error=_REVISION_CONSUMED,
    )
    await _save_checkpoint(runtime, state["checkpoint"])
    await _run_segments(model, request, segments, state, runtime, progress_floor)
    days = merge_segment_days(request, segments, state["checkpoint"])
    return days, await _run_summary(model, request, days, state, runtime)


async def plan_itinerary(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    checkpoint = state["checkpoint"]
    segments, changed = _prepare_segments(request, checkpoint)
    revision_resume = checkpoint["review"].get("error") == _REVISION_CONSUMED
    if changed:
        checkpoint["summary"].update(status="pending", output=None, error="")
        if not revision_resume:
            checkpoint["review"].update(status="pending", output=None, error="")
    await _save_checkpoint(runtime, checkpoint)
    await _emit(runtime, "planning", "📋 正在并行生成旅行计划...", 75)
    timeout = int(os.getenv("TRIP_PLANNER_TIMEOUT", "180"))
    model = get_chat_model(temperature=0.2, timeout=timeout)
    progress_floor = await _run_segments(model, request, segments, state, runtime)
    await _emit(runtime, "planning", "🧭 主 Agent 正在汇总并校验所有 Agent 结果...",
                max(progress_floor, 90))
    days = merge_segment_days(request, segments, checkpoint)
    summary = await _run_summary(model, request, days, state, runtime)
    plan = _assemble_plan(request, days, state, summary)
    review = await _run_review(model, segments, plan, state, runtime)
    days, summary = await _revise_selected(
        model, request, segments, review, state, runtime, progress_floor
    )
    return {"trip_plan": _assemble_plan(request, days, state, summary), "checkpoint": checkpoint}


async def review_plan(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    await _emit(runtime, "reviewing", "✅ 分段评审与必要修订已完成", 95)
    return {"review_feedback": ""}


async def revise_itinerary(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    """规划者 agent 根据评审意见输出完整修订版 JSON。"""
    request = _request_from(state)
    await _emit(runtime, "planning", "🔧 规划者正在根据评审意见修订行程...", 94,
                details=[{"type": "planning", "title": "🔧 规划 agent 正在逐条修复评审意见...",
                          "content": state.get("review_feedback", "")[:200],
                          "timestamp": int(time.time() * 1000)}])
    query = _build_planner_query(
        request, state.get("attractions", {}), state.get("weather", {}),
        state.get("hotels", {}), state.get("memory_context", ""),
    )
    query += (
        f"\n\n**上一版计划 JSON:**\n{state.get('planner_output', '')}\n\n"
        f"**评审意见(必须逐条修复):**\n{state.get('review_feedback', '')}\n"
        "请输出完整的修订版 JSON,不要输出解释文字。"
    )
    timeout = int(os.getenv("TRIP_PLANNER_TIMEOUT", "180"))
    model = get_chat_model(temperature=0.2, timeout=timeout)
    response = await model.ainvoke([
        {"role": "system", "content": PLANNER_AGENT_PROMPT},
        {"role": "user", "content": query},
    ])
    return {"planner_output": response.text,
            "revision_attempts": state.get("revision_attempts", 0) + 1}


async def parse_plan(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    plan = TripPlan.model_validate(state["trip_plan"])
    return {"trip_plan": plan.model_dump(mode="json")}


def route_after_parse(state: PlannerState) -> str:
    if state.get("trip_plan") is not None:
        return "review_plan"
    raise ValueError("行程计划缺失")


def route_after_review(state: PlannerState) -> str:
    if not state.get("review_feedback"):
        return "save_memories"  # 评审通过(含评审者异常放行)
    max_rounds = int(os.getenv("TRIP_REVIEW_ROUNDS", "1"))
    if state.get("revision_attempts", 0) >= max_rounds:
        print(f"⚠️ 已达修订上限({max_rounds}轮),放行当前版本")
        return "save_memories"
    return "revise_itinerary"


async def save_memories(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    user_id = (runtime.context or {}).get("user_id") or ""
    plan = TripPlan(**state["trip_plan"])
    await asyncio.to_thread(_remember_plan, user_id, request, plan)
    return {}


def _build_graph():
    builder = StateGraph(PlannerState, context_schema=PlannerContext)
    builder.add_node("load_memories", load_memories)
    builder.add_node("research_trip", research_trip)
    builder.add_node("plan_itinerary", plan_itinerary, retry_policy=RetryPolicy(max_attempts=2))
    builder.add_node("parse_plan", parse_plan)
    builder.add_node("review_plan", review_plan)
    builder.add_node("revise_itinerary", revise_itinerary, retry_policy=RetryPolicy(max_attempts=2))
    builder.add_node("save_memories", save_memories)
    builder.add_edge(START, "load_memories")
    builder.add_edge("load_memories", "research_trip")
    builder.add_edge("research_trip", "plan_itinerary")
    builder.add_edge("plan_itinerary", "parse_plan")
    builder.add_conditional_edges("parse_plan", route_after_parse,
                                  ["review_plan", "plan_itinerary"])
    builder.add_conditional_edges("review_plan", route_after_review,
                                  ["save_memories", "revise_itinerary"])
    builder.add_edge("revise_itinerary", "parse_plan")
    builder.add_edge("save_memories", END)
    return builder.compile()


class LangGraphTripPlanner:
    """LangGraph 旅行规划工作流(规划者+评审者双 agent,替代 hello-agents 多智能体实现)。"""

    def __init__(self):
        print("🔄 初始化 LangGraph 旅行规划工作流...")
        self.graph = _build_graph()
        self.name = "LangGraph 行程规划"
        print("✅ LangGraph 工作流就绪(7 节点,含并行研究、解析修复与评审反思)")

    async def plan_trip(
        self,
        request: TripRequest,
        progress_callback: Optional[Callable[..., Any]] = None,
        user_id: str = "",
        checkpoint: Optional[dict] = None,
        checkpoint_callback: Optional[Callable[[dict], Any]] = None,
    ) -> TripPlan:
        city_names = [cs.city for cs in request.cities]
        print(f"\n{'='*60}\n🚀 LangGraph 规划开始: {' → '.join(city_names)} "
              f"({request.start_date} ~ {request.end_date}, 用户={user_id or '匿名'})\n{'='*60}")
        try:
            final_state = await self.graph.ainvoke(
                {"request_data": request.model_dump(mode="json")},
                context={
                    "progress_callback": progress_callback,
                    "checkpoint": checkpoint,
                    "checkpoint_callback": checkpoint_callback,
                    "user_id": user_id,
                },
            )
        except Exception as e:
            print(f"❌ 生成旅行计划失败: {e}")
            import traceback
            traceback.print_exc()
            raise RuntimeError(f"旅行计划生成失败: {e}") from e

        plan = TripPlan(**final_state["trip_plan"])
        # 补全 cities / 每日 city 字段(LLM 可能遗漏,与原实现一致)
        if not plan.cities:
            plan.cities = city_names
        if len(city_names) == 1:
            for day in plan.days:
                if not day.city:
                    day.city = city_names[0]
        print(f"{'='*60}\n✅ 旅行计划生成完成!\n{'='*60}\n")
        return plan


def _build_planner_query(
        request: TripRequest,
        attractions: Dict[str, str],
        weather: Dict[str, str],
        hotels: Dict[str, str],
        memory_context: str = "",
    ) -> str:
        """构建行程规划查询（支持多城市）
        
        Args:
            attractions: {city_name: 景点搜索结果文本}
            weather: {city_name: 天气查询结果文本}
            hotels: {city_name: 酒店搜索结果文本}
        """
        cities = request.cities
        total_cities = len(cities)
        is_multi_city = total_cities > 1

        # 构建城市停留计划描述
        if is_multi_city:
            cities_info_lines = []
            day_offset = 0
            for cs in cities:
                cities_info_lines.append(
                    f"- {cs.city}: 停留 {cs.days} 天 (第{day_offset+1}天 ~ 第{day_offset+cs.days}天)"
                )
                day_offset += cs.days
            cities_desc = "\n".join(cities_info_lines)
            title = f"跨城市旅行计划（{' → '.join(cs.city for cs in cities)}）"
        else:
            cities_desc = f"- {cities[0].city}: {cities[0].days} 天"
            title = f"{cities[0].city}的{request.travel_days}天旅行计划"

        query = f"""请根据以下信息生成{title}:

**基本信息:**
- 途经城市及天数分配:
{cities_desc}
- 总天数: {request.travel_days}天
- 日期: {request.start_date} 至 {request.end_date}
- 交通方式: {request.transportation}
- 住宿: {request.accommodation}
- 偏好: {', '.join(request.preferences) if request.preferences else '无'}
"""
        if memory_context:
            query += "\n**用户偏好(长期记忆,请在选择景点/餐饮/节奏时优先满足):**\n" + memory_context + "\n"
        # 为每个城市附上搜集到的信息
        for cs in cities:
            city = cs.city
            if is_multi_city:
                query += f"""
--- {city} ({cs.days}天) ---
**{city} 景点信息:**
{attractions.get(city, '无')}
**{city} 天气信息:**
{weather.get(city, '无')}
**{city} 酒店信息:**
{hotels.get(city, '无')}
"""
            else:
                query += f"""
**景点信息:**
{attractions.get(city, '无')}

**天气信息:**
{weather.get(city, '无')}

**酒店信息:**
{hotels.get(city, '无')}
"""

        query += """
**要求:**
1. 每天安排2-3个景点(城际移动日可减少为1-2个)
2. 每天必须包含早中晚三餐
3. 每天推荐一个具体的酒店(从酒店信息中选择)
4. 考虑景点之间的距离和交通方式
5. 返回完整的JSON格式数据
6. 景点的经纬度坐标要真实准确
7. 如果天气或酒店信息不足，请基于保守、通用的旅行建议补齐，但不要输出"无法查询"之类的解释文字
"""
        if is_multi_city:
            query += """
**多城市特殊要求:**
1. 每个 day 对象中必须包含 "city" 字段标明当天所在城市
2. 城市切换当天标记 "is_transfer_day": true, 并在 "transfer_info" 中说明城际交通方式和预计时长
3. 城际移动日的景点数量可适当减少为 1-2 个
4. budget 中增加 "total_inter_city_transport" 字段统计城际交通费用
5. 景点顺序要考虑同城市内的地理位置关系
6. "cities" 数组列出所有途经城市名称
"""

        if request.free_text_input:
            query += f"\n**额外要求:** {request.free_text_input}"

        # 如果用户选择了非中文语言，指示模型用目标语言输出所有文字内容
        _lang = (getattr(request, 'language', 'zh') or 'zh').strip().lower().split('-')[0]
        if _lang != 'zh':
            _lang_names = {"en": "English", "ja": "Japanese", "ko": "Korean", "fr": "French", "de": "German", "es": "Spanish"}
            _target_lang = _lang_names.get(_lang, _lang)
            query += f"""\n\n**语言要求 (Language Requirement):**
请用 {_target_lang} 语言输出所有文字内容（包括 description, overall_suggestions, meals 中的 name/description, hotel 中的 name/address, attractions 中的 name/address/description 等）。
JSON 的 key 名称保持英文不变，只翻译 value 中的文字。"""

        return query


# 全局单例(接口与旧实现一致)
_planner = None


def get_trip_planner_agent() -> LangGraphTripPlanner:
    """获取旅行规划工作流实例(单例模式)。"""
    global _planner
    if _planner is None:
        _planner = LangGraphTripPlanner()
    return _planner


def reset_trip_planner_agent() -> None:
    """重置规划工作流实例(运行时配置更新后热生效)。"""
    global _planner
    _planner = None
