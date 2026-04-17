#pragma once

#include <vector>

namespace sf {

double clamp_positive(double x, double eps = 1e-8);
double clamp_nonnegative(double x);
double norm_cdf(double x);
double norm_pdf(double x);
double sample_mean(const std::vector<double>& xs);
double sample_variance(const std::vector<double>& xs);
double interp_quantile_sorted(const std::vector<double>& sorted_xs, double q);

}  // namespace sf
