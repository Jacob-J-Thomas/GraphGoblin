# Independent QA, round 7: #259 / PR #382

## 1. Verdict

**FAIL — validation gate incomplete**, at **cc0ad92d4f61aa9a624e31e136225e9e2d6ca035** (detached). **The requested #259 browser checks passed and QA-259-R6-01 is fixed. No new product defect was found.** The overall result is not an unqualified pass because one additional API paging test timed out in its setup hook before its assertion ran: 37 passed, one setup failure. That failure was retained and not rerun to green.

The merge contains main at **75d8c51f4b45dfe7c4d3fe7286e579d6e746deba**, verified as an ancestor; its two parents are recorded in [browser-environment.json](browser-environment.json). Build, all 131 affected web unit tests, all nine maintained Edge tests, lint, typecheck, layers, dependencies, tokens and generated-doc checks passed. Repository formatting is recorded in the gates below. Full coverage was explicitly waived and was not run.

Independent QA only, alone. No production or maintained-test changes, no stage/commit/stash/branch operation, no GitHub writes. Only round-7 QA evidence was added. Admission/final revision and tracked/staged cleanliness: [environment.json](environment.json), [final-state.json](final-state.json). Two disposable built instances used ports **5720/5721** (independent cases, store **gg-qa-e1-xgamxa**) and **5722/5723** (maintained specs, store **gg-qa-e1-GbSRrm**). The fresh spec instance keeps its exact page-count fixtures separate. Both were stopped; all four ports closed ([shutdown.json](shutdown.json), [shutdown-e2e.json](shutdown-e2e.json)). No owner app/store or live provider was used. Mutate nodes and the fake harness are the execution evidence.

## 2. Defects

No new confirmed product defect. **QA-259-R6-01: fixed**, in both 1440 × 900 and 390 × 844 Edge viewports:

1. Open the 350,000-property run's latest request card. Tab to Reconstruct and press Enter: the keyboard lands on the named Messages list with tabindex -1 when there are no message controls. Tab reaches Show all of Variables and removes the list's tabindex.
2. Activate Show all of Variables and Shift+Tab into the named expanded region. Provide input through the public API while the inspector follows the latest event: the new card's **Reconstruct the thread at event 16** button holds focus. Press Enter: the Messages list holds focus again. BODY was not the replacement destination.
3. Repeat with 60 messages and a focused collapsed Variables control: activation lands on **Show all messages**; live replacement lands on the new request button; activating it returns to Show all messages. Tab reaches Download messages as JSON.
4. Put the keyboard on the timeline, then on Pause, and cause a live transition. Each remains focused. Return to an already prepared thread by native DOM activation of a timeline button without moving the outside keyboard: focus remains outside. A Full thread JSON control inside the disappearing viewer correctly hands to the request button.

Exact state records and steps: [focus-history-results.json](focus-history-results.json), [focus-history.mjs.txt](focus-history.mjs.txt), [focus-history.log.txt](focus-history.log.txt). This directly repeats the failed expanded-region and collapsed-control paths from round 6 and adds both message destinations, outside ownership and Tab cleanup. The regression test exists in ThreadViewer.test.tsx and passed. Historical round-6 failures are retained; no old-head checkout or scratch regression execution was done this round.

**Validation issue V7-01 — unresolved API test setup timeout, not a confirmed behavior defect.** The additional command in [api-paging-tests.log.txt](api-paging-tests.log.txt) ran three paging files. Two files passed; the third had four passes and one setup failure. Across the three files, **37 passed and one failed setup**. The failing case was run-event page boundaries over file-backed SQLite / returns the unchanged requested page when only its lookahead payload is {}. Its beforeEach at run-event-paging.test.ts line 16 exceeded the configured **20,000 ms** hook timeout. The test assertion was never reached. No causal environment/product diagnosis is claimed, no threshold was changed, and no rerun was performed. This prevents a clean validation-gate result; that malformed-lookahead assertion remains unverified by this run. Native public API pages and browser paging below do pass, but do not replace that missing fault assertion.

## 3. Coverage of criteria

System: Windows 10.0.26300, x64; Node v22.14.0; installed Edge 155.0.4283.62, headless. Normal viewports 1440 × 900 and 390 × 844. [browser-environment.json](browser-environment.json) records both native process/store identities and the merge provenance. The targeted source/doc change is retained in [change.diff.txt](change.diff.txt).

| Touched system                            | Positive and negative scope                                                                                                                                                                                                                                                | Result                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Whole ThreadViewer focus ownership        | Keyboard request, live expanded-region/control removal, Messages list/control destinations, held tabindex cleanup, outside timeline/Pause, Full thread control, prepared return                                                                                            | PASS at both widths; QA-259-R6-01 fixed                                                                     |
| BoundedValue value ownership              | Round-5 exact A-expanded → live B → Tab to timeline → A then cached B with Enter; keyboard in another value; large-to-small replacement                                                                                                                                    | PASS at both widths; no stale hand-off, held text cleanup correct                                           |
| Large-history mode/cache/session          | Admitted 350,000-property value, request card, reconstruction, prepared return, fresh live card, exact prefix/download, reload after=0 and usable afterwards                                                                                                               | PASS; original data retained; requested replay/load costs measured below                                    |
| Events bounded cells plus opaque paging   | Native 205 inbound records, pages 100/100/5; large values on each page; latest row expansion kept while appending; exact order/no duplicates; keyboard Load more/exhaustion; 1,024-character prefixes, notices, Show all/less, named scrollable regions and exact download | PASS at both widths after correcting the QA helper                                                          |
| Events accessibility and failure recovery | Collapsed payload belongs to row name; controlled 503 next-page responses retain rows, expansion and focus; explicit Load more recovery; malformed opaque API cursor rejected                                                                                              | PASS; fault response is deliberately injected and identified                                                |
| Run history and Loops merge surfaces      | A real 208-event run has API pages 100/100/8; maintained Runs filter/paging and Events reading-position tests; truthful older-loop summary beyond 501 unrelated runs and genuine never-run control; unavailable-summary unit cases                                         | Positive/native/maintained checks PASS; additional API malformed-lookahead setup remains incomplete (V7-01) |
| Native composition and docs               | Build served compiled web/API with fake ports; read docs 09 change and merge; public API/store values unchanged after viewing; build/lint/types/docs/layers/deps/tokens                                                                                                    | PASS for the listed checks; no full WP-F1/readiness reassessment claimed                                    |

Events displays **inbound bus receipts**, not a run's timeline. Both were created and verified separately: a real 208-event run and 205 inbound records whose payload identifies that run. The inbound listing uses opaque cursors; the run timeline/API still uses numeric sequence positions. Fixture bodies and exact page responses: [fixtures.json](fixtures.json), [fixtures.log.txt](fixtures.log.txt), [long-run-api-pages.json](long-run-api-pages.json), [events-api-pages.json](events-api-pages.json). The 350,000-property histories are above two million characters and the controls fixtures above 2.1 million; admission sizes are in fixtures.json.

Every independent check and its expected/actual behavior:

| System / case                                                         | Steps / expected                                                                                                               | Actual                                                                                                                                                                                           | Result                          | Evidence                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------- |
| 1440: exact R6 keyboard request and live expanded-region replacement  | Request -> held Messages list; live expanded Variables -> request button; request -> list; Tab cleanup                         | First request -> OL Messages -1; live -> Reconstruct the thread at event 16; second request -> OL Messages; Tab -> Show all of Variables                                                         | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 1440: timeline and other outside focus survive both directions        | Outside keyboard stays put when live card replaces thread and when a prepared thread returns                                   | Timeline #1run.queued retained across live/prepared transitions; removed Full thread control -> Reconstruct the thread at event 24; outside Pause retained on live and return                    | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 1440: wide card cached return exact download and reload               | Card only until requested; prepared event returns bounded; exact Variables bytes; reload after=0 asks again                    | Exact 7827782 bytes; prepared return 89.3 ms; after=0 reload and usable request view                                                                                                             | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 1440: messages controls destination and collapsed control replacement | Request -> Show all messages; live focused Variables control -> request; request -> Show all messages                          | First and second request -> Show all messages; Tab -> Download messages as JSON; live focused Variables control -> Reconstruct the thread at event 16                                            | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 390: exact R6 keyboard request and live expanded-region replacement   | Request -> held Messages list; live expanded Variables -> request button; request -> list; Tab cleanup                         | First request -> OL Messages -1; live -> Reconstruct the thread at event 16; second request -> OL Messages; Tab -> Show all of Variables                                                         | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 390: timeline and other outside focus survive both directions         | Outside keyboard stays put when live card replaces thread and when a prepared thread returns                                   | Timeline #1run.queued retained across live/prepared transitions; removed Full thread control -> Reconstruct the thread at event 24; outside Pause retained on live and return                    | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 390: wide card cached return exact download and reload                | Card only until requested; prepared event returns bounded; exact Variables bytes; reload after=0 asks again                    | Exact 7827782 bytes; prepared return 96.9 ms; after=0 reload and usable request view                                                                                                             | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 390: messages controls destination and collapsed control replacement  | Request -> Show all messages; live focused Variables control -> request; request -> Show all messages                          | First and second request -> Show all messages; Tab -> Download messages as JSON; live focused Variables control -> Reconstruct the thread at event 16                                            | PASS                            | [focus-history-results.json](focus-history-results.json) |
| 1440: stale hand-off exact keyboard steps                             | Live B hand-off once; keyboard selections A and cached B remain on the timeline                                                | Live B hand-off -> Show all of Variables; A #6node.finishedseed → out, 2 changes, 1 ms, B #16run.waitingnotouch waits for input stay focused; other message region retained; A 4097 chars        | PASS                            | [focus-results.json](focus-results.json)                 |
| 1440: large-to-small value hand-off                                   | Text holds focus at tabindex -1; Tab moves on and removes tabindex                                                             | PRE Variables tabindex -1; Tab -> Full thread JSON; remaining tabindex null                                                                                                                      | PASS                            | [focus-results.json](focus-results.json)                 |
| 390: stale hand-off exact keyboard steps                              | Live B hand-off once; keyboard selections A and cached B remain on the timeline                                                | Live B hand-off -> Show all of Variables; A #6node.finishedseed → out, 2 changes, 1 ms, B #16run.waitingnotouch waits for input stay focused; other message region retained; A 4097 chars        | PASS                            | [focus-results.json](focus-results.json)                 |
| 390: large-to-small value hand-off                                    | Text holds focus at tabindex -1; Tab moves on and removes tabindex                                                             | PRE Variables tabindex -1; Tab -> Full thread JSON; remaining tabindex null                                                                                                                      | PASS                            | [focus-results.json](focus-results.json)                 |
| 1440: payload bounds across three cursor pages                        | 100 -> 200 -> 205 stable rows; exact payload previews/expansion/download on each page; keyboard Load more and exhaustion focus | row accessible name lacks payload marker                                                                                                                                                         | INVALID HELPER; continued below | [events-results.json](events-results.json)               |
| 1440: failed append preserves bounded and expanded payloads           | Controlled 503 append failure retains 100 rows and expansion; Load more can recover by explicit keyboard action                | 100 rows and expanded payload retained on 2 injected 503 responses; focus Load more; explicit keyboard recovery -> 200 rows, expansion retained                                                  | PASS                            | [events-results.json](events-results.json)               |
| 390: payload bounds across three cursor pages                         | 100 -> 200 -> 205 stable rows; exact payload previews/expansion/download on each page; keyboard Load more and exhaustion focus | row accessible name lacks payload marker                                                                                                                                                         | INVALID HELPER; continued below | [events-results.json](events-results.json)               |
| 390: failed append preserves bounded and expanded payloads            | Controlled 503 append failure retains 100 rows and expansion; Load more can recover by explicit keyboard action                | 100 rows and expanded payload retained on 2 injected 503 responses; focus Load more; explicit keyboard recovery -> 200 rows, expansion retained                                                  | PASS                            | [events-results.json](events-results.json)               |
| API invalid opaque cursor                                             | Malformed cursor is rejected with readable typed 400 without modifying history                                                 | HTTP 400, INVALID_CURSOR                                                                                                                                                                         | PASS                            | [events-results.json](events-results.json)               |
| 1440: payload bounds across three cursor pages                        | 100 -> 200 -> 205 stable rows; exact payload previews/expansion/download on each page; keyboard Load more and exhaustion focus | 100 -> 200 -> 205; 205 exact ordered unique IDs; 1,025 displayed chars (1,024 plus ellipsis) on each page; all three downloads exact; exhaustion -> status; widths 1440/1440; API hash unchanged | PASS                            | [events-paging-results.json](events-paging-results.json) |
| 390: payload bounds across three cursor pages                         | 100 -> 200 -> 205 stable rows; exact payload previews/expansion/download on each page; keyboard Load more and exhaustion focus | 100 -> 200 -> 205; 205 exact ordered unique IDs; 1,025 displayed chars (1,024 plus ellipsis) on each page; all three downloads exact; exhaustion -> status; widths 390/390; API hash unchanged   | PASS                            | [events-paging-results.json](events-paging-results.json) |
| 1440 row-name inspection                                              | Query the collapsed row with literal and correctly escaped boundary regex; inspect accessibility snapshot                      | Both queries match one row; payload marker and preview text appear under the cell                                                                                                                | PASS                            | [row-inspection-1440.json](row-inspection-1440.json)     |
| 390 row-name inspection                                               | Same in stacked narrow layout                                                                                                  | Both queries match one row; payload marker and preview text appear under the cell                                                                                                                | PASS                            | [row-inspection-390.json](row-inspection-390.json)       |
| Long run/API fixture                                                  | Read an actual 208-event run in pages of 100                                                                                   | 100 / 100 / 8, no fixture truncation                                                                                                                                                             | PASS                            | [long-run-api-pages.json](long-run-api-pages.json)       |
| Maintained Edge merge regression                                      | Run history.spec.ts and inspector-large-values.spec.ts, one worker, retries 0                                                  | 9 / 9, including older-loop history beyond 501 unrelated runs                                                                                                                                    | PASS                            | [playwright.log.txt](playwright.log.txt)                 |

The original Events helper mistakenly supplied one backslash in a JavaScript string, so its intended regex boundary became a backspace. It stopped each positive paging case before paging ran. Both invalid helper results, script and log remain in [events-results.json](events-results.json), [events.mjs.txt](events.mjs.txt), [events.log.txt](events.log.txt). The independent row-name probe established the correct semantics; [prepare-events-continuation.mjs.txt](prepare-events-continuation.mjs.txt) corrected the helper and generated [events-paging.mjs.txt](events-paging.mjs.txt). Only the two interrupted positive checks continued. The already-passing negative cases and API cursor check were not repeated. [events-helper-correction.json](events-helper-correction.json) records the exact correction. This is a QA correction, not a product fix or a test retry masking a behavior failure.

The 503 case deliberately holds the external next-page response at 503 until the failure state is observed. The product's configured query retry makes two expected console errors; then an explicit keyboard Load more succeeds after the injected fault is released. Those expected errors are retained in events-results.json; unexpected console/page-error lists for the normal cases are empty.

Timing method: read-only DOM/PerformanceObserver instrumentation, standard ≥50 ms long tasks, action-to-two-animation-frames after the expected state. All listed task durations are retained, not just the maximum. Wall times include automation/scheduling and API/server work; they are not INP or a hardware-independent SLA. Reload tasks are measured from the **new document's** origin. No app function/private store was patched. Separate test jobs/fixture creation preceded the primary focus timings; unrelated host activity was uncontrolled. No cross-round speedup ratio is inferred.

| Operation / width                                                                       | Wall ms | Every observed long task (ms) | Evidence                                                 |
| --------------------------------------------------------------------------------------- | ------: | ----------------------------- | -------------------------------------------------------- |
| 1440: exact R6 keyboard request and live expanded-region replacement / first / timing   |   721.6 | 524                           | [focus-history-results.json](focus-history-results.json) |
| 1440: exact R6 keyboard request and live expanded-region replacement / live             |  6789.9 | none                          | [focus-history-results.json](focus-history-results.json) |
| 1440: exact R6 keyboard request and live expanded-region replacement / second / timing  |    71.6 | none                          | [focus-history-results.json](focus-history-results.json) |
| 1440: wide card cached return exact download and reload / returned                      |    89.3 | none                          | [focus-history-results.json](focus-history-results.json) |
| 1440: wide card cached return exact download and reload / reload                        |  4629.1 | 173, 669, 193                 | [focus-history-results.json](focus-history-results.json) |
| 1440: messages controls destination and collapsed control replacement / first / timing  |    67.4 | none                          | [focus-history-results.json](focus-history-results.json) |
| 1440: messages controls destination and collapsed control replacement / second / timing |    54.7 | none                          | [focus-history-results.json](focus-history-results.json) |
| 390: exact R6 keyboard request and live expanded-region replacement / first / timing    |   465.5 | 422                           | [focus-history-results.json](focus-history-results.json) |
| 390: exact R6 keyboard request and live expanded-region replacement / live              |  4568.5 | none                          | [focus-history-results.json](focus-history-results.json) |
| 390: exact R6 keyboard request and live expanded-region replacement / second / timing   |    50.7 | none                          | [focus-history-results.json](focus-history-results.json) |
| 390: wide card cached return exact download and reload / returned                       |    96.9 | none                          | [focus-history-results.json](focus-history-results.json) |
| 390: wide card cached return exact download and reload / reload                         |  3327.8 | 136, 487, 209                 | [focus-history-results.json](focus-history-results.json) |
| 390: messages controls destination and collapsed control replacement / first / timing   |    61.8 | none                          | [focus-history-results.json](focus-history-results.json) |
| 390: messages controls destination and collapsed control replacement / second / timing  |    60.9 | none                          | [focus-history-results.json](focus-history-results.json) |
| 1440: payload bounds across three cursor pages / loadSecond                             |   109.4 | none                          | [events-paging-results.json](events-paging-results.json) |
| 1440: payload bounds across three cursor pages / loadLast                               |    61.9 | none                          | [events-paging-results.json](events-paging-results.json) |
| 390: payload bounds across three cursor pages / loadSecond                              |    93.8 | none                          | [events-paging-results.json](events-paging-results.json) |
| 390: payload bounds across three cursor pages / loadLast                                |    66.8 | none                          | [events-paging-results.json](events-paging-results.json) |

For the original wide fixture, first keyboard reconstruction took **721.6 / 465.5 ms**, with **524 / 422 ms** tasks, desktop/narrow. Live arrival to its request card took **6,789.9 / 4,568.5 ms** wall time (includes server work) with no observed long task in those windows; focus was correct at the card. Prepared returns took **89.3 / 96.9 ms**, no long task. Reloads had the recorded **173, 669, 193 / 136, 487, 209 ms** tasks and resumed after=0 before asking for reconstruction. These remain measurable limits, not claims that all large-history loading is bounded to a frame.

Events page 2 / final-page wall times were **109.4 / 61.9 ms** at desktop and **93.8 / 66.8 ms** at narrow width, with no observed long tasks. The reading positions stayed exactly at **13,919 px** after desktop's first append and **48,043 px** after narrow's; exhaustion also preserved the recorded position. Focus stayed on Load more until exhaustion, then moved to the All events loaded status. Expanded payload scroll height/client height was **8,004/538 px** at desktop and **10,272/504 px** at narrow width, named and keyboard-focusable; the immediate PageDown scrollTop readings (including one initial zero before animation settled) are recorded without claiming every immediate reading moved. Document scroll width equaled the viewport width, **1440/1440 and 390/390**. The narrow screenshots were visually inspected: [events-last-page-390.png](events-last-page-390.png), [focus-live-390.png](focus-live-390.png).

Exactness: **eight download comparisons** pass. The two wide Variables downloads are **7,827,782 bytes** each with SHA-256 **b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3**, equal byte for byte to the API's vars under the same two-space JSON formatting. Their four raw download/API bodies exceed the size limit and are manifested in [NOT-KEPT.md](NOT-KEPT.md) / [not-kept.json](not-kept.json); comparison metadata and executable steps remain. The six Events downloads across the three pages contain escapes, control characters, Unicode pairs and a lone surrogate; **21,029 / 21,029 / 21,027 bytes** per viewport match their API payloads exactly. Their preview text equals the first 1,024 characters of that formatting plus the UI ellipsis; full expansion equals the complete formatting. Viewing did not change the API listing hash. QA-259-02's known full-thread property-order distinction was not re-opened; no full-thread exactness claim is added this round.

Gates, exact commands and logs (Node 22):

| Command                                                                                                                                                                                                                                                                                                                                                                          | Result | Evidence                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| pnpm.cmd build                                                                                                                                                                                                                                                                                                                                                                   | PASS   | [build.log.txt](build.log.txt)                       |
| pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/inspector/ThreadViewer.test.tsx src/components/ui/bounded-value.test.tsx src/components/ui/bounded-value.deferred.test.tsx src/events/EventsPage.test.tsx src/loops/LoopsPage.test.tsx src/runs/RunsPage.test.tsx src/runs/projections.test.ts src/runs/RunInspectorPage.test.tsx src/api/queries.reconnect.test.tsx | PASS   | [unit.log.txt](unit.log.txt)                         |
| pnpm.cmd --filter @graphgoblin/api exec vitest run src/routes/event-paging.test.ts src/routes/run-paging.test.ts src/routes/run-event-paging.test.ts                                                                                                                                                                                                                             | FAIL   | [api-paging-tests.log.txt](api-paging-tests.log.txt) |
| pnpm.cmd lint                                                                                                                                                                                                                                                                                                                                                                    | PASS   | [lint.log.txt](lint.log.txt)                         |
| pnpm.cmd typecheck                                                                                                                                                                                                                                                                                                                                                               | PASS   | [typecheck.log.txt](typecheck.log.txt)               |
| pnpm.cmd --filter @graphgoblin/web exec playwright test --config %TEMP%\gg-qa-e1-r7-playwright.config.mjs                                                                                                                                                                                                                                                                        | PASS   | [playwright.log.txt](playwright.log.txt)             |
| pnpm.cmd check:layers                                                                                                                                                                                                                                                                                                                                                            | PASS   | [layers.log.txt](layers.log.txt)                     |
| pnpm.cmd check:deps                                                                                                                                                                                                                                                                                                                                                              | PASS   | [deps.log.txt](deps.log.txt)                         |
| pnpm.cmd check:tokens                                                                                                                                                                                                                                                                                                                                                            | PASS   | [tokens.log.txt](tokens.log.txt)                     |
| pnpm.cmd check:docs                                                                                                                                                                                                                                                                                                                                                              | PASS   | [docs.log.txt](docs.log.txt)                         |
| pnpm.cmd format:check                                                                                                                                                                                                                                                                                                                                                            | PASS   | [format.log.txt](format.log.txt)                     |

Web unit result: **131/131 in nine files**, including ThreadViewer's new ownership regression, BoundedValue deferred/identity cases, Events, Loops, Runs, inspector projections/page and query-reconnect checks. Additional API result: **37 pass / one setup failure in three files**, detailed as V7-01. Maintained Edge: **9/9, retries 0**, against the fresh disposable instance. Full package coverage was waived; no coverage percentage, threshold change or exclusion is claimed. Generated-doc check was included because merged API paging routes changed. Dependency manifests/lockfile did not change in this delta, so check:licenses was not required/run. No full-suite retry was made.

Not tested in this bounded round: the full rounds 1–6 adversarial/surface matrix, full package coverage, actual screen-reader speech, live providers, native restart on the same store, more than 32 requested-cache entries, concurrent tabs, and the rest of WP-F1/main beyond compilation/gates and listed adjacent regressions. The API malformed-lookahead assertion was not testable to completion because its setup hook timed out; product code/tests were left untouched for the orchestrator.

## 4. Report path and evidence folder

Report: docs/qa/2026-10-22-wp-e1-259-qa/round-7/README.md. All kept evidence is in this same round-7 folder and linked below. The integrity outcome is [validation.json](validation.json) / [validation.log.txt](validation.log.txt); integrity success does not turn the failed API gate into a pass.

Prior evidence: **761 references**, **0 unaccounted missing**; **48 manifest entries**. The 44 still-local round-4/5 oversized bodies match their recorded bytes/hashes; the four round-6 oversized bodies are absent from the worktree as manifested. Existing large untracked captures were left alone. Every previously referenced kept artifact is available and no prior hash changed ([prior-evidence-audit.json](prior-evidence-audit.json), [final-state.json](final-state.json)). All this round's retained captures are below 1,000,000 bytes.

- [NOT-KEPT.md](NOT-KEPT.md)
- [api-key-metadata.json](api-key-metadata.json)
- [api-paging-tests.log.txt](api-paging-tests.log.txt)
- [browser-environment.json](browser-environment.json)
- [browser-support.mjs.txt](browser-support.mjs.txt)
- [build.log.txt](build.log.txt)
- [cached-focus.log.txt](cached-focus.log.txt)
- [change.diff.txt](change.diff.txt)
- [deps.log.txt](deps.log.txt)
- [docs.log.txt](docs.log.txt)
- [environment-health.log.txt](environment-health.log.txt)
- [environment-health.mjs.txt](environment-health.mjs.txt)
- [environment.json](environment.json)
- [event-0-api-1440.json.txt](event-0-api-1440.json.txt)
- [event-0-api-390.json.txt](event-0-api-390.json.txt)
- [event-0-download-1440.json.txt](event-0-download-1440.json.txt)
- [event-0-download-390.json.txt](event-0-download-390.json.txt)
- [event-100-api-1440.json.txt](event-100-api-1440.json.txt)
- [event-100-api-390.json.txt](event-100-api-390.json.txt)
- [event-100-download-1440.json.txt](event-100-download-1440.json.txt)
- [event-100-download-390.json.txt](event-100-download-390.json.txt)
- [event-204-api-1440.json.txt](event-204-api-1440.json.txt)
- [event-204-api-390.json.txt](event-204-api-390.json.txt)
- [event-204-download-1440.json.txt](event-204-download-1440.json.txt)
- [event-204-download-390.json.txt](event-204-download-390.json.txt)
- [event-row-ax-1440-0.json](event-row-ax-1440-0.json)
- [event-row-ax-1440-100.json](event-row-ax-1440-100.json)
- [event-row-ax-1440-204.json](event-row-ax-1440-204.json)
- [event-row-ax-390-0.json](event-row-ax-390-0.json)
- [event-row-ax-390-100.json](event-row-ax-390-100.json)
- [event-row-ax-390-204.json](event-row-ax-390-204.json)
- [events-api-pages.json](events-api-pages.json)
- [events-continuation-setup.log.txt](events-continuation-setup.log.txt)
- [events-errors.json](events-errors.json)
- [events-helper-correction.json](events-helper-correction.json)
- [events-invalid-cursor.json](events-invalid-cursor.json)
- [events-last-page-1440.png](events-last-page-1440.png)
- [events-last-page-390.png](events-last-page-390.png)
- [events-paging-errors.json](events-paging-errors.json)
- [events-paging-results.json](events-paging-results.json)
- [events-paging.log.txt](events-paging.log.txt)
- [events-paging.mjs.txt](events-paging.mjs.txt)
- [events-results.json](events-results.json)
- [events.log.txt](events.log.txt)
- [events.mjs.txt](events.mjs.txt)
- [final-state.json](final-state.json)
- [finish.mjs.txt](finish.mjs.txt)
- [fixtures.json](fixtures.json)
- [fixtures.log.txt](fixtures.log.txt)
- [fixtures.mjs.txt](fixtures.mjs.txt)
- [focus-cached-1440.png](focus-cached-1440.png)
- [focus-cached-390.png](focus-cached-390.png)
- [focus-errors.json](focus-errors.json)
- [focus-history-errors.json](focus-history-errors.json)
- [focus-history-results.json](focus-history-results.json)
- [focus-history.log.txt](focus-history.log.txt)
- [focus-history.mjs.txt](focus-history.mjs.txt)
- [focus-live-1440.png](focus-live-1440.png)
- [focus-live-390.png](focus-live-390.png)
- [focus-results.json](focus-results.json)
- [focus.mjs.txt](focus.mjs.txt)
- [format-qa.log.txt](format-qa.log.txt)
- [format.log.txt](format.log.txt)
- [inspect-events.log.txt](inspect-events.log.txt)
- [inspect-events.mjs.txt](inspect-events.mjs.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [long-run-api-pages.json](long-run-api-pages.json)
- [make-report.log.txt](make-report.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [not-kept.json](not-kept.json)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [playwright.log.txt](playwright.log.txt)
- [prepare-events-continuation.mjs.txt](prepare-events-continuation.mjs.txt)
- [prior-evidence-audit.json](prior-evidence-audit.json)
- [row-inspection-1440.json](row-inspection-1440.json)
- [row-inspection-390.json](row-inspection-390.json)
- [run-command.mjs.txt](run-command.mjs.txt)
- [server-e2e.mjs.txt](server-e2e.mjs.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown-e2e.json](shutdown-e2e.json)
- [shutdown-e2e.log.txt](shutdown-e2e.log.txt)
- [shutdown.json](shutdown.json)
- [shutdown.log.txt](shutdown.log.txt)
- [stop-e2e.mjs.txt](stop-e2e.mjs.txt)
- [support.mjs.txt](support.mjs.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [unit.log.txt](unit.log.txt)
- [validate.mjs.txt](validate.mjs.txt)
- [validation.json](validation.json)
- [validation.log.txt](validation.log.txt)

## 5. Observations outside scope

V7-01 is an additional validation-gate failure in merged API paging tests; its business assertion did not run, and no product cause is asserted. No other out-of-scope product defect was recorded. Requested reconstruction and reload still have the measured costs above. Disposable stores, scripts/raw temporary captures and maintained-spec output directories remain for the orchestrator; no directory was deleted. Both owned native processes stopped and their four ports are closed. Production and staged diffs are empty, prior evidence is unchanged, and no commit was made.
