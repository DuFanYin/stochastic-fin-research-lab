#pragma once

namespace sf {

double delta_hedge_error_estimate(int n_rebalances);
double run_backtest_placeholder(int n_rebalances);
void delta_hedge_pnl_distribution(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, double* out_stats
);
void delta_hedge_pnl_histogram(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, int n_bins,
    double* out_stats,
    double* out_edges,
    double* out_counts
);
void delta_hedge_strategy_compare(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths,
    double transaction_cost_bps,
    double rebalance_threshold,
    double vol_mismatch_mult,
    double* out_stats_36
);

}  // namespace sf
