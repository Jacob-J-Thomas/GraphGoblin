# Independent QA, round 6: #259 / PR #382

## 1. Verdict

**FAIL** at **689b885a3cdb30a5fbb9bea6b6fa694f053b0646**, detached HEAD. QA-259-R5-01 is fixed in the reproduced keyboard and other-value cases. The large-history request mode removes automatic replay/preview work from cold selection; below the threshold the selection note painted before the sampled replay and preview work, so QA-259-R5-02 is addressed for the measured cases. One new minor focus defect remains in the large-history request transition.

Independent QA only, run alone. No production or maintained-test changes, staging, commits, branch operations or GitHub writes. Only this round's QA records were added. [environment.json](environment.json) and [final-state.json](final-state.json) pin admission and final state. The built native API used ports 5720/5721 and disposable store gg-qa-e1-b5r3Tf; it has been stopped and both ports are closed ([shutdown.json](shutdown.json)). No owner instance/store was accessed. All run turns used the fake harness or mutate nodes; no live-provider claim is made.

## 2. Defects

**QA-259-R6-01 — minor — a large-history request transition drops keyboard focus to the body.** Reproduced at 1440 × 900 and 390 × 844, with both an expanded region and a collapsed value control.

1. Create the admitted 350,000-property Variables run (history about 6.43 million JSON characters), let it wait at ask, and open its inspector at the latest event.
2. Activate Reconstruct. Expand Variables and Shift+Tab into its named region, or focus Show all of Variables without expanding.
3. Deliver input from the public API so a live event becomes the selection. The thread view is replaced by the new event's request card.
4. Read document.activeElement: **BODY** at both widths. In the independent control reproduction, the transition was to Reconstruct the thread at event 24. Focus that button and press Enter: after the requested thread appears, focus is again **BODY**.

Expected: a disappearing focused thread/control hands the keyboard to a meaningful surviving target, such as the new request control; activating that request similarly leaves focus in the resulting view. Actual: the focused subtree/control is removed and no replacement takes focus. The page remains operable, but a keyboard reader loses their position. Source location: ThreadViewer.tsx lines 157–171 return a different card without a hand-off for either direction; the value-level hand-off cannot survive the component's removal. This is a new container transition, while the previously reported value-level hand-off is fixed.

Evidence: [large-live-focus-1440.json](large-live-focus-1440.json), [large-live-focus-390.json](large-live-focus-390.json) (expanded region), [large-focus-independent-1440.json](large-focus-independent-1440.json), [large-focus-independent-390.json](large-focus-independent-390.json) (control and keyboard request), [followup-results.json](followup-results.json), [followup.log.txt](followup.log.txt); exact public-interface reproductions in [performance.mjs.txt](performance.mjs.txt) and [followup.mjs.txt](followup.mjs.txt). The two failing follow-up rows are this single defect. Ordinary intentional Tab traversal through the end of the document also records BODY in the focus trace; those entries are distinct from the unprompted replacement failure above.

QA-259-01 remains fixed: the original 2,322,721-character value returns at 4,097 displayed characters including the ellipsis. QA-259-R4-01 remains fixed for the under-threshold messages run. QA-259-02 remains disposed: reconstructed full-thread downloads preserve values but may order properties differently from the live API. No value difference was found.

## 3. Coverage of criteria

Environment: Node v22.14.0 first on PATH; installed Edge 155.0.4283.62, headless; built app at 1440 × 900 and 390 × 844. Two supplementary 390 × 3000 captures expose the stacked inspector and timeline together. [browser-environment.json](browser-environment.json), [source-map-provenance.json](source-map-provenance.json), [change.diff.txt](change.diff.txt).

Touched systems and positive/negative coverage:

| System                                                | Steps and expected behavior                                                                                                                                                                                                                                       | Actual / coverage                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BoundedValue focus, preview and expansion             | Expand A; Shift+Tab in; live B hands off; Tab through the page to timeline A and B and select with Enter. Repeat with focus in another value; replace by small data and Tab on.                                                                                   | PASS at both widths; focus remains at the intended timeline/message target; held text has tabindex -1 only until Tab. Original nested A/B/A also PASS.                                                                             |
| ThreadViewer large-history mode, cache and diff       | Select queued then unseen seed; expect request card, no thread DOM/work. Request it, return through queued to seed, then append while following the latest.                                                                                                       | PASS for request gating, exact preview, prepared return, and fresh live card. FAIL for keyboard position at card transitions (QA-259-R6-01). Replay/preview cost is incurred on request.                                           |
| Deferred reconstruction and identifiers               | Under-threshold 90,000-property and million-character-string runs: select queued then uncached node.finished. During pending render trigger the visible Variables and Full thread JSON downloads; inject a replay-invalid external patch.                         | PASS: note/selection paint before measured work; shown title/names/content identify event 8 while note identifies selected 14; failed-replay alert identifies 14, and valid earlier selection recovers.                            |
| Event store size, persistence and hydration           | Compare summed JSON event lengths; large log omitted, ordinary log retained. Reload both; inject an older version-0 stored ordinary log, then clear storage.                                                                                                      | PASS: large after=0, ordinary after=8; version-0/clear after=0, hydrated version 1 counts exact event characters; reconstructed values remain correct. Exact threshold and duplicate-count cases also covered by maintained tests. |
| Messages window and focus                             | Valid 6,000-message API fixture; show latest 50, Show all, download, focus/expand old m0, append externally, then Tab.                                                                                                                                            | PASS: 50 → 6,000 → 50; exact message bytes, focus to Show all messages, Tab to Download messages, no list tabindex left.                                                                                                           |
| Controls, stored data and adjacent inspector surfaces | Type in input with reconstructed wide Variables shown; Pause/Resume; navigate timeline; exact downloads; compare stored API thread/events before/after the controlled failure view. Run adjacent result/progress/wait/Events unit files and maintained Edge spec. | PASS functionality and stored hash comparisons; measured costs below. Full JSON formatting occurs when explicitly opened. No engine context/value truncation observed.                                                             |
| Docs and operator behavior                            | Read changed docs/09, CHANGELOG and implementation diff against behavior.                                                                                                                                                                                         | Request threshold, large-log reload semantics and reconstruction/property-order distinction match the exercised behavior. No schema/route/dependency change in this delta.                                                         |

Each case below was executed once after fixture/configuration admission; errors from setup are disclosed separately. Scripts contain the exact API operations and DOM/keyboard steps. The expected column states the assertion scope: the main live-card rows pass gating while their recorded focus failure is independently failed below.

| System / case                                                   | Steps / expected                                                                                                       | Actual                                                                                                                                                             | Result | Evidence                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------ |
| 1440: stale hand-off exact keyboard steps                       | Live B hand-off once; keyboard selections A and cached B remain on the timeline                                        | A: #6node.finishedseed → out, 2 changes, 1 ms; B: #16run.waitingnotouch waits for input; other region retained; preview 4097 chars                                 | PASS   | [focus-results.json](focus-results.json)                           |
| 1440: large-to-small value hand-off                             | Text holds focus at tabindex -1; Tab moves on and removes tabindex                                                     | PRE -1; Tab -> Full thread JSON; tabindex null                                                                                                                     | PASS   | [focus-results.json](focus-results.json)                           |
| 390: stale hand-off exact keyboard steps                        | Live B hand-off once; keyboard selections A and cached B remain on the timeline                                        | A: #6node.finishedseed → out, 2 changes, 5 ms; B: #16run.waitingnotouch waits for input; other region retained; preview 4097 chars                                 | PASS   | [focus-results.json](focus-results.json)                           |
| 390: large-to-small value hand-off                              | Text holds focus at tabindex -1; Tab moves on and removes tabindex                                                     | PRE -1; Tab -> Full thread JSON; tabindex null                                                                                                                     | PASS   | [focus-results.json](focus-results.json)                           |
| 1440: large cold card                                           | Cold selection shows the request card and no automatic reconstruction                                                  | 45.9 ms; tasks none; card event 6; no Variables DOM                                                                                                                | PASS   | [performance-results.json](performance-results.json)               |
| 1440: requested reconstruction                                  | Replay and preview run only after Reconstruct; exact prefix and Variables download                                     | 884.3 ms; tasks 820; exact 4,096-character prefix plus ellipsis; 7827782 download bytes match                                                                      | PASS   | [performance-results.json](performance-results.json)               |
| 1440: prepared return                                           | Returning to a requested event shows its bounded thread with no request                                                | 64.2 ms; tasks none; no request card                                                                                                                               | PASS   | [performance-results.json](performance-results.json)               |
| 1440: live selection asks again                                 | A new live selected event returns the card; retained reconstructed value is unchanged                                  | New request card; focus BODY; tasks none (focus recorded as QA-259-R6-01)                                                                                          | PASS   | [performance-results.json](performance-results.json)               |
| 1440: reload and other-run resume                               | Large log omitted from session storage and replays from zero; ordinary log resumes its cursor                          | Large after=0; ordinary after=8; large absent from stored logs; ordinary retained                                                                                  | PASS   | [performance-results.json](performance-results.json)               |
| 1440: below threshold medium                                    | Selection paints its note before deferred replay; bounded exact preview, no request card                               | 1510208 history characters; 245.2 ms; tasks 116; exact bounded prefix                                                                                              | PASS   | [performance-results.json](performance-results.json)               |
| 1440: below threshold string                                    | Selection paints its note before deferred replay; bounded exact preview, no request card                               | 1002437 history characters; 68.8 ms; tasks none; exact bounded prefix                                                                                              | PASS   | [performance-results.json](performance-results.json)               |
| 1440: messages window download and live focus                   | 50 latest; Show all 6000; exact download; live hides focused old message with hand-off                                 | 50 -> 6,000 -> 50; 901749 bytes match; Message m0 content -> Show all messages; Tab -> Download messages as JSON                                                   | PASS   | [performance-results.json](performance-results.json)               |
| 390: large cold card                                            | Cold selection shows the request card and no automatic reconstruction                                                  | 29.8 ms; tasks none; card event 6; no Variables DOM                                                                                                                | PASS   | [performance-results.json](performance-results.json)               |
| 390: requested reconstruction                                   | Replay and preview run only after Reconstruct; exact prefix and Variables download                                     | 876.4 ms; tasks 822; exact 4,096-character prefix plus ellipsis; 7827782 download bytes match                                                                      | PASS   | [performance-results.json](performance-results.json)               |
| 390: prepared return                                            | Returning to a requested event shows its bounded thread with no request                                                | 71.4 ms; tasks none; no request card                                                                                                                               | PASS   | [performance-results.json](performance-results.json)               |
| 390: live selection asks again                                  | A new live selected event returns the card; retained reconstructed value is unchanged                                  | New request card; focus BODY; tasks 98, 79, 74, 78, 85, 84, 71 (focus recorded as QA-259-R6-01)                                                                    | PASS   | [performance-results.json](performance-results.json)               |
| 390: reload and other-run resume                                | Large log omitted from session storage and replays from zero; ordinary log resumes its cursor                          | Large after=0; ordinary after=8; large absent from stored logs; ordinary retained                                                                                  | PASS   | [performance-results.json](performance-results.json)               |
| 390: below threshold medium                                     | Selection paints its note before deferred replay; bounded exact preview, no request card                               | 1510206 history characters; 168.9 ms; tasks 91; exact bounded prefix                                                                                               | PASS   | [performance-results.json](performance-results.json)               |
| 390: below threshold string                                     | Selection paints its note before deferred replay; bounded exact preview, no request card                               | 1002435 history characters; 58.5 ms; tasks none; exact bounded prefix                                                                                              | PASS   | [performance-results.json](performance-results.json)               |
| 390: messages window download and live focus                    | 50 latest; Show all 6000; exact download; live hides focused old message with hand-off                                 | 50 -> 6,000 -> 50; 901749 bytes match; Message m0 content -> Show all messages; Tab -> Download messages as JSON                                                   | PASS   | [performance-results.json](performance-results.json)               |
| 1440: pending download identifiers                              | Shown title and both download filenames/content name A; note names selected uncached B                                 | Title Thread at event 8; note Reconstructing the thread at event 14…; both names at-8; Variables bytes equal; thread values equal                                  | PASS   | [identifier-results.json](identifier-results.json)                 |
| 1440: controlled failed replay identifiers                      | Failure alert names B and timeline can still select valid A; stored history unchanged                                  | The thread cannot be reconstructed at event 14operation 0 (remove /vars/absent-qa): path "/vars/absent-qa" does not exist; valid A recovered; API hashes unchanged | PASS   | [identifier-results.json](identifier-results.json)                 |
| 390: pending download identifiers                               | Shown title and both download filenames/content name A; note names selected uncached B                                 | Title Thread at event 8; note Reconstructing the thread at event 14…; both names at-8; Variables bytes equal; thread values equal                                  | PASS   | [identifier-results.json](identifier-results.json)                 |
| 390: controlled failed replay identifiers                       | Failure alert names B and timeline can still select valid A; stored history unchanged                                  | The thread cannot be reconstructed at event 14operation 0 (remove /vars/absent-qa): path "/vars/absent-qa" does not exist; valid A recovered; API hashes unchanged | PASS   | [identifier-results.json](identifier-results.json)                 |
| 1440: large-history focus loss independent control reproduction | Live replacement should keep keyboard at the new request control; requesting it should hand off into the shown content | live selected request card leaves keyboard on BODY                                                                                                                 | FAIL   | [followup-results.json](followup-results.json)                     |
| 1440: large-history controls                                    | Pause, Resume, timeline and input typing respond with reconstructed Variables on screen                                | Typing 31.5 ms, Pause 1408.1 ms, Resume 2418.0 ms; no long tasks                                                                                                   | PASS   | [followup-results.json](followup-results.json)                     |
| 1440: large reload new-origin measurement                       | Reload from first event remains usable; record all tasks in the new document                                           | 3525.4 ms; tasks 155, 546, 157; after=0; usable true                                                                                                               | PASS   | [followup-results.json](followup-results.json)                     |
| 1440: ordinary storage version migration and clear              | Version-0 cursor is dropped and replays from zero; v1 resumes; clear replays cleanly                                   | v0 after=0; v1 after=8; clear after=0; version 1; 18456 counted chars                                                                                              | PASS   | [followup-results.json](followup-results.json)                     |
| 1440: original nested A/B/A                                     | Original 2,322,721-character Variables starts bounded on prepared A/B/A returns                                        | 2322721 -> 4097 chars on return; 65.6 ms; no long task                                                                                                             | PASS   | [followup-results.json](followup-results.json)                     |
| 390: large-history focus loss independent control reproduction  | Live replacement should keep keyboard at the new request control; requesting it should hand off into the shown content | live selected request card leaves keyboard on BODY                                                                                                                 | FAIL   | [followup-results.json](followup-results.json)                     |
| 390: large-history controls                                     | Pause, Resume, timeline and input typing respond with reconstructed Variables on screen                                | Typing 23.5 ms, Pause 2430.3 ms, Resume 3475.3 ms; no long tasks                                                                                                   | PASS   | [followup-results.json](followup-results.json)                     |
| 390: large reload new-origin measurement                        | Reload from first event remains usable; record all tasks in the new document                                           | 3966.9 ms; tasks 185, 559, 160; after=0; usable true                                                                                                               | PASS   | [followup-results.json](followup-results.json)                     |
| 390: ordinary storage version migration and clear               | Version-0 cursor is dropped and replays from zero; v1 resumes; clear replays cleanly                                   | v0 after=0; v1 after=8; clear after=0; version 1; 18454 counted chars                                                                                              | PASS   | [followup-results.json](followup-results.json)                     |
| 390: original nested A/B/A                                      | Original 2,322,721-character Variables starts bounded on prepared A/B/A returns                                        | 2322721 -> 4097 chars on return; 65.4 ms; no long task                                                                                                             | PASS   | [followup-results.json](followup-results.json)                     |
| Supplementary visible 390-px card                               | Cold queued → seed at height 3000; request card visible with no replay/preview                                         | 60.1 ms; no long task; inspected compositor frame shows selected event 6 and request card                                                                          | PASS   | [visible-paint-results.json](visible-paint-results.json)           |
| Supplementary visible 390-px deferred view                      | Cold queued → seed at height 3000; show previous event and pending note before preview                                 | 172.2 ms; task 85; inspected frame shows selection 6, shown event 1 and note before first serializer sample                                                        | PASS   | [visible-medium-390-frame-22.png](visible-medium-390-frame-22.png) |

Measurement method and limits: read-only PerformanceObserver records standard ≥50 ms long tasks; durations below are milliseconds, action-to-two-animation-frames after the expected state. Cold denotes an unseen selected sequence after its log has loaded; initial history transfer/validation is measured separately by the reload follow-up. Wall times include Playwright/CDP scheduling and, for live/API controls, server/network work; they are not INP. CPU sampling interval is 1 ms, mapped through the built sourcemap; a first sample is an observed bound, not exact function-entry time. Profiles identify serializer work in utils.ts lines 41–147 and domain replay/patch frames. Paint events are distinct from DOM commits and delivered compositor frames; the retained frames were inspected. No app function/store was patched. Gates and fixture creation had finished before the main timings; unrelated host activity is uncontrolled, and no cross-round speedup ratio is claimed.

The ordinary below-threshold object has **1,510,208 / 1,510,206** history characters; the string run has **1,002,437 / 1,002,435**. The wide run has **6,430,205 / 6,430,203**. Thus both paths are exercised through admitted API values rather than an invented size flag. [fixtures.json](fixtures.json).

| Operation / width                                                | Wall ms | Every observed long task (ms)                           | Evidence                                             |
| ---------------------------------------------------------------- | ------: | ------------------------------------------------------- | ---------------------------------------------------- |
| 1440: large cold card: timing                                    |    45.9 | none                                                    | [performance-results.json](performance-results.json) |
| 1440: requested reconstruction: timing                           |   884.3 | 820                                                     | [performance-results.json](performance-results.json) |
| 1440: requested reconstruction: controls                         |   165.5 | 101                                                     | [performance-results.json](performance-results.json) |
| 1440: prepared return: timing                                    |    64.2 | none                                                    | [performance-results.json](performance-results.json) |
| 1440: live selection asks again: timing                          | 12725.8 | none                                                    | [performance-results.json](performance-results.json) |
| 1440: reload and other-run resume: timing                        |  7259.8 | not valid across navigation; see corrected reload below | [performance-results.json](performance-results.json) |
| 1440: below threshold medium: timing                             |   245.2 | 116                                                     | [performance-results.json](performance-results.json) |
| 1440: below threshold string: timing                             |    68.8 | none                                                    | [performance-results.json](performance-results.json) |
| 1440: messages window download and live focus: showAll           |  1523.6 | 1325, 65                                                | [performance-results.json](performance-results.json) |
| 1440: messages window download and live focus: live              |  1060.5 | 210, 122, 208, 99                                       | [performance-results.json](performance-results.json) |
| 390: large cold card: timing                                     |    29.8 | none                                                    | [performance-results.json](performance-results.json) |
| 390: requested reconstruction: timing                            |   876.4 | 822                                                     | [performance-results.json](performance-results.json) |
| 390: requested reconstruction: controls                          |   151.2 | 96                                                      | [performance-results.json](performance-results.json) |
| 390: prepared return: timing                                     |    71.4 | none                                                    | [performance-results.json](performance-results.json) |
| 390: live selection asks again: timing                           | 10000.5 | 98, 79, 74, 78, 85, 84, 71                              | [performance-results.json](performance-results.json) |
| 390: reload and other-run resume: timing                         |  5642.6 | not valid across navigation; see corrected reload below | [performance-results.json](performance-results.json) |
| 390: below threshold medium: timing                              |   168.9 | 91                                                      | [performance-results.json](performance-results.json) |
| 390: below threshold string: timing                              |    58.5 | none                                                    | [performance-results.json](performance-results.json) |
| 390: messages window download and live focus: showAll            |  1282.3 | 1207                                                    | [performance-results.json](performance-results.json) |
| 390: messages window download and live focus: live               |  1212.4 | 163, 78, 118, 122, 99                                   | [performance-results.json](performance-results.json) |
| 1440: large-history controls: typing                             |    31.5 | none                                                    | [followup-results.json](followup-results.json)       |
| 1440: large-history controls: pause                              |  1408.1 | none                                                    | [followup-results.json](followup-results.json)       |
| 1440: large-history controls: resume                             |  2418.0 | none                                                    | [followup-results.json](followup-results.json)       |
| 1440: large reload new-origin measurement: timing                |  3525.4 | 155, 546, 157                                           | [followup-results.json](followup-results.json)       |
| 1440: ordinary storage version migration and clear: legacyTiming |   243.7 | none                                                    | [followup-results.json](followup-results.json)       |
| 1440: original nested A/B/A: timing                              |    65.6 | none                                                    | [followup-results.json](followup-results.json)       |
| 390: large-history controls: typing                              |    23.5 | none                                                    | [followup-results.json](followup-results.json)       |
| 390: large-history controls: pause                               |  2430.3 | none                                                    | [followup-results.json](followup-results.json)       |
| 390: large-history controls: resume                              |  3475.3 | none                                                    | [followup-results.json](followup-results.json)       |
| 390: large reload new-origin measurement: timing                 |  3966.9 | 185, 559, 160                                           | [followup-results.json](followup-results.json)       |
| 390: ordinary storage version migration and clear: legacyTiming  |   234.8 | none                                                    | [followup-results.json](followup-results.json)       |
| 390: original nested A/B/A: timing                               |    65.4 | none                                                    | [followup-results.json](followup-results.json)       |

The first pair of reload rows in the main script used performance.now from two different document origins: their wall times and cursor/storage assertions are valid, but their empty long-task lists are **not evidence of task-free reloads**. The explicit new-origin follow-up replaces those task readings: desktop 155, 546, 157 ms; narrow 185, 559, 160 ms. Both reloads remain usable. This measurement correction is retained rather than silently replacing the original capture. Full-thread JSON opening (101 / 96 ms) and showing all 6,000 messages (1,325 / 1,207 ms maximum task) are explicit requested work; collapsing thousands of mounted messages on live replacement also has the recorded costs. No promise of a frame-time bound for these requested/expanded states is inferred.

| Trace / case         | Pending/card DOM at | First Paint after it | First sampled replay | First sampled serializer | Sampled replay / serializer ms | Evidence                                               |
| -------------------- | ------------------: | -------------------: | -------------------: | -----------------------: | -----------------------------: | ------------------------------------------------------ |
| large-cold-card-1440 |              8921.1 |               8925.2 |         none sampled |             none sampled |                      0.0 / 0.0 | [large-cold-card-1440.json](large-cold-card-1440.json) |
| large-cold-card-390  |              6151.0 |               6152.1 |         none sampled |             none sampled |                      0.0 / 0.0 | [large-cold-card-390.json](large-cold-card-390.json)   |
| large-request-1440   |                 n/a |                  n/a |              10476.3 |                  11032.8 |                  529.9 / 250.9 | [large-request-1440.json](large-request-1440.json)     |
| large-request-390    |                 n/a |                  n/a |               6995.8 |                   7580.5 |                  506.0 / 225.8 | [large-request-390.json](large-request-390.json)       |
| below-medium-1440    |              2612.2 |               2616.1 |               2619.0 |                   2741.6 |                   111.6 / 44.6 | [below-medium-1440.json](below-medium-1440.json)       |
| below-medium-390     |              2924.4 |               2929.2 |               2930.9 |                   3023.7 |                    90.8 / 23.8 | [below-medium-390.json](below-medium-390.json)         |
| below-string-1440    |               932.6 |                934.2 |         none sampled |             none sampled |                      0.0 / 0.0 | [below-string-1440.json](below-string-1440.json)       |
| below-string-390     |              1158.2 |               1161.1 |         none sampled |             none sampled |                      0.0 / 0.0 | [below-string-390.json](below-string-390.json)         |
| visible-medium-390   |              1442.3 |               1443.9 |               1445.0 |                   1533.6 |                    80.4 / 27.1 | [visible-medium-390.json](visible-medium-390.json)     |
| visible-wide-390     |              5130.3 |               5131.7 |         none sampled |             none sampled |                      0.0 / 0.0 | [visible-wide-390.json](visible-wide-390.json)         |

At normal desktop size the below-threshold note is visible in [below-medium-1440-frame-24.png](below-medium-1440-frame-24.png); at narrow size the supplementary [visible-medium-390-frame-22.png](visible-medium-390-frame-22.png) shows the stacked note before the first sampled preview enumeration. In the ordinary 390 × 844 viewport the note is below the fold; its DOM/paint evidence is retained, and [below-medium-390-frame-46.png](below-medium-390-frame-46.png) shows the updated timeline before the first serializer sample. A Paint event occurred between the note commit and first sampled replay work in each measured object case; the compositor frame interval does not locate the exact start of replay. The large-history card's cold selections have **zero sampled replay/serializer frames and no long task**; requested reconstruction has **820 / 822 ms** tasks, including roughly **529.9 / 506.0 ms** sampled replay work and **250.9 / 225.8 ms** sampled serializer work.

Downloads: both wide Variables files were compared byte for byte with API vars using identical two-space JSON formatting: **7,827,782 bytes**, SHA-256 **b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3**. Both 6,000-message downloads were compared byte for byte with the API messages array; their byte counts/hashes and retained bodies are in [performance-results.json](performance-results.json). The pending event-8 Variables downloads also match API bytes; full-thread downloads match API values with the known property-order difference ([identifier-results.json](identifier-results.json)). No stored-value difference was found. The four >1,000,000-byte wide bodies are recorded in [NOT-KEPT.md](NOT-KEPT.md) / [not-kept.json](not-kept.json); every retained capture is below the requested size limit.

Gates (Node 22; exact commands are also in each log):

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result | Evidence                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| pnpm.cmd build                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PASS   | [build.log.txt](build.log.txt)                 |
| pnpm.cmd --filter @graphgoblin/web exec vitest run src/components/ui/bounded-value.test.tsx src/components/ui/bounded-value.deferred.test.tsx src/lib/pretty-json-prefix.test.ts src/lib/utils.test.ts src/runs/inspector/ThreadViewer.test.tsx src/runs/RunInspectorPage.test.tsx src/runs/inspector/ProgressDrawer.test.tsx src/runs/inspector/WaitPanel.test.tsx src/runs/projections.test.ts src/runs/event-store.test.ts src/runs/useRunEvents.test.tsx src/events/EventsPage.test.tsx | PASS   | [focused-tests.log.txt](focused-tests.log.txt) |
| pnpm.cmd lint                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | PASS   | [lint.log.txt](lint.log.txt)                   |
| pnpm.cmd typecheck                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PASS   | [typecheck.log.txt](typecheck.log.txt)         |
| pnpm.cmd --filter @graphgoblin/web exec playwright test --config %TEMP%\gg-qa-e1-r6-playwright.config.mjs                                                                                                                                                                                                                                                                                                                                                                                   | PASS   | [playwright.log.txt](playwright.log.txt)       |
| pnpm.cmd check:layers                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PASS   | [layers.log.txt](layers.log.txt)               |
| pnpm.cmd check:deps                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PASS   | [deps.log.txt](deps.log.txt)                   |
| pnpm.cmd check:tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PASS   | [tokens.log.txt](tokens.log.txt)               |
| pnpm.cmd format:check                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PASS   | [format.log.txt](format.log.txt)               |

Affected unit tests: **97/97 in 11 files** pass, including the new deferred focus and identifier tests, large-history component tests, projection/cache/store-size/migration cases and adjacent inspector/Events tests. The command includes an event-store.test.ts filter that matches no file; the event-store tests live in projections.test.ts and ran there. Maintained Edge spec: **6/6**, workers 1, retries 0. Build emitted a nonfatal Turbo cache-write permission warning; compilation succeeded. Full web/package coverage was explicitly waived for this round and was not run; no coverage percentage is claimed. check:docs and check:licenses were not run because this delta changes neither a schema/route nor dependencies. Regression failure on an older head was not executed this round; prior negative evidence and the current diff establish the old-hand-off path, and the independently reproduced new defect has no production change here.

Setup corrections, preserved: the first message fixture used createdAt instead of the contract's ts ([fixtures-initial.mjs.txt](fixtures-initial.mjs.txt), [fixtures-initial.log.txt](fixtures-initial.log.txt)); after correction the event-page helper was corrected from events to the documented items envelope ([fixtures-envelope.log.txt](fixtures-envelope.log.txt), [support.mjs.txt](support.mjs.txt)). The initial Edge invocation found no tests because its config resolved the filtered package's working directory; setting QA_WORKTREE_ROOT plus the two disposable endpoint variables corrected the configuration ([playwright-config-initial.log.txt](playwright-config-initial.log.txt), [playwright.config.mjs.txt](playwright.config.mjs.txt)). These runs executed no failing product assertion. Their errors were not dropped or relabelled as passing tests. The final functional fixture/admission log is [fixtures.log.txt](fixtures.log.txt).

The initial integrity check found its own pending validation.json output missing after a PowerShell quoting error in the placeholder command. That check's JSON and log are retained as validation-initial.json.txt and validation-initial.log.txt. The final integrity run checks the complete output set; no product assertion was rerun for this correction.

Not tested in this bounded round: full package coverage, the full rounds 1–5 surface/adversarial matrix, native restart on the same store, real screen-reader speech, live providers, extremely long histories by event count, cache eviction after more than 32 requested events, simultaneous multi-tab updates, and hardware-independent latency guarantees. Keyboard DOM semantics were exercised; no speech-output claim is made. API bad-patch replay testing uses an explicitly intercepted external SSE response and proves the built UI failure path, not a claim that the current engine emitted bad data.

## 4. Report path and evidence folder

This README is at docs/qa/2026-10-22-wp-e1-259-qa/round-6/README.md. The evidence folder is this same round-6 directory. All kept artifacts are linked below; scripts end in .mjs.txt and logs in .log.txt. Large-body comparisons retain their sizes/hashes in NOT-KEPT.md. The integrity result is [validation.json](validation.json) / [validation.log.txt](validation.log.txt).

The prior evidence audit found **599 references**, **0 unaccounted missing references**, and **44 NOT-KEPT entries** whose still-local bytes all match their recorded size and SHA-256. The 0 large previous captures are present locally as untracked files, consistently listed in those manifests; the committed reports and kept evidence are present. No previous evidence hash changed ([prior-evidence-audit.json](prior-evidence-audit.json), [final-state.json](final-state.json)).

- [NOT-KEPT.md](NOT-KEPT.md)
- [api-key-metadata.json](api-key-metadata.json)
- [below-medium-1440-frame-0.png](below-medium-1440-frame-0.png)
- [below-medium-1440-frame-23.png](below-medium-1440-frame-23.png)
- [below-medium-1440-frame-24.png](below-medium-1440-frame-24.png)
- [below-medium-1440-frame-29.png](below-medium-1440-frame-29.png)
- [below-medium-1440-frame-30.png](below-medium-1440-frame-30.png)
- [below-medium-1440-frame-56.png](below-medium-1440-frame-56.png)
- [below-medium-1440.cpuprofile.json.txt](below-medium-1440.cpuprofile.json.txt)
- [below-medium-1440.json](below-medium-1440.json)
- [below-medium-1440.trace-evidence.json.txt](below-medium-1440.trace-evidence.json.txt)
- [below-medium-390-frame-0.png](below-medium-390-frame-0.png)
- [below-medium-390-frame-37.png](below-medium-390-frame-37.png)
- [below-medium-390-frame-38.png](below-medium-390-frame-38.png)
- [below-medium-390-frame-46.png](below-medium-390-frame-46.png)
- [below-medium-390-frame-47.png](below-medium-390-frame-47.png)
- [below-medium-390-frame-78.png](below-medium-390-frame-78.png)
- [below-medium-390.cpuprofile.json.txt](below-medium-390.cpuprofile.json.txt)
- [below-medium-390.json](below-medium-390.json)
- [below-medium-390.trace-evidence.json.txt](below-medium-390.trace-evidence.json.txt)
- [below-string-1440-frame-0.png](below-string-1440-frame-0.png)
- [below-string-1440-frame-21.png](below-string-1440-frame-21.png)
- [below-string-1440-frame-22.png](below-string-1440-frame-22.png)
- [below-string-1440-frame-39.png](below-string-1440-frame-39.png)
- [below-string-1440.cpuprofile.json.txt](below-string-1440.cpuprofile.json.txt)
- [below-string-1440.json](below-string-1440.json)
- [below-string-1440.trace-evidence.json.txt](below-string-1440.trace-evidence.json.txt)
- [below-string-390-frame-0.png](below-string-390-frame-0.png)
- [below-string-390-frame-33.png](below-string-390-frame-33.png)
- [below-string-390-frame-34.png](below-string-390-frame-34.png)
- [below-string-390-frame-61.png](below-string-390-frame-61.png)
- [below-string-390.cpuprofile.json.txt](below-string-390.cpuprofile.json.txt)
- [below-string-390.json](below-string-390.json)
- [below-string-390.trace-evidence.json.txt](below-string-390.trace-evidence.json.txt)
- [browser-environment.json](browser-environment.json)
- [browser-support.mjs.txt](browser-support.mjs.txt)
- [build.log.txt](build.log.txt)
- [change.diff.txt](change.diff.txt)
- [deps.log.txt](deps.log.txt)
- [environment.json](environment.json)
- [failure-alert-1440.png](failure-alert-1440.png)
- [failure-alert-390.png](failure-alert-390.png)
- [failure-injection-1440.json](failure-injection-1440.json)
- [failure-injection-390.json](failure-injection-390.json)
- [final-state.json](final-state.json)
- [finish.mjs.txt](finish.mjs.txt)
- [fixtures-envelope.log.txt](fixtures-envelope.log.txt)
- [fixtures-initial.log.txt](fixtures-initial.log.txt)
- [fixtures-initial.mjs.txt](fixtures-initial.mjs.txt)
- [fixtures.json](fixtures.json)
- [fixtures.log.txt](fixtures.log.txt)
- [fixtures.mjs.txt](fixtures.mjs.txt)
- [focus-cached-1440.png](focus-cached-1440.png)
- [focus-cached-390.png](focus-cached-390.png)
- [focus-errors.json](focus-errors.json)
- [focus-results.json](focus-results.json)
- [focus.log.txt](focus.log.txt)
- [focus.mjs.txt](focus.mjs.txt)
- [focused-tests.log.txt](focused-tests.log.txt)
- [followup-errors.json](followup-errors.json)
- [followup-results.json](followup-results.json)
- [followup.log.txt](followup.log.txt)
- [followup.mjs.txt](followup.mjs.txt)
- [format-qa.log.txt](format-qa.log.txt)
- [format.log.txt](format.log.txt)
- [identifier-errors.json](identifier-errors.json)
- [identifier-results.json](identifier-results.json)
- [identifiers.log.txt](identifiers.log.txt)
- [identifiers.mjs.txt](identifiers.mjs.txt)
- [large-card-1440.png](large-card-1440.png)
- [large-card-390.png](large-card-390.png)
- [large-cold-card-1440-frame-0.png](large-cold-card-1440-frame-0.png)
- [large-cold-card-1440-frame-19.png](large-cold-card-1440-frame-19.png)
- [large-cold-card-1440-frame-20.png](large-cold-card-1440-frame-20.png)
- [large-cold-card-1440-frame-38.png](large-cold-card-1440-frame-38.png)
- [large-cold-card-1440.cpuprofile.json.txt](large-cold-card-1440.cpuprofile.json.txt)
- [large-cold-card-1440.json](large-cold-card-1440.json)
- [large-cold-card-1440.trace-evidence.json.txt](large-cold-card-1440.trace-evidence.json.txt)
- [large-cold-card-390-frame-0.png](large-cold-card-390-frame-0.png)
- [large-cold-card-390-frame-20.png](large-cold-card-390-frame-20.png)
- [large-cold-card-390-frame-21.png](large-cold-card-390-frame-21.png)
- [large-cold-card-390-frame-60.png](large-cold-card-390-frame-60.png)
- [large-cold-card-390.cpuprofile.json.txt](large-cold-card-390.cpuprofile.json.txt)
- [large-cold-card-390.json](large-cold-card-390.json)
- [large-cold-card-390.trace-evidence.json.txt](large-cold-card-390.trace-evidence.json.txt)
- [large-focus-independent-1440.json](large-focus-independent-1440.json)
- [large-focus-independent-390.json](large-focus-independent-390.json)
- [large-live-focus-1440.json](large-live-focus-1440.json)
- [large-live-focus-390.json](large-live-focus-390.json)
- [large-request-1440-frame-0.png](large-request-1440-frame-0.png)
- [large-request-1440-frame-37.png](large-request-1440-frame-37.png)
- [large-request-1440-frame-38.png](large-request-1440-frame-38.png)
- [large-request-1440-frame-73.png](large-request-1440-frame-73.png)
- [large-request-1440.cpuprofile.json.txt](large-request-1440.cpuprofile.json.txt)
- [large-request-1440.json](large-request-1440.json)
- [large-request-1440.trace-evidence.json.txt](large-request-1440.trace-evidence.json.txt)
- [large-request-390-frame-0.png](large-request-390-frame-0.png)
- [large-request-390-frame-112.png](large-request-390-frame-112.png)
- [large-request-390-frame-62.png](large-request-390-frame-62.png)
- [large-request-390-frame-63.png](large-request-390-frame-63.png)
- [large-request-390.cpuprofile.json.txt](large-request-390.cpuprofile.json.txt)
- [large-request-390.json](large-request-390.json)
- [large-request-390.trace-evidence.json.txt](large-request-390.trace-evidence.json.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [make-report.log.txt](make-report.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [messages-api-1440.json.txt](messages-api-1440.json.txt)
- [messages-api-390.json.txt](messages-api-390.json.txt)
- [messages-download-1440.json.txt](messages-download-1440.json.txt)
- [messages-download-390.json.txt](messages-download-390.json.txt)
- [not-kept.json](not-kept.json)
- [paint-visible.mjs.txt](paint-visible.mjs.txt)
- [pending-thread-api-1440.json.txt](pending-thread-api-1440.json.txt)
- [pending-thread-api-390.json.txt](pending-thread-api-390.json.txt)
- [pending-thread-download-1440.json.txt](pending-thread-download-1440.json.txt)
- [pending-thread-download-390.json.txt](pending-thread-download-390.json.txt)
- [pending-variables-api-1440.json.txt](pending-variables-api-1440.json.txt)
- [pending-variables-api-390.json.txt](pending-variables-api-390.json.txt)
- [pending-variables-download-1440.json.txt](pending-variables-download-1440.json.txt)
- [pending-variables-download-390.json.txt](pending-variables-download-390.json.txt)
- [performance-errors.json](performance-errors.json)
- [performance-results.json](performance-results.json)
- [performance.log.txt](performance.log.txt)
- [performance.mjs.txt](performance.mjs.txt)
- [playwright-config-initial.log.txt](playwright-config-initial.log.txt)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [playwright.log.txt](playwright.log.txt)
- [prior-evidence-audit.json](prior-evidence-audit.json)
- [run-command.mjs.txt](run-command.mjs.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown.json](shutdown.json)
- [shutdown.log.txt](shutdown.log.txt)
- [source-map-provenance.json](source-map-provenance.json)
- [support.mjs.txt](support.mjs.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate.mjs.txt](validate.mjs.txt)
- [validation-initial.json.txt](validation-initial.json.txt)
- [validation-initial.log.txt](validation-initial.log.txt)
- [validation.json](validation.json)
- [validation.log.txt](validation.log.txt)
- [visible-medium-390-frame-0.png](visible-medium-390-frame-0.png)
- [visible-medium-390-frame-14.png](visible-medium-390-frame-14.png)
- [visible-medium-390-frame-15.png](visible-medium-390-frame-15.png)
- [visible-medium-390-frame-22.png](visible-medium-390-frame-22.png)
- [visible-medium-390-frame-23.png](visible-medium-390-frame-23.png)
- [visible-medium-390-frame-50.png](visible-medium-390-frame-50.png)
- [visible-medium-390.cpuprofile.json.txt](visible-medium-390.cpuprofile.json.txt)
- [visible-medium-390.json](visible-medium-390.json)
- [visible-medium-390.trace-evidence.json.txt](visible-medium-390.trace-evidence.json.txt)
- [visible-paint-errors.json](visible-paint-errors.json)
- [visible-paint-results.json](visible-paint-results.json)
- [visible-paint.log.txt](visible-paint.log.txt)
- [visible-wide-390-frame-0.png](visible-wide-390-frame-0.png)
- [visible-wide-390-frame-16.png](visible-wide-390-frame-16.png)
- [visible-wide-390-frame-17.png](visible-wide-390-frame-17.png)
- [visible-wide-390-frame-40.png](visible-wide-390-frame-40.png)
- [visible-wide-390.cpuprofile.json.txt](visible-wide-390.cpuprofile.json.txt)
- [visible-wide-390.json](visible-wide-390.json)
- [visible-wide-390.trace-evidence.json.txt](visible-wide-390.trace-evidence.json.txt)

## 5. Observations outside scope

No additional product finding outside this round's touched systems was recorded. Reload still transfers/validates the complete large history and has the measured main-thread tasks; on-request reconstruction and all-message/full-JSON expansion have the explicit costs above. These are measured limits, not stored-data truncation or a new engine/provider finding. Disposable stores, temporary scripts/raw captures and temporary Playwright output were left for the orchestrator; no directory was deleted. Only the native instance owned by this round was stopped. Tracked and staged diffs remain empty; prior evidence is unchanged. No commit was made.
