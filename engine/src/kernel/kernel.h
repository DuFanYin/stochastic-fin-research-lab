#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <random>
#include <span>
#include <vector>

namespace sf {

// ── Optimizer ─────────────────────────────────────────────────────────────────

struct OptResult {
    std::vector<double> x;
    double fval      = 1e30;
    int    iterations = 0;
    bool   converged  = false;
};

OptResult nelder_mead(
    std::function<double(std::span<const double>)> objective,
    std::span<const double> x0,
    std::span<const double> lower,
    std::span<const double> upper,
    double tol      = 1e-6,
    int    max_iter = 1000
);

// ── Numerics ──────────────────────────────────────────────────────────────────

double clamp_positive   (double x, double eps = 1e-8);
double clamp_nonnegative(double x);
double norm_cdf(double x);
double norm_pdf(double x);

// ── Stats ─────────────────────────────────────────────────────────────────────

double sample_mean              (const std::vector<double>& xs);
double sample_variance          (const std::vector<double>& xs);
double interp_quantile_sorted   (const std::vector<double>& sorted_xs, double q);

double stats_mgf(double mu, double sigma, double theta);
void   stats_normal(double mu, double sigma, double theta, int sample_size,
                    double* out_mgf, double* out_mean, double* out_variance);

void ito_check(int function_code, double theta, double t, int n_steps,
               double* out_value, double* out_target);

// ── MC Sampler ────────────────────────────────────────────────────────────────

enum class SamplerType { Pseudorandom = 0, Antithetic = 1, Sobol = 2 };

class SobolEngine {
public:
    explicit SobolEngine(int dimension);
    void next(std::span<double> out_unit);
    void skip(int n);
private:
    int dim_;
    unsigned counter_;
    std::vector<std::vector<uint32_t>> V_;
    std::vector<uint32_t> X_;
};

// ── Simulation ────────────────────────────────────────────────────────────────

enum class ModelType { GBM = 0, Vasicek = 1 };

struct ModelParams {
    double mu    = 0.0;
    double sigma = 0.2;
    double kappa = 1.2;
    double theta = 0.03;
};

class StochasticModel {
public:
    virtual ~StochasticModel() = default;
    virtual double drift    (double x, double t) const = 0;
    virtual double diffusion(double x, double t) const = 0;
    virtual double step     (double x, double t, double dt, double z) const = 0;
};

class GbmModel final : public StochasticModel {
public:
    explicit GbmModel(const ModelParams& p);
    double drift    (double x, double t) const override;
    double diffusion(double x, double t) const override;
    double step     (double x, double t, double dt, double z) const override;
private:
    ModelParams p_;
};

class VasicekModel final : public StochasticModel {
public:
    explicit VasicekModel(const ModelParams& p);
    double drift    (double x, double t) const override;
    double diffusion(double x, double t) const override;
    double step     (double x, double t, double dt, double z) const override;
private:
    ModelParams p_;
};

std::unique_ptr<StochasticModel> build_model(ModelType type, const ModelParams& params);
double simulate_terminal_price_gbm(double spot, double rate, double vol, double maturity,
                                   std::mt19937_64& rng);

int simulation_path    (int model_code, int n_steps, double dt,
                        double sigma, double kappa, double theta, double x0,
                        std::span<double> out_values);
int measure_density_path(double mu, double r, double sigma, double t,
                         int n_steps, std::span<double> out_values);
int measure_compare    (double mu, double r, double sigma, double t,
                        int n_steps, int n_paths, double x0,
                        std::span<double> out_stats_10, std::span<double> out_preview, int preview_len);

// ── Pricing ───────────────────────────────────────────────────────────────────

double bs_closed_form_price (double spot, double strike, double rate, double vol, double maturity);
double bs_closed_form_price (double spot, double strike, double rate, double vol, double maturity, bool is_call);
double bs_delta             (double spot, double strike, double rate, double vol, double maturity);
double digital_call_bs_price(double spot, double strike, double rate, double vol,
                              double maturity, double dividend_yield);

double mc_price            (double spot, double strike, int n_paths);
double mc_price_full       (double spot, double strike, double rate, double vol,
                            double maturity, int n_paths);
double mc_price_full       (double spot, double strike, double rate, double vol,
                            double maturity, int n_paths, bool is_call);
double mc_price_full       (double spot, double strike, double rate, double vol,
                            double maturity, int n_paths, bool is_call, SamplerType sampler);
double mc_price_with_stderr(double spot, double strike, double rate, double vol,
                            double maturity, int n_paths, double* out_stderr);
double mc_price_with_stderr(double spot, double strike, double rate, double vol,
                            double maturity, int n_paths, double* out_stderr, bool is_call);
double mc_price_with_stderr(double spot, double strike, double rate, double vol,
                            double maturity, int n_paths, double* out_stderr, bool is_call,
                            SamplerType sampler);

double binomial_price         (double spot, double strike, double rate, double vol,
                               double maturity, int steps);
double binomial_price         (double spot, double strike, double rate, double vol,
                               double maturity, int steps, bool is_call);
double binomial_american_price(double spot, double strike, double rate, double vol,
                               double maturity, int steps, double dividend_yield = 0.0);

void pricing_greeks     (double spot, double strike, double rate, double vol, double maturity,
                         double dividend_yield,
                         double* out_delta_bs, double* out_gamma_bs,
                         double* out_theta_bs, double* out_vega_bs, double* out_rho_bs);
void greek_surface_grid (double strike, double rate, double vol, double dividend_yield,
                         std::span<const double> spots, std::span<const double> maturities,
                         int greek_code, std::span<double> out_grid);
void pricing_error_decomp(double mc, double bs, double binomial,
                          double* out_mc_minus_bs, double* out_binomial_minus_bs);
void scenario_bs5       (double spot, double strike, double rate, double vol,
                         double maturity, double dividend_yield, double* out_prices_5);
void pricing_batch      (std::span<const double> spots,
                         std::span<const double> strikes,
                         std::span<const double> rates,
                         std::span<const double> vols,
                         std::span<const double> maturities,
                         std::span<const int> n_paths_arr,
                         std::span<const double> div_yields,
                         std::span<double> out_mc,
                         std::span<double> out_bs,
                         std::span<double> out_binomial);

double bs_implied_vol   (double market_price, double spot, double strike,
                         double rate, double maturity, double dividend_yield,
                         double tol = 1e-6, int max_iter = 100);
void   implied_vol_batch(std::span<const double>  market_prices,
                         std::span<const double>  strikes,
                         std::span<const double>  expiries,
                         double spot, double rate, double dividend_yield,
                         std::span<double>        out_ivs,
                         std::span<uint8_t>       out_converged);

double heston_call_price(double spot, double strike, double rate, double maturity,
                         double v0, double kappa, double theta, double xi, double rho,
                         int quad_points = 64);
void   heston_price_batch(double spot, double rate,
                          std::span<const double> strikes,
                          std::span<const double> maturities,
                          double v0, double kappa, double theta, double xi, double rho,
                          std::span<double> out_prices);

double pde_price        (double spot, double strike, double rate, double vol,
                         double maturity, double dividend_yield,
                         int s_steps, int t_steps, int method);
double vol_surface_interp(std::span<const double> strikes,
                          std::span<const double> expiries,
                          std::span<const double> ivs,
                          double spot,
                          double target_strike, double target_expiry);

// ── Hedging ───────────────────────────────────────────────────────────────────

double delta_hedge_error_estimate(int n_rebalances);
void   delta_hedge_pnl_distribution(double spot, double strike, double rate, double vol,
                                    double maturity, int n_rebalances, int n_paths,
                                    std::span<double> out_stats);
void   delta_hedge_pnl_histogram   (double spot, double strike, double rate, double vol,
                                    double maturity, int n_rebalances, int n_paths, int n_bins,
                                    std::span<double> out_stats,
                                    std::span<double> out_edges,
                                    std::span<double> out_counts);
void   delta_hedge_strategy_compare(double spot, double strike, double rate, double vol,
                                    double maturity, int n_rebalances, int n_paths,
                                    double transaction_cost_bps, double rebalance_threshold,
                                    double vol_mismatch_mult, std::span<double> out_stats_36);

}  // namespace sf
