# Issue #44: editable edge routes (QA hand-off)

Part of [#44](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/44). The issue stays open until the owner has tested the running product and signed off there. Captured on 2026-10-05 in headless Microsoft Edge against the built web app and an isolated in-memory API on an ephemeral port (`e2e/server.ts`); the owner's instance and port 4747 were not used.

## Screenshots

The fixture (`crossingLoop` in `e2e/edge-routes.spec.ts`) is a publishable loop whose forward edge `start -> work` runs straight behind the `side` card, as forward edges did before. The rerouted images are taken after real pointer drags: the forward edge's first stub pulled down below the cards, then its trunk moved past `side`; the loop-back's return lane dragged further down.

| State                                                                       | Dark                                                   | Light                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Before: `start -> work` behind `side`, automatic loop-back                  | [before-dark](before-dark.png)                         | [before-light](before-light.png)                         |
| Rerouted forward edge, selected: its handles on each segment                | [rerouted-forward-dark](rerouted-forward-dark.png)     | [rerouted-forward-light](rerouted-forward-light.png)     |
| Rerouted loop-back, selected: handles, the lane handle hovered, Reset route | [rerouted-loop-back-dark](rerouted-loop-back-dark.png) | [rerouted-loop-back-light](rerouted-loop-back-light.png) |

Reproduce from the repository root with `pnpm.cmd build`, then `$env:GG_ROUTING_SCREENSHOTS='1'; pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/edge-routes.spec.ts -g "reroute a forward"`.

## What to try in the running product

1. Open a loop, click a connection (or Tab to it and press Enter). A round handle appears on each horizontal and vertical segment.
2. Drag a handle: the segment moves, the line stays square, the ends stay on their ports. Drag the short piece next to a port up or down to take a straight line around a card.
3. Tab from the selected connection into its handles; Up/Down (or Left/Right) moves the focused segment one grid step, Shift five; Esc returns to the connection.
4. **Reset route** above the label returns the connection to automatic routing.
5. Reload, export and import, publish: the routes stay. Ctrl+Z / Ctrl+Shift+Z undo and redo a drag, a run of nudges, or a reset.
6. Drag a card onto a rerouted line and let go: that line goes back to automatic routing if the replacement clears every card; otherwise it keeps its manual route, draws it dotted with Crosses a card, and announces why. Undo brings the card and its route back.

## Plan and contract decision

The brief assumed edges are derived from node config; they are not. `definition.edges` stores every edge with a stable id (decision routes, exit codes and `loopBack` are mirrored in config, but the edge is the stored connection). So the manual route belongs on the edge itself, as `edge.ui.route`, mirroring a node's `ui`, rather than in a separate `layout` block keyed by (source, port, target):

- deleting the edge deletes the route, renaming a node (which rewrites the edge's ends) keeps it, and no key can be orphaned or collide;
- the representation is the inner segment positions, alternating the x of a vertical and the y of a horizontal segment (`x, y, ..., x`); the first and last segments are not stored but run from the current port heights, so stubs are recomputed whenever a card moves. Absolute positions keep the route when one end moves, which is how cards move here (one at a time); offsets relative to the ends would only win when both ends move together;
- optional, layout only: loops without it route automatically and nothing else changed shape (schema and export format versions stay 1, no migration). The engine ignores it (proved by `packages/engine/src/edge-routes.test.ts`).

A card moved onto a manual route: each edge records the specific cards it crossed at drag start. The route stays manual while only those deliberate intersections remain; a newly crossed card, including the edge's own source or target, makes the preview show the automatic route. Releasing there (or moving with the keys) computes the automatic replacement at the final card position first. If that path clears every card, it removes the manual route in the move's own undo step, so Undo restores both the card and the route. If the replacement crosses a card, the manual route stays, drawn dotted with Crosses a card and an announcement. A move introducing no new card intersection keeps the route. Where the author puts a segment is kept even across a card (drawn dotted, toolbar "Crosses a card"), because rerouting a line that already crosses a card can take several moves whose in-between states still cross it; refusing those would make such a line impossible to fix.

## QA catalogue (touched systems)

Each row records a check that passed in the initial QA or the review-fix rounds, unless marked otherwise. This round's commands and counts are listed under Gates. "+" is a positive case, "−" a negative one. Evidence: the named test (Vitest unit test or Edge E2E in `apps/web/e2e/edge-routes.spec.ts`).

| System               | Case                                                                                                                                                                                                                                        | Result | Evidence                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Drag, forward edge   | + Selected forward edge shows stub, trunk, stub handles on xyflow's smoothstep path; dragging the trunk stores `[272]` in one step                                                                                                          | pass   | `Canvas.test.tsx` "drags a forward edge segment"                                                                         |
| Drag, forward edge   | + Pulling the first stub down splits it (24 px stub kept on the port); moving the trunk past `side` leaves no card crossed, measured on the drawn SVG path, both themes                                                                     | pass   | E2E "reroute a forward edge and a loop-back", dark and light                                                             |
| Drag, forward edge   | − A press without a move stores nothing; Escape and a cancelled pointer drop the preview                                                                                                                                                    | pass   | `Canvas.test.tsx` "keeps a drag where it is released"                                                                    |
| Drag, loop-back      | + The return lane moves with the pointer; the stored route has three positions; the drawn path crosses no card                                                                                                                              | pass   | E2E, both themes                                                                                                         |
| Drag, crossing       | + A drag released across a card is kept, drawn dotted (`gg-route-crossing`), announced "Route changed. It crosses a card."                                                                                                                  | pass   | `Canvas.test.tsx`; E2E (the forward edge's in-between state)                                                             |
| Nudge                | + Arrow along the axis moves to the next 22 px grid line, Shift five; a run of nudges is one undo step; focus stays on the moved handle (also after a split renumbers it)                                                                   | pass   | E2E "keyboard"; `Canvas.test.tsx` "nudges a loop-back lane"; `OrthogonalEdge.test.tsx` "keeps focus on a nudged segment" |
| Nudge                | − Arrows across the axis, Enter, Space, Delete, Backspace on a handle change nothing and never delete the edge                                                                                                                              | pass   | E2E "keyboard"; `OrthogonalEdge.test.tsx`                                                                                |
| Keyboard             | + Tab from the selected edge visits the handles in segment order, then Reset route; Escape returns focus to the edge, which stays selected                                                                                                  | pass   | E2E "keyboard"                                                                                                           |
| Reset route          | + Removes the route in its own undo step, announces it, refocuses the edge, and the button disappears                                                                                                                                       | pass   | E2E "keyboard"; `Canvas.test.tsx`                                                                                        |
| Undo and redo        | + A drag is one step ("reroute start to work"), its press closes the open step; undo and redo restore routes exactly; deleting and undoing an edge brings its route back                                                                    | pass   | `store.test.ts`; `Canvas.test.tsx`; E2E "selecting and deleting"                                                         |
| Node moves           | + A move that keeps the route clear keeps it; the stubs follow the moved port                                                                                                                                                               | pass   | `routing-manual.test.ts`; E2E "moving a card"                                                                            |
| Node moves           | − Dragging a card onto a manual lane shows the automatic route while over it; releasing removes the route inside "move side"; Undo brings both back                                                                                         | pass   | E2E "moving a card"; `Canvas.test.tsx` "lets a moved card take a manual route back"                                      |
| Persistence          | + Autosave writes `edge.ui.route` to the server draft; a reload draws the same path for both edges                                                                                                                                          | pass   | E2E "reroute ...", both themes                                                                                           |
| Export and import    | + `GET /loops/{id}/export?draft=true` carries the routes; `POST /loops/import` creates a loop with them, drawn the same way                                                                                                                 | pass   | E2E "routes survive export and import"; `loop-io.test.ts`                                                                |
| Export and import    | − A malformed route (even count, NaN, infinite, too long, wrong type, extra key) is refused with its path                                                                                                                                   | pass   | `schemas.test.ts`; `loop-io.test.ts`                                                                                     |
| Publish and run      | + Publishing from the editor pins the routes in the version; a run of that version succeeds                                                                                                                                                 | pass   | E2E "routes survive export and import, publish pins them, and runs ignore them"                                          |
| Publish and run      | + The engine runs a routed loop to exactly the same events, routes and visits as its unrouted twin                                                                                                                                          | pass   | `packages/engine/src/edge-routes.test.ts`                                                                                |
| Older loops          | + Loops without `ui` route automatically, as before (the #18 Edge suite and fixtures unchanged)                                                                                                                                             | pass   | `e2e/routing.spec.ts`                                                                                                    |
| Selection and delete | + Selecting with Enter, Delete removes the rerouted edge and saves; Ctrl+Z restores it with its route                                                                                                                                       | pass   | E2E "selecting and deleting"                                                                                             |
| Router               | + Fixed routes drawn as given, labelled on their lane, reserved before automatic routes (every horizontal, including endpoint stubs, and every trunk); incremental plans equal fresh ones while a segment is dragged and while a card moves | pass   | `routing-manual.test.ts`                                                                                                 |
| Router               | − A route a moving card lands on falls back (backward: automatic route, forward: smoothstep) and comes back when the card leaves                                                                                                            | pass   | `routing-manual.test.ts`                                                                                                 |
| Themes and contrast  | + Handle stroke 3:1 on the canvas and handle target at least 24 px, dark and light; focus ring 3:1 (measured in dark; light is the registered `--focus-ring` / `--canvas-bg` pair)                                                          | pass   | E2E "reroute ...", "keyboard"; `pnpm check:contrast`                                                                     |
| Forced colours       | + Handle stroke and focus ring keep 3:1 against the canvas                                                                                                                                                                                  | pass   | E2E "forced colours"                                                                                                     |

| Node moves, deliberate crossings | + A route crossing `check` gains a source-card crossing when the source passes the first stored x; it resets inside the move step when the automatic replacement clears every card, or stays dotted when the replacement is obstructed; Undo restores both; a move preserving the same crossed-card ids keeps it | pass | `Canvas.test.tsx` "protects a deliberately crossing route"; E2E "an existing deliberate crossing" |
| Manual reservations | + The manual `(20,254) -> (1300,254) -> (1300,510)` endpoint horizontal displaces the automatic return's 848 px lane and retains its advertised 24 px gap; first and last endpoints invalidate incremental routes when a distant port moves | pass | `routing-manual.test.ts` "reserves the manual endpoint horizontal", "invalidates automatic routes" |
| Segment limit | - A 63-coordinate split or nudge normalising to 65 is politely refused, preserving the route, revision and history; 32 alternating first-stub edits from one coordinate remain saveable and publishable; collapsed candidates still fit | pass | `Canvas.test.tsx`; `manual-route.test.ts`; `store.test.ts`; E2E "32 alternating first-stub splits" |
| Dense routing fallback | + The handle-ignoring attempt uses the full/half/zero endpoint-padding ladder and never crosses a card body; 96 deterministic 24-card grids find at least the base router's counts | pass | `routing-review.test.ts` "finds at least the base router"; counts below |
| Crossing preview | + Existing deliberate intersections stay dotted, but a newly crossed card immediately switches the preview to automatic before release; permitted-card sets participate in cache equality | pass | `Canvas.test.tsx` "protects a deliberately crossing route"; `useRouting.test.ts`; E2E "an existing deliberate crossing" |
| Edge selection order | + An earlier edge's `selected:true` wins over the previous edge's `selected:false`, in either callback order; deselecting an unrelated edge preserves the selection | pass | `Canvas.test.tsx` "keeps the replacement edge selected" |
| Drag followed by nudge | + Release closes the drag's undo step; a nudge 100 ms later starts another step; Undo restores the dragged route first, then the automatic route; successive nudges still coalesce | pass | `Canvas.test.tsx` "keeps a nudge immediately after a route drag"; `store.test.ts` "separates a released route drag" |

The crossing-style comment in `canvas-routes.css` now describes the author's retained, dotted segment edit.

### Dense-grid regression counts

Measured from all four historical routing modules at `cfa162d` and the current implementation, on the same 32 deterministic LCG seeds (1 through 32) per gap: 24 cards in a 6 by 4 grid, 184 by 122 px bodies, facing ports at the same height with 6 px protrusion, and 23 loop-backs per grid. Each row has 736 attempted routes. The unit regression pins the base count, checks every found segment against card bodies and every label against cards and labels, and requires the current count to meet or exceed the base. The unchanged 300-case seeded sparse corpus remains at zero unavailable routes.

| Card gap (px) | Base found | Before this round found | After this round found | After unavailable | Lost base routes after |
| ------------- | ---------- | ----------------------- | ---------------------- | ----------------- | ---------------------- |
| 16            | 586        | 587                     | 587                    | 149               | 0                      |
| 24            | 587        | 584                     | 587                    | 149               | 0                      |
| 32            | 587        | 587                     | 587                    | 149               | 0                      |

## Performance (routing gate from #18)

Latest review-fix run on HEAD `6634469` plus this uncommitted patch: headless Microsoft Edge 154, Windows 11, viewport 1440 by 900, `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/edge-routes.spec.ts e2e/routing.spec.ts`. Each performance fixture runs three five-second pointer drags. All values are milliseconds; routing measures the whole cache miss.

| Fixture               | Routing p95, drags 1 / 2 / 3 | Routing median | Frame p95, drags 1 / 2 / 3 | Added frame p95, drags 1 / 2 / 3 |
| --------------------- | ---------------------------- | -------------- | -------------------------- | -------------------------------- |
| 100 nodes / 200 edges | 1.5 / 1.4 / 1.2              | 1.4            | 8.5 / 16.7 / 8.4           | 0.1 / 8.3 / 0.0                  |
| 300 nodes / 600 edges | 2.8 / 2.2 / 2.1              | 2.2            | 16.7 / 16.6 / 8.5          | 8.3 / 8.2 / 0.1                  |

Idle frame p95 was 8.4 ms in both fixtures. The routing gates passed: median below 8 ms and every drag below 16 ms. `GG_ROUTING_STRICT_PERF` was unset, so the optional added-frame target below 4 ms was recorded without assertion; the 100-node second drag and 300-node first and second drags exceeded it. The JSON reports remain under `apps/web/test-results/*/measurements/`.

### Historical comparisons (initial QA, not rerun in this round)

The 300-node numbers sit somewhat above #18's 1.8–2.4 ms: real cards now carry handle strips in the obstacle index (the #18 nit), roughly doubling its entries. A controlled A/B on the dense fixtures with 6 px handle tips, the base router (`cfa162d`) against this branch, gave a steady-drag p50 of 1.42–1.49 ms against 1.72–1.79 ms at 300 cards and 0.84–0.96 ms against 0.98–1.03 ms at 100, while replanning fewer routes (rerouted p95 11 against 8). Before two optimisations in this branch (a moved card counts once for invalidation, not once per strip; a route present on only one side of a replan counts by its envelope) the gap was about 2x.

`pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/routing-benchmark.ts`, the base router copied from `cfa162d` against this branch, same session (unit fixtures, whose handle tips sit on the card edge, so no strips): obstacle queries identical (4,065 / 10,575 / 15,988 / 4,470); steady-drag rerouted p95 10/10/10/11 before, 8/8/8/8 after; steady-drag p50 2.10/2.23/2.56/2.34 ms before, 1.92/2.25/2.35/2.84 ms after. Timings are host-sensitive (other worktrees were running suites); the deterministic work bounds in `routing-review.test.ts` did not move. The one new bound, in `routing-manual.test.ts`, caps the routes a dragged manual lane may replan at 32 per step in the 300-card fixture (13 to 26 observed): a lane is a candidate for every route within the 192 px candidate reach, comparable to the 38 a 60 x 48 px card drag may replan there.

## Gates

Latest review-fix round (HEAD `6634469`, after first-round fix commit `1587888`):

- `pnpm.cmd typecheck`: pass, 20 successful tasks.
- `pnpm.cmd lint`: pass, 11 successful tasks.
- `pnpm.cmd format:check`: pass, including the refreshed handoff; `git diff --check` clean.
- `pnpm.cmd check:docs`: pass, generated reference docs unchanged.
- `pnpm.cmd --filter @graphgoblin/web test:coverage --coverage.clean=false --maxWorkers=2`: pass, the complete web suite, 964 tests across 89 files. Coverage: 99.03% statements, 96.57% branches, 99.33% functions, 99.61% lines. `coverage/` was preserved.
- `pnpm.cmd build`: pass, 11 successful tasks, run once before E2E.
- On Edge, `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/edge-routes.spec.ts e2e/routing.spec.ts`: 32 passed, no skips or failures and no file rerun required. The revised crossing case checks the automatic preview before pointer release, then verifies reset and Undo.
- Regression evidence before the fixes: the 24 px grid found 584 routes against the base's 587; the selection, deliberate-crossing preview and post-drag nudge tests failed. After the fixes all five targeted files passed, 103 tests, including the 300-case sparse corpus and dense-grid regressions.
- Non-clean output: Turbo emitted `IO error: Access is denied (os error 5)` while writing the shared worktree cache; its tasks still passed. Playwright emitted the `NO_COLOR` ignored because `FORCE_COLOR` is set warning. The optional strict frame gate was not enabled, with the exceeded frame targets reported above.

### Original QA evidence

The following broader checks belong to the original handoff; their historical counts are retained here and are not the current review-fix run:

All on Windows 11, with headless Microsoft Edge 154 for E2E: `pnpm.cmd typecheck`, `lint`, `format:check`, `check:tokens`, `check:contrast` (no new token pairs: handles use `--canvas-edge-selected` and `--focus-ring` on `--canvas-bg`, the toolbar the registered outline-button and muted-text pairs; `node --test tooling/scripts/design-contrast.test.mjs` 6/6), `check:layers`, `check:deps` with Node 22 (0 errors; the 2 existing `no-orphans` warnings for `drizzle.config.ts` and `playwright.config.ts`), `check:licenses`, `docs:generate` then `check:docs` (no reference change: the references cover node configs and routes; the OpenAPI document and client types were regenerated), `build`, coverage for contracts, domain, engine and web, and the full Edge E2E suite (198 passed, 1 skipped; a first full run during heavy machine load crashed browser targets in five tests, which passed when rerun alone and in the second full run).

## Not verified

- The owner's running product: sign-off is the owner's, on #44.
- Touch input on a real coarse-pointer device (the 44 px targets are CSS under `pointer: coarse`; not emulated in E2E).
- Output in a real screen reader (names, descriptions and the live region are asserted in the DOM).
- The GitHub `routing-perf` workflow on Ubuntu (nothing was pushed).

## Adversarial R2 follow-up (2026-10-06)

The reproduction uses a forward connection from (190, 61) to (694, 61), stored detour `[250, 300, 650]`, and an original 184 by 122 px obstacle at (330, 0). Moving another card onto y=300 keeps the detour when resetting would cross the original obstacle; it warns and remains one move to undo. `Canvas.test.tsx` tests this and the same fixture with the original obstacle out of the way, which resets safely. Edge `edge-routes.spec.ts` exercises the kept detour with a real pointer drag, the SVG crossing, dotted warning, announcement, saved route, and undo. Verification results are recorded in the [phase 3/4 follow-up handoff](../2026-10-06-phase-3-4-code-fixes/README.md).

## Second phase 3/4 review (2026-10-06)

`createRoutingPlan` owns the safe-replacement rule during a node drag. A newly crossing manual route is suspended only if its automatic fallback crosses no card; otherwise it remains dotted and flagged in the preview. Drop consumes that same plan's suspended set at the final position, so the preview cannot snap to a different outcome on release. A move that resets one route and keeps another announces both counts in one live message. Unit regressions cover clear and obstructed forward fallbacks, backward fallback with a covered port, incremental invalidation, and the combined announcement. Edge checks compare the obstructed preview's SVG path with its released path. Current verification is in the [second-review handoff](../2026-10-06-phase-3-4-code-fixes/README.md#second-review-on-634e9bd).
