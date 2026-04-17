#include "engine.hpp"

#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>
#ifdef _OPENMP
#include <omp.h>
#endif

namespace sf {

void pricing_greeks(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double* out_delta_bs,
    double* out_vega_bs
) {
    if (!out_delta_bs || !out_vega_bs) return;
    const double s = clamp_positive(spot);
    const double k = clamp_positive(strike);
    const double t = clamp_positive(maturity);
    const double v = clamp_positive(vol);
    const double sqrt_t = std::sqrt(t);
    const double d1 = (std::log(s / k) + (rate + 0.5 * v * v) * t) / (v * sqrt_t);
    *out_delta_bs = bs_delta(s, k, rate, v, t);
    *out_vega_bs = s * norm_pdf(d1) * sqrt_t;
}

void pricing_error_decomp(
    double mc,
    double bs,
    double binomial,
    double* out_mc_minus_bs,
    double* out_binomial_minus_bs
) {
    if (out_mc_minus_bs) *out_mc_minus_bs = mc - bs;
    if (out_binomial_minus_bs) *out_binomial_minus_bs = binomial - bs;
}

void scenario_bs5(
    double spot,
    double strike,
    double rate,
    double vol,
    double maturity,
    double dividend_yield,
    double* out_prices_5
) {
    if (!out_prices_5) return;
    const double shock_spot[5] = {1.0, 1.1, 0.9, 1.0, 1.0};
    const double shock_vol[5] = {0.0, 0.0, 0.0, 0.05, 0.0};
    const double shock_rate[5] = {0.0, 0.0, 0.0, 0.0, 0.01};
    for (int i = 0; i < 5; ++i) {
        const double s = spot * shock_spot[i];
        const double v = std::max(0.0001, vol + shock_vol[i]);
        const double r_eff = rate + shock_rate[i] - dividend_yield;
        out_prices_5[i] = bs_closed_form_price(s, strike, r_eff, v, maturity);
    }
}

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
) {
    const int    M      = std::max(s_steps, 4);
    const int    N      = std::max(t_steps, 4);
    const double r      = rate - dividend_yield;
    const double sigma  = clamp_positive(vol);
    const double T      = clamp_positive(maturity);
    const double s_max  = std::max(spot, strike) * 4.0;
    const double ds     = s_max / M;
    const double dt     = T / N;
    const double theta  = (method == 1) ? 1.0 : 0.5;

    std::vector<double> grid((N + 1) * (M + 1), 0.0);
    auto G = [&](int ti, int si) -> double& { return grid[ti * (M + 1) + si]; };

    for (int i = 0; i <= M; ++i) G(N, i) = clamp_nonnegative(i * ds - strike);

    auto bnd_left  = [&](double tau) { return 0.0; };
    auto bnd_right = [&](double tau) {
        return std::max(0.0, s_max - strike * std::max(0.0, 1.0 - r * tau));
    };

    const int m = M - 1;
    std::vector<double> a(m), b(m), c(m), d(m), cp(m), dp(m);
    for (int n = N - 1; n >= 0; --n) {
        const double tau      = T - n * dt;
        const double tau_prev = tau - dt;
        const double lnow  = bnd_left(tau);
        const double rnow  = bnd_right(tau);
        const double lnext = bnd_left(tau_prev);
        const double rnext = bnd_right(tau_prev);

        for (int j = 1; j < M; ++j) {
            const double jj    = static_cast<double>(j);
            const double alpha = 0.5 * dt * (sigma * sigma * jj * jj - r * jj);
            const double beta  = dt * (sigma * sigma * jj * jj + r);
            const double gamma = 0.5 * dt * (sigma * sigma * jj * jj + r * jj);
            const int    row   = j - 1;
            a[row] = -theta * alpha;
            b[row] =  1.0 + theta * beta;
            c[row] = -theta * gamma;
            d[row] = (1.0 - (1.0 - theta) * beta) * G(n + 1, j)
                   + (1.0 - theta) * alpha * G(n + 1, j - 1)
                   + (1.0 - theta) * gamma * G(n + 1, j + 1);
        }
        d[0]     -= a[0] * lnow;   a[0]   = 0.0;
        d[m - 1] -= c[m-1] * rnow; c[m-1] = 0.0;
        if (method != 1) {
            d[0]     += 0.5 * (lnext - lnow);
            d[m - 1] += 0.5 * (rnext - rnow);
        }

        if (std::abs(b[0]) < 1e-14) return 0.0;
        cp[0] = c[0] / b[0];
        dp[0] = d[0] / b[0];
        for (int i = 1; i < m; ++i) {
            const double denom = b[i] - a[i] * cp[i - 1];
            if (std::abs(denom) < 1e-14) return 0.0;
            cp[i] = (i < m - 1) ? c[i] / denom : 0.0;
            dp[i] = (d[i] - a[i] * dp[i - 1]) / denom;
        }
        G(n, 0) = lnow; G(n, M) = rnow;
        G(n, m) = dp[m - 1];
        for (int i = m - 2; i >= 0; --i) G(n, i + 1) = dp[i] - cp[i] * G(n, i + 2);
    }

    const int    si = std::min(std::max(static_cast<int>(spot / ds), 0), M - 1);
    const double w  = (spot - si * ds) / ds;
    const double p  = G(0, si) * (1.0 - w) + G(0, si + 1) * w;
    return std::isfinite(p) ? p : 0.0;
}

double vol_surface_interp_component(
    const double* strikes,
    const double* expiries,
    const double* ivs,
    int n_points,
    double spot,
    double target_strike,
    double target_expiry
) {
    if (!strikes || !expiries || !ivs || n_points < 1 || spot <= 0.0
            || target_strike <= 0.0 || target_expiry <= 0.0)
        return -1.0;

    const double tgt_m = std::log(target_strike / spot);
    const double tgt_v = std::sqrt(target_expiry);
    std::vector<double> ms(n_points), vs(n_points);
    for (int i = 0; i < n_points; ++i) {
        ms[i] = std::log(strikes[i] / spot);
        vs[i] = std::sqrt(clamp_positive(expiries[i]));
    }
    std::vector<double> um = ms, uv = vs;
    std::sort(um.begin(), um.end()); um.erase(std::unique(um.begin(), um.end()), um.end());
    std::sort(uv.begin(), uv.end()); uv.erase(std::unique(uv.begin(), uv.end()), uv.end());

    if (um.size() < 2 || uv.size() < 2) {
        int best = 0;
        double best_d2 = 1e30;
        for (int i = 0; i < n_points; ++i) {
            const double dm = ms[i] - tgt_m;
            const double dv = vs[i] - tgt_v;
            const double d2 = dm * dm + dv * dv;
            if (d2 < best_d2) { best_d2 = d2; best = i; }
        }
        return ivs[best];
    }

    auto bracket = [](const std::vector<double>& axis, double t) -> std::pair<int,int> {
        if (t <= axis.front()) return {0, 0};
        if (t >= axis.back())  return {(int)axis.size()-1, (int)axis.size()-1};
        for (int i = 0; i < (int)axis.size()-1; ++i)
            if (axis[i] <= t && t <= axis[i+1]) return {i, i+1};
        return {(int)axis.size()-1, (int)axis.size()-1};
    };
    auto [mi0, mi1] = bracket(um, tgt_m);
    auto [vi0, vi1] = bracket(uv, tgt_v);
    const double m0 = um[mi0], m1 = um[mi1];
    const double v0 = uv[vi0], v1 = uv[vi1];
    const double wm = (m1 > m0) ? (tgt_m - m0) / (m1 - m0) : 0.0;
    const double wv = (v1 > v0) ? (tgt_v - v0) / (v1 - v0) : 0.0;
    auto corner_iv = [&](double cm, double cv) -> double {
        int best = 0; double best_d = 1e30;
        for (int i = 0; i < n_points; ++i) {
            const double dm = ms[i] - cm, dv = vs[i] - cv;
            const double d = dm*dm + dv*dv;
            if (d < best_d) { best_d = d; best = i; }
        }
        return ivs[best];
    };

    const double q00 = corner_iv(m0, v0);
    const double q10 = corner_iv(m1, v0);
    const double q01 = corner_iv(m0, v1);
    const double q11 = corner_iv(m1, v1);

    const double interp =
        q00 * (1-wm) * (1-wv) +
        q10 *    wm  * (1-wv) +
        q01 * (1-wm) *    wv  +
        q11 *    wm  *    wv;

    return std::isfinite(interp) ? interp : -1.0;
}

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
) {
    if (n_jobs <= 0 || !spots || !strikes || !rates || !vols ||
        !maturities || !n_paths_arr || !div_yields ||
        !out_mc || !out_bs || !out_binomial) return;

#ifdef _OPENMP
    #pragma omp parallel for schedule(dynamic)
#endif
    for (int i = 0; i < n_jobs; ++i) {
        const double r_eff = rates[i] - div_yields[i];
        const int    steps = std::max(10, static_cast<int>(maturities[i] * 250));
        out_mc[i]       = mc_price_full(spots[i], strikes[i], r_eff, vols[i], maturities[i], n_paths_arr[i]);
        out_bs[i]       = bs_closed_form_price(spots[i], strikes[i], r_eff, vols[i], maturities[i]);
        out_binomial[i] = binomial_price(spots[i], strikes[i], r_eff, vols[i], maturities[i], steps);
    }
}

}  // namespace sf
