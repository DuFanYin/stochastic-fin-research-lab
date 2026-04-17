#include "engine.h"
#include "kernel/kernel.h"

#include <algorithm>
#include <cmath>
#include <ranges>

namespace sf {

SimulationResult run_simulation(const SimulationParams& p) {
    const int n = std::max(1, p.n_steps);
    std::vector<double> buf(static_cast<size_t>(n + 1));
    const int model_code = (p.model == "vasicek") ? 1 : 0;
    const int length = simulation_path(
        model_code, n, p.dt, p.sigma, p.kappa, p.theta, p.x0, buf);
    buf.resize(static_cast<size_t>(std::max(0, length)));
    return SimulationResult{p.model, n, std::move(buf)};
}

StatsResult run_stats(const StatsParams& p) {
    double mgf = 0.0, mean = 0.0, var = 0.0;
    stats_normal(p.mu, p.sigma, p.theta, p.sample_size, &mgf, &mean, &var);
    return StatsResult{mgf, mean, var};
}

ItoResult run_ito(const ItoParams& p) {
    const int code = (p.function_type == "w2_minus_t") ? 1
                   : (p.function_type == "w3")         ? 2 : 0;
    double val = 0.0, target = 0.0;
    ito_check(code, p.theta, p.t, p.n_steps, &val, &target);
    return ItoResult{p.function_type, val, target};
}

MeasureDensityResult run_measure_density(const MeasureDensityParams& p) {
    const int n = std::max(20, p.n_steps);
    std::vector<double> buf(static_cast<size_t>(n + 1));
    const int length = measure_density_path(p.mu, p.r, p.sigma, p.t, n, buf);
    buf.resize(static_cast<size_t>(std::max(0, length)));
    return MeasureDensityResult{std::move(buf)};
}

MeasureCompareResult run_measure_compare(const MeasureCompareParams& p) {
    const int pl = std::max(1, std::min(p.preview_len, p.n_steps));
    std::vector<double> stats_buf(10, 0.0);
    std::vector<double> preview_buf(static_cast<size_t>(2 * pl), 0.0);
    measure_compare(
        p.mu, p.r, p.sigma, p.t, p.n_steps, p.n_paths, p.x0,
        stats_buf, preview_buf, pl);
    MeasureCompareResult r;
    r.p_mean = stats_buf[0]; r.p_var = stats_buf[1];
    r.p_q05  = stats_buf[2]; r.p_q50 = stats_buf[3]; r.p_q95 = stats_buf[4];
    r.q_mean = stats_buf[5]; r.q_var = stats_buf[6];
    r.q_q05  = stats_buf[7]; r.q_q50 = stats_buf[8]; r.q_q95 = stats_buf[9];
    r.preview_p.assign(preview_buf.begin(), preview_buf.begin() + pl);
    r.preview_q.assign(preview_buf.begin() + pl, preview_buf.begin() + 2 * pl);
    return r;
}

PdeResult run_pde(const PdeParams& p) {
    const int method_code = (p.method == "implicit") ? 1 : 0;
    const double price = pde_price(
        p.spot, p.strike, p.rate, p.vol, p.maturity, p.dividend_yield,
        p.s_steps, p.t_steps, method_code);
    return PdeResult{price, p.method, p.s_steps, p.t_steps};
}

VolSurfaceResult run_vol_surface(const VolSurfaceParams& p) {
    if (p.strikes.empty() || p.spot <= 0.0 || p.target_strike <= 0.0 || p.target_expiry <= 0.0)
        return {0.0, "error"};
    const double iv = vol_surface_interp(
        p.strikes, p.expiries, p.ivs, p.spot, p.target_strike, p.target_expiry);
    if (iv < 0.0) return {0.0, "error"};

    // Determine if true bilinear interpolation was used or fell back to nearest
    std::vector<double> um = p.strikes, uv = p.expiries;
    std::ranges::sort(um);
    um.erase(std::ranges::unique(um).begin(), um.end());
    std::ranges::sort(uv);
    uv.erase(std::ranges::unique(uv).begin(), uv.end());
    const std::string method = (um.size() >= 2 && uv.size() >= 2) ? "cpp_bilinear" : "cpp_nearest";
    return {iv, method};
}

}  // namespace sf
