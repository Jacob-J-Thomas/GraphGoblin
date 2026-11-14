# ADR-0076 — Canvas-only connection authoring

Status: Accepted for #207. The decision is the owner's.

## Context

Before #207 a connection could be authored in two places. The canvas let a pointer user drag from an output handle to an input handle, and select an edge and press Delete or Backspace. The node dialog also had a **Connections** section: a list of the node's outgoing edges, each with a **Remove edge** button, and a **Connect** form where a user picked one of the node's free outputs and a target. The form was added by the WP-D2 QA pass (defect D18, `5a4d0665`, recorded in [docs/qa/2026-10-03-wp-d2.md](../qa/2026-10-03-wp-d2.md) and in [docs/09](../09-frontend-and-pwa.md)) so that a keyboard-only user could build start → wait → done. [ADR-0031](ADR-0031-mounted-context-tabs.md) kept Connections outside the configuration tabs.

The owner's approved consolidated revision of #207 (2026-10-18, owner decision record [#278](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/278)) says: "The owner wants connections authored on the canvas for every node type and the Connections section removed from node dialogs. Verify complete create/change/remove coverage first. This does not reopen general UI redesign or make deferred mobile/accessibility expansion a POC requirement." The approval and its acceptance criteria are on [#207](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/207). Its criteria require the canvas to create, change and remove every supported connection before the modal section goes, and require the removed modal keyboard path to be disclosed at acceptance.

## Decision

The canvas is the only place connections are authored, for every node kind. The node dialog has no Connections list, no Remove edge buttons and no Connect form. Everything else in the dialog stays: the id and label, the configuration form, declaration editing for routes, options, sides, score bands, Script exit-code rows and the Repeat route settings with their removal confirmations, node deletion, protected Chat voice steps and held input.

- **Create.** Drag from an output handle to an input handle, or click an output and then an input. One edge per output; many edges may enter one input; triggers have no input and exits have no output. A drop on a port that refuses it says why in the editor's "Connection refused" notice.
- **Change.** Changing a connection means removing it and drawing it again. That is two undo steps, "remove edge …" then "connect …". The replacement is a new record, so it does not inherit the old edge's manual route (it may reuse the freed edge id); undoing both restores the old record, route included. There is no reconnect handle and no single-step retarget.
- **Geometry.** Editing a connection's route is separate: dragging or nudging a segment and **Reset route** change only `ui.route`, one undo step each, and never the ends.
- **Remove.** Select a connection (click it, or focus it and press Enter or Space), then press Delete or Backspace, or use the **Remove connection** button in the selected connection's toolbar, which is 44 px on a coarse pointer. Protected Chat voice steps refuse removal with their existing message.
- **Recovery.** A stored edge the canvas cannot draw (its source or target node or its output port is missing, or it leads into a trigger) has no path to select. Such edges come from imported or API-written drafts and from ordinary editing, for example renaming or removing a Script exit-code label. They are listed under **Loop issues**, which offers **Remove edge eN** on the first issue of each such edge. It removes exactly that edge, one undo step, only if it is still stored unchanged and still undrawable; a protected voice step is disabled with its message. This is recovery for otherwise stranded topology, not a second authoring form.

### What is lost

Keyboard connection creation. The Connect form was the only way to create a connection without a pointer, and it is gone. The keyboard can no longer create or retarget a connection. This reverses the WP-D2 D18 fix. On a zoomed-out touch canvas the Connect form was also the documented full-size way to connect, because port targets shrink with zoom (about 36 px at 0.784 and 23 px at 0.5); zooming in is now the way.

What the keyboard keeps: reaching a connection, selecting it (Enter or Space), removing it (Delete or Backspace), moving its route segments, and removing undrawable edges from Loop issues. A coarse pointer keeps the visible **Remove connection** button. This is not keyboard or touch parity with creation, and nothing here claims it. Keyboard connection creation and broader accessibility or mobile work stay deferred and are not a new proof-of-concept gate.

## Consequences

- The dialog's Connections wording is gone from the documentation, the user guide and the one contract help string that mentioned it (`routes[].label`). No definition, store, domain or API format changes, so there is no upgrade note beyond the CHANGELOG entry.
- A user who relied on the Connect form must draw with a pointer. Evidence for this change must show create, remove-and-redraw and recovery on the canvas, since the dialog no longer offers them.
- [ADR-0031](ADR-0031-mounted-context-tabs.md)'s sentence that Connections stay outside the configuration tabs no longer has a subject.
