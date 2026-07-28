"""旅行规划 API 路由 - WebSocket 同步 + 轮询兼容模式"""

# noqa: SIZE_OK -- 既有路由模块集中管理共享的任务内存与持久化状态，本次仅收敛分享权限边界。

import asyncio
import json
import math
import os
import re
import secrets
import shutil
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ...agents.stream_json import stream_extract_string_field
from ...agents.trip_planner_agent import get_trip_planner_agent
from ...config import get_data_dir
from ...models.schemas import TripPlanResponse, TripRequest
from ...services import memory_service
from ...services.knowledge_graph_service import build_knowledge_graph
from ...services.llm_service import iter_llm_stream
from ...services.trip_confirmation import consume_execution_token, register_confirm_decision

router = APIRouter(prefix="/trip", tags=["旅行规划"])

# 内存任务存储（单实例部署足够）
_tasks: Dict[str, Dict[str, Any]] = {}
_FINAL_TASK_STATUS = {"completed", "failed"}
_TASKS_DATA_DIR = get_data_dir() / "trip_tasks"


def _clean_user_id(x_user_id: Any) -> str:
    """Header 参数防御:直接调用端点函数(测试/内部)时默认值是 Header 对象而非 str。"""
    return x_user_id.strip() if isinstance(x_user_id, str) else ""


def _is_valid_admin_token(admin_token: Any) -> bool:
    token = admin_token.strip() if isinstance(admin_token, str) else ""
    if not token:
        return False

    from . import admin

    return token == admin.read_admin_password()


def _require_task_owner(
    task: Dict[str, Any] | None,
    requester_user_id: Any,
    detail: str = "无权访问该计划",
    admin_token: Any = "",
) -> None:
    if _is_valid_admin_token(admin_token):
        return

    task_user_id = str((task or {}).get("user_id") or "").strip()
    if task_user_id and task_user_id != _clean_user_id(requester_user_id):
        raise HTTPException(status_code=403, detail=detail)


def _create_task_state(task_id: str) -> Dict[str, Any]:
    """初始化任务状态。"""
    return {
        "task_id": task_id,
        "plan_id": task_id,
        "status": "processing",
        "stage": "submitted",
        "progress": 0,
        "message": "任务已提交，等待执行...",
        "details": [],  # list[dict] — 前端展示的详细步骤
        "result": None,
        "error": None,
        "user_id": "",
        "share_token": "",
        "request_payload": None,
        "subscribers": [],  # list[asyncio.Queue]
    }


def _serialize_result(result: Any) -> Any:
    if result is None:
        return None
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    return result


def _task_file_path(task_id: str) -> Path:
    """获取任务持久化文件路径。"""
    return _TASKS_DATA_DIR / f"{task_id}.json"


def _normalize_loaded_task(task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """将磁盘中的任务结构恢复为内存可用格式。"""
    task = _create_task_state(task_id)
    task.update(
        {
            "plan_id": payload.get("plan_id", task_id),
            "status": payload.get("status", "failed"),
            "stage": payload.get("stage", "failed"),
            "progress": payload.get("progress", 100),
            "message": payload.get("message", ""),
            "result": payload.get("result"),
            "error": payload.get("error"),
            "user_id": payload.get("user_id", ""),
            "share_token": payload.get("share_token", ""),
            "request_payload": payload.get("request_payload"),
        }
    )
    task["subscribers"] = []

    # 服务重启后，处理中任务无法恢复执行，直接标记为失败，避免前端无限等待。
    if task["status"] not in _FINAL_TASK_STATUS:
        task["status"] = "failed"
        task["stage"] = "failed"
        task["progress"] = 100
        task["error"] = "服务已重启，未完成的旅行规划任务无法恢复，请重新生成。"
        task["message"] = task["error"]

    return task


def _persist_task_state(task_id: str, task: Dict[str, Any]) -> None:
    """将任务状态持久化到本地 JSON 文件。"""
    try:
        _TASKS_DATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "task_id": task_id,
            "plan_id": task.get("plan_id", task_id),
            "status": task.get("status", "processing"),
            "stage": task.get("stage", ""),
            "progress": task.get("progress", 0),
            "message": task.get("message", ""),
            "result": _serialize_result(task.get("result")),
            "error": task.get("error"),
            "user_id": task.get("user_id", ""),
            "share_token": task.get("share_token", ""),
            "request_payload": task.get("request_payload"),
        }
        target = _task_file_path(task_id)
        tmp = target.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        tmp.replace(target)
    except Exception as e:
        print(f"⚠️  持久化任务 {task_id} 失败: {e}")


def _load_task_from_disk(task_id: str) -> Dict[str, Any] | None:
    """从磁盘加载单个任务。"""
    path = _task_file_path(task_id)
    if not path.exists():
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, dict):
            return None
        task = _normalize_loaded_task(task_id, payload)
        _tasks[task_id] = task
        return task
    except Exception as e:
        print(f"⚠️  读取任务 {task_id} 失败: {e}")
        return None


def _migrate_legacy_tasks_dir() -> None:
    """一次性迁移旧目录 backend/data/trip_tasks 到新数据目录。"""
    legacy_dir = Path(__file__).resolve().parents[3] / "data" / "trip_tasks"
    if not legacy_dir.exists():
        return

    legacy_files = list(legacy_dir.glob("*.json"))
    if not legacy_files:
        try:
            legacy_dir.rmdir()
        except OSError:
            pass
        return

    _TASKS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    moved = 0
    for src in legacy_files:
        dst = _TASKS_DATA_DIR / src.name
        if dst.exists():
            continue
        try:
            src.rename(dst)
        except OSError:
            # 跨设备时回退为 copy + delete
            try:
                shutil.copy2(src, dst)
                src.unlink()
            except OSError as e:
                print(f"⚠️  迁移旧任务数据 {src.name} 失败: {e}")
                continue
        moved += 1

    if moved:
        print(f"📦 已从旧目录 backend/data/trip_tasks 迁移 {moved} 个任务文件")

    if not list(legacy_dir.glob("*.json")):
        try:
            legacy_dir.rmdir()
        except OSError:
            pass


def _load_persisted_tasks() -> None:
    """服务启动时预加载历史任务。"""
    _migrate_legacy_tasks_dir()

    if not _TASKS_DATA_DIR.exists():
        return

    loaded = 0
    for path in sorted(_TASKS_DATA_DIR.glob("*.json")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                continue
            task_id = str(payload.get("task_id") or path.stem)
            _tasks[task_id] = _normalize_loaded_task(task_id, payload)
            loaded += 1
        except Exception as e:
            print(f"⚠️  加载历史任务 {path.name} 失败: {e}")

    if loaded:
        print(f"📦 已加载 {loaded} 个持久化旅行任务")


def _get_task(task_id: str) -> Dict[str, Any] | None:
    """优先从内存读取任务，不存在时回退到磁盘。"""
    return _tasks.get(task_id) or _load_task_from_disk(task_id)


def _build_history_item(task_id: str, payload: Dict[str, Any], updated_at: str) -> Dict[str, Any] | None:
    """从持久化任务中提取首页历史列表所需的摘要（含进行中/失败状态）。"""
    status = str(payload.get("status") or "processing")
    if status not in {"completed", "processing", "failed"}:
        status = "failed"

    result = payload.get("result") or {}
    plan = result.get("data") or {}
    request_payload = payload.get("request_payload") or {}

    # result 可能为空（进行中/失败），城市/日期从 request_payload 兜底
    city = plan.get("city") or request_payload.get("city") or ""
    cities = plan.get("cities") or request_payload.get("cities") or []
    start_date = plan.get("start_date") or request_payload.get("start_date") or ""
    end_date = plan.get("end_date") or request_payload.get("end_date") or ""
    days = plan.get("days") or []
    travel_days = request_payload.get("travel_days") or (len(days) if isinstance(days, list) else 0)
    overall_suggestions = plan.get("overall_suggestions") or result.get("message") or ""

    if not city and not cities:
        return None

    # 多城市时 city 显示为 "北京 → 西安" 形式
    display_city = ' → '.join(cities) if len(cities) > 1 else city

    return {
        "plan_id": payload.get("plan_id", task_id),
        "task_id": task_id,
        "status": status,
        "user_id": str(payload.get("user_id") or ""),
        "city": display_city,
        "cities": cities,
        "start_date": start_date,
        "end_date": end_date,
        "travel_days": travel_days,
        "updated_at": updated_at,
        "overall_suggestions": overall_suggestions,
    }


def _load_history_items(limit: int = 10, user_id: str = "", all_users: bool = False) -> list[Dict[str, Any]]:
    """按最近更新时间返回历史计划摘要。

    all_users=True(管理端)返回全部;否则 user_id 非空时只返回该用户的任务,
    user_id 为空时只返回无主(legacy)任务。
    """
    if not _TASKS_DATA_DIR.exists():
        return []

    items: list[Dict[str, Any]] = []
    for path in sorted(_TASKS_DATA_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                continue
            updated_at = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
            item = _build_history_item(str(payload.get("task_id") or path.stem), payload, updated_at)
            if item:
                if not all_users and (item.get("user_id") or "") != (user_id or ""):
                    continue
                items.append(item)
            if len(items) >= limit:
                break
        except Exception as e:
            print(f"⚠️  读取历史任务 {path.name} 失败: {e}")

    return items


def _build_task_event(task_id: str, task: Dict[str, Any], include_result: bool = True) -> Dict[str, Any]:
    """从任务状态构建对前端可消费的事件对象。"""
    event = {
        "task_id": task_id,
        "plan_id": task.get("plan_id", task_id),
        "status": task.get("status", "processing"),
        "stage": task.get("stage", ""),
        "progress": task.get("progress", 0),
        "message": task.get("message", ""),
    }
    # 附带详细步骤（仅发送最新一批，避免重复）
    details = task.get("details") or []
    if details:
        event["details"] = details
    if task.get("error"):
        event["error"] = task["error"]
    if task.get("status") == "failed" and task.get("request_payload") is not None:
        event["request_payload"] = task["request_payload"]
    if include_result and task.get("result") is not None:
        event["result"] = _serialize_result(task["result"])
    return event


def _broadcast_task_event(task_id: str, event: Dict[str, Any]) -> None:
    """将任务事件广播给当前所有 WebSocket 订阅者。"""
    task = _tasks.get(task_id)
    if not task:
        return

    dead_queues = []
    for queue in task.get("subscribers", []):
        try:
            queue.put_nowait(event)
        except Exception:
            dead_queues.append(queue)

    if dead_queues:
        task["subscribers"] = [q for q in task.get("subscribers", []) if q not in dead_queues]


async def _update_task_state(
    task_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    progress: int | None = None,
    message: str | None = None,
    details: list | None = None,
    result: Any = None,
    error: str | None = None,
) -> None:
    """更新任务状态并广播事件。"""
    task = _tasks.get(task_id)
    if not task:
        return

    if status is not None:
        task["status"] = status
    if stage is not None:
        task["stage"] = stage
    if progress is not None:
        task["progress"] = progress
    if message is not None:
        task["message"] = message
    if details is not None:
        # 追加 details 而非覆盖，前端需要累积历史
        task["details"] = (task.get("details") or []) + details
    if result is not None:
        task["result"] = result
    if error is not None:
        task["error"] = error

    _persist_task_state(task_id, task)
    event = _build_task_event(task_id, task, include_result=True)
    _broadcast_task_event(task_id, event)


class TripParseRequest(BaseModel):
    text: str = Field(..., max_length=500)
    language: str = "zh"
    today: str = ""
    # 最近对话历史 [{role: "user"|"assistant", content: "..."}],供意图与情绪判断
    history: list = Field(default_factory=list)


def _sse_line(obj: dict) -> str:
    """把一个事件对象序列化为一行 SSE。"""
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


async def _stream_and_extract(prompt: str, field: str, on_delta) -> str:
    """流式调用 LLM:边生成边把 `field` 字段的增量文本交给 on_delta,返回完整原文。"""
    buffer = ""
    emitted = 0
    async for piece in iter_llm_stream(prompt, temperature=0.1, disable_thinking=True):
        buffer += piece
        value, _closed = stream_extract_string_field(buffer, field)
        if len(value) > emitted:
            await on_delta(value[emitted:])
            emitted = len(value)
    return buffer


def _sse_from_core(core_factory) -> StreamingResponse:
    """把一个 ``async core(on_delta) -> dict`` 包成 SSE 响应:
    先流式推 delta 文本事件,再推一条 final 结构化结果,最后 ``[DONE]``。"""

    async def gen():
        queue: "asyncio.Queue" = asyncio.Queue()

        async def on_delta(text: str) -> None:
            await queue.put(("delta", text))

        async def run():
            try:
                result = await core_factory(on_delta)
                await queue.put(("final", result))
            except Exception as exc:  # noqa: BLE001 - 兜底转成 error 事件
                await queue.put(("error", str(exc)))
            finally:
                await queue.put(("__done__", None))

        task = asyncio.create_task(run())
        try:
            while True:
                kind, data = await queue.get()
                if kind == "__done__":
                    break
                if kind == "delta":
                    yield _sse_line({"type": "delta", "text": data})
                elif kind == "final":
                    yield _sse_line({"type": "final", "payload": data})
                elif kind == "error":
                    yield _sse_line({"type": "error", "message": data})
            yield "data: [DONE]\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _parse_core(payload: TripParseRequest, x_user_id: str = "", *, on_delta=None):
    import re as _re
    from datetime import datetime as _dt, timedelta as _td
    from ...services.llm_service import get_llm_settings, get_openai_client

    today_str = payload.today or _dt.now().strftime("%Y-%m-%d")
    try:
        tomorrow = (_dt.strptime(today_str, "%Y-%m-%d") + _td(days=1)).strftime("%Y-%m-%d")
    except ValueError:
        # today 格式非法时回退用当前日期，避免 500
        today_str = _dt.now().strftime("%Y-%m-%d")
        tomorrow = (_dt.now() + _td(days=1)).strftime("%Y-%m-%d")

    history_lines = []
    for h in (payload.history or [])[-10:]:
        if not isinstance(h, dict):
            continue
        content = str(h.get("content") or "").strip()[:200]
        if not content:
            continue
        role = "用户" if h.get("role") == "user" else "游伴"
        history_lines.append(f"{role}: {content}")
    history_text = "\n".join(history_lines) or "(无对话历史)"

    _parse_user_id = _clean_user_id(x_user_id)
    memory_text = await asyncio.to_thread(
        memory_service.recall_sync, _parse_user_id, payload.text
    ) if _parse_user_id else ""
    memory_block = memory_text or "(暂无,可正常对话)"

    prompt = f"""你是"游伴"旅行智能体的需求理解模块。今天是 {today_str}。
你的任务：理解用户意图，像朋友一样用对话帮用户明确旅行想法。先读对话历史、观察用户情绪，再决定动作。

【用户长期记忆】(来自该用户过往对话与行程,用于个性化推荐):
{memory_block}

记忆使用规则:
- action=recommend 时优先推荐符合用户偏好的目的地,并在 reason 里自然引用记忆(如"你之前提过喜欢海边")
- 避免把用户近期已规划/已去过的城市当新推荐,除非用户主动提出重去
- action=plan 时用记忆补全用户没说的偏好(preferences 等),并列入 inferred_fields

对话历史（旧的在前）：
{history_text}

请输出严格 JSON（不要输出任何其他文字）：
{{
  "action": "plan|clarify|recommend|chat",
  "emotion": "neutral|uncertain|frustrated|excited|anxious",
  "reply": "给用户的简短回应（口语化、有温度、与用户同语言）",
  "follow_up_question": "最多一个帮助用户做选择的问题，没有则为空字符串",
  "cities": [{{"city": "城市名", "days": 天数}}],
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "transportation": "公共交通|自驾|步行|混合",
  "accommodation": "经济型酒店|舒适型酒店|豪华酒店|民宿",
  "preferences": ["历史文化|自然风光|美食|购物|艺术|休闲 中匹配的标签"],
  "need_clarify": false,
  "clarify_question": "",
  "summary": "一句话行程摘要",
  "ready_to_generate": false,
  "suggestions": [],
  "inferred_fields": [],
  "recommendations": [{{"destination": "城市名", "reason": "一句话推荐理由", "suggested_days": 3}}]
}}

动作判断（先意图，后字段）：
1. action=plan：用户明确表达要规划/安排某个目的地，或明确选中了上一轮推荐（如"就去九寨沟""第二个吧""帮我安排成都4天"）→ 解析行程字段，规则见下；仅仅提到目的地名称不等于要生成计划
2. action=recommend：用户在找目的地灵感、还没决定去哪（如"国庆去哪玩好""给我推荐一下"）→ recommendations 给 2-4 个具体目的地，结合当前季节和节假日特点（如国庆热门地人多，可兼顾舒适度和体验），每个附一句话理由和建议天数；reply 先回应用户情绪和诉求，不要把推荐列表重复写进 reply；follow_up_question 只问一个轻松的二选一偏好问题（如"更想要山水风光，还是逛吃人文？"）
3. action=clarify：用户已经明确要规划行程，但缺最关键的信息（如说"帮我规划"却没定城市）→ reply 先自然回应，follow_up_question 只追问最关键的那一个信息
4. action=chat：闲聊、旅行咨询或目的地探索问答（如"九寨沟有什么玩""值得去吗""先介绍一下景点""国庆人多吗"）→ 直接回答问题，可给具体景点/体验/取舍建议；不要创建行程草稿，不要声称开始生成，结尾可轻问是否需要继续比较或规划
5. 必须解析多轮指代：用户说"第一个/第二个/就去这个/还是上一个/换一个"时，结合历史中的推荐顺序和对象理解；选中某个目的地后 action=plan，并把该目的地写入 cities，绝不能重新追问"想去哪里"

情绪与对话策略（重要）：
- 读历史判断用户状态：如果用户在重复同一诉求、或显露不耐烦/催促（如"你倒是推荐啊""快点""算了"），绝不重复之前已经问过的问题，立刻改变策略给出具体推荐或方案
- 用户不耐烦时，简短承认自己前面没有直接解决问题（如"明白，你是想让我直接给方案，不想再被反问"），随后马上给内容；不要说"别着急""冷静""好啦好啦"，不要给用户贴情绪标签，也不要过度道歉或承诺"保证满意"
- 用户纠结时主动帮他做减法（给 2 选 1），不要把一堆问题抛给用户
- 先回应情绪再给内容，reply 要有同理心，像朋友不像表单

行程字段规则（仅 action=plan 时需要严谨填写，其余动作给默认值即可）：
1. 用户未提日期 → start_date 用 {tomorrow}（明天）；提到"下周末""国庆"等相对日期请换算为具体日期
2. 未提天数 → 每个城市 3 天；end_date = start_date + 总天数 - 1
3. 未提交通/住宿 → 公共交通 / 经济型酒店
4. 如果当前消息和历史中都没有任何可辨认的城市或目的地，且用户并非在要推荐 → action=clarify，reply 用友好语气追问
5. preferences 只能从给定标签中选取，没有匹配则空数组
6. clarify_question 与 reply 含义一致时可只填 reply；summary 在 action=plan 时填写
7. inferred_fields 列出用户【没有明确提到、由你按默认值填充】的字段，只能从这些值中选取："dates"（日期）、"transportation"（交通）、"accommodation"（住宿）、"preferences"（偏好）；用户明确说过的不要列入，全部提到则为空数组
8. ready_to_generate：仅表示需求字段完整度——同时满足 (a) 目的地明确 (b) 出行日期或天数明确 (c) 偏好、交通、住宿等个性化需求中至少两项被明确提到 → true；否则 false。它绝不表示用户已确认生成，任何情况下都不能声称已开始生成
9. suggestions：action=plan 且 ready_to_generate=false 时，站在旅行规划师角度针对没说清的部分给 2-4 条具体个性化建议，每条一句话；其余情况给空数组
用户最新消息：{payload.text}"""

    is_en = str(payload.language or "").lower().startswith("en")
    is_ja = str(payload.language or "").lower().startswith("ja")
    fallback_reply = (
        "I can help narrow it down—would you prefer nature and scenery, or food and culture?"
        if is_en else
        "行き先選びから一緒に考えましょう。自然や景色と、グルメや文化なら、どちらが気になりますか？"
        if is_ja else
        "没问题，我可以直接帮你缩小范围。你更想看自然风光，还是逛吃和人文？"
    )
    defaults = {
        "success": True,
        "action": "clarify",
        "emotion": "neutral",
        "reply": fallback_reply,
        "recommendations": [],
        "need_clarify": True,
        "clarify_question": fallback_reply,
        "summary": "",
        "trip": None,
    }

    try:
        if on_delta is not None:
            content = await _stream_and_extract(prompt, "reply", on_delta)
        else:
            client = get_openai_client()
            model_id = get_llm_settings()["model"]
            response = await asyncio.to_thread(
                lambda: client.chat.completions.create(
                    model=model_id,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                )
            )
            content = response.choices[0].message.content or ""
        match = _re.search(r'\{[\s\S]*\}', content)
        data = json.loads(match.group() if match else content)
    except Exception as e:
        print(f"⚠️ 自然语言解析失败: {e}")
        return defaults

    # 对话轮次交给 mem0 后台提取用户偏好(失败静默,不阻塞响应)
    if _parse_user_id:
        _reply_for_memory = str(data.get("reply") or "")[:500]
        memory_service.remember_background(
            _parse_user_id,
            [{"role": "user", "content": payload.text},
             {"role": "assistant", "content": _reply_for_memory}],
            metadata={"source": "parse"},
        )

    try:
        def _safe_days(v):
            try:
                return max(1, min(int(v), 15))
            except (TypeError, ValueError):
                return 3

        action = str(data.get("action") or "plan").strip().lower()
        if action not in {"plan", "clarify", "recommend", "chat"}:
            action = "clarify"
        emotion = str(data.get("emotion") or "neutral").strip().lower()
        if emotion not in {"neutral", "uncertain", "frustrated", "excited", "anxious"}:
            emotion = "neutral"
        reply = str(data.get("reply") or data.get("clarify_question") or fallback_reply).strip()
        follow_up = str(data.get("follow_up_question") or "").strip()
        recommendations = []
        for rec in (data.get("recommendations") or [])[:4]:
            if not isinstance(rec, dict):
                continue
            destination = str(rec.get("destination") or "").strip()
            if not destination:
                continue
            recommendations.append({
                "destination": destination,
                "reason": str(rec.get("reason") or "").strip(),
                "suggested_days": _safe_days(rec.get("suggested_days", 3)),
            })

        # 推荐/闲聊/追问无需强行造出城市,直接把 agent 的对话回复返回给前端
        if action != "plan":
            return {
                "success": True,
                "action": action,
                "emotion": emotion,
                "reply": reply,
                "follow_up_question": follow_up,
                "recommendations": recommendations,
                "need_clarify": action in {"clarify", "recommend"},
                "clarify_question": reply,
                "ready_to_generate": False,
                "summary": "",
                "trip": None,
            }

        cities = [
            {"city": str(c.get("city", "")).strip(), "days": _safe_days(c.get("days", 3))}
            for c in (data.get("cities") or [])
            if isinstance(c, dict) and str(c.get("city", "")).strip()
        ]
        if not cities:
            return {
                **defaults,
                "emotion": emotion,
                "reply": reply,
                "clarify_question": reply,
            }

        start_date = str(data.get("start_date") or tomorrow)
        total_days = min(sum(c["days"] for c in cities), 30)
        expected_end_date = (
            _dt.strptime(start_date, "%Y-%m-%d") + _td(days=total_days - 1)
        ).strftime("%Y-%m-%d")
        end_date = str(data.get("end_date") or "")
        if end_date != expected_end_date:
            end_date = expected_end_date

        need_clarify = bool(data.get("need_clarify")) and not cities
        known_inferred = {"dates", "transportation", "accommodation", "preferences"}
        inferred_fields = [
            str(f) for f in (data.get("inferred_fields") or [])
            if str(f) in known_inferred
        ]
        # 只接受模型输出的真实 JSON 布尔 true；字符串 "false" 不能按 Python 真值变成 True
        ready_to_generate = data.get("ready_to_generate") is True
        suggestions = [
            str(s).strip() for s in (data.get("suggestions") or [])
            if str(s).strip()
        ][:4]
        if ready_to_generate:
            # 字段已完整时不需要补充建议,但仍须等待用户确认
            suggestions = []
            inferred_fields = []
        trip_data = {
            "city": cities[0]["city"],
            "cities": cities,
            "start_date": start_date,
            "end_date": end_date,
            "travel_days": total_days,
            "transportation": str(data.get("transportation") or "公共交通"),
            "accommodation": str(data.get("accommodation") or "经济型酒店"),
            "preferences": [str(p) for p in (data.get("preferences") or [])],
            "free_text_input": payload.text,
            "origin_text": payload.text,
            "inferred_fields": inferred_fields,
            "suggestions": suggestions,
        }
        return {
            "success": True,
            "action": "plan",
            "emotion": emotion,
            "reply": reply,
            "follow_up_question": follow_up,
            "recommendations": recommendations,
            "need_clarify": need_clarify,
            "ready_to_generate": ready_to_generate,
            "clarify_question": str(data.get("clarify_question") or reply),
            "summary": str(data.get("summary") or ""),
            "trip": trip_data,
        }
    except Exception as e:
        print(f"⚠️ 解析结果后处理失败: {e}")
        return defaults


@router.post("/parse", summary="自然语言行程解析", description="把一句话旅行描述解析为结构化 TripRequest")
async def parse_trip_text(payload: TripParseRequest, x_user_id: str = Header(default="")):
    return await _parse_core(payload, x_user_id)


@router.post(
    "/parse/stream",
    summary="自然语言行程解析(流式)",
    description="SSE 流式:边生成边推 reply 文本增量,结束推完整结构化结果",
)
async def parse_trip_text_stream(payload: TripParseRequest, x_user_id: str = Header(default="")):
    return _sse_from_core(lambda on_delta: _parse_core(payload, x_user_id, on_delta=on_delta))


class TripConfirmReplyRequest(BaseModel):
    text: str = Field(..., max_length=500)
    draft: dict = Field(default_factory=dict)
    language: str = "zh"
    today: str = ""
    history: list = Field(default_factory=list)


async def _confirm_core(payload: TripConfirmReplyRequest, *, on_delta=None):
    import re as _re
    from datetime import datetime as _dt, timedelta as _td
    from ...services.llm_service import get_llm_settings, get_openai_client

    today_str = payload.today or _dt.now().strftime("%Y-%m-%d")
    try:
        _dt.strptime(today_str, "%Y-%m-%d")
    except ValueError:
        # today 格式非法时回退用当前日期，避免 500
        today_str = _dt.now().strftime("%Y-%m-%d")

    draft = payload.draft or {}
    history_lines = []
    for h in (payload.history or [])[-10:]:
        if not isinstance(h, dict):
            continue
        content = str(h.get("content") or "").strip()[:200]
        if not content:
            continue
        role = "用户" if h.get("role") == "user" else "游伴"
        history_lines.append(f"{role}: {content}")
    history_text = "\n".join(history_lines) or "(无对话历史)"

    draft_json = json.dumps({
        "cities": draft.get("cities") or [],
        "start_date": draft.get("start_date") or "",
        "end_date": draft.get("end_date") or "",
        "transportation": draft.get("transportation") or "",
        "accommodation": draft.get("accommodation") or "",
        "preferences": draft.get("preferences") or [],
    }, ensure_ascii=False)

    authorization_language = str(payload.language or "").strip().replace("_", "-")
    language = authorization_language.lower()
    if language.startswith("en"):
        fallback_message = "Would you like me to start planning from the current draft?"
    elif language.startswith("ja"):
        fallback_message = "現在の下書きで旅行プランの作成を開始しますか？"
    else:
        fallback_message = "你是想按当前这份草稿开始生成计划吗？"

    prompt = f"""你是旅行规划助手的意图判断模块。今天是 {today_str}。
当前有一份待用户确认的行程草稿：
{draft_json}

最近对话历史：
{history_text}

用户针对这份草稿回复了一句话。结合最近对话、当前草稿、最新回复和语气判断，不使用任何固定词表。输出严格 JSON（不要输出任何其他文字）：
{{
  "action": "confirm|update|cancel|chat|ask_confirmation",
  "confidence": 0.0,
  "message": "自然语言回复",
  "cities": [],
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "transportation": "公共交通",
  "accommodation": "经济型酒店",
  "preferences": [],
  "inferred_fields": [],
  "suggestions": []
}}
规则：
1. confidence 表示用户是否明确授权执行当前草稿，而不是字段完整度，取值范围为 0 到 1。
2. 用户回复“嗯”时，必须根据上一轮是否明确请求确认判断；普通聊天中的“嗯”不是确认。
3. 疑问、咨询、比较、继续了解目的地属于 chat，直接自然回答用户的问题。
4. 用户要求调整草稿时 action=update，在草稿基础上应用修改并输出完整行程字段；相对日期以今天 {today_str} 换算；未提天数的城市默认 3 天。
5. 只有能从上下文判断用户明确授权执行当前草稿时才使用 confirm；不够确定时 action=ask_confirmation，并自然追问一句。
6. cancel 表示用户不准备继续执行当前草稿；message 使用与用户回复相同的语言。
7. preferences 只能从给定标签中选取。
8. inferred_fields 只能使用 "dates"、"transportation"、"accommodation"、"preferences"；suggestions 仅在 update 时提供。
用户最新回复：{payload.text}"""

    try:
        if on_delta is not None:
            content = await _stream_and_extract(prompt, "message", on_delta)
        else:
            client = get_openai_client()
            model_id = get_llm_settings()["model"]
            response = await asyncio.to_thread(
                lambda: client.chat.completions.create(
                    model=model_id,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.1,
                )
            )
            content = response.choices[0].message.content or ""
        match = _re.search(r'\{[\s\S]*\}', content)
        data = json.loads(match.group() if match else content)
        if not isinstance(data, dict):
            raise ValueError("LLM confirmation response must be a JSON object")
    except Exception as e:
        print(f"⚠️ 确认回复意图判断失败: {e}")
        return {
            "success": True,
            "action": "ask_confirmation",
            "confidence": 0.0,
            "message": fallback_message,
            "trip": draft or None,
            "decision_id": "",
            "execution_token": "",
        }

    action = str(data.get("action") or "ask_confirmation").strip().lower()
    invalid_action = action not in ("confirm", "cancel", "update", "chat", "ask_confirmation")
    if invalid_action:
        action = "ask_confirmation"
    raw_confidence = data.get("confidence")
    if isinstance(raw_confidence, bool) or not isinstance(raw_confidence, (int, float)):
        confidence = 0.0
    elif not math.isfinite(raw_confidence):
        confidence = 0.0
    else:
        confidence = max(0.0, min(float(raw_confidence), 1.0))
    message = str(data.get("message") or "").strip()
    if invalid_action or (action == "confirm" and confidence < 0.85):
        action = "ask_confirmation"
        message = fallback_message
    elif action == "ask_confirmation":
        message = message or fallback_message

    def _build_trip():
        def _safe_days(v):
            try:
                return max(1, min(int(v), 15))
            except (TypeError, ValueError):
                return 3

        cities = [
            {"city": str(c.get("city", "")).strip(), "days": _safe_days(c.get("days", 3))}
            for c in (data.get("cities") or draft.get("cities") or [])
            if isinstance(c, dict) and str(c.get("city", "")).strip()
        ]
        if not cities:
            return None
        start_date = str(data.get("start_date") or draft.get("start_date") or today_str)
        try:
            _dt.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            start_date = today_str
        total_days = min(sum(c["days"] for c in cities), 30)
        expected_end_date = (
            _dt.strptime(start_date, "%Y-%m-%d") + _td(days=total_days - 1)
        ).strftime("%Y-%m-%d")
        end_date = str(data.get("end_date") or "")
        try:
            _dt.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            end_date = ""
        if end_date != expected_end_date:
            end_date = expected_end_date
        def _list_value(field):
            if field not in data:
                value = draft.get(field)
            else:
                value = data.get(field)
                if not isinstance(value, list):
                    value = draft.get(field)
            return value if isinstance(value, list) else []

        known_inferred = {"dates", "transportation", "accommodation", "preferences"}
        inferred_fields = [
            str(f) for f in _list_value("inferred_fields")
            if str(f) in known_inferred
        ]
        suggestions = [
            str(s).strip() for s in _list_value("suggestions")
            if str(s).strip()
        ][:4]
        trip_data = {
            "city": cities[0]["city"],
            "cities": cities,
            "start_date": start_date,
            "end_date": end_date,
            "travel_days": total_days,
            "transportation": str(data.get("transportation") or draft.get("transportation") or "公共交通"),
            "accommodation": str(data.get("accommodation") or draft.get("accommodation") or "经济型酒店"),
            "preferences": [str(p) for p in _list_value("preferences")],
            "free_text_input": str(draft.get("free_text_input") or ""),
            "origin_text": str(draft.get("origin_text") or ""),
            "inferred_fields": inferred_fields,
            "suggestions": suggestions,
        }
        return trip_data

    trip = _build_trip() if action == "update" else draft or None
    if action == "update" and not trip:
        # 修改后得不到有效行程时降级为对话追问,避免前端卡住
        action = "chat"
        message = message or fallback_message
        trip = draft or None
    if not message:
        message = fallback_message

    decision_id = ""
    execution_token = ""
    if action == "confirm":
        authorized_draft = {**draft, "language": authorization_language}
        decision_id, execution_token = register_confirm_decision(authorized_draft, confidence)

    return {
        "success": True,
        "action": action,
        "confidence": confidence,
        "message": message,
        "trip": trip,
        "decision_id": decision_id,
        "execution_token": execution_token,
    }


@router.post("/confirm-reply", summary="行程确认对话意图判断", description="待确认卡片期间,结合当前草稿判断用户回复是确认/取消/修改/闲聊")
async def confirm_trip_reply(payload: TripConfirmReplyRequest):
    return await _confirm_core(payload)


@router.post(
    "/confirm-reply/stream",
    summary="行程确认对话意图判断(流式)",
    description="SSE 流式:边生成边推 message 文本增量,结束推完整结构化结果",
)
async def confirm_trip_reply_stream(payload: TripConfirmReplyRequest):
    return _sse_from_core(lambda on_delta: _confirm_core(payload, on_delta=on_delta))


@router.post(
    "/plan",
    summary="提交旅行规划任务",
    description="异步提交旅行规划请求，立即返回 task_id；可通过 WebSocket 或 /trip/status/{task_id} 获取执行状态",
)
async def plan_trip(request: TripRequest, x_user_id: str = Header(default="")):
    """提交旅行规划任务（立即返回 task_id）。"""
    accepted, reason = consume_execution_token(request.execution_token, request)
    if not accepted:
        status_code = 409 if reason == "already_consumed" else 401 if reason == "expired" else 400
        detail = {
            "already_consumed": "该确认已执行，请勿重复提交",
            "expired": "确认已过期，请在对话中重新确认",
            "draft_mismatch": "行程草稿已变化，请重新确认",
        }.get(reason, "缺少有效的 Agent 确认凭证")
        raise HTTPException(status_code=status_code, detail=detail)

    task_id = str(uuid.uuid4())[:8]
    _user_id = _clean_user_id(x_user_id)
    _tasks[task_id] = _create_task_state(task_id)
    _tasks[task_id]["user_id"] = _user_id
    _tasks[task_id]["request_payload"] = request.model_dump(mode="json")
    _persist_task_state(task_id, _tasks[task_id])

    _city_display = ' → '.join(cs.city for cs in request.cities) if request.cities else request.city

    # 落盘对话记录（完整创建对话优先；旧客户端回退到原始输入与确认摘要）
    try:
        conv_dir = _TASKS_DATA_DIR.parent / "conversations"
        conv_dir.mkdir(parents=True, exist_ok=True)
        messages = [message.model_dump(mode="json") for message in request.conversation]
        if not messages:
            origin = (request.origin_text or "").strip()
            if origin:
                messages.append({"role": "user", "content": origin})
            messages.append({
                "role": "assistant",
                "content": f"已确认行程：{_city_display}，{request.start_date} 至 {request.end_date}，共 {request.travel_days} 天。",
            })
        target = conv_dir / f"{task_id}.json"
        tmp = target.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(
                {"plan_id": task_id, "user_id": _user_id, "messages": messages},
                f,
                ensure_ascii=False,
                indent=2,
            )
        tmp.replace(target)
    except Exception as e:
        print(f"⚠️  保存对话记录失败: {e}")

    print(f"\n{'=' * 60}")
    print(f"📥 收到旅行规划请求 (task_id={task_id}):")
    print(f"   城市: {_city_display}")
    print(f"   日期: {request.start_date} - {request.end_date}")
    print(f"   天数: {request.travel_days}")
    print(f"{'=' * 60}\n")

    await _update_task_state(
        task_id,
        status="processing",
        stage="submitted",
        progress=5,
        message="任务已提交，正在初始化流程...",
    )

    # 启动后台任务
    asyncio.create_task(_run_trip_planning(task_id, request, _user_id))

    return {
        "task_id": task_id,
        "plan_id": task_id,
        "status": "processing",
        "ws_url": f"/api/trip/ws/{task_id}",
        "message": f"任务已提交，可通过 WebSocket /api/trip/ws/{task_id} 实时订阅状态",
    }


async def _run_trip_planning(task_id: str, request: TripRequest, user_id: str = ""):
    """后台执行旅行规划并推送进度。"""
    import time as _time

    try:
        await _update_task_state(
            task_id,
            status="processing",
            stage="initializing",
            progress=10,
            message="正在获取多智能体系统实例...",
            details=[{
                "type": "thinking",
                "title": "正在初始化多智能体系统...",
                "timestamp": int(_time.time() * 1000),
            }],
        )
        agent = get_trip_planner_agent()

        city_display = ' → '.join(cs.city for cs in request.cities) if request.cities else request.city

        async def progress_callback(stage: str, message: str, progress: int, details: list | None = None) -> None:
            await _update_task_state(
                task_id,
                status="processing",
                stage=stage,
                progress=progress,
                message=message,
                details=details,
            )

        trip_plan = await agent.plan_trip(request, progress_callback=progress_callback, user_id=user_id)

        await _update_task_state(
            task_id,
            status="processing",
            stage="graph_building",
            progress=95,
            message="正在构建知识图谱...",
            details=[{
                "type": "planning",
                "title": f"🔗 正在构建 {city_display} 知识图谱...",
                "timestamp": int(_time.time() * 1000),
            }],
        )
        graph_data = build_knowledge_graph(trip_plan, language=getattr(request, 'language', 'zh') or 'zh')

        trip_result = TripPlanResponse(
            success=True,
            message="旅行计划生成成功",
            plan_id=task_id,
            data=trip_plan,
            graph_data=graph_data,
        )

        print(f"✅ 任务 {task_id} 完成")
        await _update_task_state(
            task_id,
            status="completed",
            stage="completed",
            progress=100,
            message="旅行计划生成成功",
            details=[{
                "type": "info",
                "title": "✅ 旅行计划生成完成！",
                "timestamp": int(_time.time() * 1000),
            }],
            result=trip_result,
        )

    except Exception as e:
        print(f"❌ 任务 {task_id} 失败: {e}")
        traceback.print_exc()

        error_msg = str(e)

        await _update_task_state(
            task_id,
            status="failed",
            stage="failed",
            progress=100,
            message=error_msg,
            error=error_msg,
        )


@router.websocket("/ws/{task_id}")
async def trip_task_ws(websocket: WebSocket, task_id: str):
    """WebSocket 订阅任务状态。"""
    await websocket.accept()
    task = _get_task(task_id)
    if not task:
        await websocket.send_json(
            {
                "task_id": task_id,
                "plan_id": task_id,
                "status": "failed",
                "stage": "failed",
                "progress": 100,
                "message": "任务不存在",
                "error": "任务不存在",
            }
        )
        await websocket.close(code=1008)
        return

    try:
        _require_task_owner(
            task,
            websocket.query_params.get("user_id"),
            admin_token=websocket.query_params.get("admin_token"),
        )
    except HTTPException:
        await websocket.send_json(
            {
                "task_id": task_id,
                "plan_id": task_id,
                "status": "failed",
                "stage": "failed",
                "progress": 100,
                "message": "无权访问该计划",
                "error": "无权访问该计划",
            }
        )
        await websocket.close(code=1008)
        return

    queue: asyncio.Queue = asyncio.Queue()
    task["subscribers"].append(queue)

    # 先发送快照，保证前端后连也能同步当前状态
    snapshot = _build_task_event(task_id, task, include_result=True)
    await websocket.send_json(snapshot)
    if snapshot["status"] in _FINAL_TASK_STATUS:
        try:
            await websocket.close()
        except Exception:
            pass
        task["subscribers"] = [q for q in task.get("subscribers", []) if q is not queue]
        return

    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
            if event.get("status") in _FINAL_TASK_STATUS:
                break
    except WebSocketDisconnect:
        pass
    finally:
        task = _tasks.get(task_id)
        if task:
            task["subscribers"] = [q for q in task.get("subscribers", []) if q is not queue]
        try:
            await websocket.close()
        except Exception:
            pass


@router.get(
    "/plan/{plan_id}/conversation",
    summary="读取计划创建对话",
    description="返回指定计划在生成前归档的稳定文本对话",
)
async def get_plan_conversation(
    plan_id: str,
    x_user_id: str = Header(default=""),
    x_admin_token: str = Header(default=""),
):
    task = _get_task(plan_id)
    _require_task_owner(
        task,
        x_user_id,
        detail="无权访问该计划对话",
        admin_token=x_admin_token,
    )

    path = _TASKS_DATA_DIR.parent / "conversations" / f"{plan_id}.json"
    if not path.exists():
        return {"plan_id": plan_id, "messages": []}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"plan_id": plan_id, "messages": []}

    messages = payload.get("messages")
    return {"plan_id": plan_id, "messages": messages if isinstance(messages, list) else []}


@router.get(
    "/history",
    summary="最近历史计划",
    description="返回最近成功生成的旅行计划摘要，供首页快速找回历史计划",
)
async def get_trip_history(limit: int = 10, x_user_id: str = Header(default="")):
    """查询最近的历史计划摘要(按用户过滤;未登录只见无主任务)。"""
    safe_limit = max(1, min(int(limit or 10), 50))
    return {
        "items": _load_history_items(safe_limit, user_id=_clean_user_id(x_user_id)),
    }


def _cleanup_orphan_images(deleted_payload_text: str) -> int:
    """清理被删计划引用的缓存图片中不再被其他计划引用的孤儿文件。

    data/images/ 是按图片 URL 哈希的全局缓存,不同计划可能共享同一文件,
    因此只删除剩余任务文件中都不再出现的图片。返回删除的文件数。
    """
    images_dir = _TASKS_DATA_DIR.parent / "images"
    if not images_dir.exists():
        return 0

    referenced = {
        name.split("?")[0]
        for name in re.findall(r'/api/images/([^\s"\'\)]+)', deleted_payload_text)
    }
    if not referenced:
        return 0

    still_used: set[str] = set()
    for other in _TASKS_DATA_DIR.glob("*.json"):
        try:
            text = other.read_text(encoding="utf-8")
        except Exception:
            continue
        for name in referenced:
            if name in text:
                still_used.add(name)

    removed = 0
    for name in referenced - still_used:
        # 防路径穿越:只允许纯文件名
        if name != os.path.basename(name):
            continue
        try:
            (images_dir / name).unlink(missing_ok=True)
            removed += 1
        except OSError:
            pass
    return removed


@router.delete(
    "/plan/{task_id}",
    summary="删除旅行计划",
    description="删除指定任务的全部数据(任务状态/对话记录/无引用的缓存图片)；进行中的任务不可删除",
)
async def delete_trip_plan(task_id: str, x_user_id: str = Header(default="")):
    """删除一个旅行计划(任务)及其全部关联数据。"""
    task = _get_task(task_id)
    _require_task_owner(task, x_user_id)
    return await _delete_trip_plan(task_id, task)


async def _delete_trip_plan(task_id: str, task: Dict[str, Any] | None = None):
    """删除计划数据；调用方负责执行对应入口的权限校验。"""
    task = task if task is not None else _get_task(task_id)
    path = _task_file_path(task_id)
    if task is None and not path.exists():
        raise HTTPException(status_code=404, detail="计划不存在")
    if task and task.get("status") == "processing":
        # 后台仍在写状态文件,删掉也会被重建,拒绝删除
        raise HTTPException(status_code=409, detail="计划正在生成中，完成或失败后才能删除")

    # 先读出持久化文本,用于后续孤儿图片清理
    try:
        payload_text = path.read_text(encoding="utf-8") if path.exists() else ""
    except Exception:
        payload_text = ""

    _tasks.pop(task_id, None)
    try:
        path.unlink(missing_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {e}")

    # 对话记录一并删除
    try:
        (_TASKS_DATA_DIR.parent / "conversations" / f"{task_id}.json").unlink(missing_ok=True)
    except OSError:
        pass

    # 清理不再被任何计划引用的缓存图片
    removed_images = 0
    if payload_text:
        try:
            removed_images = _cleanup_orphan_images(payload_text)
        except Exception as e:
            print(f"⚠️  清理缓存图片失败: {e}")

    return {"success": True, "removed_images": removed_images}


@router.post(
    "/share/{task_id}",
    summary="发布旅行计划",
    description="由计划拥有者为已完成的行程生成可公开访问的高熵分享码",
)
async def create_shared_plan(
    task_id: str,
    x_user_id: str = Header(default=""),
    x_admin_token: str = Header(default=""),
):
    task = _get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="计划不存在")
    _require_task_owner(task, x_user_id, admin_token=x_admin_token)
    if task.get("status") != "completed" or not task.get("result"):
        raise HTTPException(status_code=409, detail="计划尚未完成，暂时无法分享")

    share_token = str(task.get("share_token") or "") or secrets.token_hex(16)
    task["share_token"] = share_token
    _persist_task_state(task_id, task)
    return {
        "plan_id": task.get("plan_id", task_id),
        "share_code": share_token,
    }


@router.get(
    "/share/{share_token}",
    summary="读取公开分享计划",
    description="凭公开分享令牌读取已完成的最终行程，不返回用户信息、创建对话或任务过程数据",
)
async def get_shared_plan(share_token: str):
    matched = next(
        (
            (task_id, task)
            for task_id, task in _tasks.items()
            if secrets.compare_digest(str(task.get("share_token") or ""), share_token)
        ),
        None,
    )
    if matched is None:
        raise HTTPException(status_code=404, detail="分享计划不存在或尚未完成")

    task_id, task = matched
    if task.get("status") != "completed" or not task.get("result"):
        raise HTTPException(status_code=404, detail="分享计划不存在或尚未完成")

    return {
        "plan_id": task.get("plan_id", task_id),
        "status": "completed",
        "result": _serialize_result(task.get("result")),
    }


@router.get(
    "/status/{task_id}",
    summary="查询任务状态",
    description="轮询旅行规划任务的执行状态和结果（兼容旧客户端）",
)
async def get_task_status(
    task_id: str,
    x_user_id: str = Header(default=""),
    x_admin_token: str = Header(default=""),
):
    """查询任务执行状态。"""
    task = _get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    _require_task_owner(task, x_user_id, admin_token=x_admin_token)

    if task["status"] == "completed":
        return {
            "task_id": task_id,
            "plan_id": task.get("plan_id", task_id),
            "status": "completed",
            "result": _serialize_result(task.get("result")),
        }
    if task["status"] == "failed":
        return {
            "task_id": task_id,
            "plan_id": task.get("plan_id", task_id),
            "status": "failed",
            "error": task.get("error", ""),
            "request_payload": task.get("request_payload"),
        }
    return {
        "task_id": task_id,
        "plan_id": task.get("plan_id", task_id),
        "status": "processing",
        "stage": task.get("stage", ""),
        "progress": task.get("progress", 0),
        "progress_text": task.get("message", "处理中..."),
    }


@router.get(
    "/health",
    summary="健康检查",
    description="检查旅行规划服务是否正常",
)
async def health_check():
    """健康检查。"""
    try:
        agent = get_trip_planner_agent()
        return {
            "status": "healthy",
            "service": "trip-planner",
            "agent_name": agent.name,
            "graph_nodes": 7,
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"服务不可用: {str(e)}")


_load_persisted_tasks()
