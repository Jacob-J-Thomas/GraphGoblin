# #13 and #46: node editor dialog, loop panel, and New run, before and after

Date: 2026-10-04. The real app, built with `pnpm build` and served by `apps/web/e2e/server.ts` (the in-memory API with the fake harness), in Edge with reduced motion, viewport screenshots in Dark and Light. The seed has `nightly-triage` (one node of each kind, a loop-back, two published versions and a newer draft), `release-notes` (never published), two finished runs, and `conflict-demo`.

- `before-dark/`, `before-light/`: `fce5cb5`, before the change (the Node, Loop, and Run tabs in the side panel).
- `after-dark/`, `after-light/`: after it.

Regenerate with `node docs/qa/2026-10-04-editor-modal-and-runs/capture.mjs before|after` after `pnpm build` (`before` needs a build of the earlier commit). `GG_CAPTURE_ONLY` takes a comma-separated list of screen names.

## Screens

At 1024x768 (`-1024`) and 1440x900 (`-1440`) unless noted.

| File                    | Before                                       | After                                                                                     |
| ----------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `editor-<kind>`         | The node selected; the side panel's Node tab | The node clicked: its editor dialog, "Edit <kind> <id>", one file per kind (all nine)     |
| `editor-loop-panel`     | Loop settings pressed: the Loop tab          | The loop panel expanded (settings, then the validation list pinned at the bottom)         |
| `editor-loop-collapsed` | -                                            | The loop panel collapsed to its rail (Show, and the issue counts or "ready")              |
| `editor-run-tab`        | Run pressed: the Run tab with the launcher   | - (removed: runs start from Runs)                                                         |
| `editor-unpublished`    | A never-published loop: Run disabled         | The same: "Open in Runs" disabled, with keyboard focus on it                              |
| `editor-conflict`       | -                                            | Another tab saved while a node was open; the conflict notice inside the dialog            |
| `editor-sheet`          | -                                            | `-390` (390x844): the dialog as a bottom sheet; `-768` (768x1024): centred again          |
| `runs`                  | Runs list                                    | Runs list with the New run action                                                         |
| `new-run`               | -                                            | `/runs/new?loop=…`: loop chosen, version (v2 current, v1), manual trigger, the input form |
| `new-run-invalid`       | -                                            | Start run with the required `repo` empty: refused before sending                          |
| `new-run-choose`        | -                                            | `/runs/new`: choose a published loop                                                      |
| `new-run-unpublished`   | -                                            | `/runs/new?loop=<release-notes>`: why it cannot start, with a link to the editor          |

## What was checked in Edge beyond the screenshots

`apps/web/e2e/editor-modal.spec.ts` drives these against the built app in Edge (Playwright):

- A click on a node opens its editor; a drag of the same node by 100+ px moves it and opens nothing; a click on a port handle opens nothing.
- Enter on a focused node opens the editor with focus on its heading; Shift+Tab and Tab wrap inside it; Delete and Backspace edit a field's text and do nothing on a button; Esc and a click on the backdrop close it with focus back on the node; Delete node leaves focus on the canvas.
- The dialog is `:modal` and the page behind is inert (Publish cannot take focus until it closes).
- The loop panel's state survives a reload; a fresh window at 1024 px starts collapsed; storage that throws changes nothing visible.
- New run from Runs with a published loop, from a deep link across a reload, with an unpublished loop (disabled link with its reason, and the deep link's explanation), invalid trigger input, and a second run of the same loop while the first waits.
- Two tabs: a draft conflict met while a node is open is answered from the dialog; Reload server draft loads the other tab's draft and closes the dialog.
- Narrow windows: 390 and 767 px show the bottom sheet at full width; 768 px and wider show the centred dialog. The rest of the editor at 390 px still overflows sideways, as before (#41).
