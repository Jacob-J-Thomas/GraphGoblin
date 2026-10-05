# #18 backward-routing QA handoff

Part of [#18](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/18), [PR #75](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/75). Second review fixes, 2026-10-05, built on `d222267` after `c7e77f9`. Changes remain uncommitted. Human screenshot and running-product approval are still required; this issue stays open until the owner records sign-off.

## Fixture screenshots

Captured from the built app on headless Microsoft Edge, with an isolated in-memory API on an ephemeral port. The owner's instance was not used. Small fixtures are 1440 x 900; the dense overview is 1920 x 1800. Animation is paused for capture. The fixtures live in `apps/web/src/__fixtures__/routing.ts`.

| Fixture                            | Dark                                 | Light                                  |
| ---------------------------------- | ------------------------------------ | -------------------------------------- |
| Simple loop                        | [dark](simple-loop-dark.png)         | [light](simple-loop-light.png)         |
| Nested loops                       | [dark](nested-loops-dark.png)        | [light](nested-loops-light.png)        |
| Decision back-route and self-loop  | [dark](decision-back-route-dark.png) | [light](decision-back-route-light.png) |
| Dense graph, 100 nodes / 200 edges | [dark](dense-100-nodes-dark.png)     | [light](dense-100-nodes-light.png)     |
| Six returns from one decision      | [dark](six-return-decision-dark.png) | [light](six-return-decision-light.png) |
| 8 px neighbour gap                 | [dark](eight-pixel-gap-dark.png)     | [light](eight-pixel-gap-light.png)     |

**Forward smoothstep connections crossing cards in the nested, dense and tight-gap screenshots are outside the backward router.** Forward obstacle avoidance remains outside #18. The six-return and tight-gap images, and the dense overview, were visually inspected in both themes. Edge also checks actual SVG pill rectangles against each other and every card in all twelve captures.

## Review fixes

Evidence: [router/property tests](../../../apps/web/src/editor/routing-review.test.ts), [Edge spec](../../../apps/web/e2e/routing.spec.ts), and [workflow](../../../.github/workflows/routing-perf.yml).

| Second-review finding                                 | Change and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Major: shared lanes win on cost; labels overlap       | Spacing is a strict priority: exhaust feasible 24 px candidates before 12 px, then 0 px. This applies to ordinary routes and detour lane placement. Labels reserve disjoint 22 px high envelopes and move along the straight lane; limited space can shorten text while preserving its title/name. Six decision returns have six separate lanes in unit tests and both Edge themes. The seeded property suite checks candidate availability for compressed six-point routes and label/card separation across 300 graphs: more than 1,500 labelled routes, more than 100 alternative candidates, zero violations. |
| 1. Flaky CPU-time assertion                           | Removed wall/CPU timing from the column test. At 40, 100 and 150 cards it asserts exactly `2 * (count - 1)` rerouted edges, zero A* expansions, and every padded vertical bounding span below 400 px. Full web coverage passed twice after the work-pruning change.                                                                                                                                                                                                                                                                                                                                              |
| 2. Tight neighbour reduces the whole lane's clearance | Only the endpoint approaches shrink. The central lane retains 32 px stand-off; a narrow multi-bend approach must reach a full-clearance segment. Unit gaps 8 through 16 px check lane clearance and visible label bounds. The two 8 px screenshots check the actual measured gap and pill position. The existing 0-80 px sweep and continuous tight-gap drag remain green.                                                                                                                                                                                                                                       |
| 3. Drag-history-dependent lanes                       | Replay the same span/id order as a fresh plan. Cache footprints include rejected candidates; old/new predecessor reservations invalidate dependent choices, including labels. Cost bounds exclude distant candidates that cannot beat a full-clearance/full-spacing winner. Four move-and-return sequences on 300 nodes and thirty seeded sparse move-and-return sequences equal fresh results; the dense cases change span order as well as positions.                                                                                                                                                          |
| 4. Minimum-gap documentation                          | Docs/09 and guide 02 now say 8 px between facing card bodies, and distinguish approach padding from the full 32 px lane clearance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5. Workflow                                           | `routing-perf.yml` retains manual dispatch and adds pull-request filters for `apps/web/src/editor/**` and `apps/web/e2e/routing.spec.ts`. Ubuntu installs `msedge` with dependencies and uses that channel in strict mode. Local YAML assertions and the actual six-row job-summary script pass. The Gates workflow is unchanged. Remote execution remains pending.                                                                                                                                                                                                                                              |
| Nit: 80 returns exhaust the columns                   | Remove the rank-seven column cap while retaining a bounded set of escape alternatives. The 80-return test requires at least 40 available routes, no shared vertical trunks and no overlapping labels, including compressed/shared lanes.                                                                                                                                                                                                                                                                                                                                                                         |

Round-one guarantees remain covered: shortest-span-first nested returns even with renamed ids, orthogonal segments, padded lanes, no actual-card intersections, no shared vertical trunks, at most twelve bends in the seeded fixtures, covered-port versus unavailable-route messages, unmeasured-node continuity, selection/Delete/Undo, both themes, forced colours and reduced motion. Routing does not touch the authoring store, `onNodeDragStart` or drag coalescing. One drag remains one undo step. Stroke/canvas and text/pill contrast pairs are unchanged; no new dependency or colour was added.

## Performance after the second review

Local host: Windows 11 Pro 10.0.26200, AMD Ryzen 5 3600 (6 cores / 12 logical processors), headless Edge 154.0.4258.53, 1440 x 900 viewport. The Playwright project is named `chromium`, but the launched channel and reported browser are Microsoft Edge.

Each row contains three five-second native pointer drags. Whole-cache-miss `gg:backward-routing` measurements include geometry preparation, invalidation, planning and identity checks. Frame p95 uses `requestAnimationFrame`; idle uses the same graph for three seconds before dragging. Full precision and sample counts are in the linked JSON. All repetitions are retained, with no retries.

| Nodes / edges | Run / raw report                                                                  | Routing p95, drags 1 / 2 / 3 (ms) | Idle p95 (ms) | Drag frame p95, 1 / 2 / 3 (ms) | Added frame p95, 1 / 2 / 3 (ms) |
| ------------- | --------------------------------------------------------------------------------- | --------------------------------- | ------------- | ------------------------------ | ------------------------------- |
| 100 / 200     | [Full suite](second-review/full-suite-final/performance-review-100-repeat-1.json) | 2.9 / 2.9 / 2.7                   | 16.7          | 16.7 / 16.7 / 16.7             | 0.0 / 0.0 / 0.0                 |
| 300 / 600     | [Full suite](second-review/full-suite-final/performance-review-300-repeat-1.json) | 4.3 / 3.8 / 4.5                   | 16.7          | 16.7 / 16.7 / 16.7             | 0.0 / 0.0 / 0.0                 |
| 100 / 200     | [Repeat 1](second-review/repeated/performance-review-100-repeat-1.json)           | 2.7 / 2.4 / 2.8                   | 16.7          | 16.7 / 16.7 / 16.7             | 0.0 / 0.0 / 0.0                 |
| 100 / 200     | [Repeat 2](second-review/repeated/performance-review-100-repeat-2.json)           | 2.9 / 2.4 / 2.4                   | 16.7          | 16.7 / 16.7 / 16.7             | 0.0 / 0.0 / 0.0                 |
| 100 / 200     | [Repeat 3](second-review/repeated/performance-review-100-repeat-3.json)           | 2.9 / 2.9 / 2.6                   | 16.7          | 16.7 / 16.7 / 16.7             | 0.0 / 0.0 / 0.0                 |
| 300 / 600     | [Repeat 1](second-review/repeated/performance-review-300-repeat-1.json)           | 3.9 / 3.9 / 4.3                   | 16.6          | 16.7 / 16.7 / 16.7             | 0.1 / 0.1 / 0.1                 |
| 300 / 600     | [Repeat 2](second-review/repeated/performance-review-300-repeat-2.json)           | 3.9 / 3.7 / 3.2                   | 8.5           | 16.7 / 16.7 / 16.7             | 8.2 / 8.2 / 8.2                 |
| 300 / 600     | [Repeat 3](second-review/repeated/performance-review-300-repeat-3.json)           | 4.1 / 3.7 / 3.6                   | 8.5           | 16.7 / 16.7 / 16.7             | 8.2 / 8.2 / 8.2                 |

The local regression gate always enforces routing p95 <8 ms, more than 60 routing samples, and more than 120 frame samples. The orchestrator's `GG_ROUTING_STRICT_PERF=1` condition for the <4 ms added-frame gate is preserved. The Ubuntu Edge workflow sets it; local runs record the added-frame numbers without asserting that condition. Final 100-node routing p95 stayed below 4 ms. The 300-node extension reached 4.5 ms; all final routing values were below the 8 ms regression bound. Frame p95 was about 16.7 ms. Some repeated runs added about 8.2 ms over an 8.5 ms idle baseline, exceeding the opt-in 4 ms added-frame limit. The original strict <16.7 ms absolute frame target is not established. CI numbers remain pending; the orchestrator can dispatch the workflow after publication and add its job-summary results here.

An intermediate full suite failed the 300-node routing bound at **8.4 ms p95** (167 passed, 1 failed, 1 opt-in live-provider skip). Its [100-node](second-review/full-suite/performance-review-100-repeat-1.json) and [300-node](second-review/full-suite/performance-review-300-repeat-1.json) reports are retained. The subsequent fix prunes losing escape columns before collision checks and prepares reduced-padding escapes only when needed; the final measurements above cover that change. The two reports directly in `second-review/` are an earlier targeted run before cache-footprint pruning, not final measurements.

## Algorithm and bounds

The pure router sorts backward connections by horizontal port span and id, then reserves lanes, vertical trunks and label envelopes in that order. It searches at most 32 nearby lane values per envelope; spacing tiers (24, 12, 0 px) outrank distance. Source/incoming ranks add distinct 12 px escape columns. Tight approaches can use reduced padding while the labelled lane stays 32 px from cards. A direction-aware A* with bend cost and a full-clearance-lane state handles obstructed approaches; short labelled spans can make a longer horizontal step to leave pill space. It never crosses actual cards. Labels choose a free interval on the lane, prefer full text, then its midpoint, and retain the full accessible title when shortened. Incremental planning replays predecessors and invalidates recorded obstacle/reservation queries, so unchanged routes retain identity without depending on drag history (for the same backward/forward classification; the explicit 8 px classification hysteresis remains).

For N cards, E edges and R backward routes, preparation scans N + E and sorts R in O(R log R). The spatial index uses 256 px cells; queries inspect local cells/cards, with N cards in the worst case. Dependency/predecessor comparisons can be O(R squared) for broad changes; candidate collection/sorting can inspect N + R entries per rerouted edge. Candidate and escape counts are bounded, and losing costs are pruned before collision work. Each A* attempt has at most 64 x 64 x 4 states and 2,048 expansions, up to three padding attempts, with reusable buffers. These bounds do not promise a discovered path through every maze. `Port covered by a card; move the card` means a real covered port; `No clear route; move a card` means the bounded search could not find a usable route. Routes can cross other routes, and shared stubs meet at the same handle. Compression/sharing happens only after the free-lane candidates are exhausted.

The ordered point list remains the #44 override hook. Waypoint editing, storage, override validation and undo integration are left for #44.

## Gates and remaining handoff

Passed: root `typecheck`, `lint`, `build`, `format:check`, `check:tokens` (122 files), `check:contrast` (zero failures), `check:layers`, `check:licenses` (225 packages), `check:docs`, Node 22 `check:deps`, and all six tests in `node --test tooling/scripts/design-contrast.test.mjs`. No tooling source changed.

Both final web coverage runs passed **689 tests in 70 files**:

| Run                                    | Statements | Branches | Functions | Lines  |
| -------------------------------------- | ---------- | -------- | --------- | ------ |
| [1](second-review/web-coverage-1.json) | 99.15%     | 96.62%   | 99.37%    | 99.76% |
| [2](second-review/web-coverage-2.json) | 99.13%     | 96.60%   | 99.37%    | 99.76% |

The final `routing.spec.ts --repeat-each=3 --retries=0` run passed **63 of 63 cases** in 3.3 minutes, including all six performance cases and all 57 interaction/fixture cases. The final full Edge invocation had **167 passes, one failure, and one opt-in live-provider skip**, in 6.6 minutes. All routing cases passed; the failure was the existing Settings test `actions.spec.ts:525`, whose `API keys` heading focus assertion at line 558 timed out after 10 seconds. As requested, the entire file was rerun alone: **61 of 61 passed** in 1.2 minutes, with that case passing in 841 ms. No Settings code or test was changed, and the timeout's cause was not established. The isolated pass does not erase the original full-run failure. Structured counts are in [e2e-results.json](second-review/e2e-results.json).

Non-clean output during this round: the intermediate 8.4 ms performance failure above; the first lint run rejected two diagnostic `console.info` calls (removed), and a concurrent lint rerun picked up temporary Playwright trace JavaScript (rerun after browser completion). Turbo reported shared-cache permission warnings; Node 22 dependency-cruiser reported the two existing configuration-file orphan warnings; Playwright reported `NO_COLOR` / `FORCE_COLOR` warnings. The Settings focus timeout required the isolated file rerun described above; coverage and routing repeats had no timeouts. Lint and dependency-cruiser briefly saw active Playwright trace resources; after browser completion the dependency check returned to its two existing warnings. Thresholds and exclusions were not lowered.

The generated `apps/web/coverage/` directory was removed after saving the two summaries. Automatic approval review initially rejected a variable-target recursive cleanup as "blocked by policy"; after inspecting the exact directory, deletion with its literal worktree path and without `-Force` succeeded. Git index and branch were not changed. All implementation and QA changes are uncommitted.

Earlier implementation and first-review JSON files remain historical evidence. The first-review repeated run passed 50 of 51 tests, with a 100-node frame regression, as recorded in `performance-review-100-repeat-1.json`; it predates these changes and the orchestrator's strict-mode condition. No CI result, cross-vendor re-approval or human sign-off is inferred from local tests.

Reproduce from the repository root after building:

```powershell
pnpm.cmd build
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:GG_ROUTING_SCREENSHOTS = '1'
pnpm.cmd --filter @graphgoblin/web test:e2e
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/routing.spec.ts --repeat-each=3 --retries=0
```

Set `GG_ROUTING_REPORT_DIR` to retain JSON separately from test output. Set `GG_ROUTING_STRICT_PERF=1` to assert the added-frame gate locally too.
