"""Greek surface route."""
from fastapi import APIRouter

from src.schemas.request_models import GreekSurfaceRequest
from src.services.engine_client import greek_surface
from src.api.shared import _diag, _record

router = APIRouter(tags=["greeks"])


@router.post("/tool/greek/surface")
async def run_greek_surface(req: GreekSurfaceRequest) -> dict:
    result = greek_surface(
        strike=req.strike,
        rate=req.rate,
        vol=req.vol,
        dividend_yield=req.dividend_yield,
        spot_min=req.spot_min,
        spot_max=req.spot_max,
        mat_min=req.mat_min,
        mat_max=req.mat_max,
        n_spots=req.n_spots,
        n_mats=req.n_mats,
        greek=req.greek,
    )
    summary = {
        "greek":    result.get("greek", req.greek),
        "n_spots":  result.get("n_spots", req.n_spots),
        "n_mats":   result.get("n_mats", req.n_mats),
        "grid_min": result.get("grid_min", 0.0),
        "grid_max": result.get("grid_max", 1.0),
    }
    details = {
        "spots":      result.get("spots", []),
        "maturities": result.get("maturities", []),
        "grid":       result.get("grid", []),
    }
    return _record(
        tool_name="greek_surface",
        input_params=req.model_dump(),
        result_summary=summary,
        result_details=details,
        diagnostics=_diag(),
    )
