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

}
