"""Pricing, scenario, PDE, convergence, and benchmark routes."""
from time import perf_counter

from fastapi import APIRouter

from src.schemas.request_models import (
    BenchmarkRequest,
    ConvergenceRequest,
    PdeRequest,
    PricingBatchRequest,
    PricingBatchGridRequest,
    PricingRequest,
)
from src.services.engine_client import (
    binomial_american,
    digital_call_bs,
    pde_price,
    pricing_batch,
    pricing_bundle,
    run_convergence_steps,
    scenario_bs5,
)
from src.services.analytics import (
    build_batch_grid,
    convergence_summary,
    quantile,
    rank_benchmark_rows,
    stdev_population,
)
from src.api.shared import _diag, _record

router = APIRouter(tags=["pricing"])


# ── Shared pricing logic ──────────────────────────────────────────────────────

def _run_pricing(req: PricingRequest) -> dict:
    steps = max(10, int(req.maturity * 250))
    notes = []

    if req.product_type == "digital_call":
        bs = digital_call_bs(req.spot, req.strike, req.rate, req.vol,
                             req.maturity, req.dividend_yield)
        mc = bs
        binomial = bs
        mc_std_err = 0.0
        american_price = None
        greeks = {"delta_bs": None, "vega_bs": None}
        err_decomp = {"mc_minus_bs": 0.0, "binomial_minus_bs": 0.0}
    else:
        bundle = pricing_bundle(req.spot, req.strike, req.rate, req.vol,
                                req.maturity, req.n_paths, steps, req.dividend_yield)
        mc, bs, binomial = bundle["mc"], bundle["bs"], bundle["binomial"]
        mc_std_err = bundle.get("mc_std_err", 0.0)
        greeks   = {"delta_bs": bundle["delta_bs"], "vega_bs": bundle["vega_bs"]}
        err_decomp = {
            "mc_minus_bs":       bundle["mc_minus_bs"],
            "binomial_minus_bs": bundle["binomial_minus_bs"],
        }

        if req.is_american:
            american_price = binomial_american(
                req.spot, req.strike, req.rate, req.vol, req.maturity, steps, req.dividend_yield)
            notes.append("american_binomial_tree")
        else:
            american_price = None

    if req.fx_mode:
        scale = 1.0 / max(req.spot, 1e-6)
        mc       *= scale
        bs       *= scale
        binomial *= scale
        if american_price is not None:
            american_price *= scale

    spread = max(mc, bs, binomial) - min(mc, bs, binomial)
    abs_mc_bs = abs(err_decomp["mc_minus_bs"])
    abs_binomial_bs = abs(err_decomp["binomial_minus_bs"])
    relative_spread = spread / max(abs(bs), 1e-12)
    return {
        "summary": {
            "mc": mc, "bs": bs, "binomial": binomial,
            "mc_std_err": mc_std_err,
            "mc_ci_low":  mc - 1.96 * mc_std_err,
            "mc_ci_high": mc + 1.96 * mc_std_err,
            "american": american_price,
            "method_spread": spread,
            "numeraire": req.numeraire,
            "greeks": greeks,
            "error_decomposition": err_decomp,
            "abs_mc_bs": abs_mc_bs,
            "abs_binomial_bs": abs_binomial_bs,
            "relative_spread": relative_spread,
            "pricing_stability": (
                "good" if spread < max(1e-6, 0.05 * max(abs(bs), 1.0)) else "check_model_params"
            ),
        },
        "notes": notes,
        "n_paths": req.n_paths,
        "tree_steps": steps,
    }


def _run_convergence(req: ConvergenceRequest) -> dict:
    rows = run_convergence_steps(
        req.spot, req.strike, req.rate, req.vol,
        req.maturity, req.dividend_yield, req.step_ladder,
    )
    bs_ref = rows[0]["bs_ref"] if rows else 0.0
    summary, details = convergence_summary(rows, bs_ref)
    return {"summary": summary, "details": details}


def _run_benchmark(req: BenchmarkRequest) -> dict:
    p = req.pricing
    steps = max(10, int(p.maturity * 250))

    t0     = perf_counter()
    bundle = pricing_bundle(p.spot, p.strike, p.rate, p.vol,
                            p.maturity, p.n_paths, steps, p.dividend_yield)
    mc_ms  = (perf_counter() - t0) * 1000.0

    t1        = perf_counter()
    pde_price_ = pde_price(p.spot, p.strike, p.rate, p.vol, p.maturity,
                            p.dividend_yield, req.pde_s_steps, req.pde_t_steps,
                            req.pde_method)
    pde_ms    = (perf_counter() - t1) * 1000.0

    rows = [
        {"method": "mc",       "price": bundle["mc"],       "runtime_ms": mc_ms},
        {"method": "bs",       "price": bundle["bs"],        "runtime_ms": 0.0},
        {"method": "binomial", "price": bundle["binomial"],  "runtime_ms": 0.0},
        {"method": "pde",      "price": pde_price_,          "runtime_ms": pde_ms},
    ]
    baseline_name = req.benchmark_baseline if req.benchmark_baseline in {"pde","bs","mc","binomial"} else "pde"
    baseline = next((r["price"] for r in rows if r["method"] == baseline_name), rows[0]["price"])
    for r in rows:
        ae = abs(r["price"] - baseline)
        re = ae / max(abs(baseline), 1e-10)
        r["accuracy_abs_error"] = ae
        r["accuracy_rel_error"] = re
        r["stability"] = "good" if re < 0.03 else ("ok" if re < 0.08 else "check")

    rank_benchmark_rows(rows)

    ranked = sorted(rows, key=lambda x: (x["accuracy_rel_error"], x["runtime_ms"]))
    return {
        "summary": {
            "baseline_method": baseline_name, "baseline_price": baseline,
            "winner_method": ranked[0]["method"],
            "winner_rel_error": ranked[0]["accuracy_rel_error"],
        },
        "details": {
            "rows": ranked,
            "chart_rows": ranked,
        },
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/tool/pricing/run")
def tool_pricing(req: PricingRequest) -> dict:
    t0     = perf_counter()
    result = _run_pricing(req)
    ms     = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="pricing",
        input_params=req.model_dump(),
        result_summary=result["summary"],
        diagnostics=_diag(ms, result["notes"]),
    )


def _build_batch_response(jobs: list) -> dict:
    """Run pricing_batch FFI and assemble full result including method summary."""
    t0   = perf_counter()
    outs = pricing_batch([j.model_dump() if hasattr(j, "model_dump") else j for j in jobs])
    ms   = (perf_counter() - t0) * 1000.0

    rows, flat_rows, spreads = [], [], []
    for i, (job, out) in enumerate(zip(jobs, outs)):
        spot   = job.spot   if hasattr(job, "spot")   else job["spot"]
        strike = job.strike if hasattr(job, "strike") else job["strike"]
        vol    = job.vol    if hasattr(job, "vol")    else job["vol"]
        spread = max(out["mc"], out["bs"], out["binomial"]) - min(out["mc"], out["bs"], out["binomial"])
        spreads.append(spread)
        rows.append({"index": i, "input": {"spot": spot, "vol": vol},
                     "output": {**out, "method_spread": spread}})
        flat_rows.append({
            "#": i, "spot": spot, "strike": strike, "vol": vol,
            "bs": out["bs"], "mc": out["mc"], "binomial": out["binomial"],
            "mc-bs": out["mc"] - out["bs"], "bin-bs": out["binomial"] - out["bs"],
            "spread": spread,
        })

    sorted_spreads = sorted(spreads)
    n = len(sorted_spreads) or 1
    p50       = quantile(sorted_spreads, 0.50)
    p95       = quantile(sorted_spreads, 0.95)
    max_spread = sorted_spreads[-1] if sorted_spreads else 0.0
    min_spread = sorted_spreads[0]  if sorted_spreads else 0.0
    spread_std = stdev_population(spreads)
    spread_cv  = spread_std / max(abs(sum(spreads) / n), 1e-12) if spreads else 0.0

    # ── Method summary (avg/min/max/std/avg-err) computed server-side ─────────
    def _agg(key: str) -> dict:
        vals = [r[key] for r in flat_rows]
        avg  = sum(vals) / len(vals)
        mn   = min(vals)
        mx   = max(vals)
        std  = (sum((v - avg) ** 2 for v in vals) / len(vals)) ** 0.5
        return {"avg": avg, "min": mn, "max": mx, "std": std}

    method_summary = []
    for m, err_key in [("bs", None), ("mc", "mc-bs"), ("binomial", "bin-bs")]:
        agg = _agg(m)
        agg["method"] = m
        agg["avg_err_vs_bs"] = 0.0 if err_key is None else sum(r[err_key] for r in flat_rows) / n
        method_summary.append(agg)

    return _record(
        tool_name="pricing_batch",
        input_params={"job_count": len(jobs)},
        result_summary={
            "job_count": len(rows),
            "total_compute_ms": ms,
            "avg_method_spread": sum(spreads) / n,
            "p50_method_spread": p50,
            "p95_method_spread": p95,
            "max_method_spread": max_spread,
            "min_method_spread": min_spread,
            "avg_runtime_per_job_ms": ms / n,
            "worst_spread_job_index": spreads.index(max_spread) if spreads else None,
            "best_spread_job_index":  spreads.index(min_spread) if spreads else None,
            "spread_std": spread_std,
            "spread_cv":  spread_cv,
        },
        result_details={"rows": rows, "flat_rows": flat_rows, "method_summary": method_summary},
        diagnostics=_diag(ms, ["batch_single_ffi_call"]),
    )


@router.post("/tool/pricing/batch")
def tool_pricing_batch(req: PricingBatchRequest) -> dict:
    return _build_batch_response(req.jobs)


@router.post("/tool/pricing/batch/grid")
def tool_pricing_batch_grid(req: PricingBatchGridRequest) -> dict:
    """Build a symmetric spot/vol shock grid server-side and price in one FFI call."""
    jobs = build_batch_grid(req.base.model_dump(), req.n_jobs, req.spot_shock)
    return _build_batch_response(jobs)


@router.post("/tool/scenario/run")
def tool_scenario(req: PricingRequest) -> dict:
    t0     = perf_counter()
    prices = scenario_bs5(req.spot, req.strike, req.rate, req.vol, req.maturity, req.dividend_yield)
    ms     = (perf_counter() - t0) * 1000.0
    rows = []
    for name, px in [
        ("base", prices[0]),
        ("spot_up", prices[1]),
        ("spot_down", prices[2]),
        ("vol_up", prices[3]),
        ("rate_up", prices[4]),
    ]:
        diff = px - prices[0]
        pct = diff / prices[0] if abs(prices[0]) > 1e-12 else None
        rows.append({
            "scenario": name,
            "base_price": prices[0],
            "bs_price": px,
            "vs_base_diff": diff,
            "abs_vs_base_diff": abs(diff),
            "vs_base_pct": pct,
            "vs_base_bps": (pct * 10000.0) if pct is not None else None,
        })
    rankable = sorted(rows, key=lambda r: r["abs_vs_base_diff"], reverse=True)
    rank_map = {r["scenario"]: i + 1 for i, r in enumerate(rankable)}
    for r in rows:
        r["rank"] = rank_map[r["scenario"]]
    all_prices = [r["bs_price"] for r in rows]
    tornado_points = [
        {"label": r["scenario"], "value": r["vs_base_diff"]}
        for r in rows if r["scenario"] != "base"
    ]
    return _record(
        tool_name="scenario",
        input_params=req.model_dump(),
        result_summary={
            "base_price":   prices[0],
            "max_price":    max(all_prices),
            "min_price":    min(all_prices),
            "price_range":  max(all_prices) - min(all_prices),
            "scenario_count": len(rows),
        },
        result_details={"rows": rows, "tornado_points": tornado_points},
        diagnostics=_diag(ms),
    )


@router.post("/tool/pde/run")
def tool_pde(req: PdeRequest) -> dict:
    method = req.method.lower() if req.method.lower() in {"implicit", "crank_nicolson"} else "crank_nicolson"
    t0     = perf_counter()
    price  = pde_price(req.spot, req.strike, req.rate, req.vol, req.maturity,
                       req.dividend_yield, int(req.s_steps), int(req.t_steps), method)
    bs_ref = pricing_bundle(
        req.spot, req.strike, req.rate, req.vol,
        req.maturity, 8000, max(10, int(req.maturity * 250)), req.dividend_yield
    )["bs"]
    ms = (perf_counter() - t0) * 1000.0
    s_t_aspect_ratio = req.s_steps / max(req.t_steps, 1)
    grid_density_per_maturity = (req.s_steps * req.t_steps) / max(req.maturity, 1e-12)
    grid_points = req.s_steps * req.t_steps
    return _record(
        tool_name="pde",
        input_params=req.model_dump(),
        result_summary={
            "price": price,
            "method": method,
            "s_steps": req.s_steps,
            "t_steps": req.t_steps,
            "grid_points": grid_points,
            "s_t_aspect_ratio": s_t_aspect_ratio,
            "grid_density_per_maturity": grid_density_per_maturity,
            "price_vs_bs_gap": price - bs_ref,
        },
        diagnostics=_diag(ms, ["pde_cpp"]),
    )


@router.post("/tool/convergence/run")
def tool_convergence(req: ConvergenceRequest) -> dict:
    t0     = perf_counter()
    result = _run_convergence(req)
    ms     = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="convergence",
        input_params=req.model_dump(),
        result_summary=result["summary"],
        result_details=result["details"],
        diagnostics=_diag(ms, ["binomial_to_bs"]),
    )


@router.post("/tool/benchmark/run")
def tool_benchmark(req: BenchmarkRequest) -> dict:
    t0     = perf_counter()
    result = _run_benchmark(req)
    ms     = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="benchmark",
        input_params=req.model_dump(),
        result_summary=result["summary"],
        result_details=result["details"],
        diagnostics=_diag(ms, ["cross_method"]),
    )
