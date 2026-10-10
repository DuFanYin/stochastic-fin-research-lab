# Quant Lab: roadmap

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
| Agent toolkit | every computation a documented tool in one registry; offered over HTTP (`/api/tools`), MCP (stdio and `/mcp`), a Python API, a CLI and `llms.txt`; a pip-installable package that builds the engine; agent evals |
| One envelope, contract 2.0 | every tool answers in one shape with `warnings`; one contract version shared by the engine and the server, checked when the engine loads |
| Screener data checks | chain quality (two-sided quotes, spreads, stale marks, missing IVs) with warnings; Heston calibrated to the chain when no parameters are given |
| Housekeeping | pinned dependencies and a test set; market-data HTTP clients made per event loop; the documents gathered in `doc/` |

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
- Every tool's envelope is built in one place, `run_tool` in `server/quantlab/tools/base.py`, and already carries a `run_id`.
  Writing the row there records every tool, whichever interface called it.
- A `get_run` tool, so an agent can cite a result by its `run_id` and others can look it up.
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

### 2. Agent toolkit: the rest

- **Publish the package.** Today it installs from GitHub and builds the engine on the spot. Wheels that need no compiler
  (manylinux, built with cibuildwheel and auditwheel, which also bundles OpenMP's runtime) would let `pip install quantlab`
  work anywhere. The name has to be checked on PyPI first.
- **List the public MCP server** in the MCP registries, so agents can find it.
- **Run the evals regularly.** They need an API key, so they cannot run in the public CI as they are. Record the pass rate per
  model, and add a task whenever an agent gets something wrong in practice.

### 3. Slow Treasury curve

The Treasury yield-curve XML takes about 18 s per request (measured again on 2026-10-09), so the first `/api/market/btc` after
startup is slow. The curve is cached for an hour after that.

Options:
- fetch it in the background at startup;
- switch to a faster Treasury endpoint;
- serve the fallback curve until the real one arrives.

### 4. Hedging for portfolios

The hedging engine handles one option. In portfolio stress (a request with `legs`), the hedge comparison is skipped and the
binomial column is left out. Extending delta hedging to a set of legs would give the screener → Risk flow the full stress output.

### 5. Smaller items

- **Scenario sweep for puts.** The engine's sweep prices a European call whatever the request says. The tool warns about it
  today; it should price the option asked for.
- **Unused code.** `server/quantlab/services/validation_gate.py` repeats the engine's thresholds and nothing calls it.
