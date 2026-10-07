"""Convert the option-screener Tradier snapshot (pltr.json) into the screener chain contract.

Test-only. Mirrors option-screener@8b31b95 cpp/src/loader.cpp so the ported engine
sees exactly the inputs the original binary saw:
  - spot  = underlying (bid + ask) / 2, else last
  - mid   = (bid + ask) / 2 when both are numeric, else last  -> expressed here as bid/ask/mark
  - iv    = first positive of greeks.{mid_iv, bid_iv, ask_iv, smv_vol, implied_volatility, volatility}
  - greeks are taken from the file (run the engine with compute_greeks=false)
  - forward = spot for every expiry (the original had no per-expiry forward)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

_IV_KEYS = ("mid_iv", "bid_iv", "ask_iv", "smv_vol", "implied_volatility", "volatility")


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def load(path: Path) -> tuple[float, list[dict]]:
    data = json.loads(path.read_text())
    symbol = data["symbols"][0]
    und = data.get("underlying", {})
    bid, ask, last = _num(und.get("bid")), _num(und.get("ask")), _num(und.get("last"))
    spot = (bid + ask) / 2.0 if bid is not None and ask is not None else last

    asof = datetime.fromtimestamp(data["timestamp"], tz=timezone.utc).date()
    chain = []
    for rows in data["chains"][symbol].values():
        for o in rows:
            greeks = o.get("greeks") or {}
            iv = next((g for g in (_num(greeks.get(k)) for k in _IV_KEYS) if g and g > 0), 0.0)
            expiry = o["expiration_date"]
            days = (datetime.strptime(expiry, "%Y-%m-%d").date() - asof).days
            chain.append({
                "symbol": o.get("symbol", symbol),
                "option_type": "call" if o["option_type"].lower() == "call" else "put",
                "expiry": expiry,
                "strike": float(o["strike"]),
                "forward": spot,
                "years": max(days, 0) / 365.0,
                "bid": _num(o.get("bid")),
                "ask": _num(o.get("ask")),
                "mark": _num(o.get("last")) or 0.0,
                "iv": iv,
                "volume": _num(o.get("volume")) or 0.0,
                "oi": _num(o.get("open_interest")) or 0.0,
                "delta": _num(greeks.get("delta")) or 0.0,
                "gamma": _num(greeks.get("gamma")) or 0.0,
                "theta": _num(greeks.get("theta")) or 0.0,
                "vega": _num(greeks.get("vega")) or 0.0,
            })
    return spot, chain
