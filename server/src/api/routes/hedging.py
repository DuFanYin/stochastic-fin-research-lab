"""Hedging routes."""
from time import perf_counter

from fastapi import APIRouter

from src.schemas.request_models import HedgingRequest
from src.services.engine_client import delta_hedge_pnl_distribution
from src.services.analytics import summarize_hedging_distribution
from src.api.shared import _diag, _record

router = APIRouter(tags=["hedging"])


@router.post("/tool/hedging/run")
def tool_hedging(req: HedgingRequest) -> dict:
    t0   = perf_counter()
    dist = delta_hedge_pnl_distribution(
        req.spot, req.strike, req.rate, req.vol, req.maturity,
        req.n_rebalances, req.n_paths,
    )
    ms = (perf_counter() - t0) * 1000.0
    analytics = summarize_hedging_distribution(dist, req.spot, req.n_rebalances)
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
            **analytics,
        },
        result_details={"histogram": dist.get("histogram", {})},
        diagnostics=_diag(ms, ["delta_hedge_mc"]),
    )
