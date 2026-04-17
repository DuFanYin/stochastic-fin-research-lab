#include "engine.h"
#include "kernel/kernel.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace sf {

HedgingResult run_hedging(const HedgingParams& p) {
    const int n_bins = std::max(p.n_bins, 10);
    HedgingResult r;

    // PnL distribution histogram
    double stats[5] = {0};
    r.histogram.edges.resize(n_bins + 1, 0.0);
    r.histogram.counts.resize(n_bins, 0.0);
    delta_hedge_pnl_histogram(
        p.spot, p.strike, p.rate, p.vol, p.maturity,
        p.n_rebalances, p.n_paths, n_bins,
        stats, r.histogram.edges, r.histogram.counts
    );
    r.pnl_mean = stats[0];
    r.pnl_std  = stats[1];
    r.pnl_q05  = stats[2];
    r.pnl_q50  = stats[3];
    r.pnl_q95  = stats[4];
    r.n_rebalances = p.n_rebalances;
    r.n_paths      = p.n_paths;
    r.normalized_std   = r.pnl_std / std::max(p.spot, 1e-12);
    r.tail_span        = r.pnl_q95 - r.pnl_q05;
    r.left_tail        = r.pnl_q05 - r.pnl_mean;
    r.right_tail       = r.pnl_q95 - r.pnl_mean;
    r.tail_skew_proxy  = (std::abs(r.right_tail) + std::abs(r.left_tail)) > 1e-12
                         ? (r.right_tail + r.left_tail) / (std::abs(r.right_tail) + std::abs(r.left_tail))
                         : 0.0;
    r.tail_ratio_q95_q05 = std::abs(r.pnl_q05) > 1e-12
                           ? std::abs(r.pnl_q95 / r.pnl_q05) : 0.0;
    r.scaling_proxy_std_sqrt_n = r.pnl_std * std::sqrt(static_cast<double>(p.n_rebalances));

    // Strategy comparison
    constexpr int STRIDE = 9;
    double raw[4 * STRIDE] = {0};
    delta_hedge_strategy_compare(
        p.spot, p.strike, p.rate, p.vol, p.maturity,
        p.n_rebalances, p.n_paths,
        p.transaction_cost_bps, p.rebalance_threshold, p.vol_mismatch_mult,
        raw
    );

    static const char* labels[4] = {
        "discrete_delta", "with_transaction_cost", "threshold_rebalance", "vol_mismatch"
    };

    int best_idx = 0;
    for (int i = 1; i < 4; ++i) {
        const double* a = raw + i * STRIDE;
        const double* b = raw + best_idx * STRIDE;
        if (a[8] < b[8] || (a[8] == b[8] && (a[1] < b[1] || (a[1] == b[1] && a[0] > b[0]))))
            best_idx = i;
    }

    for (int i = 0; i < 4; ++i) {
        const double* s = raw + i * STRIDE;
        StrategyStats ss;
        ss.name             = labels[i];
        ss.mean             = s[0];
        ss.std              = s[1];
        ss.q05              = s[2];
        ss.q50              = s[3];
        ss.q95              = s[4];
        ss.turnover         = s[5];
        ss.transaction_cost = s[6];
        ss.var95            = s[7];
        ss.es95             = s[8];
        r.strategies.push_back(ss);
    }

    r.best_strategy              = labels[best_idx];
    r.compare_tc_bps             = p.transaction_cost_bps;
    r.compare_threshold          = p.rebalance_threshold;
    r.compare_vol_mismatch_mult  = p.vol_mismatch_mult;
    return r;
}

}  // namespace sf
