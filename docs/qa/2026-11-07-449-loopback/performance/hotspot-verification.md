# One profile and one distinct hotspot correction

This follows `verification.md`; its original source bytes and first diagnostic remain unchanged. Base head remains `01c39c4290cf1884147d73d89a854b9380a01b61`. Only `apps/web/src/editor/routing.ts` is modified in the worktree; the final combined delta is 28 added lines and 15 removed lines. No commit, push, browser rerun, threshold change or unrelated process termination was performed.

## Original-router profile

One Node inspector CPU profile ran the preserved original router with `routingInput(denseGraph(300))`, a persistent `SearchWorkspace` and precomputed versions of the same center-card sinusoidal drag geometry. Imports and 100 warmup calls completed before profiling 400 planner calls. Timed planner work lasted 2314.073 ms; the profile retained 1446 samples at a requested 1000-microsecond interval. `profile-original.mjs`, `original-router.cpuprofile`, `original-profile-summary.json`, `analyze-profile.mjs` and `profile-functions.json` retain the harness, raw profile and attribution.

| Function                | Self share | Inclusive share |
| ----------------------- | ---------: | --------------: |
| `BoxIndex.clear`        |      16.8% |           16.8% |
| `routeOne`              |      13.6% |           56.0% |
| `candidates`            |      10.6% |           15.1% |
| `reservationDifference` |       0.9% |            1.9% |

Inclusive samples overlap and must not be added. The sample pool also includes profiler/native/transpiler overhead and garbage collection. This is attribution within a Node diagnostic, not a browser measurement. Total host CPU was 75% in the snapshot before profiling.

The profile showed candidate preparation as a larger concrete hotspot than reservation difference handling. The one additional correction replaces `candidates`' per-card and per-lane `flatMap` arrays, aggregate spreads and intermediate filtering array with direct loops into the same insertion-ordered `Set`, then the same range filter, travel values, comparator and output mapping. It changes no obstacle/reservation query or dependency footprint. The initial reservation Map iteration cleanup remains included.

## Verification after the hotspot change

The same four public-planner unit files passed again: 55 tests in 4 files, duration 27.55 seconds. Focused ESLint, web typecheck, Prettier check and `git diff --check` all passed. Commands are retained in `verification.md`; no new helper export or implementation-mirroring test was introduced.

## One new paired timing diagnostic

`paired-candidates-benchmark.mjs` uses the same protocol as the first harness and compares the untouched original router with the final router. It retains separate final original bytes and import-only executable copies as `routing-candidates-original.ts` and `routing-candidates.ts`; `routing-candidates.diff` holds the exact combined delta. No prior before/after artifact was overwritten.

Each variant ran 240 measured samples across three interleaved blocks, with 20 warmup steps and 80 recorded steps per block. Execution order alternated at each paired position. Each variant used a separate persistent `SearchWorkspace`. Routes, directions, suspended IDs and all operation counters matched at all 300 paired states, including warmups. Both fingerprints are `c443b6f1a924249396f2e902a09d628fe0a2c76c5865214e6af9f37dfc27b9d3`.

| Planner  | Samples |      p50 |      p95 |
| -------- | ------: | -------: | -------: |
| Original |     240 | 5.002 ms | 7.747 ms |
| Final    |     240 | 4.561 ms | 7.666 ms |

The median paired after-minus-before difference was -0.344 ms. Overall p50 fell about 8.8%; overall p95 fell about 1.0%. Every block's median improved. Block p95s were 9.578→9.149 ms, 7.156→6.881 ms and 7.145→7.579 ms, so the last block's p95 was worse. Host CPU snapshots were 51% before and 69% after this run; these are discrete samples, not continuous contention attribution. All own unit/static checks had completed before timing.

The result supports lower typical planner cost at a profiled hotspot. It does not establish a reliable tail-budget reduction or satisfy the browser gate. This diagnostic excludes geometry collection, labels, React, DOM, rendering and animation. No further benchmark repetition or optimization was attempted after this distinct hypothesis. Collision checking remains untouched; its original-profile cost is a remaining possible bottleneck, not a post-change profile conclusion.

Final original source SHA256: `dfd5b4298cf82cddd8efbbdb9d15f3e95f8c4888fadf2d3f6994628a109604e5`.

The original Browser failures and the unrelated shutdown issue #421 remain recorded. Root owns review, commits, publication and unchanged browser/CI acceptance.
