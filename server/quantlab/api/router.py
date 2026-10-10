"""The /api routes: one per tool, made from the registry (quantlab.tools) at the tool's path, then the page's own data
endpoints (market) and the raw engine dispatch (task)."""

from typing import Annotated

from fastapi import APIRouter, Query

from quantlab.api.routes.market import router as market_router
from quantlab.api.routes.task import router as task_router
from quantlab.tools import TOOLS, Tool, run_tool


def _endpoint(tool: Tool):
    if tool.method == "GET":
        async def endpoint(params: Annotated[tool.input, Query()]) -> dict:
            return await run_tool(tool, params)
    else:
        async def endpoint(params: tool.input) -> dict:
            return await run_tool(tool, params)
    return endpoint


router = APIRouter()
for _tool in TOOLS.values():
    router.add_api_route(_tool.path, _endpoint(_tool), methods=[_tool.method], name=_tool.name,
                         summary=_tool.title, description=_tool.description, tags=["tools"])
router.include_router(market_router)
router.include_router(task_router)
