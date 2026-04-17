"""Validation / stochastic-calculus check routes: stats, Itô, simulation, measure."""

from math import isfinite
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
    delta_hedge_pnl_distribution,
    ito_check,
    measure_compare,
    measure_density_path,
    pde_price,
    pricing_batch,
    pricing_bundle,
    run_convergence_steps,
    simulation_path,
    stats_normal,
)
from src.services.analytics import (
    build_batch_grid,
    convergence_summary,
    quantile,
    stdev_population,
    summarize_density,
)
from src.services.validation_gate import (
    evaluate_batch,
    evaluate_convergence,
    evaluate_hedging_normalized_std,
    evaluate_ito,
    evaluate_measure_compare,
    evaluate_measure_density,
    evaluate_pde_gap_abs,
    evaluate_simulation_finite,
    evaluate_stats,
    summarize_gate,
)
from src.api.shared import _diag, _record

router = APIRouter(tags=["validation"])


def _gate_batch_jobs(req: ValidationGateRequest) -> list[dict]:
    """Build a spot/vol shock grid for the validation gate batch check."""
    base = {
        "spot": req.spot, "strike": req.strike, "rate": req.rate,
        "vol": req.vol, "maturity": req.maturity, "n_paths": req.n_paths,
        "product_type": "european_call", "dividend_yield": req.dividend_yield,
        "fx_mode": False, "numeraire": "money_market", "is_american": False,
    }
    return build_batch_grid(base, max(1, int(req.batch_jobs)), float(req.batch_spot_shock))


def _gate_convergence(req: ValidationGateRequest) -> dict:
    """Run convergence loop for the gate, returning only the metrics needed by evaluators."""
    rows = run_convergence_steps(
        req.spot, req.strike, req.rate, req.vol,
        req.maturity, req.dividend_yield, req.conv_steps,
    )
    summary, _ = convergence_summary(rows, rows[0]["bs_ref"] if rows else 0.0)
    return {
        "best_abs_error": summary["best_abs_error"],
        "monotonicity_break_count": summary["monotonicity_break_count"],
        "last_two_improvement_ratio": summary["last_two_improvement_ratio"],
    }


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
    t0 = perf_counter()
    rows = []
    capabilities = []

    if req.pick_stats:
        capabilities.append("stats_moment_check")
        s = stats_normal(req.mu, req.vol, req.stats_theta, req.stats_n)
        rows.extend(evaluate_stats(req.mu, req.vol, s["mean"], s["variance"]))

        capabilities.append("measure_density_check")
        density = measure_density_path(req.mu, req.rate, req.vol, req.maturity, req.measure_n)
        density_summary = summarize_density(density, req.maturity)
        rows.extend(evaluate_measure_density(density_summary))

        capabilities.append("measure_compare_check")
        cmp = measure_compare(req.mu, req.rate, max(req.vol, 1e-10), req.maturity, req.cmp_steps, req.cmp_paths, 1.0, preview_len=50)
        var_gap = abs(cmp["p_stats"]["variance"] - cmp["q_stats"]["variance"])
        p_disp = cmp["p_stats"]["q95"] - cmp["p_stats"]["q05"]
        q_disp = cmp["q_stats"]["q95"] - cmp["q_stats"]["q05"]
        disp_gap = abs(p_disp - q_disp)
        rows.extend(evaluate_measure_compare(var_gap, disp_gap))

    if req.pick_ito:
        capabilities.append("ito_martingale_check")
        it = ito_check(req.ito_function_type, req.ito_theta, req.ito_t, req.ito_n)
        diff = abs(it["value"] - it["target_expectation"])
        rows.append(evaluate_ito(diff, it["target_expectation"]))

        capabilities.append("convergence_check")
        conv = _gate_convergence(req)
        best_err = float(conv["best_abs_error"])
        break_cnt = float(conv["monotonicity_break_count"])
        ratio = float(conv["last_two_improvement_ratio"]) if conv["last_two_improvement_ratio"] is not None else 999.0
        rows.extend(evaluate_convergence(best_err, break_cnt, ratio))

    if req.pick_simulation:
        capabilities.append("simulation_stability_check")
        values = simulation_path(req.model, req.sim_steps, req.sim_dt, req.vol, req.sim_kappa, req.sim_theta, 0.0)
        finite = float(1 if values and isfinite(values[-1]) else 0)
        rows.append(evaluate_simulation_finite(finite))

        capabilities.append("pde_consistency_check")
        method = req.pde_method.lower() if req.pde_method.lower() in {"implicit", "crank_nicolson"} else "crank_nicolson"
        pde_px = pde_price(req.spot, req.strike, req.rate, req.vol, req.maturity, req.dividend_yield, req.pde_s_steps, req.pde_t_steps, method)
        bs_ref = pricing_bundle(req.spot, req.strike, req.rate, req.vol, req.maturity, 8000, max(10, int(req.maturity * 250)), req.dividend_yield)["bs"]
        pde_gap = abs(pde_px - bs_ref)
        pde_tol = max(1e-3, 0.05 * max(abs(pde_px), 1.0))
        rows.append(evaluate_pde_gap_abs(pde_gap, pde_tol))

        capabilities.append("hedging_distribution_check")
        hd = delta_hedge_pnl_distribution(req.spot, req.strike, req.rate, req.vol, req.maturity, req.n_rebalances, req.hedge_paths)
        normalized_std = hd["std"] / max(req.spot, 1e-12)
        rows.append(evaluate_hedging_normalized_std(normalized_std))

        capabilities.append("batch_stability_check")
        batch_outs = pricing_batch(_gate_batch_jobs(req))
        spreads = [
            max(out["mc"], out["bs"], out["binomial"]) - min(out["mc"], out["bs"], out["binomial"])
            for out in batch_outs
        ]
        spread_mean = sum(spreads) / max(len(spreads), 1)
        spread_std = stdev_population(spreads)
        spread_cv = spread_std / max(abs(spread_mean), 1e-12)
        p95 = quantile(sorted(spreads), 0.95)
        rows.extend(evaluate_batch(spread_cv, p95))

    summary = summarize_gate(rows, capabilities, req.compute_block_on_validation)
    ms = (perf_counter() - t0) * 1000.0
    return _record(
        tool_name="validation_gate",
        input_params=req.model_dump(),
        result_summary=summary,
        result_details={"rows": rows, "threshold_rows": rows},
        diagnostics=_diag(ms, ["backend_gate_aggregated"]),
    )
