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

Apple M1 Pro (6 performance + 2 efficiency cores), Homebrew LLVM clang, `-O3` Release.

### Queue: 1 producer / 1 consumer, 10000000 uint64 messages, capacity 4096

| impl | ms | msgs/s | in-order check |
|---|---:|---:|---|
| spsc | 294.49 | 33957063 | true |
| locked | 407.34 | 24549662 | true |

### LSM American put (S=K=100, r=5%, sigma=20%, T=1, 50 exercise dates), best of 5

| paths | backend | threads | best ms | median ms | speed-up vs serial | peak RSS MiB | price |
|---:|---|---:|---:|---:|---:|---:|---|
| 50000 | serial | 1 | 63.35 | 66.66 | 1.00 | 22.2 | 6.0645050127586604 |
| 50000 | omp | 1 | 66.65 | 72.81 | 0.95 | 22.0 | identical |
| 50000 | omp | 2 | 35.00 | 37.51 | 1.81 | 22.7 | identical |
| 50000 | omp | 4 | 19.99 | 21.31 | 3.17 | 22.8 | identical |
| 50000 | omp | 8 | 18.96 | 20.44 | 3.34 | 22.9 | identical |
| 50000 | pool | 1 | 66.54 | 67.11 | 0.95 | 21.7 | identical |
| 50000 | pool | 2 | 34.87 | 35.74 | 1.82 | 21.8 | identical |
| 50000 | pool | 4 | 20.91 | 21.50 | 3.03 | 21.8 | identical |
| 50000 | pool | 8 | 21.90 | 22.67 | 2.89 | 21.8 | identical |
| 200000 | serial | 1 | 259.94 | 265.17 | 1.00 | 84.0 | 6.062038622121114 |
| 200000 | omp | 1 | 263.76 | 265.81 | 0.99 | 84.4 | identical |
| 200000 | omp | 2 | 133.78 | 134.69 | 1.94 | 84.5 | identical |
| 200000 | omp | 4 | 71.60 | 72.20 | 3.63 | 84.5 | identical |
| 200000 | omp | 8 | 63.78 | 66.54 | 4.08 | 84.7 | identical |
| 200000 | pool | 1 | 259.32 | 260.01 | 1.00 | 81.8 | identical |
| 200000 | pool | 2 | 134.73 | 136.56 | 1.93 | 84.1 | identical |
| 200000 | pool | 4 | 75.84 | 77.58 | 3.43 | 84.2 | identical |
| 200000 | pool | 8 | 58.52 | 60.84 | 4.44 | 84.2 | identical |
| 500000 | serial | 1 | 630.67 | 632.31 | 1.00 | 203.9 | 6.052335299964132 |
| 500000 | omp | 1 | 649.15 | 651.34 | 0.97 | 204.3 | identical |
| 500000 | omp | 2 | 331.13 | 332.84 | 1.90 | 204.3 | identical |
| 500000 | omp | 4 | 172.58 | 173.52 | 3.65 | 204.4 | identical |
| 500000 | omp | 8 | 144.55 | 155.08 | 4.36 | 204.6 | identical |
| 500000 | pool | 1 | 648.24 | 649.45 | 0.97 | 202.1 | identical |
| 500000 | pool | 2 | 336.12 | 349.80 | 1.88 | 204.1 | identical |
| 500000 | pool | 4 | 185.83 | 186.90 | 3.39 | 204.1 | identical |
| 500000 | pool | 8 | 140.70 | 143.70 | 4.48 | 204.1 | identical |

## Reading the numbers

- **Determinism.** Every executor and thread count gives the bit-identical price.
  Each 1024-path chunk owns its RNG stream and its partial sums, and the sums are
  combined in chunk order, so the scheduling strategy cannot change the result.
- **OpenMP vs thread pool.** Within noise of each other at 200k–500k paths. At 50k
  paths and 8 threads the pool is about 15% slower: one LSM valuation enters ~100
  parallel regions, and the pool pays a locked queue push, a `std::function`
  allocation and a condition-variable wake-up per chunk, where OpenMP reuses a
  persistent team with a static schedule.
- **Scaling** flattens at about 4.4× on 8 threads: two of the eight cores are
  efficiency cores, and every exercise date streams the whole path matrix through
  memory, so the regression passes become bandwidth-bound.
- **Memory** does not depend on the executor. Peak RSS is the step-major path
  matrix, `paths × (steps + 1) × 8` bytes (≈ 204 MB for 500k × 51).
- **Queues.** The lock-free SPSC queue moves about 1.4× the messages of the
  mutex-protected ring buffer for one producer and one consumer, with both
  passing the in-order check.

**Why the engine uses OpenMP:** equal or better speed at every size measured, no
thread lifecycle or task queue to maintain, and the same determinism guarantee as
long as work is split by fixed chunks. The thread pool earns its keep only for
irregular, long-lived task graphs, which the engine does not have.

Absolute timings vary run to run by roughly ±10%; the tables above are one run of
`./run.sh` (best of 5 per cell).
