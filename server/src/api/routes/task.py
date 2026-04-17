"""Unified task endpoint for C++ orchestrator."""

from uuid import uuid4

from fastapi import APIRouter, HTTPException

from src.api.shared import dispatch_task

router = APIRouter(tags=["task"])


@router.post("/v1/task/run")
def run_task(req: dict) -> dict:
    task_type = req.get("task_type")
    if not isinstance(task_type, str) or not task_type.strip():
        raise HTTPException(status_code=400, detail="task_type is required")

    payload = dict(req)
    payload.setdefault("trace_id", str(uuid4()))
    return dispatch_task(payload, task_type=task_type, trace_prefix=task_type)
