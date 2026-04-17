#include "engine.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <random>
#include <vector>
#ifdef _OPENMP
#include <omp.h>
#endif

namespace sf {

namespace {
void fill_stats9(
    std::vector<double> values,
    const std::vector<double>& turnovers,
    const std::vector<double>& costs,
    double* out
) {
    if (!out) return;
    if (values.empty()) {
        for (int i = 0; i < 9; ++i) out[i] = 0.0;
        return;
    }
    std::sort(values.begin(), values.end());
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
    int n_rebalances, int n_paths, double* out_stats
) {
    if (!out_stats) return;
    const int    N   = std::max(n_rebalances, 1);
    const int    NP  = std::max(n_paths, 1);
    const double dt  = maturity / static_cast<double>(N);

    std::vector<double> pnl(NP);

#ifdef _OPENMP
    #pragma omp parallel
    {
        std::mt19937_64 rng(42 + omp_get_thread_num());
        std::normal_distribution<double> z(0.0, 1.0);
        #pragma omp for schedule(static)
        for (int k = 0; k < NP; ++k) {
#else
    {
        std::mt19937_64 rng(42);
        std::normal_distribution<double> z(0.0, 1.0);
        for (int k = 0; k < NP; ++k) {
#endif
            double s      = spot;
            double tau    = maturity;
            double delta  = bs_delta(s, strike, rate, vol, tau);
            double cash   = bs_closed_form_price(s, strike, rate, vol, tau) - delta * s;
            double shares = delta;

            for (int i = 0; i < N; ++i) {
                const double dw = std::sqrt(dt) * z(rng);
                s    *= std::exp((rate - 0.5 * vol * vol) * dt + vol * dw);
                cash *= std::exp(rate * dt);
                tau   = maturity - (i + 1) * dt;
                const double new_delta = (i < N - 1) ? bs_delta(s, strike, rate, vol, clamp_positive(tau, 1e-10)) : (s > strike ? 1.0 : 0.0);
                cash   -= (new_delta - shares) * s;
                shares  = new_delta;
            }
            const double payoff    = clamp_nonnegative(s - strike);
            const double portfolio = shares * s + cash;
            pnl[k] = payoff - portfolio;
        }
    }

    double mean = 0.0;
    for (double v : pnl) mean += v;
    mean /= NP;

    double var = 0.0;
    for (double v : pnl) var += (v - mean) * (v - mean);
    const double std_dev = std::sqrt(var / std::max(NP - 1, 1));

    std::vector<double> sorted_pnl = pnl;
    std::sort(sorted_pnl.begin(), sorted_pnl.end());

    out_stats[0] = mean;
    out_stats[1] = std_dev;
    out_stats[2] = sorted_pnl[static_cast<int>(0.05 * (NP - 1))];
    out_stats[3] = sorted_pnl[static_cast<int>(0.50 * (NP - 1))];
    out_stats[4] = sorted_pnl[static_cast<int>(0.95 * (NP - 1))];
}

void delta_hedge_pnl_histogram(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, int n_bins,
    double* out_stats,
    double* out_edges,
    double* out_counts
) {
    if (!out_stats || !out_edges || !out_counts || n_bins < 1) return;

    const int N  = std::max(n_rebalances, 1);
    const int NP = std::max(n_paths, 1);
    const double dt = maturity / static_cast<double>(N);

    std::vector<double> pnl(NP);

#ifdef _OPENMP
    #pragma omp parallel
    {
        std::mt19937_64 rng(42 + omp_get_thread_num());
        std::normal_distribution<double> z(0.0, 1.0);
        #pragma omp for schedule(static)
        for (int k = 0; k < NP; ++k) {
#else
    {
        std::mt19937_64 rng(42);
        std::normal_distribution<double> z(0.0, 1.0);
        for (int k = 0; k < NP; ++k) {
#endif
            double s      = spot;
            double tau    = maturity;
            double delta_ = bs_delta(s, strike, rate, vol, tau);
            double cash   = bs_closed_form_price(s, strike, rate, vol, tau) - delta_ * s;
            double shares = delta_;
            for (int i = 0; i < N; ++i) {
                const double dw = std::sqrt(dt) * z(rng);
                s    *= std::exp((rate - 0.5 * vol * vol) * dt + vol * dw);
                cash *= std::exp(rate * dt);
                tau   = maturity - (i + 1) * dt;
                const double nd = (i < N - 1)
                    ? bs_delta(s, strike, rate, vol, clamp_positive(tau, 1e-10))
                    : (s > strike ? 1.0 : 0.0);
                cash   -= (nd - shares) * s;
                shares  = nd;
            }
            pnl[k] = clamp_nonnegative(s - strike) - (shares * s + cash);
        }
    }

    double mean = 0.0;
    for (double v : pnl) mean += v;
    mean /= NP;
    double var = 0.0;
    for (double v : pnl) var += (v - mean) * (v - mean);
    out_stats[1] = std::sqrt(var / std::max(NP - 1, 1));
    std::vector<double> sorted_pnl = pnl;
    std::sort(sorted_pnl.begin(), sorted_pnl.end());
    out_stats[0] = mean;
    out_stats[2] = sorted_pnl[static_cast<int>(0.05 * (NP - 1))];
    out_stats[3] = sorted_pnl[static_cast<int>(0.50 * (NP - 1))];
    out_stats[4] = sorted_pnl[static_cast<int>(0.95 * (NP - 1))];

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
    double* out_stats_36
) {
    if (!out_stats_36) return;
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

#ifdef _OPENMP
    #pragma omp parallel
    {
        std::mt19937_64 rng(777 + omp_get_thread_num());
        std::normal_distribution<double> z(0.0, 1.0);
        #pragma omp for schedule(static)
        for (int k = 0; k < NP; ++k) {
#else
    {
        std::mt19937_64 rng(777);
        std::normal_distribution<double> z(0.0, 1.0);
        for (int k = 0; k < NP; ++k) {
#endif
            double s = spot;
            double tau = maturity;

            double d_base = bs_delta(s, strike, rate, vol_used, tau);
            double c_base = bs_closed_form_price(s, strike, rate, vol_used, tau) - d_base * s;
            double sh_base = d_base;
            double t_base = 0.0, fee_base = 0.0;

            double d_tc = d_base, c_tc = c_base, sh_tc = sh_base;
            double t_tc = 0.0, fee_tc = 0.0;
            double d_th = d_base, c_th = c_base, sh_th = sh_base;
            double t_th = 0.0, fee_th = 0.0;
            double d_mm = bs_delta(s, strike, rate, vol_used * vol_mismatch, tau);
            double c_mm = bs_closed_form_price(s, strike, rate, vol_used * vol_mismatch, tau) - d_mm * s;
            double sh_mm = d_mm;
            double t_mm = 0.0, fee_mm = 0.0;

            for (int i = 0; i < N; ++i) {
                const double dw = std::sqrt(dt) * z(rng);
                s *= std::exp((rate - 0.5 * vol_used * vol_used) * dt + vol_used * dw);
                tau = maturity - (i + 1) * dt;
                const double tau_eff = clamp_positive(tau, 1e-10);
                c_base *= std::exp(rate * dt);
                c_tc *= std::exp(rate * dt);
                c_th *= std::exp(rate * dt);
                c_mm *= std::exp(rate * dt);

                const double target_base = (i < N - 1) ? bs_delta(s, strike, rate, vol_used, tau_eff) : (s > strike ? 1.0 : 0.0);
                const double trade_base = target_base - sh_base;
                c_base -= trade_base * s;
                t_base += std::abs(trade_base);
                fee_base += std::abs(trade_base) * s * tc_rate;
                sh_base = target_base;

                const double target_tc = target_base;
                const double trade_tc = target_tc - sh_tc;
                c_tc -= trade_tc * s;
                c_tc -= std::abs(trade_tc) * s * tc_rate;
                t_tc += std::abs(trade_tc);
                fee_tc += std::abs(trade_tc) * s * tc_rate;
                sh_tc = target_tc;

                const double target_th = target_base;
                if (std::abs(target_th - sh_th) > threshold) {
                    const double trade_th = target_th - sh_th;
                    c_th -= trade_th * s;
                    t_th += std::abs(trade_th);
                    fee_th += std::abs(trade_th) * s * tc_rate;
                    sh_th = target_th;
                }

                const double target_mm = (i < N - 1) ? bs_delta(s, strike, rate, vol_used * vol_mismatch, tau_eff) : (s > strike ? 1.0 : 0.0);
                const double trade_mm = target_mm - sh_mm;
                c_mm -= trade_mm * s;
                t_mm += std::abs(trade_mm);
                fee_mm += std::abs(trade_mm) * s * tc_rate;
                sh_mm = target_mm;
            }

            const double payoff = clamp_nonnegative(s - strike);
            pnl_base[k] = payoff - (sh_base * s + c_base);
            pnl_tc[k] = payoff - (sh_tc * s + c_tc);
            pnl_threshold[k] = payoff - (sh_th * s + c_th);
            pnl_mismatch[k] = payoff - (sh_mm * s + c_mm);
            turnover_base[k] = t_base;
            turnover_tc[k] = t_tc;
            turnover_threshold[k] = t_th;
            turnover_mismatch[k] = t_mm;
            cost_base[k] = fee_base;
            cost_tc[k] = fee_tc;
            cost_threshold[k] = fee_th;
            cost_mismatch[k] = fee_mm;
        }
    }

    fill_stats9(std::move(pnl_base), turnover_base, cost_base, out_stats_36 + 0);
    fill_stats9(std::move(pnl_tc), turnover_tc, cost_tc, out_stats_36 + 9);
    fill_stats9(std::move(pnl_threshold), turnover_threshold, cost_threshold, out_stats_36 + 18);
    fill_stats9(std::move(pnl_mismatch), turnover_mismatch, cost_mismatch, out_stats_36 + 27);
}

}
