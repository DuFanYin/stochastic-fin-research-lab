#include "../kernel.h"
#include <cmath>
#include <random>

namespace sf {

double mc_price(double spot, double strike, int n_paths) {
    return mc_price_full(spot, strike, 0.02, 0.2, 1.0, n_paths);
}

double mc_price_full(double spot, double strike, double rate, double vol, double maturity, int n_paths) {
    if (spot <= 0.0 || strike <= 0.0 || n_paths <= 0) {
        return 0.0;
    }
    std::mt19937_64 rng(42);
    const double disc = std::exp(-rate * maturity);

    double payoff_sum = 0.0;
    double payoff_sq_sum = 0.0;
    for (int i = 0; i < n_paths; ++i) {
        const double st = simulate_terminal_price_gbm(spot, rate, vol, maturity, rng);
        const double payoff = st > strike ? (st - strike) : 0.0;
        payoff_sum    += payoff;
        payoff_sq_sum += payoff * payoff;
    }
    return disc * (payoff_sum / static_cast<double>(n_paths));
}

double mc_price_with_stderr(double spot, double strike, double rate, double vol, double maturity, int n_paths, double* out_stderr) {
    if (spot <= 0.0 || strike <= 0.0 || n_paths <= 0) {
        if (out_stderr) *out_stderr = 0.0;
        return 0.0;
    }
    std::mt19937_64 rng(42);
    const double disc = std::exp(-rate * maturity);
    const double n = static_cast<double>(n_paths);

    double payoff_sum = 0.0;
    double payoff_sq_sum = 0.0;
    for (int i = 0; i < n_paths; ++i) {
        const double st = simulate_terminal_price_gbm(spot, rate, vol, maturity, rng);
        const double payoff = st > strike ? (st - strike) : 0.0;
        payoff_sum    += payoff;
        payoff_sq_sum += payoff * payoff;
    }
    const double mean_payoff = payoff_sum / n;
    const double var_payoff  = payoff_sq_sum / n - mean_payoff * mean_payoff;
    if (out_stderr) *out_stderr = disc * std::sqrt(clamp_nonnegative(var_payoff) / n);
    return disc * mean_payoff;
}

}
