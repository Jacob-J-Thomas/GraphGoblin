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
6. Drag a card onto a rerouted line and let go: that line goes back to automatic routing, and Undo brings both the card and the route back.

## Plan and contract decision

The brief assumed edges are derived from node config; they are not. `definition.edges` stores every edge with a stable id (decision routes, exit codes and `loopBack` are mirrored in config, but the edge is the stored connection). So the manual route belongs on the edge itself, as `edge.ui.route`, mirroring a node's `ui`, rather than in a separate `layout` block keyed by (source, port, target):

- deleting the edge deletes the route, renaming a node (which rewrites the edge's ends) keeps it, and no key can be orphaned or collide;
- the representation is the inner segment positions, alternating the x of a vertical and the y of a horizontal segment (`x, y, ..., x`); the first and last segments are not stored but run from the current port heights, so stubs are recomputed whenever a card moves. Absolute positions keep the route when one end moves, which is how cards move here (one at a time); offsets relative to the ends would only win when both ends move together;
- optional, layout only: loops without it route automatically and nothing else changed shape (schema and export format versions stay 1, no migration). The engine ignores it (proved by `packages/engine/src/edge-routes.test.ts`).

A card moved onto a manual route: while the card is dragged over a route that was clear when the drag began, the edge shows its automatic route; when a card is released (or moved with the keys) so that a manual route that was clear now crosses a card, the route is removed in the move's own undo step. Where the author puts a segment is kept even across a card (drawn dotted, toolbar "Crosses a card"), because rerouting a line that already crosses a card can take several moves whose in-between states still cross it; refusing those would make such a line impossible to fix.

## QA catalogue (touched systems)

Each row is a check that ran and passed unless marked otherwise. "+" is a positive case, "−" a negative one. Evidence: the named test (Vitest unit test or Edge E2E in `apps/web/e2e/edge-routes.spec.ts`).

| System               | Case                                                                                                                                                                                                       | Result | Evidence                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Drag, forward edge   | + Selected forward edge shows stub, trunk, stub handles on xyflow's smoothstep path; dragging the trunk stores `[272]` in one step                                                                         | pass   | `Canvas.test.tsx` "drags a forward edge segment"                                                                         |
| Drag, forward edge   | + Pulling the first stub down splits it (24 px stub kept on the port); moving the trunk past `side` leaves no card crossed, measured on the drawn SVG path, both themes                                    | pass   | E2E "reroute a forward edge and a loop-back", dark and light                                                             |
| Drag, forward edge   | − A press without a move stores nothing; Escape and a cancelled pointer drop the preview                                                                                                                   | pass   | `Canvas.test.tsx` "keeps a drag where it is released"                                                                    |
| Drag, loop-back      | + The return lane moves with the pointer; the stored route has three positions; the drawn path crosses no card                                                                                             | pass   | E2E, both themes                                                                                                         |
| Drag, crossing       | + A drag released across a card is kept, drawn dotted (`gg-route-crossing`), announced "Route changed. It crosses a card."                                                                                 | pass   | `Canvas.test.tsx`; E2E (the forward edge's in-between state)                                                             |
| Nudge                | + Arrow along the axis moves to the next 22 px grid line, Shift five; a run of nudges is one undo step; focus stays on the moved handle (also after a split renumbers it)                                  | pass   | E2E "keyboard"; `Canvas.test.tsx` "nudges a loop-back lane"; `OrthogonalEdge.test.tsx` "keeps focus on a nudged segment" |
| Nudge                | − Arrows across the axis, Enter, Space, Delete, Backspace on a handle change nothing and never delete the edge                                                                                             | pass   | E2E "keyboard"; `OrthogonalEdge.test.tsx`                                                                                |
| Keyboard             | + Tab from the selected edge visits the handles in segment order, then Reset route; Escape returns focus to the edge, which stays selected                                                                 | pass   | E2E "keyboard"                                                                                                           |
| Reset route          | + Removes the route in its own undo step, announces it, refocuses the edge, and the button disappears                                                                                                      | pass   | E2E "keyboard"; `Canvas.test.tsx`                                                                                        |
| Undo and redo        | + A drag is one step ("reroute start to work"), its press closes the open step; undo and redo restore routes exactly; deleting and undoing an edge brings its route back                                   | pass   | `store.test.ts`; `Canvas.test.tsx`; E2E "selecting and deleting"                                                         |
| Node moves           | + A move that keeps the route clear keeps it; the stubs follow the moved port                                                                                                                              | pass   | `routing-manual.test.ts`; E2E "moving a card"                                                                            |
| Node moves           | − Dragging a card onto a manual lane shows the automatic route while over it; releasing removes the route inside "move side"; Undo brings both back                                                        | pass   | E2E "moving a card"; `Canvas.test.tsx` "lets a moved card take a manual route back"                                      |
| Persistence          | + Autosave writes `edge.ui.route` to the server draft; a reload draws the same path for both edges                                                                                                         | pass   | E2E "reroute ...", both themes                                                                                           |
| Export and import    | + `GET /loops/{id}/export?draft=true` carries the routes; `POST /loops/import` creates a loop with them, drawn the same way                                                                                | pass   | E2E "routes survive export and import"; `loop-io.test.ts`                                                                |
| Export and import    | − A malformed route (even count, NaN, infinite, too long, wrong type, extra key) is refused with its path                                                                                                  | pass   | `schemas.test.ts`; `loop-io.test.ts`                                                                                     |
| Publish and run      | + Publishing from the editor pins the routes in the version; a run of that version succeeds                                                                                                                | pass   | E2E "routes survive export and import, publish pins them, and runs ignore them"                                          |
| Publish and run      | + The engine runs a routed loop to exactly the same events, routes and visits as its unrouted twin                                                                                                         | pass   | `packages/engine/src/edge-routes.test.ts`                                                                                |
| Older loops          | + Loops without `ui` route automatically, as before (the #18 Edge suite and fixtures unchanged)                                                                                                            | pass   | `e2e/routing.spec.ts`                                                                                                    |
| Selection and delete | + Selecting with Enter, Delete removes the rerouted edge and saves; Ctrl+Z restores it with its route                                                                                                      | pass   | E2E "selecting and deleting"                                                                                             |
| Router               | + Fixed routes drawn as given, labelled on their lane, reserved before automatic routes (every inner lane and trunk); incremental plans equal fresh ones while a segment is dragged and while a card moves | pass   | `routing-manual.test.ts`                                                                                                 |
| Router               | − A route a moving card lands on falls back (backward: automatic route, forward: smoothstep) and comes back when the card leaves                                                                           | pass   | `routing-manual.test.ts`                                                                                                 |
| Themes and contrast  | + Handle stroke 3:1 on the canvas and handle target at least 24 px, dark and light; focus ring 3:1 (measured in dark; light is the registered `--focus-ring` / `--canvas-bg` pair)                         | pass   | E2E "reroute ...", "keyboard"; `pnpm check:contrast`                                                                     |
| Forced colours       | + Handle stroke and focus ring keep 3:1 against the canvas                                                                                                                                                 | pass   | E2E "forced colours"                                                                                                     |

## Performance (routing gate from #18)

Edge, `routing.spec.ts -g performance --repeat-each=3`, three five-second pointer drags each, whole routing cache miss p95:

| Fixture               | Drag p95s, run 1 / 2 / 3 (ms)           | Medians (ms)    | Bound                 |
| --------------------- | --------------------------------------- | --------------- | --------------------- |
| 100 nodes / 200 edges | 1.6 1.3 1.3 / 1.4 1.2 1.3 / 1.9 1.4 1.4 | 1.3 / 1.3 / 1.4 | median < 8, each < 16 |
| 300 nodes / 600 edges | 3.1 2.6 2.4 / 3.2 2.6 2.5 / 2.9 2.5 2.2 | 2.6 / 2.6 / 2.5 | median < 8, each < 16 |

The 300-node numbers sit somewhat above #18's 1.8–2.4 ms: real cards now carry handle strips in the obstacle index (the #18 nit), roughly doubling its entries. A controlled A/B on the dense fixtures with 6 px handle tips, the base router (`cfa162d`) against this branch, gave a steady-drag p50 of 1.42–1.49 ms against 1.72–1.79 ms at 300 cards and 0.84–0.96 ms against 0.98–1.03 ms at 100, while replanning fewer routes (rerouted p95 11 against 8). Before two optimisations in this branch (a moved card counts once for invalidation, not once per strip; a route present on only one side of a replan counts by its envelope) the gap was about 2x.

`pnpm.cmd --filter @graphgoblin/web exec tsx --conditions=development e2e/routing-benchmark.ts`, the base router copied from `cfa162d` against this branch, same session (unit fixtures, whose handle tips sit on the card edge, so no strips): obstacle queries identical (4,065 / 10,575 / 15,988 / 4,470); steady-drag rerouted p95 10/10/10/11 before, 8/8/8/8 after; steady-drag p50 2.10/2.23/2.56/2.34 ms before, 1.92/2.25/2.35/2.84 ms after. Timings are host-sensitive (other worktrees were running suites); the deterministic work bounds in `routing-review.test.ts` did not move. The one new bound, in `routing-manual.test.ts`, caps the routes a dragged manual lane may replan at 32 per step in the 300-card fixture (13 to 26 observed): a lane is a candidate for every route within the 192 px candidate reach, comparable to the 38 a 60 x 48 px card drag may replan there.

## Gates

All on Windows 11, with headless Microsoft Edge 154 for E2E: `pnpm.cmd typecheck`, `lint`, `format:check`, `check:tokens`, `check:contrast` (no new token pairs: handles use `--canvas-edge-selected` and `--focus-ring` on `--canvas-bg`, the toolbar the registered outline-button and muted-text pairs; `node --test tooling/scripts/design-contrast.test.mjs` 6/6), `check:layers`, `check:deps` with Node 22 (0 errors; the 2 existing `no-orphans` warnings for `drizzle.config.ts` and `playwright.config.ts`), `check:licenses`, `docs:generate` then `check:docs` (no reference change: the references cover node configs and routes; the OpenAPI document and client types were regenerated), `build`, coverage for contracts, domain, engine and web, and the full Edge E2E suite (198 passed, 1 skipped; a first full run during heavy machine load crashed browser targets in five tests, which passed when rerun alone and in the second full run).

## Not verified

- The owner's running product: sign-off is the owner's, on #44.
- Touch input on a real coarse-pointer device (the 44 px targets are CSS under `pointer: coarse`; not emulated in E2E).
- Output in a real screen reader (names, descriptions and the live region are asserted in the DOM).
- The GitHub `routing-perf` workflow on Ubuntu (nothing was pushed).
