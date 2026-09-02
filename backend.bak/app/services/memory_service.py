"""mem0 用户长期记忆服务(开源本地模式)。

铁律:记忆功能的任何故障都不得阻塞或破坏主流程 —— 所有公开函数
在异常时降级(recall 返回空串 / remember 静默丢弃),仅记日志。
"""

import concurrent.futures
import os
import threading
from typing import Any, Dict, List, Optional

from ..config import get_data_dir
from .llm_service import get_llm_settings

_lock = threading.Lock()
_memory = None
_memory_failed = False
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="mem0")


def _build_config() -> Dict[str, Any]:
    cfg = get_llm_settings()
    memory_dir = get_data_dir() / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    embedding_model = os.getenv("MEM0_EMBEDDING_MODEL", "text-embedding-3-small")
    embedding_base = os.getenv("MEM0_EMBEDDING_BASE_URL", cfg["base_url"])
    embedding_dims = int(os.getenv("MEM0_EMBEDDING_DIMS", "1536"))
    return {
        "llm": {"provider": "openai", "config": {
            "model": cfg["model"], "api_key": cfg["api_key"],
            "openai_base_url": cfg["base_url"],
            "temperature": 0.1, "max_tokens": 2000,
        }},
        "embedder": {"provider": "openai", "config": {
            "model": embedding_model, "api_key": cfg["api_key"],
            "openai_base_url": embedding_base,
            "embedding_dims": embedding_dims,
        }},
        "vector_store": {"provider": "qdrant", "config": {
            "collection_name": "tripstar_memories",
            "path": str(memory_dir / "qdrant"),
            "on_disk": True,
            "embedding_model_dims": embedding_dims,
        }},
        "history_db_path": str(memory_dir / "history.db"),
    }


def get_memory():
    """懒加载 mem0 Memory 单例;不可用返回 None(失败后本进程不再重试)。"""
    global _memory, _memory_failed
    if _memory is not None:
        return _memory
    if _memory_failed:
        return None
    with _lock:
        if _memory is not None or _memory_failed:
            return _memory
        cfg = get_llm_settings()
        if not cfg["api_key"]:
            print("⚠️  LLM API Key 未配置,用户记忆功能停用")
            _memory_failed = True
            return None
        try:
            from mem0 import Memory
            _memory = Memory.from_config(_build_config())
            print("🧠 mem0 用户记忆服务初始化成功")
        except Exception as e:
            print(f"⚠️  mem0 初始化失败,用户记忆功能停用: {e}")
            _memory_failed = True
    return _memory


def recall_sync(user_id: str, query: str, limit: int = 5) -> str:
    """检索用户记忆并格式化为提示词要点;任何异常返回空串。"""
    if not user_id:
        return ""
    memory = get_memory()
    if memory is None:
        return ""
    try:
        result = memory.search(query=query, user_id=user_id, limit=limit)
        items = result.get("results", result) if isinstance(result, dict) else result
        lines = []
        for item in items or []:
            text = str(item.get("memory") or "").strip() if isinstance(item, dict) else str(item).strip()
            if text:
                lines.append(f"- {text}")
        return "\n".join(lines)
    except Exception as e:
        print(f"⚠️  记忆检索失败(已降级): {e}")
        return ""


def remember_background(user_id: str, messages: List[Dict[str, str]],
                        metadata: Optional[Dict[str, Any]] = None) -> None:
    """后台线程写入记忆(fire-and-forget);无 user_id 或服务不可用时直接跳过。"""
    if not user_id or not messages:
        return
    if get_memory() is None:
        return

    def _do_add():
        try:
            memory = get_memory()
            if memory is not None:
                memory.add(messages, user_id=user_id, metadata=metadata or {})
        except Exception as e:
            print(f"⚠️  记忆写入失败(已忽略): {e}")

    _executor.submit(_do_add)


def list_memories(user_id: str) -> List[Dict[str, Any]]:
    if not user_id:
        return []
    memory = get_memory()
    if memory is None:
        return []
    try:
        result = memory.get_all(user_id=user_id)
        items = result.get("results", result) if isinstance(result, dict) else result
        return [
            {"id": str(it.get("id", "")), "memory": str(it.get("memory", "")),
             "created_at": str(it.get("created_at", ""))}
            for it in (items or []) if isinstance(it, dict)
        ]
    except Exception as e:
        print(f"⚠️  记忆列表读取失败: {e}")
        return []


def delete_memory(memory_id: str, user_id: str) -> bool:
    memory = get_memory()
    if memory is None or not memory_id:
        return False
    try:
        owned = {m["id"] for m in list_memories(user_id)}
        if memory_id not in owned:
            return False
        memory.delete(memory_id=memory_id)
        return True
    except Exception as e:
        print(f"⚠️  记忆删除失败: {e}")
        return False


def reset_memory_service() -> None:
    """配置热更新后重置(与 reset_llm 一起调用)。"""
    global _memory, _memory_failed
    with _lock:
        _memory = None
        _memory_failed = False
