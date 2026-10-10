"""llms.txt: the lab described for language models, made from the tool registry so it never falls behind it."""

import json

from quantlab.mcp import PUBLIC_URL
from quantlab.tools import TOOLS
from quantlab.version import __version__

REPO = "https://github.com/DuFanYin/stochastic-fin-research-lab"


def text() -> str:
    lines = [
        "# Quant Lab",
        "",
        "> Option pricing, calibration, risk, numerics and a live BTC / ETH options screener, computed by a C++23 engine. "
        "Free to call, open source (MIT).",
        "",
        "Units: rates, vols, yields and drifts are decimals per year (0.05 = 5%); maturities are in years; prices are in the "
        "units of spot. Every result has result_summary, result_details, warnings and diagnostics.",
        "",
        "## Use it",
        "",
        f"- MCP (streamable HTTP, stateless): {PUBLIC_URL}mcp",
        f"- HTTP: GET {PUBLIC_URL}api/tools lists the tools with JSON Schemas; POST {PUBLIC_URL}api/tools/<name> with the "
        "arguments as a JSON object runs one",
        f"- Python, in-process: pip install git+{REPO}, then quantlab.price_option(spot=100, strike=105, rate=0.03, vol=0.2, "
        "maturity=0.5)",
        "- CLI: quantlab price_option --spot 100 --strike 105 --rate 0.03 --vol 0.2 --maturity 0.5; quantlab mcp serves MCP on stdio",
        "- The public lab gives each address 120 s of computing time per 10 minutes; your own copy has no limits.",
        "",
        "## Tools",
        "",
    ]
    for t in TOOLS.values():
        lines.append(f"- {t.name}: {t.description}")
        if t.example:
            lines.append(f"  Example: {json.dumps(t.example, separators=(',', ':'))}")
    lines += ["", "## More", "", f"- Source and documentation: {REPO}", f"- The workbench (a page for people): {PUBLIC_URL}",
              f"- Version {__version__}"]
    return "\n".join(lines) + "\n"
