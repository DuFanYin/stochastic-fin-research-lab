# Quant Lab — As-Is State

---

## What It Is

Quant Lab is a full-stack stochastic finance compute platform built as an executable research workbench. Every major theoretical concept from a nine-session risk-neutral pricing curriculum has a live, parameterized compute path that produces interpretable, validated output.

Three layers: a C++23 numerical engine compiled to a shared library (`libsf_engine_c.dylib`), a FastAPI orchestration server that validates, routes, and annotates results, and a single-page browser workbench that drives the full workflow. The C++ layer does all numerical computation. Python does nothing numerical. The browser is the only interface.

Everything runs locally from a single `./run.sh`. No cloud dependency, no database, no authentication.

---

## Capabilities

### Pricing Engine

Four methods run in parallel on every single-price request:

- **Black-Scholes closed form** — European call or put with dividend yield, FX mode (Garman-Kohlhagen), digital call variant
- **Monte Carlo** — GBM terminal sampling, up to 20M paths, three sampler modes: pseudorandom (mt19937), antithetic variates (half draws, z and −z per pair, ~2× variance reduction), Sobol quasi-random (Joe-Kuo direction numbers, Beasley-Springer-Moro normal quantile, O(1/N) convergence)
- **Binomial CRR lattice** — European and American exercise; call or put
- **PDE finite-difference** — Crank-Nicolson (θ=0.5) or fully implicit (θ=1.0); uniform S-grid; Thomas tridiagonal solver; dividend yield supported

All five BS Greeks (delta, gamma, theta, vega, rho) returned on every pricing result. Error decomposition: MC−BS and Binomial−BS per run. 95% CI on MC price from stderr.

Batch pricing: up to 500 jobs in one call, method-level summary stats (avg/min/max/std, p50/p95 spread, spread CV). Grid mode: server generates a symmetric spot/vol shock grid from one base request automatically.

### Put Options and Multi-Leg Strategies

`european_put` fully supported across BS, MC, and binomial via `is_call` bool threaded through all kernel functions. Put-call parity verified to machine precision.

Multi-leg pricing: arbitrary legs (call or put, any strike, signed quantity). Auto-detects strategy type: straddle, bull call spread, bear put spread, strangle, butterfly, condor, custom. Returns per-leg BS/MC price and net greeks across all legs.

### Model Calibration

**Implied volatility**: Brent's method bracketed root-finder in `implied_vol.cpp`, error < 4e−10 vs true IV, guaranteed convergence in [1e−4, 5.0]. Batch variant parallelized with OpenMP.

**Heston model**: Characteristic function via Heston (1993) original formula with AMST branch-cut-stable parametrization. Gil-Pelaez two-probability inversion (P₁ via `φ(u−i)/exp(rT)`, P₂ via `φ(u)`). Simpson quadrature M=512 on [1e−5, 100]. Reduces to BS price to < 1e−4 error in flat-vol limit.

**Heston calibration**: Nelder-Mead optimizer (5-parameter bounded simplex, α=1, γ=2, ρ=0.5, σ=0.5) minimizes RMSE over market prices. Calibration RMSE on flat BS smile = 0.0001.

Routes: `POST /api/tool/calibration/iv`, `/iv/batch`, `/heston/price`, `/heston`.

### Greek Surfaces

Full 5-greek surface (delta, gamma, theta, vega, rho) computed across a configurable spot × maturity grid via `greek_surface_grid()` with OpenMP. Rendered as Canvas heatmap with colorbar. Route: `POST /api/tool/greek/surface`.

### Scenario and Stress Analysis

**5-scenario sweep**: base, ±10% spot, +5% vol, +1% rate. Tornado chart data.

**Stress library**: 4 packs × 3 severity levels (mild 0.7×, moderate 1.0×, severe 1.5×):
- Core 4: Vol Spike, Rate Jump, Gap Move, Correlation Breakdown
- Vol First: Vol Regime Shift, Vol Crush, Skew Panic Proxy
- Rates First: Front-End Rate Jump, Policy Easing Shock, Rate/Vol Divergence
- Crash Kit: Crash Day, Aftershock, Liquidity Vacuum

Each scenario re-prices with all three methods, optionally runs delta-hedge comparison, computes P&L attribution decomposed into spot/vol/rate components, severity score, portfolio correlation score. Outputs severity ranking, correlation ranking, hedge resilience ranking.

**Cross-scenario aggregation** (computed after all rows): robustness score (1 − mean|impact|/spot), key driver (variance decomposition over attribution components), worst scenario, count of scenarios breaching 5%-of-spot threshold, hedge resilience mean/worst ES95, full scenario ranking by severity.

**Pack metadata API**: `GET /api/tool/stress/packs` returns structured metadata for all packs. Frontend pack selector populated dynamically on load — adding a pack to `stress_packs.json` requires no frontend change.

### Delta Hedging

Four strategies run simultaneously on shared paths (structurally fair comparison):
1. Discrete delta hedge — no cost
2. Discrete delta with transaction costs
3. Threshold-triggered rebalancing
4. Vol mismatch hedge (hedging with wrong vol)

Full PnL distribution per strategy: mean, std, q05/q50/q95, VaR95, ES95, turnover, transaction cost. PnL histogram (40 bins, Canvas). Best strategy selected by ES95.

**Hedge Efficiency Frontier**: scatter chart of all four strategies in (transaction_cost, ES95) space. Pareto-optimal strategies highlighted in color, dominated strategies greyed. Dashed frontier line connects non-dominated points sorted by cost. Rendered as Canvas below the PnL histogram.

### Convergence and Benchmarking

**Convergence**: Binomial step ladder vs BS reference. Computes log-slope of error (expected ≈ −1 for O(1/n)), monotonicity break count, improvement ratio. Full error curve for plotting.

**Benchmark**: MC vs BS vs Binomial vs PDE in one run. Accuracy ranking (absolute and relative error vs configurable baseline), runtime ranking, efficiency score (1/(runtime × error)), stability labels.

### Stochastic Theory Verification

- **Normal distribution**: analytical MGF, sample mean, sample variance
- **Itô formula checks** (3 types): exp_martingale, W²−t, W³ expected values vs simulation
- **Path simulation** (2 models): GBM, Vasicek; up to 500k steps
- **Measure change P→Q**: Radon-Nikodym density path, market price of risk θ = (μ−r)/σ
- **P vs Q comparison**: multi-path simulation under both measures, terminal distribution statistics, drift ratio, variance ratio, dual path preview

### IV Surface and Diagnostics

Live IV surface from Deribit BTC options. Multi-strike per expiry (7 strikes centered at ATM), mark IV fetched concurrently.

C++ bilinear interpolation in (log-moneyness, √T) space with nearest-neighbor fallback. ATM term structure, per-expiry smile slices, S×T grid heatmap (up to 21×11). Adaptive burst zone detection with user-controlled quantile thresholds (`burst_lower_quantile`, `burst_upper_quantile`, default 10th/90th percentile — configurable via range sliders in the IV parameter panel). Local skew slope (linear regression), curvature (finite-difference), confidence score (0–1) based on surface density.

Backend resolve endpoint: (target_strike, target_maturity) → vol via C++ bilinear interpolation + rate via linear interpolation on term structure.

### Validation Gate

Omnibus pre-compute quality gate. Runs any combination of: stats moment checks, measure density quality, measure compare quality, Itô expectation gap, convergence quality, simulation finite-terminal check, PDE-vs-BS consistency, hedging distribution spread, batch spread stability.

Returns gate decision (go / warning / blocked), failure counts, per-capability fail distribution, most severe violation. Each failure includes threshold, actual value, violation magnitude, and a ranked corrective action.

**Explainable QA**: 6 action templates ranked by expected_gain / cost. Greedy minimal fix set covering all failures. What-if projection of gate outcome after applying fixes.

### Live Market Data

| Source | Data | Fallback |
|---|---|---|
| Binance spot | BTC/USD price | $65,000 |
| Deribit DVOL | BTC implied vol index | 80% |
| Deribit options | Full IV surface, multi-strike multi-expiry | Empty → DVOL |
| Binance futures | Perp funding rate → annualized μ | 0.01%/8h |
| US Treasury FiscalData | 1M–2Y yield curve | ~4.5% flat |

Rate curve cached server-side with 1h TTL. All fetches async and concurrent. Partial failures degrade gracefully.

---

## API Routes

All responses use a normalized record envelope: `run_id`, `tool_name`, `input_params`, `result_summary`, `result_details`, `diagnostics` (engine_available, threads, compute_ms, timestamp), `created_at`.

| Route | Capability |
|---|---|
| `POST /api/tool/pricing/run` | Single pricing, all 4 methods, all 5 greeks, MC sampler selection |
| `POST /api/tool/pricing/batch` | Batch up to 500 jobs, method stats |
| `POST /api/tool/pricing/batch/grid` | Server-generated spot/vol shock grid |
| `POST /api/tool/pricing/multi-leg` | Multi-leg strategy pricing, per-leg breakdown, net greeks |
| `POST /api/tool/scenario/run` | 5-scenario BS sweep, tornado data |
| `POST /api/tool/stress/run` | Stress library + cross-scenario aggregation |
| `GET  /api/tool/stress/packs` | Pack metadata for dynamic frontend rendering |
| `POST /api/tool/hedging/run` | 4-strategy delta hedge comparison, PnL distribution |
| `POST /api/tool/greek/surface` | Greek surface heatmap over spot × maturity grid |
| `POST /api/tool/calibration/iv` | BS implied vol (Brent's method) |
| `POST /api/tool/calibration/iv/batch` | Batch IV solve, OpenMP parallel |
| `POST /api/tool/calibration/heston/price` | Heston call price (Gil-Pelaez, M=512) |
| `POST /api/tool/calibration/heston` | Heston calibration (Nelder-Mead, RMSE) |
| `POST /api/tool/pde/run` | Finite-difference PDE, CN or implicit |
| `POST /api/tool/convergence/run` | Binomial step ladder vs BS |
| `POST /api/tool/benchmark/run` | Cross-method accuracy/runtime/efficiency benchmark |
| `POST /api/tool/stats/run` | Normal MGF, mean, variance |
| `POST /api/tool/ito/run` | Itô expectation checks |
| `POST /api/tool/simulation/run` | GBM or Vasicek path simulation |
| `POST /api/tool/measure/run` | RN density path, market price of risk |
| `POST /api/tool/measure/compare` | P vs Q multi-path comparison |
| `POST /api/tool/validation/gate` | Omnibus validation gate + Explainable QA |
| `GET  /api/market/btc` | Full BTC snapshot |
| `GET  /api/market/spot` | Live BTC/USD spot |
| `GET  /api/market/dvol` | Deribit DVOL index |
| `GET  /api/market/funding` | Binance perp funding rate |
| `GET  /api/market/rates` | US Treasury yield curve |
| `GET  /api/market/surface` | Multi-strike IV surface from Deribit |
| `POST /api/market/resolve` | Strike/maturity → vol + rate via C++ interpolation |
| `POST /api/market/iv/diagnostics` | IV diagnostics, heatmap, configurable burst zones, skew |

---

## Frontend Workbench

Single-page, three-column layout: parameters | mode controls | results. No page navigation.

**Live / Sim toggle**: in Live mode, spot/vol/rate/μ are read-only and auto-populated from market APIs. Strike or maturity changes trigger a backend resolve call (C++ bilinear interpolation). In Sim mode all inputs are editable.

**13 compute modes**: Pricing (single or batch), Scenario, IV Surface, Greek Surface, Calibration (BS IV or Heston), Multi-Leg, Stress, Hedging, PDE, Measure (P vs Q or RN Density), Convergence, Benchmark, Validation Only. Any mode can optionally prepend a validation gate run with advisory or blocking behavior.

**MC Sampler selector**: Pseudorandom / Antithetic / Sobol — live control on the Pricing param panel, propagates through the full stack to the C++ kernel.

**Burst zone sliders**: lower and upper quantile range sliders in the IV Diagnostics param panel; labels update live; re-run sends updated thresholds to the server.

**Stress pack selector**: populated dynamically from `GET /api/tool/stress/packs` on page load. New packs added to `stress_packs.json` appear without any frontend change.

**Charts** (all native Canvas/SVG, no third-party chart library): sparkline, line chart, dual-line comparison, tornado chart, grouped bar chart, PnL histogram with colored loss/gain bins and dashed quantile lines, IV heatmap with configurable burst/suppressed zones and colorbar, IV term structure, IV smile with ATM line and gradient fill, Greek surface heatmap, threshold-vs-value chart, hedge efficiency frontier scatter chart with Pareto frontier line.

Parameter state preserved in localStorage across sessions.

---

## Course Coverage (Sessions 1–9)

| Session | Theory | Platform capability |
|---|---|---|
| 1–2 | Probability / statistics foundations | `stats/run` — MGF, moment checks |
| 3 | Discrete processes, binomial trees | `pricing/run` binomial, `convergence/run` |
| 4 | Brownian motion | `simulation/run` Brownian path |
| 5 | Itô calculus | `ito/run`, validation expectation gap |
| 6 | SDE numerics | GBM/Vasicek paths, discrete stability checks |
| 7 | Girsanov / measure change | `measure/run`, `measure/compare` P vs Q |
| 8 | Risk-neutral pricing | Multi-method pricing, calibration, benchmark |
| 9 | Dynamic hedging | `hedging/run`, 4-strategy PnL distribution, efficiency frontier |

---

## What Remains Incomplete

**Persistence**: Every result is ephemeral. There is no run history, no cross-session comparison, and no way to reproduce a specific result by ID after the session ends. (Intentionally deferred — see UPGRADE.md Upgrade 6 for the SQLite design.)

---

## Runtime

```
./run.sh          # builds C++ if needed, starts server on :8000
./run.sh build    # force C++ rebuild before starting
```

- Web: `http://127.0.0.1:8000/`
- API docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/api/health`

Dependencies: `fastapi`, `uvicorn`, `pydantic`, `httpx`. C++23 with OpenMP (Homebrew LLVM on macOS) and nlohmann/json.
