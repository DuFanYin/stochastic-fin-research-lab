# Quant Lab — Roadmap

What has been built, in order, and what is left. How the system works today is in [DOCUMENTATION.md](DOCUMENTATION.md). Every
item below follows the layer rules and the propagation chain described there.

## Done

| Milestone | What it added |
|---|---|
| V1 → full rework | C++ engine, FastAPI server, single-page workbench; pricing, simulation, Itô and measure checks, hedging, validation gate |
| Greek surfaces | all five Greeks on every price; Greek heatmaps over spot × maturity |
| Puts and multi-leg | puts across every method; multi-leg pricing with strategy detection |
| Calibration | Brent implied vol (single and batch), Heston pricing and Nelder-Mead calibration |
| Stress aggregation | stress packs served by the API; cross-scenario robustness summary; adjustable burst-zone quantiles |
| Hedge efficiency frontier | Pareto chart of hedge strategies in (cost, ES95) |
| MC variance reduction | antithetic and Sobol samplers |
| Screener | option-screener ported to the engine; strategy filters, ranking, model value and edge |
| Deribit option chain | BTC / ETH chains in two requests, snapshots on disk, offline fixture; IV surface rebuilt on it |
| Screener API and workbench | screener routes; Strategies and Chain views; one-click hand-off to Multi-Leg and Risk; portfolio stress |
| More pricing methods | trinomial, LSM, explicit and American finite differences (PSOR), verified against QF-205 |
| Concurrency bench | SPSC queue, ring buffer and thread pool against OpenMP on the engine's own LSM code |
| Linux only | single supported platform; macOS and Windows branches removed |
| Workbench rewrite | Preact + Tailwind built by Vite; one Run button; legs and filters edited in windows; SVG charts that follow the theme |
| Public lab | hosted at [dufanyin.dev/lab](https://dufanyin.dev/lab/) for anyone, within limits; searchable (description, sitemap, link previews) |
| Theory checks that measure | sample moments from a real sample; Itô's formula checked on discrete paths (converges like √Δt); Heston fit graded relative to the quotes |

## Next

### 1. Agent toolkit: the lab as a library agents call

The lab's numbers are reachable only through a browser page or a loose HTTP API. The goal is that an agent (Claude, or any
LLM with tool use, or a script) can price, calibrate, stress, hedge and screen with the same engine, discover what each tool
does from its schema alone, and trust or reject a number from what comes back with it.

**Constraints.** The engine stays the only place numbers come from: no numerics in Python or in the tool layer. Every
interface below is generated from one registry, so the HTTP routes, the Python API and the agent tools never drift apart.
Existing routes keep working.

**One registry of tools.** Each tool is declared once: name, a description written for a model (what it computes, when to use
it, units, typical ranges), its Pydantic input model, its output model, the handler, and a cost class (instant, seconds, heavy).
The request models in `server/src/schemas/request_models.py` become the inputs, with a `description` on every field (none has
one today). The registry generates the FastAPI routes, the JSON Schemas and the agent tools.

**Interfaces, in order.**
1. **Python package** `quantlab`: `pip install quantlab` ships `libsf_engine_c.so` in a Linux x86-64 wheel; typed functions
   (`quantlab.price(...)`, `quantlab.stress(...)`, `quantlab.screen(...)`) call the engine in-process, no server. The server's
   routes become thin wrappers over the same functions.
2. **MCP server** `quantlab-mcp`: the registry over the Model Context Protocol, on stdio for a local agent and over streamable HTTP
   at `dufanyin.dev/lab/mcp` for anyone, with the public lab's limits (signed in: none). First tools: `price_option`,
   `price_strategy`, `implied_vol`, `calibrate_heston`, `greek_surface`, `stress`, `compare_hedges`, `market_snapshot`,
   `option_chain`, `screen_strategies`, `validate`.
3. **CLI** for agents that work in a shell: `quantlab price --spot 100 --strike 105 --vol 0.2 --maturity 0.5 --json`.
4. **`llms.txt`** at `dufanyin.dev/lab/llms.txt`: the tools, their inputs and an example call each, for agents that read the web.

**Results an agent can judge.** One envelope for every tool (item 6 below, done first): units on every number, the
assumptions used (model, market-data source and timestamp, seed), the validation gate's warnings, and a `run_id` that
reproduces the result (item 2). Errors are structured and say what to change, as the Explainable QA already does for the gate.

**Evaluation.** A set of agent tasks, each with a checkable answer, run against the MCP server in CI: "price a 3-month ATM BTC
call three ways and explain the spread", "find the cheapest BTC strangle with positive edge expiring this month and stress it",
"why does this Monte Carlo price disagree with Black-Scholes?". When an agent fails, the tool description or the error message
is what gets fixed.

### 2. Persistence: run history

Every result is lost when the page closes. There is no run history, no comparison across sessions, and no way to reproduce a result
by its ID.

**Constraints.** SQLite through Python's built-in `sqlite3`, so there is no new dependency and no database process. The database
lives at `~/.quant-lab/runs.db`, outside the repository. Existing routes do not change.

**Schema.**

```sql
CREATE TABLE runs (
    run_id       TEXT PRIMARY KEY,
    tool_name    TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    input_json   TEXT NOT NULL,   -- input_params
    summary_json TEXT NOT NULL,   -- result_summary
    details_json TEXT NOT NULL,   -- result_details
    diag_json    TEXT NOT NULL    -- diagnostics
);
CREATE INDEX idx_runs_tool    ON runs(tool_name);
CREATE INDEX idx_runs_created ON runs(created_at);
```

**Server.**
- A new service `run_store.py`:
  ```python
  class RunStore:
      def write(self, record: dict) -> None: ...
      def list_runs(self, tool_name=None, limit=50) -> list[dict]: ...
      def get_run(self, run_id: str) -> dict | None: ...
  ```
- Tool responses are built in two places in `server/src/api/shared.py`: `_record()` and `dispatch_task()`. Writing the row
  in both persists every tool route without touching the routes. The engine's envelope has `trace_id` where `_record()` has
  `run_id`, so the two have to be mapped onto one schema.
- New routes in `routes/history.py`:
  - `GET /api/runs?tool=&limit=50`: recent runs, summary only;
  - `GET /api/runs/{run_id}`: the full record;
  - `DELETE /api/runs/{run_id}`: remove one run.

**Workbench.**
- **History drawer**: a collapsible drawer at the bottom of the page, always available. It is not a mode. It shows a table of
  recent runs with time, tool, key inputs and a headline metric.
  - Clicking a row loads that result back into the results column.
  - A Compare toggle shows two runs side by side, with the differences annotated.
- **Run ID badge**: each result card shows its `run_id` as a badge in the header; clicking the badge copies the ID.

### 3. Slow Treasury curve

The Treasury yield-curve XML takes about 18 s per request (measured again on 2026-10-09), so the first `/api/market/btc` after
startup is slow. The curve is cached for an hour after that.

Options:
- fetch it in the background at startup;
- switch to a faster Treasury endpoint;
- serve the fallback curve until the real one arrives.

### 4. HTTP clients and the event loop

`market_data.py` creates its `httpx.AsyncClient` objects at import time, which ties them to the first event loop that uses them.
That is fine under uvicorn, but tests must use `with TestClient(...)`. Creating the clients in the FastAPI lifespan removes the
restriction.

### 5. Hedging for portfolios

The hedging engine handles one option. In portfolio stress (a request with `legs`), the hedge comparison is skipped and the
binomial column is left out. Extending delta hedging to a set of legs would give the screener → Risk flow the full stress output.

### 6. Smaller items

- **One envelope**: routes return either the engine's task envelope or the `_record()` envelope (see DOCUMENTATION.md §5).
  Settling on one would simplify the frontend, persistence and the agent toolkit (item 1).
- **`contract_version`**: the engine's envelope says `v1` while the screener's output says `v1.3`. Settle on one version and bump
  it as the contract changes.
- **Heston in the screener**: `model_vol=heston` needs its parameters given explicitly. It could calibrate on the same chain
  first.
- **Screener and validation**: the screener skips the validation pre-check. A check on the chain data could cover quote spread,
  stale marks, and IV out of range.
- **Python dependencies**: `server/requirements.txt` is unpinned and has no test dependencies. Add pinned versions and a
  development set with `pytest`.
