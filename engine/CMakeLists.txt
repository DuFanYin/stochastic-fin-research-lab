cmake_minimum_required(VERSION 3.16)

# On macOS, prefer Homebrew LLVM for OpenMP support.
# This only applies when caller did not explicitly set compilers.
if(APPLE AND NOT DEFINED CMAKE_CXX_COMPILER AND EXISTS "/opt/homebrew/opt/llvm/bin/clang++")
    set(CMAKE_CXX_COMPILER "/opt/homebrew/opt/llvm/bin/clang++" CACHE FILEPATH "C++ compiler" FORCE)
endif()

project(stochastic_finance_engine LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenMP)

if(OpenMP_CXX_FOUND)
    message(STATUS "OpenMP enabled with compiler: ${CMAKE_CXX_COMPILER}")
else()
    message(WARNING "OpenMP not found. Build will run single-threaded.")
endif()

add_library(sf_engine STATIC
    src/models/model_core.cpp
    src/models/model_components.cpp
    src/pricing/monte_carlo.cpp
    src/pricing/black_scholes.cpp
    src/pricing/binomial_lattice.cpp
    src/pricing/pricing_components.cpp
    src/hedging/delta_hedging.cpp
    src/hedging/backtest.cpp
    src/stats/moments_core.cpp
    src/stats/stats_components.cpp
    src/utils/utils_core.cpp
)

target_include_directories(sf_engine
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if(OpenMP_CXX_FOUND)
    target_link_libraries(sf_engine PUBLIC OpenMP::OpenMP_CXX)
endif()

add_library(sf_engine_c SHARED
    src/c_api.cpp
)

target_link_libraries(sf_engine_c PRIVATE sf_engine)
target_include_directories(sf_engine_c
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if(OpenMP_CXX_FOUND)
    target_link_libraries(sf_engine_c PRIVATE OpenMP::OpenMP_CXX)
endif()

