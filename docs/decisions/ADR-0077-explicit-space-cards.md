# ADR-0077 — Explicit Space cards for loops stacked in one spot

Status: Accepted for #208. The decision is the owner's.

## Context

A loop written outside the editor (through the API, an import, a plugin or an agent) can store no positions. The stored format then gives every node `ui: {x: 0, y: 0}`, so the editor opens with every card in one pile at the origin. Nothing in the editor spaces them, and moving each card by hand is tedious. #208 asked how the editor should handle this.

The rejected options came from the #208 design refinement. One was to compute a layout and write it during other edits: opening, a rename or a palette add would silently move cards. That changes positions the author never asked to change, makes Undo of an unrelated edit move many cards, and hides a geometry write inside other history steps. The other was an automatic preview or hidden position map that draws a layout without storing it. Then the screen and the stored draft disagree, and every drag, route edit and saved position needs a second coordinate system.

The owner chose an explicit, undoable action on [#208](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/208) (comment 6883971339); its architecture is recorded there in comment 6884349952.

## Decision

The editor never moves cards by itself. When a draft has at least two nodes, every node is displayed at the origin (absent `ui` or an explicit zero, `-0` included) and no edge has a stored route, the canvas offers **Space cards** in a floating panel. Pressing it is one ordinary, undoable edit:

- It acts on the current draft only after checking it again; a draft that no longer qualifies is left exactly as it is.
- It writes only node `ui`, from a deterministic layout that is linear in nodes, edges and ports (`editor/space-cards.ts`). Columns follow the connections, and each card takes the larger of its measured height and a conservative footprint. The first node keeps its object and stays at the origin. Every edge, including ones the canvas cannot draw, and every other field are unchanged.
- It is one history step, one revision and one autosave like any edit, with no special save or permission path. Undo restores the exact earlier draft and Redo the exact spaced one.
- Focus stays on the canvas, the result is announced with Undo's availability, and the view fits once after the spaced cards render.

Dismissing the offer lasts for the editor load. There is no general arrange command for loops that already have positions, and no change to the stored, export or API format.

## Consequences

- Opening a loop, ordinary edits, Undo and Redo never change positions on their own, so a pile stays a pile until the author acts.
- Loops partly positioned, positioned off the origin or with any routed connection are never offered the action. Arranging them stays out of scope.
- The layout does not promise crossing-free connections or that a long chain fits in one view. Spacing at larger text sizes depends on the measured heights that the canvas passes in, and still needs native checks.
- Contracts, the API, migrations and stored data are unchanged, so there is no upgrade note.
