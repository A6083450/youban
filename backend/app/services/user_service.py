"""昵称用户服务:昵称即登录,同昵称(casefold)视为同一用户。

轻量身份区分,非安全鉴权;存储于 data/users.json,进程内加锁 + 原子写。
"""

import json
import threading
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..config import get_data_dir

MAX_NICKNAME_LEN = 20

_lock = threading.Lock()
_cache: Optional[List[Dict[str, Any]]] = None


def _users_file():
    return get_data_dir() / "users.json"


def _load_users() -> List[Dict[str, Any]]:
    global _cache
    if _cache is not None:
        return _cache
    path = _users_file()
    users: List[Dict[str, Any]] = []
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("users"), list):
                users = [u for u in data["users"] if isinstance(u, dict) and u.get("user_id")]
        except Exception as e:
            print(f"⚠️  读取用户文件失败,视为空: {e}")
    _cache = users
    return users


def _save_users(users: List[Dict[str, Any]]) -> None:
    path = _users_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"users": users}, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def _normalize(nickname: str) -> str:
    return " ".join(str(nickname or "").split())


def login(nickname: str) -> Dict[str, Any]:
    """按昵称登录:存在(casefold 相同)即返回该用户,否则创建。"""
    display = _normalize(nickname)
    if not display:
        raise ValueError("昵称不能为空")
    if len(display) > MAX_NICKNAME_LEN:
        raise ValueError(f"昵称不能超过 {MAX_NICKNAME_LEN} 个字符")

    key = display.casefold()
    now = datetime.now().isoformat(timespec="seconds")
    with _lock:
        users = _load_users()
        for user in users:
            if str(user.get("nickname", "")).casefold() == key:
                user["last_login_at"] = now
                _save_users(users)
                return dict(user)
        user = {
            "user_id": uuid.uuid4().hex[:8],
            "nickname": display,
            "created_at": now,
            "last_login_at": now,
        }
        users.append(user)
        _save_users(users)
        return dict(user)


def list_users() -> List[Dict[str, Any]]:
    """返回全部用户(管理端用)。"""
    with _lock:
        return [dict(u) for u in _load_users()]


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    if not user_id:
        return None
    with _lock:
        for user in _load_users():
            if user.get("user_id") == user_id:
                return dict(user)
    return None


def clear_users_for_test(keep_file: bool = False) -> None:
    """重置内存缓存;keep_file=False 时连磁盘文件一起删(仅测试用)。"""
    global _cache
    with _lock:
        _cache = None
        if not keep_file:
            try:
                _users_file().unlink(missing_ok=True)
            except OSError:
                pass
