"""Model calibration routes: implied vol (Brent), Heston (Nelder-Mead)."""
from fastapi import APIRouter

from src.schemas.request_models import (
    HestonCalibrateRequest,
    HestonPriceRequest,
    ImpliedVolBatchRequest,
    ImpliedVolRequest,
)
from src.services.engine_client import (
    heston_calibrate,
    heston_price,
    implied_vol_batch,
    implied_vol_single,
)
from src.api.shared import _diag, _record

router = APIRouter(tags=["calibration"])


@router.post("/tool/calibration/iv")
async def run_implied_vol(req: ImpliedVolRequest) -> dict:
    result = implied_vol_single(
        market_price=req.market_price,
        spot=req.spot,
        strike=req.strike,
        rate=req.rate,
        maturity=req.maturity,
        dividend_yield=req.dividend_yield,
    )
    return _record(
        tool_name="implied_vol",
        input_params=req.model_dump(),
        result_summary=result,
        result_details={},
        diagnostics=_diag(),
    )


@router.post("/tool/calibration/iv/batch")
async def run_implied_vol_batch(req: ImpliedVolBatchRequest) -> dict:
    result = implied_vol_batch(
        market_prices=req.market_prices,
        strikes=req.strikes,
        expiries=req.expiries,
        spot=req.spot,
        rate=req.rate,
        dividend_yield=req.dividend_yield,
    )
    summary = {
        "n_converged":      result.get("n_converged", 0),
        "convergence_rate": result.get("convergence_rate", 0.0),
        "n_points":         len(req.market_prices),
    }
    details = {
        "ivs":       result.get("ivs", []),
        "converged": result.get("converged", []),
    }
    return _record(
        tool_name="implied_vol_batch",
        input_params={"spot": req.spot, "rate": req.rate, "n_points": len(req.market_prices)},
        result_summary=summary,
        result_details=details,
        diagnostics=_diag(),
    )


@router.post("/tool/calibration/heston/price")
async def run_heston_price(req: HestonPriceRequest) -> dict:
    price = heston_price(
        spot=req.spot, strike=req.strike, rate=req.rate, maturity=req.maturity,
        v0=req.v0, kappa=req.kappa, theta=req.theta, xi=req.xi, rho=req.rho,
    )
    return _record(
        tool_name="heston_price",
        input_params=req.model_dump(),
        result_summary={"heston_price": price},
        result_details={},
        diagnostics=_diag(),
    )


@router.post("/tool/calibration/heston")
async def run_heston_calibrate(req: HestonCalibrateRequest) -> dict:
    result = heston_calibrate(
        spot=req.spot,
        rate=req.rate,
        market_strikes=req.market_strikes,
        market_maturities=req.market_maturities,
        market_prices=req.market_prices,
        dividend_yield=req.dividend_yield,
        init_v0=req.init_v0, init_kappa=req.init_kappa, init_theta=req.init_theta,
        init_xi=req.init_xi, init_rho=req.init_rho,
        max_iter=req.max_iter,
    )
    summary = {k: result[k] for k in ("v0","kappa","theta","xi","rho",
                                       "rmse","max_abs_error","iterations","converged")}
    details = {k: result[k] for k in ("model_prices", "residuals")}
    # The fit's quality from the RMSE as a share of the average quote, so it reads the same at any price level
    scale = sum(abs(p) for p in req.market_prices) / max(len(req.market_prices), 1)
    rel = result.get("rmse", float("inf")) / scale if scale > 0 else float("inf")
    summary["rmse_rel"] = rel
    summary["fit_quality"] = "good" if rel < 0.02 else "fair" if rel < 0.05 else "poor"
    return _record(
        tool_name="heston_calibrate",
        input_params={"spot": req.spot, "rate": req.rate, "n_points": len(req.market_prices)},
        result_summary=summary,
        result_details=details,
        diagnostics=_diag(),
    )
