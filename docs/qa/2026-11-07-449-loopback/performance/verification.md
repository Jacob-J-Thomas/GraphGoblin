# Bounded routing allocation correction

Base head: `01c39c4290cf1884147d73d89a854b9380a01b61`.
Worktree: `C:/Users/98jak/.codex/worktrees/gg-20261107-loopback/GraphGoblin`.
Node: `v22.23.4`, selected first on PATH. All package commands used `pnpm.cmd`.

Only `apps/web/src/editor/routing.ts` changed: 11 added lines and 3 removed lines. A private `reservationsIntersect` function visits the same reservation arrays and boxes in insertion order, returning at the first footprint intersection. It replaces a per-candidate map spread and nested callbacks. The diff changes neither dependency footprints nor routing decisions, geometry, classification, animation, thresholds, workflow selection or retries. No new test was added because the existing public-planner tests establish fresh/incremental and reservation invalidation behavior.

## Verification

Command:

```powershell
pnpm.cmd --filter @graphgoblin/web test src/editor/routing.test.ts src/editor/routing-review.test.ts src/editor/routing-manual.test.ts src/editor/useRouting.test.ts
```

Actual result: 4 files passed; 55 tests passed; duration 52.12 seconds. The test set includes fresh-versus-incremental drag samples, changed span order, returned positions and manual-reservation invalidation.

The following also completed successfully:

```powershell
pnpm.cmd exec eslint apps/web/src/editor/routing.ts
pnpm.cmd --filter @graphgoblin/web typecheck
pnpm.cmd exec prettier --check apps/web/src/editor/routing.ts
git diff --check -- apps/web/src/editor/routing.ts
```

## One bounded paired CPU diagnostic

`paired-benchmark.mjs` imported preserved before/after router copies and the production `routingInput(denseGraph(300))` fixture. Only relative import specifiers in the executable copies were rewritten to absolute file URLs. The exact source bytes remain in `routing-before-original.ts` and `routing-after-original.ts`; the original before file's SHA256 matches the untouched worktree source before editing.

Command:

```powershell
pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development C:/Users/98jak/graphgoblin-qa/2026-11-07-loopback/performance-correction-01c39c42/paired-benchmark.mjs
```

Three blocks each ran 20 warmup steps and 80 measured steps, alternating which variant ran first at every identical drag position. Each variant retained its own persistent `SearchWorkspace`. The timed interval included only `createRoutingPlan`, excluding input cloning, equality/hashing, geometry collection, labels, React, DOM, rendering and CSS animation. This is a Node CPU diagnostic, not browser acceptance or the browser timing gate.

Routes, directions, suspended edge IDs and all planner statistics matched at all 300 paired positions, including warmups. Both aggregate fingerprints were `c443b6f1a924249396f2e902a09d628fe0a2c76c5865214e6af9f37dfc27b9d3`.

| Planner | Samples |      p50 |      p95 |
| ------- | ------: | -------: | -------: |
| Before  |     240 | 5.336 ms | 8.892 ms |
| After   |     240 | 5.137 ms | 9.592 ms |

The median paired after-minus-before difference was -0.149 ms. Block 1 p95 increased from 9.699 to 10.836 ms; blocks 2 and 3 fell slightly from 7.237 to 7.137 ms and 7.277 to 7.193 ms. The whole-run p95 was worse. This supports at most a small typical-cost reduction, with no demonstrated tail-budget fix. The single planned diagnostic was not repeated to obtain favorable numbers.

Host CPU snapshots were 66% at initial admission, 37% before editing, 12% before the benchmark and 33% after it. These are discrete snapshots, not continuous profiling or an attribution of the timing variance. Unit/static checks had finished before the benchmark. No unrelated process was stopped. No local full browser suite, owner service, protected store, real provider, secret, commit or push was used.

`paired-benchmark.json` retains every timing/statistics sample; `paired-benchmark.log` retains console output; the host JSON files, original and executable router bytes, harness and `routing.diff` retain provenance. Unchanged browser/CI performance acceptance remains unestablished for this delta; the unrelated shutdown issue #421 remains out of scope.
