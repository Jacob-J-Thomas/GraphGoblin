# Issue #18 routing handoff

Part of [#18](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/18), with review fixes for [PR #75](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/75), 2026-10-05. These changes build on `f7d2c8e` and remain uncommitted. Human approval has **not** been given. The issue stays open until the owner has tested the running product and recorded sign-off.

**One required gate remains red:** the three-repeat routing run passed 50 of 51 cases. One 100-node performance case exceeded the added-frame limit; its full measurements are retained below. The full Edge suite passed, but that does not supersede the repeated failure.

## Fixture screenshots

Refreshed from the built editor on headless Microsoft Edge, using an isolated in-memory API on an ephemeral port. The owner's instance was not used. Small fixtures are 1440 x 900; the dense overview is 1920 x 1800. Animation is paused for capture. Fixtures are shared with the geometry tests in `apps/web/src/__fixtures__/routing.ts`.

| Fixture                            | Dark                                                         | Light                                                          |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Simple loop                        | [simple-loop-dark.png](simple-loop-dark.png)                 | [simple-loop-light.png](simple-loop-light.png)                 |
| Nested loops                       | [nested-loops-dark.png](nested-loops-dark.png)               | [nested-loops-light.png](nested-loops-light.png)               |
| Decision back-route and self-loop  | [decision-back-route-dark.png](decision-back-route-dark.png) | [decision-back-route-light.png](decision-back-route-light.png) |
| Dense graph, 100 nodes / 200 edges | [dense-100-nodes-dark.png](dense-100-nodes-dark.png)         | [dense-100-nodes-light.png](dense-100-nodes-light.png)         |

**Forward smoothstep connections crossing cards in the nested and dense screenshots are outside the backward router.** Forward obstacle avoidance is outside #18's scope; these crossings are not evidence of a failed backward clearance check.

## Review fixes

| Review item                                  | Change and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. False overlapping warning for close cards | Retry smaller padding down to zero; only a port inside another real card is blocked. The independent geometry sweep checks every integer gap from 0 to 80 px, both flush ports and measured tips protruding 6 px. The browser continuously drags past a neighbour through an 8 px gap and observes both animation frames and DOM mutations for missing paths.                                                                                                                                        |
| 2. Lane order                                | Shortest horizontal port span first, id only breaks ties. The renamed `a-outer` / `z-inner` fixture still puts the inner lane inside the outer lane.                                                                                                                                                                                                                                                                                                                                                 |
| 3. Staircase detours                         | A* carries direction and charges 48 px per bend, with twice the cost for vertical travel. A deterministic property test covers 300 sparse graphs, checks independent geometry and requires no more than 12 bends.                                                                                                                                                                                                                                                                                    |
| 4. Shared vertical trunks                    | Reserve vertical segments and choose separate escape/entry columns in 12 px steps. Pairwise tests reject more than 4 px of shared vertical trunk, including two decision ports, the dense graph, columns and random graphs.                                                                                                                                                                                                                                                                          |
| 5. Exhausted lanes                           | At most 32 nearby candidates, penalised vertical travel, and lane spacing relaxed from 24 to 12 px, then sharing. Bidirectional 40/100/150-card columns with 80 px gaps keep every route's vertical bounding span below 400 px, with a 100 ms median warm-call CPU-work bound allowing coverage overhead and excluding time descheduled by other test workers. The browser applies the tighter drag budget.                                                                                          |
| 6. Add/undo flicker                          | Skip only unmeasured cards. Unchanged geometry snapshots and routes retain identity. Browser frame/mutation watchers cover adding a node, deleting it and undoing the deletion without losing the existing return path.                                                                                                                                                                                                                                                                              |
| 7. Large graphs / fallback                   | Reuse routes outside the moved card's old/new bounds; index card boxes in 256 px cells. A* is limited to a 64 x 64 grid and 2,048 expansions per attempt (at most three padding attempts), with reusable buffers. Tests check affected-span invalidation on 300 nodes, added/removed obstacles, enclosed ports and buffer identity. Actual 300-node measurements are below.                                                                                                                          |
| 8. Measurement / CI                          | Measure geometry preparation plus the entire cache miss, including comparisons, invalidation, routing and route identity checks. Assert routing p95 <8 ms and drag frame p95 minus idle frame p95 <4 ms. The manual Ubuntu Chromium workflow builds and runs only the performance cases, disables retries, writes all six results to the job summary and uploads JSON. YAML and its six-row summary script were exercised locally; remote dispatch remains for the orchestrator. Gates is unchanged. |
| 9. Handler identity                          | `onNodeClick` and `onPaneClick` use `useCallback`; Canvas tests check identity across renders.                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10. Direction boundary                       | Compare measured output/input tips with 8 px hysteresis, tested on either side of the boundary. Self-loops and `loopBack` always route backward.                                                                                                                                                                                                                                                                                                                                                     |
| 11. Actual contrast surfaces                 | Stroke/canvas and text/pill pairs match what is drawn. Existing text/raised-surface pairs cover labels; remove the two artificial text/canvas pairs. Counts are 97 text and 126 non-text; generated contrast and its tests pass.                                                                                                                                                                                                                                                                     |
| 12. Screenshot scope                         | Forward smoothstep crossings are identified above.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 13. Real clearance                           | Docs/09 and guide 02 state 32 px for open-space straight segments (24 px plus the 8 px corner allowance). Padding and radius shrink in tight gaps; 6 px between facing card bodies keeps the measured port tip out of its neighbour.                                                                                                                                                                                                                                                                 |

Canvas geometry channels update only affected paths without rebuilding xyflow's connection index. A geometry-only render also reuses the ReactFlow element. The authoring store, `onNodeDragStart` history boundary and move coalescing are unchanged. Component and browser tests retain one undo step per drag and restore the cleared `loopBack.targetNodeId` after Delete/Undo.

## Performance after review fixes

Local machine: Windows 11 Pro 10.0.26200, AMD Ryzen 5 3600 (6 cores / 12 logical processors), headless Edge 154.0.4258.53, 1440 x 900 viewport. Playwright's Desktop Chrome device profile supplies the user-agent string; the actual launched channel is `msedge`.

The final full Edge suite produced these three five-second drags at each size. All six passed the relative regression gate; absolute frame timing was not consistently below 16.7 ms. Full precision and sample counts: [100 nodes](performance-review-full-100.json), [300 nodes](performance-review-full-300.json).

| Nodes / edges | Drag | Routing p95 | Idle frame p95 | Drag frame p95 | Added frame p95 | Rerouted edges p95 |
| ------------- | ---- | ----------- | -------------- | -------------- | --------------- | ------------------ |
| 100 / 200     | 1    | 1.4 ms      | 16.8 ms        | 16.7 ms        | -0.1 ms         | 6                  |
| 100 / 200     | 2    | 1.2 ms      | 16.8 ms        | 16.7 ms        | -0.1 ms         | 6                  |
| 100 / 200     | 3    | 1.2 ms      | 16.8 ms        | 16.7 ms        | -0.1 ms         | 6                  |
| 300 / 600     | 1    | 3.9 ms      | 25.0 ms        | 24.9 ms        | -0.1 ms         | 6                  |
| 300 / 600     | 2    | 2.2 ms      | 25.0 ms        | 16.7 ms        | -8.3 ms         | 6                  |
| 300 / 600     | 3    | 2.6 ms      | 25.0 ms        | 16.8 ms        | -8.2 ms         | 6                  |

The required `routing.spec.ts --repeat-each=3 --retries=0` run then measured another nine drags per size. Each cell lists drags 1 / 2 / 3 in milliseconds; all six JSON reports are linked. **This run failed one performance case: 50 passed, 1 failed.** All 45 interaction/fixture cases passed.

| Nodes | Repeat / report                           | Routing p95 (three drags) | Drag frame p95 (three drags) | Idle frame p95 | Maximum added p95 | Minimum routing samples | Result   |
| ----- | ----------------------------------------- | ------------------------- | ---------------------------- | -------------- | ----------------- | ----------------------- | -------- |
| 100   | [1](performance-review-100-repeat-1.json) | 1.7 / 1.2 / 1.2           | 16.8 / 25.0 / 25.1           | 16.7           | 8.4               | 51                      | **Fail** |
| 100   | [2](performance-review-100-repeat-2.json) | 1.9 / 1.3 / 1.6           | 16.8 / 16.7 / 16.7           | 16.7           | 0.1               | 72                      | Pass     |
| 100   | [3](performance-review-100-repeat-3.json) | 1.6 / 1.3 / 1.4           | 16.8 / 16.7 / 16.8           | 16.8           | 0.0               | 164                     | Pass     |
| 300   | [1](performance-review-300-repeat-1.json) | 5.3 / 3.1 / 2.7           | 16.7 / 16.8 / 16.8           | 16.8           | 0.0               | 64                      | Pass     |
| 300   | [2](performance-review-300-repeat-2.json) | 3.2 / 2.9 / 3.0           | 16.8 / 16.8 / 16.8           | 16.8           | 0.0               | 141                     | Pass     |
| 300   | [3](performance-review-300-repeat-3.json) | 3.3 / 2.5 / 2.5           | 16.8 / 16.8 / 16.8           | 16.7           | 0.1               | 96                      | Pass     |

`performance.measure('gg:backward-routing')` includes snapshot preparation and the complete cache-miss computation; those CPU phases are summed without React's scheduling delay between them. The previous JSON key/parse round trip is gone. An observer requires all 100/300 measured nodes and 200/600 edges. Frame intervals use consecutive `requestAnimationFrame` timestamps during each five-second native pointer drag. Idle uses the same rendered graph for three seconds before dragging. All reported repetitions are retained; tests do not retry.

**Remaining performance failure:** repeat 1 at 100 nodes measured 25.0/25.1 ms frame p95 against 16.7 ms idle, adding 8.3/8.4 ms. Its third drag also collected only 51 routing samples (the guard requires more than 60). The test stopped at the added-frame assertion; the report preserves all three drags. Whole-cache-miss routing remained below 8 ms in every final measurement (100 nodes: 1.2-1.9 ms; 300 nodes: 2.2-5.3 ms). The later repeats passing does not erase this failure. Earlier development runs also failed the relative frame check when idle was about 8.4 ms and dragging about 16.7 ms. The original absolute <16.7 ms frame target is not established. These results show variable local frame delivery; they do not isolate its cause or establish a CI result.

The regression limits are **<8 ms routing p95** and **<4 ms added frame p95 over idle** at both graph sizes. The original <4 ms routing / <16.7 ms absolute frame targets are also assessed in the results, without a separate opt-in mode. Trace snapshots are disabled for this spec because serialising hundreds of canvas elements on each pointer input changes the measurement. Optional `GG_ROUTING_PROFILE=1` writes a Chrome CPU profile into the test output.

CI numbers are **pending**. [routing-perf.yml](../../../.github/workflows/routing-perf.yml) provides the requested `workflow_dispatch` job on Ubuntu with Playwright Chromium. The orchestrator triggers it after publication and records its numbers here. No CI timing or human approval is inferred from local tests.

Reproduce from the repository root:

```powershell
pnpm.cmd build
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:GG_ROUTING_SCREENSHOTS = '1'
pnpm.cmd --filter @graphgoblin/web test:e2e
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/routing.spec.ts --repeat-each=3 --retries=0
```

Set `GG_ROUTING_REPORT_DIR` to a separate directory to retain benchmark JSON independently of screenshots/test output.

## Algorithm and limits

The pure planner takes measured boxes/ports, connections, clearance and an optional prior plan. It sorts backward connections by increasing horizontal span, then id; reserves vertical trunks; and chooses a nearby horizontal lane. In crowded space it tries 12 px lane separation and then sharing instead of escalating to a remote lane. A full 32 px envelope is preferred; tight endpoints retry smaller padding down to zero, with correspondingly smaller corner radii. Only a port inside another real card is blocked. A direction-aware, bend-penalised A* handles obstructed escapes with bounded work and reusable storage. Every segment uses the spatial box index to avoid actual cards; the ordered point list and effective padding/radius remain independent of drawing.

For N cards, E edges and R backward routes, a single-card move scans snapshots/edges and sorts routes in O(N + E + R log R); unchanged routes are reused and reserved. Candidate collection/sorting is O((N + R) log(N + R)) in the worst case for each invalidated edge, but the subsequent search considers only 32 lane values, three spacing choices and bounded escape alternatives. Each indexed collision query depends on the cells and nearby boxes it visits (worst case N); vertical reservation queries inspect only segments on that column (worst case R). Each fallback has at most 8,192 direction states and 2,048 expansions per attempt, up to three attempts; its typed buffers are retained by the canvas. A topology change replans all connections. These bounds avoid the previous unbounded search but are not a guarantee that every possible maze has a discovered route.

`Port covered by a card; move the card` describes a real covered port. `No clear route; move a card` describes an enclosed endpoint or exhausted bounded search. Both remain focusable/selectable/deletable through their label. At zero padding corners may be square. Crowded horizontal lanes may share; vertical trunks stay separate. Shared endpoint stubs necessarily meet at the same handle, and routes can cross other routes.

No dependency was added; the permissive licence gate still checks 225 packages. `BackwardEdge` retains the animated dash, labels, hit target, keyboard focus, selection, Delete and Undo in both themes, forced colours and reduced motion. Forward edges retain their existing smoothstep paths. #44 can replace the returned ordered points before drawing; waypoint UI, storage, editing, validation and undo remain for #44.

## Gates and remaining verification

Passed: root `typecheck`, `lint`, `build`, `format:check`, `check:tokens` (117 files), `check:contrast` (zero failing pairs), `check:layers`, `check:licenses` (225 packages), `check:docs`, and Node 22 `check:deps` (456 modules / 1,636 dependencies). Final web typecheck/lint also passed after the unit timing guard adjustment. `node --test tooling/scripts/design-contrast.test.mjs` passed all 6 tests; tooling's coverage command passed all 44 tests.

Web coverage: **612 tests / 65 files passed**, **99.12% statements, 96.60% branches, 99.33% functions, 99.74% lines**, with thresholds and exclusions unchanged. See [web-coverage-review.json](web-coverage-review.json). Tooling coverage: **95.26% statements, 94.83% branches, 98.11% functions, 95.21% lines**, including every executable tooling module; see [tooling-coverage-review.json](tooling-coverage-review.json). Tooling's Node tests and gate/config executions were captured with V8 and mapped with the already installed Vitest AST converter; no dependency or coverage exclusion was added.

The full built-app Edge suite passed **158 tests**, with **one opt-in live-provider test skipped**, in 7.8 minutes. The routing file repeated three times passed **50 of 51 cases** in 6.1 minutes, with the performance failure recorded above. There were no E2E retries. Both new frame/DOM continuity checks passed in the full suite and all three repeats. All eight screenshots were regenerated; the small fixtures and dense overview were visually inspected in both themes.

Non-clean output: the first coverage run's 150-card unit timing guard measured 122.1 ms wall time against 100 ms while other gates were active; the file passed alone. A two-worker rerun hit the same guard and was cancelled after not completing. The unit guard now bounds CPU work, excluding worker descheduling, and the final full coverage run passed at normal worker settings. The browser wall-clock limits remain unchanged. Root Turbo emitted shared-cache permission warnings; dependency-cruiser reported the two existing configuration-file orphan warnings; Playwright emitted `NO_COLOR`/`FORCE_COLOR` warnings. The stronger repeated frame gate remains red as detailed above.

The generated `apps/web/coverage/` directory was removed after saving the coverage summary. Git index and branch were not changed; implementation and QA artifacts remain uncommitted.

Historical files from the original implementation (`performance.json`, `performance-strict.json`, `performance-full-suite.json`, `performance-before-node-reuse.json`, `web-coverage.json`, `tooling-coverage.json`) describe the pre-review revision. The `performance-review-before-channels-*.json` files record an intermediate review-fix revision that failed the frame check; they are not final measurements.

The cross-vendor re-review, CI workflow run, and human screenshot/running-product sign-off remain external handoff steps. None has been claimed here.
