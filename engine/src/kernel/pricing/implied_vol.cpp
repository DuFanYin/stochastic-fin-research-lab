#include "../kernel.h"
#include <cmath>
#include <omp.h>

namespace sf {

// Brent's method: find sigma s.t. bs_closed_form_price(sigma) == market_price.
// Returns -1.0 on failure (no root in [lo, hi]).
double bs_implied_vol(
    double market_price, double spot, double strike,
    double rate, double maturity, double dividend_yield,
    double tol, int max_iter
) {
    if (market_price <= 0.0 || spot <= 0.0 || strike <= 0.0 || maturity <= 0.0)
        return -1.0;

    const double r_eff = rate - dividend_yield;
    auto f = [&](double sigma) {
        return bs_closed_form_price(spot, strike, r_eff, sigma, maturity) - market_price;
    };

    double lo = 1e-4, hi = 5.0;
    double flo = f(lo), fhi = f(hi);
    if (flo * fhi > 0.0) return -1.0;  // no sign change — no root in bracket

    double a = lo, b = hi, fa = flo, fb = fhi;
    double c = a, fc = fa, s = 0.0, d = 0.0;
    bool mflag = true;

    for (int i = 0; i < max_iter; ++i) {
        if (std::abs(fb) < tol) return b;
        if (std::abs(b - a) < tol) return b;

        if (fa != fc && fb != fc) {
            // inverse quadratic interpolation
            s = (a * fb * fc) / ((fa - fb) * (fa - fc))
              + (b * fa * fc) / ((fb - fa) * (fb - fc))
              + (c * fa * fb) / ((fc - fa) * (fc - fb));
        } else {
            s = b - fb * (b - a) / (fb - fa);
        }

        const double cond1 = (3.0 * a + b) / 4.0;
        const bool bad = (cond1 < b ? (s < cond1 || s > b) : (s > cond1 || s < b))
                      || (mflag  && std::abs(s - b) >= std::abs(b - c) / 2.0)
                      || (!mflag && std::abs(s - b) >= std::abs(c - d) / 2.0)
                      || (mflag  && std::abs(b - c) < tol)
                      || (!mflag && std::abs(c - d) < tol);
        if (bad) {
            s = (a + b) / 2.0;
            mflag = true;
        } else {
            mflag = false;
        }

        const double fs = f(s);
        d = c; c = b; fc = fb;
        if (fa * fs < 0.0) { b = s; fb = fs; }
        else               { a = s; fa = fs; }

        if (std::abs(fa) < std::abs(fb)) {
            std::swap(a, b); std::swap(fa, fb);
        }
    }
    return b;
}

void implied_vol_batch(
    std::span<const double>  market_prices,
    std::span<const double>  strikes,
    std::span<const double>  expiries,
    double spot, double rate, double dividend_yield,
    std::span<double>        out_ivs,
    std::span<uint8_t>       out_converged
) {
    const int n = static_cast<int>(market_prices.size());
#pragma omp parallel for schedule(static)
    for (int i = 0; i < n; ++i) {
        const double iv = bs_implied_vol(
            market_prices[i], spot, strikes[i], rate, expiries[i], dividend_yield);
        out_ivs[i]       = iv;
        out_converged[i] = static_cast<uint8_t>(iv > 0.0 ? 1 : 0);
    }
}

}  // namespace sf
