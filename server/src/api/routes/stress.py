"""Stress pack metadata route."""

from fastapi import APIRouter

from src.services.stress_library import _PACK_SPECS

router = APIRouter(tags=["stress"])

_PACK_META = {
    "core4":       {"name": "Core 4",       "description": "Four canonical market shocks covering vol, rate, spot gap, and correlation breakdown."},
    "vol_first":   {"name": "Vol First",    "description": "Three volatility-driven scenarios: regime shift, vol crush, and skew panic."},
    "rates_first": {"name": "Rates First",  "description": "Three rate-driven scenarios: front-end jump, policy easing, and rate/vol divergence."},
    "crash_kit":   {"name": "Crash Kit",    "description": "Three severe crash scenarios: crash day, aftershock, and liquidity vacuum."},
}


@router.get("/tool/stress/packs")
def get_stress_packs() -> dict:
    """Return metadata for all available stress packs."""
    packs = []
    for pack_id, scenarios in _PACK_SPECS.items():
        meta = _PACK_META.get(pack_id, {"name": pack_id, "description": ""})
        scenario_list = [
            {
                "name": s.get("name", ""),
                "description": s.get("description", ""),
                "spot_mult_delta": s.get("spot_mult_delta", 0.0),
                "vol_mult_delta": s.get("vol_mult_delta", 0.0),
                "rate_shift": s.get("rate_shift", 0.0),
            }
            for s in scenarios
        ]
        packs.append({
            "id": pack_id,
            "name": meta["name"],
            "description": meta["description"],
            "scenario_count": len(scenarios),
            "scenarios": scenario_list,
            "version": "1.0",
        })
    return {"packs": packs}
