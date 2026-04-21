"""
market_data.py — live BTC market data fetcher.

Sources
-------
1. BTC/USD spot          — Binance REST
2. BTC DVOL index        — Deribit REST  (index-level scalar vol)
3. BTC options IV surface— Deribit REST  (per-strike/expiry implied vol)
4. BTC perpetual funding — Binance Futures REST  (→ real-world drift mu)
5. USD rate term structure— US Treasury FiscalData REST (1M/3M/6M/1Y tenors)

All requests have short timeouts and graceful fallbacks.
"""

from __future__ import annotations

import asyncio
import logging
import math
import xml.etree.ElementTree as ET  # used in _fetch_rate_curve
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger(__name__)

_TIMEOUT = 6.0
_client = httpx.AsyncClient(timeout=_TIMEOUT)
_slow_client = httpx.AsyncClient(timeout=20.0)  # for slow government endpoints

# ── Fallback constants ────────────────────────────────────────────────────────
_FB_SPOT    = 65_000.0
_FB_VOL     = 0.80
_FB_RATE    = 0.045
_FB_FUNDING = 0.0001   # ~10 bps per 8 h — typical neutral funding


# ── Helpers ───────────────────────────────────────────────────────────────────

def _years_to_expiry(expiry_ts_ms: int) -> float:
    now = datetime.now(timezone.utc).timestamp()
    return max((expiry_ts_ms / 1000 - now) / (365.25 * 24 * 3600), 1e-6)


# ── 1. Spot ───────────────────────────────────────────────────────────────────

async def _fetch_btc_spot() -> float:
    url = "https://api.binance.com/api/v3/ticker/price"
    try:
        r = await _client.get(url, params={"symbol": "BTCUSDT"})
        r.raise_for_status()
        return float(r.json()["price"])
    except Exception as exc:
        log.warning("BTC spot failed (%s), fallback %.0f", exc, _FB_SPOT)
        return _FB_SPOT


# ── 2. DVOL index ─────────────────────────────────────────────────────────────

async def _fetch_btc_dvol() -> float:
    """Deribit DVOL — BTC VIX equivalent. Returns annualised decimal."""
    url = "https://www.deribit.com/api/v2/public/get_volatility_index_data"
    now_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = now_ms - 2 * 3_600_000
    params   = {"currency": "BTC", "resolution": "3600",
                "start_timestamp": start_ms, "end_timestamp": now_ms}
    try:
        r = await _client.get(url, params=params)
        r.raise_for_status()
        candles = r.json().get("result", {}).get("data", [])
        if not candles:
            raise ValueError("empty DVOL candles")
        return float(candles[-1][4]) / 100.0
    except Exception as exc:
        log.warning("DVOL failed (%s), fallback %.2f", exc, _FB_VOL)
        return _FB_VOL


# ── 3. Options IV surface ─────────────────────────────────────────────────────

async def _fetch_options_instruments() -> list[dict]:
    """Return all live BTC option instruments from Deribit."""
    url = "https://www.deribit.com/api/v2/public/get_instruments"
    params = {"currency": "BTC", "kind": "option", "expired": "false"}
    r = await _client.get(url, params=params)
    r.raise_for_status()
    return r.json().get("result", [])


async def _fetch_iv_for_instrument(name: str) -> float | None:
    """Return mark IV (decimal) for a single instrument, or None on failure."""
    url = "https://www.deribit.com/api/v2/public/get_order_book"
    try:
        r = await _client.get(url, params={"instrument_name": name, "depth": 1})
        r.raise_for_status()
        iv_pct = r.json().get("result", {}).get("mark_iv")
        if iv_pct is None:
            return None
        return float(iv_pct) / 100.0
    except Exception:
        return None


async def fetch_iv_surface(spot: float, strikes_per_expiry: int = 7) -> dict[str, Any]:
    """
    Build an IV surface with multiple strikes per expiry so the C++ engine
    can bilinearly interpolate in both K and T dimensions.

    Returns
    -------
    {
      "surface": [
        {"expiry": "27JUN25", "strike": 65000, "years": 0.19, "iv": 0.83, "iv_pct": 83.0},
        ...  # multiple rows per expiry, spread around ATM
      ],
      "raw_instruments_count": 412,
    }
    """
    try:
        instruments = await _fetch_options_instruments()
    except Exception as exc:
        log.warning("Options instruments failed (%s)", exc)
        return {"surface": [], "raw_instruments_count": 0}

    # Group calls by expiry, keep all strikes
    calls_by_expiry: dict[str, dict] = {}
    for inst in instruments:
        if inst.get("option_type") != "call":
            continue
        expiry = inst.get("expiry_date", "") or inst["instrument_name"].split("-")[1]
        expiry_ts = inst.get("expiration_timestamp", 0)
        years = _years_to_expiry(expiry_ts) if expiry_ts else 0.0
        if expiry not in calls_by_expiry:
            calls_by_expiry[expiry] = {"years": years, "calls": []}
        calls_by_expiry[expiry]["calls"].append(inst)

    # For each expiry, pick N strikes centered around ATM
    fetch_tasks: list[tuple[str, float, str]] = []  # (expiry, years, instrument_name)
    for expiry, info in sorted(calls_by_expiry.items()):
        years = info["years"]
        calls_sorted = sorted(info["calls"], key=lambda i: abs(float(i["strike"]) - spot))
        chosen = calls_sorted[:strikes_per_expiry]
        for inst in chosen:
            fetch_tasks.append((expiry, years, inst["instrument_name"], float(inst["strike"])))

    if not fetch_tasks:
        return {"surface": [], "raw_instruments_count": len(instruments)}

    # Fetch all IVs concurrently
    names = [t[2] for t in fetch_tasks]
    ivs = await asyncio.gather(*[_fetch_iv_for_instrument(n) for n in names])

    surface = []
    for (expiry, years, name, strike), iv in zip(fetch_tasks, ivs):
        if iv is None:
            continue
        surface.append({
            "expiry":     expiry,
            "instrument": name,
            "strike":     strike,
            "years":      round(years, 4),
            "iv":         round(iv, 4),
            "iv_pct":     round(iv * 100, 2),
        })

    return {
        "surface": surface,
        "raw_instruments_count": len(instruments),
    }


async def fetch_iv_smile_slice(spot: float, target_years: float, center_strike: float, n_points: int = 11) -> dict[str, Any]:
    """
    Build a same-expiry strike slice (smile proxy) near target maturity.
    Returns rows sorted by strike with mark IV values.
    """
    try:
        instruments = await _fetch_options_instruments()
    except Exception as exc:
        log.warning("Options instruments failed for smile slice (%s)", exc)
        return {"rows": [], "selected_expiry": "", "selected_years": 0.0}

    calls: list[dict[str, Any]] = [i for i in instruments if i.get("option_type") == "call"]
    if not calls:
        return {"rows": [], "selected_expiry": "", "selected_years": 0.0}

    expiry_rows: dict[str, dict[str, Any]] = {}
    for inst in calls:
        expiry = inst.get("expiry_date") or inst.get("instrument_name", "").split("-")[1]
        expiry_ts = inst.get("expiration_timestamp", 0)
        years = _years_to_expiry(expiry_ts) if expiry_ts else 0.0
        if expiry not in expiry_rows:
            expiry_rows[expiry] = {"years": years, "calls": []}
        expiry_rows[expiry]["calls"].append(inst)

    selected_expiry = min(expiry_rows.keys(), key=lambda e: abs(expiry_rows[e]["years"] - target_years))
    selected_years = float(expiry_rows[selected_expiry]["years"])
    selected_calls = sorted(expiry_rows[selected_expiry]["calls"], key=lambda i: abs(float(i["strike"]) - center_strike))
    pick_n = max(5, min(n_points, len(selected_calls)))
    chosen = selected_calls[:pick_n]
    chosen = sorted(chosen, key=lambda i: float(i["strike"]))

    names = [c["instrument_name"] for c in chosen]
    ivs = await asyncio.gather(*[_fetch_iv_for_instrument(n) for n in names])
    rows = []
    for inst, iv in zip(chosen, ivs):
        if iv is None:
            continue
        rows.append(
            {
                "instrument": inst["instrument_name"],
                "strike": float(inst["strike"]),
                "years": round(selected_years, 4),
                "log_moneyness": round(math.log(max(float(inst["strike"]), 1e-8) / max(spot, 1e-8)), 6),
                "iv": round(iv, 6),
                "iv_pct": round(iv * 100, 3),
            }
        )
    return {
        "rows": rows,
        "selected_expiry": selected_expiry,
        "selected_years": round(selected_years, 4),
    }


def pick_iv(surface: list[dict], target_strike: float, target_years: float) -> dict | None:
    """
    Given a surface (list of surface rows) and a desired strike + maturity,
    return the row whose (strike, years) is nearest in normalised distance.
    Returns None if surface is empty.
    """
    if not surface:
        return None
    spot_scale = target_strike if target_strike > 0 else 1.0
    best = min(
        surface,
        key=lambda row: math.hypot(
            (row["strike"] - target_strike) / spot_scale,
            (row["years"]  - target_years),
        ),
    )
    return best


# ── 4. Funding rate → mu ──────────────────────────────────────────────────────

async def _fetch_funding_rate() -> float:
    """
    Binance perpetual funding rate for BTCUSDT.
    Funding is paid every 8 h, so annualised mu ≈ spot_rate * 3 * 365.
    Returns annualised decimal under the physical measure.
    """
    url = "https://fapi.binance.com/fapi/v1/premiumIndex"
    try:
        r = await _client.get(url, params={"symbol": "BTCUSDT"})
        r.raise_for_status()
        rate_str = r.json().get("lastFundingRate", "")
        if not rate_str:
            raise ValueError("missing lastFundingRate")
        rate_8h = float(rate_str)
        # annualise: 3 payments/day × 365 days
        return rate_8h * 3 * 365
    except Exception as exc:
        log.warning("Funding rate failed (%s), fallback %.4f", exc, _FB_FUNDING)
        return _FB_FUNDING


# ── 5. Rate term structure ────────────────────────────────────────────────────

_TENOR_YEARS = {"1m": 1/12, "3m": 0.25, "6m": 0.5, "1y": 1.0, "2y": 2.0}

_FALLBACK_CURVE = {"1m": 0.043, "3m": 0.045, "6m": 0.046, "1y": 0.047, "2y": 0.047}

_RATE_CURVE_CACHE: dict[str, float] | None = None
_RATE_CURVE_FETCHED_AT: float = 0.0
_RATE_CURVE_TTL = 3600.0  # seconds — Treasury data is daily, 1h cache is plenty


async def _fetch_rate_curve() -> dict[str, float]:
    """
    US Treasury XML yield curve — fetched once per server session (TTL 1h).
    Treasury data is daily so there is no value in re-fetching on every user refresh.
    """
    global _RATE_CURVE_CACHE, _RATE_CURVE_FETCHED_AT
    import time
    if _RATE_CURVE_CACHE is not None and (time.monotonic() - _RATE_CURVE_FETCHED_AT) < _RATE_CURVE_TTL:
        return _RATE_CURVE_CACHE

    now = datetime.now(timezone.utc)
    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
        f"?data=daily_treasury_yield_curve&field_tdr_date_value_month={now.strftime('%Y%m')}"
    )
    _XML_NS = "http://schemas.microsoft.com/ado/2007/08/dataservices"
    _XML_NS_M = f"{{{_XML_NS}/metadata}}"
    _FIELD_MAP = {
        "BC_1MONTH": "1m", "BC_3MONTH": "3m",
        "BC_6MONTH": "6m", "BC_1YEAR":  "1y", "BC_2YEAR": "2y",
    }
    try:
        r = await _slow_client.get(url)
        r.raise_for_status()
        root = ET.fromstring(r.text)
        atom = "http://www.w3.org/2005/Atom"
        entries = root.findall(f"{{{atom}}}entry")
        if not entries:
            raise ValueError("no XML entries")
        # last entry = most recent date; two-step find avoids path namespace issues
        content = entries[-1].find(f"{{{atom}}}content")
        props = content.find(f"{_XML_NS_M}properties") if content is not None else None
        if props is None:
            raise ValueError("no properties element")
        curve: dict[str, float] = {}
        for field, tenor in _FIELD_MAP.items():
            el = props.find(f"{{{_XML_NS}}}{field}")
            if el is not None and el.text:
                curve[tenor] = float(el.text) / 100.0
        for t, fb in _FALLBACK_CURVE.items():
            curve.setdefault(t, fb)
        _RATE_CURVE_CACHE = curve
        _RATE_CURVE_FETCHED_AT = time.monotonic()
        return curve

    except Exception as exc:
        log.warning("Rate curve failed (%s), using fallback", exc)
        if _RATE_CURVE_CACHE is not None:
            return _RATE_CURVE_CACHE
        return dict(_FALLBACK_CURVE)


def pick_rate(curve: dict[str, float], target_years: float) -> tuple[str, float]:
    """
    Return the (tenor_key, rate) from curve whose maturity is nearest to
    target_years. Interpolates linearly between the two bracketing tenors.
    """
    points = sorted(
        ((y, k, curve[k]) for k, y in _TENOR_YEARS.items() if k in curve),
        key=lambda x: x[0],
    )
    if not points:
        return "3m", _FALLBACK_CURVE["3m"]

    # clamp to endpoints
    if target_years <= points[0][0]:
        return points[0][1], points[0][2]
    if target_years >= points[-1][0]:
        return points[-1][1], points[-1][2]

    # linear interpolation between bracketing points
    for i in range(len(points) - 1):
        y0, k0, r0 = points[i]
        y1, k1, r1 = points[i + 1]
        if y0 <= target_years <= y1:
            t = (target_years - y0) / (y1 - y0)
            label = f"{k0}→{k1}"
            return label, r0 + t * (r1 - r0)

    return points[-1][1], points[-1][2]


# ── Public composite fetcher ──────────────────────────────────────────────────

async def fetch_btc_snapshot() -> dict:
    """
    Fetch all five data sources concurrently.
    Any individual failure uses its fallback; the call never raises.
    """
    spot_task     = _fetch_btc_spot()
    dvol_task     = _fetch_btc_dvol()
    funding_task  = _fetch_funding_rate()
    curve_task    = _fetch_rate_curve()

    spot, dvol, funding_ann, curve = await asyncio.gather(
        spot_task, dvol_task, funding_task, curve_task,
    )

    # Options surface needs spot first (for ATM selection), fetch after
    surface_data = await fetch_iv_surface(spot)

    # Default rate = 3-month tenor
    _, rate_3m = pick_rate(curve, 0.25)

    curve_pct = {k: round(v * 100, 3) for k, v in curve.items()}

    return {
        # ── Fields written directly into form inputs ──
        "spot":         round(spot, 2),
        "vol":          round(dvol, 4),          # DVOL index as default vol
        "rate":         round(rate_3m, 4),        # 3-month rate as default
        "mu":           round(funding_ann, 4),    # annualised funding → P-drift

        # ── Convenience display fields ──
        "vol_pct":      round(dvol * 100, 2),
        "rate_pct":     round(rate_3m * 100, 3),
        "mu_pct":       round(funding_ann * 100, 3),
        "funding_8h_pct": round((funding_ann / (3 * 365)) * 100, 4),

        # ── Full curve (for tenor-aware rate selection in the UI) ──
        "rate_curve":   curve,
        "rate_curve_pct": curve_pct,

        # ── IV surface (for strike/maturity-aware vol selection) ──
        "iv_surface":   surface_data["surface"],

        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "spot":    "Binance BTCUSDT",
            "vol":     "Deribit DVOL index",
            "iv":      "Deribit options mark IV (ATM per expiry)",
            "mu":      "Binance perpetual funding rate (annualised)",
            "rate":    "US Treasury FiscalData",
        },
    }
