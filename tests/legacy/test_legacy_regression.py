"""One-off port regression: ported C++ screener vs the original option-screener binary.

Runs both on tests/legacy/pltr.json with identical filters and compares the top-N
tables. Behaviour that was deliberately fixed in the port (iron condor max gain /
max loss, see MERGE_PLAN.md Phase 1) is excluded from the comparison.

Original binary: option-screener@8b31b95, cpp/build/bin/option_screener.
Override its location with LEGACY_SCREENER_BIN. Skipped when it is not present.

Run:  python tests/legacy/test_legacy_regression.py   (or pytest)
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(HERE))

from convert_pltr import load  # noqa: E402
from src.services import engine_client  # noqa: E402

LEGACY_BIN = Path(os.environ.get(
    "LEGACY_SCREENER_BIN",
    ROOT.parent / "option-screener" / "cpp" / "build" / "bin" / "option_screener",
))
SNAPSHOT = HERE / "pltr.json"
TOP_N = 15

_NULL_STRATEGY_FILTER = {
    "debit_range": None, "credit_range": None, "potential_gain_range": None,
    "potential_loss_range": None, "rr_range": None, "net_delta_range": None,
    "net_theta_range": None, "net_vega_range": None, "iv_range": None,
}

CASES = {
    "single_calls": dict(
        strategies={"single_calls": True},
        option_filter={"min_oi": 10, "min_price": 0.05, "max_bid_ask_spread": 5},
        strategy_filter={}, rank_key="cost", fixed_gain_loss=False,
    ),
    "straddles": dict(
        strategies={"straddles": True},
        option_filter={"min_oi": 10, "min_price": 0.05, "max_bid_ask_spread": 5},
        strategy_filter={"net_delta_range": [-20, 20], "iv_range": [0.4, 1.0]},
        rank_key="cost", fixed_gain_loss=False,
    ),
    "strangles": dict(
        strategies={"strangles": True},
        option_filter={"min_oi": 100, "min_price": 0.05, "max_bid_ask_spread": 2},
        strategy_filter={"debit_range": [100, 2000]},
        rank_key="cost", fixed_gain_loss=False,
    ),
    "iron_condors": dict(
        strategies={"iron_condors": True},
        option_filter={"min_oi": 500, "min_volume": 100, "min_price": 0.05, "max_bid_ask_spread": 0.5},
        strategy_filter={},
        rank_key="cost", fixed_gain_loss=True,   # max gain / loss / rr fixed in the port
    ),
    # Full-chain enumeration (~2M condors); the legacy binary takes several seconds.
    "iron_condors_full": dict(
        strategies={"iron_condors": True},
        option_filter={"min_oi": 10, "min_price": 0.05, "max_bid_ask_spread": 5},
        strategy_filter={},
        rank_key="cost", fixed_gain_loss=True,
    ),
}


def _legacy_config(case: dict) -> dict:
    of = {"min_volume": None, "min_oi": None, "min_price": None, "expiry": None,
          "days_to_expiry_range": None, "volume_ratio_range": None, "max_bid_ask_spread": None}
    of.update(case["option_filter"])
    sf = dict(_NULL_STRATEGY_FILTER, **case["strategy_filter"])
    toggles = {"single_calls": False, "iron_condors": False, "straddles": False, "strangles": False}
    toggles.update(case["strategies"])
    return {
        "strategy_filter": toggles,
        "config_filter": {**of, "direction": "LONG", **sf},
        "ranking": {"key": case["rank_key"], "top_n": TOP_N},
    }


def _parse_float(tok: str) -> float:
    return math.inf if tok == "inf" else (math.nan if tok == "nan" else float(tok))


def run_legacy(case: dict) -> list[dict]:
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "config.json"
        cfg.write_text(json.dumps(_legacy_config(case)))
        out = subprocess.run([str(LEGACY_BIN), str(cfg), str(SNAPSHOT)],
                             capture_output=True, text=True, check=True).stdout
    rows = []
    lines = out.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith("-----") and len(l) > 100) + 1
    for line in lines[start:]:
        tok = line.split()
        if len(tok) < 9:
            continue
        cost, gain, loss, rr, delta, theta, vega, iv = map(_parse_float, tok[-8:])
        rows.append(dict(cost=cost, max_gain=gain, max_loss=loss, rr=rr,
                         net_delta=delta, net_theta=theta, net_vega=vega, avg_iv=iv))
    return rows


def run_port(case: dict, spot: float, chain: list[dict]) -> list[dict]:
    of = {"require_two_sided": False, **case["option_filter"]}
    r = engine_client.screener({
        "spot": spot, "rate": 0.0, "multiplier": 100, "price_mode": "mid",
        "compute_greeks": False, "model_vol": "none", "chain": chain,
        "strategies": case["strategies"], "option_filter": of,
        "strategy_filter": {"direction": "LONG", **case["strategy_filter"]},
        "rank": {"key": case["rank_key"], "descending": True, "top_n": TOP_N},   # legacy rank() default
    })
    assert r["status"] == "ok", r.get("error")
    # Quantize to the precision the legacy binary prints (%.1f / %.2f / %.6f) so both
    # sides go through the same rounding before comparison.
    def p(v, unbounded=False, nd=6, missing=math.inf):
        if unbounded:
            return math.inf
        return missing if v is None else float(f"{v:.{nd}f}")
    return [dict(cost=p(s["cost"], nd=1),
                 max_gain=p(s["max_gain"], s["max_gain_unbounded"], nd=1),
                 max_loss=p(s["max_loss"], s["max_loss_unbounded"], nd=1),
                 rr=p(s["rr"], nd=2),
                 net_delta=p(s["net_delta"]), net_theta=p(s["net_theta"]), net_vega=p(s["net_vega"]),
                 avg_iv=p(s["avg_iv"], missing=math.nan))
            for s in r["result_details"]["strategies"]]


def _signature(row: dict, fields: list[str]) -> tuple:
    def q(v: float):
        if math.isinf(v) or math.isnan(v):
            return str(v)
        return round(v, 1) if abs(v) >= 1000 else round(v, 4)
    return tuple(q(row[f]) for f in fields)


def compare(name: str, legacy: list[dict], port: list[dict], fixed_gain_loss: bool) -> None:
    assert legacy, f"{name}: legacy produced no rows; adjust the case filters"
    assert len(legacy) == len(port), f"{name}: row count {len(legacy)} vs {len(port)}"
    costs_l = [round(r["cost"], 1) for r in legacy]
    costs_p = [round(r["cost"], 1) for r in port]
    assert costs_l == costs_p, f"{name}: cost ordering differs\n{costs_l}\n{costs_p}"

    fields = ["cost", "net_delta", "net_theta", "net_vega", "avg_iv"]
    if not fixed_gain_loss:
        fields += ["max_gain", "max_loss", "rr"]
    # Rows tied on cost at the cut-off may legitimately differ (legacy sort is unstable).
    boundary = costs_l[-1]
    keep = lambda rows: Counter(_signature(r, fields) for r in rows if round(r["cost"], 1) != boundary)  # noqa: E731
    assert keep(legacy) == keep(port), f"{name}: rows differ\n{keep(legacy)}\n{keep(port)}"


def _cases():
    spot, chain = load(SNAPSHOT)
    for name, case in CASES.items():
        yield name, case, spot, chain


def test_legacy_regression():
    if not LEGACY_BIN.exists():
        print(f"SKIP: legacy binary not found at {LEGACY_BIN}")
        return
    for name, case, spot, chain in _cases():
        compare(name, run_legacy(case), run_port(case, spot, chain), case["fixed_gain_loss"])
        print(f"ok  {name}")


if __name__ == "__main__":
    test_legacy_regression()
