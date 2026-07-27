import base64
import hashlib
import hmac
import json
import math
import secrets
import threading
import time
import uuid
from typing import Any

_SECRET = secrets.token_bytes(32)
_DRAFT_FIELDS = (
    "city", "cities", "start_date", "end_date", "travel_days",
    "transportation", "accommodation", "preferences", "free_text_input",
    "origin_text", "language",
)
_CONFIRM_THRESHOLD = 0.85
_LEDGER: dict[str, dict[str, Any]] = {}
_LEDGER_LOCK = threading.RLock()


def _canonical_draft(draft: Any) -> dict[str, Any]:
    data = draft.model_dump(mode="json") if hasattr(draft, "model_dump") else dict(draft or {})
    canonical = {
        field: data.get(field) or ([] if field in {"cities", "preferences"} else None)
        for field in _DRAFT_FIELDS
    }
    language = str(data.get("language") or "").strip().replace("_", "-").lower()
    canonical["language"] = language or None
    return canonical


def _draft_hash(draft: Any) -> str:
    raw = json.dumps(_canonical_draft(draft), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def clear_confirmation_ledger() -> None:
    with _LEDGER_LOCK:
        _LEDGER.clear()


def register_confirm_decision(draft: Any, confidence: float, ttl_seconds: int = 600) -> tuple[str, str]:
    if not math.isfinite(confidence) or not _CONFIRM_THRESHOLD <= confidence <= 1.0:
        return "", ""
    now = time.time()
    decision_id = uuid.uuid4().hex
    nonce = secrets.token_urlsafe(16)
    expires_at = now + ttl_seconds
    payload = {"decision_id": decision_id, "nonce": nonce, "expires_at": expires_at, "draft_hash": _draft_hash(draft)}
    encoded = base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(_SECRET, encoded.encode(), hashlib.sha256).hexdigest()
    token = f"{encoded}.{signature}"
    with _LEDGER_LOCK:
        expired_ids = [
            existing_id
            for existing_id, entry in _LEDGER.items()
            if now >= entry["expires_at"]
        ]
        for expired_id in expired_ids:
            del _LEDGER[expired_id]
        _LEDGER[decision_id] = {**payload, "consumed": False}
    return decision_id, token


def _decode(token: object) -> tuple[dict[str, Any] | None, str]:
    try:
        encoded, supplied = str(token or "").rsplit(".", 1)
        expected = hmac.new(_SECRET, encoded.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(supplied, expected):
            return None, "invalid_signature"
        padded = encoded + "=" * (-len(encoded) % 4)
        return json.loads(base64.urlsafe_b64decode(padded)), "ok"
    except Exception:
        return None, "invalid_token"


def validate_execution_token(token: object, draft: Any) -> tuple[bool, str]:
    payload, reason = _decode(token)
    if not payload:
        return False, reason
    entry = _LEDGER.get(str(payload.get("decision_id") or ""))
    if not entry:
        return False, "unknown_decision"
    if entry["consumed"]:
        return False, "already_consumed"
    if time.time() >= entry["expires_at"]:
        return False, "expired"
    if entry["draft_hash"] != _draft_hash(draft):
        return False, "draft_mismatch"
    return True, "ok"


def consume_execution_token(token: object, draft: Any) -> tuple[bool, str]:
    with _LEDGER_LOCK:
        valid, reason = validate_execution_token(token, draft)
        if not valid:
            return False, reason
        payload, _ = _decode(token)
        _LEDGER[payload["decision_id"]]["consumed"] = True
        return True, "ok"
