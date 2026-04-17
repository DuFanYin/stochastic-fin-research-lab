#pragma once

#include <memory>
#include <random>

namespace sf {

enum class ModelType {
    GBM = 0,
    Vasicek = 1,
};

struct ModelParams {
    double mu = 0.0;
    double sigma = 0.2;
    double kappa = 1.2;
    double theta = 0.03;
};

class StochasticModel {
public:
    virtual ~StochasticModel() = default;
    virtual double drift(double x, double t) const = 0;
    virtual double diffusion(double x, double t) const = 0;
    virtual double step(double x, double t, double dt, double z) const = 0;
};

class GbmModel final : public StochasticModel {
public:
    explicit GbmModel(const ModelParams& p);
    double drift(double x, double t) const override;
    double diffusion(double x, double t) const override;
    double step(double x, double t, double dt, double z) const override;

private:
    ModelParams p_;
};

class VasicekModel final : public StochasticModel {
public:
    explicit VasicekModel(const ModelParams& p);
    double drift(double x, double t) const override;
    double diffusion(double x, double t) const override;
    double step(double x, double t, double dt, double z) const override;

private:
    ModelParams p_;
};

std::unique_ptr<StochasticModel> build_model(ModelType type, const ModelParams& params);
double simulate_terminal_price_gbm(
    double spot,
    double rate,
    double vol,
    double maturity,
    std::mt19937_64& rng
);

int simulation_path_component(
    int model_code,
    int n_steps,
    double dt,
    double sigma,
    double kappa,
    double theta,
    double x0,
    double* out_values
);

int measure_density_path_component(
    double mu,
    double r,
    double sigma,
    double t,
    int n_steps,
    double* out_values
);

int measure_compare_component(
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

}  // namespace sf
