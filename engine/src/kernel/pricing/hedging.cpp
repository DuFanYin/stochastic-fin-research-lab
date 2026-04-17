#include "../kernel.h"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <ranges>
#include <random>
#include <vector>
#include <omp.h>

namespace sf {

namespace {
    
std::vector<double> simulate_discrete_delta_pnl_paths(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths
) {
    const int n_steps = std::max(n_rebalances, 1);
    const int n_sim = std::max(n_paths, 1);
    const double dt = maturity / static_cast<double>(n_steps);

    std::vector<double> pnl(n_sim);
    #pragma omp parallel
    {
        std::mt19937_64 rng(42 + omp_get_thread_num());
        std::normal_distribution<double> z(0.0, 1.0);
        #pragma omp for schedule(static)
        for (int k = 0; k < n_sim; ++k) {
            double s = spot;
            double tau = maturity;
            double delta = bs_delta(s, strike, rate, vol, tau);
            double cash = bs_closed_form_price(s, strike, rate, vol, tau) - delta * s;
            double shares = delta;

            for (int i = 0; i < n_steps; ++i) {
                const double dw = std::sqrt(dt) * z(rng);
                s *= std::exp((rate - 0.5 * vol * vol) * dt + vol * dw);
                cash *= std::exp(rate * dt);
                tau = maturity - (i + 1) * dt;
                const double new_delta = (i < n_steps - 1)
                    ? bs_delta(s, strike, rate, vol, clamp_positive(tau, 1e-10))
                    : (s > strike ? 1.0 : 0.0);
                cash -= (new_delta - shares) * s;
                shares = new_delta;
            }
            const double payoff = clamp_nonnegative(s - strike);
            pnl[k] = payoff - (shares * s + cash);
        }
    }
    return pnl;
}

void write_basic_pnl_stats(const std::vector<double>& pnl, std::span<double> out_stats) {
    if (out_stats.size() < 5 || pnl.empty()) return;
    const int n = static_cast<int>(pnl.size());
    double mean = 0.0;
    for (double v : pnl) mean += v;
    mean /= n;
    double var = 0.0;
    for (double v : pnl) var += (v - mean) * (v - mean);
    std::vector<double> sorted = pnl;
    std::ranges::sort(sorted);
    out_stats[0] = mean;
    out_stats[1] = std::sqrt(var / std::max(n - 1, 1));
    out_stats[2] = sorted[static_cast<int>(0.05 * (n - 1))];
    out_stats[3] = sorted[static_cast<int>(0.50 * (n - 1))];
    out_stats[4] = sorted[static_cast<int>(0.95 * (n - 1))];
}

void fill_stats9(
    std::vector<double> values,
    const std::vector<double>& turnovers,
    const std::vector<double>& costs,
    std::span<double> out
) {
    if (out.size() < 9) return;
    if (values.empty()) {
        for (int i = 0; i < 9; ++i) out[i] = 0.0;
        return;
    }
    std::ranges::sort(values);
    const double q05 = interp_quantile_sorted(values, 0.05);
    double es95_sum = 0.0;
    int es95_count = 0;
    for (double x : values) {
        if (x <= q05) {
            es95_sum += x;
            ++es95_count;
        }
    }

    out[0] = sample_mean(values);                         // mean
    out[1] = std::sqrt(clamp_nonnegative(sample_variance(values))); // std
    out[2] = q05;                                         // q05
    out[3] = interp_quantile_sorted(values, 0.50);       // q50
    out[4] = interp_quantile_sorted(values, 0.95);       // q95
    out[5] = turnovers.empty() ? 0.0 : sample_mean(turnovers); // avg_turnover
    out[6] = costs.empty() ? 0.0 : sample_mean(costs);         // avg_transaction_cost
    out[7] = -q05;                                        // VaR95 as loss-positive
    out[8] = es95_count > 0 ? -(es95_sum / es95_count) : 0.0;  // ES95 as loss-positive
}
}

double delta_hedge_error_estimate(int n_rebalances) {
    if (n_rebalances <= 0) return 1.0;
    return 1.0 / std::sqrt(static_cast<double>(n_rebalances));
}

void delta_hedge_pnl_distribution(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, std::span<double> out_stats
) {
    if (out_stats.size() < 5) return;
    std::vector<double> pnl = simulate_discrete_delta_pnl_paths(
        spot, strike, rate, vol, maturity, n_rebalances, n_paths);
    write_basic_pnl_stats(pnl, out_stats);
}

void delta_hedge_pnl_histogram(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, int n_bins,
    std::span<double> out_stats,
    std::span<double> out_edges,
    std::span<double> out_counts
) {
    if (n_bins < 1 || out_stats.size() < 5 ||
        out_edges.size() < static_cast<size_t>(n_bins + 1) ||
        out_counts.size() < static_cast<size_t>(n_bins)) return;

    std::vector<double> pnl = simulate_discrete_delta_pnl_paths(
        spot, strike, rate, vol, maturity, n_rebalances, n_paths);
    write_basic_pnl_stats(pnl, out_stats);
    std::vector<double> sorted_pnl = pnl;
    std::ranges::sort(sorted_pnl);

    const double lo  = sorted_pnl.front();
    const double hi  = sorted_pnl.back();
    const double rng = (hi - lo > 1e-15) ? (hi - lo) : 1e-15;
    for (int b = 0; b <= n_bins; ++b) out_edges[b] = lo + (rng * b) / n_bins;
    for (int b = 0; b < n_bins; ++b) out_counts[b] = 0.0;
    for (double v : pnl) {
        int b = static_cast<int>(((v - lo) / rng) * n_bins);
        if (b >= n_bins) b = n_bins - 1;
        out_counts[b] += 1.0;
    }
}

void delta_hedge_strategy_compare(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths,
    double transaction_cost_bps,
    double rebalance_threshold,
    double vol_mismatch_mult,
    std::span<double> out_stats_36
) {
    if (out_stats_36.size() < 36) return;
    const int N = std::max(n_rebalances, 1);
    const int NP = std::max(n_paths, 1);
    const double dt = maturity / static_cast<double>(N);
    const double tc_rate = clamp_nonnegative(transaction_cost_bps) * 1e-4;
    const double threshold = clamp_nonnegative(rebalance_threshold);
    const double vol_used = clamp_positive(vol);
    const double vol_mismatch = clamp_positive(vol_mismatch_mult, 0.1);

    std::vector<double> pnl_base(NP), pnl_tc(NP), pnl_threshold(NP), pnl_mismatch(NP);
    std::vector<double> turnover_base(NP), turnover_tc(NP), turnover_threshold(NP), turnover_mismatch(NP);
    std::vector<double> cost_base(NP), cost_tc(NP), cost_threshold(NP), cost_mismatch(NP);

    #pragma omp parallel
    {
        std::mt19937_64 rng(777 + omp_get_thread_num());
        std::normal_distribution<double> z(0.0, 1.0);
        #pragma omp for schedule(static)
        for (int k = 0; k < NP; ++k) {
            double s = spot;
            double tau = maturity;

            double sh[4], cash[4], turnover[4] = {0, 0, 0, 0}, fee[4] = {0, 0, 0, 0};
            const double pv[4] = {vol_used, vol_used, vol_used, vol_used * vol_mismatch};
            const bool use_threshold[4] = {false, false, true, false};
            const double tc[4] = {0.0, tc_rate, tc_rate, tc_rate};
            for (int sidx = 0; sidx < 4; ++sidx) {
                sh[sidx] = bs_delta(s, strike, rate, pv[sidx], tau);
                cash[sidx] = bs_closed_form_price(s, strike, rate, pv[sidx], tau) - sh[sidx] * s;
            }

            for (int i = 0; i < N; ++i) {
                const double dw = std::sqrt(dt) * z(rng);
                s *= std::exp((rate - 0.5 * vol_used * vol_used) * dt + vol_used * dw);
                tau = maturity - (i + 1) * dt;
                const double tau_eff = clamp_positive(tau, 1e-10);
                const bool is_last = (i >= N - 1);
                for (int sidx = 0; sidx < 4; ++sidx) {
                    cash[sidx] *= std::exp(rate * dt);
                    const double target = is_last
                        ? (s > strike ? 1.0 : 0.0)
                        : bs_delta(s, strike, rate, pv[sidx], tau_eff);
                    const double trade = target - sh[sidx];
                    if (use_threshold[sidx] && std::abs(trade) <= threshold) continue;
                    cash[sidx] -= trade * s;
                    const double f = std::abs(trade) * s * tc[sidx];
                    cash[sidx] -= f;
                    turnover[sidx] += std::abs(trade);
                    fee[sidx] += f;
                    sh[sidx] = target;
                }
            }

            const double payoff = clamp_nonnegative(s - strike);
            pnl_base[k] = payoff - (sh[0] * s + cash[0]);
            pnl_tc[k] = payoff - (sh[1] * s + cash[1]);
            pnl_threshold[k] = payoff - (sh[2] * s + cash[2]);
            pnl_mismatch[k] = payoff - (sh[3] * s + cash[3]);
            turnover_base[k] = turnover[0];
            turnover_tc[k] = turnover[1];
            turnover_threshold[k] = turnover[2];
            turnover_mismatch[k] = turnover[3];
            cost_base[k] = fee[0];
            cost_tc[k] = fee[1];
            cost_threshold[k] = fee[2];
            cost_mismatch[k] = fee[3];
        }
    }

    fill_stats9(std::move(pnl_base), turnover_base, cost_base, out_stats_36.subspan<0, 9>());
    fill_stats9(std::move(pnl_tc), turnover_tc, cost_tc, out_stats_36.subspan<9, 9>());
    fill_stats9(std::move(pnl_threshold), turnover_threshold, cost_threshold, out_stats_36.subspan<18, 9>());
    fill_stats9(std::move(pnl_mismatch), turnover_mismatch, cost_mismatch, out_stats_36.subspan<27, 9>());
}

}
