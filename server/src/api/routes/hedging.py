"""Hedging routes."""
import uuid

from fastapi import APIRouter

from src.api.shared import dispatch_task
from src.schemas.request_models import HedgingRequest

router = APIRouter(tags=["hedging"])


@router.post("/tool/hedging/run")
def tool_hedging(req: HedgingRequest) -> dict:
    payload = req.model_dump()
    payload["trace_id"] = str(uuid.uuid4())
    return dispatch_task(payload, task_type="hedging", trace_prefix="hedging")
