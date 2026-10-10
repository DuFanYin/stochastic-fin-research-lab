"""Generic engine dispatch: any engine task by task_type, the engine's own response unchanged."""

from uuid import uuid4

from fastapi import APIRouter, HTTPException

from quantlab.services.engine_client import run_engine_task
from quantlab.version import CONTRACT_VERSION

router = APIRouter(tags=["task"])


@router.post("/v1/task/run")
def run_task(req: dict) -> dict:
    task_type = req.get("task_type")
    if not isinstance(task_type, str) or not task_type.strip():
        raise HTTPException(status_code=400, detail="task_type is required")
    return run_engine_task(task_type, {**req, "contract_version": CONTRACT_VERSION, "trace_id": req.get("trace_id") or str(uuid4())})
