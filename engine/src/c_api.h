#pragma once

#ifdef __cplusplus
extern "C" {
#endif

double sf_mc_price(double spot, double strike, int n_paths);
double sf_mc_price_full(double spot, double strike, double rate, double vol, double maturity, int n_paths);
double sf_mc_price_with_stderr(double spot, double strike, double rate, double vol, double maturity, int n_paths, double* out_stderr);
double sf_bs_price(double spot, double strike, double rate, double vol, double maturity);
double sf_binomial_price(double spot, double strike, double rate, double vol, double maturity, int steps);
double sf_binomial_american_price(double spot, double strike, double rate, double vol, double maturity, int steps, double dividend_yield);
double sf_digital_call_bs(double spot, double strike, double rate, double vol, double maturity, double dividend_yield);
double sf_delta_hedge_error(int n_rebalances);
double sf_delta_hedge_pnl_std(double spot, double vol, double maturity, int n_rebalances);

void sf_delta_hedge_pnl_distribution(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, double* out_stats
);

void sf_delta_hedge_pnl_histogram(
    double spot, double strike, double rate, double vol, double maturity,
    int n_rebalances, int n_paths, int n_bins,
    double* out_stats,
    double* out_edges,
    double* out_counts
);

void sf_pricing_greeks(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double* out_delta_bs,
    double* out_vega_bs
);

void sf_pricing_error_decomp(
    double mc,
    double bs,
    double binomial,
    double* out_mc_minus_bs,
    double* out_binomial_minus_bs
);

void sf_scenario_bs5(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double dividend_yield,
    double* out_prices_5
);

void sf_stats_normal(
    double mu,
    double sigma,
    double theta,
    int sample_size,
    double* out_mgf,
    double* out_mean,
    double* out_variance
);

void sf_ito_check(
    int function_code,
    double theta,
    double t,
    int n_steps,
    double* out_value,
    double* out_target
);

int sf_simulation_path(
    int model_code,
    int n_steps,
    double dt,
    double sigma,
    double kappa,
    double theta,
    double x0,
    double* out_values
);

int sf_measure_density_path(
    double mu,
    double r,
    double sigma,
    double t,
    int n_steps,
    double* out_values
);

void sf_set_num_threads(int n_threads);
int sf_get_max_threads(void);

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
);

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
);

double sf_vol_surface_interp(
    const double* strikes,
    const double* expiries,
    const double* ivs,
    int           n_points,
    double        spot,
    double        target_strike,
    double        target_expiry
);

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
);

#ifdef __cplusplus
}
#endif
