# Quant Lab — Documentation

How Quant Lab is built and what each part does, as of the current `main`. Setup and a short tour are in
[README.md](README.md); what is still to be built is in [ROADMAP.md](ROADMAP.md).

1. [Architecture](#1-architecture)
2. [C++ engine](#2-c-engine)
3. [Capabilities](#3-capabilities)
4. [Market data](#4-market-data)
5. [HTTP API](#5-http-api)
6. [Workbench](#6-workbench)
7. [Contracts and versioning](#7-contracts-and-versioning)
8. [Testing and verification](#8-testing-and-verification)
9. [Where the code came from](#9-where-the-code-came-from)
10. [Course coverage](#10-course-coverage)

---

## 1. Architecture

Three layers, and the split between them is permanent:

- **C++ engine**: all numerical computation, including the screener's filtering, enumeration and ranking. No I/O, no business logic.
- **Python server** (FastAPI): fetches market data, validates requests, routes them to the engine, annotates and aggregates results. Nothing numerical.
- **Browser** (one page, no framework): rendering, parameter management and workflow orchestration. No logic.

Every feature travels the same path from the bottom of the stack to the top:

```
kernel/*.cpp            numerical primitive
  → engine/*_engine.cpp   domain workflow
    → contracts.h           result struct
      → c_api.cpp + parser.cpp  C ABI symbol, JSON in / JSON out
        → engine_client.py        Python wrapper (ctypes)
          → routes/*.py             FastAPI route
            → request_models.py       Pydantic schema
              → workbench.html + js     frontend
```

A change that touches only the bottom of this chain is a frontend patch; one that starts at the top is a full-stack change.

Everything runs locally from `./run.sh`: no cloud service, no database, no authentication. Market data comes from public endpoints
that need no API key.

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
`heston_price`, `heston_calibrate`, `screener`. `sf_set_num_threads` / `sf_get_max_threads` control the OpenMP team. When the
buffer is too small the engine reports the size it needs, and `engine_client.py` retries with that size plus headroom, up to three
times.

**Build.** `engine/CMakeLists.txt` lists every source file by hand (no glob), so a new `.cpp` has to be added to the `sf_engine`
list. `sf_engine` is compiled position-independent because it is linked into the shared library. OpenMP and nlohmann/json are
required. Sobol direction numbers are a 21 × 32 table compiled into the binary; Heston uses `std::complex<double>`; nothing
needs runtime I/O.

**Determinism.** Parallel results do not depend on the thread count. LSM splits paths into fixed 1024-path chunks, each with its
own RNG stream and partial sums, combined in chunk order. The screener keeps a bounded top-N and breaks ties by a sequence
number. The benchmark in [`bench/concurrency/`](bench/concurrency/README.md) checks bit-identical prices across
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
  Black-Scholes smile).

### Greek surfaces

Any of the five Greeks over a configurable spot × maturity grid, computed in parallel and drawn as a heatmap.

### Scenarios and stress

- **Scenario sweep**: base, ±10% spot, +5% vol, +1% rate, with tornado-chart data.
- **Stress library**: four packs (Core 4, Vol First, Rates First, Crash Kit) of three or four scenarios each, at three severities
  (mild 0.7×, moderate 1.0×, severe 1.5×). Each scenario re-prices with Black-Scholes, Monte Carlo and binomial, optionally runs the hedge comparison, and
  splits P&L into spot, vol and rate. A cross-scenario summary gives a robustness score, the key driver (variance decomposition
  of the attribution), the worst scenario, how many scenarios breach 5% of spot, hedge resilience and a severity ranking. Packs are
  defined in `server/src/services/stress_packs.json`; the frontend reads them from `GET /api/tool/stress/packs`, so a new pack needs
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

- Normal distribution: analytical MGF against sample mean and variance.
- Itô's formula: the exponential martingale, W² − t, and W³, theory against simulation.
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
| Itô | expectation gap between simulation and theory |
| Simulation | terminal values finite; delta-hedge P&L spread relative to spot |
| Lattice | trinomial vs Black-Scholes; LSM and CN + PSOR vs binomial American |

The gate returns go / warn / block, failure counts per capability and the worst violation. Every failure has its threshold,
actual value and a suggested fix. **Explainable QA** ranks six fix templates (more paths, more Itô steps, smaller dt, more
rebalances, longer convergence ladder, finer PDE grid) by expected gain / cost, picks the smallest set that covers every failure,
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
  strategy and `edge = model value − cost`. `dvol` is fetched by the route and passed in as `flat`; `surface` builds a sparse ATM
  surface from the same chain; `heston` needs its parameters given explicitly.
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
cached for an hour.

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
snapshots per currency. Offline, the server falls back to the newest snapshot, then to the recorded fixture in `server/fixtures/`.
Every response says which source it used. `server/fixtures/record_deribit.py` re-records the fixtures.

## 5. HTTP API

Interactive documentation is served at `/docs`. Tool routes return one of two envelopes, both built in
`server/src/api/shared.py`:

- Routes that pass the request straight to the engine (`dispatch_task()`; for example `pricing/run`, `hedging/run`,
  `v1/task/run`) return the engine's task envelope: `contract_version`, `trace_id`, `status`, `decision`, `input_params`,
  `result_summary`, `result_details`, `diagnostics` (compute path, timings) and the validation fields.
- Routes that assemble their result in Python (`_record()`; for example the screener, multi-leg, calibration and Greek
  surfaces) return `run_id`, `tool_name`, `input_params`, `result_summary`, `result_details`, `diagnostics` (engine
  availability, threads, compute time, timestamp, notes) and `created_at`.

| Route | Purpose |
|---|---|
| `POST /api/tool/pricing/run` | single pricing, all methods and Greeks |
| `POST /api/tool/pricing/batch` | up to 500 jobs with per-method statistics |
| `POST /api/tool/pricing/batch/grid` | server-generated spot × vol grid |
| `POST /api/tool/pricing/multi-leg` | multi-leg pricing, per-leg breakdown, net Greeks |
| `POST /api/tool/scenario/run` | five-scenario sweep |
| `POST /api/tool/stress/run` | stress library, single option or portfolio |
| `GET  /api/tool/stress/packs` | stress pack metadata |
| `POST /api/tool/hedging/run` | four-strategy hedge comparison |
| `POST /api/tool/greek/surface` | Greek over a spot × maturity grid |
| `POST /api/tool/calibration/iv` | implied vol |
| `POST /api/tool/calibration/iv/batch` | batch implied vol |
| `POST /api/tool/calibration/heston/price` | Heston price |
| `POST /api/tool/calibration/heston` | Heston calibration |
| `POST /api/tool/pde/run` | finite-difference pricing |
| `POST /api/tool/convergence/run` | binomial and trinomial convergence |
| `POST /api/tool/benchmark/run` | cross-method benchmark |
| `POST /api/tool/stats/run` | normal-distribution checks |
| `POST /api/tool/ito/run` | Itô checks |
| `POST /api/tool/simulation/run` | GBM or Vasicek paths |
| `POST /api/tool/measure/run` | Radon-Nikodym density path |
| `POST /api/tool/measure/compare` | P vs Q comparison |
| `POST /api/tool/validation/gate` | validation gate with Explainable QA |
| `POST /api/tool/screener/run` | screener on a live chain (`currency`) or a snapshot (`snapshot_id`) |
| `GET  /api/tool/screener/chain` | normalised chain, by currency, maximum days and snapshot |
| `GET  /api/tool/screener/snapshots` | cached chain snapshots |
| `GET  /api/market/btc` | full BTC snapshot: spot, DVOL, funding, rates |
| `GET  /api/market/spot`, `/dvol`, `/funding`, `/rates` | one source each |
| `GET  /api/market/surface` | IV surface from the option chain |
| `POST /api/market/iv/diagnostics` | heatmap, burst zones, skew, curvature |
| `POST /api/market/resolve` | strike and maturity → vol and rate |
| `POST /api/v1/task/run` | generic dispatch: any engine task by `task_type` |
| `GET  /api/health` | health check |

## 6. Workbench

`static/workbench.html` is the only page. It has three columns: parameters, mode, and results.

**Live / Sim.** In Live mode spot, vol, rate and drift come from the market endpoints and are read-only. Changing the strike or
maturity resolves vol and rate from the surface. In Sim mode every input is editable.

| Mode | What it runs |
|---|---|
| Pricing | Single: pricing, implied vol, Heston calibration, IV diagnostics, scenario sweep, five Greek surfaces. Batch: the spot × vol grid. |
| Multi-Leg | multi-leg pricing from the legs editor |
| Risk | stress library and the hedge comparison |
| Numerics | PDE, convergence, benchmark, and P vs Q or RN density |
| Validation Only | the validation gate on its own |
| Screener | Strategies view (funnel counts, top-N table, per-row legs, payoff at expiry, break-evens) and Chain view (expiries with implied carry, OTM smile, chain table) |

Any mode except Screener can run the validation gate first ("Pre-check"), as advice or as a block ("Block on Fail"). Charts are
drawn on Canvas / SVG without a chart library: sparklines, line and dual-line charts, tornado, grouped bars, P&L histogram with
quantile lines, IV heatmap with burst zones, term structure, smile, Greek heatmap, threshold-vs-value, efficiency frontier, and
payoff diagrams. Parameters persist in `localStorage`.

## 7. Contracts and versioning

- Every new field in a response struct has a default, so callers that ignore unknown fields keep working.
- New routes are additive; an existing route never changes its response shape, it only gains fields.
- `_TASK_TO_SYMBOL` in `server/src/services/engine_client.py` is the single registry of engine capabilities; a new ABI symbol
  must be registered there before a route can call it.
- `contract_version`: the engine's task envelope reports `v1`; the screener's engine output reports `v1.3` (screener,
  per-leg vol / maturity / forward, trinomial, LSM, explicit and American PDE).

## 8. Testing and verification

| Test | Checks | Count |
|---|---|---:|
| `tests/test_pricing_methods.py` | trinomial, LSM, explicit and American PDE, puts, dividend handling | 11 |
| `tests/test_screener.py` | filters, generators, ranking, bounded top-N, the fixed defects of the original screener | 21 |
| `tests/test_screener_api.py` | screener routes, offline fallback, snapshots, Multi-Leg hand-off, portfolio stress | 10 |
| `tests/test_market_chain.py` | chain normalisation, caching, fallbacks (offline; `QUANT_LAB_LIVE=1` adds a live delta comparison) | 12 |
| `tests/reference/test_qf205_reference.py` | lattices and finite differences against the QF-205 Python package | 3 |

`server/.venv/bin/python -m pytest tests` runs them all. The reference test needs QF-205 and numpy. It looks for QF-205 at
`../QF-205/src`, or wherever `QF205_SRC` points, and is skipped when it cannot be imported.

Results recorded when these methods were added:

- Against QF-205: binomial and trinomial agree to 2e-13. Finite differences agree to 1e-14 once QF-205's boundary
  time-to-expiry is corrected. American PSOR differs by at most 6e-4, which comes from a QF-205 bug that counts the boundary term
  twice: for a non-dividend American call, which must equal the European call, the C++ engine is off by 3.5e-10 and QF-205 by 2.9e-4.
- Trinomial convergence order −1.00. LSM (100k paths) within 1% of a 2000-step binomial. American PDE within 0.5% of binomial.
  Explicit vs Crank-Nicolson within 5e-4.
- The ported screener matched the original binary row for row on five filter configurations over a PLTR chain, apart from the
  defects deliberately fixed (iron condor max gain / loss). That one-off check is no longer in the tree.
- The full screener flow was exercised in a real browser (Playwright) with no JavaScript errors.

## 9. Where the code came from

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

## 10. Course coverage

Quant Lab started as an executable companion to a nine-session risk-neutral pricing course; each topic has a live, parameterised
compute path.

| Session | Topic | Capability |
|---|---|---|
| 1–2 | Probability and statistics | `stats/run`: MGF, moment checks |
| 3 | Discrete processes, binomial trees | binomial pricing, `convergence/run` |
| 4 | Brownian motion | `simulation/run` |
| 5 | Itô calculus | `ito/run`, validation expectation gap |
| 6 | SDE numerics | GBM and Vasicek paths, discretisation checks |
| 7 | Girsanov, change of measure | `measure/run`, `measure/compare` |
| 8 | Risk-neutral pricing | multi-method pricing, calibration, benchmark |
| 9 | Dynamic hedging | `hedging/run`, efficiency frontier |
