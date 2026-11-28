# Selected connection toolbar after Fit view (#479)

A selected connection's toolbar (**Crosses a card**, **Reset route**, **Remove connection**) is now
placed inside the canvas pane after Fit view. Before this change, Fit with the side panels collapsed
put a Decision loop-back's label about 31 px under the pane's top. The toolbar row above the label
was then clipped: on a desktop only its bottom 13.5 px drew, and a coarse pointer's 44 px target
lost part of its height in the opening view and both Fits. The evidence showed partial clipping
with a recovery path (pan or zoom), not a wholly unreachable control.
[Issue #479](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/479)

The row is placed from xyflow's measured pane and the row's own measured box, kept 8 px inside the
pane. The first of these steps that works wins:

1. **Above** the label, where it was before. Every view that already had room keeps it exactly.
2. **Below** the label, 18 px under it, when that fits and covers no segment handle or card port.
3. **Clamp** inside the pane, on the side of the label with more room.

Other rules:

- A label off the pane takes the row with it.
- At 320 px the row wraps, with **Remove connection** last.
- Camera moves never save or add history.
- A held **Reset route** keeps its place until the view changes.
- The #481 shared-id note goes on the far side of the controls.

The behaviour is documented in [docs/09](../../09-frontend-and-pwa.md) under "Toolbar placement
(#479)".

## Design, candidate and base

- **Design:** accepted Claude UI design FUP-085. [Design original](raw/design/DESIGN.claude.md.txt)
- **Base:** `14ea69842025c627f704b436727385d78e08768c`.
- **Branch:** `codex/gg-fu-ui-479-20261124`.
- **Candidate commits:**
  - `7c893c7795a086e349e87041f0c144442fc6f282`: the implementation, a new Edge spec
    `apps/web/e2e/routing-toolbar.spec.ts`, docs/09 and the CHANGELOG.
  - `4bf69340050246d8bc47ace432413a89ab342eb3`: the review follow-up for F6, F4, F5 and F3.
  - `07f2af93f9b6c554001c7862c4da49d21d106bdf`: the merge of `origin/main` at
    `4e1037c9e9922ffa27237fe79850403b6b54fc70`, then this packet.
- **Untouched:** Fit, its padding, `Canvas.tsx`, the gesture gate, the store, and saved routes and
  labels. There is no stored-format or API change.

## Author evidence

All runs used Windows, Node v22.23.4 and installed Edge 158 through the Playwright `msedge` channel
(workers 1, retries 0), with the existing in-memory e2e server (Ollama discovery off).
[Author report](raw/author/AUTHOR-REPORT.md.txt)

| Check                                                                              | Result                                                                                                                                                                            | Raw                                                                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Focused units (OrthogonalEdge, viewport-gesture contract, Space cards Fit, Canvas) | 150/150 at `7c893c77`; 151/151 after the F6 test                                                                                                                                  | [author](raw/author/UNIT-FOCUSED.log.txt) · [follow-up](raw/follow-up/FU1-UNIT-FOCUSED.log.txt)                      |
| Web typecheck, lint, Prettier                                                      | pass; lint has 0 errors (5 warnings, all in untouched files)                                                                                                                      | [lint](raw/follow-up/FU1-WEB-LINT.log.txt) · [typecheck](raw/follow-up/FU1-WEB-TYPECHECK.log.txt)                    |
| `pnpm build`                                                                       | 12/12 tasks                                                                                                                                                                       | [build](raw/author/BUILD.log.txt) · [follow-up build](raw/follow-up/FU1-BUILD.log.txt)                               |
| Web coverage                                                                       | 3218/3218 tests; lines 98.7%, branches 94.48%; `OrthogonalEdge.tsx` lines 100%, branches 97.39%. A first attempt was stopped by the author's own 25 min limit before it reported. | [coverage](raw/author/WEB-COVERAGE-02.log.txt) · [stopped attempt](raw/author/WEB-COVERAGE.log.txt)                  |
| Edge `routing-toolbar.spec.ts`, first run                                          | 6 passed, 2 failed, both test-construction faults: a shared-id locator, and a clamp case no window size reaches. Retained.                                                        | [run 01](raw/author/E2E-routing-toolbar-01.log.txt)                                                                  |
| Edge `routing-toolbar.spec.ts`                                                     | 7/7 at `7c893c77`, and again at `4bf69340`                                                                                                                                        | [run 03](raw/author/E2E-routing-toolbar-03.log.txt) · [follow-up run](raw/follow-up/FU1-E2E-routing-toolbar.log.txt) |
| Existing Edge `edge-routes` and `shared-edge-ids` specs                            | 18/18                                                                                                                                                                             | [log](raw/author/E2E-existing-edge-routes-shared-ids.log.txt)                                                        |
| F6 test without the tolerance                                                      | fails as intended (`expected false to be true`)                                                                                                                                   | [log](raw/follow-up/F6-UNIT-WITHOUT-TOLERANCE.log.txt)                                                               |

### Remove connection after Fit: before and after

The table shows where the centre of **Remove connection** lands. "Probes" means a 9 × 7 grid,
inset 4 px, tested with `elementFromPoint`.

| Case                                          | Before (native baseline) | After                                    | Design prediction |
| --------------------------------------------- | ------------------------ | ---------------------------------------- | ----------------- |
| Desktop 1280 × 900, Fit with panels collapsed | 27/63 probes, clipped    | below the label, (475.23, 178.52), 63/63 | (475.2, 178.5)    |
| Coarse 1024 × 768, opening                    | 14/63                    | below, (472.71, 183.93), 44 px, 63/63    | (472.7, 183.9)    |
| Coarse, Fit with panels open                  | 49/63                    | below, (472.97, 216.78), 44 px, 63/63    | (473.0, 216.8)    |
| Coarse, Fit with panels collapsed             | 14/63                    | below, (376.55, 186.12), 44 px, 63/63    | (376.6, 186.1)    |
| 320 × 800, opening                            | 21/63                    | below, (130.24, 336.50), 63/63           | (130.2, 336.5)    |

These views did not move and match the baseline exactly:

- desktop opening and the Fit with panels open;
- the desktop 46 px pan;
- coarse zoom;
- the 390 × 844 opening and Fit.

The geometry files cover every stage: [desktop light](raw/author/geometry/desktop-light.json) ·
[desktop dark](raw/author/geometry/desktop-dark.json) · [coarse](raw/author/geometry/coarse-dark.json) ·
[390](raw/author/geometry/narrow390-light.json) · [320](raw/author/geometry/narrow320-dark.json) ·
[Reset](raw/author/geometry/reset-held.json) · [shared id](raw/author/geometry/shared-id.json).

Screenshots: [before](raw/native/desktop-light-collapsed-panels-fit-before.png) ·
[after](raw/author/screenshots/desktop-light-collapsed-panels-fit.png) ·
[coarse opening](raw/author/screenshots/coarse-dark-opening.png) ·
[320 opening](raw/author/screenshots/narrow320-dark-opening.png) ·
[320 wrapped row](raw/author/screenshots/narrow320-dark-crossing.png) ·
[Reset held](raw/author/screenshots/reset-held-after.png).

The spec also establishes:

- The toolbar frame intercepts nothing, and every segment handle's centre hits its handle.
- No draft save comes from the opening, Fits, flips, pans or zoom.
- One trusted click or tap on Remove sends one `If-Match` save that removes only that edge. One
  Undo saves once and restores the stored definition byte for byte, and the edge is still there
  after reload.
- Three presses of **Reset route** save once, with one history entry.
- A shared id's note sits under the controls.
- At 320 px the row wraps with **Remove connection** last.

## Independent review and QA

A separate Claude Opus 5.5 session reviewed and QA'd `7c893c77`.

- **Review:** APPROVE (interim). No P1 or P2 finding. [Review original](raw/review/REVIEW.md.txt)
- **QA:** PASS WITH LIMITS. [QA original](raw/review/QA-REPORT.md.txt)

| Finding | Summary                                                                                                                                                                                                                                                           | Disposition                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| F1      | After a later press on the held **Reset route**, focus stays on that button. This is the existing #207 behaviour.                                                                                                                                                 | No change.                                                                                                    |
| F2      | When Below would cover a target and below is the roomier side, Clamp lands on Below's place. Seen at 320 × 800 with a manual lane through a card: two port centres hit controls while the connection is selected. [Screenshot](raw/review/diag-wrap320-light.png) | Deferred to a follow-up issue (owner design decision). Named as a known limit in docs/09 and the CHANGELOG.   |
| F3      | The coarse port width is overestimated (conservative).                                                                                                                                                                                                            | No change. The source comment was corrected in `4bf69340`.                                                    |
| F4      | The docs said a zoom renders the toolbar only when its place changes, but a zoom re-renders it through the existing zoom subscription.                                                                                                                            | Fixed in `4bf69340` (docs/09 and the CHANGELOG).                                                              |
| F5      | On short, narrow coarse canvases (320 × 568) the row can sit partly under xyflow's Controls panel: 56/63 probes hit, and the centre still hits. [Screenshot](raw/review/diag-phone-320x568-light-fit.png)                                                         | Deferred to a follow-up issue. The CHANGELOG claim was qualified and docs/09 names the limit.                 |
| F6      | A wrapped row measured at 214.00003 px against its 214 px max-width reported `data-overflow`. [Screenshot](raw/review/diag-overflow-light.png)                                                                                                                    | Fixed in `4bf69340`: the comparison now allows `MEASURE_STEP` (0.5 px), and a new unit test fails without it. |

The QA cases (21) ran on a built API and web over a disposable store, in both themes unless noted:

- the desktop, coarse, 390 and 320 Fit sequences;
- acceptance remove and Undo with readbacks;
- zero camera writes, including pan sweeps and a resize;
- frame, port and handle non-interception;
- the Reset hold over a card corner;
- keyboard, the focus ring and contrast;
- Redo;
- the #481 shared id;
- a protected voice step;
- a stale conflict with reload (light only);
- label-height sweeps;
- coarse phone sizes.

The QA reruns of the gates are retained: [routing-toolbar](raw/review/E2E-routing-toolbar.log.txt) ·
[edge-routes](raw/review/E2E-edge-routes.log.txt) · [shared-edge-ids](raw/review/E2E-shared-edge-ids.log.txt) ·
[build](raw/review/BUILD.log.txt). The [pane-relative comparison](raw/review/pane-relative-comparison.txt)
explains why QA's real-API header placed some coarse and narrow stages lower than the test server.

## Merge with main

After the merge of `origin/main`, these passed:

- web typecheck;
- lint;
- `pnpm format:check`;
- focused units (including `store.rename.test.ts`, which main changed).

See [typecheck](raw/follow-up/FU2-WEB-TYPECHECK.log.txt) · [lint](raw/follow-up/FU2-WEB-LINT.log.txt) ·
[format](raw/follow-up/FU2-FORMAT-CHECK.log.txt) · [units](raw/follow-up/FU2-UNIT-FOCUSED.log.txt).

## Not established

- **Hardware and platforms.** No physical touch hardware or phone was used: coarse is Chromium
  emulation with CDP taps, headless Edge on Windows. Linux CI Edge was not run.
- **Clamp in the maintained browser spec.** The editor keeps a canvas of at least 263 px, so no
  window size reaches it. QA reached it in sweeps (F2, F5).
- **Pre-#479 behaviour in the F5 geometries** was reasoned, not run.
- **Narrower QA coverage:**
  - mouse-pan gating with a click during settling was not separately probed;
  - store-level stale selection was not driven in the browser;
  - forced colours were checked only by the existing `edge-routes` case.
- **Browser runs after the merge.** No browser suite was rerun on the merged tree; the merge
  brought no change to the toolbar's sources.
- **Gates still pending:** the GPT-6.1 Sol opposite-family review, the fresh Astra MAX final audit,
  hosted CI and coverage. Owner acceptance is separate.

## Files

[MANIFEST.json](MANIFEST.json) lists each retained file with its source, size and SHA-256. Files
under `raw/` are kept byte for byte (`.gitattributes`). Markdown originals are stored as `.md.txt`
and logs as `.log.txt`.
