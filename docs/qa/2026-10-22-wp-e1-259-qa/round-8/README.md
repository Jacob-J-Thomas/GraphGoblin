# Independent QA, round 8: #259 / PR #382

## 1. Verdict

**FAIL**, at **4ef4093e053a1ad7f2063b1cd8ccba5f0937a11c**, detached HEAD. **The audit's eviction reproduction passes at both widths, QA-259-R6-01 remains fixed, and the round-7 API validation gate is resolved.** One new minor defect remains: a failed explicit reconstruction in large-history mode leaves the request card visible without its failure alert (**QA-259-R8-01**).

Independent QA, alone, fake-only execution through mutate nodes and the fake harness. No production or maintained-test edits, staging, commits, stash, branch operations or GitHub writes. Only round-8 QA evidence was added. The revision was checked before work and again at shutdown ([environment.json](environment.json), [final-state.json](final-state.json)). Built API/web used ports **5720/5721**, disposable store **gg-qa-e1-G5dsDO**, Node **v22.14.0**, installed Edge **155.0.4283.62**, headless, Windows **10.0.26300**. Both owned ports were closed after testing ([shutdown.json](shutdown.json)). No owner app/store or live provider was used.

The exact API file that timed out in round 7 was run **alone, before the app, build or any other QA job**: all **5/5 passed**, first attempt, Vitest duration **7.52 s**, command elapsed **8,365 ms**. This follows the user's explicit round-8 instruction; no second attempt, threshold change or test edit was needed. No host-state diagnosis is inferred from the pass, and the historical failed log is unchanged. Evidence: [api-lookahead-alone.log.txt](api-lookahead-alone.log.txt).

## 2. Defects

**QA-259-R8-01 — minor — large-history explicit replay failures never display the failure alert.** Reproduced at 1440 × 900 and 390 × 844. This is controlled malformed external-input evidence, not a claim that the fake engine naturally emits an invalid patch.

1. Through the API, publish and start the 350,000-property Variables fixture; its initial history is about 6.4 million JSON characters. The fixture is a normal mutate run, waiting for input.
2. In a separate Edge page, intercept only that run's browser event-stream response. Preserve the original events and append one contract-shaped invalid domain patch operation to seed's node.finished event 6: remove /vars/absent-qa. Keep the large set-/vars operation, so the history remains above the threshold. Stored API events/thread are not modified.
3. Select event 6. Activate **Reconstruct the thread at event 6** and wait for the attempt to finish.
4. Actual at both widths: **one request card, zero alerts, zero Variables previews**. Focus remains on the request button. The user receives no reason that reconstruction failed. Selecting event 1 and requesting it still works, so the page is recoverable.

Expected: an explicit failed request shows the existing event-specific failure alert and reason. Below the threshold, the same invalid remove operation correctly produces **The thread cannot be reconstructed at event 6 — operation 0 (remove /vars/absent-qa): path does not exist**. This control confirms a real replay failure rather than a missing stream or invalid fixture setup.

Source corroboration: projections.ts ThreadCache.has returns true only for an ok result; ThreadViewer.tsx uses it to decide ready, returns the request card when false, and reaches the failure alert only after that early return. A failed cache.at result therefore cannot reach the alert in large-history mode. The source delta is [change.diff.txt](change.diff.txt); source reasoning is not an old-head execution claim. No fix was made.

Evidence: [invalid-replay-1440.json](invalid-replay-1440.json), [invalid-replay-390.json](invalid-replay-390.json), [invalid-replay-1440.png](invalid-replay-1440.png), [invalid-replay-390.png](invalid-replay-390.png), [eviction.mjs.txt](eviction.mjs.txt), [eviction.log.txt](eviction.log.txt); below-threshold controls and before/after API hashes in [continuation-results.json](continuation-results.json), [continuation.mjs.txt](continuation.mjs.txt), [continuation.log.txt](continuation.log.txt). The original large response bytes were reproduced exactly and are manifested in [NOT-KEPT.md](NOT-KEPT.md); retained small response bodies are indexed below. Both fault pages have zero page errors and API thread/events hashes are identical before and after viewing.

The previous eviction finding is fixed for the measured successful replays. The requested keyboard regression is also fixed: live replacement sends owned focus to the new Reconstruct button; Tab then Enter on that button sends focus to the Messages list (tabindex -1), and Tab reaches Show all of Variables and removes the list tabindex. A keyboard on a timeline control or Pause is left there on the tested live card/prepared-return transitions. QA-259-01's distinct-value A/B/A and QA-259-R5-01's stale hand-off spot checks pass. QA-259-02 remains disposed; no new full-thread property-order claim is made.

## 3. Coverage of criteria

Touched systems: ThreadViewer's large-history readiness, requested replay and patch diff; the bounded ThreadCache and grown-log retention; viewer/value focus ownership; Variables preview/download; API paging validation; compiled composition and docs. Positive cases and the malformed replay negative are tested through public API/UI/component interfaces. No private application store, component function or cache map was patched or inspected. Read-only DOM/PerformanceObserver/CDP profiling is identified below. [browser-environment.json](browser-environment.json) and [change.diff.txt](change.diff.txt) record environment and the exact scoped delta.

| Requested criterion                                     | Coverage                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round-7 API setup timeout                               | PASS: isolated run-event-paging.test.ts, five assertions, first attempt. No conditional second attempt required.                                                                                                                                                                                |
| Reconstruct 35 distinct wide-value events, return first | PASS at both widths: explicitly request consecutive events 7–41, all holding the admitted 350,000-property value. Every uncached selection asks. Return 7 shows the card; Variables is absent and the card remains after 250 ms. No observed long task and zero sampled replay/serializer work. |
| Patch predecessor retention                             | PASS: after requesting 7–39, event 8's own result is still within the FIFO window but its predecessor 7 has fallen out; selecting 8 asks again. No hidden predecessor replay. This follows the public sequence and component behavior, corroborated by the public cache unit tests.             |
| Recent reconstruction                                   | PASS: event 41 shows immediately without a card, desktop/narrow 107.4/89.7 ms, no observed long task.                                                                                                                                                                                           |
| Requested node.finished diff                            | PASS: request seed event 6; its /vars after column is the exact first 1,024 pretty-JSON characters plus ellipsis; diff is shown. Variables is 4,096 plus ellipsis.                                                                                                                              |
| Live append with prepared earlier event                 | PASS: event 41 stays shown and expanded while events grow, Variables region keeps focus.                                                                                                                                                                                                        |
| Live following selection / keyboard                     | PASS at both widths: fresh page follows latest; live card takes owned focus; request -> Messages list; Tab cleanup; separate outside timeline/Pause cases stay outside.                                                                                                                         |
| Negative replay                                         | FAIL: QA-259-R8-01; below-threshold failure control and storage integrity PASS.                                                                                                                                                                                                                 |
| Exactness download                                      | PASS: both Variables downloads equal API vars byte for byte under two-space JSON formatting; 7,827,782 bytes each; SHA-256 b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3.                                                                                                    |
| Earlier regressions                                     | PASS: original distinct 20,000/21,000-character A/B values, cached return, another value's focus, and large-to-small held text then Tab. All normal recorded document widths equal 1440/1440 or 390/390.                                                                                        |
| Gates and maintained browser tests                      | Build, affected units, lint/types/layers/deps/tokens, formatting and maintained Edge spec: results below. Full coverage explicitly waived.                                                                                                                                                      |

Every independent case, including invalid helpers retained for provenance:

| System / case                                                     | Steps / expected                                                                                                                                    | Actual                                                                                                                                                                                                                                 | Result                               | Evidence                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1440: API wide fixture                                            | API admits 350000 properties, history above 2000000 chars, >41 events; fake-only mutate run                                                         | 6441305 history chars; 52 events; 350000 variables properties                                                                                                                                                                          | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 1440: 35 explicit reconstructions and eviction                    | Every uncached event asks; an evicted predecessor also requires a card; first evicted event stays a card with no replay, recent result is immediate | 35 explicit events 7–41; predecessor of event 8 evicted after request 39 -> card; first 7 -> card, 61.6 ms, no long tasks or replay/serializer samples; recent 41 -> 107.4 ms, no long task                                            | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 1440: requested patch diff and exact download                     | node.finished seed asks, then shows bounded patch diff; Variables download bytes exactly API vars                                                   | Diff after 1025 chars; exact 7827782-byte download; width 1440/1440                                                                                                                                                                    | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 1440: earlier prepared event survives append                      | An earlier selection remains reconstructed with its unchanged expanded Variables and keyboard while the log grows                                   | Event 41 unchanged/expanded; PRE Variables -> PRE Variables; width 1440/1440                                                                                                                                                           | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 1440: QA-259-R6-01 live card and keyboard Reconstruct             | Live card takes owned focus; Tab+Enter Reconstruct hands it to the list; Tab removes list tabindex                                                  | Request -> OL Messages, tabindex -1; Tab -> Show all of Variables; live -> Reconstruct the thread at event 68; Enter -> OL Messages; list tabindex removed                                                                             | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 1440: outside timeline and run control are untouched              | Keyboard outside viewer stays there on card selection and reconstruction; A/B/A remains bounded                                                     | request stole outside timeline focus                                                                                                                                                                                                   | INVALID HELPER; continued separately | [eviction-results.json](eviction-results.json)                                                                                 |
| 1440: controlled invalid large-history replay                     | A failed explicit replay reports an error, permits recovery, and changes no stored values                                                           | failed explicit replay leaves request card without a failure alert                                                                                                                                                                     | FAIL: QA-259-R8-01                   | [eviction-results.json](eviction-results.json)                                                                                 |
| 390: API wide fixture                                             | API admits 350000 properties, history above 2000000 chars, >41 events; fake-only mutate run                                                         | 6441303 history chars; 52 events; 350000 variables properties                                                                                                                                                                          | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 390: 35 explicit reconstructions and eviction                     | Every uncached event asks; an evicted predecessor also requires a card; first evicted event stays a card with no replay, recent result is immediate | 35 explicit events 7–41; predecessor of event 8 evicted after request 39 -> card; first 7 -> card, 109.8 ms, no long tasks or replay/serializer samples; recent 41 -> 89.7 ms, no long task                                            | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 390: requested patch diff and exact download                      | node.finished seed asks, then shows bounded patch diff; Variables download bytes exactly API vars                                                   | Diff after 1025 chars; exact 7827782-byte download; width 390/390                                                                                                                                                                      | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 390: earlier prepared event survives append                       | An earlier selection remains reconstructed with its unchanged expanded Variables and keyboard while the log grows                                   | Event 41 unchanged/expanded; PRE Variables -> PRE Variables; width 390/390                                                                                                                                                             | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 390: QA-259-R6-01 live card and keyboard Reconstruct              | Live card takes owned focus; Tab+Enter Reconstruct hands it to the list; Tab removes list tabindex                                                  | Request -> OL Messages, tabindex -1; Tab -> Show all of Variables; live -> Reconstruct the thread at event 68; Enter -> OL Messages; list tabindex removed                                                                             | PASS                                 | [eviction-results.json](eviction-results.json)                                                                                 |
| 390: outside timeline and run control are untouched               | Keyboard outside viewer stays there on card selection and reconstruction; A/B/A remains bounded                                                     | request stole outside timeline focus                                                                                                                                                                                                   | INVALID HELPER; continued separately | [eviction-results.json](eviction-results.json)                                                                                 |
| 390: controlled invalid large-history replay                      | A failed explicit replay reports an error, permits recovery, and changes no stored values                                                           | failed explicit replay leaves request card without a failure alert                                                                                                                                                                     | FAIL: QA-259-R8-01                   | [eviction-results.json](eviction-results.json)                                                                                 |
| 1440: corrected outside ownership and A/B/A                       | Prepared A/B/A stays bounded and keeps outside timeline/Pause focus; a live request card and a prepared return keep the timeline focus              | A return expanded                                                                                                                                                                                                                      | INVALID HELPER; continued separately | [continuation-results.json](continuation-results.json)                                                                         |
| 1440: retain controlled fault capture and below-threshold control | The injected failure is a real invalid patch; below threshold it displays event 6 failure; API storage is unchanged                                 | Below-threshold 17553 chars -> The thread cannot be reconstructed at event 6operation 0 (remove /vars/absent-qa): path "/vars/absent-qa" does not exist; API thread/events hashes unchanged; large fault capture matches original hash | PASS                                 | [continuation-results.json](continuation-results.json)                                                                         |
| 390: corrected outside ownership and A/B/A                        | Prepared A/B/A stays bounded and keeps outside timeline/Pause focus; a live request card and a prepared return keep the timeline focus              | A return expanded                                                                                                                                                                                                                      | INVALID HELPER; continued separately | [continuation-results.json](continuation-results.json)                                                                         |
| 390: retain controlled fault capture and below-threshold control  | The injected failure is a real invalid patch; below threshold it displays event 6 failure; API storage is unchanged                                 | Below-threshold 17552 chars -> The thread cannot be reconstructed at event 6operation 0 (remove /vars/absent-qa): path "/vars/absent-qa" does not exist; API thread/events hashes unchanged; large fault capture matches original hash | PASS                                 | [continuation-results.json](continuation-results.json)                                                                         |
| 1440: outside ownership                                           | Outside timeline/Pause remains on prepared return; timeline remains across live request card and prepared return                                    | Timeline A/B and Pause retained; live card -> #1run.queued; prepared return -> #1run.queued; width 1440/1440                                                                                                                           | PASS                                 | [outside-control-results.json](outside-control-results.json)                                                                   |
| 390: outside ownership                                            | Outside timeline/Pause remains on prepared return; timeline remains across live request card and prepared return                                    | Timeline A/B and Pause retained; live card -> #1run.queued; prepared return -> #1run.queued; width 390/390                                                                                                                             | PASS                                 | [outside-control-results.json](outside-control-results.json)                                                                   |
| 1440: stale hand-off exact keyboard steps                         | Live B hand-off once; keyboard selections A and cached B remain on the timeline                                                                     | Live B -> Show all of Variables; timeline A #6node.finishedseed → out, 2 changes, 0 ms, B #16run.waitingnotouch waits for input retained; other message region retained; distinct A returns 4097 chars                                 | PASS                                 | [focus-results.json](focus-results.json)                                                                                       |
| 1440: large-to-small value hand-off                               | Text holds focus at tabindex -1; Tab moves on and removes tabindex                                                                                  | PRE Variables tabindex -1; Tab -> Full thread JSON; remaining tabindex null                                                                                                                                                            | PASS                                 | [focus-results.json](focus-results.json)                                                                                       |
| 390: stale hand-off exact keyboard steps                          | Live B hand-off once; keyboard selections A and cached B remain on the timeline                                                                     | Live B -> Show all of Variables; timeline A #6node.finishedseed → out, 2 changes, 0 ms, B #16run.waitingnotouch waits for input retained; other message region retained; distinct A returns 4097 chars                                 | PASS                                 | [focus-results.json](focus-results.json)                                                                                       |
| 390: large-to-small value hand-off                                | Text holds focus at tabindex -1; Tab moves on and removes tabindex                                                                                  | PRE Variables tabindex -1; Tab -> Full thread JSON; remaining tabindex null                                                                                                                                                            | PASS                                 | [focus-results.json](focus-results.json)                                                                                       |
| Outside helper interruption                                       | Wait for the final run, then check outside focus                                                                                                    | Helper polled nonexistent completed instead of documented succeeded; interrupted its own exec session. No assertion result claimed. Continued on a fresh large-history control with a next input wait.                                 | INVALID HELPER                       | [outside-interruption.json](outside-interruption.json), [outside.mjs.txt](outside.mjs.txt), [outside.log.txt](outside.log.txt) |

QA-helper corrections: first, native DOM activation of Reconstruct deliberately requests a focus hand-off, so it was not a valid outside-focus prepared-return check ([focus-helper-correction.json](focus-helper-correction.json)). Second, the wide fixture deliberately preserves the same vars value; unchanged expansion should remain, so it was invalid for the distinct-value A/B/A assertion ([same-value-helper-correction.json](same-value-helper-correction.json)). Finally, the extra terminal poll used the wrong contract status and was interrupted as above. All original scripts/logs and invalid rows are retained. Only interrupted assertions continued in [outside-control.mjs.txt](outside-control.mjs.txt), [outside-control-results.json](outside-control-results.json), [outside-control.log.txt](outside-control.log.txt); the actual distinct-value fixture is [focus.mjs.txt](focus.mjs.txt), [focus-results.json](focus-results.json), [focus.log.txt](focus.log.txt). These are QA corrections, not product fixes or whole-suite retries to mask a product failure. The confirmed negative failure remains failed at both widths.

Measurements use standard **≥50 ms long tasks**, action to two animation frames after the expected state, installed headless Edge. Every observed task is retained. CDP mouse input avoids Playwright actionability waiting for the selection samples; other wall times include automation, scheduling and native/API work. They are not INP or a universal performance SLA. Validation jobs finished before independent browser timings. No unrelated host activity was controlled. DOM probes observe public output only; profiling does not invoke or replace application functions.

Evicted selection: **61.6 / 109.8 ms** desktop/narrow, **no long tasks, zero replay/serializer CPU samples**; selected event and card committed, followed by a browser Paint. The trace's card may be below the fold during selection; the dedicated screenshots show it after scrolling. This distinguishes a committed request state from an unrequested replay, without claiming a below-fold card was visible in that earlier paint. Profiles, trace evidence, state records and selected frames are linked below. Cold explicit request 7 still incurs **549 / 510 ms** tasks; requested seed diff incurs **592 / 620 ms** tasks. Those costs happen on request. Initial page loading and original fixture construction are not included in the selection measurements.

All 70 requested event selections and reconstructions (each selection showed a request card; each successful preview matched its exact prefix):

| Width / event           | Select wall ms | Every select long task ms | Request wall ms | Every request long task ms | Patch diff | Evidence                                               |
| ----------------------- | -------------: | ------------------------- | --------------: | -------------------------- | ---------- | ------------------------------------------------------ |
| 1440 / 7 node.started   |           27.4 | none                      |           618.0 | 549                        | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 8 node.finished  |           29.9 | none                      |            63.1 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 9 node.started   |           25.8 | none                      |            62.5 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 10 node.finished |           26.7 | none                      |            59.5 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 11 node.started  |           29.3 | none                      |            64.4 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 12 node.finished |           24.5 | none                      |            65.6 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 13 node.started  |           23.4 | none                      |            91.5 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 14 node.finished |           32.6 | none                      |            64.5 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 15 node.started  |           22.0 | none                      |            62.3 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 16 node.finished |           48.7 | none                      |            78.7 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 17 node.started  |           29.2 | none                      |            74.9 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 18 node.finished |           24.6 | none                      |            67.3 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 19 node.started  |           68.3 | none                      |            86.1 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 20 node.finished |           34.6 | none                      |            64.8 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 21 node.started  |           23.9 | none                      |            81.5 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 22 node.finished |           26.1 | none                      |            71.3 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 23 node.started  |           22.8 | none                      |            75.5 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 24 node.finished |           25.9 | none                      |           151.8 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 25 node.started  |           65.8 | none                      |            68.2 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 26 node.finished |           21.3 | none                      |            61.7 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 27 node.started  |           39.2 | none                      |            66.9 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 28 node.finished |           31.2 | none                      |            70.3 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 29 node.started  |           27.6 | none                      |            84.4 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 30 node.finished |           23.5 | none                      |            72.2 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 31 node.started  |           32.7 | none                      |            45.0 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 32 node.finished |           32.2 | none                      |            74.5 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 33 node.started  |           19.9 | none                      |            70.0 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 34 node.finished |           39.8 | none                      |            77.8 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 35 node.started  |           32.2 | none                      |            82.1 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 36 node.finished |           33.5 | none                      |            92.1 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 37 node.started  |           32.6 | none                      |           131.0 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 38 node.finished |          126.9 | none                      |            62.1 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 39 node.started  |           35.7 | none                      |            73.2 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 40 node.finished |           28.1 | none                      |            69.6 | none                       | yes        | [explicit-events-1440.json](explicit-events-1440.json) |
| 1440 / 41 node.started  |           50.3 | none                      |            57.3 | none                       | no         | [explicit-events-1440.json](explicit-events-1440.json) |
| 390 / 7 node.started    |           25.4 | none                      |           566.6 | 510                        | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 8 node.finished   |           23.9 | none                      |            66.3 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 9 node.started    |           27.2 | none                      |            69.2 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 10 node.finished  |           30.0 | none                      |            63.8 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 11 node.started   |           28.3 | none                      |            74.0 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 12 node.finished  |           37.0 | none                      |            82.3 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 13 node.started   |           31.2 | none                      |            72.9 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 14 node.finished  |           28.0 | none                      |            81.7 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 15 node.started   |          109.6 | none                      |           114.5 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 16 node.finished  |           44.7 | none                      |           118.7 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 17 node.started   |           35.8 | none                      |            92.1 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 18 node.finished  |           65.1 | none                      |            98.8 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 19 node.started   |           32.9 | none                      |           120.3 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 20 node.finished  |           27.0 | none                      |            91.6 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 21 node.started   |           23.5 | none                      |            58.5 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 22 node.finished  |           65.0 | none                      |            67.5 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 23 node.started   |           32.1 | none                      |            65.1 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 24 node.finished  |           29.4 | none                      |            62.8 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 25 node.started   |           27.4 | none                      |            76.5 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 26 node.finished  |           42.8 | none                      |            91.7 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 27 node.started   |           27.7 | none                      |            76.5 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 28 node.finished  |           31.4 | none                      |            69.3 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 29 node.started   |           32.2 | none                      |            83.6 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 30 node.finished  |           20.7 | none                      |            67.1 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 31 node.started   |           45.7 | none                      |            86.7 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 32 node.finished  |           69.2 | none                      |            95.9 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 33 node.started   |           45.1 | none                      |            70.8 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 34 node.finished  |           27.7 | none                      |            92.2 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 35 node.started   |           24.9 | none                      |            73.4 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 36 node.finished  |           29.1 | none                      |            65.4 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 37 node.started   |           36.5 | none                      |            67.7 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 38 node.finished  |           33.0 | none                      |            68.8 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 39 node.started   |           21.7 | none                      |            71.4 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 40 node.finished  |           21.5 | none                      |            87.4 | none                       | yes        | [explicit-events-390.json](explicit-events-390.json)   |
| 390 / 41 node.started   |           25.9 | none                      |            84.2 | none                       | no         | [explicit-events-390.json](explicit-events-390.json)   |

Other timed operations, including the explicit failing requests:

| Operation / width                                            | Wall ms | Every long task ms | Evidence                                                     |
| ------------------------------------------------------------ | ------: | ------------------ | ------------------------------------------------------------ |
| 1440: 35 explicit reconstructions and eviction / evicted     |    61.6 | none               | [eviction-results.json](eviction-results.json)               |
| 1440: 35 explicit reconstructions and eviction / recent      |   107.4 | none               | [eviction-results.json](eviction-results.json)               |
| 1440: requested patch diff and exact download / cost         |   725.4 | 592                | [eviction-results.json](eviction-results.json)               |
| 1440: earlier prepared event survives append / live          |  4862.0 | none               | [eviction-results.json](eviction-results.json)               |
| 1440: QA-259-R6-01 live card and keyboard Reconstruct / live |  4868.8 | none               | [eviction-results.json](eviction-results.json)               |
| 390: 35 explicit reconstructions and eviction / evicted      |   109.8 | none               | [eviction-results.json](eviction-results.json)               |
| 390: 35 explicit reconstructions and eviction / recent       |    89.7 | none               | [eviction-results.json](eviction-results.json)               |
| 390: requested patch diff and exact download / cost          |   718.3 | 620                | [eviction-results.json](eviction-results.json)               |
| 390: earlier prepared event survives append / live           |  5332.9 | none               | [eviction-results.json](eviction-results.json)               |
| 390: QA-259-R6-01 live card and keyboard Reconstruct / live  | 11813.3 | none               | [eviction-results.json](eviction-results.json)               |
| 1440: outside ownership / live                               |   539.7 | none               | [outside-control-results.json](outside-control-results.json) |
| 390: outside ownership / live                                |   587.2 | none               | [outside-control-results.json](outside-control-results.json) |
| 1440: controlled failed request                              |  1153.8 | 549, 438           | [invalid-replay-1440.json](invalid-replay-1440.json)         |
| 390: controlled failed request                               |  1298.3 | 863                | [invalid-replay-390.json](invalid-replay-390.json)           |

The wide fixture's nodes append short messages without changing vars; native fixture creation is real engine/store work and was allowed to reach its input wait before measurement. Fixture IDs, event/node sequence, patch summaries, history lengths and original API hashes are [fixtures.json](fixtures.json). Full expanded Variables is exercised only on demand. Exact comparisons retain size/hash/results; the four oversized download/API bodies and two oversized controlled response bodies follow D-034 in [NOT-KEPT.md](NOT-KEPT.md), [not-kept.json](not-kept.json). No capture above 1,000,000 bytes is kept this round. Narrow screenshots [evicted-card-390.png](evicted-card-390.png) and [invalid-replay-390.png](invalid-replay-390.png) were visually inspected: card content wraps within the window.

Gates, exact commands and results (Node 22 first):

| Command                                                                                                                                                                                                                                                | Result | Evidence                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------- |
| pnpm.cmd --filter @graphgoblin/api exec vitest run src/routes/run-event-paging.test.ts                                                                                                                                                                 | PASS   | [api-lookahead-alone.log.txt](api-lookahead-alone.log.txt) |
| pnpm.cmd build                                                                                                                                                                                                                                         | PASS   | [build.log.txt](build.log.txt)                             |
| pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/inspector/ThreadViewer.test.tsx src/runs/projections.test.ts src/runs/RunInspectorPage.test.tsx src/components/ui/bounded-value.test.tsx src/components/ui/bounded-value.deferred.test.tsx | PASS   | [web-units.log.txt](web-units.log.txt)                     |
| pnpm.cmd lint                                                                                                                                                                                                                                          | PASS   | [lint.log.txt](lint.log.txt)                               |
| pnpm.cmd typecheck                                                                                                                                                                                                                                     | PASS   | [typecheck.log.txt](typecheck.log.txt)                     |
| pnpm.cmd --filter @graphgoblin/web exec playwright test --config %TEMP%\gg-qa-e1-r8-playwright.config.mjs                                                                                                                                              | PASS   | [playwright.log.txt](playwright.log.txt)                   |
| pnpm.cmd check:layers                                                                                                                                                                                                                                  | PASS   | [layers.log.txt](layers.log.txt)                           |
| pnpm.cmd check:deps                                                                                                                                                                                                                                    | PASS   | [deps.log.txt](deps.log.txt)                               |
| pnpm.cmd check:tokens                                                                                                                                                                                                                                  | PASS   | [tokens.log.txt](tokens.log.txt)                           |
| pnpm.cmd format:check                                                                                                                                                                                                                                  | PASS   | [format.log.txt](format.log.txt)                           |

Affected units: **65/65 in five files**, including ThreadViewer's eviction/request/focus cases, projections cache retention, inspector page, BoundedValue identity and deferred preview. The previous-head regression tests were not executed in a scratch copy this round; existence/current success and the source diff are verified, and the independently reproduced eviction behavior is the product evidence. Maintained Edge: **6/6**, one worker, **retries 0**. Full package coverage was explicitly waived; no percentage or threshold/exclusion change is claimed. No node schema, route or dependency changed in the round-8 delta, so generated-doc and licence gates were not required/run. The prior round's broader paging/main validation was not repeated beyond the explicitly requested API file and scoped gates.

Not re-tested in this bounded round: the full rounds 1–7 adversarial/surface matrix, all Events pages, 6,000-message window/download, full-thread download property order, actual screen-reader speech, native restart/reload/session resume, live providers, concurrent readers beyond the isolated fault page, and all-package coverage. Earlier evidence was audited rather than claimed as new browser observations. No requested round-8 product case is left untested; the malformed large-history replay case is tested and failed.

## 4. Report path and evidence folder

Report: docs/qa/2026-10-22-wp-e1-259-qa/round-8/README.md. Evidence is in this same round-8 folder; every kept artifact is linked below. [validation.json](validation.json) / [validation.log.txt](validation.log.txt) audit links, paths, sizes, comparisons, expected failed rows and gate results. An integrity pass does not turn QA-259-R8-01 into a product pass.

Prior evidence audit: **854 references**, **0 unaccounted missing**, **52 manifest entries**. The 44 still-local round-4/5 oversized bodies match their manifests; eight round-6/7 bodies are absent as explicitly manifested. Nothing cited and expected to be retained is missing. Existing large untracked captures were left alone. No prior evidence hash changed ([prior-evidence-audit.json](prior-evidence-audit.json), [final-state.json](final-state.json)). Only round-8 evidence is new; production and staged diffs are empty.

- [NOT-KEPT.md](NOT-KEPT.md)
- [api-lookahead-alone.log.txt](api-lookahead-alone.log.txt)
- [browser-environment.json](browser-environment.json)
- [browser-environment.log.txt](browser-environment.log.txt)
- [browser-environment.mjs.txt](browser-environment.mjs.txt)
- [browser-errors.json](browser-errors.json)
- [browser-requests.json](browser-requests.json)
- [browser-support.mjs.txt](browser-support.mjs.txt)
- [build.log.txt](build.log.txt)
- [change.diff.txt](change.diff.txt)
- [continuation-errors.json](continuation-errors.json)
- [continuation-results.json](continuation-results.json)
- [continuation.log.txt](continuation.log.txt)
- [continuation.mjs.txt](continuation.mjs.txt)
- [deps.log.txt](deps.log.txt)
- [environment.json](environment.json)
- [evicted-card-1440.png](evicted-card-1440.png)
- [evicted-card-390.png](evicted-card-390.png)
- [evicted-selection-1440-frame-0.png](evicted-selection-1440-frame-0.png)
- [evicted-selection-1440-frame-1.png](evicted-selection-1440-frame-1.png)
- [evicted-selection-1440-frame-26.png](evicted-selection-1440-frame-26.png)
- [evicted-selection-1440.cpuprofile.json.txt](evicted-selection-1440.cpuprofile.json.txt)
- [evicted-selection-1440.json](evicted-selection-1440.json)
- [evicted-selection-1440.trace-evidence.json.txt](evicted-selection-1440.trace-evidence.json.txt)
- [evicted-selection-390-frame-0.png](evicted-selection-390-frame-0.png)
- [evicted-selection-390-frame-19.png](evicted-selection-390-frame-19.png)
- [evicted-selection-390-frame-20.png](evicted-selection-390-frame-20.png)
- [evicted-selection-390-frame-54.png](evicted-selection-390-frame-54.png)
- [evicted-selection-390.cpuprofile.json.txt](evicted-selection-390.cpuprofile.json.txt)
- [evicted-selection-390.json](evicted-selection-390.json)
- [evicted-selection-390.trace-evidence.json.txt](evicted-selection-390.trace-evidence.json.txt)
- [eviction-results.json](eviction-results.json)
- [eviction.log.txt](eviction.log.txt)
- [eviction.mjs.txt](eviction.mjs.txt)
- [explicit-events-1440.json](explicit-events-1440.json)
- [explicit-events-390.json](explicit-events-390.json)
- [final-state.json](final-state.json)
- [finish.log.txt](finish.log.txt)
- [finish.mjs.txt](finish.mjs.txt)
- [fixtures.json](fixtures.json)
- [focus-cached-1440.png](focus-cached-1440.png)
- [focus-cached-390.png](focus-cached-390.png)
- [focus-errors.json](focus-errors.json)
- [focus-helper-correction.json](focus-helper-correction.json)
- [focus-results.json](focus-results.json)
- [focus.log.txt](focus.log.txt)
- [focus.mjs.txt](focus.mjs.txt)
- [format-qa.log.txt](format-qa.log.txt)
- [format.log.txt](format.log.txt)
- [invalid-replay-1440.json](invalid-replay-1440.json)
- [invalid-replay-1440.png](invalid-replay-1440.png)
- [invalid-replay-390.json](invalid-replay-390.json)
- [invalid-replay-390.png](invalid-replay-390.png)
- [invalid-small-stream-1440.sse.txt](invalid-small-stream-1440.sse.txt)
- [invalid-small-stream-390.sse.txt](invalid-small-stream-390.sse.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [not-kept.json](not-kept.json)
- [outside-control-errors.json](outside-control-errors.json)
- [outside-control-results.json](outside-control-results.json)
- [outside-control.log.txt](outside-control.log.txt)
- [outside-control.mjs.txt](outside-control.mjs.txt)
- [outside-interruption.json](outside-interruption.json)
- [outside-results.json](outside-results.json)
- [outside.log.txt](outside.log.txt)
- [outside.mjs.txt](outside.mjs.txt)
- [patch-diff-1440.png](patch-diff-1440.png)
- [patch-diff-390.png](patch-diff-390.png)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [playwright.log.txt](playwright.log.txt)
- [prior-evidence-audit.json](prior-evidence-audit.json)
- [report.log.txt](report.log.txt)
- [run-command.mjs.txt](run-command.mjs.txt)
- [same-value-helper-correction.json](same-value-helper-correction.json)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown.json](shutdown.json)
- [support.mjs.txt](support.mjs.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate.mjs.txt](validate.mjs.txt)
- [validation.json](validation.json)
- [validation.log.txt](validation.log.txt)
- [web-units.log.txt](web-units.log.txt)

## 5. Observations outside scope

No additional out-of-scope product defect was recorded. The round-7 API setup gate is now resolved on this exact head by the requested isolated first-attempt pass. Requested replay, initial page loading and native construction retain their recorded large-data costs; the eviction fix specifically removes unrequested reconstruction on return. Disposable stores, temporary scripts/raw oversized captures and maintained-spec output remain for the orchestrator. No directory was deleted, both owned ports are closed, and no commit was made.
