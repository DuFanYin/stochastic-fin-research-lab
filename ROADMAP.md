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

## Next

### 1. Persistence: run history

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

### 2. Slow Treasury curve

The Treasury yield-curve XML takes about 18 s per request (measured again on 2026-10-09), so the first `/api/market/btc` after
startup is slow. The curve is cached for an hour after that.

Options:
- fetch it in the background at startup;
- switch to a faster Treasury endpoint;
- serve the fallback curve until the real one arrives.

### 3. HTTP clients and the event loop

`market_data.py` creates its `httpx.AsyncClient` objects at import time, which ties them to the first event loop that uses them.
That is fine under uvicorn, but tests must use `with TestClient(...)`. Creating the clients in the FastAPI lifespan removes the
restriction.

### 4. Hedging for portfolios

The hedging engine handles one option. In portfolio stress (a request with `legs`), the hedge comparison is skipped and the
binomial column is left out. Extending delta hedging to a set of legs would give the screener → Risk flow the full stress output.

### 5. Smaller items

- **One envelope**: routes return either the engine's task envelope or the `_record()` envelope (see DOCUMENTATION.md §5).
  Settling on one would simplify the frontend and persistence.
- **`contract_version`**: the engine's envelope says `v1` while the screener's output says `v1.3`. Settle on one version and bump
  it as the contract changes.
- **Heston in the screener**: `model_vol=heston` needs its parameters given explicitly. It could calibrate on the same chain
  first.
- **Screener and validation**: the screener skips the validation pre-check. A check on the chain data could cover quote spread,
  stale marks, and IV out of range.
- **Python dependencies**: `server/requirements.txt` is unpinned and has no test dependencies. Add pinned versions and a
  development set with `pytest`.
