from ctypes import CDLL, POINTER, byref, c_double, c_int
from pathlib import Path

# ── Library loading ──────────────────────────────────────────────────────────

def _load_lib() -> CDLL | None:
    project_root = Path(__file__).resolve().parents[3]
    build_dir = project_root / "engine" / "build"
    for name in ("libsf_engine_c.dylib", "libsf_engine_c.so", "sf_engine_c.dll"):
        p = build_dir / name
        if p.exists():
            return CDLL(str(p))
    return None


_lib = _load_lib()

if _lib is not None:
    # scalar returns
    _lib.sf_mc_price_full.argtypes        = [c_double, c_double, c_double, c_double, c_double, c_int]
    _lib.sf_mc_price_full.restype         = c_double
    _lib.sf_mc_price_with_stderr.argtypes = [c_double, c_double, c_double, c_double, c_double, c_int, POINTER(c_double)]
    _lib.sf_mc_price_with_stderr.restype  = c_double
    _lib.sf_bs_price.argtypes             = [c_double, c_double, c_double, c_double, c_double]
    _lib.sf_bs_price.restype              = c_double
    _lib.sf_binomial_price.argtypes            = [c_double, c_double, c_double, c_double, c_double, c_int]
    _lib.sf_binomial_price.restype             = c_double
    _lib.sf_binomial_american_price.argtypes   = [c_double, c_double, c_double, c_double, c_double, c_int, c_double]
    _lib.sf_binomial_american_price.restype    = c_double
    _lib.sf_digital_call_bs.argtypes           = [c_double, c_double, c_double, c_double, c_double, c_double]
    _lib.sf_digital_call_bs.restype            = c_double
    _lib.sf_delta_hedge_pnl_std.argtypes       = [c_double, c_double, c_double, c_int]
    _lib.sf_delta_hedge_pnl_std.restype        = c_double
    _lib.sf_delta_hedge_pnl_distribution.argtypes = [
        c_double, c_double, c_double, c_double, c_double,
        c_int, c_int, POINTER(c_double),
    ]
    _lib.sf_delta_hedge_pnl_distribution.restype = None
    _lib.sf_delta_hedge_pnl_histogram.argtypes = [
        c_double, c_double, c_double, c_double, c_double,
        c_int, c_int, c_int,
        POINTER(c_double), POINTER(c_double), POINTER(c_double),
    ]
    _lib.sf_delta_hedge_pnl_histogram.restype = None
    _lib.sf_delta_hedge_strategy_compare.argtypes = [
        c_double, c_double, c_double, c_double, c_double,
        c_int, c_int, c_double, c_double, c_double,
        POINTER(c_double),
    ]
    _lib.sf_delta_hedge_strategy_compare.restype = None
    _lib.sf_pde_price.argtypes            = [c_double, c_double, c_double, c_double, c_double,
                                              c_double, c_int, c_int, c_int]
    _lib.sf_pde_price.restype             = c_double

    # output-pointer functions
    _lib.sf_pricing_greeks.argtypes = [
        c_double, c_double, c_double, c_double, c_double,
        POINTER(c_double), POINTER(c_double),
    ]
    _lib.sf_pricing_error_decomp.argtypes = [
        c_double, c_double, c_double,
        POINTER(c_double), POINTER(c_double),
    ]
    _lib.sf_scenario_bs5.argtypes = [
        c_double, c_double, c_double, c_double, c_double, c_double,
        POINTER(c_double),
    ]
    _lib.sf_stats_normal.argtypes = [
        c_double, c_double, c_double, c_int,
        POINTER(c_double), POINTER(c_double), POINTER(c_double),
    ]
    _lib.sf_ito_check.argtypes = [
        c_int, c_double, c_double, c_int,
        POINTER(c_double), POINTER(c_double),
    ]
    _lib.sf_measure_compare.argtypes = [
        c_double, c_double, c_double, c_double, c_int, c_int, c_double,
        POINTER(c_double), POINTER(c_double), c_int,
    ]
    _lib.sf_measure_compare.restype = c_int

    # int-return path functions
    _lib.sf_simulation_path.argtypes = [
        c_int, c_int, c_double, c_double, c_double, c_double, c_double,
        POINTER(c_double),
    ]
    _lib.sf_simulation_path.restype = c_int
    _lib.sf_measure_density_path.argtypes = [
        c_double, c_double, c_double, c_double, c_int, POINTER(c_double),
    ]
    _lib.sf_measure_density_path.restype = c_int

    # vol surface interpolation
    _lib.sf_vol_surface_interp.argtypes = [
        POINTER(c_double), POINTER(c_double), POINTER(c_double),
        c_int,
        c_double, c_double, c_double,
    ]
    _lib.sf_vol_surface_interp.restype = c_double

    # batch
    _lib.sf_pricing_batch.argtypes = [
        c_int,
        POINTER(c_double), POINTER(c_double), POINTER(c_double),
        POINTER(c_double), POINTER(c_double), POINTER(c_int),
        POINTER(c_double),
        POINTER(c_double), POINTER(c_double), POINTER(c_double),
    ]
    _lib.sf_pricing_batch.restype = None

    # thread control
    _lib.sf_set_num_threads.argtypes = [c_int]
    _lib.sf_get_max_threads.argtypes = []
    _lib.sf_get_max_threads.restype  = c_int


# ── Public API ───────────────────────────────────────────────────────────────

def is_engine_available() -> bool:
    return _lib is not None


def set_num_threads(n_threads: int) -> int:
    if _lib is None:
        return 1
    _lib.sf_set_num_threads(max(1, int(n_threads)))
    return int(_lib.sf_get_max_threads())


def get_max_threads() -> int:
    if _lib is None:
        return 1
    return int(_lib.sf_get_max_threads())


def pricing_bundle(
    spot: float, strike: float, rate: float, vol: float, maturity: float,
    n_paths: int, steps: int, dividend_yield: float,
) -> dict:
    if _lib is None:
        intrinsic = max(spot - strike, 0.0)
        return {"mc": intrinsic, "bs": intrinsic, "binomial": intrinsic,
                "delta_bs": 0.5, "vega_bs": 0.0, "mc_minus_bs": 0.0, "binomial_minus_bs": 0.0}
    r = rate - dividend_yield
    mc_stderr = c_double()
    mc      = float(_lib.sf_mc_price_with_stderr(spot, strike, r, vol, maturity, n_paths, byref(mc_stderr)))
    bs      = float(_lib.sf_bs_price(spot, strike, r, vol, maturity))
    binomial = float(_lib.sf_binomial_price(spot, strike, r, vol, maturity, steps))
    delta, vega = c_double(), c_double()
    _lib.sf_pricing_greeks(spot, strike, r, vol, maturity, byref(delta), byref(vega))
    mc_bs, bi_bs = c_double(), c_double()
    _lib.sf_pricing_error_decomp(mc, bs, binomial, byref(mc_bs), byref(bi_bs))
    return {
        "mc": mc, "bs": bs, "binomial": binomial,
        "mc_std_err": float(mc_stderr.value),
        "delta_bs": float(delta.value), "vega_bs": float(vega.value),
        "mc_minus_bs": float(mc_bs.value), "binomial_minus_bs": float(bi_bs.value),
    }


def pricing_batch(jobs: list[dict]) -> list[dict]:
    n = len(jobs)
    if n == 0:
        return []
    if _lib is None:
        return [{"mc": max(j["spot"] - j["strike"], 0.0),
                 "bs": max(j["spot"] - j["strike"], 0.0),
                 "binomial": max(j["spot"] - j["strike"], 0.0)} for j in jobs]
    spots      = (c_double * n)(*[j["spot"]           for j in jobs])
    strikes    = (c_double * n)(*[j["strike"]         for j in jobs])
    rates      = (c_double * n)(*[j["rate"]           for j in jobs])
    vols       = (c_double * n)(*[j["vol"]            for j in jobs])
    maturities = (c_double * n)(*[j["maturity"]       for j in jobs])
    npaths     = (c_int    * n)(*[int(j["n_paths"])   for j in jobs])
    divyields  = (c_double * n)(*[j["dividend_yield"] for j in jobs])
    out_mc, out_bs, out_bin = (c_double * n)(), (c_double * n)(), (c_double * n)()
    _lib.sf_pricing_batch(n, spots, strikes, rates, vols, maturities,
                          npaths, divyields, out_mc, out_bs, out_bin)
    return [{"mc": float(out_mc[i]), "bs": float(out_bs[i]), "binomial": float(out_bin[i])}
            for i in range(n)]


def scenario_bs5(
    spot: float, strike: float, rate: float, vol: float,
    maturity: float, dividend_yield: float,
) -> list[float]:
    if _lib is None:
        return [max(spot - strike, 0.0)] * 5
    out = (c_double * 5)()
    _lib.sf_scenario_bs5(spot, strike, rate, vol, maturity, dividend_yield, out)
    return [float(x) for x in out]


def hedging_pnl_std(spot: float, vol: float, maturity: float, n_rebalances: int) -> float:
    if _lib is None:
        return (max(spot, 1.0) * max(vol, 0.01) * max(maturity, 1e-8) ** 0.5
                / max(n_rebalances, 1) ** 0.5)
    return float(_lib.sf_delta_hedge_pnl_std(spot, vol, maturity, n_rebalances))


def simulation_path(
    model: str, n_steps: int, dt: float,
    sigma: float, kappa: float, theta: float, x0: float,
) -> list[float]:
    n = max(int(n_steps), 1)
    if _lib is None:
        return [x0] * (n + 1)
    out = (c_double * (n + 1))()
    length = int(_lib.sf_simulation_path(
        1 if model == "vasicek" else 0, n, dt, sigma, kappa, theta, x0, out))
    return [float(out[i]) for i in range(length)]


def stats_normal(mu: float, sigma: float, theta: float, sample_size: int) -> dict:
    if _lib is None:
        s = max(sigma, 1e-8)
        return {"mgf": (2.718281828459045 ** (mu * theta + 0.5 * s * s * theta * theta)),
                "mean": mu, "variance": s * s}
    mgf, mean, var = c_double(), c_double(), c_double()
    _lib.sf_stats_normal(mu, sigma, theta, int(sample_size), byref(mgf), byref(mean), byref(var))
    return {"mgf": float(mgf.value), "mean": float(mean.value), "variance": float(var.value)}


def ito_check(function_type: str, theta: float, t: float, n_steps: int) -> dict:
    if _lib is None:
        return {"function_type": function_type, "value": 0.0,
                "target_expectation": 1.0 if function_type == "exp_martingale" else 0.0}
    code = {"w2_minus_t": 1, "w3": 2}.get(function_type, 0)
    val, target = c_double(), c_double()
    _lib.sf_ito_check(code, theta, t, int(n_steps), byref(val), byref(target))
    return {"function_type": function_type,
            "value": float(val.value), "target_expectation": float(target.value)}


def measure_density_path(mu: float, r: float, sigma: float, t: float, n_steps: int) -> list[float]:
    n = max(int(n_steps), 20)
    if _lib is None:
        return [1.0] * (n + 1)
    out = (c_double * (n + 1))()
    length = int(_lib.sf_measure_density_path(mu, r, sigma, t, n, out))
    return [float(out[i]) for i in range(length)]


def pde_price(
    spot: float, strike: float, rate: float, vol: float, maturity: float,
    dividend_yield: float, s_steps: int, t_steps: int, method: str,
) -> float:
    if _lib is None:
        return max(spot - strike, 0.0)
    return float(_lib.sf_pde_price(
        spot, strike, rate, vol, maturity, dividend_yield,
        int(s_steps), int(t_steps), 1 if method == "implicit" else 0,
    ))


def measure_compare(
    mu: float, r: float, sigma: float, t: float,
    n_steps: int, n_paths: int, x0: float, preview_len: int = 50,
) -> dict:
    if _lib is None:
        dummy = {"mean": x0, "variance": 0.0, "q05": x0, "q50": x0, "q95": x0}
        return {"p_stats": dummy, "q_stats": dummy,
                "path_preview": {"P": [x0] * preview_len, "Q": [x0] * preview_len}}
    pl = max(1, min(int(preview_len), int(n_steps)))
    stats_buf   = (c_double * 10)()
    preview_buf = (c_double * (2 * pl))()
    _lib.sf_measure_compare(mu, r, sigma, t, int(n_steps), int(n_paths), x0,
                            stats_buf, preview_buf, pl)
    def _s(off: int) -> dict:
        return {"mean": float(stats_buf[off]),   "variance": float(stats_buf[off + 1]),
                "q05":  float(stats_buf[off + 2]), "q50": float(stats_buf[off + 3]),
                "q95":  float(stats_buf[off + 4])}
    return {
        "p_stats":      _s(0),
        "q_stats":      _s(5),
        "path_preview": {
            "P": [float(preview_buf[i])      for i in range(pl)],
            "Q": [float(preview_buf[pl + i]) for i in range(pl)],
        },
    }


def digital_call_bs(
    spot: float, strike: float, rate: float, vol: float,
    maturity: float, dividend_yield: float,
) -> float:
    if _lib is None:
        from math import log, sqrt, exp, erf
        if spot <= 0 or strike <= 0 or maturity <= 0 or vol <= 0:
            return exp(-rate * maturity) if spot > strike else 0.0
        d2 = (log(spot / strike) + (rate - dividend_yield - 0.5 * vol * vol) * maturity) / (vol * sqrt(maturity))
        return exp(-rate * maturity) * 0.5 * (1.0 + erf(d2 / sqrt(2.0)))
    return float(_lib.sf_digital_call_bs(spot, strike, rate, vol, maturity, dividend_yield))


def binomial_american(
    spot: float, strike: float, rate: float, vol: float, maturity: float, steps: int,
    dividend_yield: float = 0.0,
) -> float:
    if _lib is None:
        return max(spot - strike, 0.0)
    return float(_lib.sf_binomial_american_price(spot, strike, rate, vol, maturity, int(steps), dividend_yield))


def delta_hedge_pnl_distribution(
    spot: float, strike: float, rate: float, vol: float, maturity: float,
    n_rebalances: int, n_paths: int,
    n_bins: int = 40,
) -> dict:
    if _lib is None:
        return {"mean": 0.0, "std": 0.0, "q05": 0.0, "q50": 0.0, "q95": 0.0,
                "histogram": {"edges": [], "counts": []}}
    n_bins = max(10, int(n_bins))
    stats_buf  = (c_double * 5)()
    edges_buf  = (c_double * (n_bins + 1))()
    counts_buf = (c_double * n_bins)()
    _lib.sf_delta_hedge_pnl_histogram(
        spot, strike, rate, vol, maturity,
        int(n_rebalances), int(n_paths), n_bins,
        stats_buf, edges_buf, counts_buf,
    )
    return {
        "mean": float(stats_buf[0]),
        "std":  float(stats_buf[1]),
        "q05":  float(stats_buf[2]),
        "q50":  float(stats_buf[3]),
        "q95":  float(stats_buf[4]),
        "histogram": {
            "edges":  [float(edges_buf[i]) for i in range(n_bins + 1)],
            "counts": [float(counts_buf[i]) for i in range(n_bins)],
        },
    }


def delta_hedge_strategy_compare(
    spot: float, strike: float, rate: float, vol: float, maturity: float,
    n_rebalances: int, n_paths: int,
    transaction_cost_bps: float = 5.0,
    rebalance_threshold: float = 0.02,
    vol_mismatch_mult: float = 1.15,
) -> dict:
    labels = ["discrete_delta", "with_transaction_cost", "threshold_rebalance", "vol_mismatch"]
    if _lib is None:
        base = {
            "mean": 0.0, "std": 0.0, "q05": 0.0, "q50": 0.0, "q95": 0.0,
            "turnover": 0.0, "transaction_cost": 0.0, "var95": 0.0, "es95": 0.0,
        }
        return {k: dict(base) for k in labels}
    out = (c_double * 36)()
    _lib.sf_delta_hedge_strategy_compare(
        spot, strike, rate, vol, maturity,
        int(n_rebalances), int(n_paths),
        float(transaction_cost_bps), float(rebalance_threshold), float(vol_mismatch_mult),
        out,
    )
    result: dict[str, dict] = {}
    for i, key in enumerate(labels):
        off = i * 9
        result[key] = {
            "mean": float(out[off + 0]),
            "std": float(out[off + 1]),
            "q05": float(out[off + 2]),
            "q50": float(out[off + 3]),
            "q95": float(out[off + 4]),
            "turnover": float(out[off + 5]),
            "transaction_cost": float(out[off + 6]),
            "var95": float(out[off + 7]),
            "es95": float(out[off + 8]),
        }
    return result


def run_convergence_steps(
    spot: float, strike: float, rate: float, vol: float,
    maturity: float, dividend_yield: float,
    step_ladder: list[int],
) -> list[dict]:
    """Run the binomial step-ladder convergence loop, returning one row per step count."""
    bs_ref = pricing_bundle(spot, strike, rate, vol, maturity, 5000, 200, dividend_yield)["bs"]
    rows = []
    prev_err = None
    for steps in step_ladder:
        st = max(2, int(steps))
        binomial = pricing_bundle(spot, strike, rate, vol, maturity, 2000, st, dividend_yield)["binomial"]
        abs_err = abs(binomial - bs_ref)
        rel_err = abs_err / max(abs(bs_ref), 1e-10)
        rows.append({
            "steps": st, "bs_ref": bs_ref, "binomial": binomial,
            "abs_error": abs_err, "rel_error": rel_err,
            "error_ratio_vs_prev": (abs_err / prev_err) if prev_err else None,
        })
        prev_err = abs_err
    return rows


def vol_surface_interp(
    surface: list[dict],   # list of {"strike", "years", "iv"} dicts
    spot: float,
    target_strike: float,
    target_expiry: float,
) -> float | None:
    """
    Bilinear interpolation in (log-moneyness, sqrt-time) space via C++.
    Falls back to Python nearest-neighbour when the engine is unavailable.
    Returns IV decimal, or None if surface is empty.
    """
    if not surface:
        return None

    n = len(surface)
    strikes_arr  = (c_double * n)(*[p["strike"] for p in surface])
    expiries_arr = (c_double * n)(*[p["years"]  for p in surface])
    ivs_arr      = (c_double * n)(*[p["iv"]     for p in surface])

    if _lib is not None:
        result = float(_lib.sf_vol_surface_interp(
            strikes_arr, expiries_arr, ivs_arr,
            n, spot, target_strike, target_expiry,
        ))
        return result if result >= 0.0 else None

    # Pure-Python nearest-neighbour fallback (no engine)
    import math
    scale = target_strike if target_strike > 0 else 1.0
    best = min(
        surface,
        key=lambda p: math.hypot(
            (p["strike"] - target_strike) / scale,
            (p["years"]  - target_expiry),
        ),
    )
    return best["iv"]
