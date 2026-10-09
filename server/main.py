from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from src.api.tool import router as tool_router

app = FastAPI(title="Stochastic Finance Host", version="0.1.0")

app.include_router(tool_router, prefix="/api")
PROJECT_ROOT = Path(__file__).resolve().parents[1]


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/workbench.html")
def old_page() -> RedirectResponse:
    return RedirectResponse(url="./")  # the page before the rebuild (relative: works behind a path prefix)


# the workbench, built from web/ by `npm run build` (index.html is served at /)
web_dir = PROJECT_ROOT / "static"
if web_dir.exists():
    app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")

