"""Delta-hedging comparison."""

from quantlab.schemas.request_models import HedgingRequest
from quantlab.tools.base import Result, Tool, engine_task


def compare_hedges(req: HedgingRequest) -> Result:
    return engine_task("hedging", req.model_dump())


TOOLS = [
    Tool("compare_hedges", "Compare delta-hedging strategies",
         "Replicates a European call by delta hedging on simulated paths, starting from its Black-Scholes premium, with four "
         "strategies run on the same paths: discrete delta, delta with transaction costs, threshold rebalancing, and hedging "
         "with a mismatched vol. P&L is the hedging error: the call's payoff minus the hedge portfolio at expiry. Use it to "
         "judge how well a hedge works and what it costs. Returns result_summary (the P&L mean, std and quantiles of discrete "
         "delta hedging, "
         "best_strategy) and result_details.strategy_compare (per strategy: mean, std, q05/q50/q95, var95, es95, turnover, "
         "transaction_cost), best_strategy (lowest ES95) and a P&L histogram.",
         HedgingRequest, compare_hedges, "/tool/hedging/run",
         example={"spot": 100.0, "strike": 100.0, "rate": 0.03, "vol": 0.2, "maturity": 0.5, "n_paths": 2000}),
]
