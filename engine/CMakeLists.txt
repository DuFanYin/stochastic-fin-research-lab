cmake_minimum_required(VERSION 3.16)

project(stochastic_finance_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenMP REQUIRED)
find_package(nlohmann_json REQUIRED)

message(STATUS "OpenMP required and enabled with compiler: ${CMAKE_CXX_COMPILER}")

# ── Kernel: pure numerical primitives ────────────────────────────────────────
add_library(sf_engine STATIC
    # Kernel layer — pure numerical primitives
    src/kernel/numerics/utils.cpp
    src/kernel/simulation/path.cpp
    src/kernel/simulation/sobol.cpp
    src/kernel/pricing/black_scholes.cpp
    src/kernel/pricing/monte_carlo.cpp
    src/kernel/pricing/binomial_lattice.cpp
    src/kernel/pricing/trinomial_lattice.cpp
    src/kernel/pricing/lsm_american.cpp
    src/kernel/pricing/greeks.cpp
    src/kernel/pricing/pde.cpp
    src/kernel/pricing/hedging.cpp
    src/kernel/pricing/implied_vol.cpp
    src/kernel/pricing/heston.cpp
    src/kernel/optimizer/nelder_mead.cpp
    src/kernel/stats/moments.cpp
    src/kernel/stats/stochastic_checks.cpp
    src/kernel/screener/option_filter.cpp
    src/kernel/screener/strategies.cpp
    # Engine layer — domain workflows
    src/engine/pricing_engine.cpp
    src/engine/scenario_engine.cpp
    src/engine/hedging_engine.cpp
    src/engine/validation_engine.cpp
    src/engine/utility_engine.cpp
    src/engine/calibration_engine.cpp
    src/engine/screener_engine.cpp
    # API layer — JSON parse + serialize + dispatch (single file)
    src/api/parser.cpp
)

# Linked into the shared library below, so it must be position-independent.
set_target_properties(sf_engine PROPERTIES POSITION_INDEPENDENT_CODE ON)

target_include_directories(sf_engine
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(sf_engine PUBLIC nlohmann_json::nlohmann_json OpenMP::OpenMP_CXX)

# ── C shared library: ABI entry + legacy shims ───────────────────────────────
add_library(sf_engine_c SHARED
    src/api/c_api.cpp
)

target_link_libraries(sf_engine_c PRIVATE sf_engine)
target_include_directories(sf_engine_c
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(sf_engine_c PRIVATE OpenMP::OpenMP_CXX)

# ── pip install (scikit-build-core, ../pyproject.toml): the library and the built workbench go into the package ──
if(SKBUILD)
    install(TARGETS sf_engine_c LIBRARY DESTINATION quantlab/_engine)
    install(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../static/ DESTINATION quantlab/static)
endif()
