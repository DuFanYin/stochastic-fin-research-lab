#include "engine.h"
#include "kernel/kernel.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace sf {

namespace {

// Threshold constants
constexpr double T_MEAN_ERR_SCALE    = 0.05;
constexpr double T_VAR_ERR_SCALE     = 0.10;
constexpr double T_DENSITY_INTEGRAL  = 0.25;
constexpr double T_DENS_CV           = 2.0;
constexpr double T_DENS_TAIL         = 100.0;
constexpr double T_ITO_ERR_SCALE     = 0.15;
constexpr double T_NORM_STD          = 0.25;

ValidationRow make_row(
    const std::string& cap, const std::string& metric,
    double value, double threshold, bool passed,
    const std::string& interp, const std::string& action
) {
    ValidationRow r;
    r.capability     = cap;
    r.metric         = metric;
    r.value          = value;
    r.threshold      = threshold;
    r.excess         = value - threshold;
    r.status         = passed ? "pass" : "fail";
    r.interpretation = interp;
    r.action         = action;
    return r;
}

}  // namespace

ValidationResult run_validation(const ValidationParams& p) {
    std::vector<ValidationRow> rows;

    if (p.pick_stats) {
        double mgf = 0.0, mean = 0.0, var = 0.0;
        stats_normal(p.mu, p.vol, p.stats_theta, p.stats_n, &mgf, &mean, &var);

        const double mean_err = std::abs(mean - p.mu);
        const double mean_tol = std::max(1e-6, T_MEAN_ERR_SCALE * std::max(std::abs(p.mu), 1.0));
        rows.push_back(make_row("stats", "mean_error", mean_err, mean_tol, mean_err <= mean_tol,
            "sample mean check", "increase sample_size or lower sigma"));

        const double var_err = std::abs(var - p.vol * p.vol);
        const double var_tol = std::max(1e-6, T_VAR_ERR_SCALE * std::max(p.vol * p.vol, 1.0));
        rows.push_back(make_row("stats", "variance_error", var_err, var_tol, var_err <= var_tol,
            "sample variance check", "increase sample_size or verify sigma input"));
    }

    if (p.pick_ito) {
        const int fcode = (p.ito_function_type == "w2_minus_t") ? 1
                        : (p.ito_function_type == "w3")         ? 2 : 0;
        double val = 0.0, target = 0.0;
        ito_check(fcode, p.ito_theta, p.ito_t, p.ito_n, &val, &target);
        const double diff = std::abs(val - target);
        const double tol  = std::max(1e-3, T_ITO_ERR_SCALE * std::max(std::abs(target), 1.0));
        rows.push_back(make_row("ito", "expectation_gap", diff, tol, diff <= tol,
            "martingale expectation", "increase n_steps or use simpler function_type"));
    }

    if (p.pick_simulation) {
        // Simulation finite check
        const int sim_n = std::max(p.sim_steps, 1);
        std::vector<double> path(sim_n + 1, 0.0);
        const int len = simulation_path(0, sim_n, 0.01, p.vol, 1.2, 0.03, 0.0, path);
        const double finite = (len > 0 && std::isfinite(path[len - 1])) ? 1.0 : 0.0;
        {
            ValidationRow r;
            r.capability = "simulation"; r.metric = "terminal_finite";
            r.value = finite; r.threshold = 1.0;
            r.excess = finite - 1.0;
            r.status = finite >= 1.0 ? "pass" : "fail";
            r.interpretation = "terminal path finite check";
            r.action = "reduce dt or sigma; verify model parameters";
            rows.push_back(r);
        }

        // Hedging normalized std check
        double hstats[5] = {0};
        std::vector<double> edges(41, 0.0), counts(40, 0.0);
        delta_hedge_pnl_histogram(p.spot, p.strike, p.rate, p.vol, p.maturity,
                                  p.n_rebalances, p.hedge_paths, 40,
                                  hstats, edges, counts);
        const double norm_std = hstats[1] / std::max(p.spot, 1e-12);
        rows.push_back(make_row("hedging", "normalized_std", norm_std, T_NORM_STD, norm_std <= T_NORM_STD,
            "hedging distribution spread", "increase rebalances or reduce vol/maturity"));
    }

    // Summarize
    ValidationResult r;
    r.mode         = p.block_mode ? "blocking" : "advisory";
    r.checks_total = static_cast<int>(rows.size());
    r.rows         = rows;

    int failed = 0;
    std::string fail_parts;
    double max_viol = 0.0;
    for (const auto& row : rows) {
        if (row.status == "fail") {
            ++failed;
            if (!fail_parts.empty()) fail_parts += "; ";
            fail_parts += row.capability + "." + row.metric;
        }
        const double viol = std::max(0.0, row.value - row.threshold);
        if (viol > max_viol) {
            max_viol = viol;
            r.max_excess_item = row.capability + "." + row.metric;
        }
    }
    r.checks_failed  = failed;
    r.fail_rate      = rows.empty() ? 0.0 : static_cast<double>(failed) / rows.size();
    r.max_excess     = max_viol;
    r.blocking_reason = fail_parts.empty() ? "none" : fail_parts;

    const bool passed = (failed == 0);
    if (passed)
        r.gate_decision = "go";
    else
        r.gate_decision = p.block_mode ? "blocked" : "warning";

    return r;
}

}  // namespace sf
