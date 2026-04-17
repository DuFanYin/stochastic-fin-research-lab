#include "engine.hpp"

#include <algorithm>
#include <cmath>

namespace sf {

double clamp_positive(double x, double eps) {
    return std::max(x, eps);
}

double clamp_nonnegative(double x) {
    return std::max(x, 0.0);
}

double norm_cdf(double x) {
    return 0.5 * (1.0 + std::erf(x / std::sqrt(2.0)));
}

double norm_pdf(double x) {
    static const double pi = std::acos(-1.0);
    static const double inv_sqrt_2pi = 1.0 / std::sqrt(2.0 * pi);
    return inv_sqrt_2pi * std::exp(-0.5 * x * x);
}

double sample_mean(const std::vector<double>& xs) {
    if (xs.empty()) return 0.0;
    double s = 0.0;
    for (double x : xs) s += x;
    return s / static_cast<double>(xs.size());
}

double sample_variance(const std::vector<double>& xs) {
    if (xs.size() < 2) return 0.0;
    const double m = sample_mean(xs);
    double acc = 0.0;
    for (double x : xs) {
        const double d = x - m;
        acc += d * d;
    }
    return acc / static_cast<double>(xs.size() - 1);
}

double interp_quantile_sorted(const std::vector<double>& sorted_xs, double q) {
    if (sorted_xs.empty()) return 0.0;
    const double qc = std::min(1.0, std::max(0.0, q));
    const int n = static_cast<int>(sorted_xs.size());
    const double pos = qc * (n - 1);
    const int lo = static_cast<int>(pos);
    const int hi = std::min(lo + 1, n - 1);
    const double w = pos - lo;
    return sorted_xs[lo] * (1.0 - w) + sorted_xs[hi] * w;
}

}  // namespace sf
