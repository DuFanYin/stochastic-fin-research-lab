#include "engine/engine.h"
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <expected>
#include <ranges>
#include <string_view>

namespace sf {

using json = nlohmann::json;

// ── Internal helpers ──────────────────────────────────────────────────────────

namespace {

constexpr double kZ95 = 1.96;
constexpr int kSimulationPreviewCap = 200;

double elapsed_ms(double t0_ms) {
    return static_cast<double>(
        std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count()
    ) / 1000.0 - t0_ms;
}

template<typename T>
T jv(const json& j, std::string_view k, T def) {
    const std::string key(k);
    if (j.contains(key) && !j[key].is_null()) { try { return j[key].get<T>(); } catch(...){} }
    return def;
}

json base_envelope(const std::string& trace_id, const std::string& decision = "go",
                   const std::string& severity = "info") {
    return {
        {"contract_version", "v1"},
        {"trace_id",         trace_id},
        {"status",           "ok"},
        {"decision",         decision},
        {"severity",         severity},
        {"validation", {
            {"checks_total", 0}, {"checks_failed", 0},
            {"failed_items", json::array()}, {"failed_by_capability", json::object()}
        }},
        {"actions", json::array()},
        {"strategy_recommendation", json::object()},
        {"error", nullptr},
    };
}

json diag_block(double runtime_ms, const std::string& compute_path) {
    return {
        {"runtime_ms",        runtime_ms},
        {"stage_timings_ms",  {{"total", runtime_ms}}},
        {"engine_version",    "v1"},
        {"compute_path",      json::array({compute_path})},
    };
}

std::string err_response(const std::string& trace_id, const std::string& message) {
    return json{
        {"contract_version", "v1"}, {"trace_id", trace_id},
        {"status", "error"}, {"decision", "block"}, {"severity", "high"},
        {"result_summary", json::object()}, {"result_details", json::object()},
        {"validation", {{"checks_total",0},{"checks_failed",0},
                        {"failed_items",json::array()},{"failed_by_capability",json::object()}}},
        {"actions", json::array()}, {"strategy_recommendation", json::object()},
        {"diagnostics", json::object()},
        {"error", {{"code", "bad_request"}, {"message", message}}},
    }.dump();
}

std::expected<json, std::string> parse_request(const std::string& src) {
    try {
        return json::parse(src);
    } catch (...) {
        return std::unexpected(err_response("no-trace", "invalid_json"));
    }
}

std::expected<void, std::string> require_fields(
    const json& j,
    const std::string& trace_id,
    std::initializer_list<std::string_view> keys,
    std::string_view error_code
) {
    const bool ok = std::ranges::all_of(keys, [&](std::string_view key) {
        return j.contains(std::string(key));
    });
    if (!ok) {
        return std::unexpected(err_response(trace_id, std::string(error_code)));
    }
    return {};
}

struct RequestContext {
    json body;
    std::string trace_id;
};

std::expected<RequestContext, std::string> prepare_request(
    const std::string& src,
    std::initializer_list<std::string_view> required = {},
    std::string_view missing_error = ""
) {
    auto parsed = parse_request(src);
    if (!parsed) return std::unexpected(parsed.error());
    RequestContext ctx{std::move(parsed.value()), "no-trace"};
    ctx.trace_id = jv<std::string>(ctx.body, "trace_id", "no-trace");
    if (!required.size()) return ctx;
    auto check = require_fields(ctx.body, ctx.trace_id, required, missing_error);
    if (!check) return std::unexpected(check.error());
    return ctx;
}

PricingParams parse_pricing_params(const json& j) {
    return PricingParams{
        jv<double>(j, "spot", 0.0), jv<double>(j, "strike", 0.0), jv<double>(j, "rate", 0.0),
        jv<double>(j, "vol", 0.0), jv<double>(j, "maturity", 0.0), jv<double>(j, "dividend_yield", 0.0),
        jv<int>(j, "n_paths", 10000), jv<int>(j, "n_steps", 0), jv<bool>(j, "is_american", false),
        jv<bool>(j, "fx_mode", false), jv<std::string>(j, "product_type", "european_call"),
        jv<std::string>(j, "numeraire", "money_market")
    };
}

BatchGridParams parse_batch_grid_params(const json& j) {
    return BatchGridParams{
        parse_pricing_params(j),
        jv<int>(j, "n_jobs", 16),
        jv<double>(j, "spot_shock", 0.02)
    };
}

HedgingParams parse_hedging_params(const json& j) {
    return HedgingParams{
        jv<double>(j, "spot", 0.0), jv<double>(j, "strike", 0.0), jv<double>(j, "rate", 0.0),
        jv<double>(j, "vol", 0.0), jv<double>(j, "maturity", 0.0), jv<int>(j, "n_rebalances", 52),
        jv<int>(j, "n_paths", 2000), jv<int>(j, "n_bins", 40), jv<double>(j, "transaction_cost_bps", 5.0),
        jv<double>(j, "rebalance_threshold", 0.02), jv<double>(j, "vol_mismatch_mult", 1.15)
    };
}

ScenarioParams parse_scenario_params(const json& j) {
    return ScenarioParams{
        jv<double>(j, "spot", 0.0), jv<double>(j, "strike", 0.0), jv<double>(j, "rate", 0.0),
        jv<double>(j, "vol", 0.0), jv<double>(j, "maturity", 0.0), jv<double>(j, "dividend_yield", 0.0)
    };
}

ValidationParams parse_validation_params(const json& j) {
    return ValidationParams{
        jv<double>(j, "spot", 0.0), jv<double>(j, "strike", 0.0), jv<double>(j, "rate", 0.0),
        jv<double>(j, "vol", 0.0), jv<double>(j, "maturity", 0.0), jv<double>(j, "mu", 0.0),
        jv<bool>(j, "pick_stats", false), jv<bool>(j, "pick_ito", false), jv<bool>(j, "pick_simulation", false),
        jv<bool>(j, "compute_block_on_validation", false), jv<double>(j, "stats_theta", 1.0), jv<int>(j, "stats_n", 10000),
        jv<double>(j, "ito_theta", 0.7), jv<double>(j, "ito_t", 1.0), jv<int>(j, "ito_n", 2000),
        jv<std::string>(j, "ito_function_type", "exp_martingale"), jv<int>(j, "sim_steps", 100),
        jv<int>(j, "n_rebalances", 52), jv<int>(j, "hedge_paths", 500)
    };
}

SimulationParams parse_simulation_params(const json& j) {
    return SimulationParams{
        jv<std::string>(j, "model", "gbm"), jv<int>(j, "n_steps", 100), jv<double>(j, "dt", 0.01),
        jv<double>(j, "sigma", 0.2), jv<double>(j, "kappa", 1.2), jv<double>(j, "theta", 0.03), jv<double>(j, "x0", 1.0)
    };
}

StatsParams parse_stats_params(const json& j) {
    return StatsParams{
        jv<double>(j, "mu", 0.0), jv<double>(j, "sigma", 1.0), jv<double>(j, "theta", 1.0), jv<int>(j, "sample_size", 10000)
    };
}

ItoParams parse_ito_params(const json& j) {
    return ItoParams{
        jv<std::string>(j, "function_type", "exp_martingale"), jv<double>(j, "theta", 0.7),
        jv<double>(j, "t", 1.0), jv<int>(j, "n_steps", 2000)
    };
}

MeasureDensityParams parse_measure_density_params(const json& j) {
    return MeasureDensityParams{
        jv<double>(j, "mu", 0.05), jv<double>(j, "r", 0.02), jv<double>(j, "sigma", 0.2),
        jv<double>(j, "t", 1.0), jv<int>(j, "n_steps", 100)
    };
}

MeasureCompareParams parse_measure_compare_params(const json& j) {
    return MeasureCompareParams{
        jv<double>(j, "mu", 0.05), jv<double>(j, "r", 0.02), jv<double>(j, "sigma", 0.2), jv<double>(j, "t", 1.0),
        jv<int>(j, "n_steps", 100), jv<int>(j, "n_paths", 1000), jv<double>(j, "x0", 1.0), jv<int>(j, "preview_len", 50)
    };
}

PdeParams parse_pde_params(const json& j) {
    return PdeParams{
        jv<double>(j, "spot", 0.0), jv<double>(j, "strike", 0.0), jv<double>(j, "rate", 0.0),
        jv<double>(j, "vol", 0.0), jv<double>(j, "maturity", 1.0), jv<double>(j, "dividend_yield", 0.0),
        jv<int>(j, "s_steps", 100), jv<int>(j, "t_steps", 100), jv<std::string>(j, "method", "crank_nicolson")
    };
}

// ── Serializers ───────────────────────────────────────────────────────────────

std::string ser_pricing(const std::string& tid, const PricingResult& r, double ms) {
    json summary = {
        {"mc", r.mc}, {"bs", r.bs}, {"binomial", r.binomial},
        {"mc_std_err", r.mc_std_err},
        {"mc_ci_low",  r.mc - kZ95 * r.mc_std_err},
        {"mc_ci_high", r.mc + kZ95 * r.mc_std_err},
        {"american",   r.has_american ? json(r.american) : json(nullptr)},
        {"method_spread", r.spread}, {"relative_spread", r.rel_spread},
        {"pricing_stability", r.stability}, {"numeraire", r.numeraire},
        {"greeks", {{"delta_bs", r.delta_bs}, {"vega_bs", r.vega_bs}}},
        {"error_decomposition", {{"mc_minus_bs", r.mc_minus_bs},
                                  {"binomial_minus_bs", r.binomial_minus_bs}}},
        {"abs_mc_bs", std::abs(r.mc_minus_bs)},
        {"abs_binomial_bs", std::abs(r.binomial_minus_bs)},
    };
    json j = base_envelope(tid);
    j["input_params"]   = {{"spot",r.in_spot},{"strike",r.in_strike},{"vol",r.in_vol},
                            {"maturity",r.in_maturity},{"rate",r.in_rate},{"n_paths",r.in_n_paths}};
    j["summary"] = j["result_summary"] = summary;
    j["details"]  = j["result_details"] = json::object();
    j["diagnostics"] = diag_block(ms, "pricing");
    return j.dump();
}

std::string ser_batch(const std::string& tid, const PricingBatchResult& r) {
    json flat = json::array();
    for (int i = 0; i < (int)r.rows.size(); ++i) {
        const auto& row = r.rows[i];
        flat.push_back({{"#",i},{"spot",row.spot},{"strike",row.strike},{"vol",row.vol},
                         {"bs",row.bs},{"mc",row.mc},{"binomial",row.binomial},
                         {"mc-bs",row.mc-row.bs},{"bin-bs",row.binomial-row.bs},{"spread",row.spread}});
    }
    json msummary = json::array();
    for (const auto& m : r.method_summary)
        msummary.push_back({{"method",m.method},{"avg",m.avg},{"min",m.min},
                             {"max",m.max},{"std",m.std},{"avg_err_vs_bs",m.avg_err_vs_bs}});
    json summary = {
        {"job_count",r.job_count},{"total_compute_ms",r.runtime_ms},
        {"avg_method_spread",r.avg_spread},{"p50_method_spread",r.p50_spread},
        {"p95_method_spread",r.p95_spread},{"max_method_spread",r.max_spread},
        {"min_method_spread",r.min_spread},
        {"avg_runtime_per_job_ms", r.job_count>0 ? r.runtime_ms/r.job_count : 0.0},
        {"worst_spread_job_index",r.worst_idx},{"best_spread_job_index",r.best_idx},
        {"spread_std",r.spread_std},{"spread_cv",r.spread_cv},
    };
    json details = {{"flat_rows",flat},{"method_summary",msummary}};
    json j = base_envelope(tid);
    j["summary"] = j["result_summary"] = summary;
    j["details"]  = j["result_details"] = details;
    j["diagnostics"] = diag_block(r.runtime_ms, "pricing_batch");
    return j.dump();
}

std::string ser_scenario(const std::string& tid, const ScenarioResult& r, double ms) {
    json rows = json::array(), tornado = json::array();
    for (const auto& row : r.rows) {
        rows.push_back({{"rank",row.rank},{"scenario",row.name},{"base_price",r.base_price},
                         {"bs_price",row.bs_price},{"vs_base_diff",row.vs_base_diff},
                         {"abs_vs_base_diff",row.abs_diff},
                         {"vs_base_pct", row.has_pct ? json(row.vs_base_pct) : json(nullptr)},
                         {"vs_base_bps", row.has_pct ? json(row.vs_base_bps) : json(nullptr)}});
        if (row.name != "base")
            tornado.push_back({{"label",row.name},{"value",row.vs_base_diff}});
    }
    json summary = {{"base_price",r.base_price},{"max_price",r.max_price},{"min_price",r.min_price},
                     {"price_range",r.max_price-r.min_price},{"scenario_count",(int)r.rows.size()}};
    json details = {{"rows",rows},{"tornado_points",tornado}};
    json j = base_envelope(tid);
    j["summary"] = j["result_summary"] = summary;
    j["details"]  = j["result_details"] = details;
    j["diagnostics"] = diag_block(ms, "scenario");
    return j.dump();
}

std::string ser_hedging(const std::string& tid, const HedgingResult& r, double ms) {
    json sc = json::object();
    const StrategyStats* best = nullptr;
    for (const auto& s : r.strategies) {
        sc[s.name] = {{"mean",s.mean},{"std",s.std},{"q05",s.q05},{"q50",s.q50},{"q95",s.q95},
                       {"turnover",s.turnover},{"transaction_cost",s.transaction_cost},
                       {"var95",s.var95},{"es95",s.es95}};
        if (s.name == r.best_strategy) best = &s;
    }
    if (!best && !r.strategies.empty()) best = &r.strategies[0];
    auto best_j = [&]() -> json {
        return best ? json{{"name",best->name},{"reason","min_es95_then_std_then_mean"},
                           {"es95",best->es95},{"std",best->std},{"mean",best->mean}}
                    : json::object();
    };
    json summary = {
        {"strategy","delta_hedge"},{"n_rebalances",r.n_rebalances},{"n_paths",r.n_paths},
        {"pnl_mean",r.pnl_mean},{"pnl_std",r.pnl_std},
        {"pnl_q05",r.pnl_q05},{"pnl_q50",r.pnl_q50},{"pnl_q95",r.pnl_q95},
        {"normalized_std",r.normalized_std},{"tail_span",r.tail_span},
        {"left_tail",r.left_tail},{"right_tail",r.right_tail},
        {"tail_skew_proxy",r.tail_skew_proxy},{"tail_ratio_q95_q05",r.tail_ratio_q95_q05},
        {"scaling_proxy_std_sqrt_n",r.scaling_proxy_std_sqrt_n},{"best_strategy",r.best_strategy},
    };
    json details = {
        {"histogram",{{"edges",r.histogram.edges},{"counts",r.histogram.counts}}},
        {"strategy_compare",sc}, {"best_strategy",best_j()},
        {"compare_config",{{"transaction_cost_bps",r.compare_tc_bps},
                            {"rebalance_threshold",r.compare_threshold},
                            {"vol_mismatch_mult",r.compare_vol_mismatch_mult}}},
    };
    json j = base_envelope(tid);
    j["summary"] = j["result_summary"] = summary;
    j["details"]  = j["result_details"] = details;
    j["strategy_recommendation"] = best ? json{{"name",best->name},
        {"reason","min_es95_then_std_then_mean"},
        {"metrics",{{"es95",best->es95},{"std",best->std},{"mean",best->mean}}}}
        : json::object();
    j["diagnostics"] = diag_block(ms, "hedging");
    return j.dump();
}

std::string ser_validation(const std::string& tid, const ValidationResult& r, double ms) {
    json rows = json::array();
    for (const auto& row : r.rows)
        rows.push_back({{"capability",row.capability},{"metric",row.metric},
                         {"value",row.value},{"threshold",row.threshold},{"excess",row.excess},
                         {"status",row.status},{"interpretation",row.interpretation},{"action",row.action}});
    json summary = {{"validation_mode",r.mode},{"gate_decision",r.gate_decision},
                     {"checks_total",r.checks_total},{"checks_failed",r.checks_failed},
                     {"fail_rate",r.fail_rate},{"failed_by_capability",json::object()},
                     {"max_excess",r.max_excess},{"max_excess_item",r.max_excess_item}};
    json details = {{"rows",rows},{"threshold_rows",rows}};
    json j = base_envelope(tid,
        r.gate_decision == "go" ? "go" : "warn",
        r.checks_failed > 0 ? "medium" : "info");
    j["summary"] = j["result_summary"] = summary;
    j["details"]  = j["result_details"] = details;
    j["validation"] = {{"checks_total",r.checks_total},{"checks_failed",r.checks_failed},
                        {"failed_items",json::array()},{"failed_by_capability",json::object()}};
    j["diagnostics"] = diag_block(ms, "validation_gate");
    return j.dump();
}

}  // namespace

// ── Public endpoint functions (called from c_api.cpp) ────────────────────────

std::string run_pricing_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src, {"spot", "strike", "rate", "vol", "maturity"},
                                     "missing_required_pricing_fields");
    if (!ctx) return ctx.error();
    return ser_pricing(ctx->trace_id, run_pricing(parse_pricing_params(ctx->body)), elapsed_ms(t0_ms));
}

std::string run_pricing_batch_grid_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src, {"spot", "strike", "rate", "vol", "maturity"},
                                     "missing_required_pricing_batch_fields");
    if (!ctx) return ctx.error();
    return ser_batch(ctx->trace_id, run_pricing_batch_grid(parse_batch_grid_params(ctx->body), elapsed_ms(t0_ms)));
}

std::string run_pricing_batch_json(const std::string& src, double t0_ms) {
    const auto req = parse_request(src);
    if (!req) return req.error();
    const auto& j = req.value();
    const std::string tid = jv<std::string>(j,"trace_id","no-trace");
    int n = std::max(1, std::min(jv<int>(j,"n_jobs",0), 500));
    if (n == 0) return err_response(tid, "missing_required_pricing_batch_fields");
    std::vector<PricingParams> jobs(n);
    for (int i = 0; i < n; ++i) {
        const std::string idx = std::to_string(i);
        auto get = [&](const std::string& f) {
            const std::string k = "job_"+idx+"_"+f;
            return j.contains(k) ? j[k].get<double>() : 0.0;
        };
        jobs[i] = {get("spot"),get("strike"),get("rate"),get("vol"),get("maturity"),
                   get("dividend_yield"), jv<int>(j,"job_"+idx+"_n_paths",10000)};
        if (jobs[i].spot==0.0||jobs[i].strike==0.0)
            return err_response(tid, "missing_required_pricing_batch_fields");
    }
    return ser_batch(tid, run_pricing_batch(jobs, elapsed_ms(t0_ms)));
}

std::string run_hedging_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src, {"spot", "strike", "rate", "vol", "maturity"},
                                     "missing_required_hedging_fields");
    if (!ctx) return ctx.error();
    return ser_hedging(ctx->trace_id, run_hedging(parse_hedging_params(ctx->body)), elapsed_ms(t0_ms));
}

std::string run_scenario_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src, {"spot", "strike", "rate", "vol", "maturity"},
                                     "missing_required_scenario_fields");
    if (!ctx) return ctx.error();
    return ser_scenario(ctx->trace_id, run_scenario(parse_scenario_params(ctx->body)), elapsed_ms(t0_ms));
}

std::string run_validation_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src, {"spot", "strike", "rate", "vol", "maturity"},
                                     "missing_required_validation_fields");
    if (!ctx) return ctx.error();
    return ser_validation(ctx->trace_id, run_validation(parse_validation_params(ctx->body)), elapsed_ms(t0_ms));
}

std::string run_simulation_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src);
    if (!ctx) return ctx.error();
    const auto r = run_simulation(parse_simulation_params(ctx->body));
    double x_min = r.values.empty() ? 0.0 : *std::ranges::min_element(r.values);
    double x_max = r.values.empty() ? 0.0 : *std::ranges::max_element(r.values);
    const int stride = (int)r.values.size() > kSimulationPreviewCap
        ? (int)r.values.size() / kSimulationPreviewCap : 1;
    json preview = json::array();
    for (size_t i = 0; i < r.values.size(); i += stride) preview.push_back(r.values[i]);
    json jj = base_envelope(ctx->trace_id);
    jj["result_summary"] = {{"model",r.model},{"n_steps",r.n_steps},
                              {"x_final",r.values.empty()?0.0:r.values.back()},
                              {"x_min",x_min},{"x_max",x_max},{"length",(int)r.values.size()}};
    jj["result_details"] = {{"values_preview",preview}};
    jj["diagnostics"]    = diag_block(elapsed_ms(t0_ms), "simulation");
    return jj.dump();
}

std::string run_stats_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src);
    if (!ctx) return ctx.error();
    const auto r = run_stats(parse_stats_params(ctx->body));
    json jj = base_envelope(ctx->trace_id);
    jj["result_summary"] = {{"mgf",r.mgf},{"mean",r.mean},{"variance",r.variance}};
    jj["diagnostics"]    = diag_block(elapsed_ms(t0_ms), "stats");
    return jj.dump();
}

std::string run_ito_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src);
    if (!ctx) return ctx.error();
    const auto r = run_ito(parse_ito_params(ctx->body));
    json jj = base_envelope(ctx->trace_id);
    jj["result_summary"] = {{"function_type",r.function_type},{"value",r.value},
                              {"target_expectation",r.target}};
    jj["diagnostics"] = diag_block(elapsed_ms(t0_ms), "ito_check");
    return jj.dump();
}

std::string run_measure_density_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src);
    if (!ctx) return ctx.error();
    const auto r = run_measure_density(parse_measure_density_params(ctx->body));
    json jj = base_envelope(ctx->trace_id);
    jj["result_summary"] = {{"final_density", r.density.empty()?1.0:r.density.back()},
                              {"length",(int)r.density.size()}};
    jj["result_details"] = {{"density", r.density}};
    jj["diagnostics"]    = diag_block(elapsed_ms(t0_ms), "measure_density");
    return jj.dump();
}

std::string run_measure_compare_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src);
    if (!ctx) return ctx.error();
    const auto r = run_measure_compare(parse_measure_compare_params(ctx->body));
    json jj = base_envelope(ctx->trace_id);
    jj["result_summary"] = {
        {"p_stats",{{"mean",r.p_mean},{"variance",r.p_var},{"q05",r.p_q05},{"q50",r.p_q50},{"q95",r.p_q95}}},
        {"q_stats",{{"mean",r.q_mean},{"variance",r.q_var},{"q05",r.q_q05},{"q50",r.q_q50},{"q95",r.q_q95}}},
    };
    jj["result_details"] = {{"path_preview",{{"P",r.preview_p},{"Q",r.preview_q}}}};
    jj["diagnostics"]    = diag_block(elapsed_ms(t0_ms), "measure_compare");
    return jj.dump();
}

std::string run_pde_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src, {"spot", "strike", "rate", "vol", "maturity"},
                                     "missing_required_pde_fields");
    if (!ctx) return ctx.error();
    const auto r = run_pde(parse_pde_params(ctx->body));
    json jj = base_envelope(ctx->trace_id);
    jj["result_summary"] = {{"price",r.price},{"method",r.method},
                              {"s_steps",r.s_steps},{"t_steps",r.t_steps}};
    jj["diagnostics"] = diag_block(elapsed_ms(t0_ms), "pde");
    return jj.dump();
}

std::string run_vol_surface_json(const std::string& src, double t0_ms) {
    const auto ctx = prepare_request(src, {"spot", "target_strike", "target_expiry"},
                                     "missing_required_vol_surface_fields");
    if (!ctx) return ctx.error();
    const auto& j = ctx->body;
    for (std::string_view key : {"strikes", "expiries", "ivs"}) {
        const std::string k(key);
        if (!j.contains(k) || !j[k].is_array()) return err_response(ctx->trace_id, "missing_vol_surface_arrays");
    }
    VolSurfaceParams p;
    p.spot=jv<double>(j,"spot",0.0); p.target_strike=jv<double>(j,"target_strike",0.0);
    p.target_expiry=jv<double>(j,"target_expiry",0.0);
    p.strikes=j["strikes"].get<std::vector<double>>();
    p.expiries=j["expiries"].get<std::vector<double>>();
    p.ivs=j["ivs"].get<std::vector<double>>();
    const auto r = run_vol_surface(p);
    json jj = base_envelope(ctx->trace_id);
    jj["result_summary"] = {{"iv",r.iv},{"method",r.method},{"n_points",(int)p.strikes.size()}};
    jj["diagnostics"]    = diag_block(elapsed_ms(t0_ms), "vol_surface");
    return jj.dump();
}

}  // namespace sf
