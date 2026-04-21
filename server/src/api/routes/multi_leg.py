"""Multi-leg option strategy pricing route."""
from fastapi import APIRouter

from src.schemas.request_models import MultiLegRequest
from src.services.engine_client import multi_leg
from src.api.shared import _diag, _record

router = APIRouter(tags=["pricing"])


@router.post("/tool/pricing/multi-leg")
async def run_multi_leg(req: MultiLegRequest) -> dict:
    legs_payload = [
        {"option_type": leg.option_type, "strike": leg.strike, "quantity": leg.quantity}
        for leg in req.legs
    ]
    result = multi_leg(
        spot=req.spot,
        rate=req.rate,
        vol=req.vol,
        maturity=req.maturity,
        legs=legs_payload,
        dividend_yield=req.dividend_yield,
        n_paths=req.n_paths,
    )
    summary = {
        "net_bs_price":  result.get("net_bs_price",  0.0),
        "net_mc_price":  result.get("net_mc_price",  0.0),
        "net_delta":     result.get("net_delta",     0.0),
        "net_vega":      result.get("net_vega",      0.0),
        "strategy_hint": result.get("strategy_hint", ""),
        "n_legs":        result.get("n_legs",        len(req.legs)),
    }
    details = {"legs": result.get("legs", [])}
    return _record(
        tool_name="multi_leg",
        input_params=req.model_dump(),
        result_summary=summary,
        result_details=details,
        diagnostics=_diag(),
    )
