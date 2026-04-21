# Quant Lab — Upgrade Design

> Baseline: ASIS.md (current as-built state).  
> This document describes what to build, how it fits the existing architecture, and the precise contract changes at each layer — C++ structs, C ABI, Python helpers, FastAPI routes, and frontend.  
> It does not describe schedule or priority order.

---

## Architectural Principles (Unchanged)

The three-layer split is permanent and must not be violated by any upgrade:

- **C++ engine**: all numerical computation, no business logic, no I/O
- **Python server**: validation, routing, annotation, aggregation — nothing numerical
- **Browser**: rendering, parameter management, workflow orchestration — no logic

Every upgrade follows the same propagation path:

```
kernel/*.cpp (primitive)
  → engine/*_engine.cpp (workflow)
    → contracts.h (output struct)
      → c_api.cpp (ABI symbol + parser.cpp JSON in/out)
        → engine_client.py (Python helper)
          → routes/*.py (FastAPI route)
            → request_models.py (Pydantic schema)
              → workbench.html + renderers.js (frontend)
```

A change that touches only the bottom of this chain is a frontend patch. A change that touches the top is a full-stack upgrade. Each section below identifies exactly which layers are affected.

---

## ~~Upgrade 1 — Full Greek Surface~~ ✅ Done

All 5 BS greeks (delta, gamma, theta, vega, rho) now computed in C++ and returned on every pricing result. New `POST /api/tool/greek/surface` route computes any greek across a configurable spot × maturity grid and renders it as a Canvas heatmap in the workbench. New "Greeks" mode button added to the control strip. Files changed: `kernel/pricing/greeks.cpp`, `contracts.h`, `engine.h`, `pricing_engine.cpp`, `c_api.h/cpp`, `parser.cpp`, `engine_client.py`, `request_models.py`, `routes/greeks.py`, `tool.py`, `charts.js`, `renderers.js`, `core.js`, `runners.js`, `app.js`, `workbench.html`.

---

## ~~Upgrade 2 — Put Options and Multi-Leg Strategies~~ ✅ Done

`european_put` now fully supported across BS, MC, and binomial pricing via `is_call` bool parameter threaded through all kernel functions (backward-compat overloads preserved). New `MultiLegParams` / `run_multi_leg()` engine function prices arbitrary legs (call/put, any strike, signed quantity); auto-detects strategy type (straddle, bull_call_spread, bear_put_spread, strangle, etc.). New `POST /api/tool/pricing/multi-leg` route with `MultiLegRequest` / `LegSpecRequest` Pydantic schemas. Frontend: new "Multi-Leg" mode button with inline JSON legs editor textarea, `renderMultiLeg()` renderer showing per-leg breakdown table with net BS/MC price and net greeks. Put-call parity verified to machine precision. Files changed: `black_scholes.cpp`, `monte_carlo.cpp`, `binomial_lattice.cpp`, `kernel.h`, `contracts.h` (LegResult + MultiLegResult), `engine.h` (MultiLegParams + LegSpec), `pricing_engine.cpp`, `c_api.h/cpp`, `parser.cpp`, `engine_client.py`, `request_models.py`, `routes/multi_leg.py`, `tool.py`, `renderers.js`, `core.js`, `runners.js`, `app.js`, `workbench.html`.

---

## ~~Upgrade 3 — Model Calibration~~ ✅ Done

Brent's method IV solver (`bs_implied_vol`) in `kernel/pricing/implied_vol.cpp` — error < 4e-10 vs true IV, convergence guaranteed in [1e-4, 5.0]. Batch variant `implied_vol_batch` parallelized with OpenMP. Heston characteristic function (`heston_call_price`) in `kernel/pricing/heston.cpp` — Gil-Pelaez two-probability inversion using Heston (1993) original formula with AMST branch-cut-stable parametrization, Simpson quadrature M=512 on [1e-5, 100]; reduces to BS price to < 1e-4 error in flat-vol limit. Nelder-Mead optimizer (`kernel/optimizer/nelder_mead.cpp`) — bounds by clamping, 5-param Heston calibration with RMSE minimization. New `engine/calibration_engine.cpp` orchestrates all three. Full ABI chain: `sf_run_implied_vol_json`, `sf_run_implied_vol_batch_json`, `sf_run_heston_price_json`, `sf_run_heston_calibrate_json`. Four FastAPI routes at `/api/tool/calibration/{iv,iv/batch,heston/price,heston}`. Pydantic schemas `ImpliedVolRequest`, `ImpliedVolBatchRequest`, `HestonPriceRequest`, `HestonCalibrateRequest`. Frontend: "Calibration" mode button, model selector (BS IV / Heston), `renderCalibration()` renderer with fit-quality badge. Calibration RMSE on flat BS smile = 0.0001.

---

## ~~Upgrade 4 — Stress Library Cross-Scenario Aggregation~~ ✅ Done

`GET /api/tool/stress/packs` returns structured metadata for all packs; frontend stress pack buttons now populated dynamically via `loadStressPacks()` on page load. `run_stress_library()` extended with `_cross_scenario_summary()`: robustness score, key driver (variance decomposition on spot/vol/rate attribution), worst scenario, scenarios breaching 5%-of-spot threshold, hedge resilience mean/worst, ranked scenario list — all returned as `cross_scenario_summary` in `result_details`. `IVDiagnosticsRequest` gains `burst_lower_quantile` (default 0.10) and `burst_upper_quantile` (default 0.90) fields replacing hardcoded quantiles; two range sliders added to IV param panel with live label update. `renderStress()` updated to display the cross-scenario robustness panel above the tornado chart. Files changed: `stress_library.py`, `routes/stress.py` (new), `routes/market.py`, `tool.py`, `renderers.js`, `runners.js`, `app.js`, `workbench.html`.

---

## ~~Upgrade 5 — Hedge Efficiency Frontier~~ ✅ Done

Frontend-only. `efficiencyFrontierChart(canvas, strategies)` added to `charts.js` — Canvas 2D scatter plot with x = transaction_cost, y = ES95; Pareto-optimal points highlighted in color, dominated points greyed out; dashed frontier line connecting non-dominated points sorted by cost. Canvas rendered inside the Hedging result card below the PnL histogram via `requestAnimationFrame` after DOM update. Re-exported through `core.js`. Files changed: `charts.js`, `core.js`, `renderers.js`.

---

## Upgrade 6 — Persistence Layer

### What It Is

A lightweight run history so results can be compared across sessions, parameter sweeps can be reproduced, and the research loop (run → adjust → compare) becomes possible.

### Design Constraints

- No external database process. SQLite via Python's built-in `sqlite3` module — zero new dependencies.
- Runs table stores the normalized `_record()` envelope that every route already assembles. No schema changes to existing routes.
- Read path: `GET /api/runs` (list), `GET /api/runs/{run_id}` (full record). Write path: automatic — every successful tool call writes a row.
- Storage: `~/.quant-lab/runs.db` (outside the repo). No git-tracked data files.

### Schema

```sql
CREATE TABLE runs (
    run_id      TEXT PRIMARY KEY,
    tool_name   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    input_json  TEXT NOT NULL,   -- JSON of input_params
    summary_json TEXT NOT NULL,  -- JSON of result_summary
    details_json TEXT NOT NULL,  -- JSON of result_details
    diag_json   TEXT NOT NULL    -- JSON of diagnostics
);

CREATE INDEX idx_runs_tool ON runs(tool_name);
CREATE INDEX idx_runs_created ON runs(created_at);
```

### Python Changes

New service `run_store.py`:
```python
class RunStore:
    def write(self, record: dict) -> None: ...
    def list_runs(self, tool_name=None, limit=50) -> list[dict]: ...
    def get_run(self, run_id: str) -> dict | None: ...
```

Modify `shared.py`'s `_record()` to call `RunStore.write()` after assembling the record. This is a single injection point — all 22 routes automatically gain persistence with one change.

**New routes** (`routes/history.py`):
- `GET /api/runs?tool=&limit=50` — list recent runs with summary only (no details)
- `GET /api/runs/{run_id}` — full record including details and diagnostics
- `DELETE /api/runs/{run_id}` — remove a single run

### Frontend Changes

**Run History panel**: a collapsible drawer at the bottom of the workbench (not a mode button — it is always available). Shows a table of recent runs: timestamp, tool name, key input params (spot, strike, vol, maturity), and a summary metric. Clicking a row re-loads the result into the result area. A "Compare" toggle allows selecting two runs to show a diff view: same result card rendered twice side-by-side with delta annotations.

**Run ID badge**: each result card already has a `run_id` field in the response. Display it as a small badge in the card header. Clicking the badge copies the run ID to clipboard.

---

## ~~Upgrade 7 — MC Variance Reduction~~ ✅ Done

`SamplerType` enum (Pseudorandom/Antithetic/Sobol) added to `kernel.h`. `monte_carlo.cpp` refactored into three internal implementations: `mc_pseudorandom` (original mt19937), `mc_antithetic` (half draws, evaluate z and −z, avg per pair — same total path evaluations), `mc_sobol` (Joe-Kuo Gray-code Sobol up to 21 dims, Beasley-Springer-Moro normal quantile). New `kernel/simulation/sobol.cpp` with `SobolEngine` (direction-number init, Gray-code increment). All existing `mc_price_full`/`mc_price_with_stderr` overloads preserved for backward compat; new `SamplerType` overloads added. `PricingParams.mc_sampler` string field added to `engine.h`; `pricing_engine.cpp` maps it to `SamplerType` before the MC call. `parser.cpp` reads `mc_sampler` from JSON (default `"pseudorandom"`). `PricingRequest` gains `mc_sampler: str = "pseudorandom"`. Frontend: MC Sampler select-button group (Pseudorandom / Antithetic / Sobol) added to Pricing param panel; `basePayload()` includes it. Build: `sobol.cpp` added to `CMakeLists.txt`. Compiles clean. Files changed: `monte_carlo.cpp`, `kernel/simulation/sobol.cpp` (new), `kernel.h`, `engine.h`, `pricing_engine.cpp`, `parser.cpp`, `request_models.py`, `CMakeLists.txt`, `workbench.html`, `runners.js`.

---

## Contract Versioning and Backward Compatibility

Every new field added to a response struct must have a default value so existing callers that ignore unknown fields continue working.

Every new route is additive. No existing route changes its response structure — only new fields are appended.

The `contract_version` field in C++ response structs is already present. Increment to `"v1.1"` when Greek surface, put options, and calibration are added; `"v1.2"` when persistence and variance reduction are added.

The `_TASK_TO_SYMBOL` dict in `engine_client.py` is the single registry of C++ capabilities. Any new C ABI symbol must be registered there before any route can call it.

---

## C++ Build Notes

The `CMakeLists.txt` currently compiles all `src/**/*.cpp` via a glob. New kernel files (`heston.cpp`, `nelder_mead.cpp`, `sobol.cpp`) will be picked up automatically. New directories (`kernel/optimizer/`, `kernel/calibration/`) must be added to the glob pattern or listed explicitly.

The Nelder-Mead optimizer uses `std::function` for the objective — this requires C++17 or later (already satisfied by the C++23 build).

Heston characteristic function evaluation uses complex arithmetic (`std::complex<double>`) — available in C++ standard library, no new dependency.

Sobol direction numbers are a 21×32 static lookup table compiled into the binary — approximately 5KB of data, no I/O at runtime.
