# Quant Lab

A workbench for stochastic finance. A C++23 engine does the numerics, a FastAPI server feeds it market data and serves the
results, and one browser page drives the whole workflow. You can:

- price options several ways;
- calibrate models;
- stress and hedge positions;
- screen live Deribit option chains for strategies;
- check every number against theory.

It runs locally on Linux, with no database and no API keys.

## What it does

- **Pricing**:
  - methods: Black-Scholes, Monte Carlo (pseudorandom, antithetic, Sobol), binomial and trinomial lattices, finite differences
    (explicit, implicit, Crank-Nicolson, PSOR for American exercise) and Longstaff-Schwartz;
  - all five Greeks;
  - batch and grid runs;
  - multi-leg strategies, including Black-76 legs.
- **Calibration**: implied volatility by Brent's method; Heston pricing and calibration.
- **Risk**: scenario sweeps, a stress library with P&L attribution, four delta-hedging strategies compared on shared paths, and the
  hedge efficiency frontier.
- **Screener**:
  - pulls the BTC or ETH option chain from Deribit;
  - enumerates single calls, iron condors, straddles, strangles and calendars;
  - ranks them by edge against a model vol;
  - hands any of them to Multi-Leg pricing or Risk.
- **Market data**: spot, the DVOL index, funding, the US Treasury curve and an implied-vol surface with diagnostics. Every source
  falls back to cached or fixed values when offline.
- **Theory checks**: moments, Itô's formula, GBM and Vasicek paths, change of measure (P vs Q), convergence and cross-method
  benchmarks.
- **Validation gate**: a pre-check that can block a run, with ranked suggestions for fixing whatever failed.

## How it fits together

```
static/workbench.html   browser: one page, rendering and workflow, no logic
        │  HTTP / JSON
server/                 FastAPI: market data, validation, routing, annotation, nothing numerical
        │  ctypes, JSON in / JSON out
engine/                 C++23 + OpenMP: every computation, no I/O
```

A feature is added bottom-up: kernel primitive → engine workflow → result struct → C ABI → Python wrapper → route → schema →
frontend. [DOCUMENTATION.md](DOCUMENTATION.md) walks through each layer.

## Requirements

- Linux x86-64 (developed on Ubuntu 26.04)
- CMake ≥ 3.16 and a C++23 compiler with OpenMP (tested with GCC 15.2)
- nlohmann/json
- Python ≥ 3.10 with `venv`

On Ubuntu:

```bash
sudo apt install build-essential cmake nlohmann-json3-dev python3-venv lsof
```

## Quick start

```bash
./run.sh build    # build the engine (Release), then start the server
./run.sh          # start the server with the existing engine build
```

Then open <http://127.0.0.1:8000/>. The API documentation is at `/docs` and a health check at `/api/health`. `PORT=8001 ./run.sh`
picks another port.

`run.sh` does the following:
- creates `server/.venv` and installs `server/requirements.txt`;
- stops anything already listening on the port;
- starts uvicorn with auto-reload.

The engine builds into `engine/build/` (`libsf_engine_c.so` is the library the server loads). For a debug build:

```bash
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Debug
cmake --build engine/build -j
```

## Tests

```bash
server/.venv/bin/pip install pytest
server/.venv/bin/python -m pytest tests
```

The tests cover pricing methods, the screener, its routes and the option-chain handling, and they run offline. `QUANT_LAB_LIVE=1`
adds a check against live Deribit data. `tests/reference/` compares the lattices and finite differences against the QF-205
Python package and is skipped when that package is not available.

## Repository layout

| Path | Contents |
|---|---|
| `engine/src/kernel/` | numerical primitives: pricing, simulation, optimiser, statistics, screener |
| `engine/src/engine/` | domain workflows, one file per area |
| `engine/src/contracts/` | result structs |
| `engine/src/api/` | JSON parsing and the exported C ABI |
| `server/src/api/` | FastAPI routes |
| `server/src/services/` | engine client, market data, stress library, validation and Explainable QA |
| `server/src/schemas/` | request models |
| `server/fixtures/` | recorded Deribit chains for offline use, and the script that records them |
| `static/` | the workbench page, its scripts and styles |
| `tests/` | test suites |
| `bench/concurrency/` | standalone benchmark: OpenMP vs a thread pool on the engine's LSM, SPSC queue vs a locked queue |

Option-chain snapshots are cached outside the repository, in `~/.quant-lab/` (override with `QUANT_LAB_HOME`).

## Further reading

- [DOCUMENTATION.md](DOCUMENTATION.md): architecture, every capability, market data, the API, the workbench, contracts, tests,
  and where the code came from.
- [ROADMAP.md](ROADMAP.md): what has been built and what is next.
- [bench/concurrency/README.md](bench/concurrency/README.md): concurrency benchmark results and why the engine uses OpenMP.
