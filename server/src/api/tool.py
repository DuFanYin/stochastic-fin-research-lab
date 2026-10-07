"""API router assembler — collects sub-routers into a single router."""

from fastapi import APIRouter

from src.api.routes.pricing import router as pricing_router
from src.api.routes.hedging import router as hedging_router
from src.api.routes.task import router as task_router
from src.api.routes.validation import router as validation_router
from src.api.routes.market import router as market_router
from src.api.routes.greeks import router as greeks_router
from src.api.routes.multi_leg import router as multi_leg_router
from src.api.routes.calibration import router as calibration_router
from src.api.routes.stress import router as stress_router
from src.api.routes.screener import router as screener_router

router = APIRouter(tags=["tools"])
router.include_router(pricing_router)
router.include_router(hedging_router)
router.include_router(task_router)
router.include_router(validation_router)
router.include_router(market_router)
router.include_router(greeks_router)
router.include_router(multi_leg_router)
router.include_router(calibration_router)
router.include_router(stress_router)
router.include_router(screener_router)
