#pragma once

#include <vector>

namespace sf {

double mean(const std::vector<double>& xs);

void stats_normal_component(
    double mu,
    double sigma,
    double theta,
    int sample_size,
    double* out_mgf,
    double* out_mean,
    double* out_variance
);

void ito_check_component(
    int function_code,
    double theta,
    double t,
    int n_steps,
    double* out_value,
    double* out_target
);

}  // namespace sf
