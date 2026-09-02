from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ..config import get_settings
from ..models.schemas import HotelCandidateInfo, Location
from ..tools.skill_registry import require_allowed_command
from ..tools.tool_audit_store import append_tool_trace


_PRICE_PATTERN = re.compile(
    r"(?<!\d)(\d[\d,]*(?:\.\d{1,2})?)([xX]+)?(?![\dxX])"
)
_CACHE_LOCK = threading.Lock()
_CACHE: dict[tuple[str, str, str, str], tuple[float, list[HotelCandidateInfo]]] = {}


class FlyAIProviderError(RuntimeError):
    pass


def _text(value: Any) -> str:
    return str(value or "").strip()


def _price(value: Any) -> float | None:
    raw = _text(value)
    match = _PRICE_PATTERN.search(raw)
    if not match:
        return None
    try:
        parsed = float(match.group(1).replace(",", ""))
        if match.group(2):
            parsed *= 10 ** len(match.group(2))
        parsed = round(parsed, 2)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _location(item: dict[str, Any]) -> Location | None:
    try:
        longitude = float(item.get("longitude"))
        latitude = float(item.get("latitude"))
    except (TypeError, ValueError):
        return None
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
        return None
    return Location(longitude=longitude, latitude=latitude)


def _http_url(value: Any) -> str:
    raw = _text(value)
    parsed = urlparse(raw)
    return raw if parsed.scheme in {"http", "https"} and parsed.netloc else ""


def _resolve_executable(custom_path: str) -> str:
    if custom_path:
        candidate = Path(custom_path).expanduser()
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
        raise FlyAIProviderError("FLYAI_CLI_PATH 不可执行")

    backend_root = Path(__file__).resolve().parents[2]
    local = backend_root / "node_modules" / ".bin" / "flyai"
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    global_cli = shutil.which("flyai")
    if global_cli:
        return global_cli
    raise FlyAIProviderError("FlyAI CLI 未安装，请在 backend 目录执行 npm install")


def _validated_date(value: str, field: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError) as error:
        raise FlyAIProviderError(f"{field} 日期无效") from error


class FlyAIProvider:
    skill_name = "flyai"
    command = "search-hotel"

    def search_hotels(
        self,
        destination: str,
        accommodation: str,
        check_in_date: str,
        check_out_date: str,
        limit: int = 10,
    ) -> list[HotelCandidateInfo]:
        settings = get_settings()
        if not settings.flyai_enabled:
            raise FlyAIProviderError("FlyAI 已禁用")
        destination = destination.strip()
        if not destination:
            raise FlyAIProviderError("酒店目的地不能为空")
        check_in_date = _validated_date(check_in_date, "入住")
        check_out_date = _validated_date(check_out_date, "退房")
        if check_out_date <= check_in_date:
            return []

        cache_key = (destination, accommodation.strip(), check_in_date, check_out_date)
        now = time.monotonic()
        with _CACHE_LOCK:
            cached = _CACHE.get(cache_key)
            if cached and now - cached[0] <= max(0, settings.flyai_cache_ttl_seconds):
                append_tool_trace({
                    "trace_id": uuid.uuid4().hex,
                    "skill": self.skill_name,
                    "command": self.command,
                    "provider": "flyai",
                    "status": "cache_hit",
                    "arguments": {
                        "destination": destination,
                        "check_in_date": check_in_date,
                        "check_out_date": check_out_date,
                    },
                    "result_count": len(cached[1]),
                })
                return [item.model_copy(deep=True) for item in cached[1][:limit]]

        manifest = require_allowed_command(self.skill_name, self.command)
        trace_id = uuid.uuid4().hex
        started = time.monotonic()
        arguments = {
            "destination": destination,
            "accommodation": accommodation.strip(),
            "check_in_date": check_in_date,
            "check_out_date": check_out_date,
        }
        try:
            executable = _resolve_executable(settings.flyai_cli_path)
            command = [
                executable,
                self.command,
                "--dest-name",
                destination,
                "--check-in-date",
                check_in_date,
                "--check-out-date",
                check_out_date,
            ]
            if accommodation.strip():
                command.extend(["--key-words", accommodation.strip()])
            environment = {
                key: os.environ[key]
                for key in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "SSL_CERT_FILE")
                if os.environ.get(key)
            }
            if settings.flyai_api_key:
                environment["FLYAI_API_KEY"] = settings.flyai_api_key
            policy_timeout = int(manifest["policy"]["timeout_seconds_max"])
            timeout = max(1, min(int(settings.flyai_timeout_seconds), policy_timeout))
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                env=environment,
            )
            stdout = completed.stdout.strip()
            max_bytes = int(manifest["policy"]["stdout_bytes_max"])
            if len(stdout.encode("utf-8")) > max_bytes:
                raise FlyAIProviderError("FlyAI 响应超过大小限制")
            if completed.returncode != 0:
                raise FlyAIProviderError(
                    f"FlyAI 查询失败 (exit={completed.returncode})"
                )
            try:
                payload = json.loads(stdout)
            except json.JSONDecodeError as error:
                raise FlyAIProviderError("FlyAI 未返回合法 JSON") from error
            if not isinstance(payload, dict) or payload.get("status") not in (0, "0"):
                message = _text(payload.get("message")) if isinstance(payload, dict) else ""
                raise FlyAIProviderError(message or "FlyAI 返回失败状态")

            raw_items = (payload.get("data") or {}).get("itemList") or []
            if not isinstance(raw_items, list):
                raise FlyAIProviderError("FlyAI 酒店列表格式无效")
            checked_at = datetime.now(timezone.utc).isoformat()
            candidates: list[HotelCandidateInfo] = []
            for raw in raw_items:
                if not isinstance(raw, dict):
                    continue
                provider_id = _text(raw.get("shId") or raw.get("id"))
                name = _text(raw.get("name"))
                if not provider_id or not name:
                    continue
                starting_price = _price(raw.get("price"))
                candidates.append(HotelCandidateInfo(
                    id=provider_id,
                    name=name,
                    type=_text(raw.get("star")),
                    address=_text(raw.get("address")),
                    location=_location(raw),
                    source="flyai",
                    starting_price=starting_price,
                    price_raw=_text(raw.get("price")),
                    price_status="estimated" if starting_price is not None else "unavailable",
                    price_checked_at=checked_at,
                    source_url=_http_url(raw.get("detailUrl")),
                    image_url=_http_url(raw.get("mainPic")),
                    rating=_text(raw.get("score")),
                    star=_text(raw.get("star")),
                ))
                if len(candidates) >= limit:
                    break

            response_hash = hashlib.sha256(stdout.encode("utf-8")).hexdigest()
            append_tool_trace({
                "trace_id": trace_id,
                "skill": self.skill_name,
                "skill_version": manifest["version"],
                "command": self.command,
                "cli_version": manifest["runtime"]["version"],
                "provider": "flyai",
                "status": "success",
                "arguments": arguments,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "result_count": len(candidates),
                "response_sha256": response_hash,
            })
            with _CACHE_LOCK:
                _CACHE[cache_key] = (now, [item.model_copy(deep=True) for item in candidates])
            return candidates
        except Exception as error:
            append_tool_trace({
                "trace_id": trace_id,
                "skill": self.skill_name,
                "command": self.command,
                "provider": "flyai",
                "status": "error",
                "arguments": arguments,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "error_type": type(error).__name__,
                "error": str(error)[:500],
            })
            if isinstance(error, FlyAIProviderError):
                raise
            if isinstance(error, subprocess.TimeoutExpired):
                raise FlyAIProviderError("FlyAI 查询超时") from error
            raise FlyAIProviderError(f"FlyAI 查询失败: {error}") from error


def clear_flyai_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
