"""Pricing, scenario, PDE, convergence, and benchmark routes."""
from time import perf_counter

from fastapi import APIRouter, HTTPException

from src.schemas.request_models import (
    BenchmarkRequest,
    ConvergenceRequest,
    PdeRequest,
    PricingBatchRequest,
    PricingBatchGridRequest,
    PricingRequest,
    StressLibraryRequest,
)
from src.services.engine_client import (
    pde_solve,
    pricing_bundle,
    run_convergence_steps,
    run_engine_task,
)
from src.services.analytics import (
    convergence_summary,
    rank_benchmark_rows,
)
from src.services.stress_library import run_stress_library
from src.api.shared import _diag, _record, dispatch_task

router = APIRouter(tags=["pricing"])


def _run_convergence(req: ConvergenceRequest) -> dict:
    rows = run_convergence_steps(
        req.spot, req.strike, req.rate, req.vol,
        req.maturity, req.dividend_yield, req.step_ladder, req.option_type,
    )
    bs_ref = rows[0]["bs_ref"] if rows else 0.0
    summary, details = convergence_summary(rows, bs_ref)
    # Same diagnostics for the trinomial lattice, on its own error column.
    tri_rows = [{**r, "abs_error": r["trinomial_abs_error"]} for r in rows]
    tri_summary, tri_details = convergence_summary(tri_rows, bs_ref)
    summary["option_type"] = req.option_type
    summary["trinomial"] = {k: tri_summary[k] for k in (
        "best_abs_error", "worst_abs_error", "best_steps", "last_error",
        "improvement_ratio", "log_slope", "monotonicity_break_count")}
    details["trinomial_curve_points"] = tri_details["curve_points"]
    return {"summary": summary, "details": details}


def _run_benchmark(req: BenchmarkRequest) -> dict:
    p = req.pricing
    steps = max(10, int(p.maturity * 250))

    t0     = perf_counter()
    bundle = pricing_bundle(p.spot, p.strike, p.rate, p.vol,
                            p.maturity, p.n_paths, steps, p.dividend_yield, p.option_type)
    mc_ms  = (perf_counter() - t0) * 1000.0

    t1        = perf_counter()
    method    = req.pde_method if req.pde_method in {"crank_nicolson", "implicit", "explicit"} else "crank_nicolson"
    pde       = pde_solve(p.spot, p.strike, p.rate, p.vol, p.maturity, p.dividend_yield,
                          req.pde_s_steps, req.pde_t_steps, method, p.option_type)
    pde_ms    = (perf_counter() - t1) * 1000.0

    # MC, BS, binomial and trinomial come from one engine call; MC dominates its runtime.
    rows = [
        {"method": "mc",        "price": bundle["mc"],        "runtime_ms": mc_ms},
        {"method": "bs",        "price": bundle["bs"],        "runtime_ms": 0.0},
        {"method": "binomial",  "price": bundle["binomial"],  "runtime_ms": 0.0},
        {"method": "trinomial", "price": bundle["trinomial"], "runtime_ms": 0.0},
        {"method": "pde",       "price": pde.get("price", 0.0), "runtime_ms": pde_ms},
    ]
    baseline_name = req.benchmark_baseline if req.benchmark_baseline in {"pde","bs","mc","binomial","trinomial"} else "pde"
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
    return dispatch_task(req.model_dump(), task_type="pricing", trace_prefix="pricing")


@router.post("/tool/pricing/batch")
def tool_pricing_batch(req: PricingBatchRequest) -> dict:
    payload = {
        "n_jobs": len(req.jobs),
    }
    for i, job in enumerate(req.jobs):
        d = job.model_dump()
        payload[f"job_{i}_spot"] = d["spot"]
        payload[f"job_{i}_strike"] = d["strike"]
        payload[f"job_{i}_rate"] = d["rate"]
        payload[f"job_{i}_vol"] = d["vol"]
        payload[f"job_{i}_maturity"] = d["maturity"]
        payload[f"job_{i}_n_paths"] = d["n_paths"]
        payload[f"job_{i}_dividend_yield"] = d["dividend_yield"]
    return dispatch_task(payload, task_type="pricing_batch", trace_prefix="pricing-batch-list")


@router.post("/tool/pricing/batch/grid")
def tool_pricing_batch_grid(req: PricingBatchGridRequest) -> dict:
    payload = req.base.model_dump()
    payload["n_jobs"] = req.n_jobs
    payload["spot_shock"] = req.spot_shock
    return dispatch_task(payload, task_type="pricing_batch_grid", trace_prefix="pricing-batch")


@router.post("/tool/scenario/run")
def tool_scenario(req: PricingRequest) -> dict:
    return dispatch_task(req.model_dump(), task_type="scenario", trace_prefix="scenario")


@router.post("/tool/stress/run")
def tool_stress(req: StressLibraryRequest) -> dict:
    t0 = perf_counter()
    try:
        result = run_stress_library(
            spot=req.spot,
            strike=req.strike,
            rate=req.rate,
            vol=req.vol,
            maturity=req.maturity,
            n_paths=req.n_paths,
            dividend_yield=req.dividend_yield,
            n_rebalances=req.n_rebalances,
            hedge_paths=req.hedge_paths,
            transaction_cost_bps=req.transaction_cost_bps,
            rebalance_threshold=req.rebalance_threshold,
            vol_mismatch_mult=req.vol_mismatch_mult,
            stress_pack=req.stress_pack,
            stress_severity=req.stress_severity,
            include_hedge_compare=req.include_hedge_compare,
            legs=[leg.engine_payload() for leg in req.legs] if req.legs else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    ms = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="stress_library",
        input_params=req.model_dump(),
        result_summary=result["summary"],
        result_details=result["details"],
        diagnostics=_diag(ms, ["stress_library"]),
    )


@router.post("/tool/pde/run")
def tool_pde(req: PdeRequest) -> dict:
    t0 = perf_counter()
    try:
        pde = pde_solve(req.spot, req.strike, req.rate, req.vol, req.maturity, req.dividend_yield,
                        int(req.s_steps), int(req.t_steps), req.method, req.option_type, req.is_american)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Reference: Black-Scholes for European; a 1000-step binomial tree for American.
    ref = run_engine_task("pricing", {
        "spot": req.spot, "strike": req.strike, "rate": req.rate, "vol": req.vol,
        "maturity": req.maturity, "dividend_yield": req.dividend_yield, "n_paths": 100,
        "n_steps": 1000, "option_type": req.option_type, "is_american": req.is_american, "lsm_paths": 1000,
    }).get("result_summary", {})
    ref_name  = "binomial_american" if req.is_american else "bs"
    ref_price = (ref.get("american_methods") or {}).get("binomial") if req.is_american else ref.get("bs")
    ms = (perf_counter() - t0) * 1000.0
    price = pde.get("price", 0.0)
    t_used = pde.get("t_steps_used", req.t_steps)
    grid_points = req.s_steps * t_used
    notes = ["pde_cpp"]
    if pde.get("stability_refined"):
        notes.append(f"explicit scheme refined to {t_used} time steps for stability")
    return _record(
        tool_name="pde",
        input_params=req.model_dump(),
        result_summary={
            "price": price,
            "method": req.method,
            "option_type": req.option_type,
            "is_american": req.is_american,
            "s_steps": req.s_steps,
            "t_steps": req.t_steps,
            "t_steps_used": t_used,
            "stability_refined": pde.get("stability_refined", False),
            "psor_iterations": pde.get("psor_iterations", 0),
            "grid_points": grid_points,
            "s_t_aspect_ratio": req.s_steps / max(t_used, 1),
            "grid_density_per_maturity": grid_points / max(req.maturity, 1e-12),
            "reference_method": ref_name,
            "reference_price": ref_price,
            "price_vs_bs_gap": (price - ref_price) if ref_price is not None else None,
        },
        diagnostics=_diag(ms, notes),
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
