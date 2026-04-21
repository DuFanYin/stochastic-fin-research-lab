#include "engine.h"
#include "kernel/kernel.h"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace sf {

ImpliedVolResult run_implied_vol(const ImpliedVolParams& p) {
    ImpliedVolResult r;
    const double iv = bs_implied_vol(
        p.market_price, p.spot, p.strike, p.rate, p.maturity, p.dividend_yield);
    r.implied_vol = iv;
    r.converged   = (iv > 0.0);
    if (r.converged) {
        const double r_eff = p.rate - p.dividend_yield;
        const double bs = bs_closed_form_price(p.spot, p.strike, r_eff, iv, p.maturity);
        r.final_error = std::abs(bs - p.market_price);
    }
    return r;
}

ImpliedVolBatchResult run_implied_vol_batch(const ImpliedVolBatchParams& p) {
    const int n = static_cast<int>(p.market_prices.size());
    ImpliedVolBatchResult r;
    r.ivs.resize(n);
    r.converged.resize(n);
    implied_vol_batch(
        std::span<const double>(p.market_prices),
        std::span<const double>(p.strikes),
        std::span<const double>(p.expiries),
        p.spot, p.rate, p.dividend_yield,
        std::span<double>(r.ivs),
        std::span<uint8_t>(r.converged)
    );
    r.n_converged = static_cast<int>(
        std::count(r.converged.begin(), r.converged.end(), true));
    return r;
}

HestonCalibrationResult run_heston_calibrate(const HestonCalibrationParams& p) {
    const int n = static_cast<int>(p.market_prices.size());
    HestonCalibrationResult r;
    if (n == 0) return r;

    // Objective: RMSE between Heston model prices and market prices
    auto objective = [&](std::span<const double> params) -> double {
        const double v0    = params[0];
        const double kappa = params[1];
        const double theta = params[2];
        const double xi    = params[3];
        const double rho   = params[4];
        double sse = 0.0;
        for (int i = 0; i < n; ++i) {
            const double model_price = heston_call_price(
                p.spot, p.market_strikes[i], p.rate, p.market_maturities[i],
                v0, kappa, theta, xi, rho);
            const double err = model_price - p.market_prices[i];
            sse += err * err;
        }
        return sse / n;
    };

    const std::vector<double> x0    = {p.init_v0, p.init_kappa, p.init_theta, p.init_xi, p.init_rho};
    const std::vector<double> lower = {1e-4, 1e-3, 1e-4, 1e-4, -0.999};
    const std::vector<double> upper = {2.0,  20.0,  2.0,  3.0,  0.999};

    const auto opt = nelder_mead(objective,
        std::span<const double>(x0),
        std::span<const double>(lower),
        std::span<const double>(upper),
        1e-8, p.max_iter);

    if (!opt.x.empty() && opt.x.size() == 5) {
        r.v0    = opt.x[0];
        r.kappa = opt.x[1];
        r.theta = opt.x[2];
        r.xi    = opt.x[3];
        r.rho   = opt.x[4];
    }
    r.iterations = opt.iterations;
    r.converged  = opt.converged;

    // Compute residuals and diagnostics
    r.model_prices.resize(n);
    r.residuals.resize(n);
    double max_err = 0.0;
    for (int i = 0; i < n; ++i) {
        r.model_prices[i] = heston_call_price(
            p.spot, p.market_strikes[i], p.rate, p.market_maturities[i],
            r.v0, r.kappa, r.theta, r.xi, r.rho);
        r.residuals[i] = r.model_prices[i] - p.market_prices[i];
        max_err = std::max(max_err, std::abs(r.residuals[i]));
    }
    const double mse = std::accumulate(r.residuals.begin(), r.residuals.end(), 0.0,
        [](double acc, double e) { return acc + e * e; }) / n;
    r.rmse          = std::sqrt(mse);
    r.max_abs_error = max_err;
    return r;
}

double run_heston_price(const HestonPriceParams& p) {
    return heston_call_price(
        p.spot, p.strike, p.rate, p.maturity,
        p.v0, p.kappa, p.theta, p.xi, p.rho);
}

}  // namespace sf
