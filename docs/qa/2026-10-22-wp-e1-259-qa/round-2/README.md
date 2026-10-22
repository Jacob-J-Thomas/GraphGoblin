# 1. Verdict

**FAIL** at **c26d65d814613d9ea394f58af5a99810d2df7cd5** because the requested live large-to-small focus behavior still fails in real Edge (QA-259-R2-01, minor). **QA-259-01 is fixed. QA-259-02 is accepted as disposed and is not reopened:** all full-thread JSON values match; its property order follows the client reconstruction as docs 09 now explain.

Worktree: **codex-qa-wp-e1-259**, detached HEAD as assigned. Round-1 baseline: **a52299c685bd3a08ba4962f6eb90ea5962eccc5f**. Production code, maintained tests, Git index and committed round-1 artifacts were unchanged. No commits, branch switches, stashes, sub-agents, live provider calls or GitHub writes. Only this round-2 directory was added.

# 2. Defects and previous dispositions

## QA-259-R2-01 — minor — live large-to-small collapse loses focus to the page body

Reproduction through the built app, at **1440 and 390 px**:

1. Create a real mutate/wait run: set Variables to a 20,000-character marker, wait for input, set Variables to a small object, then wait again.
2. Open the current wait in the inspector; choose Show all of Variables.
3. Press Shift+Tab to focus the expanded Variables region (20,018 characters; tabindex 0).
4. Provide the observed wait's input through the API while the keyboard remains in that region.
5. Wait until Variables becomes the 19-character small JSON object.

Expected: the small text holds focus with tabindex -1, then Tab reaches the next control and removes that attribute. Actual: **document.activeElement is BODY**, and the collapsed pre has **no tabindex**. The next Tab happens to reach Full thread JSON, so the sequential Tab path remains usable; the specified held-text focus and named keyboard location are lost.

This fails for an immediate mutation and for a controlled fake inference turn delayed **500 ms** before the small mutation. In the delayed path, focus first moves correctly to Show all when a new large reconstruction appears, then drops to BODY when the small value removes that button. Large-to-large replacement independently focuses Show all correctly. A keyboard on the separate Full thread JSON toggle stays there throughout both kinds of update.

Evidence: [four causal reproductions and focus/DOM traces](focus-small-repro.json), [replay script](focus-small-repro.mjs.txt), [execution log](focus-small.log.txt), [1440 px captured stages](focus-inside-stages-1440.json), [390 px captured stages](focus-inside-stages-390.json), and the two failed rows in the [main focus matrix](focus-navigation-results.json). The causal screenshots are taken **after the following Tab**, and are supplemental to the before-Tab focus records.

## QA-259-01 — closed by fresh verification

Using the exact round-1 **2,322,721-character Variables** fixture: A is the replace node.finished event, B is seed node.finished. Expand A, select B, return to A; then expand B and navigate A -> B. Every new selection displays **4,096 characters plus the ellipsis**, offers Show all, and has no whole large value in the DOM. Both widths pass. Timed navigation observes **zero long tasks** and a largest pre of **4,097 characters**. The same value stays expanded when later events append while its earlier event remains selected.

## QA-259-02 — accepted disposition; no value difference found

The Full thread JSON is the reconstruction at the selected event, so object property order need not match the API serialization of the live thread. Fresh downloads at both widths parse to exactly the API's current JSON values in the tested current-wait case. Their byte differences are recorded as the known representation difference. Result, Variables and Events downloads satisfy the strict API-formatted byte comparison. This report does not treat property order as a defect.

# 3. Coverage of criteria

## Environment and evidence scope

- Windows 11, Node **v22.14.0** first on PATH; built API and web app; real HTTP, SQLite, engine and mutate/wait execution.
- Installed headless Microsoft Edge **155.0.4283.62** via Playwright, **1440 x 900** and **390 x 844**.
- Disposable API **127.0.0.1:5720**, fake control endpoint **127.0.0.1:5721**, system-temp store **gg-qa-e1-SUlfqC**. The API minted a QA key; only non-secret [metadata](api-key-metadata.json) is retained.
- **Fake-only provider evidence**: inference/progress and the decision port use fakes. No live turn. The causal 500 ms delay is a scripted fake turn, not a performance SLA.
- Touched systems enumerated: BoundedValue state and focus, bounded serialization, all inspector value surfaces, Events payloads/accessibility, downloads, reconstruction cache and live selection, keyboard navigation, sessions, storage preservation and native restart. The main-merge replay-seed changes are exercised by the affected projection tests and normal reconstruction comparisons; no separate full #245 acceptance is claimed.
- COMMON and QA-COMMON were reread. The build revision was confirmed before testing and again at completion. [Round-1 baseline](../README.md) stays historical.

## Round-1 artifact retention audit

**Nothing cited is missing:** all **132 unique referenced paths** exist and are committed on this head. Logs remain available under their .log.txt names. The eight original download artifacts no longer match their recorded raw hashes because their JSON was reformatted; canonical JSON serialization reproduces **all eight original hashes**, preserving their values and property order. They cannot serve as unchanged raw byte files now, so round-2 byte assertions use newly captured downloads.

[Audit with per-file existence, commit state, size and SHA-256](round-one-audit.json); [audit script](audit-round-one.mjs.txt). Round-2 downloads also have byte-identical .json.txt mirrors to protect the raw evidence against a future JSON formatter; [integrity manifest](download-integrity.json).

## Requested criteria

| Requested check                                             | Disposition                                  | Evidence                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1: exact A/B/A and B/A/B steps on 2,322,721 characters      | **PASS** at both widths                      | Focus/navigation matrix; timed moves below                                                                           |
| 1: a new live reconstruction collapses expanded A           | **PASS** for bounded content                 | The live large-to-large update shows 4,097 characters and Show all; small update shows 19 characters                 |
| 2: keyboard timeline selection, large/large and large/small | **PASS**                                     | Starting in the region, Shift+Tab reaches the target timeline button; Enter selects it; focus remains on that button |
| 2: live large/large focus                                   | **PASS**                                     | New Show all is focused; captured stages                                                                             |
| 2: live large/small held text and Tab cleanup               | **FAIL**                                     | QA-259-R2-01: pre never holds focus or acquires tabindex -1; next Tab still reaches Full thread JSON                 |
| 2: keyboard elsewhere left alone                            | **PASS**                                     | Separate Full thread JSON toggle retains focus through both updates                                                  |
| 3: expansion on all nine surfaces                           | **PASS**                                     | 25 main browser checks and supplemental exactness matrix                                                             |
| 3: unchanged historical value stays expanded during appends | **PASS**                                     | Region focus, full text and selected event stay unchanged at both widths                                             |
| 4: strict Result/Variables/Events bytes                     | **PASS**                                     | 22 fresh strict byte comparisons including adversarial Events cases                                                  |
| 4: full-thread reconstruction values                        | **PASS**                                     | 2/2 exact JSON values; known property-order differences recorded, accepted                                           |
| 4: keyboard, sessions, restart and stored values            | **PASS** except live small-focus failure     | Main matrix, reload/clearing checks, 17 native-restart checks                                                        |
| 5: regression tests exist/current pass                      | **PASS**                                     | 67/67 tests in seven affected files, including both new regressions                                                  |
| 5: failure on previous implementation                       | **Reasoned from diff; not executed on base** | Counterfactual analysis below and extracted previous source                                                          |

## A/B/A measurements

Each measured move starts after the timeline target has been scrolled into view and the preceding full expansion has painted. CDP dispatches the mouse input; two animation frames complete before recording layout/task metrics. Long tasks use the browser's standard **50 ms** threshold. These are observed warm-cache workload timings, not an owner-approved SLA or a sustained-load benchmark.

| Width   | Selection | Wall time | Layout time | Largest pre     | Long tasks |
| ------- | --------- | --------- | ----------- | --------------- | ---------- |
| 1440 px | seed      | 38.6 ms   | 2.8 ms      | 4097 characters | 0          |
| 1440 px | replace   | 30.2 ms   | 1.2 ms      | 4097 characters | 0          |
| 1440 px | replace   | 29.2 ms   | 1.9 ms      | 4097 characters | 0          |
| 1440 px | seed      | 29.4 ms   | 1.5 ms      | 4097 characters | 0          |
| 390 px  | seed      | 40.1 ms   | 2.8 ms      | 4097 characters | 0          |
| 390 px  | replace   | 28.8 ms   | 0.9 ms      | 4097 characters | 0          |
| 390 px  | replace   | 35.8 ms   | 2.0 ms      | 4097 characters | 0          |
| 390 px  | seed      | 36.0 ms   | 2.2 ms      | 4097 characters | 0          |

Across the eight timed moves, wall time is **28.8–40.1 ms**, with no observed long task and no pre exceeding 4,097 characters. The source guard makes expanded false in the first render that sees a different value, including the adjusted/discarded render. Browser DOM/timing evidence and that source analysis support the no-whole-value-render conclusion; no invasive private-state instrumentation was used.

## Main built-app matrix

[Script](browser.mjs.txt), [log](browser.log.txt), [network](browser-network.json), [browser errors](browser-errors.json). The inherited full-thread check name still includes “exact download”; its oracle is now exact reconstructed JSON contents, with the known property-order byte difference recorded.

| System / case                                                 | Steps                                                         | Expected                                                                            | Actual                                                                                                                                                                                                                | Result | Evidence                        |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- |
| 1440: result, all/less, exact download and region             | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 20002; expand/collapse 78.8/22.0 ms; document 1440/1440 px; download 20002 bytes, byte exact=true                                                                                                  | PASS   | [results](browser-results.json) |
| 1440: Node progress #380 exact long-line reproduction         | Open inference run; expand drawer; measure before/after width | Exact bounded prefix/full content, usable actions and no document overflow          | before/after 1440/1440 px; interaction 27.8 ms                                                                                                                                                                        | PASS   | [results](browser-results.json) |
| 1440: bounded generic progress values                         | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 1024; full 2081; expand/collapse 25.0/20.6 ms; document 1440/1440 px; expanded text exact; preview 1024; full 2077; expand/collapse 31.1/24.9 ms; document 1440/1440 px; expanded text exact                  | PASS   | [results](browser-results.json) |
| 1440: nested variable and exact Unicode download              | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 2322721; expand/collapse 652.1/31.4 ms; document 1440/1440 px; download 2322734 bytes, byte exact=true                                                                                             | PASS   | [results](browser-results.json) |
| 1440: message 50000 characters                                | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 50000; expand/collapse 34.5/25.7 ms; document 1440/1440 px; expanded text exact                                                                                                                    | PASS   | [results](browser-results.json) |
| 1440: patch large before and after                            | Select replace event; expand/collapse both sides              | Exact bounded prefix/full content, usable actions and no document overflow          | Before: preview 1024; full 20002; expand/collapse 31.6/30.9 ms; document 1440/1440 px; expanded text exact; After: preview 1024; full 20002; expand/collapse 33.6/22.1 ms; document 1440/1440 px; expanded text exact | PASS   | [results](browser-results.json) |
| 1440: full thread lazy DOM and exact download                 | Select current wait; open; expand; download; collapse/close   | Exact reconstructed JSON contents; lazy DOM; accepted API property-order difference | preview 4096; full 2379185; expand/collapse 562.3/30.9 ms; document 1440/1440 px; download 2379198 bytes, byte exact=false                                                                                            | PASS   | [results](browser-results.json) |
| 1440: 10000-character prompt and form responsiveness          | Expand prompt; focus/scroll; collapse; type answer            | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 10000; expand/collapse 36.1/28.9 ms; document 1440/1440 px; expanded text exact                                                                                                                    | PASS   | [results](browser-results.json) |
| 1440: expansion independent and selection resets              | Expand A; select B; return to A                               | Changed value stays collapsed, including return to A                                | {"independent":true,"reset":true}                                                                                                                                                                                     | PASS   | [results](browser-results.json) |
| 1440: 2048-character decision reasoning                       | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | 2048 characters exact; page 1440 px                                                                                                                                                                                   | PASS   | [results](browser-results.json) |
| 1440: Events 1MiB payload exact prefix/download/row name      | Open payload; compare API prefix; expand/download/collapse    | Exact bounded prefix/full content, usable actions and no document overflow          | preview 1024; full 1048658; expand/collapse 369.9/23.1 ms; document 1440/1440 px; download 1048658 bytes, byte exact=true                                                                                             | PASS   | [results](browser-results.json) |
| 390: result, all/less, exact download and region              | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 20002; expand/collapse 44.1/32.1 ms; document 390/390 px; download 20002 bytes, byte exact=true                                                                                                    | PASS   | [results](browser-results.json) |
| 390: Node progress #380 exact long-line reproduction          | Open inference run; expand drawer; measure before/after width | Exact bounded prefix/full content, usable actions and no document overflow          | before/after 390/390 px; interaction 30.9 ms                                                                                                                                                                          | PASS   | [results](browser-results.json) |
| 390: bounded generic progress values                          | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 1024; full 2081; expand/collapse 35.5/27.4 ms; document 390/390 px; expanded text exact; preview 1024; full 2077; expand/collapse 28.1/22.2 ms; document 390/390 px; expanded text exact                      | PASS   | [results](browser-results.json) |
| 390: nested variable and exact Unicode download               | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 2322721; expand/collapse 749.6/44.4 ms; document 390/390 px; download 2322734 bytes, byte exact=true                                                                                               | PASS   | [results](browser-results.json) |
| 390: message 50000 characters                                 | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 50000; expand/collapse 39.5/32.4 ms; document 390/390 px; expanded text exact                                                                                                                      | PASS   | [results](browser-results.json) |
| 390: patch large before and after                             | Select replace event; expand/collapse both sides              | Exact bounded prefix/full content, usable actions and no document overflow          | Before: preview 1024; full 20002; expand/collapse 30.7/25.6 ms; document 390/390 px; expanded text exact; After: preview 1024; full 20002; expand/collapse 33.3/19.3 ms; document 390/390 px; expanded text exact     | PASS   | [results](browser-results.json) |
| 390: full thread lazy DOM and exact download                  | Select current wait; open; expand; download; collapse/close   | Exact reconstructed JSON contents; lazy DOM; accepted API property-order difference | preview 4096; full 2379185; expand/collapse 647.8/23.1 ms; document 390/390 px; download 2379198 bytes, byte exact=false                                                                                              | PASS   | [results](browser-results.json) |
| 390: 10000-character prompt and form responsiveness           | Expand prompt; focus/scroll; collapse; type answer            | Exact bounded prefix/full content, usable actions and no document overflow          | preview 4096; full 10000; expand/collapse 34.6/26.3 ms; document 390/390 px; expanded text exact                                                                                                                      | PASS   | [results](browser-results.json) |
| 390: expansion independent and selection resets               | Expand A; select B; return to A                               | Changed value stays collapsed, including return to A                                | {"independent":true,"reset":true}                                                                                                                                                                                     | PASS   | [results](browser-results.json) |
| 390: 2048-character decision reasoning                        | Run the named sequence in its retained script                 | Exact bounded prefix/full content, usable actions and no document overflow          | 2048 characters exact; page 390 px                                                                                                                                                                                    | PASS   | [results](browser-results.json) |
| 390: Events 1MiB payload exact prefix/download/row name       | Open payload; compare API prefix; expand/download/collapse    | Exact bounded prefix/full content, usable actions and no document overflow          | preview 1024; full 1048658; expand/collapse 359.6/17.4 ms; document 390/390 px; download 1048658 bytes, byte exact=true                                                                                               | PASS   | [results](browser-results.json) |
| keyboard: Tab reaches Show all and Download JSON              | Run the named sequence in its retained script                 | Tab reaches both actions                                                            | {"reached":[{"tabs":7,"name":"Show all of Result"},{"tabs":8,"name":"Download Result as JSON"}]}                                                                                                                      | PASS   | [results](browser-results.json) |
| two similar logs, SPA switching, reload and cleared session   | Run the named sequence in its retained script                 | Correct marker after switching, reload and session clearing                         | 3 comparisons/items passed                                                                                                                                                                                            | PASS   | [results](browser-results.json) |
| negative: viewing never changes stored thread, events, result | Run the named sequence in its retained script                 | Run/thread/events/results unchanged                                                 | 15 comparisons/items passed                                                                                                                                                                                           | PASS   | [results](browser-results.json) |

Direct Download JSON remains available on Result, Variables, Full thread JSON and Events payloads. Messages, diff values, progress rows and the prompt provide exact expanded text. The reasoning excerpt is contract-bounded and shown completely. Progress summaries supplied at 16 KiB/20,000 characters are projected to the existing **2,000-character** contract before storage; this round verifies their persisted progress values with 1,024-character previews, and makes no claim of a 16 KiB stored summary.

## Focus, live behavior and session matrix

All live data changes are produced through public loop/run APIs and real mutate nodes. DOM focus events and MutationObserver observe the public browser surface; they do not patch components. The two failing large-to-small rows contain the new defect. The narrowed two-case diagnostic captures both successful large-focus stages and failing small-focus stages without replacing this original matrix.

| System / case                                                  | Steps                                                      | Expected                                                                                    | Actual                                                                                                                                                                                                                                                                                                                                                                                                                             | Result | Evidence                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| 1440: exact round-1 A/B/A and B/A/B regression                 | Open payload; compare API prefix; expand/download/collapse | Each change has 4096-character preview, Show all and no whole-value layout                  | 2322721 expanded characters; seed: 38.6 ms, pre 4097, largest pre 4097, long tasks 0; replace: 30.2 ms, pre 4097, largest pre 4097, long tasks 0; replace: 29.2 ms, pre 4097, largest pre 4097, long tasks 0; seed: 29.4 ms, pre 4097, largest pre 4097, long tasks 0                                                                                                                                                              | PASS   | [results](focus-navigation-results.json) |
| 1440: keyboard event change, large-to-large and large-to-small | Run the named sequence in its retained script              | Keyboard selection keeps focus on the selected timeline button; values collapse             | {"runId":"01M5JS020TV3K198PW0JP2A086","large":{"shiftTabs":12,"focus":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"#14node.finishedchange-large → out, 1 change, 0 ms"},"targetFocused":true},"small":{"shiftTabs":5,"focus":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"#22node.finishedchange-small → out, 1 change, 0 ms"},"targetFocused":true},"smallText":"{\n \"small\": true\n}"} | PASS   | [results](focus-navigation-results.json) |
| 1440: live replacement focus inside expanded component         | Run the named sequence in its retained script              | Large-to-large focuses new Show all; large-to-small holds pre at -1; Tab leaves no tabindex | large-to-small focus lost: {"tag":"BODY","label":null,"role":null,"tabindex":null}                                                                                                                                                                                                                                                                                                                                                 | FAIL   | [results](focus-navigation-results.json) |
| 1440: live replacement leaves outside keyboard alone           | Run the named sequence in its retained script              | Outside Full thread JSON toggle retains focus for large/large and large/small updates       | {"runId":"01M5JS03ZJ0ZRNQ3PQTA63ZK9N","large":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"Full thread JSON"},"small":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"Full thread JSON"},"tabindex":null}                                                                                                                                                                                     | PASS   | [results](focus-navigation-results.json) |
| 1440: unchanged earlier expanded value survives live re-render | Run the named sequence in its retained script              | Selected seed, full text and region focus remain unchanged while events append              | {"runId":"01M5JS04T7FH0K3SN59JPYCZ0J","selected":"#6\nnode.finished\nseed → out, 1 change, 0 ms","chars":20018,"focus":{"tag":"PRE","label":"Variables","role":"region","tabindex":"0"},"newLastSeq":16}                                                                                                                                                                                                                           | PASS   | [results](focus-navigation-results.json) |
| 1440: reload/session reset starts bounded                      | Run the named sequence in its retained script              | A fresh component starts collapsed and reconstructs the same stored Variables               | {"chars":4097,"focus":{"tag":"BODY","label":null,"role":null,"tabindex":null}}                                                                                                                                                                                                                                                                                                                                                     | PASS   | [results](focus-navigation-results.json) |
| 390: exact round-1 A/B/A and B/A/B regression                  | Open payload; compare API prefix; expand/download/collapse | Each change has 4096-character preview, Show all and no whole-value layout                  | 2322721 expanded characters; seed: 40.1 ms, pre 4097, largest pre 4097, long tasks 0; replace: 28.8 ms, pre 4097, largest pre 4097, long tasks 0; replace: 35.8 ms, pre 4097, largest pre 4097, long tasks 0; seed: 36.0 ms, pre 4097, largest pre 4097, long tasks 0                                                                                                                                                              | PASS   | [results](focus-navigation-results.json) |
| 390: keyboard event change, large-to-large and large-to-small  | Run the named sequence in its retained script              | Keyboard selection keeps focus on the selected timeline button; values collapse             | {"runId":"01M5JS08WVWS3Z64H52P1CP1HN","large":{"shiftTabs":12,"focus":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"#14node.finishedchange-large → out, 1 change, 0 ms"},"targetFocused":true},"small":{"shiftTabs":5,"focus":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"#22node.finishedchange-small → out, 1 change, 0 ms"},"targetFocused":true},"smallText":"{\n \"small\": true\n}"} | PASS   | [results](focus-navigation-results.json) |
| 390: live replacement focus inside expanded component          | Run the named sequence in its retained script              | Large-to-large focuses new Show all; large-to-small holds pre at -1; Tab leaves no tabindex | large-to-small focus lost: {"tag":"BODY","label":null,"role":null,"tabindex":null}                                                                                                                                                                                                                                                                                                                                                 | FAIL   | [results](focus-navigation-results.json) |
| 390: live replacement leaves outside keyboard alone            | Run the named sequence in its retained script              | Outside Full thread JSON toggle retains focus for large/large and large/small updates       | {"runId":"01M5JS0ANQ421C9ZEF1PYNK2ED","large":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"Full thread JSON"},"small":{"tag":"BUTTON","label":null,"role":null,"tabindex":null,"text":"Full thread JSON"},"tabindex":null}                                                                                                                                                                                     | PASS   | [results](focus-navigation-results.json) |
| 390: unchanged earlier expanded value survives live re-render  | Run the named sequence in its retained script              | Selected seed, full text and region focus remain unchanged while events append              | {"runId":"01M5JS0BE05W2E6EDFZ2E43HR5","selected":"#6\nnode.finished\nseed → out, 1 change, 0 ms","chars":20018,"focus":{"tag":"PRE","label":"Variables","role":"region","tabindex":"0"},"newLastSeq":16}                                                                                                                                                                                                                           | PASS   | [results](focus-navigation-results.json) |
| 390: reload/session reset starts bounded                       | Run the named sequence in its retained script              | A fresh component starts collapsed and reconstructs the same stored Variables               | {"chars":4097,"focus":{"tag":"BODY","label":null,"role":null,"tabindex":null}}                                                                                                                                                                                                                                                                                                                                                     | PASS   | [results](focus-navigation-results.json) |

| System / case                                          | Steps                                         | Expected                                                                                    | Actual                                                                             | Result | Evidence                                 |
| ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| 1440: live replacement focus inside expanded component | Run the named sequence in its retained script | Large-to-large focuses new Show all; large-to-small holds pre at -1; Tab leaves no tabindex | large-to-small focus lost: {"tag":"BODY","label":null,"role":null,"tabindex":null} | FAIL   | [results](focus-live-stage-results.json) |
| 390: live replacement focus inside expanded component  | Run the named sequence in its retained script | Large-to-large focuses new Show all; large-to-small holds pre at -1; Tab leaves no tabindex | large-to-small focus lost: {"tag":"BODY","label":null,"role":null,"tabindex":null} | FAIL   | [results](focus-live-stage-results.json) |

## Causal small-focus matrix

| Width   | Fake turn delay | Steps                                                 | Expected                                                     | Before following Tab                                           | After following Tab                                        | Result | Evidence                                                           |
| ------- | --------------- | ----------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| 1440 px | 0 ms            | Expand/focus large Variables; wake wait; mutate small | pre focused at -1, Tab to next control and attribute removed | {"tag":"BODY","label":null,"tabindex":null,"preFocused":false} | {"tag":"BUTTON","text":"Full thread JSON","tabindex":null} | FAIL   | [trace](focus-small-repro.json), [image](focus-small-1440-0.png)   |
| 1440 px | 500 ms          | Expand/focus large Variables; wake wait; mutate small | pre focused at -1, Tab to next control and attribute removed | {"tag":"BODY","label":null,"tabindex":null,"preFocused":false} | {"tag":"BUTTON","text":"Full thread JSON","tabindex":null} | FAIL   | [trace](focus-small-repro.json), [image](focus-small-1440-500.png) |
| 390 px  | 0 ms            | Expand/focus large Variables; wake wait; mutate small | pre focused at -1, Tab to next control and attribute removed | {"tag":"BODY","label":null,"tabindex":null,"preFocused":false} | {"tag":"BUTTON","text":"Full thread JSON","tabindex":null} | FAIL   | [trace](focus-small-repro.json), [image](focus-small-390-0.png)    |
| 390 px  | 500 ms          | Expand/focus large Variables; wake wait; mutate small | pre focused at -1, Tab to next control and attribute removed | {"tag":"BODY","label":null,"tabindex":null,"preFocused":false} | {"tag":"BUTTON","text":"Full thread JSON","tabindex":null} | FAIL   | [trace](focus-small-repro.json), [image](focus-small-390-500.png)  |

The immediate path fails without a fake inference node. The delayed path separates a large reconstruction from the small replacement and also fails. No retry-to-green was used; all four causal cases remain failed.

## Exactness and boundaries

The serializer passed **1335/1335** comparisons across **89** generated value/key cases and 15 limits. [Results](prefix-results.json), [script](prefix-checks.mjs.txt), [log](prefix.log.txt).

The following built-app cases rerun escaping, Unicode, lone surrogates, a valid pair at the 1,024-character quoting boundary, control characters, very long keys, holes/nulls and values below/at/above the cell bound. JSON holes become null at the transport boundary. The current API value is the oracle. For strict downloads the expected bytes are UTF-8 JSON.stringify(API value, null, 2), preserving object order and escaping.

| System / case                                        | Steps                                                       | Expected                                                                            | Actual                                                                                                                                               | Result | Evidence                      |
| ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------- |
| 1440: exact controls                                 | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 31216 JSON characters; page 1440 px; exact expanded text and download bytes                                                                          | PASS   | [results](extra-results.json) |
| 1440: exact pair-1023                                | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8041 JSON characters; page 1440 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 1440: exact lone-high-1023                           | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8046 JSON characters; page 1440 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 1440: exact lone-low-1023                            | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8045 JSON characters; page 1440 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 1440: exact unicode                                  | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 15016 JSON characters; page 1440 px; exact expanded text and download bytes                                                                          | PASS   | [results](extra-results.json) |
| 1440: exact long-key                                 | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 12020 JSON characters; page 1440 px; exact expanded text and download bytes                                                                          | PASS   | [results](extra-results.json) |
| 1440: exact holes-and-nulls                          | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8071 JSON characters; page 1440 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 1440: exact below-bound                              | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 1023 JSON characters; page 1440 px; complete small value, no controls                                                                                | PASS   | [results](extra-results.json) |
| 1440: exact at-bound                                 | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 1024 JSON characters; page 1440 px; complete small value, no controls                                                                                | PASS   | [results](extra-results.json) |
| 1440: exact above-bound                              | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 1025 JSON characters; page 1440 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 1440: full thread exact content, lazy network, bytes | Select current wait; open; expand; download; collapse/close | Exact reconstructed JSON contents; lazy DOM; accepted API property-order difference | 4096-character preview, full 2379185; values equal=true; byte equality=false (accepted property order); new requests 0; keyboard region focused=true | PASS   | [results](extra-results.json) |
| 390: exact controls                                  | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 31216 JSON characters; page 390 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 390: exact pair-1023                                 | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8041 JSON characters; page 390 px; exact expanded text and download bytes                                                                            | PASS   | [results](extra-results.json) |
| 390: exact lone-high-1023                            | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8046 JSON characters; page 390 px; exact expanded text and download bytes                                                                            | PASS   | [results](extra-results.json) |
| 390: exact lone-low-1023                             | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8045 JSON characters; page 390 px; exact expanded text and download bytes                                                                            | PASS   | [results](extra-results.json) |
| 390: exact unicode                                   | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 15016 JSON characters; page 390 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 390: exact long-key                                  | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 12020 JSON characters; page 390 px; exact expanded text and download bytes                                                                           | PASS   | [results](extra-results.json) |
| 390: exact holes-and-nulls                           | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 8071 JSON characters; page 390 px; exact expanded text and download bytes                                                                            | PASS   | [results](extra-results.json) |
| 390: exact below-bound                               | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 1023 JSON characters; page 390 px; complete small value, no controls                                                                                 | PASS   | [results](extra-results.json) |
| 390: exact at-bound                                  | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 1024 JSON characters; page 390 px; complete small value, no controls                                                                                 | PASS   | [results](extra-results.json) |
| 390: exact above-bound                               | Open payload; compare API prefix; expand/download/collapse  | Exact bounded prefix/full content, usable actions and no document overflow          | 1025 JSON characters; page 390 px; exact expanded text and download bytes                                                                            | PASS   | [results](extra-results.json) |
| 390: full thread exact content, lazy network, bytes  | Select current wait; open; expand; download; collapse/close | Exact reconstructed JSON contents; lazy DOM; accepted API property-order difference | 4096-character preview, full 2379185; values equal=true; byte equality=false (accepted property order); new requests 0; keyboard region focused=true | PASS   | [results](extra-results.json) |
| expansion reset reproduction: select A, B, A         | Expand A; select B; return to A                             | Changed value stays collapsed, including return to A                                | expanded A=true, collapsed B=true, restored expansion=false, shown 4097 characters                                                                   | PASS   | [results](extra-results.json) |

Fresh download summary: **24/24 values identical**, **22/22 strict byte comparisons passed**, and **2 known full-thread property-order differences**. Protected raw artifacts and both hashes are linked in the [integrity manifest](download-integrity.json). Raw mirrored files are retained unchanged.

## Native restart and storage

The first process stopped cleanly, then a new Node process reopened the same SQLite directory. The recovered fake reports **0 started / 0 resumed turns**. All fifteen original run/thread/events comparisons match before viewing and after restart; the UI reconstruction and full-thread keyboard region also pass. The original main browser matrix additionally verifies inbound payloads and run results unchanged by viewing. Only the separate live fixtures are deliberately mutated for focus tests.

| System / case               | Steps                                               | Expected                                       | Actual                                                                                                           | Result | Evidence                        |
| --------------------------- | --------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------- |
| inference                   | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| inference /thread           | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| inference /events           | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| mutate                      | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| mutate /thread              | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| mutate /events              | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| decision                    | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| decision /thread            | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| decision /events            | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarA                    | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarA /thread            | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarA /events            | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarB                    | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarB /thread            | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| similarB /events            | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | Before/after SHA-256 equal                                                                                       | PASS   | [results](restart-results.json) |
| UI restart latest marker    | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | {"name":"UI restart latest marker","pass":true,"previewLength":4097}                                             | PASS   | [results](restart-results.json) |
| full thread keyboard region | Stop native process; reopen same store; read API/UI | Same value / correct reconstruction and region | {"name":"full thread keyboard region","pass":true,"focused":true,"tabindex":"0","role":"region","scrollTop":441} | PASS   | [results](restart-results.json) |

[Before restart](before-restart.json), [restart script](restart-check.mjs.txt), [startup log](server-restart.log.txt). The final disposable instance was also stopped; [final stop record](final-stop.json). No directory was deleted; the temp store and executable/output copies remain for orchestrator cleanup.

## Regression tests and previous-code qualification

The maintained tests “starts bounded again when another value is shown, and when the first one returns” and “keeps the keyboard inside the component when a change of value collapses the region” exist and pass in the affected-file run. The first includes unchanged-value re-render preservation, and the second includes large/large, large/small, Tab cleanup and outside focus.

**The previous-code failure is reasoned from the diff, not an executed base test run.** The old component was extracted into [previous source](previous-bounded-value.tsx.txt), leaving production files and Git state alone; [diff](fix-and-regression.diff.txt), [counterfactual analysis](regression-analysis.txt).

On a52299c6, expandedFor remains A across A -> B -> A, so the added 4,097-character-preview assertion receives the full JSON instead. The old code also has no focus transfer or held-text tabindex, so the added Show all-focus and tabindex -1 expectations cannot be satisfied. The candidate jsdom focus regression passes while real Edge still exposes QA-259-R2-01, demonstrating the current browser-evidence limit of that unit test.

## Gates

| Command / check                                                           | Actual                                                            | Result                   | Evidence                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| pnpm build                                                                | exit 0                                                            | PASS                     | [log](build.log.txt)                                      |
| pnpm --filter @graphgoblin/web exec vitest run (seven affected files)     | 67/67 tests, 7/7 files, exit 0; exact file list in log            | PASS                     | [log](focused-tests.log.txt)                              |
| pnpm typecheck                                                            | exit 0                                                            | PASS                     | [log](typecheck.log.txt)                                  |
| pnpm lint                                                                 | exit 0                                                            | PASS                     | [log](lint.log.txt)                                       |
| pnpm check:layers                                                         | exit 0                                                            | PASS                     | [log](layers.log.txt)                                     |
| pnpm check:deps                                                           | exit 0                                                            | PASS                     | [log](deps.log.txt)                                       |
| pnpm check:tokens                                                         | exit 0                                                            | PASS                     | [log](tokens.log.txt)                                     |
| Maintained inspector-large-values Edge spec, custom disposable config     | 4/4, retries 0, exit 0                                            | PASS                     | [log](e2e.log.txt), [config](playwright.config.mjs.txt)   |
| Full web coverage                                                         | Not required this round by the user; not run                      | NOT RUN                  | No coverage percentage or threshold qualification claimed |
| pnpm format:check                                                         | exit 1; 60 style warnings, all in this round's raw JSON artifacts | FAIL (QA artifact style) | [log](format.log.txt); raw bytes preserved                |
| pnpm exec prettier --check (BoundedValue, its test, projections, docs 09) | exit 0; report also formatted separately                          | PASS                     | [log](format-source.log.txt)                              |
| Generated docs / license checks                                           | No schema/route/dependency change by QA                           | NOT APPLICABLE           | This is a QA-only addition                                |

The helper [run-command.mjs.txt](run-command.mjs.txt) records exact commands, exits and durations, and sanitizes paths. No whole-suite retry was performed. An initial copied browser script had a doubled round-2 path and failed before launching; [initial log](browser-path-initial.log.txt) is preserved. Correcting that harness path did not change a product assertion.

## Criteria not established

- The required held small-text focus in a live Edge update remains failed; therefore its intended “Tab from held text” precondition could not be established in the browser. The actual next-Tab behavior is recorded, and the analogous jsdom assertion passes.
- Previous-code unit failures were reasoned rather than executed, as explicitly allowed by this brief.
- No full web coverage, actual screen-reader application, live provider, exhaustive sustained-load benchmark or full #245 feature qualification was attempted. Named regions, accessible Events row payload text and keyboard navigation were exercised in Edge.

# 4. Report path and evidence folder

Report: **docs/qa/2026-10-22-wp-e1-259-qa/round-2/README.md**. Evidence folder: this directory. Every kept artifact is indexed below. Scripts are .mjs.txt; logs are .log.txt; raw download mirrors are .json.txt. Local user paths are stripped. [Round-1 report](../README.md) and all its references remain committed and available.

## Artifact index

- [api-key-metadata.json](api-key-metadata.json)
- [artifact-validation.json](artifact-validation.json)
- [audit-round-one.mjs.txt](audit-round-one.mjs.txt)
- [before-restart.json](before-restart.json)
- [bounded-return-1440.png](bounded-return-1440.png)
- [bounded-return-390.png](bounded-return-390.png)
- [browser-errors.json](browser-errors.json)
- [browser-network.json](browser-network.json)
- [browser-path-initial.log.txt](browser-path-initial.log.txt)
- [browser-results.json](browser-results.json)
- [browser.log.txt](browser.log.txt)
- [browser.mjs.txt](browser.mjs.txt)
- [build.log.txt](build.log.txt)
- [create-fixtures.mjs.txt](create-fixtures.mjs.txt)
- [decision-events-before.json](decision-events-before.json)
- [decision-run-before.json](decision-run-before.json)
- [decision-thread-before.json](decision-thread-before.json)
- [deps.log.txt](deps.log.txt)
- [download-integrity.json](download-integrity.json)
- [e2e.log.txt](e2e.log.txt)
- [event-1440.json](event-1440.json)
- [event-390.json](event-390.json)
- [events-1440.png](events-1440.png)
- [events-390.png](events-390.png)
- [events-before.json](events-before.json)
- [events-row-1440.aria.txt](events-row-1440.aria.txt)
- [events-row-390.aria.txt](events-row-390.aria.txt)
- [exact-above-bound-1440.json](exact-above-bound-1440.json)
- [exact-above-bound-390.json](exact-above-bound-390.json)
- [exact-controls-1440.json](exact-controls-1440.json)
- [exact-controls-390.json](exact-controls-390.json)
- [exact-events.json](exact-events.json)
- [exact-holes-and-nulls-1440.json](exact-holes-and-nulls-1440.json)
- [exact-holes-and-nulls-390.json](exact-holes-and-nulls-390.json)
- [exact-lone-high-1023-1440.json](exact-lone-high-1023-1440.json)
- [exact-lone-high-1023-390.json](exact-lone-high-1023-390.json)
- [exact-lone-low-1023-1440.json](exact-lone-low-1023-1440.json)
- [exact-lone-low-1023-390.json](exact-lone-low-1023-390.json)
- [exact-long-key-1440.json](exact-long-key-1440.json)
- [exact-long-key-390.json](exact-long-key-390.json)
- [exact-pair-1023-1440.json](exact-pair-1023-1440.json)
- [exact-pair-1023-390.json](exact-pair-1023-390.json)
- [exact-unicode-1440.json](exact-unicode-1440.json)
- [exact-unicode-390.json](exact-unicode-390.json)
- [exactness.log.txt](exactness.log.txt)
- [extra-browser.mjs.txt](extra-browser.mjs.txt)
- [extra-results.json](extra-results.json)
- [final-stop.json](final-stop.json)
- [fix-and-regression.diff.txt](fix-and-regression.diff.txt)
- [fixtures.json](fixtures.json)
- [fixtures.log.txt](fixtures.log.txt)
- [focus-and-navigation.mjs.txt](focus-and-navigation.mjs.txt)
- [focus-inside-stages-1440.json](focus-inside-stages-1440.json)
- [focus-inside-stages-390.json](focus-inside-stages-390.json)
- [focus-live-run-ids.json](focus-live-run-ids.json)
- [focus-live-stage-results.json](focus-live-stage-results.json)
- [focus-live-stages.log.txt](focus-live-stages.log.txt)
- [focus-navigation-results.json](focus-navigation-results.json)
- [focus-small-1440-0.png](focus-small-1440-0.png)
- [focus-small-1440-500.png](focus-small-1440-500.png)
- [focus-small-390-0.png](focus-small-390-0.png)
- [focus-small-390-500.png](focus-small-390-500.png)
- [focus-small-repro.json](focus-small-repro.json)
- [focus-small-repro.mjs.txt](focus-small-repro.mjs.txt)
- [focus-small.log.txt](focus-small.log.txt)
- [focus.log.txt](focus.log.txt)
- [focused-tests.log.txt](focused-tests.log.txt)
- [format-source.log.txt](format-source.log.txt)
- [format.log.txt](format.log.txt)
- [inference-events-before.json](inference-events-before.json)
- [inference-run-before.json](inference-run-before.json)
- [inference-thread-before.json](inference-thread-before.json)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [mutate-events-before.json](mutate-events-before.json)
- [mutate-run-before.json](mutate-run-before.json)
- [mutate-thread-before.json](mutate-thread-before.json)
- [native-control.mjs.txt](native-control.mjs.txt)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [prefix-checks.mjs.txt](prefix-checks.mjs.txt)
- [prefix-results.json](prefix-results.json)
- [prefix.log.txt](prefix.log.txt)
- [previous-bounded-value.tsx.txt](previous-bounded-value.tsx.txt)
- [progress-1440.png](progress-1440.png)
- [progress-390.png](progress-390.png)
- [protect-downloads.mjs.txt](protect-downloads.mjs.txt)
- [raw-event-1440.json.txt](raw-event-1440.json.txt)
- [raw-event-390.json.txt](raw-event-390.json.txt)
- [raw-exact-above-bound-1440.json.txt](raw-exact-above-bound-1440.json.txt)
- [raw-exact-above-bound-390.json.txt](raw-exact-above-bound-390.json.txt)
- [raw-exact-controls-1440.json.txt](raw-exact-controls-1440.json.txt)
- [raw-exact-controls-390.json.txt](raw-exact-controls-390.json.txt)
- [raw-exact-holes-and-nulls-1440.json.txt](raw-exact-holes-and-nulls-1440.json.txt)
- [raw-exact-holes-and-nulls-390.json.txt](raw-exact-holes-and-nulls-390.json.txt)
- [raw-exact-lone-high-1023-1440.json.txt](raw-exact-lone-high-1023-1440.json.txt)
- [raw-exact-lone-high-1023-390.json.txt](raw-exact-lone-high-1023-390.json.txt)
- [raw-exact-lone-low-1023-1440.json.txt](raw-exact-lone-low-1023-1440.json.txt)
- [raw-exact-lone-low-1023-390.json.txt](raw-exact-lone-low-1023-390.json.txt)
- [raw-exact-long-key-1440.json.txt](raw-exact-long-key-1440.json.txt)
- [raw-exact-long-key-390.json.txt](raw-exact-long-key-390.json.txt)
- [raw-exact-pair-1023-1440.json.txt](raw-exact-pair-1023-1440.json.txt)
- [raw-exact-pair-1023-390.json.txt](raw-exact-pair-1023-390.json.txt)
- [raw-exact-unicode-1440.json.txt](raw-exact-unicode-1440.json.txt)
- [raw-exact-unicode-390.json.txt](raw-exact-unicode-390.json.txt)
- [raw-result-1440.json.txt](raw-result-1440.json.txt)
- [raw-result-390.json.txt](raw-result-390.json.txt)
- [raw-thread-1440.json.txt](raw-thread-1440.json.txt)
- [raw-thread-390.json.txt](raw-thread-390.json.txt)
- [raw-variables-1440.json.txt](raw-variables-1440.json.txt)
- [raw-variables-390.json.txt](raw-variables-390.json.txt)
- [reasoning-1440.png](reasoning-1440.png)
- [reasoning-390.png](reasoning-390.png)
- [regression-analysis.txt](regression-analysis.txt)
- [reset-expansion-390.png](reset-expansion-390.png)
- [restart-check.mjs.txt](restart-check.mjs.txt)
- [restart-results.json](restart-results.json)
- [restart.log.txt](restart.log.txt)
- [result-1440.json](result-1440.json)
- [result-390.json](result-390.json)
- [round-one-audit.json](round-one-audit.json)
- [run-command.mjs.txt](run-command.mjs.txt)
- [server-restart.log.txt](server-restart.log.txt)
- [server.log.txt](server.log.txt)
- [server.mjs.txt](server.mjs.txt)
- [similarA-events-before.json](similarA-events-before.json)
- [similarA-run-before.json](similarA-run-before.json)
- [similarA-thread-before.json](similarA-thread-before.json)
- [similarB-events-before.json](similarB-events-before.json)
- [similarB-run-before.json](similarB-run-before.json)
- [similarB-thread-before.json](similarB-thread-before.json)
- [thread-1440.json](thread-1440.json)
- [thread-1440.png](thread-1440.png)
- [thread-390.json](thread-390.json)
- [thread-390.png](thread-390.png)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate-artifacts.mjs.txt](validate-artifacts.mjs.txt)
- [variables-1440.json](variables-1440.json)
- [variables-390.json](variables-390.json)

# 5. Observations outside scope

- The round-1 downloads were reformatted after capture: all eight canonical hashes still match, but their raw hashes do not. No file is missing. New raw mirrors protect round-2 byte evidence against formatting.
- Full-thread property order follows replay and is accepted here; no value difference was found.
- The previous round's editor/settings timeout hardening is separate. This round intentionally ran the affected tests without a full coverage rerun.
- No production change, commit, owner-store access or operation on ports 4747/4748 occurred.
