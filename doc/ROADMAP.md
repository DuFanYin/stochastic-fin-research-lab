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
| Run history | every computation kept on the server by run id (SQLite); `get_run` (with rerun), `compare_runs`, `list_runs`; the page's history drawer (load, compare) and a run id on every card; a public server neither lists nor deletes runs |
| Treasury curve without the wait | fetched at startup and in the background, kept in memory and on disk, its date reported; a request waits only when there is no curve of the last day |
| Hedging for positions | any legs hedged as a position, each settling at its own expiry; the P&L sign fixed (it was payoff − hedge, so costs looked helpful and ES95 read the wrong tail); paths no longer depend on the thread count; portfolio stress hedges and tree-prices the position |
| Small fixes | the scenario sweep prices puts and discounts dividends (it priced every option as a call, without the exp(−qT)); unknown arguments rejected; the unused Python copy of the gate's thresholds removed |

## Next

### 1. Agent toolkit: the rest

- **Publish the package.** Today it installs from GitHub and builds the engine on the spot. Wheels that need no compiler
  (manylinux, built with cibuildwheel and auditwheel, which also bundles OpenMP's runtime) would let `pip install quantlab`
  work anywhere. The name has to be checked on PyPI first.
- **List the public MCP server** in the MCP registries, so agents can find it.
- **Run the evals regularly.** They need an API key, so they cannot run in the public CI as they are. Record the pass rate per
  model, and add a task whenever an agent gets something wrong in practice.
