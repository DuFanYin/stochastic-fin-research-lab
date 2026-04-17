#include "../kernel.h"

#include <algorithm>
#include <cmath>
#include <omp.h>

namespace sf {

void pricing_greeks(
    double spot, double strike, double rate, double vol, double maturity,
    double* out_delta_bs, double* out_vega_bs
) {
    if (!out_delta_bs || !out_vega_bs) return;
    const double s = clamp_positive(spot);
    const double k = clamp_positive(strike);
    const double t = clamp_positive(maturity);
    const double v = clamp_positive(vol);
    const double sqrt_t = std::sqrt(t);
    const double d1 = (std::log(s / k) + (rate + 0.5 * v * v) * t) / (v * sqrt_t);
    *out_delta_bs = bs_delta(s, k, rate, v, t);
    *out_vega_bs  = s * norm_pdf(d1) * sqrt_t;
}

void pricing_error_decomp(
    double mc, double bs, double binomial,
    double* out_mc_minus_bs, double* out_binomial_minus_bs
) {
    if (out_mc_minus_bs)       *out_mc_minus_bs       = mc - bs;
    if (out_binomial_minus_bs) *out_binomial_minus_bs = binomial - bs;
}

void scenario_bs5(
    double spot, double strike, double rate, double vol,
    double maturity, double dividend_yield, double* out_prices_5
) {
    if (!out_prices_5) return;
    const double shock_spot[5]  = {1.0, 1.1, 0.9, 1.0, 1.0};
    const double shock_vol[5]   = {0.0, 0.0, 0.0, 0.05, 0.0};
    const double shock_rate[5]  = {0.0, 0.0, 0.0, 0.0, 0.01};
    for (int i = 0; i < 5; ++i) {
        const double s    = spot * shock_spot[i];
        const double v    = std::max(0.0001, vol + shock_vol[i]);
        const double r_eff = rate + shock_rate[i] - dividend_yield;
        out_prices_5[i] = bs_closed_form_price(s, strike, r_eff, v, maturity);
    }
}

void pricing_batch(
    std::span<const double> spots,
    std::span<const double> strikes,
    std::span<const double> rates,
    std::span<const double> vols,
    std::span<const double> maturities,
    std::span<const int> n_paths_arr,
    std::span<const double> div_yields,
    std::span<double> out_mc,
    std::span<double> out_bs,
    std::span<double> out_binomial
) {
    const size_t n_jobs = spots.size();
    if (n_jobs == 0) return;
    if (strikes.size() != n_jobs || rates.size() != n_jobs || vols.size() != n_jobs ||
        maturities.size() != n_jobs || n_paths_arr.size() != n_jobs || div_yields.size() != n_jobs ||
        out_mc.size() != n_jobs || out_bs.size() != n_jobs || out_binomial.size() != n_jobs) return;

#pragma omp parallel for schedule(dynamic)
    for (int i = 0; i < static_cast<int>(n_jobs); ++i) {
        const double r_eff = rates[i] - div_yields[i];
        const int    steps = std::max(10, static_cast<int>(maturities[i] * 250));
        out_mc[i]       = mc_price_full(spots[i], strikes[i], r_eff, vols[i], maturities[i], n_paths_arr[i]);
        out_bs[i]       = bs_closed_form_price(spots[i], strikes[i], r_eff, vols[i], maturities[i]);
        out_binomial[i] = binomial_price(spots[i], strikes[i], r_eff, vols[i], maturities[i], steps);
    }
}

}  // namespace sf
