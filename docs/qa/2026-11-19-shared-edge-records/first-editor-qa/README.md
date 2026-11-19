# #481 first editor evidence

This component records the original shared-connection-ID failure and the first candidate's mechanical behavior. Independent QA used base `d3f651c83779ded401878094d35374ac2f494d3d` and frozen candidate `3c2a4dfc80825e53cc68431a0a077d9aacd2aebc`, tree `9f775acb60f3d18daff8df88289f28b484d73331`. All 15 candidate file hashes match their Git blobs. These records predate the guidance correction. [Source and driver bindings](source-bindings.json)

## Recorded baseline and first candidate

| Surface                  | Baseline                                                                                                                                                                                                       | First candidate                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Browser Description edit | Changed an unrelated `e1` from `start/out → pick/in` to `start/yes → pick/in`. The editor reported saved, and the changed definition persisted to the server and device and survived reload                    | Every full connection record remained exact through save, Undo, Redo and reload               |
| Ambiguous route action   | Native keyboard activation of Reset cleared all three holders' manual geometry and changed two source ports. Unique `c1` and `later-edge` stayed exact. Undo and Redo restored the original and changed states | Native nudge and pointer segment drag refused the action and preserved the stored definitions |
| Independent store        | 9/21 passed. Twelve failures covered unrelated edits, unique removal, reset and reroute, Decision ID change and row removal                                                                                    | 21/21 passed with the same driver                                                             |
| Public API               | 19/19 requests passed. Duplicate drafts were admitted, direct saves preserved edges, and validation retained `DUPLICATE_EDGE_ID`. The unique control was publishable                                           | Same 19/19. Normal Publish of a still-malformed candidate draft returned `LOOP_INVALID`       |
| Device recovery          | Service-worker reload while offline restored the exact device definition and its recorded Decision row map. The server stayed original while offline and received the recovered definition after reconnect     | Same recovery. The offline edit also retained the original edges                              |
| Unique-ID browser checks | 13/13 passed, including Reset, keyboard nudge, pointer drag, exact history and reload                                                                                                                          | Same 13/13 passed                                                                             |

[Baseline browser and device records](baseline/records/browser.json) · [Candidate browser and device records](candidate/records/browser.json) · [Baseline API](baseline/records/public-api.json) · [Candidate API](candidate/records/public-api.json) · [Baseline first store result](baseline/records/store-first-run.txt) · [Candidate store result](candidate/records/store-first-run.txt)

The candidate preserved all edges during a Decision label edit and changed only the row-owned edge in the Decision ID rename. Its removal review listed only `Connection accepted → done (e1)`. Cancel kept the full draft. Confirm took that record alone. Undo and Redo restored the complete definitions, with identical server and synced device definitions at each retained step. Re-adding the row and drawing its connection generated `e5` while keeping every other original edge and manual route. Normal Publish froze the exact repaired definition. The full published readback is in the form record. [Form and publish readbacks](candidate/records/forms.json) · [Removal review and refusal](candidate/records/guidance.json)

The public form snapshots omit the separate `device.decisionRoutes` field. The upstream verifier's equality for the form Undo/Redo map compares absent values, so that map claim is unverified by this component. The offline browser records contain actual nonempty maps for both builds and establish the exact recovery described above.

The baseline pointer attempt could not reach the overlapping toolbar. Keyboard Reset supplies the recorded failure. On the first candidate, a post-drag handle lookup timed out after the handles disappeared. A fresh selection then recorded the real segment-circle target, zero previous refusals, one fresh refusal and unchanged server/device definitions. This establishes refusal through a segment action. [Retained timeout](candidate/records/post-drag-observation-error.txt)

### Browser images

- Baseline [Description reported saved](baseline/images/description-autosaved.png) and [Reset enabled under a shared ID](baseline/images/duplicate-route-controls.png).
- First candidate [refusal after a segment action](candidate/images/ambiguous-route-refusal.png), [one-record removal review](candidate/images/owned-record-removal-review.png) and [repaired graph ready to publish](candidate/images/repaired-unique-connection.png).

## Open design findings

A separate targeted Claude Code Opus critique examined the first candidate source, guides, screenshots and baseline records. It did not drive the browser or test screen-reader behavior. The critique SHA-256 is `7ee9c724e906fc891d9f4fffba1850a6756f7c1db39a72342f47f08ad767f4e2`.

- **Medium, unsafe node-deletion advice.** The banner offered deleting either endpoint as a repair alongside removing the Decision row. In the fixture, deleting Done would remove both unrelated hand-routed connections `c1` and `later-edge`. Deleting Pick would remove `later-edge` and Pick's configuration. The row-specific repair kept those bystanders. The number and location of the remaining shared-ID holders were also unclear.
- **Low, pointer discoverability.** A fresh click on the disabled toolbar buttons runs no click handler. Their only local reason was a tooltip title. The retained banner is evidence of a segment action, and tooltip and screen-reader discovery remained unverified. The critique also noted the existing limit on drawing connections from the keyboard.

The coordinator accepted both findings in #481 comment `6997870664`. The corrected source still needs independent checks of the recovery advice, fresh pointer discovery, keyboard refusal, protected voice behavior and bystander geometry. The source locations are `apps/web/src/editor/OrthogonalEdge.tsx`, `apps/web/src/editor/store.ts`, `apps/web/src/editor/decision-route-edges.ts`, `docs/09-frontend-and-pwa.md` and `docs/guide/02-build-a-loop.md`.

## Integrity and limits

The baseline and candidate upstream manifests are unchanged. All 37 entries were hashed again. This subset retains the full paired public browser, API, selected store and unique-ID records and one copy of the shared fixture/store drivers. The five selected PNGs are unchanged. The publication manifest maps the two renamed store excerpts and the diagnostic extract, which removed only two terminal-color codes. The source binding retains the upstream identity hashes and omits the repository account identifier. The review covered public packages only and used no private authentication snapshots. [Baseline upstream manifest](baseline/artifact-manifest.json) · [Candidate upstream manifest](candidate/artifact-manifest.json) · [Publication manifest](publication-manifest.json)

This is bounded first-source evidence. Final author evidence, corrected-source QA, formal review, CI, merge and owner acceptance remain separate.
