#include "c_api.h"
#include "engine.hpp"
#ifdef _OPENMP
#include <omp.h>
#endif

extern "C" {

double sf_mc_price(double spot, double strike, int n_paths) {
    return sf::mc_price(spot, strike, n_paths);
}

double sf_mc_price_full(double spot, double strike, double rate, double vol, double maturity, int n_paths) {
    return sf::mc_price_full(spot, strike, rate, vol, maturity, n_paths);
}

double sf_mc_price_with_stderr(double spot, double strike, double rate, double vol, double maturity, int n_paths, double* out_stderr) {
    return sf::mc_price_with_stderr(spot, strike, rate, vol, maturity, n_paths, out_stderr);
}

double sf_bs_price(double spot, double strike, double rate, double vol, double maturity) {
    return sf::bs_closed_form_price(spot, strike, rate, vol, maturity);
}

double sf_binomial_price(double spot, double strike, double rate, double vol, double maturity, int steps) {
    return sf::binomial_price(spot, strike, rate, vol, maturity, steps);
}

double sf_binomial_american_price(double spot, double strike, double rate, double vol, double maturity, int steps, double dividend_yield) {
    return sf::binomial_american_price(spot, strike, rate, vol, maturity, steps, dividend_yield);
}

double sf_digital_call_bs(double spot, double strike, double rate, double vol, double maturity, double dividend_yield) {
    return sf::digital_call_bs_price(spot, strike, rate, vol, maturity, dividend_yield);
}

void sf_delta_hedge_pnl_distribution(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, double* out_stats
) {
    sf::delta_hedge_pnl_distribution(spot, strike, rate, vol, maturity, n_rebalances, n_paths, out_stats);
}

void sf_delta_hedge_pnl_histogram(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, int n_bins,
    double* out_stats,
    double* out_edges,
    double* out_counts
) {
    sf::delta_hedge_pnl_histogram(
        spot, strike, rate, vol, maturity,
        n_rebalances, n_paths, n_bins,
        out_stats, out_edges, out_counts
    );
}

void sf_delta_hedge_strategy_compare(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths,
    double transaction_cost_bps,
    double rebalance_threshold,
    double vol_mismatch_mult,
    double* out_stats_36
) {
    sf::delta_hedge_strategy_compare(
        spot, strike, rate, vol, maturity, n_rebalances, n_paths,
        transaction_cost_bps, rebalance_threshold, vol_mismatch_mult,
        out_stats_36
    );
}

double sf_delta_hedge_error(int n_rebalances) {
    return sf::delta_hedge_error_estimate(n_rebalances);
}

double sf_delta_hedge_pnl_std(double spot, double vol, double maturity, int n_rebalances) {
    const double base = sf::delta_hedge_error_estimate(n_rebalances);
    const double scale = std::max(spot, 1.0) * std::max(vol, 0.01) * std::sqrt(sf::clamp_positive(maturity));
    return base * scale;
}

void sf_pricing_greeks(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double* out_delta_bs,
    double* out_vega_bs
) {
    sf::pricing_greeks(spot, strike, rate, vol, maturity, out_delta_bs, out_vega_bs);
}

void sf_pricing_error_decomp(
    double mc,
    double bs,
    double binomial,
    double* out_mc_minus_bs,
    double* out_binomial_minus_bs
) {
    sf::pricing_error_decomp(mc, bs, binomial, out_mc_minus_bs, out_binomial_minus_bs);
}

void sf_scenario_bs5(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double dividend_yield,
    double* out_prices_5
) {
    sf::scenario_bs5(spot, strike, rate, vol, maturity, dividend_yield, out_prices_5);
}

void sf_stats_normal(
    double mu,
    double sigma,
    double theta,
    int sample_size,
    double* out_mgf,
    double* out_mean,
    double* out_variance
) {
    sf::stats_normal_component(mu, sigma, theta, sample_size, out_mgf, out_mean, out_variance);
}

void sf_ito_check(
    int function_code,
    double theta,
    double t,
    int n_steps,
    double* out_value,
    double* out_target
) {
    sf::ito_check_component(function_code, theta, t, n_steps, out_value, out_target);
}

int sf_simulation_path(
    int model_code,
    int n_steps,
    double dt,
    double sigma,
    double kappa,
    double theta,
    double x0,
    double* out_values
) {
    return sf::simulation_path_component(
        model_code, n_steps, dt, sigma, kappa, theta, x0, out_values
    );
}

int sf_measure_density_path(
    double mu,
    double r,
    double sigma,
    double t,
    int n_steps,
    double* out_values
) {
    return sf::measure_density_path_component(mu, r, sigma, t, n_steps, out_values);
}

void sf_set_num_threads(int n_threads) {
#ifdef _OPENMP
    omp_set_num_threads(std::max(1, n_threads));
#else
    (void)n_threads;
#endif
}

int sf_get_max_threads(void) {
#ifdef _OPENMP
    return omp_get_max_threads();
#else
    return 1;
#endif
}

/* ── PDE solver (Crank-Nicolson / fully-implicit) ─────────────────────────── */

double sf_pde_price(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double dividend_yield,
    int    s_steps,
    int    t_steps,
    int    method
) {
    return sf::pde_price_component(
        spot, strike, rate, vol, maturity, dividend_yield, s_steps, t_steps, method
    );
}

/* ── P-vs-Q measure comparison ───────────────────────────────────────────── */

int sf_measure_compare(
    double  mu,
    double  r,
    double  sigma,
    double  t,
    int     n_steps,
    int     n_paths,
    double  x0,
    double* out_stats_10,
    double* out_preview,
    int     preview_len
) {
    return sf::measure_compare_component(
        mu, r, sigma, t, n_steps, n_paths, x0, out_stats_10, out_preview, preview_len
    );
}

/* ── Vol surface interpolation ───────────────────────────────────────────── */

double sf_vol_surface_interp(
    const double* strikes,
    const double* expiries,
    const double* ivs,
    int           n_points,
    double        spot,
    double        target_strike,
    double        target_expiry
) {
    return sf::vol_surface_interp_component(
        strikes, expiries, ivs, n_points, spot, target_strike, target_expiry
    );
}

/* ── Batch pricing ───────────────────────────────────────────────────────── */

void sf_pricing_batch(
    int           n_jobs,
    const double* spots,
    const double* strikes,
    const double* rates,
    const double* vols,
    const double* maturities,
    const int*    n_paths_arr,
    const double* div_yields,
    double*       out_mc,
    double*       out_bs,
    double*       out_binomial
) {
    sf::pricing_batch_component(
        n_jobs, spots, strikes, rates, vols, maturities, n_paths_arr, div_yields, out_mc, out_bs, out_binomial
    );
}

}

