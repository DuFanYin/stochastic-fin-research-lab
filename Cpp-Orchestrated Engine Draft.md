# C++ Orchestrated Engine Draft

## 1. Draft Goal

Move orchestration responsibility from Python to C++ so that:

- Python only acts as request router and transport adapter
- C++ engine becomes the single execution brain
- The same engine can later plug into live trading flow

Target execution path:

`Request -> Router (Python) -> C++ run_task() -> Structured response -> Router passthrough`

---

## 2. Runtime Role Split

### 2.1 Python (Router-Only)

- Parse HTTP request
- Basic auth/rate-limit/tenant guard
- Convert JSON to C++ task request payload
- Call C ABI entrypoint
- Return C++ response (near passthrough)

Python should NOT contain:

- strategy selection logic
- validation decision logic
- remediation recommendation logic
- cross-solver orchestration rules

### 2.2 C++ (Orchestrator + Operators)

C++ owns:

- task planning and stage sequencing
- model/solver selection rules
- validation policy evaluation
- decision output (`go/warn/block`)
- explainable remediation actions
- diagnostics and trace payload assembly

---

## 3. Unified Task Contract

The contract should be versioned and stable.

## 3.1 TaskRequest (logical schema)

```json
{
  "contract_version": "v1",
  "trace_id": "string",
  "task_type": "pricing|hedging|risk_surface|scenario|validation_bundle",
  "market_context": {
    "as_of": "ISO8601",
    "spot": 65000.0,
    "rate": 0.04,
    "vol": 0.8,
    "dividend_yield": 0.0,
    "mu": 0.06
  },
  "model_spec": {
    "model": "gbm|vasicek|heston|local_vol",
    "params": {
      "sigma": 0.8,
      "kappa": 1.2,
      "theta": 0.03
    }
  },
  "product_spec": {
    "product_type": "european_call|digital_call|american_call",
    "strike": 65000.0,
    "maturity": 0.25
  },
  "solver_spec": {
    "primary_solver": "mc|pde|tree",
    "mc": { "n_paths": 20000, "seed": 42 },
    "pde": { "s_steps": 160, "t_steps": 160, "method": "crank_nicolson" },
    "tree": { "steps": 500, "variant": "crr" }
  },
  "hedging_spec": {
    "n_rebalances": 52,
    "n_paths": 2000,
    "strategy_compare": {
      "enable": true,
      "transaction_cost_bps": 5.0,
      "rebalance_threshold": 0.02,
      "vol_mismatch_mult": 1.15
    }
  },
  "risk_surface_spec": {
    "enable": false,
    "axes": {
      "spot_grid": [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3],
      "vol_grid": [0.4, 0.6, 0.8, 1.0, 1.2],
      "t_grid": [0.05, 0.1, 0.25, 0.5, 1.0]
    },
    "greeks": ["delta", "gamma", "vega"]
  },
  "scenario_spec": {
    "enable": false,
    "scenario_pack": "stress_core_v1",
    "scenarios": ["vol_spike", "rate_jump", "gap_move", "corr_breakdown"]
  },
  "validation_policy": {
    "mode": "strict|balanced|lenient",
    "block_on_fail": true,
    "ruleset": "default_v1",
    "threshold_overrides": {}
  },
  "execution_policy": {
    "max_runtime_ms": 3000,
    "max_threads": 8,
    "deterministic": true
  }
}
```

## 3.2 TaskResponse (logical schema)

```json
{
  "contract_version": "v1",
  "trace_id": "string",
  "status": "ok|error",
  "decision": "go|warn|block",
  "severity": "info|low|medium|high|critical",
  "summary": {},
  "details": {},
  "validation": {
    "checks_total": 0,
    "checks_failed": 0,
    "failed_items": [],
    "failed_by_capability": {}
  },
  "actions": [
    {
      "id": "raise_mc_paths",
      "priority": 1,
      "description": "increase n_paths from 2e4 to 1e5",
      "expected_impact": {
        "error_reduction_pct": 40.0,
        "runtime_increase_pct": 120.0
      }
    }
  ],
  "strategy_recommendation": {
    "name": "with_transaction_cost",
    "reason": "min_es95_then_std_then_mean",
    "metrics": {
      "es95": 2100.0,
      "std": 1100.0,
      "mean": 70.0
    }
  },
  "diagnostics": {
    "runtime_ms": 0.0,
    "stage_timings_ms": {},
    "engine_version": "string",
    "compute_path": []
  },
  "error": null
}
```

---

## 4. C ABI Draft (Stable Integration Layer)

Use versioned C ABI as the primary external integration point.

```c
// lifecycle
int sf_engine_init(const char* config_json);
int sf_engine_shutdown(void);
const char* sf_engine_version(void);

// run task with JSON contract
// returns 0 on success, non-zero on failure
int sf_run_task_json(
    const char* request_json,
    char* out_response_json,
    int out_capacity,
    int* out_written
);

// optional: query capability metadata
int sf_get_capabilities_json(
    char* out_json,
    int out_capacity,
    int* out_written
);
```

### ABI Rules

- No STL types in public ABI
- All payloads are UTF-8 JSON strings
- Fixed error code table (`SF_OK`, `SF_ERR_BAD_REQUEST`, `SF_ERR_TIMEOUT`, etc.)
- Contract version required in every request and response

---

## 5. C++ Internal Pipeline Draft

## 5.1 Core Stages

1. Parse + contract validation
2. Build execution context
3. Plan compute graph from `task_type` and specs
4. Execute operators (pricing/hedge/risk/simulation)
5. Run validation rules
6. Generate decision + remediation actions
7. Build response payload

## 5.2 Internal Components

- `TaskRouter` (inside C++): maps task type to pipeline
- `OperatorRegistry`: pricing, hedging, scenario, validation operators
- `PolicyEngine`: decision and action generation
- `ResponseAssembler`: summary/details/diagnostics normalization

---

## 6. Python Router Draft (Minimal)

Python route logic should look like:

```python
@router.post("/api/v1/task/run")
def run_task(req: dict):
    request_json = json.dumps(req)
    response_json = c_api.sf_run_task_json(request_json)
    return json.loads(response_json)
```

Allowed Python add-ons:

- auth and tenant checks
- trace_id propagation
- HTTP-level timeout and retry guard
- request/response logging wrappers

No domain decision logic in Python.

---

## 7. Live Trading Flow Integration Draft

To connect with live flow, add a thin trading adapter:

- Market data adapter -> fills `market_context`
- Position adapter -> adds holdings/exposure into request extension
- Risk limit adapter -> injects runtime constraints
- Order simulator/executor -> consumes strategy recommendation

Recommended runtime modes:

- `research_mode`: full details, heavy diagnostics
- `live_mode`: strict latency budget, minimal output
- `shadow_mode`: run in parallel without execution side effects

---

## 8. Migration Plan (From Current State)

## Phase 1: Contract First

- freeze `v1` request/response schema
- add `sf_run_task_json` scaffold
- keep existing old endpoints available

## Phase 2: Orchestration Move

- migrate hedging decision/recommendation from Python to C++
- migrate validation decision tree to C++
- keep Python as passthrough

## Phase 3: Operator Consolidation

- move all cross-operator branching logic into `TaskRouter` (C++)
- expose one unified `/api/v1/task/run` from Python

## Phase 4: Live Adapter Readiness

- add mode flags (`research/live/shadow`)
- add latency and fallback policy
- verify deterministic replay by seed + snapshot

---

## 9. Definition of Done

This architecture is considered complete when:

- Python has no business orchestration logic
- C++ returns decision + actions consistently for all major task types
- one unified task endpoint drives all major workflows
- contracts are versioned and backward-safe
- same task payload replays identically in research and shadow-live

---

## 10. Risks and Controls

- **Risk:** ABI instability  
  **Control:** versioned C ABI + contract tests

- **Risk:** JSON overhead  
  **Control:** start with JSON for portability, move to flatbuffer/protobuf if needed

- **Risk:** C++ orchestration complexity growth  
  **Control:** strict pipeline stage interfaces + policy module separation

- **Risk:** live integration drift  
  **Control:** snapshot-based replay and deterministic seeds

---

## 11. Immediate Next Build Items

1. add `sf_run_task_json` skeleton with fixed response shape
2. implement `task_type = hedging` end-to-end in that new path
3. move best-strategy recommendation fully into C++ policy module
4. switch current `/tool/hedging/run` to call the new task entrypoint

This delivers the first real proof that C++ has become orchestrator, while Python remains only request routing.
