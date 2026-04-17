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
    pde_price,
    pricing_bundle,
    run_convergence_steps,
)
from src.services.analytics import (
    convergence_summary,
    rank_benchmark_rows,
)
from src.api.shared import _diag, _record, dispatch_task

router = APIRouter(tags=["pricing"])


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
