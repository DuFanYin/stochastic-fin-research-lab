"""The market snapshot: spot, DVOL, rates, funding and the IV surface, in one call."""

from quantlab.schemas.request_models import NoInput
from quantlab.services.market_data import fetch_btc_snapshot
from quantlab.tools.base import Result, Tool


async def market_snapshot(_: NoInput) -> Result:
    snap = await fetch_btc_snapshot()
    surface = snap.pop("iv_surface")
    return Result(summary=snap, details={"iv_surface": surface},
                  notes=[f"{k}: {v}" for k, v in snap.get("sources", {}).items()])


TOOLS = [
    Tool("market_snapshot", "BTC market snapshot",
         "Live BTC market inputs for pricing: spot (Binance), the DVOL implied-vol index (Deribit), the 3-month US Treasury "
         "rate with the curve from 1 month to 2 years, the perpetual funding rate as an annual drift mu, and an implied-vol "
         "surface (Deribit marks, the strikes nearest the money per expiry). Each source falls back to a fixed value "
         "offline. Use it to fill spot, vol, rate and mu before pricing a BTC option.",
         NoInput, market_snapshot, "/market/btc", method="GET", engine=False, network=True),
]
