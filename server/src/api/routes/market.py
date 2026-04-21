"""
market.py — live market data endpoints.
"""

from __future__ import annotations

import asyncio
import math

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.services.market_data import (
    fetch_btc_snapshot,
    pick_rate,
    _fetch_btc_spot,
    _fetch_btc_dvol,
    _fetch_funding_rate,
    _fetch_rate_curve,
    fetch_iv_surface,
    fetch_iv_smile_slice,
)
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


# ── Sub-endpoints for progressive frontend display ────────────────────────────

@router.get("/market/spot")
async def get_spot() -> dict:
    spot = await _fetch_btc_spot()
    return {"spot": round(spot, 2)}


@router.get("/market/dvol")
async def get_dvol() -> dict:
    dvol = await _fetch_btc_dvol()
    return {"vol": round(dvol, 4), "vol_pct": round(dvol * 100, 2)}


@router.get("/market/funding")
async def get_funding() -> dict:
    funding_ann = await _fetch_funding_rate()
    return {
        "mu": round(funding_ann, 4),
        "mu_pct": round(funding_ann * 100, 3),
        "funding_8h_pct": round((funding_ann / (3 * 365)) * 100, 4),
    }


@router.get("/market/rates")
async def get_rates() -> dict:
    curve = await _fetch_rate_curve()
    _, rate_3m = pick_rate(curve, 0.25)
    curve_pct = {k: round(v * 100, 3) for k, v in curve.items()}
    return {
        "rate": round(rate_3m, 4),
        "rate_pct": round(rate_3m * 100, 3),
        "rate_curve": curve,
        "rate_curve_pct": curve_pct,
    }


@router.get("/market/surface")
async def get_surface(spot: float) -> dict:
    surface_data = await fetch_iv_surface(spot)
    return {"iv_surface": surface_data["surface"]}


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


class IVDiagnosticsRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    maturity: float = Field(..., gt=0)
    smile_points: int = Field(17, ge=5, le=21)
    moneyness_steps: int = Field(15, ge=5, le=21)
    tenor_steps: int = Field(11, ge=5, le=21)
    burst_lower_quantile: float = Field(0.10, ge=0.0, le=0.49)
    burst_upper_quantile: float = Field(0.90, ge=0.51, le=1.0)


@router.post("/market/iv/diagnostics")
async def iv_diagnostics(req: IVDiagnosticsRequest) -> dict:
    """
    IV capability endpoint:
      - term structure (ATM-per-expiry)
      - smile slice around target maturity
      - local skew/curvature and interpolation diagnostics
    """
    surface_data = await fetch_iv_surface(req.spot)
    full_surface = surface_data["surface"]  # multi-strike, used for C++ interpolation

    # ATM row per expiry for the term structure chart (nearest strike to spot)
    atm_by_expiry: dict[str, dict] = {}
    for row in full_surface:
        exp = row.get("expiry", str(round(row["years"], 4)))
        if exp not in atm_by_expiry or abs(row["strike"] - req.spot) < abs(atm_by_expiry[exp]["strike"] - req.spot):
            atm_by_expiry[exp] = row
    term_rows = sorted(atm_by_expiry.values(), key=lambda r: r["years"])

    cpp_result = vol_surface_interp(
        surface=full_surface,
        spot=req.spot,
        target_strike=req.strike,
        target_expiry=req.maturity,
    )
    interp_iv = float(cpp_result[0]) if cpp_result is not None else None
    interp_method = str(cpp_result[1]) if cpp_result is not None else "unavailable"

    # Primary smile (nearest expiry to target maturity) — from real order book data
    smile = await fetch_iv_smile_slice(req.spot, req.maturity, req.strike, req.smile_points)
    smile_rows = smile["rows"]
    selected_years = smile["selected_years"]

    # Build smiles_by_expiry from the multi-strike surface (no extra API calls needed)
    smiles_by_expiry: dict[str, list] = {}
    for row in full_surface:
        exp = row.get("expiry", str(round(row["years"], 4)))
        if exp not in smiles_by_expiry:
            smiles_by_expiry[exp] = []
        smiles_by_expiry[exp].append({
            "instrument": row.get("instrument", ""),
            "strike": row["strike"],
            "years": row["years"],
            "log_moneyness": round(math.log(max(row["strike"], 1e-8) / max(req.spot, 1e-8)), 6),
            "iv": row["iv"],
            "iv_pct": row["iv_pct"],
        })

    skew = None
    curvature = None
    if len(smile_rows) >= 3:
        xs = [r["log_moneyness"] for r in smile_rows]
        ys = [r["iv"] for r in smile_rows]
        x_mean = sum(xs) / len(xs)
        y_mean = sum(ys) / len(ys)
        var_x = sum((x - x_mean) ** 2 for x in xs)
        cov_xy = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
        skew = cov_xy / var_x if var_x > 1e-12 else 0.0
        mid = len(smile_rows) // 2
        if 0 < mid < len(smile_rows) - 1:
            y0 = smile_rows[mid - 1]["iv"]
            y1 = smile_rows[mid]["iv"]
            y2 = smile_rows[mid + 1]["iv"]
            curvature = y0 - 2 * y1 + y2

    # Risk-surface style S-vol-T grid on top of interpolated term surface
    k_steps = req.moneyness_steps
    t_steps = req.tenor_steps
    k_min = 0.75
    k_max = 1.25
    t_min = max(1.0 / 365.0, req.maturity * 0.4)
    t_max = max(t_min + 1e-6, req.maturity * 1.8)
    k_values = [
        k_min + (k_max - k_min) * i / (k_steps - 1) for i in range(k_steps)
    ]
    t_values = [
        t_min + (t_max - t_min) * i / (t_steps - 1) for i in range(t_steps)
    ]

    grid_rows = []
    zone_rows = []
    iv_vals = []
    for t in t_values:
        for k_ratio in k_values:
            strike_i = req.spot * k_ratio
            r = vol_surface_interp(
                surface=full_surface,
                spot=req.spot,
                target_strike=strike_i,
                target_expiry=t,
            )
            iv_i = float(r[0]) if r is not None else 0.0
            method_i = str(r[1]) if r is not None else "unavailable"
            grid_rows.append(
                {
                    "k_ratio": round(k_ratio, 4),
                    "strike": round(strike_i, 2),
                    "years": round(t, 6),
                    "iv": round(iv_i, 6),
                    "iv_pct": round(iv_i * 100, 3),
                    "zone": "normal",
                    "method": method_i,
                }
            )
            iv_vals.append(iv_i)

    # Adaptive burst zoning: bottom/top quantile on current grid
    iv_sorted = sorted(iv_vals)
    n_iv = len(iv_sorted)
    low_q = req.burst_lower_quantile
    high_q = req.burst_upper_quantile
    if n_iv > 0:
        low_idx = max(0, int((n_iv - 1) * low_q))
        high_idx = min(n_iv - 1, int((n_iv - 1) * high_q))
        low_thr = iv_sorted[low_idx]
        high_thr = iv_sorted[high_idx]
    else:
        low_thr = 0.0
        high_thr = 0.0

    for row in grid_rows:
        iv_i = row["iv"]
        zone = "normal"
        if iv_i >= high_thr:
            zone = "burst_high"
        elif iv_i <= low_thr:
            zone = "suppressed_low"
        row["zone"] = zone
        if zone != "normal":
            zone_rows.append(
                {
                    "k_ratio": row["k_ratio"],
                    "years": row["years"],
                    "iv": row["iv"],
                    "zone": zone,
                }
            )

    iv_valid = [v for v in iv_vals if v > 0]
    iv_range = (max(iv_valid) - min(iv_valid)) if iv_valid else 0.0
    point_quality = min(1.0, len(term_rows) / 8.0)
    smoothness_quality = 1.0 / (1.0 + iv_range)
    confidence_score = max(0.0, min(1.0, 0.65 * point_quality + 0.35 * smoothness_quality))
    if confidence_score >= 0.8:
        confidence_label = "high"
    elif confidence_score >= 0.55:
        confidence_label = "medium"
    else:
        confidence_label = "low"

    return {
        "result_summary": {
            "target_strike": req.strike,
            "target_maturity": req.maturity,
            "term_points": len(term_rows),
            "smile_points": len(smile_rows),
            "interp_iv": round(interp_iv, 6) if interp_iv is not None else None,
            "interp_iv_pct": round(interp_iv * 100, 3) if interp_iv is not None else None,
            "interp_method": interp_method,
            "smile_selected_expiry": smile["selected_expiry"],
            "smile_selected_years": selected_years,
            "local_skew_slope": round(skew, 8) if skew is not None else None,
            "local_curvature": round(curvature, 8) if curvature is not None else None,
            "surface_grid_points": len(grid_rows),
            "surface_k_steps": k_steps,
            "surface_t_steps": t_steps,
            "burst_zone_points": len(zone_rows),
            "burst_threshold_mode": "adaptive_quantile",
            "burst_low_quantile": req.burst_lower_quantile,
            "burst_high_quantile": req.burst_upper_quantile,
            "burst_low_threshold_iv": round(low_thr, 6),
            "burst_high_threshold_iv": round(high_thr, 6),
            "confidence_score": round(confidence_score, 4),
            "confidence_label": confidence_label,
        },
        "result_details": {
            "term_structure_rows": term_rows,
            "smile_rows": smile_rows,
            "smiles_by_expiry": smiles_by_expiry,
            "surface_grid_rows": grid_rows,
            "burst_zone_rows": zone_rows,
        },
    }


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
    cpp_result = vol_surface_interp(
        surface       = surface,
        spot          = req.spot,
        target_strike = req.target_strike,
        target_expiry = req.target_maturity,
    )

    if cpp_result is not None:
        iv, interp_method = cpp_result
        # Find nearest surface point for provenance metadata
        scale = req.target_strike if req.target_strike > 0 else 1.0
        best_pt = min(
            req.iv_surface,
            key=lambda p: math.hypot(
                (p.strike - req.target_strike) / scale,
                (p.years  - req.target_maturity),
            ),
        )
        iv_instrument = best_pt.instrument
        iv_matched_k  = best_pt.strike
        iv_matched_t  = best_pt.years
    else:
        # No surface — caller should fall back to DVOL
        iv            = 0.0
        interp_method = "dvol_fallback"
        iv_instrument = ""
        iv_matched_k  = req.target_strike
        iv_matched_t  = req.target_maturity

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
