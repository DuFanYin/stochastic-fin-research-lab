"""Validation / stochastic-calculus check routes: stats, Itô, simulation, measure."""

from time import perf_counter

from fastapi import APIRouter

from src.schemas.request_models import (
    ItoCheckRequest,
    MeasureChangeRequest,
    MeasureCompareRequest,
    SimulationRequest,
    StatsRequest,
    ValidationGateRequest,
)
from src.services.engine_client import (
    ito_check,
    measure_compare,
    measure_density_path,
    simulation_path,
    stats_normal,
)
from src.services.analytics import (
    summarize_density,
)
from src.services.explainable_qa import build_explainable_qa
from src.api.shared import _diag, _record, dispatch_task

router = APIRouter(tags=["validation"])

@router.post("/tool/stats/run")
def tool_stats(req: StatsRequest) -> dict:
    t0    = perf_counter()
    s     = stats_normal(req.mu, req.sigma, req.theta, req.sample_size)
    ms    = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="stats",
        input_params=req.model_dump(),
        result_summary={**s, "sample_size": req.sample_size},
        diagnostics=_diag(ms),
    )


@router.post("/tool/ito/run")
def tool_ito(req: ItoCheckRequest) -> dict:
    t0     = perf_counter()
    result = ito_check(req.function_type, req.theta, req.t, req.n_steps)
    ms     = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="ito_check",
        input_params=req.model_dump(),
        result_summary=result,
        diagnostics=_diag(ms),
    )


@router.post("/tool/simulation/run")
def tool_simulation(req: SimulationRequest) -> dict:
    t0     = perf_counter()
    values = simulation_path(req.model, req.n_steps, req.dt,
                             req.sigma, req.kappa, req.theta, req.x0)
    ms     = (perf_counter() - t0) * 1000.0
    if not values:
        values = [req.x0]
    return _record(
        tool_name="simulation",
        input_params=req.model_dump(),
        result_summary={"model": req.model, "n_steps": req.n_steps, "x_final": values[-1],
                        "x_min": min(values), "x_max": max(values)},
        result_details={"values_preview": values},
        diagnostics=_diag(ms),
    )


@router.post("/tool/measure/run")
def tool_measure(req: MeasureChangeRequest) -> dict:
    t0      = perf_counter()
    density = measure_density_path(req.mu, req.r, req.sigma, req.t, req.n_steps)
    theta   = (req.mu - req.r) / max(req.sigma, 1e-8)
    if not density:
        density = [1.0]
    density_summary = summarize_density(density, req.t)
    ms      = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="measure_change",
        input_params=req.model_dump(),
        result_summary={
            "theta_market_price_of_risk": theta,
            "final_density": density[-1],
            **density_summary,
        },
        result_details={"density_preview": density[:30]},
        diagnostics=_diag(ms),
    )


@router.post("/tool/measure/compare")
def tool_measure_compare(req: MeasureCompareRequest) -> dict:
    t0     = perf_counter()
    result = measure_compare(req.mu, req.r, max(req.sigma, 1e-10),
                             req.t, int(req.n_steps), int(req.n_paths), req.x0,
                             preview_len=50)
    ms     = (perf_counter() - t0) * 1000.0
    sigma  = max(req.sigma, 1e-10)
    p_stats = result["p_stats"]
    q_stats = result["q_stats"]
    q95_gap = p_stats["q95"] - q_stats["q95"]
    var_gap = p_stats["variance"] - q_stats["variance"]
    p_dispersion = p_stats["q95"] - p_stats["q05"]
    q_dispersion = q_stats["q95"] - q_stats["q05"]
    path_dispersion_gap = p_dispersion - q_dispersion
    mean_shift = p_stats["mean"] - q_stats["mean"]
    mean_shift_pct = mean_shift / max(abs(q_stats["mean"]), 1e-12)
    drift_ratio = req.mu / req.r if abs(req.r) > 1e-12 else None
    variance_ratio = p_stats["variance"] / max(abs(q_stats["variance"]), 1e-12)
    return _record(
        tool_name="measure_compare",
        input_params=req.model_dump(),
        result_summary={
            "theta_market_price_of_risk": (req.mu - req.r) / sigma,
            "drift_p": req.mu, "drift_q": req.r, "drift_diff": req.mu - req.r,
            "terminal_mean_p": p_stats["mean"],
            "terminal_mean_q": q_stats["mean"],
            "q95_gap": q95_gap,
            "var_gap": var_gap,
            "path_dispersion_gap": path_dispersion_gap,
            "mean_shift": mean_shift,
            "mean_shift_pct": mean_shift_pct,
            "drift_ratio": drift_ratio,
            "variance_ratio": variance_ratio,
        },
        result_details={
            "path_preview": result["path_preview"],
            "distribution_compare": {"P": result["p_stats"], "Q": result["q_stats"]},
            "distribution_rows": [
                {"measure": "P", "mean": p_stats["mean"], "variance": p_stats["variance"], "q05": p_stats["q05"], "q50": p_stats["q50"], "q95": p_stats["q95"]},
                {"measure": "Q", "mean": q_stats["mean"], "variance": q_stats["variance"], "q05": q_stats["q05"], "q50": q_stats["q50"], "q95": q_stats["q95"]},
            ],
        },
        diagnostics=_diag(ms, ["p_vs_q_cpp"]),
    )


@router.post("/tool/validation/gate")
def tool_validation_gate(req: ValidationGateRequest) -> dict:
    req_payload = req.model_dump()
    gate = dispatch_task(req_payload, task_type="validation_gate", trace_prefix="validation")
    details = gate.setdefault("result_details", {})
    rows = details.get("rows", [])
    summary = gate.get("result_summary", {})
    details["explainable_qa"] = build_explainable_qa(rows, summary, req_payload)
    return gate
