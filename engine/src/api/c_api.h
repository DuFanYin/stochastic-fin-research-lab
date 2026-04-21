#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// ── Per-task entry points (no unified dispatcher) ─────────────────────────────
// Returns 0 on success, 1 if buffer too small (out_written = required size), 2 on bad args.
int sf_run_pricing_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_pricing_batch_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_pricing_batch_grid_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_hedging_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_scenario_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_validation_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_simulation_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_stats_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_ito_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_measure_density_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_measure_compare_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_pde_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_vol_surface_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_greek_surface_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_multi_leg_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_implied_vol_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_implied_vol_batch_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_heston_calibrate_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);
int sf_run_heston_price_json(const char* request_json, char* out_response_json, int out_capacity, int* out_written);

// ── Thread control ────────────────────────────────────────────────────────────
void sf_set_num_threads(int n_threads);
int  sf_get_max_threads(void);

#ifdef __cplusplus
}
#endif
