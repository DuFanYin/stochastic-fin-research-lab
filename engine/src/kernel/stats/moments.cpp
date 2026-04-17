#include "../kernel.h"

#include <algorithm>
#include <cmath>

namespace sf {

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
    for (double x : xs) { const double d = x - m; acc += d * d; }
    return acc / static_cast<double>(xs.size() - 1);
}

double interp_quantile_sorted(const std::vector<double>& sorted_xs, double q) {
    if (sorted_xs.empty()) return 0.0;
    const double qc = std::min(1.0, std::max(0.0, q));
    const int    n  = static_cast<int>(sorted_xs.size());
    const double pos = qc * (n - 1);
    const int    lo  = static_cast<int>(pos);
    const int    hi  = std::min(lo + 1, n - 1);
    return sorted_xs[lo] * (1.0 - (pos - lo)) + sorted_xs[hi] * (pos - lo);
}

void stats_normal(
    double mu, double sigma, double theta, int /*sample_size*/,
    double* out_mgf, double* out_mean, double* out_variance
) {
    const double s = clamp_positive(sigma);
    if (out_mgf)      *out_mgf      = std::exp(mu * theta + 0.5 * s * s * theta * theta);
    if (out_mean)     *out_mean     = mu;
    if (out_variance) *out_variance = s * s;
}

double stats_mgf(double mu, double sigma, double theta) {
    const double s = clamp_positive(sigma);
    return std::exp(mu * theta + 0.5 * s * s * theta * theta);
}

}  // namespace sf
