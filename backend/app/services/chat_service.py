"""
AI 行程问答服务
基于 httpx 直接调用 OpenAI 兼容的 Chat Completions API，
将当前旅行计划作为上下文注入,实现针对行程的智能问答
"""

import os
import json
import httpx
from typing import List, Optional, Dict, Any
from ..config import get_settings

# ============ System Prompt ============
SYSTEM_PROMPT = """你是一个专业且贴心的私人旅行管家「旅途星辰AI」。

你当前正在为用户提供关于一份 **已生成的旅行计划** 的答疑服务。
用户可能会问你关于行程中的景点、酒店、餐饮、天气、交通、门票、费用等任何细节问题。

请根据下方提供的【当前旅行计划】JSON 上下文来回答用户的问题。
回答规则：
1. 如果行程数据中包含相关信息，请精确引用并给出详细回答。
2. 如果行程数据中没有明确信息，可以基于常识进行合理推断，但需说明"行程中未提供该信息，以下是建议"。
3. 回答要有温度、条理清晰，适当使用 emoji 增加亲切感 🌟。
4. 回答尽量简洁，控制在200字以内，除非用户要求详细展开。
5. 使用中文回答。"""


def _get_llm_runtime_config() -> Dict[str, Any]:
    """按请求实时读取 LLM 配置，支持前端设置页热更新。"""
    settings = get_settings()

    api_key = (
        settings.openai_api_key
        or os.getenv("LLM_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    )
    base_url = (
        settings.openai_base_url
        or os.getenv("LLM_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://api.openai.com/v1"
    )
    model_id = (
        settings.openai_model
        or os.getenv("LLM_MODEL_ID")
        or os.getenv("OPENAI_MODEL")
        or "gpt-4"
    )
    timeout = int(os.getenv("LLM_TIMEOUT", "120"))

    return {
        "api_key": api_key.strip(),
        "base_url": base_url.rstrip("/"),
        "model_id": model_id.strip(),
        "timeout": timeout,
    }


def _build_context_message(trip_plan_dict: Dict[str, Any]) -> str:
    """将旅行计划转化为上下文文本"""
    return f"【当前旅行计划】\n```json\n{json.dumps(trip_plan_dict, ensure_ascii=False, indent=2)}\n```"


def _inject_memory_context(messages: List[Dict[str, str]], user_id: str, query: str) -> None:
    """把用户长期记忆插入 system 之后(无记忆/失败时不插入,不影响主流程)。"""
    if not user_id:
        return
    try:
        from .memory_service import recall_sync
        memory_text = recall_sync(user_id, query)
    except Exception:
        memory_text = ""
    if memory_text:
        messages.insert(1, {
            "role": "system",
            "content": f"【用户长期记忆】回答时可自然引用:\n{memory_text}",
        })


async def chat_with_trip_context(
    message: str,
    trip_plan_dict: Dict[str, Any],
    history: Optional[List[Dict[str, str]]] = None,
    user_id: str = "",
) -> str:
    """
    使用 LLM 回答关于当前行程的用户提问

    Args:
        message: 用户的提问
        trip_plan_dict: 当前旅行计划 (dict 格式)
        history: 可选的历史对话 [{"role": "user"/"assistant", "content": "..."}]
        user_id: 当前用户(用于注入长期记忆,可为空)

    Returns:
        AI 的回复文本
    """
    # 构造消息列表
    llm_config = _get_llm_runtime_config()
    if not llm_config["api_key"]:
        return "抱歉，AI 服务尚未配置 API Key，请先在设置页面中完成配置。"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _build_context_message(trip_plan_dict)},
    ]
    _inject_memory_context(messages, user_id, message)

    # 追加历史对话
    if history:
        for item in history:
            messages.append({
                "role": item.get("role", "user"),
                "content": item.get("content", ""),
            })

    # 追加本次用户提问
    messages.append({"role": "user", "content": message})

    # 调用 LLM
    url = f"{llm_config['base_url']}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {llm_config['api_key']}",
    }
    payload = {
        "model": llm_config["model_id"],
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 1024,
    }

    try:
        async with httpx.AsyncClient(timeout=llm_config["timeout"]) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

            reply = data["choices"][0]["message"]["content"]
            return reply.strip()

    except httpx.HTTPStatusError as e:
        print(f"❌ LLM API 返回错误: {e.response.status_code} - {e.response.text}")
        return f"抱歉，AI 服务暂时出现问题 (HTTP {e.response.status_code})，请稍后重试 🙏"
    except httpx.TimeoutException:
        print("❌ LLM API 请求超时")
        return "抱歉，AI 回复超时了，请稍后再试 ⏳"
    except Exception as e:
        print(f"❌ LLM 调用异常: {e}")
        return f"抱歉，AI 出现了意外错误，请稍后重试 🙏"


# ============ 行程修改 (Agent) ============
EDIT_SYSTEM_PROMPT = """你是专业且贴心的私人旅行管家「游伴AI」,同时承担【行程问答】和【行程修改】两项职责。

你必须始终返回一个严格的 JSON 对象,不要输出 JSON 以外的任何内容:
{
  "reply": "给用户的自然语言回复,中文,亲切简洁,可适当使用 emoji",
  "updated_plan": null 或 完整更新后的旅行计划 JSON 对象,
  "changes": ["变更点1", "变更点2"]
}

行为规则:
1. 用户只是在【提问/咨询】(票价、天气、适不适合、建议等)时:updated_plan 必须为 null,changes 为 [],只在 reply 中回答(200字以内;行程中未提供的信息需说明"行程中未提供该信息,以下是建议")。
2. 用户要求【修改行程】(替换/删除/增加景点、换酒店、调整餐饮、修改描述、调整费用等)时:
   - 基于【当前旅行计划】JSON 生成修改后的完整计划,放入 updated_plan。
   - 必须保持原有 JSON schema 与所有未涉及字段完全不变。
   - 不得修改 city、cities、start_date、end_date、weather_info。
   - 只允许调整 days 内的 attractions、hotel、meals、description、transportation、accommodation,以及 overall_suggestions。
   - 不要增删 days 数组元素;每天 attractions 至少保留 1 个。
   - 涉及费用时用合理估值填写 ticket_price / estimated_cost(数字);budget 字段保持原样即可(前端会自动重算)。
   - changes 用简短中文逐条列出实际改动(如"已将第2天的钟楼替换为碑林博物馆");无实际改动则为 []。
   - reply 简要说明改了什么。
3. 修改要求无法满足时(如超出天数范围):updated_plan 为 null,changes 为 [],在 reply 中解释原因并给出替代建议。"""


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """从 LLM 输出中提取 JSON 对象,容忍前后多余文本。"""
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, TypeError):
        pass
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


def _validate_updated_plan(plan: Any, original: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """校验 LLM 返回的 updated_plan 基本结构,并强制还原不允许修改的结构性字段。"""
    if not isinstance(plan, dict):
        return None
    days = plan.get('days')
    original_days = original.get('days', [])
    if not isinstance(days, list) or len(days) != len(original_days):
        return None
    for i, day in enumerate(days):
        if not isinstance(day, dict):
            return None
        attractions = day.get('attractions')
        if not isinstance(attractions, list) or len(attractions) < 1:
            return None
        if any(not isinstance(item, dict) for item in attractions):
            return None
        original_day = original_days[i] if isinstance(original_days[i], dict) else {}
        # meals 为 List[Meal] 必填结构,缺失或非法时还原原计划,防止前端计算崩溃
        if not isinstance(day.get('meals'), list):
            day['meals'] = original_day.get('meals', [])
        # 逐日结构字段不允许 LLM 修改,强制还原
        for key in ('date', 'day_index', 'city', 'is_transfer_day', 'transfer_info'):
            if key in original_day:
                day[key] = original_day[key]
    # 强制还原不允许修改的结构性字段
    for key in ('city', 'cities', 'start_date', 'end_date', 'weather_info'):
        if key in original:
            plan[key] = original[key]
    return plan


async def chat_edit_trip(
    message: str,
    trip_plan_dict: Dict[str, Any],
    history: Optional[List[Dict[str, str]]] = None,
    user_id: str = "",
) -> Dict[str, Any]:
    """
    Agent 式行程对话:LLM 同时承担问答与修改。
    返回 {"reply": str, "updated_plan": dict | None, "changes": list[str]}
    """
    llm_config = _get_llm_runtime_config()
    if not llm_config["api_key"]:
        return {
            "reply": "抱歉,AI 服务尚未配置 API Key,请先在设置页面中完成配置。",
            "updated_plan": None,
            "changes": [],
        }

    messages = [
        {"role": "system", "content": EDIT_SYSTEM_PROMPT},
        {"role": "user", "content": _build_context_message(trip_plan_dict)},
    ]
    _inject_memory_context(messages, user_id, message)
    if history:
        for item in history:
            messages.append({
                "role": item.get("role", "user"),
                "content": item.get("content", ""),
            })
    messages.append({"role": "user", "content": message})

    url = f"{llm_config['base_url']}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {llm_config['api_key']}",
    }
    payload = {
        "model": llm_config["model_id"],
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 8192,
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=llm_config["timeout"]) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            raw = data["choices"][0]["message"]["content"].strip()
    except httpx.HTTPStatusError as e:
        print(f"❌ LLM API 返回错误: {e.response.status_code} - {e.response.text}")
        # 部分模型不支持 response_format,降级重试一次
        if e.response.status_code == 400:
            payload.pop("response_format", None)
            try:
                async with httpx.AsyncClient(timeout=llm_config["timeout"]) as client:
                    response = await client.post(url, json=payload, headers=headers)
                    response.raise_for_status()
                    raw = response.json()["choices"][0]["message"]["content"].strip()
            except Exception as e2:
                print(f"❌ 降级重试失败: {e2}")
                return {"reply": "抱歉,AI 服务暂时出现问题,请稍后重试 🙏", "updated_plan": None, "changes": []}
        else:
            return {"reply": f"抱歉,AI 服务暂时出现问题 (HTTP {e.response.status_code}),请稍后重试 🙏", "updated_plan": None, "changes": []}
    except httpx.TimeoutException:
        return {"reply": "抱歉,AI 回复超时了,请稍后再试 ⏳", "updated_plan": None, "changes": []}
    except Exception as e:
        print(f"❌ LLM 调用异常: {e}")
        return {"reply": "抱歉,AI 出现了意外错误,请稍后重试 🙏", "updated_plan": None, "changes": []}

    parsed = _extract_json_object(raw)
    if not parsed:
        # LLM 未按格式返回:降级为纯文本回复,不应用任何修改
        return {"reply": raw, "updated_plan": None, "changes": []}

    reply = str(parsed.get("reply") or "").strip() or "好的。"
    changes_raw = parsed.get("changes")
    changes = [str(c) for c in changes_raw if str(c).strip()] if isinstance(changes_raw, list) else []
    updated_plan = _validate_updated_plan(parsed.get("updated_plan"), trip_plan_dict)
    if parsed.get("updated_plan") is not None and updated_plan is None:
        # LLM 试图修改但结构不合法:放弃修改,告知用户
        changes = []
        reply += "\n\n(这次修改没有生效,可能是改动范围太大,可以换个说法或分步告诉我 🙏)"

    # 实际发生修改时,把修改意图交给 mem0 提取偏好(失败静默)
    if user_id and changes:
        try:
            from .memory_service import remember_background
            remember_background(
                user_id,
                [{"role": "user", "content": message},
                 {"role": "assistant", "content": "已修改行程:" + ";".join(changes)[:400]}],
                metadata={"source": "trip_edit"},
            )
        except Exception:
            pass

    return {"reply": reply, "updated_plan": updated_plan, "changes": changes}
