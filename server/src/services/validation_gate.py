"""Validation gate thresholds and rule evaluators."""


def with_excess(
    capability: str,
    metric: str,
    value: float,
    threshold: float,
    passed: bool,
    interpretation: str,
    action: str,
    direction: str = "<=",
) -> dict:
    if direction == ">=":
        violation = max(0.0, threshold - value)
    else:
        violation = max(0.0, value - threshold)
    return {
        "capability": capability,
        "metric": metric,
        "value": value,
        "threshold": threshold,
        "excess": value - threshold,
        "violation": violation,
        "direction": direction,
        "status": "pass" if passed else "fail",
        "interpretation": interpretation,
        "action": action,
    }


THRESHOLDS = {
    "stats_mean_error": lambda mu: max(1e-6, 0.05 * max(abs(mu), 1.0)),
    "stats_variance_error": lambda vol: max(1e-6, 0.1 * max(vol * vol, 1.0)),
    "measure_density_integral_error": 0.25,
    "measure_density_cv": 2.0,
    "measure_density_tail_ratio": 100.0,
    "measure_compare_var_gap_abs": 0.5,
    "measure_compare_path_dispersion_gap_abs": 1.0,
    "ito_expectation_gap": lambda target: max(1e-3, 0.15 * max(abs(target), 1.0)),
    "convergence_best_abs_error": 0.2,
    "convergence_monotonicity_break_count": 2.0,
    "convergence_last_two_improvement_ratio": 1.2,
    "simulation_terminal_finite": 1.0,
    "hedging_normalized_std": 0.25,
    "batch_spread_cv": 1.2,
    "batch_p95_method_spread": 2.0,
}


def evaluate_stats(mu: float, vol: float, sample_mean: float, sample_variance: float) -> list[dict]:
    mean_err = abs(sample_mean - mu)
    mean_tol = THRESHOLDS["stats_mean_error"](mu)
    var_err = abs(sample_variance - vol * vol)
    var_tol = THRESHOLDS["stats_variance_error"](vol)
    return [
        with_excess("stats", "mean_error", mean_err, mean_tol, mean_err <= mean_tol,
                    "sample mean check", "increase sample_size or lower sigma"),
        with_excess("stats", "variance_error", var_err, var_tol, var_err <= var_tol,
                    "sample variance check", "increase sample_size or verify sigma input"),
    ]


def evaluate_measure_density(density_summary: dict) -> list[dict]:
    integral_err = abs(density_summary["density_integral_proxy"] - 1.0)
    cv = density_summary["density_cv"]
    tail = density_summary["density_tail_ratio_q95_q05"]
    return [
        with_excess("measure", "density_integral_error", integral_err, THRESHOLDS["measure_density_integral_error"],
                    integral_err <= THRESHOLDS["measure_density_integral_error"],
                    "density normalization", "increase n_steps or review mu/r/sigma scale"),
        with_excess("measure", "density_cv", cv, THRESHOLDS["measure_density_cv"], cv <= THRESHOLDS["measure_density_cv"],
                    "density variation", "increase n_steps or reduce maturity/vol"),
        with_excess("measure", "density_tail_ratio_q95_q05", tail, THRESHOLDS["measure_density_tail_ratio"],
                    tail <= THRESHOLDS["measure_density_tail_ratio"],
                    "density tails", "check drift/vol settings under risk-neutral measure"),
    ]


def evaluate_measure_compare(var_gap_abs: float, path_dispersion_gap_abs: float) -> list[dict]:
    return [
        with_excess("measure_compare", "var_gap_abs", var_gap_abs, THRESHOLDS["measure_compare_var_gap_abs"],
                    var_gap_abs <= THRESHOLDS["measure_compare_var_gap_abs"],
                    "P/Q variance gap", "increase n_paths or verify mu-r spread assumptions"),
        with_excess(
            "measure_compare",
            "path_dispersion_gap_abs",
            path_dispersion_gap_abs,
            THRESHOLDS["measure_compare_path_dispersion_gap_abs"],
            path_dispersion_gap_abs <= THRESHOLDS["measure_compare_path_dispersion_gap_abs"],
            "P/Q path dispersion",
            "increase steps/paths or review model regime",
        ),
    ]


def evaluate_ito(diff: float, target_expectation: float) -> dict:
    tol = THRESHOLDS["ito_expectation_gap"](target_expectation)
    return with_excess(
        "ito",
        "expectation_gap",
        diff,
        tol,
        diff <= tol,
        "martingale expectation",
        "increase n_steps or use simpler function_type for stability",
    )


def evaluate_convergence(best_err: float, break_cnt: float, ratio: float) -> list[dict]:
    return [
        with_excess("convergence", "best_abs_error", best_err, THRESHOLDS["convergence_best_abs_error"],
                    best_err <= THRESHOLDS["convergence_best_abs_error"],
                    "best convergence error", "increase step ladder upper bound"),
        with_excess("convergence", "monotonicity_break_count", break_cnt, THRESHOLDS["convergence_monotonicity_break_count"],
                    break_cnt <= THRESHOLDS["convergence_monotonicity_break_count"],
                    "convergence monotonicity", "densify ladder and inspect oscillation region"),
        with_excess("convergence", "last_two_improvement_ratio", ratio, THRESHOLDS["convergence_last_two_improvement_ratio"],
                    ratio <= THRESHOLDS["convergence_last_two_improvement_ratio"],
                    "tail ladder improvement", "add larger step points or switch numerical method"),
    ]


def evaluate_simulation_finite(finite: float) -> dict:
    return with_excess("simulation", "terminal_finite", finite, THRESHOLDS["simulation_terminal_finite"],
                       finite >= THRESHOLDS["simulation_terminal_finite"],
                       "terminal path finite check", "reduce dt or sigma; verify model parameters",
                       direction=">=")


def evaluate_pde_gap_abs(pde_gap: float, pde_tol: float) -> dict:
    return with_excess("pde", "price_vs_bs_gap_abs", pde_gap, pde_tol, pde_gap <= pde_tol,
                       "PDE vs BS consistency", "increase s_steps/t_steps or verify boundary setup")


def evaluate_hedging_normalized_std(normalized_std: float) -> dict:
    return with_excess("hedging", "normalized_std", normalized_std, THRESHOLDS["hedging_normalized_std"],
                       normalized_std <= THRESHOLDS["hedging_normalized_std"],
                       "hedging distribution spread", "increase rebalances or reduce vol/maturity")


def evaluate_batch(spread_cv: float, p95: float) -> list[dict]:
    return [
        with_excess("pricing_batch", "spread_cv", spread_cv, THRESHOLDS["batch_spread_cv"],
                    spread_cv <= THRESHOLDS["batch_spread_cv"],
                    "batch spread stability", "reduce shock range or increase paths"),
        with_excess("pricing_batch", "p95_method_spread", p95, THRESHOLDS["batch_p95_method_spread"],
                    p95 <= THRESHOLDS["batch_p95_method_spread"],
                    "batch tail spread", "increase paths/tree steps for difficult regimes"),
    ]


def summarize_gate(rows: list[dict], capabilities: list[str], blocking: bool) -> dict:
    passed = bool(rows) and all(r["status"] == "pass" for r in rows)
    if not rows:
        passed = True
    gate_mode = "blocking" if blocking else "advisory"
    decision = "go" if passed else ("blocked" if gate_mode == "blocking" else "warning")
    failed_rows = [r for r in rows if r["status"] == "fail"]
    fail_by_cap = {}
    for r in failed_rows:
        fail_by_cap[r["capability"]] = fail_by_cap.get(r["capability"], 0) + 1
    max_excess_row = None
    for r in rows:
        if max_excess_row is None or r.get("violation", 0.0) > max_excess_row.get("violation", 0.0):
            max_excess_row = r
    return {
        "validation_mode": gate_mode,
        "gate_decision": decision,
        "capabilities_used": ", ".join(capabilities) if capabilities else "none",
        "checks_total": len(rows),
        "checks_failed": len(failed_rows),
        "fail_rate": (len(failed_rows) / len(rows)) if rows else 0.0,
        "failed_by_capability": fail_by_cap,
        "max_excess": max_excess_row.get("violation") if max_excess_row else None,
        "max_excess_item": f"{max_excess_row['capability']}.{max_excess_row['metric']}" if max_excess_row else None,
        "blocking_reason": "; ".join(f"{r['capability']}.{r['metric']}" for r in failed_rows) if failed_rows else "none",
    }
