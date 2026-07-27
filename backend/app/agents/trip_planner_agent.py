"""LangGraph 旅行规划工作流

图结构:
START → load_memories → fetch_attractions → fetch_weather → fetch_hotels
      → plan_itinerary → parse_plan ─(成功)→ save_memories → END
                              └─(失败且未重试)→ repair(带 parse_error 重新规划)
"""

import asyncio
import json
import os
import time
from typing import Any, Awaitable, Callable, Dict, Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import RetryPolicy

from ..models.schemas import TripPlan, TripRequest
from ..services.llm_service import get_chat_model
from .plan_parser import parse_trip_plan

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
          "reservation_tips": ""
        }
      ],
      "meals": [
        {"type": "breakfast", "name": "早餐推荐", "description": "早餐描述", "estimated_cost": 30},
        {"type": "lunch", "name": "午餐推荐", "description": "午餐描述", "estimated_cost": 50},
        {"type": "dinner", "name": "晚餐推荐", "description": "晚餐描述", "estimated_cost": 80}
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
    - 城市切换当天设置 "is_transfer_day": true，并在 "transfer_info" 中**仅给出交通方式建议和大致时长**（如"建议乘坐高铁，约2-3小时"），**禁止编造具体车次、班次号、出发时间、到达时间等不可验证的信息**
    - 城际移动日的景点数量可适当减少为1-2个
    - budget 中的 "total_inter_city_transport" 统计城际交通费用(单城市时为0)
    - "cities" 数组列出所有途经城市(单城市时只有一个元素)
"""


class PlannerState(TypedDict, total=False):
    request_data: dict
    memory_context: str
    attractions: Dict[str, str]
    weather: Dict[str, str]
    hotels: Dict[str, str]
    planner_output: str
    trip_plan: Optional[dict]
    parse_error: str
    repair_attempts: int


class PlannerContext(TypedDict, total=False):
    progress_callback: Optional[Callable[..., Awaitable[None]]]
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


def _request_from(state: PlannerState) -> TripRequest:
    return TripRequest(**state["request_data"])


# ---------- 图节点 ----------

async def load_memories(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    user_id = (runtime.context or {}).get("user_id") or ""
    cities = " ".join(cs.city for cs in request.cities)
    query = f"旅行偏好 兴趣 口味 出行习惯 {cities}"
    memory_context = await asyncio.to_thread(_recall_memory, user_id, query)
    if memory_context:
        print(f"🧠 已载入用户记忆 {len(memory_context)} 字")
    return {"memory_context": memory_context, "repair_attempts": 0,
            "attractions": {}, "weather": {}, "hotels": {}}


async def fetch_attractions(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    keywords = request.preferences[0] if request.preferences else "景点"
    lang = (getattr(request, "language", "zh") or "zh").strip().lower().split("-")[0]
    total = len(request.cities)
    result: Dict[str, str] = {}
    for idx, cs in enumerate(request.cities):
        progress = int(10 + (idx / total) * 25)
        await _emit(runtime, "attraction_search", f"🔍 正在搜索 {cs.city} 的景点...", progress,
                    details=[{"type": "searching", "title": f"🔍 正在搜索 {cs.city} 的{keywords}景点...",
                              "content": f"使用高德地图搜索 {cs.city} 的 {keywords} 相关景点信息",
                              "timestamp": int(time.time() * 1000)}])
        text = await asyncio.to_thread(_fetch_attractions_text, cs.city, keywords, lang)
        result[cs.city] = text
        await _emit(runtime, "attraction_search", f"✅ {cs.city} 景点搜索完毕", progress,
                    details=[{"type": "found", "title": f"📍 {cs.city} 景点搜索完成",
                              "content": (text or "")[:200], "timestamp": int(time.time() * 1000)}])
    return {"attractions": result}


async def fetch_weather(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    total = len(request.cities)
    result: Dict[str, str] = {}
    for idx, cs in enumerate(request.cities):
        progress = int(35 + (idx / total) * 20)
        await _emit(runtime, "weather_search", f"🌤️ 正在查询 {cs.city} 的天气...", progress,
                    details=[{"type": "searching", "title": f"🌤️ 正在查询 {cs.city} 未来天气预报...",
                              "content": f"调用高德天气 API 获取 {cs.city} 的预报数据",
                              "timestamp": int(time.time() * 1000)}])
        text = await asyncio.to_thread(_fetch_weather_text, cs.city)
        result[cs.city] = text
        await _emit(runtime, "weather_search", f"✅ {cs.city} 天气查询完毕", progress,
                    details=[{"type": "found", "title": f"🌤️ {cs.city} 天气查询完成",
                              "content": (text or "")[:200], "timestamp": int(time.time() * 1000)}])
    return {"weather": result}


async def fetch_hotels(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    total = len(request.cities)
    result: Dict[str, str] = {}
    for idx, cs in enumerate(request.cities):
        progress = int(55 + (idx / total) * 20)
        await _emit(runtime, "hotel_search", f"🏨 正在搜索 {cs.city} 的酒店...", progress,
                    details=[{"type": "searching", "title": f"🏨 正在搜索 {cs.city} 的{request.accommodation}...",
                              "content": f"根据住宿偏好「{request.accommodation}」搜索 {cs.city} 合适的酒店",
                              "timestamp": int(time.time() * 1000)}])
        text = await asyncio.to_thread(_fetch_hotels_text, cs.city, request.accommodation)
        result[cs.city] = text
        await _emit(runtime, "hotel_search", f"✅ {cs.city} 酒店搜索完毕", progress,
                    details=[{"type": "found", "title": f"🏨 {cs.city} 酒店搜索完成",
                              "content": (text or "")[:200], "timestamp": int(time.time() * 1000)}])
    return {"hotels": result}


async def plan_itinerary(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    city_names = [cs.city for cs in request.cities]
    await _emit(runtime, "planning",
                "📋 正在生成多城市行程计划..." if len(city_names) > 1 else "📋 正在生成旅行计划...", 85,
                details=[{"type": "planning",
                          "title": f"🧠 正在综合分析 {' → '.join(city_names)} 的景点、天气和酒店信息...",
                          "content": "AI 正在结合你的偏好记忆规划最优行程路线",
                          "timestamp": int(time.time() * 1000)}])
    query = _build_planner_query(
        request, state.get("attractions", {}), state.get("weather", {}),
        state.get("hotels", {}), state.get("memory_context", ""),
    )
    if state.get("parse_error"):
        query += ("\n\n**补充要求:** 上次输出的 JSON 解析失败"
                  f"({state['parse_error'][:200]}),请重新输出完整、严格合法的 JSON,不要输出解释文字。")
    timeout = int(os.getenv("TRIP_PLANNER_TIMEOUT", "180"))
    model = get_chat_model(temperature=0.2, timeout=timeout)
    response = await model.ainvoke([
        {"role": "system", "content": PLANNER_AGENT_PROMPT},
        {"role": "user", "content": query},
    ])
    return {"planner_output": str(response.content)}


async def parse_plan(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    try:
        plan = await asyncio.to_thread(parse_trip_plan, state.get("planner_output", ""), request)
        return {"trip_plan": plan.model_dump(mode="json"), "parse_error": ""}
    except ValueError as e:
        return {"trip_plan": None, "parse_error": str(e),
                "repair_attempts": state.get("repair_attempts", 0) + 1}


def route_after_parse(state: PlannerState) -> str:
    if state.get("trip_plan") is not None:
        return "save_memories"
    if state.get("repair_attempts", 0) <= 1:
        return "plan_itinerary"  # 带 parse_error 重新规划一次
    raise ValueError(f"行程 JSON 解析失败: {state.get('parse_error', '未知错误')}")


async def save_memories(state: PlannerState, runtime: "Runtime[PlannerContext]") -> dict:
    request = _request_from(state)
    user_id = (runtime.context or {}).get("user_id") or ""
    plan = TripPlan(**state["trip_plan"])
    await asyncio.to_thread(_remember_plan, user_id, request, plan)
    return {}


def _build_graph():
    builder = StateGraph(PlannerState, context_schema=PlannerContext)
    builder.add_node("load_memories", load_memories)
    builder.add_node("fetch_attractions", fetch_attractions)
    builder.add_node("fetch_weather", fetch_weather)
    builder.add_node("fetch_hotels", fetch_hotels)
    builder.add_node("plan_itinerary", plan_itinerary, retry_policy=RetryPolicy(max_attempts=2))
    builder.add_node("parse_plan", parse_plan)
    builder.add_node("save_memories", save_memories)
    builder.add_edge(START, "load_memories")
    builder.add_edge("load_memories", "fetch_attractions")
    builder.add_edge("fetch_attractions", "fetch_weather")
    builder.add_edge("fetch_weather", "fetch_hotels")
    builder.add_edge("fetch_hotels", "plan_itinerary")
    builder.add_edge("plan_itinerary", "parse_plan")
    builder.add_conditional_edges("parse_plan", route_after_parse,
                                  ["save_memories", "plan_itinerary"])
    builder.add_edge("save_memories", END)
    return builder.compile()


class LangGraphTripPlanner:
    """LangGraph 旅行规划工作流(替代 hello-agents 多智能体实现)。"""

    def __init__(self):
        print("🔄 初始化 LangGraph 旅行规划工作流...")
        self.graph = _build_graph()
        self.name = "LangGraph 行程规划"
        print("✅ LangGraph 工作流就绪(7 节点,含解析修复循环)")

    async def plan_trip(
        self,
        request: TripRequest,
        progress_callback: Optional[Callable[..., Any]] = None,
        user_id: str = "",
    ) -> TripPlan:
        city_names = [cs.city for cs in request.cities]
        print(f"\n{'='*60}\n🚀 LangGraph 规划开始: {' → '.join(city_names)} "
              f"({request.start_date} ~ {request.end_date}, 用户={user_id or '匿名'})\n{'='*60}")
        try:
            final_state = await self.graph.ainvoke(
                {"request_data": request.model_dump(mode="json")},
                context={"progress_callback": progress_callback, "user_id": user_id},
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
