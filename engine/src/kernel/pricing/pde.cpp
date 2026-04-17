#include "../kernel.h"

#include <algorithm>
#include <cmath>
#include <ranges>
#include <vector>

namespace sf {

double pde_price(
    double spot, double strike, double rate, double vol, double maturity,
    double dividend_yield, int s_steps, int t_steps, int method
) {
    const int    M     = std::max(s_steps, 4);
    const int    N     = std::max(t_steps, 4);
    const double r     = rate - dividend_yield;
    const double sigma = clamp_positive(vol);
    const double T     = clamp_positive(maturity);
    const double s_max = std::max(spot, strike) * 4.0;
    const double ds    = s_max / M;
    const double dt    = T / N;
    const double theta = (method == 1) ? 1.0 : 0.5;

    std::vector<double> grid((N + 1) * (M + 1), 0.0);
    auto G = [&](int ti, int si) -> double& { return grid[ti * (M + 1) + si]; };

    for (int i = 0; i <= M; ++i) G(N, i) = clamp_nonnegative(i * ds - strike);

    auto bnd_left  = [&](double /*tau*/) { return 0.0; };
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
        d[0]     -= a[0]     * lnow; a[0]     = 0.0;
        d[m - 1] -= c[m - 1] * rnow; c[m - 1] = 0.0;
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

double vol_surface_interp(
    std::span<const double> strikes,
    std::span<const double> expiries,
    std::span<const double> ivs,
    double spot, double target_strike, double target_expiry
) {
    const int n_points = static_cast<int>(strikes.size());
    if (expiries.size() != strikes.size() || ivs.size() != strikes.size() || n_points < 1 || spot <= 0.0
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
    std::ranges::sort(um);
    um.erase(std::ranges::unique(um).begin(), um.end());
    std::ranges::sort(uv);
    uv.erase(std::ranges::unique(uv).begin(), uv.end());

    if (um.size() < 2 || uv.size() < 2) {
        int best = 0; double best_d2 = 1e30;
        for (int i = 0; i < n_points; ++i) {
            const double dm = ms[i] - tgt_m, dv = vs[i] - tgt_v;
            const double d2 = dm * dm + dv * dv;
            if (d2 < best_d2) { best_d2 = d2; best = i; }
        }
        return ivs[best];
    }

    auto bracket = [](const std::vector<double>& axis, double t) -> std::pair<int, int> {
        if (t <= axis.front()) return {0, 0};
        if (t >= axis.back())  return {(int)axis.size() - 1, (int)axis.size() - 1};
        for (int i = 0; i < (int)axis.size() - 1; ++i)
            if (axis[i] <= t && t <= axis[i + 1]) return {i, i + 1};
        return {(int)axis.size() - 1, (int)axis.size() - 1};
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
            const double d = dm * dm + dv * dv;
            if (d < best_d) { best_d = d; best = i; }
        }
        return ivs[best];
    };

    const double q00 = corner_iv(m0, v0), q10 = corner_iv(m1, v0);
    const double q01 = corner_iv(m0, v1), q11 = corner_iv(m1, v1);
    const double interp = q00*(1-wm)*(1-wv) + q10*wm*(1-wv) + q01*(1-wm)*wv + q11*wm*wv;
    return std::isfinite(interp) ? interp : -1.0;
}

}  // namespace sf
