from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from typing import Any

from ..config import get_data_dir


_AUDIT_LOCK = threading.Lock()


def append_tool_trace(trace: dict[str, Any]) -> None:
    """Append a redacted invocation record without exposing raw provider payloads."""
    record = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        **trace,
    }
    try:
        directory = get_data_dir() / "tool_audit"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{datetime.now(timezone.utc).date().isoformat()}.jsonl"
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with _AUDIT_LOCK, path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except Exception as error:
        print(f"⚠️ FlyAI 审计记录写入失败: {error}")
