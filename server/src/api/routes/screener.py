"""Option strategy screener on the Deribit chain: chain, snapshots, run."""

from time import perf_counter

from fastapi import APIRouter, HTTPException, Query

from src.api.shared import _diag, _record
from src.schemas.request_models import ScreenerRequest
from src.services.engine_client import screener as run_screener_engine
from src.services.market_data import (
    _FB_VOL,
    SUPPORTED_CURRENCIES,
    ChainUnavailable,
    _fetch_dvol,
    fetch_option_chain,
    list_chain_snapshots,
    load_chain_snapshot,
    surface_rows_from_chain,
)

router = APIRouter(tags=["screener"])


async def _load_chain(currency: str, snapshot_id: str | None) -> dict:
    if snapshot_id:
        try:
            chain = load_chain_snapshot(snapshot_id)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=404, detail=f"snapshot not found: {snapshot_id}") from exc
        if chain.get("currency") != currency:
            raise HTTPException(status_code=400, detail=f"snapshot {snapshot_id} is not a {currency} chain")
        return chain
    try:
        return await fetch_option_chain(currency)
    except ChainUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _source_block(chain: dict) -> dict:
    return {
        "currency":   chain["currency"],
        "source":     chain["source"],
        "fetched_at": chain["fetched_at"],
        "spot":       chain["spot"],
        "rate":       chain["rate"],
        "multiplier": chain["multiplier"],
    }


def _source_notes(chain: dict) -> list[str]:
    if chain["source"] == "live":
        return []
    return [f"using {chain['source']} {chain['currency']} chain from {chain['fetched_at']} (live data unavailable)"]


@router.get("/tool/screener/snapshots")
def get_snapshots(currency: str | None = None) -> dict:
    if currency is not None and currency.upper() not in SUPPORTED_CURRENCIES:
        raise HTTPException(status_code=400, detail=f"unsupported currency: {currency}")
    snaps = list_chain_snapshots(currency)
    return {"snapshots": [{"snapshot_id": s["snapshot_id"], "currency": s["currency"]} for s in snaps]}


@router.get("/tool/screener/chain")
async def get_chain(
    currency: str = "BTC",
    max_days: float | None = Query(None, gt=0),
    snapshot_id: str | None = None,
) -> dict:
    cur = currency.upper()
    if cur not in SUPPORTED_CURRENCIES:
        raise HTTPException(status_code=400, detail=f"unsupported currency: {currency}")
    t0 = perf_counter()
    data = await _load_chain(cur, snapshot_id)
    rows = data["chain"]
    expiries = data["expiries"]
    if max_days is not None:
        rows = [r for r in rows if r["years"] * 365.0 <= max_days]
        expiries = [e for e in expiries if e["years"] * 365.0 <= max_days]
    return _record(
        tool_name="screener_chain",
        input_params={"currency": cur, "max_days": max_days, "snapshot_id": snapshot_id},
        result_summary={**_source_block(data), "n_options": len(rows), "n_expiries": len(expiries)},
        result_details={"expiries": expiries, "chain": rows},
        diagnostics=_diag((perf_counter() - t0) * 1000.0, _source_notes(data)),
    )


@router.post("/tool/screener/run")
async def run_screener(req: ScreenerRequest) -> dict:
    if not any(req.strategies.model_dump().values()):
        raise HTTPException(status_code=400, detail="select at least one strategy type")
    t0 = perf_counter()
    data = await _load_chain(req.currency, req.snapshot_id)
    notes = _source_notes(data)

    model_vol, extra = req.model_vol, {}
    if model_vol == "dvol":
        dvol = await _fetch_dvol(req.currency)
        model_vol, extra = "flat", {"model_vol_flat": dvol}
        if dvol == _FB_VOL:
            notes.append(f"model vol: {req.currency} DVOL unavailable, using fallback {dvol:.2f}")
        else:
            notes.append(f"model vol: {req.currency} DVOL {dvol:.4f}")
    elif model_vol == "flat":
        if req.model_vol_flat is None:
            raise HTTPException(status_code=422, detail="model_vol_flat is required when model_vol is 'flat'")
        extra = {"model_vol_flat": req.model_vol_flat}
    elif model_vol == "surface":
        rows = surface_rows_from_chain(data["chain"], data["spot"])
        if not rows:
            raise HTTPException(status_code=422, detail="chain has no valid IVs to build a surface")
        extra = {"surface": {"strikes": [r["strike"] for r in rows],
                             "expiries": [r["years"] for r in rows],
                             "ivs": [r["iv"] for r in rows]}}
    elif model_vol == "heston":
        if req.heston is None:
            raise HTTPException(status_code=422, detail="heston parameters are required when model_vol is 'heston'")
        extra = {"heston": req.heston.model_dump()}

    rate = data["rate"] if req.rate is None else req.rate
    rank = req.rank.model_dump(exclude_none=True)
    engine_request = {
        "spot": data["spot"], "rate": rate, "multiplier": data["multiplier"],
        "price_mode": req.price_mode, "model_vol": model_vol, **extra,
        "chain": data["chain"],
        "strategies": req.strategies.model_dump(),
        "option_filter": req.option_filter.model_dump(),
        "strategy_filter": req.strategy_filter.model_dump(),
        "rank": rank,
    }
    r = run_screener_engine(engine_request)
    if r.get("status") != "ok":
        err = r.get("error") or {}
        raise HTTPException(status_code=400, detail=f"screener failed: {err.get('message') or err.get('code')}")

    summary = {**r["result_summary"], **_source_block(data), "rate": rate, "model_vol_requested": req.model_vol}
    return _record(
        tool_name="screener",
        input_params=req.model_dump(),
        result_summary=summary,
        result_details={"strategies": r["result_details"]["strategies"], "expiries": data["expiries"]},
        diagnostics=_diag((perf_counter() - t0) * 1000.0, notes),
    )
