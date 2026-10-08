# Concurrency bench

Standalone benchmarks (not part of the engine build, not linked into `sf_engine_c`)
for the concurrency code merged from Option-Pricing, and the evidence for why the
engine parallelises with OpenMP rather than a hand-written thread pool.

```bash
./run.sh            # builds into ./build, prints the tables below
QUICK=1 ./run.sh    # smaller sizes
```

## What is here

| File | Origin | Notes |
|---|---|---|
| `spsc_queue.hpp` | Option-Pricing `Queue/LockFreeQueue_multi.hpp` | Bounded lock-free single-producer / single-consumer queue (acquire / release). See below for what changed. |
| `ring_buffer.hpp` | Option-Pricing `Queue/RingBuffer.hpp` | Unsynchronised ring buffer; `LockedQueue` wraps it in a mutex as the baseline. |
| `thread_pool.hpp` | Option-Pricing `monteCarlo/monteCarlo_pool_mem.cpp` | Mutex + condition-variable task queue, plus `parallel_for`. |
| `queue_bench.cpp` | new | 1P/1C throughput; the consumer checks it receives 0, 1, 2, … in order. |
| `lsm_bench.cpp` | new | The engine's own LSM code (`engine/src/kernel/pricing/lsm_impl.h`) under serial / OpenMP / thread-pool executors. |

Not carried over: the compiled `lf` / `rb` binaries, the duplicate `Queue/raw/` copies,
and `Queue/LockFreeQueue.hpp`.

### Problems in the original queue code

- `LockFreeQueue.hpp` uses `volatile` indices and no atomics: a data race under the
  C++ memory model, and free to reorder on ARM (Apple Silicon). Its `USE_POT`
  `isFull` has an operator-precedence bug and its `USE_LOCK` branch does not compile.
  The shared-memory mode maps only the slots; head and tail stay in process memory,
  so it cannot work across processes. Not ported.
- `LockFreeQueue_multi.hpp` is a correct SPSC algorithm, but its test runs it with
  2 producers and 2 consumers, which races on head and tail. The test only counts
  messages, so it cannot notice lost or duplicated ones. Ported as SPSC only, with a
  power-of-two mask and head / tail on separate cache lines.
- `RingBuffer.hpp` has no synchronisation but its test shares it between two threads.
  Ported as the single-threaded core of a mutex-protected baseline.

## Results

AMD Ryzen 7 PRO 5850U (8 cores / 16 threads, laptop), GCC 15.2, `-O3` Release.

### Queue: 1 producer / 1 consumer, 10000000 uint64 messages, capacity 4096

| impl | ms | msgs/s | in-order check |
|---|---:|---:|---|
| spsc | 218.52 | 45763054 | true |
| locked | 565.90 | 17671076 | true |

### LSM American put (S=K=100, r=5%, sigma=20%, T=1, 50 exercise dates), best of 5

| paths | backend | threads | best ms | median ms | speed-up vs serial | peak RSS MiB | price |
|---:|---|---:|---:|---:|---:|---:|---|
| 50000 | serial | 1 | 73.90 | 75.70 | 1.00 | 24.2 | 6.0645050127586604 |
| 50000 | omp | 1 | 80.57 | 81.87 | 0.92 | 24.2 | identical |
| 50000 | omp | 2 | 50.31 | 52.98 | 1.47 | 24.3 | identical |
| 50000 | omp | 4 | 31.24 | 32.48 | 2.37 | 24.3 | identical |
| 50000 | omp | 16 | 15.12 | 22.11 | 4.89 | 24.4 | identical |
| 50000 | pool | 1 | 88.53 | 91.26 | 0.83 | 24.3 | identical |
| 50000 | pool | 2 | 53.88 | 54.92 | 1.37 | 24.4 | identical |
| 50000 | pool | 4 | 34.67 | 36.72 | 2.13 | 24.2 | identical |
| 50000 | pool | 16 | 27.44 | 29.75 | 2.69 | 24.3 | identical |
| 200000 | serial | 1 | 373.75 | 375.85 | 1.00 | 84.3 | 6.062038622121114 |
| 200000 | omp | 1 | 382.83 | 385.61 | 0.98 | 84.1 | identical |
| 200000 | omp | 2 | 245.60 | 246.22 | 1.52 | 84.4 | identical |
| 200000 | omp | 4 | 168.45 | 171.92 | 2.22 | 84.2 | identical |
| 200000 | omp | 16 | 110.22 | 114.24 | 3.39 | 84.3 | identical |
| 200000 | pool | 1 | 388.87 | 392.66 | 0.96 | 84.3 | identical |
| 200000 | pool | 2 | 252.45 | 254.09 | 1.48 | 84.3 | identical |
| 200000 | pool | 4 | 178.07 | 180.66 | 2.10 | 84.2 | identical |
| 200000 | pool | 16 | 149.07 | 152.43 | 2.51 | 84.2 | identical |
| 500000 | serial | 1 | 935.10 | 941.38 | 1.00 | 204.5 | 6.0523352999641302 |
| 500000 | omp | 1 | 969.17 | 971.68 | 0.96 | 204.4 | identical |
| 500000 | omp | 2 | 619.03 | 625.79 | 1.51 | 204.3 | identical |
| 500000 | omp | 4 | 433.16 | 435.99 | 2.16 | 204.3 | identical |
| 500000 | omp | 16 | 278.87 | 293.51 | 3.35 | 204.6 | identical |
| 500000 | pool | 1 | 972.15 | 978.35 | 0.96 | 204.7 | identical |
| 500000 | pool | 2 | 635.55 | 638.99 | 1.47 | 204.8 | identical |
| 500000 | pool | 4 | 450.18 | 452.21 | 2.08 | 204.6 | identical |
| 500000 | pool | 16 | 380.79 | 386.10 | 2.46 | 204.4 | identical |

## Reading the numbers

- **Determinism.** Every executor and thread count gives the bit-identical price.
  Each 1024-path chunk owns its RNG stream and its partial sums, and the sums are
  combined in chunk order, so the scheduling strategy cannot change the result.
- **OpenMP vs thread pool.** At 1–4 threads the pool is within 6% of OpenMP at
  200k–500k paths and within 11% at 50k. At 16 threads it takes about 1.35× as long
  at 200k–500k paths and 1.8× at 50k: one LSM valuation enters ~100
  parallel regions, and the pool pays a locked queue push, a `std::function`
  allocation and a condition-variable wake-up per chunk, where OpenMP reuses a
  persistent team with a static schedule.
- **Scaling** flattens at about 3.4× on 16 threads (4.9× at 50k paths, the
  smallest matrix): the 16 threads are 8 cores with SMT, the laptop clocks down
  as more cores run, and every exercise date streams the whole path matrix through
  memory, so the regression passes become bandwidth-bound.
- **Memory** does not depend on the executor. Peak RSS is the step-major path
  matrix, `paths × (steps + 1) × 8` bytes (≈ 204 MB for 500k × 51).
- **Queues.** The lock-free SPSC queue moves about 2.6× the messages of the
  mutex-protected ring buffer for one producer and one consumer, with both
  passing the in-order check.

**Why the engine uses OpenMP:** equal or better speed in every cell measured, no
thread lifecycle or task queue to maintain, and the same determinism guarantee as
long as work is split by fixed chunks. The thread pool earns its keep only for
irregular, long-lived task graphs, which the engine does not have.

Absolute timings vary run to run by roughly ±10%; the tables above are one run of
`./run.sh` (best of 5 per cell).
