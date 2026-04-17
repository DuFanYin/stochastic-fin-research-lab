"""Shared helpers used by all route modules."""

from datetime import datetime, timezone
from math import isfinite
from uuid import uuid4

from src.services.engine_client import get_max_threads, is_engine_available

RAW_JSON_DECIMALS = 5


def _ts() -> str:
    return str(int(datetime.now(timezone.utc).timestamp() * 1_000_000_000))


def _diag(compute_ms: float | None = None, notes: list[str] | None = None) -> dict:
    d = {
        "engine_available": is_engine_available(),
        "threads": get_max_threads(),
        "timestamp": _ts(),
        "notes": notes or [],
    }
    if compute_ms is not None:
        d["compute_ms"] = compute_ms
    return d


def _norm(value):
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return None if not isfinite(value) else round(value, RAW_JSON_DECIMALS)
    if isinstance(value, list):
        return [_norm(v) for v in value]
    if isinstance(value, dict):
        return {k: _norm(v) for k, v in value.items()}
    return value


def _record(
    tool_name: str,
    input_params: dict,
    result_summary: dict,
    result_details: dict | None = None,
    diagnostics: dict | None = None,
) -> dict:
    return {
        "run_id":          str(uuid4()),
        "tool_name":       tool_name,
        "input_params":    _norm(input_params),
        "result_summary":  _norm(result_summary),
        "result_details":  _norm(result_details or {}),
        "diagnostics":     _norm(diagnostics or _diag()),
        "context_snapshot": {},
        "created_at":      _ts(),
    }
