# Issue #18 routing handoff

Part of [#18](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/18). Implementation and automated evidence, 2026-10-05. Human approval has **not** been given. Keep the issue open until the owner has reviewed these images and dragged nodes in the running product, then recorded their sign-off. No commit or publication is part of this handoff.

## Fixture screenshots

These are the built editor on Microsoft Edge, using an isolated in-memory API on an ephemeral port. The owner's instance was not used. Small fixtures are 1440 × 900; the dense overview is 1920 × 1800 so all 100 cards fit. Animation is paused for capture. Fixtures are shared with the geometry tests in `apps/web/src/__fixtures__/routing.ts`.

| Fixture                            | Dark                                                         | Light                                                          |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Simple loop                        | [simple-loop-dark.png](simple-loop-dark.png)                 | [simple-loop-light.png](simple-loop-light.png)                 |
| Nested loops                       | [nested-loops-dark.png](nested-loops-dark.png)               | [nested-loops-light.png](nested-loops-light.png)               |
| Decision back-route and self-loop  | [decision-back-route-dark.png](decision-back-route-dark.png) | [decision-back-route-light.png](decision-back-route-light.png) |
| Dense graph, 100 nodes / 200 edges | [dense-100-nodes-dark.png](dense-100-nodes-dark.png)         | [dense-100-nodes-light.png](dense-100-nodes-light.png)         |

## Performance

Local machine: Windows 11 Pro 10.0.26200, AMD Ryzen 5 3600 (6 cores / 12 logical processors), Edge 154.0.4258.53, headless, 1440 × 900 viewport. Playwright's Desktop Chrome device profile supplies its user-agent string; the actual launched channel is `msedge`. The table is the final full-suite run with strict thresholds enabled; full precision and sample counts are in [performance.json](performance.json). An independent isolated strict run also passed all three repetitions: [performance-strict.json](performance-strict.json).

| Five-second drag | Whole-graph routing p95 | Frame p95 | Routing samples | Frame samples |
| ---------------- | ----------------------: | --------: | --------------: | ------------: |
| 1                |                  2.6 ms |   10.4 ms |             241 |           517 |
| 2                |                  1.7 ms |   10.4 ms |             271 |           517 |
| 3                |                  1.7 ms |   10.3 ms |             260 |           517 |

All three meet the requested **<4 ms routing / <16.7 ms frame** targets. The same rendered graph's three-second idle baseline was 10.1 ms frame p95 (315 frames); it does not replace or relax the drag assertions. `performance.measure('gg:backward-routing')` encloses the pure router for the entire graph; the observer requires 100 measured nodes and 200 edges. Frame intervals come from consecutive `requestAnimationFrame` timestamps during the drag. Native Playwright mouse input continuously moves `n44` around a small circuit for five seconds; the measurement includes frames between input events. The canvas retains unchanged node/edge objects and stable callback identities to avoid repeated xyflow store notifications on each movement.

`apps/web/e2e/routing.spec.ts` is CI-runnable, attaches JSON, and prints every repetition. Trace recording is disabled because serialising the 300 canvas elements on every input distorts the measurement. Shared-runner regression limits are 20 ms routing / 50 ms frame p95; `GG_ROUTING_STRICT_PERF=1` enforces the owner's tighter limits. CI hardware has **not** been measured in this local worktree. The current Ubuntu workflow does not invoke Playwright; a runner must build the app, install Edge, set `GG_E2E_BROWSER_CHANNEL=msedge`, and run this spec to produce the CI numbers. No workflow run or publication was requested here.

Earlier revisions missed the frame target: [the earlier full suite](performance-full-suite.json) measured 12.2 / 19.6 / 19.7 ms, and [an isolated run before node reuse](performance-before-node-reuse.json) measured 19.0 / 18.3 / 18.2 ms. Retaining node objects improved two of three runs, but the third still reached 19.1 ms. Inspection of xyflow's store updater showed that recreating callback props published several extra store updates per render. Stabilising those handlers produced the strict results above. These are local measurements, not a guarantee for other machines or all graph layouts.

To reproduce from the repository root after `pnpm.cmd build`:

```powershell
$env:GG_E2E_BROWSER_CHANNEL = 'msedge'
$env:GG_ROUTING_SCREENSHOTS = '1'
$env:GG_ROUTING_STRICT_PERF = '1' # Omit for the generous shared-runner limits.
pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/routing.spec.ts
```

## Algorithm and change summary

`editor/routing.ts` expands measured node boxes by the requested 24 px clearance plus the 8 px corner radius. Horizontal stubs connect measured port tips to that outer boundary; testing every other padded box prevents a stub from entering another card. Stable edge-id order chooses the shortest available horizontal return lane above or below the cards, reserving 24 px between lanes with overlapping spans. A clear six-point path is preferred; obstructed escapes use A* on a lazy rectilinear grid of obstacle boundaries and lane offsets. Rounded corners stay within the extra radius allowance. With N nodes, E edges and R routed edges, the candidate pass has worst-case O(R(N+R)² + E log E) time; a fallback with V grid vertices takes O(V(N+R+log V)) time and O(V) search memory, where V is O(N(N+R)). Ordinary fixtures take the candidate path. A value-keyed cache reruns only for positions, dimensions, handles or topology, preserving unchanged route and edge objects.

The registered `BackwardEdge` draws the returned ordered points using `BaseEdge`, retaining xyflow's selection, hit area and keyboard handling. It keeps the existing loop dash and pill labels, abbreviates long labels on their straight segment, and preserves the full accessible name/title. The colour/focus changes reuse tokens, add two label/canvas contrast registrations, and use system colours in forced-colours mode. Forward edges retain this branch's existing `smoothstep` rendering. The store, move coalescing and `onNodeDragStart` history boundary are unchanged. No dependency was added. Docs/09, guide 02 and the Unreleased changelog describe the result.

## Acceptance evidence

| Criterion                                        | Evidence                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orthogonal paths with rounded corners            | `routing.test.ts` checks every segment; `BackwardEdge.test.tsx` checks the rounded SVG; all four fixtures render in Edge.                                                                                                                                 |
| Clearance; only own endpoint stubs enter padding | Independent segment/box checks across the simple, nested, decision, self, vertical, overlapping-obstacle and 100-node fixtures. The browser drag test samples the actual rounded SVG against measured card boxes after moving a card across its old path. |
| Separate lanes on overlapping spans              | Pairwise lane separation assertions, including 12 competing returns over one span; nested fixture screenshots.                                                                                                                                            |
| Performance                                      | Three repetitions above; measuring E2E is included with CI limits and strict local option. CI numbers pending.                                                                                                                                            |
| Dash, labels, click/keyboard selection, Delete   | Both-theme Edge tests; reduced-motion test; deletion read back from the API confirms `loopBack` is removed. Component tests also verify the config and Undo restoration.                                                                                  |
| Self-loops, vertical targets and overlaps        | Unit fixtures, decision screenshot, Edge vertical/self/long-script-route/obstructed-port/zoom tests.                                                                                                                                                      |
| Contrast, focus and both themes                  | Registered token pairs in `docs/qa/design-contrast.md`; computed-colour Edge checks; visible focus, forced colours and reduced motion.                                                                                                                    |
| Human screenshot/product approval                | **Pending owner review.** Screenshots are provided; no approval or closing action is claimed.                                                                                                                                                             |
| Licence allowlist                                | No new package; repository licence gate.                                                                                                                                                                                                                  |
| Docs/09                                          | Editor routing section, token pairs, memoisation and #44 replacement hook documented; guide and changelog updated.                                                                                                                                        |
| #17 interaction                                  | Unit drag coalescing test and browser drag/Undo regression: one drag is one step; router has no store dependency.                                                                                                                                         |

## Limits and #44

If a port is covered by another card's padding or enclosed by an obstacle cluster, the router can have no valid escape. It uses a conservative extra 8 px envelope for rounded corners and respects existing lane reservations, so some very tight layouts also require more room. That connection has no misleading crossing path: it remains focusable/selectable through its label, **move overlapping nodes apart**, and can still be deleted. Overlapping unrelated obstacles are routed around when an escape exists. Routes may cross other routes; shared destination stubs necessarily meet at the same handle.

The renderer accepts an ordered orthogonal point list independent of the router. #44 can replace it with author-supplied waypoints before drawing. Waypoint UI, persistence, editing, validation and undo for manual routes remain for #44. This handoff does not supply the cross-vendor review or human running-product sign-off.

## Gates

Passed: root `typecheck`, `lint`, `build`, `check:tokens` (110 files), `check:contrast` (zero failing pairs), `check:layers`, `check:licenses` (225 packages), `check:docs`, and the Node 22 dependency-cruiser command from AGENTS.md (443 modules, 1,590 dependencies; zero errors, two existing configuration-file orphan warnings).

Web coverage: **576 tests / 60 files passed**, with **99.05% statements, 96.32% branches, 99.16% functions and 99.71% lines**. See [web-coverage.json](web-coverage.json). Tooling: **44 tests passed**; [tooling-coverage.json](tooling-coverage.json) records **95.10% statements, 94.38% branches, 98.11% functions and 95.01% lines** across all 13 executable tooling modules. Tooling's package script uses Node's test runner without a coverage reporter. An additional V8 capture combined those 44 tests with the layer/licence/generated-doc gate executions and both default/overridden shared Vitest configuration calls. The already-installed Vitest AST converter mapped that capture to all four metrics. Thresholds and exclusions are unchanged.

An earlier `SettingsPage.test.tsx` focus test timed out during a heavily loaded run. Its isolated rerun passed all 20 tests, and the final full web coverage run passed without retries. The root Turbo commands reported shared-cache write warnings in this restricted worktree; every requested task completed successfully.

The final full Edge suite passed **149 tests**, including all 14 routing tests and the strict performance assertions, in 4.3 minutes. The single opt-in live Codex-provider test was skipped. No E2E retries were needed. All eight screenshots were refreshed by this final run. Root `format:check` and `git diff --check` passed after formatting the saved measurement artifacts.

The requested removal of `apps/web/coverage/` was rejected by automatic approval review with **blocked by policy**, including a literal-path attempt after verifying the directory was inside this worktree. It remains ignored and uncommitted; the deletion restriction was not bypassed.
