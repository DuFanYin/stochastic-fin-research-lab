"""API router assembler — collects sub-routers into a single router."""

from fastapi import APIRouter

from src.api.routes.pricing import router as pricing_router
from src.api.routes.hedging import router as hedging_router
from src.api.routes.validation import router as validation_router
from src.api.routes.market import router as market_router

router = APIRouter(tags=["tools"])
router.include_router(pricing_router)
router.include_router(hedging_router)
router.include_router(validation_router)
router.include_router(market_router)
