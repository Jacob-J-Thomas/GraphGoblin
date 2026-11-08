# Existing-grid lookup correction and frozen handoff

Base head: `01c39c4290cf1884147d73d89a854b9380a01b61`.
Worktree: `C:/Users/98jak/.codex/worktrees/gg-20261107-loopback/GraphGoblin`.
Source is frozen for root's commit, publication, narrow opposite-family review and unchanged Browser acceptance. No commit, push, Browser rerun, threshold change, workflow change or unrelated process termination was performed by this worker.

## Hypothesis and exact scope

The single original-router CPU profile retained in `original-router.cpuprofile` identified `BoxIndex.clear` at 16.8% self time. After the candidate-preparation correction's small and variable tail improvement, root authorized one distinct experiment at this existing grid seam.

`BoxIndex` now stores its existing cells in nested numeric x/y Maps instead of constructing comma-separated string keys. `clear` hoists the x-column lookup outside its y loop. The 256px grid, floor coordinates, x-major/y-minor visitation, original per-cell arrays and insertion order are retained. No box visit is deduplicated in the grid. Query results retain the original identity-based Set behavior, including distinct boxes that share an ID. Own-card, handle and exempt filtering, query checks, footprint regions and footprint-read calls are unchanged. No bounds, search policy, consulted region or dependency footprint was narrowed.

The two earlier corrections remain: direct candidate Set/ranking loops in place of transient arrays, and short-circuit iteration of changed reservations. Only these three repository files are modified:

| File                                         | Added | Removed |
| -------------------------------------------- | ----: | ------: |
| `apps/web/src/editor/routing.ts`             |    28 |      15 |
| `apps/web/src/editor/routing-geometry.ts`    |    17 |      10 |
| `apps/web/src/editor/routing-review.test.ts` |    66 |       2 |
| Total                                        |   111 |      27 |

Source-only changes total 45 added / 25 removed lines. Test changes total 66 added / 2 removed lines. `routing-grid.diff` retains the complete exact diff.

## Tests and static checks

The existing routing, routing-review, routing-manual and useRouting test files passed: **58 tests in 4 files**, duration 27.24 seconds. This includes all prior fresh-versus-incremental routing cases and three new direct index tests covering:

- Cell-order query results across negative coordinates and 256px boundaries; repeated object identity versus distinct objects sharing an ID.
- Collision, own-card, handle and exempt behavior with exact footprint-touch calls and check counters.
- Negative grid boundaries, signed-zero cell identity and empty-cell queries.

Focused ESLint on all three changed files, web typecheck, Prettier checks and `git diff --check` passed. Commands use the project Node `v22.23.4` first on PATH and `pnpm.cmd`. No further tests or measurements were run after root requested the source freeze.

## One original-versus-final paired diagnostic

`paired-grid-benchmark.mjs` retains the same deterministic production `routingInput(denseGraph(300))` workload and paired protocol as the previous diagnostics. It compares the untouched original router **and preserved original geometry** with the final router and final geometry. The baseline executable explicitly imports the original geometry snapshot, so it does not accidentally share the optimized index from the current source tree. Other helper implementations are unchanged.

Each variant ran 240 measured planner intervals across three interleaved blocks, with 20 warmup steps and 80 recorded steps per block. Each used its own persistent `SearchWorkspace`; execution order alternated at each identical drag position. Input cloning, equality/hashing, geometry selection, labels, React, DOM, rendering and animation were outside the measured interval.

All 300 paired states, including warmups, produced identical routes, directions, suspended edge IDs and operation counters. Both aggregate fingerprints remain `c443b6f1a924249396f2e902a09d628fe0a2c76c5865214e6af9f37dfc27b9d3`.

| Planner                  | Samples |      p50 |       p95 |
| ------------------------ | ------: | -------: | --------: |
| Original                 |     240 | 5.361 ms | 13.908 ms |
| Final combined candidate |     240 | 3.950 ms |  9.170 ms |

The combined candidate's p50 was 26.3% lower and p95 34.1% lower. The median paired after-minus-before difference was -1.269 ms. Every block improved at both percentiles:

| Block | Before p50 | After p50 | Before p95 | After p95 |
| ----- | ---------: | --------: | ---------: | --------: |
| 1     |   5.592 ms |  4.097 ms |  13.908 ms | 10.214 ms |
| 2     |   5.179 ms |  3.983 ms |   7.681 ms |  6.185 ms |
| 3     |   5.347 ms |  3.905 ms |  14.002 ms |  5.994 ms |

These are results from the one new paired run, not selected reruns. The result supports advancing the combined candidate to real Browser acceptance. **It does not establish the unchanged Browser timing gate.** These Node percentiles cannot be substituted for that gate. Host CPU was 59% in the snapshot at 16:44:37 UTC; the diagnostic ran 16:44:38–16:44:44 UTC. A later snapshot at 16:45:33 UTC was 6%. These are discrete snapshots, not continuous profiling or causal attribution of the timing variance.

## Preserved artifacts and hashes

Earlier original, tiny-patch and two-optimization source bytes and benchmark results remain untouched. `routing-grid-twoopt-original.ts` separately preserves the candidate immediately before the grid change.

- Original router bytes: `routing-before-original.ts`, SHA256 `57950f36bd9c1a899df41fbedfdff597e7aae24aa5b3f4038db8a4fb3bc6c587`.
- Final router bytes: `routing-grid-after-original.ts`, SHA256 `dfd5b4298cf82cddd8efbbdb9d15f3e95f8c4888fadf2d3f6994628a109604e5`.
- Original geometry bytes: `routing-geometry-before-original.ts`, SHA256 `af2964de4615a8b5948037eecc38fca415f0dc8f2e93e6ad6269bfc485a552b2`.
- Final geometry bytes: `routing-geometry-after-original.ts`, SHA256 `54071f4449391b76af77f2a115da761d7584b4b9f49d28a3e360f10acc181744`.

Executable router copies only rewrite import paths to absolute file URLs. The geometry executable copies retain their original bytes. `paired-grid-benchmark.json` holds every measured sample and statistic; `.mjs` retains the harness and `.log` retains console output. `host-before-grid-benchmark.json` and `host-after-grid-benchmark.json` retain the CPU snapshots.

No further source correction or measurement is planned by this worker. Root owns the unchanged Browser gate, full gates and narrow opposite-family review. The existing unrelated shutdown issue #421 remains outside this task.
