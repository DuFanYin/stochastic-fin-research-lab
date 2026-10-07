# Concurrency benchmarks. Standalone: not part of the engine build and not
# linked into sf_engine_c. Build and run everything with ./run.sh.
cmake_minimum_required(VERSION 3.16)

if(APPLE AND NOT DEFINED CMAKE_CXX_COMPILER AND EXISTS "/opt/homebrew/opt/llvm/bin/clang++")
    set(CMAKE_CXX_COMPILER "/opt/homebrew/opt/llvm/bin/clang++" CACHE FILEPATH "C++ compiler" FORCE)
endif()

project(sf_concurrency_bench LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

find_package(OpenMP REQUIRED)
find_package(Threads REQUIRED)

add_executable(queue_bench queue_bench.cpp)
target_link_libraries(queue_bench PRIVATE Threads::Threads)

add_executable(lsm_bench lsm_bench.cpp)
# Header-only use of the engine's LSM core.
target_include_directories(lsm_bench PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../engine/src)
target_link_libraries(lsm_bench PRIVATE OpenMP::OpenMP_CXX Threads::Threads)
