#pragma once

namespace sf {

double bs_closed_form_price(double spot, double strike, double rate, double vol, double maturity);
double bs_delta(double spot, double strike, double rate, double vol, double maturity);
double digital_call_bs_price(double spot, double strike, double rate, double vol, double maturity, double dividend_yield);
double mc_price(double spot, double strike, int n_paths);
double mc_price_full(double spot, double strike, double rate, double vol, double maturity, int n_paths);
double mc_price_with_stderr(double spot, double strike, double rate, double vol, double maturity, int n_paths, double* out_stderr);
double binomial_price(double spot, double strike, double rate, double vol, double maturity, int steps);
double binomial_american_price(double spot, double strike, double rate, double vol, double maturity, int steps, double dividend_yield = 0.0);

void pricing_greeks(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double* out_delta_bs,
    double* out_vega_bs
);

void pricing_error_decomp(
    double mc,
    double bs,
    double binomial,
    double* out_mc_minus_bs,
    double* out_binomial_minus_bs
);

void scenario_bs5(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double dividend_yield,
    double* out_prices_5
);

double pde_price_component(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double dividend_yield,
    int s_steps,
    int t_steps,
    int method
);

double vol_surface_interp_component(
    const double* strikes,
    const double* expiries,
    const double* ivs,
    int n_points,
    double spot,
    double target_strike,
    double target_expiry
);

void pricing_batch_component(
    int n_jobs,
    const double* spots,
    const double* strikes,
    const double* rates,
    const double* vols,
    const double* maturities,
    const int* n_paths_arr,
    const double* div_yields,
    double* out_mc,
    double* out_bs,
    double* out_binomial
);

}  // namespace sf
