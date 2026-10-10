"""The HTTP server: the tools under /api (one route each at its path, and /api/tools to list them and call one by name),
MCP at /mcp, /llms.txt, and the workbench page at /."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.routing import Route

from quantlab import llms
from quantlab.api.router import router
from quantlab.mcp import HttpEndpoint
from quantlab.services import engine_client, market_data
from quantlab.tools import TOOLS, Tool, ToolError, call
from quantlab.version import CONTRACT_VERSION, __version__

mcp_endpoint = HttpEndpoint()


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with mcp_endpoint.running():
        yield
    await market_data.close()


app = FastAPI(title="Quant Lab", version=__version__, lifespan=lifespan,
              description="Option pricing, calibration, risk, numerics and a live options screener. "
                          "Every tool is also at /api/tools and over MCP at /mcp.")


@app.exception_handler(ToolError)
async def tool_error(_: Request, exc: ToolError) -> JSONResponse:
    return JSONResponse({"detail": exc.message}, status_code=exc.status)


app.include_router(router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok" if engine_client.is_engine_available() else "degraded", "version": __version__,
            "contract_version": CONTRACT_VERSION, "engine": engine_client.ENGINE_PROBLEM or "ok"}


def tool_info(t: Tool) -> dict:
    return {"name": t.name, "title": t.title, "description": t.description, "cost": t.cost, "network": t.network,
            "http": {"method": t.method, "path": "/api" + t.path}, "input_schema": t.schema()}


@app.get("/api/tools", tags=["tools"])
def list_tools() -> dict:
    """Every tool, with its description and input schema."""
    return {"contract_version": CONTRACT_VERSION, "tools": [tool_info(t) for t in TOOLS.values()]}


@app.post("/api/tools/{name}", tags=["tools"])
async def call_tool(name: str, arguments: dict = Body(default_factory=dict)) -> dict:
    """Runs one tool by name; the body is its arguments."""
    try:
        return await call(name, arguments)
    except ValidationError as exc:
        return JSONResponse({"detail": exc.errors(include_url=False, include_context=False)}, status_code=422)


@app.get("/llms.txt", response_class=PlainTextResponse)
def llms_txt() -> str:
    return llms.text()


app.router.routes.append(Route("/mcp", endpoint=mcp_endpoint, methods=["GET", "POST", "DELETE"]))


@app.get("/workbench.html")
def old_page() -> RedirectResponse:
    return RedirectResponse(url="./")  # the page before the rebuild (relative: works behind a path prefix)


# The workbench, built from web/ by `npm run build` (index.html is served at /): in an installed package next to this
# file, in the repository at its root.
_static = next((d for d in (Path(__file__).parent / "static", Path(__file__).resolve().parents[2] / "static") if d.is_dir()), None)
if _static is not None:
    app.mount("/", StaticFiles(directory=str(_static), html=True), name="web")
