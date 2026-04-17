#include "engine.hpp"

#include <algorithm>
#include <cmath>
#include <random>
#include <vector>
#ifdef _OPENMP
#include <omp.h>
#endif

namespace sf {

int simulation_path_component(
    int model_code,
    int n_steps,
    double dt,
    double sigma,
    double kappa,
    double theta,
    double x0,
    double* out_values
) {
    if (!out_values) return 0;
    std::mt19937_64 rng(7);
    std::normal_distribution<double> z(0.0, 1.0);
    const int n = std::max(n_steps, 1);
    const double dtt = clamp_positive(dt);
    ModelParams params{};
    params.sigma = sigma;
    params.kappa = kappa;
    params.theta = theta;
    auto model = build_model(
        model_code == 1 ? ModelType::Vasicek : ModelType::GBM,
        params
    );

    double x = x0;
    out_values[0] = x;
    for (int i = 0; i < n; ++i) {
        x = model->step(x, i * dtt, dtt, z(rng));
        out_values[i + 1] = x;
    }
    return n + 1;
}

int measure_density_path_component(
    double mu,
    double r,
    double sigma,
    double t,
    int n_steps,
    double* out_values
) {
    if (!out_values) return 0;
    std::mt19937_64 rng(23);
    std::normal_distribution<double> z(0.0, 1.0);
    const int n = std::max(n_steps, 20);
    const double s = clamp_positive(sigma);
    const double tt = clamp_positive(t);
    const double dt = tt / static_cast<double>(n);
    const double theta_mpr = (mu - r) / s;

    ModelParams p_params{};
    p_params.mu = mu;
    p_params.sigma = s;
    ModelParams q_params{};
    q_params.mu = r;
    q_params.sigma = s;
    auto p_model = build_model(ModelType::GBM, p_params);
    auto q_model = build_model(ModelType::GBM, q_params);

    double w = 0.0;
    double xp = 1.0;
    double xq = 1.0;
    out_values[0] = 1.0;
    for (int i = 0; i < n; ++i) {
        const double zi = z(rng);
        w += std::sqrt(dt) * zi;
        xp = p_model->step(xp, i * dt, dt, zi);
        xq = q_model->step(xq, i * dt, dt, zi);
        (void)xp;
        (void)xq;
        out_values[i + 1] = std::exp(-theta_mpr * w - 0.5 * theta_mpr * theta_mpr * ((i + 1) * dt));
    }
    return n + 1;
}

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
) {
    if (!out_stats_10 || !out_preview) return 0;
    const int    N       = std::max(n_steps, 2);
    const int    NP      = std::max(n_paths, 1);
    const double s       = clamp_positive(sigma, 1e-10);
    const double tt      = clamp_positive(t);
    const double dt      = tt / N;
    const int    PL      = std::min(preview_len, N);

    std::mt19937_64 rng(42);
    std::normal_distribution<double> zdist(0.0, 1.0);
    ModelParams p_params{};
    p_params.mu = mu;
    p_params.sigma = s;
    ModelParams q_params{};
    q_params.mu = r;
    q_params.sigma = s;

    {
        auto p_model = build_model(ModelType::GBM, p_params);
        auto q_model = build_model(ModelType::GBM, q_params);
        double xp = x0, xq = x0;
        for (int i = 0; i < PL; ++i) {
            const double zi = zdist(rng);
            xp = p_model->step(xp, i * dt, dt, zi);
            xq = q_model->step(xq, i * dt, dt, zi);
            out_preview[i]      = xp;
            out_preview[PL + i] = xq;
        }
    }

    std::vector<double> fp(NP), fq(NP);

#ifdef _OPENMP
    #pragma omp parallel
    {
        std::mt19937_64 lrng(42 + omp_get_thread_num());
        std::normal_distribution<double> lz(0.0, 1.0);
        auto p_model = build_model(ModelType::GBM, p_params);
        auto q_model = build_model(ModelType::GBM, q_params);
        #pragma omp for schedule(static)
        for (int k = 0; k < NP; ++k) {
            double xp = x0, xq = x0;
            for (int i = 0; i < N; ++i) {
                const double zi = lz(lrng);
                xp = p_model->step(xp, i * dt, dt, zi);
                xq = q_model->step(xq, i * dt, dt, zi);
            }
            fp[k] = xp; fq[k] = xq;
        }
    }
#else
    auto p_model = build_model(ModelType::GBM, p_params);
    auto q_model = build_model(ModelType::GBM, q_params);
    for (int k = 0; k < NP; ++k) {
        double xp = x0, xq = x0;
        for (int i = 0; i < N; ++i) {
            const double zi = zdist(rng);
            xp = p_model->step(xp, i * dt, dt, zi);
            xq = q_model->step(xq, i * dt, dt, zi);
        }
        fp[k] = xp; fq[k] = xq;
    }
#endif

    auto stats5 = [&](std::vector<double>& v, double* out) {
        std::sort(v.begin(), v.end());
        out[0] = sample_mean(v);
        out[1] = sample_variance(v);
        out[2] = interp_quantile_sorted(v, 0.05);
        out[3] = interp_quantile_sorted(v, 0.50);
        out[4] = interp_quantile_sorted(v, 0.95);
    };
    stats5(fp, out_stats_10);
    stats5(fq, out_stats_10 + 5);
    return PL;
}

}  // namespace sf
