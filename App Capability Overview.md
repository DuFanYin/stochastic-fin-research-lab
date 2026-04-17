# Quant Lab App Capability Overview

This document describes the current, as-built capabilities of the `quant-lab` application across the C++ engine, FastAPI backend, and single-page workbench frontend.

## 1) What the App Is

`quant-lab` is a stochastic-finance compute platform with:

- A C++ numerical engine (`engine`) for core compute
- A FastAPI orchestration layer (`server`) exposing tool-style APIs
- A browser workbench (`static/workbench.html`) for parameterized runs and result interpretation

The platform is designed around a **parameter -> validation (optional) -> compute -> diagnostics/results** loop.

## 2) Runtime Topology

## 2.1 Entry and hosting

- `run.sh` builds C++ (if build script exists), ensures Python virtualenv health, installs requirements, frees occupied port, and starts Uvicorn with reload.
- `main.py` mounts API under `/api` and static assets under `/web`.
- Root `/` redirects to `/workbench.html`.

Primary runtime URLs:

- Web UI: `http://127.0.0.1:8000/`
- OpenAPI docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/api/health`

## 2.2 Layer responsibilities

- **C++ engine (`engine`)**: pricing, hedging simulations, PDE, stochastic checks, measure comparison, surface interpolation, and batch kernels.
- **Backend (`server`)**: request validation, tool routing, aggregation metrics, gating logic, normalization, diagnostics packaging.
- **Frontend (`static`)**: interactive mode selection, live/sim data behavior, API invocation orchestration, visual result rendering.

## 3) API Capability Surface

All tool responses are normalized to a common record schema:

- `run_id`
- `tool_name`
- `input_params`
- `result_summary`
- `result_details`
- `diagnostics` (includes engine availability, thread count, compute timing when available)
- `created_at`

## 3.1 Pricing and scenario tools

### `POST /api/tool/pricing/run`

Capabilities:

- European call pricing via MC, Black-Scholes, and Binomial
- Digital call closed-form pricing
- Optional American call via binomial early exercise
- Greeks (`delta_bs`, `vega_bs`)
- Error decomposition (`mc_minus_bs`, `binomial_minus_bs`)
- MC confidence interval and stability labels
- Optional FX normalization mode

### `POST /api/tool/pricing/batch`

Capabilities:

- Batch pricing of up to 500 jobs in one FFI call
- Per-job method spread and flattened tabular output
- Batch diagnostics: p50/p95 spread, min/max spread, spread CV, best/worst job indices
- Server-side method-level summary stats (avg/min/max/std and average error vs BS)

### `POST /api/tool/pricing/batch/grid`

Capabilities:

- Server-generated symmetric spot/vol shock grid from one base request
- Runs full batch pricing pipeline automatically

### `POST /api/tool/scenario/run`

Capabilities:

- 5-point BS scenario set (`base`, `spot_up`, `spot_down`, `vol_up`, `rate_up`)
- Absolute and relative impact metrics vs base
- Ranked sensitivity output and tornado-ready points

## 3.2 Hedging tool

### `POST /api/tool/hedging/run`

Capabilities:

- Delta-hedge PnL Monte Carlo distribution
- Distribution statistics (`mean/std/q05/q50/q95`)
- Histogram output for rendering
- Derived risk diagnostics (tail span, skew proxy, normalized std, scaling proxy)

## 3.3 Validation and stochastic-calculus tools

### `POST /api/tool/stats/run`

Capabilities:

- Normal-model stats checks: MGF, mean, variance (parameter-driven)

### `POST /api/tool/ito/run`

Capabilities:

- Itô-focused expectation checks for function families:
  - `exp_martingale`
  - `w2_minus_t`
  - `w3`

### `POST /api/tool/simulation/run`

Capabilities:

- Path simulation preview for:
  - Brownian motion
  - Vasicek process

### `POST /api/tool/measure/run`

Capabilities:

- Risk-neutral density path generation summary
- Market price of risk (`theta`) and density diagnostics (integral proxy, CV, tail ratio, lag-1 autocorrelation)

### `POST /api/tool/measure/compare`

Capabilities:

- Physical measure (P) vs risk-neutral measure (Q) terminal distribution comparison
- Drift/mean/variance/quantile gap analytics
- Dual path previews and comparison-ready table output

### `POST /api/tool/validation/gate`

Capabilities:

- Multi-capability gate combining selected checks:
  - stats moment checks
  - measure density quality
  - measure compare quality
  - Itô expectation gap
  - convergence quality
  - simulation finite-terminal check
  - PDE-vs-BS consistency
  - hedging distribution spread
  - batch spread stability
- Advisory or blocking decision mode
- Structured fail breakdown, max violation, and action guidance

## 3.4 PDE / convergence / benchmark tools

### `POST /api/tool/pde/run`

Capabilities:

- Finite-difference PDE pricing with:
  - Crank-Nicolson
  - Fully implicit
- Grid diagnostics (S/T steps, total points, aspect ratio, density)
- Price gap vs BS reference

### `POST /api/tool/convergence/run`

Capabilities:

- Binomial step-ladder convergence analysis against BS reference
- Error trajectory metrics (best/worst error, slope proxy, monotonicity breaks, improvement ratios)
- Curve points for plotting

### `POST /api/tool/benchmark/run`

Capabilities:

- Cross-method benchmark over MC/BS/Binomial/PDE
- Runtime and error ranking under a configurable baseline
- Stability labels and efficiency ranking

## 3.5 Live market tools

### `GET /api/market/btc`

Capabilities:

- Composite BTC snapshot from multiple external sources:
  - Binance spot
  - Deribit DVOL
  - Deribit options IV surface (ATM per expiry extraction)
  - Binance perp funding (annualized mu proxy)
  - US Treasury rate curve
- Fallbacks for each data source to preserve usability under partial failures

### `POST /api/market/resolve`

Capabilities:

- Backend resolution of model inputs for target strike/maturity:
  - Vol via C++ surface interpolation in log-moneyness/sqrt-time space
  - Rate via tenor interpolation on rate curve
- Provenance metadata (interpolation method, nearest instrument/tenor context)

## 4) Frontend Workbench Capability

The UI is a single-page, three-column workbench with dynamic result cards and mode switches.

## 4.1 Data modes

- **Live mode**:
  - `spot/vol/rate/mu` are readonly and auto-populated from market APIs
  - pre-run live refresh can occur before compute
  - strike and maturity changes trigger backend resolve against cached snapshot
- **Sim mode**:
  - all core fields editable
  - no external market fetch required

## 4.2 Compute modes and orchestration

- Run buttons for pricing, scenario, hedging, PDE, measure, convergence, benchmark, validation-only
- Pricing mode switch: single vs batch
- Measure mode switch: P-vs-Q vs RN density
- Optional pre-check gate before compute:
  - advisory mode
  - block-on-fail mode

## 4.3 Result UX and visual analytics

Frontend renderers support:

- Key-value metric blocks
- Tabular views
- Charts: sparkline, dual-line comparison, tornado, grouped bars, convergence line, threshold-vs-value, PnL histogram
- Diagnostics badges tied to backend diagnostics payloads

## 5) C++ Engine Capability Detail

Exposed through a C ABI (`c_api.h`) and loaded via Python `ctypes`.

Implemented compute kernels include:

- Monte Carlo European call pricing (with stderr)
- Black-Scholes closed-form call pricing
- Binomial European and American pricing
- Digital call closed-form pricing
- Pricing Greeks and decomposition helpers
- Scenario vector pricing
- Delta-hedging PnL distribution + histogram
- Normal stats and Itô check helpers
- Brownian/Vasicek path simulation
- Measure density path generation
- P-vs-Q Monte Carlo comparison
- PDE solver (CN/implicit)
- Vol surface interpolation
- Multi-job batch pricing
- Thread control (OpenMP-aware when available)

Behavior with engine unavailable:

- Python fallback paths keep APIs responsive with simplified proxy outputs
- Diagnostics report `engine_available` so callers can detect degraded mode

## 6) Validation and Quality Controls

Validation is not a standalone afterthought; it is integrated as an execution gate:

- Rule evaluators convert model checks into pass/fail metrics with thresholds
- Each failure includes interpretation and suggested corrective action
- Gate output includes:
  - decision (`go`, `warning`, `blocked`)
  - failure counts and rates
  - capability-level fail distribution
  - most severe violation marker

This enables compute workflows to be quality-aware before expensive or misleading runs continue.

## 7) Operational Characteristics

- Python dependencies are intentionally minimal (`fastapi`, `uvicorn`, `pydantic`, `httpx`)
- Build path supports macOS OpenMP via Homebrew LLVM when available
- Uvicorn runs in reload mode for local development
- Static and API are served from one host for simplified local operation

## 8) Current Product Envelope (As-Built)

The current app delivers:

- A full-stack, executable stochastic-finance lab
- Unified tool-style APIs spanning pricing, hedging, measure analysis, PDE, convergence, benchmark, and validation
- Live BTC market ingestion and backend-resolved parameter mapping for real-time workflows
- A single interactive workbench that supports both exploratory and structured compute runs

In short, this is already a working compute platform rather than a static demo page.
