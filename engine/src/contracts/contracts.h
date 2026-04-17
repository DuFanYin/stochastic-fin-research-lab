#pragma once

#include <string>
#include <vector>

namespace sf {

// ── Unified task response envelope ───────────────────────────────────────────
// Returned by ResponseAssembler, serialized to JSON by json_codec.

enum class TaskStatus { Ok, Error };
enum class GateDecision { Go, Warn, Block };

struct TaskResponse {
    std::string   contract_version = "v1";
    std::string   trace_id;
    TaskStatus    status     = TaskStatus::Ok;
    GateDecision  decision   = GateDecision::Go;
    std::string   task_type;
    double        runtime_ms = 0.0;
    std::string   error_code;
    std::string   error_message;
};



// ── Pricing ──────────────────────────────────────────────────────────────────

struct PricingResult {
    double mc         = 0.0;
    double bs         = 0.0;
    double binomial   = 0.0;
    double mc_std_err = 0.0;
    double american   = 0.0;
    bool   has_american = false;
    double delta_bs   = 0.0;
    double vega_bs    = 0.0;
    double mc_minus_bs      = 0.0;
    double binomial_minus_bs = 0.0;
    double spread     = 0.0;
    double rel_spread = 0.0;
    std::string stability;   // "good" | "check_model_params"
    std::string numeraire;
    // Echo of input params for display
    double in_spot     = 0.0;
    double in_strike   = 0.0;
    double in_vol      = 0.0;
    double in_maturity = 0.0;
    double in_rate     = 0.0;
    int    in_n_paths  = 0;
};

struct BatchJobResult {
    double spot    = 0.0;
    double strike  = 0.0;
    double vol     = 0.0;
    double mc      = 0.0;
    double bs      = 0.0;
    double binomial = 0.0;
    double spread  = 0.0;
};

struct MethodStats {
    std::string method;
    double avg = 0.0;
    double min = 0.0;
    double max = 0.0;
    double std = 0.0;
    double avg_err_vs_bs = 0.0;
};

struct PricingBatchResult {
    int    job_count    = 0;
    double runtime_ms   = 0.0;
    double avg_spread   = 0.0;
    double p50_spread   = 0.0;
    double p95_spread   = 0.0;
    double max_spread   = 0.0;
    double min_spread   = 0.0;
    double spread_std   = 0.0;
    double spread_cv    = 0.0;
    int    worst_idx    = -1;
    int    best_idx     = -1;
    std::vector<BatchJobResult> rows;
    std::vector<MethodStats>    method_summary;
};

// ── Scenario ─────────────────────────────────────────────────────────────────

struct ScenarioRow {
    std::string name;
    double bs_price       = 0.0;
    double vs_base_diff   = 0.0;
    double abs_diff       = 0.0;
    double vs_base_pct    = 0.0;    // NaN signals "not available"
    double vs_base_bps    = 0.0;
    int    rank           = 0;
    bool   has_pct        = false;
};

struct ScenarioResult {
    double base_price  = 0.0;
    double max_price   = 0.0;
    double min_price   = 0.0;
    std::vector<ScenarioRow> rows;
};

// ── Hedging ──────────────────────────────────────────────────────────────────

struct HistogramData {
    std::vector<double> edges;
    std::vector<double> counts;
};

struct StrategyStats {
    std::string name;
    double mean             = 0.0;
    double std              = 0.0;
    double q05              = 0.0;
    double q50              = 0.0;
    double q95              = 0.0;
    double turnover         = 0.0;
    double transaction_cost = 0.0;
    double var95            = 0.0;
    double es95             = 0.0;
};

struct HedgingResult {
    double pnl_mean = 0.0;
    double pnl_std  = 0.0;
    double pnl_q05  = 0.0;
    double pnl_q50  = 0.0;
    double pnl_q95  = 0.0;
    // Derived tail analytics
    double normalized_std          = 0.0;
    double tail_span               = 0.0;
    double left_tail               = 0.0;
    double right_tail              = 0.0;
    double tail_skew_proxy         = 0.0;
    double tail_ratio_q95_q05      = 0.0;
    double scaling_proxy_std_sqrt_n = 0.0;
    // Run parameters (for display)
    int    n_rebalances = 0;
    int    n_paths      = 0;
    HistogramData histogram;
    std::vector<StrategyStats> strategies;
    std::string best_strategy;
    double compare_tc_bps           = 0.0;
    double compare_threshold        = 0.0;
    double compare_vol_mismatch_mult = 0.0;
};

// ── Validation ───────────────────────────────────────────────────────────────

struct ValidationRow {
    std::string capability;
    std::string metric;
    double value     = 0.0;
    double threshold = 0.0;
    double excess    = 0.0;
    std::string status;          // "pass" | "fail"
    std::string interpretation;
    std::string action;
};

struct ValidationResult {
    std::string gate_decision;   // "go" | "warning" | "blocked"
    std::string mode;            // "advisory" | "blocking"
    int    checks_total  = 0;
    int    checks_failed = 0;
    double fail_rate     = 0.0;
    double max_excess    = 0.0;
    std::string max_excess_item;
    std::string blocking_reason;
    std::vector<ValidationRow> rows;
};

}  // namespace sf
