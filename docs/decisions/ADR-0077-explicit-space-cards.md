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

The panel's two buttons, **Space cards** and **Dismiss suggestion**, follow the canvas's own viewport gate ([ADR-0076](ADR-0076-canvas-only-connection-authoring.md)), the same one that guards **Remove connection** and **Reset route**, not a second gate. After a mouse pan, d3's click blocker can swallow the next click anywhere on the page, including on these buttons, which sit outside the flow. From the pan's first move until its release has settled they are shown unavailable (`aria-disabled` and `data-gesture`, never `disabled` or `pointer-events: none`) and stay in place and focusable; a press then does nothing, so it cannot fall through to the canvas or be swallowed while they look available. Nothing is hidden, delayed or replayed. The store's recheck of eligibility is unchanged and still applies to the first press after the gate is ready.

Dismissing the offer lasts for the editor load. There is no general arrange command for loops that already have positions, and no change to the stored, export or API format.

## Consequences

- Opening a loop, ordinary edits, Undo and Redo never change positions on their own, so a pile stays a pile until the author acts.
- Loops partly positioned, positioned off the origin or with any routed connection are never offered the action. Arranging them stays out of scope.
- The layout does not promise crossing-free connections or that a long chain fits in one view. Spacing at larger text sizes depends on the measured heights that the canvas passes in, and still needs native checks.
- A pointer press on either button leaves a plain result in the panel's box until the next press elsewhere, so the second press of a double click cannot reach what the panel covered (found at 512 px, where it covers Zoom Out). That area, and any card the fit places there, stays covered for that long. The action itself is as decided: explicit, one step, nothing applied or previewed by itself.
- Contracts, the API, migrations and stored data are unchanged, so there is no upgrade note.
