"""
market.py — live market data endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.services.market_data import fetch_btc_snapshot, pick_rate
from src.services.engine_client import vol_surface_interp

router = APIRouter(tags=["market"])


# ── GET /market/btc ───────────────────────────────────────────────────────────

@router.get("/market/btc")
async def get_btc_snapshot() -> dict:
    """
    Fetch a full live BTC market snapshot:
      spot, dvol, iv_surface, funding rate (→ mu), rate term structure.
    """
    return await fetch_btc_snapshot()


# ── POST /market/resolve ──────────────────────────────────────────────────────

class ResolveSurface(BaseModel):
    strike: float
    years:  float
    iv:     float
    iv_pct: float
    instrument: str = ""


class ResolveRequest(BaseModel):
    target_strike:  float = Field(..., gt=0)
    target_maturity: float = Field(..., gt=0)
    spot:           float = Field(..., gt=0)
    iv_surface:     list[ResolveSurface] = []
    rate_curve:     dict[str, float] = {}


class ResolveResponse(BaseModel):
    vol:          float
    vol_pct:      float
    rate:         float
    rate_pct:     float
    rate_tenor:   str
    iv_instrument: str
    iv_matched_strike: float
    iv_matched_years:  float
    interp_method: str   # "cpp_bilinear" | "py_nearest" | "dvol_fallback"


@router.post("/market/resolve", response_model=ResolveResponse)
def resolve_params(req: ResolveRequest) -> ResolveResponse:
    """
    Given a strike and maturity, resolve:
      - vol  : bilinear IV interpolation on the surface (C++ engine)
      - rate : linear interpolation on the rate term structure

    This offloads all market-parameter selection from the browser JS
    into the backend / C++ layer.
    """
    # ── Vol via C++ bilinear surface interpolation ────────────────────────────
    surface = [p.model_dump() for p in req.iv_surface]
    iv = vol_surface_interp(
        surface       = surface,
        spot          = req.spot,
        target_strike = req.target_strike,
        target_expiry = req.target_maturity,
    )

    if iv is not None:
        # Find which surface point is nearest for provenance metadata
        import math
        scale = req.target_strike
        best_pt = min(
            req.iv_surface,
            key=lambda p: math.hypot(
                (p.strike - req.target_strike) / scale,
                (p.years  - req.target_maturity),
            ),
        )
        interp_method   = "cpp_bilinear" if iv != best_pt.iv else "py_nearest"
        iv_instrument   = best_pt.instrument
        iv_matched_k    = best_pt.strike
        iv_matched_t    = best_pt.years
    else:
        # No surface — caller should fall back to DVOL
        iv              = 0.0
        interp_method   = "dvol_fallback"
        iv_instrument   = ""
        iv_matched_k    = req.target_strike
        iv_matched_t    = req.target_maturity

    # ── Rate via Python linear interpolation on term structure ────────────────
    tenor_label, rate = pick_rate(req.rate_curve, req.target_maturity)

    return ResolveResponse(
        vol               = round(iv, 6),
        vol_pct           = round(iv * 100, 3),
        rate              = round(rate, 6),
        rate_pct          = round(rate * 100, 4),
        rate_tenor        = tenor_label,
        iv_instrument     = iv_instrument,
        iv_matched_strike = iv_matched_k,
        iv_matched_years  = iv_matched_t,
        interp_method     = interp_method,
    )
