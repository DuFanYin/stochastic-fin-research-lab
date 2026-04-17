"""Hedging routes."""
from time import perf_counter

from fastapi import APIRouter

from src.schemas.request_models import HedgingRequest
from src.services.engine_client import delta_hedge_pnl_distribution, delta_hedge_strategy_compare
from src.services.analytics import summarize_hedging_distribution
from src.api.shared import _diag, _record

router = APIRouter(tags=["hedging"])

def _pick_best_strategy(strategy_compare: dict) -> dict:
    if not strategy_compare:
        return {"name": None, "reason": "no_strategy_data"}
    # Prioritize tail-risk control (ES95), then volatility (std), then expected PnL.
    ranked = sorted(
        strategy_compare.items(),
        key=lambda kv: (
            kv[1].get("es95", float("inf")),
            kv[1].get("std", float("inf")),
            -kv[1].get("mean", float("-inf")),
        ),
    )
    name, stats = ranked[0]
    return {
        "name": name,
        "reason": "min_es95_then_std_then_mean",
        "es95": stats.get("es95"),
        "std": stats.get("std"),
        "mean": stats.get("mean"),
    }


@router.post("/tool/hedging/run")
def tool_hedging(req: HedgingRequest) -> dict:
    t0   = perf_counter()
    dist = delta_hedge_pnl_distribution(
        req.spot, req.strike, req.rate, req.vol, req.maturity,
        req.n_rebalances, req.n_paths,
    )
    ms = (perf_counter() - t0) * 1000.0
    analytics = summarize_hedging_distribution(dist, req.spot, req.n_rebalances)
    strategy_compare = delta_hedge_strategy_compare(
        req.spot, req.strike, req.rate, req.vol, req.maturity,
        req.n_rebalances, req.n_paths,
        req.transaction_cost_bps,
        req.rebalance_threshold,
        req.vol_mismatch_mult,
    )
    best_strategy = _pick_best_strategy(strategy_compare)
    return _record(
        tool_name="hedging",
        input_params=req.model_dump(),
        result_summary={
            "strategy":     "delta_hedge",
            "n_rebalances": req.n_rebalances,
            "n_paths":      req.n_paths,
            "pnl_mean":     dist["mean"],
            "pnl_std":      dist["std"],
            "pnl_q05":      dist["q05"],
            "pnl_q50":      dist["q50"],
            "pnl_q95":      dist["q95"],
            "best_strategy": best_strategy.get("name"),
            **analytics,
        },
        result_details={
            "histogram": dist.get("histogram", {}),
            "strategy_compare": strategy_compare,
            "best_strategy": best_strategy,
            "compare_config": {
                "transaction_cost_bps": req.transaction_cost_bps,
                "rebalance_threshold": req.rebalance_threshold,
                "vol_mismatch_mult": req.vol_mismatch_mult,
            },
        },
        diagnostics=_diag(ms, ["delta_hedge_mc", "hedge_strategy_compare"]),
    )
