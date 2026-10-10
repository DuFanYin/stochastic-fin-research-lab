# Quant Lab for agents

Every computation of the lab is a **tool**: a name, a description written for a model, an input schema with every field
explained, and one result envelope. The same 26 tools are offered five ways:
- over MCP;
- over HTTP;
- as a Python library;
- on the command line;
- described in `llms.txt`.

All five are made from one registry, so they never disagree. How it is built: [DOCUMENTATION.md §7](DOCUMENTATION.md#7-agent-toolkit).

## Connect an agent

**MCP, the public lab** (no install). Streamable HTTP, stateless:

```bash
claude mcp add --transport http quantlab https://dufanyin.dev/lab/mcp
```

Any MCP client works the same way with the URL `https://dufanyin.dev/lab/mcp`. The public lab gives each address 120 seconds
of computing time per 10 minutes (see DOCUMENTATION.md §8); a copy of your own has no limits.

**MCP, your own copy**, on stdio:

```bash
pip install git+https://github.com/DuFanYin/stochastic-fin-research-lab   # builds the C++ engine: CMake, a C++23 compiler, OpenMP, nlohmann/json
claude mcp add quantlab -- quantlab mcp
```

A server you run yourself (`quantlab serve` or `./run.sh`) also answers MCP at `http://127.0.0.1:8000/mcp`.

**HTTP.**
- `GET /api/tools` lists every tool with its description and JSON Schema.
- `POST /api/tools/<name>` with the arguments as a JSON object runs one.

```bash
curl -s https://dufanyin.dev/lab/api/tools/price_option -H 'content-type: application/json' \
  -d '{"spot": 100, "strike": 105, "rate": 0.03, "vol": 0.2, "maturity": 0.5}'
```

Each tool also keeps its own route, for example `POST /api/tool/pricing/run`; `/api/tools` lists every path.

**Python**, in-process: no server, the engine is loaded with ctypes.

```python
import quantlab

r = quantlab.price_option(spot=100, strike=105, rate=0.03, vol=0.2, maturity=0.5)
r["result_summary"]["bs"], r["result_summary"]["greeks"]["delta_bs"]

quantlab.list_tools()                 # name -> title
print(quantlab.describe("screen_strategies"))
await quantlab.acall("option_chain", currency="BTC", max_days=30)   # inside an event loop
```

**Command line**, for agents that work in a shell:

```bash
quantlab list
quantlab describe validate
quantlab price_option --spot 100 --strike 105 --rate 0.03 --vol 0.2 --maturity 0.5 --summary
echo '{"currency": "BTC", "strategies": {"strangles": true}}' | quantlab screen_strategies --input - --summary
```

**llms.txt**: [dufanyin.dev/lab/llms.txt](https://dufanyin.dev/lab/llms.txt) lists every tool with a one-paragraph
description and an example call.

## The tools

| Area | Tools |
|---|---|
| Pricing | `price_option` (every method at once, with Greeks), `price_batch`, `price_grid`, `scenario_sweep`, `price_strategy` (multi-leg), `greek_surface` |
| Numerics | `pde_price`, `lattice_convergence`, `benchmark_methods` |
| Calibration | `implied_vol`, `implied_vol_batch`, `heston_price`, `calibrate_heston` |
| Risk | `stress_packs`, `stress_test` (an option or a position), `compare_hedges` |
| Market | `market_snapshot` (BTC spot, DVOL, rates, funding, IV surface), `option_chain`, `chain_snapshots` |
| Screener | `screen_strategies` |
| Theory and checks | `normal_moments`, `ito_check`, `simulate_path`, `measure_density`, `measure_compare`, `validate` |

Units everywhere:
- rates, vols, yields and drifts are decimals per year (0.05 = 5%);
- maturities are in years;
- prices are in the units of spot (USD for BTC and ETH).

## What comes back

Every tool returns one envelope (contract version 2.0):

| Field | Contents |
|---|---|
| `result_summary` | the headline numbers |
| `result_details` | tables, curves and grids |
| `warnings` | what makes the result less trustworthy: a stale or fixture chain, wide or stale quotes, a poor fit, a failed check |
| `diagnostics` | compute time, engine threads, notes on how it was computed (data sources, methods) |
| `input_params` | the arguments after validation, with defaults filled in |
| `run_id`, `created_at`, `tool`, `status`, `contract_version` | identification |

Errors come back in two forms:
- **Bad arguments** come back as a message per field, e.g. `strike: Field required`.
- **A request the tool cannot answer** comes back as a message saying what to change, e.g. "select at least one strategy type".

Over MCP both are an `isError` result, so the agent can correct itself.

Lists longer than 40 items are cut over MCP and on the command line, with a note of how many were left out. Use the HTTP API
or `--full` for everything.

## Evaluation

[`evals/`](../evals) holds agent tasks with checkable answers. The truth of each is computed with the tools at check time.
Run them with Claude:

```bash
ANTHROPIC_API_KEY=... server/.venv/bin/python evals/run.py            # --task bs_price, --live for the live-chain task, --model ...
```

When a task fails, improve the tool's description or its error message, not the task. `tests/test_evals.py` keeps the tasks
and the runner working offline.
