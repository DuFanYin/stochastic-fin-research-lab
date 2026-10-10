// API/Adapter layer: ABI wrappers + thread control.
// No JSON parsing/assembly logic in this file.

#include "c_api.h"
#include "../contracts/contracts.h"

#include <chrono>
#include <cstring>
#include <string>
#include <algorithm>
#include <omp.h>

namespace sf {
std::string run_pricing_json(const std::string& request_json, double t0_ms);
std::string run_pricing_batch_json(const std::string& request_json, double t0_ms);
std::string run_pricing_batch_grid_json(const std::string& request_json, double t0_ms);
std::string run_hedging_json(const std::string& request_json, double t0_ms);
std::string run_scenario_json(const std::string& request_json, double t0_ms);
std::string run_validation_json(const std::string& request_json, double t0_ms);
std::string run_simulation_json(const std::string& request_json, double t0_ms);
std::string run_stats_json(const std::string& request_json, double t0_ms);
std::string run_ito_json(const std::string& request_json, double t0_ms);
std::string run_measure_density_json(const std::string& request_json, double t0_ms);
std::string run_measure_compare_json(const std::string& request_json, double t0_ms);
std::string run_pde_json(const std::string& request_json, double t0_ms);
std::string run_vol_surface_json(const std::string& request_json, double t0_ms);
std::string run_greek_surface_json(const std::string& request_json, double t0_ms);
std::string run_multi_leg_json(const std::string& request_json, double t0_ms);
std::string run_implied_vol_json(const std::string& request_json, double t0_ms);
std::string run_implied_vol_batch_json(const std::string& request_json, double t0_ms);
std::string run_heston_calibrate_json(const std::string& request_json, double t0_ms);
std::string run_heston_price_json(const std::string& request_json, double t0_ms);
std::string run_screener_json(const std::string& request_json, double t0_ms);
}  // namespace sf

namespace {

double now_ms() {
    return static_cast<double>(
        std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count()
    ) / 1000.0;
}

int copy_response_to_buffer(
    const std::string& response,
    char* out_response_json,
    int out_capacity,
    int* out_written
) {
    if (!out_response_json || out_capacity <= 1 || !out_written) return 2;
    const int need = static_cast<int>(response.size());
    if (need + 1 > out_capacity) { *out_written = need; return 1; }
    std::memcpy(out_response_json, response.c_str(), static_cast<size_t>(need));
    out_response_json[need] = '\0';
    *out_written = need;
    return 0;
}

}  // namespace

extern "C" {

int sf_run_pricing_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_pricing_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_pricing_batch_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_pricing_batch_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_pricing_batch_grid_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_pricing_batch_grid_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_hedging_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_hedging_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_scenario_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_scenario_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_validation_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_validation_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_simulation_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_simulation_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_stats_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_stats_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_ito_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_ito_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_measure_density_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_measure_density_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_measure_compare_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_measure_compare_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_pde_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_pde_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_vol_surface_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_vol_surface_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_greek_surface_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_greek_surface_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_multi_leg_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_multi_leg_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_implied_vol_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_implied_vol_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_implied_vol_batch_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_implied_vol_batch_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_heston_calibrate_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_heston_calibrate_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_heston_price_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_heston_price_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

int sf_run_screener_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written) {
    if (!request_json) return 2;
    return copy_response_to_buffer(sf::run_screener_json(request_json, now_ms()), out_response_json, out_capacity, out_written);
}

const char* sf_contract_version(void) {
    return sf::kContractVersion;
}

void sf_set_num_threads(int n_threads) {
    omp_set_num_threads(std::max(1, n_threads));
}

int sf_get_max_threads(void) {
    return omp_get_max_threads();
}

}  // extern "C"
