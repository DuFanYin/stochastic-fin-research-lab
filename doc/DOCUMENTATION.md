# Quant Lab: documentation

How Quant Lab is built and what each part does, as of the current `main`. Setup and a tour are in [README.md](../README.md)
([中文](../README.zh-CN.md)); connecting an agent is in [AGENT_TOOLKIT.md](AGENT_TOOLKIT.md); what is still to be built is in
[ROADMAP.md](ROADMAP.md).

1. [Architecture](#1-architecture)
2. [C++ engine](#2-c-engine)
3. [Capabilities](#3-capabilities)
4. [Market data](#4-market-data)
5. [HTTP API](#5-http-api)
6. [Workbench](#6-workbench)
7. [Agent toolkit](#7-agent-toolkit)
8. [The public lab](#8-the-public-lab)
9. [Contracts and versioning](#9-contracts-and-versioning)
10. [Testing and verification](#10-testing-and-verification)
11. [Where the code came from](#11-where-the-code-came-from)
12. [Course coverage](#12-course-coverage)

---

## 1. Architecture

Three layers, and the split between them is permanent:

- **C++ engine**: all numerical computation, including the screener's filtering, enumeration and ranking. No I/O, no business logic.
- **Python package `quantlab`** (`server/quantlab/`): fetches market data, validates requests, runs the engine, annotates and
  aggregates results. Nothing numerical. Its tools are offered over HTTP (FastAPI), MCP, a Python API and a CLI (§7).
- **Browser** (one page: Preact and Tailwind, built by Vite): rendering, parameter management and workflow orchestration. No
  numerics.

Every feature travels the same path from the bottom of the stack to the top:

```
kernel/*.cpp            numerical primitive
  → engine/*_engine.cpp   domain workflow
    → contracts.h           result struct
      → c_api.cpp + parser.cpp  C ABI symbol, JSON in / JSON out
        → engine_client.py        Python wrapper (ctypes)
          → tools/*.py              the tool: a handler and its registry entry (name, description, path)
            → request_models.py       its input: a Pydantic model, every field described
              → web/src/modes/*.jsx      the page
```

The registry entry is all a new tool needs to appear on every interface: its HTTP route, `/api/tools`, MCP, the Python API,
the CLI and `llms.txt`.

A change that touches only the bottom of this chain is a frontend patch; one that starts at the top is a full-stack change.

Everything runs locally from `./run.sh` (or `pip install` and `quantlab serve`): no cloud service, no database, no
authentication. Market data comes from public endpoints that need no API key. A public copy runs at
[dufanyin.dev/lab](https://dufanyin.dev/lab/) (§8).

```
server/
  main.py                 the app run.sh and the services start (quantlab.http)
  quantlab/
    __init__.py           the Python API: quantlab.<tool>(...), call, acall, list_tools, describe
    version.py            the package version and CONTRACT_VERSION
    tools/                the registry: base.py (Tool, Result, the envelope), one module per area, __init__.py (TOOLS, call)
    http.py, api/         the FastAPI app: a route per tool, /api/tools, /mcp, /llms.txt, the page's data endpoints, the page
    mcp.py, cli.py, llms.py   MCP (stdio and HTTP), the command line, llms.txt
    schemas/              request models
    services/             engine client, market data, stress library, Explainable QA, analytics
    fixtures/             recorded Deribit chains, the offline fallback, and the script that records them
```

## 2. C++ engine

C++23, built with CMake into a static library `libsf_engine.a` and a shared library `libsf_engine_c.so` that the server loads with
`ctypes`.

| Directory | Contents |
|---|---|
| `engine/src/kernel/numerics`, `simulation` | utilities, path generation, Sobol sequences |
| `engine/src/kernel/pricing` | Black-Scholes, Monte Carlo, binomial and trinomial lattices, finite differences, LSM, Greeks, hedging, implied vol, Heston |
| `engine/src/kernel/optimizer`, `stats` | Nelder-Mead, moments and stochastic-calculus checks |
| `engine/src/kernel/screener` | option filter, strategy generators, ranking |
| `engine/src/engine` | one workflow file per domain: pricing, scenario, hedging, validation, calibration, screener, utility |
| `engine/src/contracts/contracts.h` | every result struct the engine returns |
| `engine/src/api` | `parser.cpp` (JSON parse, dispatch, serialise) and `c_api.cpp` (the exported C ABI) |

**C ABI.** Each `sf_run_*_json` symbol takes a JSON request and writes a JSON response into a caller-owned buffer:
`pricing`, `pricing_batch`, `pricing_batch_grid`, `multi_leg`, `scenario`, `hedging`, `greek_surface`, `pde`, `stats`, `ito`,
`simulation`, `measure_density`, `measure_compare`, `validation`, `vol_surface`, `implied_vol`, `implied_vol_batch`,
`heston_price`, `heston_calibrate`, `screener`. `sf_set_num_threads` / `sf_get_max_threads` control the OpenMP team, and
`sf_contract_version` returns `kContractVersion` (§9). When the
buffer is too small the engine reports the size it needs, and `engine_client.py` retries with that size plus headroom, up to three
times.

**Build.** `engine/CMakeLists.txt` lists every source file by hand (no glob), so a new `.cpp` has to be added to the `sf_engine`
list. `sf_engine` is compiled position-independent because it is linked into the shared library. OpenMP and nlohmann/json are
required. Sobol direction numbers are a 21 × 32 table compiled into the binary; Heston uses `std::complex<double>`; nothing
needs runtime I/O.

**Determinism.** Parallel results do not depend on the thread count. LSM splits paths into fixed 1024-path chunks, each with its
own RNG stream and partial sums, combined in chunk order. The screener keeps a bounded top-N and breaks ties by a sequence
number. The benchmark in [`bench/concurrency/`](../bench/concurrency/README.md) checks bit-identical prices across
executors and thread counts, and explains why the engine parallelises with OpenMP rather than a thread pool.

## 3. Capabilities

### Pricing

A single-price request returns the Black-Scholes, Monte Carlo, binomial and trinomial prices side by side, all five
Black-Scholes Greeks (delta, gamma, theta, vega, rho), the MC−BS and binomial−BS errors, and a 95% confidence interval on the
Monte Carlo price. Finite differences have their own route; LSM runs for American options.

- **Black-Scholes** closed form: call or put, dividend yield, FX mode (Garman-Kohlhagen), digital call.
- **Monte Carlo**: GBM terminal sampling, up to 20M paths, three samplers: pseudorandom (mt19937), antithetic (z and −z per pair),
  and Sobol (Joe-Kuo direction numbers, Beasley-Springer-Moro normal quantile).
- **Binomial** (CRR) and **trinomial** (Boyle) lattices: European and American, with dividend yield.
- **Finite differences**: explicit, fully implicit or Crank-Nicolson on a uniform S-grid with a Thomas solver; American exercise by
  PSOR. When an explicit scheme breaks its stability condition, the time step is refined automatically and the refinement is
  reported.
- **Longstaff-Schwartz** (LSM) American Monte Carlo: basis {1, S/K, (S/K)²}, fixed seed.

For American options the result also carries `american_methods`: binomial, trinomial, CN + PSOR and LSM ± standard error, plus
the early-exercise premium. The `american` field keeps the binomial value. Put-call parity holds to machine precision.

**Batch**: up to 500 jobs in one call, with per-method summary statistics (mean, min, max, standard deviation, p50/p95 spread,
spread CV). **Grid**: the server builds a symmetric spot × vol shock grid around one base request.

### Multi-leg strategies

Any number of legs (call or put, any strike, signed quantity). Each leg may carry its own `vol`, `maturity` and `forward`; a leg with
a forward is priced with Black-76. The legs editor also accepts `{spot, rate, legs}` to override the global spot and rate. The
strategy type is detected: straddle, strangle, bull call spread, bear put spread, butterfly, condor, iron condor, reverse iron
condor, calendar, or custom. The result has per-leg prices and net Greeks.

### Calibration

- **Implied volatility** by Brent's method, bracketed in [1e-4, 5.0], error below 4e-10; a batch variant runs in parallel.
- **Heston** price from the characteristic function (Heston 1993 with the AMST branch-cut-stable form), Gil-Pelaez inversion,
  Simpson quadrature with M = 512 on [1e-5, 100]. It reduces to Black-Scholes within 1e-4 in the flat-vol limit.
- **Heston calibration**: bounded five-parameter Nelder-Mead minimising RMSE against market prices (RMSE 0.0001 on a flat
  Black-Scholes smile). The fit is graded by the RMSE as a share of the average quote (`rmse_rel`): good under 2%, fair under 5%,
  so the grade reads the same for a 10-dollar equity option and a 6,000-dollar BTC option.
  A parameter that ends at a bound of the calibration comes with a warning: a good fit does not mean the quotes pinned it
  down (short-dated BTC smiles often leave κ, ξ or ρ loose).

### Greek surfaces

Any of the five Greeks over a configurable spot × maturity grid, computed in parallel and drawn as a heatmap.

### Scenarios and stress

- **Scenario sweep**: base, ±10% spot, +5% vol, +1% rate, with tornado-chart data.
- **Stress library**: four packs (Core 4, Vol First, Rates First, Crash Kit) of three or four scenarios each, at three severities
  (mild 0.7×, moderate 1.0×, severe 1.5×). Each scenario re-prices with Black-Scholes, Monte Carlo and binomial, optionally runs the hedge comparison, and
  splits P&L into spot, vol and rate. A cross-scenario summary gives a robustness score, the key driver (variance decomposition
  of the attribution), the worst scenario, how many scenarios breach 5% of spot, hedge resilience and a severity ranking. Packs are
  defined in `server/quantlab/services/stress_packs.json`; the frontend reads them from `GET /api/tool/stress/packs`, so a new pack needs
  no frontend change.
- **Portfolio stress**: when the request carries `legs`, every scenario re-prices the whole position. Spot shocks also move each
  leg's forward, and vol shocks apply to each leg's own vol.

### Delta hedging

Four strategies on shared paths, so the comparison is fair: discrete delta, discrete delta with transaction costs, threshold
rebalancing, and hedging with a mismatched vol. Each returns the P&L distribution (mean, std, q05/q50/q95, VaR95, ES95), turnover,
transaction cost and a 40-bin histogram; the best strategy is chosen by ES95. The frontend adds the efficiency frontier: every
strategy in (transaction cost, ES95) space, the Pareto-optimal ones highlighted.

### Numerics

- **Convergence**: binomial and trinomial step ladders against Black-Scholes, with the log-slope of the error (≈ −1 for O(1/n)),
  monotonicity breaks and improvement ratio.
- **Benchmark**: Monte Carlo, Black-Scholes, binomial, trinomial and PDE in one run, ranked by accuracy against a chosen
  baseline, by runtime, and by efficiency (1 / (runtime × error)), with stability labels.
- **PDE**: call or put, European or American, explicit / implicit / Crank-Nicolson. The reference price is Black-Scholes, or a
  1000-step binomial for American options.

### Stochastic calculus checks

- Normal distribution: the sample MGF, mean and variance of `sample_size` seeded draws, returned with the exact values they
  estimate (`mgf_exact`, `mean_exact`, `variance_exact`).
- Itô's formula: the exponential martingale, W² − t, and W³. E[f(W_t)] by Monte Carlo (200k exact draws of W_t) against
  theory, and the formula itself on discrete paths: f(W_t) − f(0) against Σ f′ΔW + Σ (∂ₜf + ½f″)Δt, a gap that shrinks like √Δt.
- Path simulation: GBM and Vasicek, up to 500k steps.
- Change of measure: Radon-Nikodym density path and market price of risk θ = (μ − r)/σ; P vs Q comparison over many paths
  (terminal statistics, drift and variance ratios).

### IV surface and diagnostics

Built from the same Deribit option-chain data as the screener. The engine interpolates bilinearly in (log-moneyness, √T), with
nearest-neighbour fallback, and returns the ATM term structure, per-expiry smiles and a spot × maturity heatmap (up to 21 × 11).
Burst and suppressed zones are found by quantile thresholds the user sets (default 10th / 90th percentile). Skew slope (linear
regression), curvature (finite difference) and a confidence score (0–1, from surface density) come with it.
`POST /api/market/resolve` turns a target strike and maturity into a vol from the surface and a rate interpolated from the
Treasury curve.

### Validation gate

A quality gate that can run before any computation. The checks are grouped by capability:

| Capability | Checks |
|---|---|
| Stats | sample mean and variance against the analytical values |
| Itô | E[f(W_t)] against theory; Itô's formula on paths of `ito_n` steps (relative RMS gap ≤ 0.05) |
| Simulation | terminal values finite; delta-hedge P&L spread relative to spot |
| Lattice | trinomial vs Black-Scholes; LSM and CN + PSOR vs binomial American |

The gate returns go / warn / block, failure counts per capability and the worst violation. Every failure has its threshold,
actual value and a suggested fix. **Explainable QA** ranks eight fix templates (more paths, a larger stats sample, more Itô steps, a
smaller Itô θ, smaller dt, more rebalances, longer convergence ladder, finer PDE grid) by expected gain / cost, picks the smallest set that covers every failure,
and projects the gate outcome after applying it.

### Screener

Deribit BTC or ETH option chain → filter → enumerate combinations → strategy-level filter → rank. Results can be sent to Multi-Leg
pricing or to Risk with one click.

- **Strategies**: single OTM calls, iron condors (SHORT direction gives the reverse iron condor), straddles, strangles, and
  same-strike calendars ranked by forward vol.
- **Enumeration**: legs are stored as option indices; iron condors are generated in parallel per (expiry, short call); strategy
  filters apply as combinations are generated and only a bounded top-N is kept.
- **Pricing**: OTM is judged against each expiry's forward; Greeks are computed with Black-76; cost uses executable prices (buy at
  the ask, sell at the bid), or the mid with `price_mode=mid`. The contract multiplier is configurable (default 1).
- **Model value and edge**: `model_vol` is `mark`, `dvol`, `flat`, `surface`, `heston` or `none`; it sets the model value of each
  strategy and `edge = model value − cost`. `dvol` is fetched by the tool and passed in as `flat`; `surface` builds a sparse ATM
  surface from the same chain; `heston` uses the parameters given, or calibrates them to the chain first: the calls nearest the
  money on up to four expiries between a week and a year, priced from their own implied vols, fitted by Nelder-Mead
  (`heston_calibrated` in the summary: the parameters, the quotes used, the RMSE as a share of the average quote), with a
  warning when a parameter ends at a bound.
- **Chain quality**: every screen and chain carries `chain_quality` (share of two-sided quotes, median spread, marks outside
  their own quotes, crossed quotes, share without an implied vol) and a warning for each that fails: fewer than half quoted on
  both sides, a median spread over 10% of the mid, over 5% of marks outside their quotes, any crossed quote, over 20% without an
  implied vol. A chain that is not live (a snapshot or the fixture) is a warning too.
- **Speed**: about 2.04M iron condors on a full PLTR chain take about 12 ms; the original implementation took about 8 s
  (measured when the code was ported).

## 4. Market data

| Source | Data | Fallback |
|---|---|---|
| Binance spot | BTC / ETH price | 65,000 / 2,500 USD |
| Deribit DVOL | BTC implied-vol index | 80% |
| Deribit option chain | full BTC / ETH chains: bid, ask, mark, mark IV, forward | latest disk snapshot, then the recorded fixture |
| Binance futures | perpetual funding rate → annualised drift | 0.01% per 8 h |
| US Treasury daily yield curve (XML) | 1M–2Y rates | fixed curve, 4.3–4.7% |

All fetches are asynchronous and concurrent; a failed source degrades to its fallback and the rest continue. The Treasury curve is
cached for an hour. The HTTP clients are made on first use in the running event loop (another loop, such as the CLI's or a
test's, gets its own) and closed when the server stops.

**Option chain.** Two batched requests per currency (`get_instruments` and `get_book_summary_by_currency`).
Normalisation:
- coin prices are converted to USD with each row's underlying price;
- each expiry's forward is the median of its rows, because the batch endpoint is not an atomic snapshot;
- mark IV is divided by 100, and out-of-range values are dropped;
- expiries are kept to the second;
- a side with no quote is `null`.

For the chain, the default rate is Deribit's own `interest_rate`, which keeps Greeks aligned with the exchange's marks (delta within 0.006).
Spot is the Deribit index. Every expiry reports its `implied_carry` as a diagnostic.

**Caching.** Chains are memoised for 60 s and written to `~/.quant-lab/chains/` (override with `QUANT_LAB_HOME`), keeping 20
snapshots per currency. Offline, the server falls back to the newest snapshot, then to the recorded fixture in
`server/quantlab/fixtures/` (shipped with the package). Every response says which source it used, with a warning when it is not
live. `server/.venv/bin/python -m quantlab.fixtures.record_deribit` (from `server/`) re-records the fixtures.

## 5. HTTP API

Interactive documentation is served at `/docs` (not on the public lab). Every tool returns one envelope (§9): its numbers in
`result_summary` and `result_details`, what makes them less trustworthy in `warnings`, and `diagnostics`, `input_params`,
`run_id`, `created_at`, `tool`, `status` and `contract_version`. A request a tool cannot answer gets an HTTP error whose `detail`
says what to change; invalid arguments get 422 with one entry per field.

Every tool has its own route, and two routes cover them all:
- `GET /api/tools` lists every tool, with its description, cost class, route and input schema;
- `POST /api/tools/{name}` runs one, with the arguments as a JSON object.

| Route | Tool | Purpose |
|---|---|---|
| `POST /api/tool/pricing/run` | `price_option` | single pricing, all methods and Greeks |
| `POST /api/tool/pricing/batch` | `price_batch` | up to 500 jobs with per-method statistics |
| `POST /api/tool/pricing/batch/grid` | `price_grid` | server-generated spot × vol grid |
| `POST /api/tool/scenario/run` | `scenario_sweep` | five-scenario sweep (a European call, Black-Scholes) |
| `POST /api/tool/pde/run` | `pde_price` | finite-difference pricing |
| `POST /api/tool/convergence/run` | `lattice_convergence` | binomial and trinomial convergence |
| `POST /api/tool/benchmark/run` | `benchmark_methods` | cross-method benchmark |
| `POST /api/tool/pricing/multi-leg` | `price_strategy` | multi-leg pricing, per-leg breakdown, net Greeks |
| `POST /api/tool/greek/surface` | `greek_surface` | Greek over a spot × maturity grid |
| `POST /api/tool/calibration/iv` | `implied_vol` | implied vol |
| `POST /api/tool/calibration/iv/batch` | `implied_vol_batch` | batch implied vol |
| `POST /api/tool/calibration/heston/price` | `heston_price` | Heston price |
| `POST /api/tool/calibration/heston` | `calibrate_heston` | Heston calibration, graded by the RMSE relative to the quotes |
| `GET  /api/tool/stress/packs` | `stress_packs` | stress pack metadata |
| `POST /api/tool/stress/run` | `stress_test` | stress library, single option or portfolio |
| `POST /api/tool/hedging/run` | `compare_hedges` | four-strategy hedge comparison |
| `GET  /api/market/btc` | `market_snapshot` | full BTC snapshot: spot, DVOL, funding, rates, IV surface |
| `GET  /api/tool/screener/chain` | `option_chain` | normalised chain, by currency, maximum days and snapshot, with its quality |
| `GET  /api/tool/screener/snapshots` | `chain_snapshots` | cached chain snapshots |
| `POST /api/tool/screener/run` | `screen_strategies` | screener on a live chain (`currency`) or a snapshot (`snapshot_id`) |
| `POST /api/tool/stats/run` | `normal_moments` | normal-distribution checks |
| `POST /api/tool/ito/run` | `ito_check` | Itô checks |
| `POST /api/tool/simulation/run` | `simulate_path` | GBM or Vasicek paths |
| `POST /api/tool/measure/run` | `measure_density` | Radon-Nikodym density path |
| `POST /api/tool/measure/compare` | `measure_compare` | P vs Q comparison |
| `POST /api/tool/validation/gate` | `validate` | validation gate with Explainable QA |

The page also uses data endpoints of its own, which return plain JSON rather than the envelope:

| Route | Purpose |
|---|---|
| `GET  /api/market/spot`, `/dvol`, `/funding`, `/rates` | one source each |
| `GET  /api/market/surface` | IV surface from the option chain |
| `POST /api/market/iv/diagnostics` | heatmap, burst zones, skew, curvature |
| `POST /api/market/resolve` | strike and maturity → vol and rate |

Then there are:
- `POST /api/v1/task/run`, any engine task by `task_type`, answered with the engine's own response;
- `GET /api/health`, which reports the version, the contract version and whether the engine loaded;
- `/mcp` (§7);
- `/llms.txt`.

## 6. Workbench

The workbench is one page, built from `web/` into `static/` (served at `/`; `/workbench.html` redirects there). Preact for the
components, `@preact/signals` for state, Tailwind for the styles, Vite to build; no chart library. Every URL is relative, so it
runs under any path prefix (the public copy is at `/lab/`).

```
web/
  index.html              the page's head: title, description, canonical URL, link-preview tags, structured data; a static
                          introduction that crawlers read and the app replaces when it starts
  public/                 favicon.svg; og.png, the link-preview image (1200 × 630)
  src/
    main.jsx, app.jsx     entry; the shell: top bar, mode tabs, inputs, results, the Run button
    styles.css            Tailwind and the colour tokens (light, and dark with the system): change a colour here, once
    lib/                  api.js (requests; the public budget), store.js (every parameter, saved in localStorage; settings;
                          results), payloads.js (request bodies), live.js (market data), runner.js (run states), format.js
    ui/                   controls bound to the store (Num, Seg, Toggle, Chips, ...), result blocks (Card, Kv, Table, Slot),
                          dialog.jsx (windows), toasts
    charts/               SVG charts sized to their box and coloured by the theme: line, bars, histogram, heatmap, frontier
    modes/                one file per mode: its description (about), inputs (Params), run, result cards (Results);
                          legs.jsx (the legs editor); index.js lists them in tab order
```

`cd web && npm ci && npm run build` rebuilds `static/` (commit it with the source); `npm run dev` serves the page with hot
reload and sends `/api` to a server on port 8010 (`PORT=8010 ./run.sh`).

**Layout.** The top bar has the name, Live / Sim, the live market (BTC, DVOL, r, μ, the time of the last fetch, refresh), the
number of decimals shown, and the link to the source on GitHub. Under it are the mode tabs. On the left are the inputs of the
current mode; on the right its results, as cards in one to three columns by width. Before the first run the results show what
the mode does.

**Run.** The page has one Run button: at the top right of the results on a wide screen, under the inputs on a narrow one; ⌘↵ or
Ctrl+Enter does the same. On the public lab the results header also shows how much computing time is left (§8). A card shows
the warnings of its result under it.

**Windows.** Inputs too big for the sidebar open in a window from their summary:
- the legs of a position (Multi-Leg, Risk's portfolio), as a table with starting strategies (straddle, strangle, bull call
  spread, iron condor around the strike) or as JSON;
- the Screener's strategy filter.

**Live / Sim.** In Live mode spot, vol, rate and drift come from the market endpoints and are read-only. Changing the strike or
maturity resolves vol and rate from the surface. In Sim mode every input is editable.

| Mode | What it runs |
|---|---|
| Pricing | Single: pricing, implied vol, Heston calibration, IV diagnostics, scenario sweep, five Greek surfaces. Batch: the spot × vol grid. |
| Multi-Leg | multi-leg pricing from the legs editor |
| Risk | stress library and the hedge comparison |
| Numerics | PDE, convergence, benchmark, and P vs Q or RN density |
| Screener | Strategies view (funnel counts, top-N table, per-row legs, payoff at expiry, break-evens) and Chain view (expiries with implied carry, OTM smile, chain table) |
| Validation | the validation gate on its own: each check against its threshold, and what to change when one fails |

Any mode except Screener can run the validation gate first ("Validate first"), as advice or as a block ("Block on fail"); its
report is the first card of the results. A Screener row goes to Multi-Leg or Risk in one click (the tab switches and runs).

**Charts.**
- Lines, with a hover readout: term structure, smile, convergence, paths, payoff.
- Bars: the tornado, rankings, and each check's value as a share of its threshold.
- The P&L histogram, with quantile marks.
- Heatmaps: the IV and Greek surfaces.
- The hedge efficiency frontier.

Every input persists in `localStorage` ("Reset inputs" restores the defaults).

**Search and link previews.** `index.html` carries:
- a title and description;
- a canonical URL pointing at the public copy;
- Open Graph and Twitter tags, with `og.png` as the preview image;
- schema.org `WebApplication` data.

Its static introduction gives crawlers the same text a visitor reads; `main.jsx` clears it before the app renders.

## 7. Agent toolkit

The lab can be used by an agent as well as by a person. [AGENT_TOOLKIT.md](AGENT_TOOLKIT.md) explains how to connect one;
this section explains how it is built.

### One list of tools

Every computation is declared once, as a tool, in `server/quantlab/tools/`. A tool has:
- a name, such as `price_option`, and a title;
- a description written for a model: what it computes, when to use it, and what comes back;
- an input model, in which every field says what it means, its unit and its range;
- the function that computes it, and its HTTP route;
- an example call.

There are 26 tools. Everything an agent can reach is generated from this one list, so a new tool appears everywhere at once
and the interfaces never disagree.

### Five ways in

- **HTTP.** Each tool keeps a route of its own (for example `POST /api/tool/pricing/run`). `GET /api/tools` lists all of them
  with their schemas, and `POST /api/tools/{name}` runs any of them by name.
- **MCP.** `quantlab/mcp.py` uses the official MCP SDK.
  - Over HTTP it answers at `/mcp`. It runs stateless, with plain JSON replies, so every request stands on its own and works
    through any proxy.
  - Locally, `quantlab mcp` serves the same tools on stdin and stdout.
  - A bad call comes back as an error result with the reason, so the agent can correct itself.
  - Lists longer than 40 items are cut, with a note, to keep results within an agent's context.
- **Python.** `import quantlab`, then `quantlab.price_option(spot=100, ...)`. Each tool is a function with a real signature, and
  its description is the docstring.
- **Command line.** `quantlab list`, `quantlab describe <tool>`, and `quantlab <tool> --spot 100 ...`. Values are read as JSON
  when they can be, so lists and objects work. `--input` takes a JSON file, or `-` for stdin.
- **llms.txt.** `/llms.txt` describes the lab, its units and every tool, with an example of each, for models that read the web.

### The package

`pip install .`, or a `pip install` from GitHub, builds the C++ engine with CMake (through scikit-build-core). It then installs
the engine, the Python package and the built page together. Afterwards the `quantlab` and `quantlab-mcp` commands are
available, and `quantlab serve` runs the whole lab, page included.

The package looks for the engine in this order:
1. wherever `$QUANTLAB_ENGINE` points;
2. next to the package;
3. in the repository's `engine/build/`.

Dependencies are written down twice, on purpose:
- `pyproject.toml` gives the versions the package works with;
- `server/requirements.txt` pins the exact versions the lab runs with.

### Evaluation

`evals/tasks.py` is a set of questions an agent should be able to answer with the tools, each with an answer that can be
checked:
- a Black-Scholes price;
- an implied vol;
- an early-exercise premium;
- the fix the validation gate suggests;
- a Heston price;
- the best BTC strangle on the live chain.

The right answer is worked out with the tools themselves when the answer is checked.

`evals/run.py` gives the questions to Claude, lets it call the tools, and checks what it says. It needs an
`ANTHROPIC_API_KEY`. When a question fails, the fix belongs in the tool's description or error message.
`tests/test_evals.py` keeps the questions and the runner working without a key.

## 8. The public lab

[dufanyin.dev/lab](https://dufanyin.dev/lab/) runs this repository for anyone. A proxy in front of it (not in this repository)
keeps one visitor from crowding out the others. Per address (an IPv6 address by its /64) it allows:

| Limit | Value |
|---|---|
| Computing time | a budget of 120 s, refilled over 10 minutes. A computation may start while some is left and is charged the seconds it took (at least 0.05 s). A Pricing run takes about 3 s; the other modes take well under 1 s. |
| API calls | 600 per 10 minutes |
| At once | 2 computations per address and 3 in all; the rest wait their turn, up to 60 s |
| Request body | 256 KB |
| Heavy parameters | paths 200,000 (LSM 50,000); steps 20,000 (Itô and measure 200,000); samples 1,000,000; rebalances and optimiser iterations 1,000; batches 50 jobs; 60 s per request |

The same limits hold for the API and for MCP at `https://dufanyin.dev/lab/mcp`; the parameter caps apply inside an MCP call's
arguments too. The `x-lab-budget` response header carries the seconds left, which the page shows. A refusal (429) says when to
come back (`Retry-After`). The public copy runs on four cores and 2 GB. Run the lab yourself for no limits.

## 9. Contracts and versioning

Every tool answers in the same shape, the envelope:

| Field | What it holds |
|---|---|
| `result_summary` | the headline numbers |
| `result_details` | tables, curves and grids |
| `warnings` | anything that makes the numbers less trustworthy |
| `diagnostics` | how long it took, the engine's threads, and notes on how it was computed |
| `input_params` | the arguments as the tool understood them, defaults included |
| `run_id`, `created_at`, `tool`, `status`, `contract_version` | which run this was |

Numbers keep 12 significant digits; a value that is not finite becomes `null`.

The shape has a version, now `2.0`. It is written in two places that must agree: `kContractVersion` in
`engine/src/contracts/contracts.h` and `CONTRACT_VERSION` in `server/quantlab/version.py`. The engine reports its version
through `sf_contract_version`. If the server finds an engine built for another version, it does not use it: `/api/health` and
every tool say the engine needs rebuilding. Bump both when a response changes shape.

Rules that keep old callers working:
- a new field always has a default, so a caller that ignores unknown fields is unaffected;
- tools and routes are only added; an existing one gains fields but never changes its shape;
- a new engine function has to be registered in `_TASK_TO_SYMBOL` (`server/quantlab/services/engine_client.py`) before a tool
  can call it.

## 10. Testing and verification

| Test | Checks | Count |
|---|---|---:|
| `tests/test_pricing_methods.py` | trinomial, LSM, explicit and American PDE, puts, dividend handling | 11 |
| `tests/test_theory_checks.py` | sample moments converge; Itô's expectation holds and its formula residual shrinks like √Δt; the default gate passes and a coarse one names the right fix | 4 |
| `tests/test_screener.py` | filters, generators, ranking, bounded top-N, the fixed defects of the original screener | 21 |
| `tests/test_screener_api.py` | screener routes, offline fallback, snapshots, Multi-Leg hand-off, portfolio stress | 10 |
| `tests/test_market_chain.py` | chain normalisation, caching, fallbacks (offline; `QUANT_LAB_LIVE=1` adds a live delta comparison) | 12 |
| `tests/test_agent_toolkit.py` | every tool documented (every field described) and its example runs offline in the envelope; errors; the engine's contract; the Python API; HTTP (`/api/tools`, a route per tool, `/llms.txt`); MCP in-process and over stateless HTTP; list cutting; the CLI | 10 |
| `tests/test_evals.py` | the agent tasks' truths and checks, and the runner's tool loop against a scripted model | 3 |
| `tests/reference/test_qf205_reference.py` | lattices and finite differences against the QF-205 Python package | 3 |

`server/.venv/bin/pip install -r server/requirements-dev.txt`, then `server/.venv/bin/python -m pytest tests`, runs them
all (71 offline). The reference test needs QF-205 and numpy. It looks for QF-205 at
`../QF-205/src`, or wherever `QF205_SRC` points, and is skipped when it cannot be imported.

Results recorded when these methods were added:

- Against QF-205: binomial and trinomial agree to 2e-13. Finite differences agree to 1e-14 once QF-205's boundary
  time-to-expiry is corrected. American PSOR differs by at most 6e-4, which comes from a QF-205 bug that counts the boundary term
  twice: for a non-dividend American call, which must equal the European call, the C++ engine is off by 3.5e-10 and QF-205 by 2.9e-4.
- Trinomial convergence order −1.00. LSM (100k paths) within 1% of a 2000-step binomial. American PDE within 0.5% of binomial.
  Explicit vs Crank-Nicolson within 5e-4.
- The ported screener matched the original binary row for row on five filter configurations over a PLTR chain, apart from the
  defects deliberately fixed (iron condor max gain / loss). That one-off check is no longer in the tree.
- Every mode, the windows and the hand-offs were exercised in a real browser (Playwright), light and dark, desktop and phone
  widths, through the public lab's CSP, with no JavaScript errors.
- The wheel was built and installed into a fresh virtual environment. There the CLI, the Python API and MCP over stdio (the
  SDK's client starting `quantlab-mcp`) all ran tools.

## 11. Where the code came from

Quant Lab absorbed three earlier projects. Ported files name their source commit in the header.

| Source | Taken | Now in |
|---|---|---|
| option-screener (C++) | option, filter, generator, strategy, factory; forward-vol scan rewritten as a tradable calendar | `kernel/screener/`, `engine/screener_engine.cpp` |
| QF-205 (Python) | Boyle trinomial; explicit / implicit / Crank-Nicolson with PSOR, with three fixes | `kernel/pricing/trinomial_lattice.cpp`, `kernel/pricing/pde.cpp` |
| Option-Pricing (C++) | Longstaff-Schwartz; rolling-storage idea for the trinomial lattice | `kernel/pricing/lsm_american.cpp`, `lsm_impl.h` |
| Option-Pricing (C++) | SPSC queue, ring buffer, thread pool, all corrected | `bench/concurrency/` |

Not taken:
- the Tradier chain loader: Deribit replaced it;
- the Python screener;
- QF-205's GUI and CLI;
- Option-Pricing's own explicit / implicit solvers and binomial tree: the engine already covered them.

Defects fixed during the port:

- **Original screener**:
  - filters rewrote shared data;
  - an empty direction threw;
  - iron condor max gain / loss used gross premium and only the call wing;
  - a sold single leg had negative max loss;
  - iron condors ignored direction.
- **Pricing stack**:
  - puts selected in the frontend were priced as calls;
  - American binomial and the PDE supported calls only;
  - with q ≠ 0 the European price carried an extra e^{qT} and the Greeks subtracted q twice;
  - `pricing_bundle` ignored `steps`;
  - a late Live response could overwrite Sim inputs.

## 12. Course coverage

Quant Lab started as an executable companion to a nine-session risk-neutral pricing course; each topic has a live, parameterised
compute path.

| Session | Topic | Capability |
|---|---|---|
| 1–2 | Probability and statistics | `stats/run`: MGF, moment checks |
| 3 | Discrete processes, binomial trees | binomial pricing, `convergence/run` |
| 4 | Brownian motion | `simulation/run` |
| 5 | Itô calculus | `ito/run`, validation expectation gap and formula residual |
| 6 | SDE numerics | GBM and Vasicek paths, discretisation checks |
| 7 | Girsanov, change of measure | `measure/run`, `measure/compare` |
| 8 | Risk-neutral pricing | multi-method pricing, calibration, benchmark |
| 9 | Dynamic hedging | `hedging/run`, efficiency frontier |
