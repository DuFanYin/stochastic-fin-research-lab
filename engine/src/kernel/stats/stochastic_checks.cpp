#include "../kernel.h"

#include <cmath>
#include <random>

namespace sf {

void ito_check(
    int function_code, double theta, double t, int n_steps,
    double* out_value, double* out_target
) {
    if (!out_value || !out_target) return;
    std::mt19937_64 rng(19);
    std::normal_distribution<double> z(0.0, 1.0);
    const int    n  = std::max(n_steps, 100);
    const double tt = clamp_positive(t);
    const double dt = tt / static_cast<double>(n);
    double w = 0.0;
    for (int i = 0; i < n; ++i) w += std::sqrt(dt) * z(rng);

    if (function_code == 1) {
        *out_value = w * w - tt; *out_target = 0.0;
    } else if (function_code == 2) {
        *out_value = w * w * w;  *out_target = 0.0;
    } else {
        *out_value  = std::exp(theta * w - 0.5 * theta * theta * tt);
        *out_target = 1.0;
    }
}

}  // namespace sf
