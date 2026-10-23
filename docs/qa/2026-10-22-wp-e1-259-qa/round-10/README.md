# Independent QA, round 10: #259 / PR #382

## 1. Verdict

**PASS** for the requested round-10 scope at **d4096962a46081b132dc6ec35ef114fd205ffc5b**, detached HEAD. **QA-259-R9-01 is fixed at both widths.** The merged Result card bounds the row result and the finish-event fallback, preserves exact downloads, and shows null as a value. The paired reconstruction and 35-event eviction spot checks remain correct. No new in-scope product defect was found.

Main **50e59c686605d1d58d8e65db2b0236cb14b22648** is verified as an ancestor; parents **def254f096a8bb5eca965e596e8664c02eef4f5e / 50e59c686605d1d58d8e65db2b0236cb14b22648** and admission/final head are recorded in [environment.json](environment.json), [final-state.json](final-state.json). Build, **103/103 affected unit tests in six files**, **11/11 maintained Edge tests**, lint/types/layers/deps/tokens and generated-doc checks pass; formatting is recorded below. Full coverage was explicitly waived. This is independent QA evidence for the named revision and bounded scope, not a merge/closure action.

Worked alone, fake-only native execution through mutate nodes, input waits and the fake harness. No production or maintained-test edit, staging, commit, stash/branch operation, GitHub write or directory deletion. Only round-10 QA records were added. Built API/web ran on ports **5720/5721** in disposable store **gg-qa-e1-kPeHcN**, Node **v22.14.0**, installed Edge **155.0.4283.62**, headless, Windows **10.0.26300**. The owned process is stopped and both ports are closed ([shutdown.json](shutdown.json), [finish.log.txt](finish.log.txt)). No owner app/store or live provider was used.

## 2. Defects

No new in-scope product defect. **QA-259-R9-01: fixed**, using the original failure reproduction at **1440 × 900** and **390 × 844**:

1. Admit the 350,000-property run (history above two million characters). In a separate Edge page, intercept only its event stream, preserve seed event 6's /vars patch and append remove /vars/absent-qa. This remains a contract-shaped event with a domain-invalid operation; API storage is unchanged.
2. Select event 6, Tab to **Reconstruct the thread at event 6**, and press Enter once. The event-specific role=alert appears; document.activeElement is now the alert's **DIV container, tabindex -1**, not BODY. The container is verified by element identity and contains the actual alert.
3. Tab reaches **Node progress (0 nodes)**. Shift+Tab from there skips the non-tab-stop alert and reaches timeline event **44 run.waiting ask**. Refocus the container and press Shift+Tab directly: it reaches the same timeline control. Tab forward again skips the container. The container remains tabindex -1; it never becomes a normal Tab stop.
4. A valid event 1 reconstructs and puts focus on Messages. Move backward through the keyboard order to timeline event 6 and select its cached failure: focus remains on that timeline button. The failure hand-off does not steal a keyboard outside the viewer.

Both fault pages record no page/console errors. API thread/events hashes are identical before and after. Evidence: [focus-results.json](focus-results.json), [focus-1440.json](focus-1440.json), [focus-390.json](focus-390.json), [focus.mjs.txt](focus.mjs.txt), [focus.log.txt](focus.log.txt), [failure-alert-1440.png](failure-alert-1440.png), [failure-alert-390.png](failure-alert-390.png). The screenshots show the alert; element identity/Tab destinations come from the JSON records. The oversized controlled responses are manifested in [NOT-KEPT.md](NOT-KEPT.md). Current-source corroboration is [source-context.txt](source-context.txt), [source-context.json](source-context.json), alongside the exact source/test delta [change.diff.txt](change.diff.txt).

The requested-failure alert and both orders of one-activation paired reconstruction still pass. O9-01 is now **#385** and explicitly excluded from this PR/round; it was not re-tested or reclassified here. No product finding is inferred from the QA-helper mistakes documented below.

## 3. Coverage of criteria

Touched systems: ThreadViewer's error hand-off, normal/cached reconstruction readiness and bounded cache; RunInspectorPage's merged Result source selection; BoundedValue's preview/full/keyboard/download semantics; G4 exit evidence and null/absence distinction; API/SQLite fixture composition; affected units and maintained inspector/exit browser specs. Tests use public UI/API/component interfaces and the repository's public RunRepository.update for controlled stored-row fixtures. No private application store, component function or cache map was patched or inspected.

The wide fixture has **350,000 properties**, **6,439,281 initial history characters**, **44 events**. Creation took **29479.9 ms** in the built native API; the run stays at its input wait throughout these spot checks. Each static cache case opens a fresh viewer. [fixture.json](fixture.json), [fixture.mjs.txt](fixture.mjs.txt), [fixture.log.txt](fixture.log.txt) retain admission, sequence/node/patch summaries and hashes. The fixture's later live waits are unused this round; no new live-append claim is made beyond the maintained spec.

Result fixtures are native completed mutate/exit runs, with a 20,000-character single line plus escapes, a control character, Unicode, a surrogate pair, a lone surrogate, nulls and primitive values. A terminal row is altered **only during fixture preparation**, on this temporary instance, through **SqliteRunRepository.update**: clearing result creates the real stored fallback state; a separate row set to null over a large finish-event result checks null precedence. These are declared controlled storage fixtures, not engine-emitted contradictory results. The two normal/null/absent engine outcomes remain native. After preparation, viewing/downloading leaves each run, event list and thread hash unchanged. Exact API run/event bodies, property-presence flags, alterations and selected values: [result-fixtures.json](result-fixtures.json), [result-fixtures.mjs.txt](result-fixtures.mjs.txt), [result-fixtures.log.txt](result-fixtures.log.txt), [server.mjs.txt](server.mjs.txt).

| Requested criterion / negative control | Expected                                                                         | Actual / coverage                                                                                                                                                                      | Evidence                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Failed Reconstruct keyboard            | Alert container takes focus; Tab and Shift+Tab preserve order                    | PASS twice: DIV tabindex -1, then Node progress / timeline 44; cached-failure selection leaves outside keyboard alone                                                                  | [focus-results.json](focus-results.json)                                                                 |
| Native large Result                    | Bounded preview/notice, exact full access, exact download                        | PASS twice: 4,096-character exact prefix plus ellipsis; Show all -> 20,155 chars, bounded named scrolling region; keyboard download 20,159 bytes equals GET run.result                 | [result-large-results.json](result-large-results.json)                                                   |
| Row absent / finish-event fallback     | Same bounds/full/download with row.result absent                                 | PASS twice on a stored row genuinely lacking result: finish event 10 supplies the value; full 20,157 chars, exact download 20,161 bytes                                                | [result-large-results.json](result-large-results.json), [result-fixtures.json](result-fixtures.json)     |
| Native returned null                   | Show literal null as a value                                                     | PASS twice: Result card with null, no large-value control, no no-return summary                                                                                                        | [result-continued-results.json](result-continued-results.json)                                           |
| Null row over non-null finish event    | Null is present and wins; do not use a nullish fallback                          | PASS twice: Result is null despite large event result                                                                                                                                  | [result-continued-results.json](result-continued-results.json)                                           |
| Neither row nor finish result          | No Result card; truthful configured no-return explanation                        | PASS twice: default caller destination receives nothing because Returns is None. This fixture is suppressed, not quiet. Maintained spec independently tests a genuinely quiet exit too | [result-continued-results.json](result-continued-results.json), [playwright.log.txt](playwright.log.txt) |
| Paired replay                          | Started/finished then 31 others; return asks; one activation restores /vars diff | PASS four cases: both orders at both widths. The already-prepared started half needs no additional request in reverse order                                                            | [cache-results.json](cache-results.json)                                                                 |
| Eviction                               | 35 explicit reconstructions, return first asks without unrequested work          | PASS twice: event 7 card remains after 250 ms; Variables absent; no observed long task or sampled replay/preview; recent 41 is immediate                                               | [cache-results.json](cache-results.json)                                                                 |
| One exact download / data preservation | Reconstructed Variables equals API vars; no stored changes                       | PASS twice: 7,827,782 bytes each, SHA-256 b8d4d3d575a5d82f611a4f4e41d60e4283155be4385d976b0b8bbbb3966c39d3                                                                             | [cache-results.json](cache-results.json), [NOT-KEPT.md](NOT-KEPT.md)                                     |

Every completed independent product case:

| System / case                         | Steps / expected                                                                                                                | Actual                                                                                                                                                                                                             | Result | Evidence                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| 1440: paired started-first            | Started/finished in stated order, 31 others, return card and exactly one request restores correct /vars diff                    | One activation -> before {}, after 1025 chars; return 67.5 ms; request 569.8 ms; width 1440/1440                                                                                                                   | PASS   | [cache-results.json](cache-results.json)                       |
| 1440: paired finished-first           | Started/finished in stated order, 31 others, return card and exactly one request restores correct /vars diff                    | One activation -> before {}, after 1025 chars; return 51.8 ms; request 515.3 ms; width 1440/1440                                                                                                                   | PASS   | [cache-results.json](cache-results.json)                       |
| 1440: 35 reconstructions and eviction | Explicitly reconstruct 7–41, return 7 shows a stable card without long task or sampled replay/preview; recent 41 stays prepared | 35 explicit requests; return 7 card 32.2 ms, no long task or sampled replay/serializer; recent 41 76.2 ms                                                                                                          | PASS   | [cache-results.json](cache-results.json)                       |
| 1440: exact Variables download        | Download equals API vars byte for byte and viewing leaves stored thread/events unchanged                                        | 7827782 bytes exact; stored hashes unchanged                                                                                                                                                                       | PASS   | [cache-results.json](cache-results.json)                       |
| 390: paired started-first             | Started/finished in stated order, 31 others, return card and exactly one request restores correct /vars diff                    | One activation -> before {}, after 1025 chars; return 46.8 ms; request 458.9 ms; width 390/390                                                                                                                     | PASS   | [cache-results.json](cache-results.json)                       |
| 390: paired finished-first            | Started/finished in stated order, 31 others, return card and exactly one request restores correct /vars diff                    | One activation -> before {}, after 1025 chars; return 49.3 ms; request 524.4 ms; width 390/390                                                                                                                     | PASS   | [cache-results.json](cache-results.json)                       |
| 390: 35 reconstructions and eviction  | Explicitly reconstruct 7–41, return 7 shows a stable card without long task or sampled replay/preview; recent 41 stays prepared | 35 explicit requests; return 7 card 35.4 ms, no long task or sampled replay/serializer; recent 41 81.8 ms                                                                                                          | PASS   | [cache-results.json](cache-results.json)                       |
| 390: exact Variables download         | Download equals API vars byte for byte and viewing leaves stored thread/events unchanged                                        | 7827782 bytes exact; stored hashes unchanged                                                                                                                                                                       | PASS   | [cache-results.json](cache-results.json)                       |
| 1440: QA-259-R9-01                    | Alert container takes owned focus at tabindex -1; Tab and Shift+Tab skip it; valid recovery and outside keyboard are preserved  | Focused DIV tabindex -1 contains alert; Tab -> Node progress (0 nodes); direct Shift+Tab -> #44run.waitingask waits for input; cached failure leaves #6node.finishedseed → out, 2 changes, 472 ms; recovery passes | PASS   | [focus-results.json](focus-results.json)                       |
| 390: QA-259-R9-01                     | Alert container takes owned focus at tabindex -1; Tab and Shift+Tab skip it; valid recovery and outside keyboard are preserved  | Focused DIV tabindex -1 contains alert; Tab -> Node progress (0 nodes); direct Shift+Tab -> #44run.waitingask waits for input; cached failure leaves #6node.finishedseed → out, 2 changes, 472 ms; recovery passes | PASS   | [focus-results.json](focus-results.json)                       |
| 1440: Result null                     | Result is literal null, including a null row over a non-null finish event                                                       | Result text null; row/event result presence true/true; API hashes unchanged                                                                                                                                        | PASS   | [result-continued-results.json](result-continued-results.json) |
| 1440: Result absent                   | No Result card and truthful configured no-return summary                                                                        | No Result card; No value was returned: Returns is None, so no destination received anything (caller from the exit). This is the exit’s configuration, not a failure.                                               | PASS   | [result-continued-results.json](result-continued-results.json) |
| 1440: Result row-null-precedence      | Result is literal null, including a null row over a non-null finish event                                                       | Result text null; row/event result presence true/true; API hashes unchanged                                                                                                                                        | PASS   | [result-continued-results.json](result-continued-results.json) |
| 390: Result null                      | Result is literal null, including a null row over a non-null finish event                                                       | Result text null; row/event result presence true/true; API hashes unchanged                                                                                                                                        | PASS   | [result-continued-results.json](result-continued-results.json) |
| 390: Result absent                    | No Result card and truthful configured no-return summary                                                                        | No Result card; No value was returned: Returns is None, so no destination received anything (caller from the exit). This is the exit’s configuration, not a failure.                                               | PASS   | [result-continued-results.json](result-continued-results.json) |
| 390: Result row-null-precedence       | Result is literal null, including a null row over a non-null finish event                                                       | Result text null; row/event result presence true/true; API hashes unchanged                                                                                                                                        | PASS   | [result-continued-results.json](result-continued-results.json) |
| 1440: Result native                   | 4096-character exact preview/notice, named full region, Show less, keyboard exact download; timeline remains responsive         | 20155 full chars / 20159 exact bytes; preview 4097; scrolling 2379/538; keyboard names/order correct; timeline 42.7 ms; width 1440/1440                                                                            | PASS   | [result-large-results.json](result-large-results.json)         |
| 1440: Result fallback                 | 4096-character exact preview/notice, named full region, Show less, keyboard exact download; timeline remains responsive         | 20157 full chars / 20161 exact bytes; preview 4097; scrolling 2379/538; keyboard names/order correct; timeline 42.7 ms; width 1440/1440                                                                            | PASS   | [result-large-results.json](result-large-results.json)         |
| 390: Result native                    | 4096-character exact preview/notice, named full region, Show less, keyboard exact download; timeline remains responsive         | 20155 full chars / 20159 exact bytes; preview 4097; scrolling 10122/504; keyboard names/order correct; timeline 60.6 ms; width 390/390                                                                             | PASS   | [result-large-results.json](result-large-results.json)         |
| 390: Result fallback                  | 4096-character exact preview/notice, named full region, Show less, keyboard exact download; timeline remains responsive         | 20157 full chars / 20161 exact bytes; preview 4097; scrolling 10122/504; keyboard names/order correct; timeline 43.0 ms; width 390/390                                                                             | PASS   | [result-large-results.json](result-large-results.json)         |

The merged Result source is verified against the API, not by hiding a field in a browser response. Both large sources provide the same accessible controls: Tab reaches Show all of Result; Enter expands; Shift+Tab enters the named Result pre; PageDown scrolls it; Tab reaches Show less then Download Result as JSON; Enter downloads the exact value. A native CDP click selects timeline event 1 while the Result remains expanded in the DOM; it stays the terminal Result. Returning focus to Show less and pressing Enter restores the exact preview. The collapsed pre has no region role or aria-label; the Result Card section remains a legitimate named region. Width is **1440/1440 or 390/390** in both expanded and collapsed records.

Scroll height/client height is **2,379/538 px** desktop and **10,122/504 px** narrow. The narrow PageDown readings move to **438/440 px** for native/fallback. Full Result values include escaped/control/Unicode data, and their downloaded UTF-8 bytes are compared exactly with the API value under the same two-space JSON formatting. Raw bodies and capture SHA-256 are retained. Narrow screenshots [result-final-native-expanded-390.png](result-final-native-expanded-390.png), [result-final-fallback-expanded-390.png](result-final-fallback-expanded-390.png) and [failure-alert-390.png](failure-alert-390.png) were visually inspected: long values and alert text wrap within the window.

### QA-helper provenance and limitations

The first Result probe reused a readiness helper that waits for run.lastEventSeq. Returned-value fixtures have **run.finished at 10, return.delivered at 11**; the inspector subscription completes at run.finished. Waiting for 11 prevented those Result assertions from running. Its optional no-result assertion also wrongly expected a quiet exit even though the schema's default destination is caller. The initial partial rows and interrupted exec log remain in [result-results.json](result-results.json), [results.mjs.txt](results.mjs.txt), [results.log.txt](results.log.txt). A first inspection attempt hit the same readiness condition and failed before taking observations ([inspect-results.mjs.txt](inspect-results.mjs.txt), [inspect-results.log.txt](inspect-results.log.txt)). Raw-navigation diagnosis then recorded the correct DOM, event sequence and pinned configurations ([diagnose-page.mjs.txt](diagnose-page.mjs.txt), [diagnose-page.log.txt](diagnose-page.log.txt), [page-diagnosis.json](page-diagnosis.json)); its reference-prefix field was for large values only, not a null/absence assertion.

The continuation uses the terminal event as readiness and a fixture-correct Returns is None explanation ([prepare-continuation.mjs.txt](prepare-continuation.mjs.txt), [result-helper-correction.json](result-helper-correction.json), [results-continued.mjs.txt](results-continued.mjs.txt), [results-continued.log.txt](results-continued.log.txt)). Six null/absent/precedence cases passed and were not repeated. The four large cases then completed their functional actions but stopped at an over-broad global region query: it matched the named Result Card, not just the collapsed pre. This is a QA selector error; source/DOM semantics are corroborated in [source-context.txt](source-context.txt). The failed rows remain, and their eight raw download/API bodies compare equal without being changed ([result-capture-verification.json](result-capture-verification.json)).

Only those four incomplete large-case records continued, with the assertion scoped to the pre; final captures have new filenames so prior captures are preserved. [prepare-large-continuation.mjs.txt](prepare-large-continuation.mjs.txt), [result-role-correction.json](result-role-correction.json), [results-large.mjs.txt](results-large.mjs.txt), [results-large.log.txt](results-large.log.txt), [result-large-results.json](result-large-results.json). There was no production change or whole-suite retry. Original partial/invalid attempts are not claimed as passing product tests, and no unsaved timing from them is cited.

| Initial/intermediate case        | QA issue                              | Retained actual                                                                                                                                                 | Evidence                                                       |
| -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1440: Result native              | Initial readiness/fixture description | page.waitForFunction: Timeout 30000ms exceeded.                                                                                                                 | [result-results.json](result-results.json)                     |
| 1440: Result fallback            | Initial readiness/fixture description | page.waitForFunction: Timeout 30000ms exceeded.                                                                                                                 | [result-results.json](result-results.json)                     |
| 1440: Result null                | Initial readiness/fixture description | page.waitForFunction: Timeout 30000ms exceeded.                                                                                                                 | [result-results.json](result-results.json)                     |
| 1440: Result absent              | Initial readiness/fixture description | locator.waitFor: Timeout 30000ms exceeded. Call log: - waiting for getByTestId('exit-returns').filter({ hasText: 'Quiet exit: Returns is None' }) to be visible | [result-results.json](result-results.json)                     |
| 1440: Result row-null-precedence | Initial readiness/fixture description | page.waitForFunction: Timeout 30000ms exceeded.                                                                                                                 | [result-results.json](result-results.json)                     |
| 390: Result native               | Initial readiness/fixture description | page.waitForFunction: Timeout 30000ms exceeded.                                                                                                                 | [result-results.json](result-results.json)                     |
| 390: Result fallback             | Initial readiness/fixture description | page.waitForFunction: Timeout 30000ms exceeded.                                                                                                                 | [result-results.json](result-results.json)                     |
| 1440: Result native              | Intermediate broad region selector    | collapsed Result still named region                                                                                                                             | [result-continued-results.json](result-continued-results.json) |
| 1440: Result fallback            | Intermediate broad region selector    | collapsed Result still named region                                                                                                                             | [result-continued-results.json](result-continued-results.json) |
| 390: Result native               | Intermediate broad region selector    | collapsed Result still named region                                                                                                                             | [result-continued-results.json](result-continued-results.json) |
| 390: Result fallback             | Intermediate broad region selector    | collapsed Result still named region                                                                                                                             | [result-continued-results.json](result-continued-results.json) |

The initial unsuccessful Result-readiness process briefly overlapped the end of the focus process. **Focus request timings are contended observations**, not an isolated latency comparison; the functional focus destinations are still directly recorded. Cache/eviction measurements preceded that overlap. The final four large-Result measurements ran alone after all earlier probes/diagnostics ended. [browser-environment.json](browser-environment.json) records this qualification. All gates and fixture creation had finished before browser timings; unrelated host activity was uncontrolled.

Timing method: standard **≥50 ms long tasks**, action to two animation frames after the expected public DOM; CDP input for cache selection and final timeline clicks, keyboard input for Result controls. Wall times include automation/scheduling/native/API work and are not INP or a hardware-independent SLA. Evicted selections also have 1 ms CPU sampling and retained Paint/state evidence; zero samples is reported as zero sampled work, not a mathematical proof about an offscreen frame. No below-fold card is claimed to be visible in that earlier paint. Initial page loading/fixture creation is outside selection windows.

Evicted first returns: **32.2/35.4 ms** desktop/narrow, no long tasks and zero sampled replay/serializer work. Recent returns: **76.2/81.8 ms**, no long task. Final large-Result Show all: **23.6–49.7 ms**; timeline selection while expanded: **42.7–60.6 ms**; Show less: **18.3–27.8 ms**. Those Result control windows contain **no long tasks**. Explicit wide reconstruction/failure still pays the reported on-request work; focus request walls **558.5/565.1 ms**, tasks **523/539 ms**, have the contention qualification above.

Every other recorded operation and every observed long task:

| Operation                                       | Wall ms | Every long task ms | Evidence                                               |
| ----------------------------------------------- | ------: | ------------------ | ------------------------------------------------------ |
| 1440: paired started-first / selected           |    67.5 | none               | [cache-results.json](cache-results.json)               |
| 1440: paired started-first / requested          |   569.8 | 517                | [cache-results.json](cache-results.json)               |
| 1440: paired finished-first / selected          |    51.8 | none               | [cache-results.json](cache-results.json)               |
| 1440: paired finished-first / requested         |   515.3 | 464                | [cache-results.json](cache-results.json)               |
| 1440: 35 reconstructions and eviction / evicted |    32.2 | none               | [cache-results.json](cache-results.json)               |
| 1440: 35 reconstructions and eviction / recent  |    76.2 | none               | [cache-results.json](cache-results.json)               |
| 390: paired started-first / selected            |    46.8 | none               | [cache-results.json](cache-results.json)               |
| 390: paired started-first / requested           |   458.9 | 383                | [cache-results.json](cache-results.json)               |
| 390: paired finished-first / selected           |    49.3 | none               | [cache-results.json](cache-results.json)               |
| 390: paired finished-first / requested          |   524.4 | 429                | [cache-results.json](cache-results.json)               |
| 390: 35 reconstructions and eviction / evicted  |    35.4 | none               | [cache-results.json](cache-results.json)               |
| 390: 35 reconstructions and eviction / recent   |    81.8 | none               | [cache-results.json](cache-results.json)               |
| 1440: QA-259-R9-01 / requested                  |   558.5 | 523                | [focus-results.json](focus-results.json)               |
| 390: QA-259-R9-01 / requested                   |   565.1 | 539                | [focus-results.json](focus-results.json)               |
| 1440: Result native / showAll                   |    49.7 | none               | [result-large-results.json](result-large-results.json) |
| 1440: Result native / scroll                    |    28.6 | none               | [result-large-results.json](result-large-results.json) |
| 1440: Result native / selection                 |    42.7 | none               | [result-large-results.json](result-large-results.json) |
| 1440: Result native / showLess                  |    18.5 | none               | [result-large-results.json](result-large-results.json) |
| 1440: Result fallback / showAll                 |    28.1 | none               | [result-large-results.json](result-large-results.json) |
| 1440: Result fallback / scroll                  |    40.0 | none               | [result-large-results.json](result-large-results.json) |
| 1440: Result fallback / selection               |    42.7 | none               | [result-large-results.json](result-large-results.json) |
| 1440: Result fallback / showLess                |    18.3 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result native / showAll                    |    23.6 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result native / scroll                     |    27.1 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result native / selection                  |    60.6 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result native / showLess                   |    24.9 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result fallback / showAll                  |    24.6 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result fallback / scroll                   |    29.0 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result fallback / selection                |    43.0 | none               | [result-large-results.json](result-large-results.json) |
| 390: Result fallback / showLess                 |    27.8 | none               | [result-large-results.json](result-large-results.json) |

All cache preparations and 35-event spot measurements:

| Width / fixture / event    | Select wall ms | Every select long task ms | Requests | Request wall ms | Every request long task ms | Evidence                                                                               |
| -------------------------- | -------------: | ------------------------- | -------: | --------------: | -------------------------- | -------------------------------------------------------------------------------------- |
| 1440 / 35-event spot / 7   |           16.5 | none                      |        1 |           488.9 | 430                        | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 8   |           19.8 | none                      |        1 |            49.2 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 9   |           21.5 | none                      |        1 |            51.1 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 10  |           18.9 | none                      |        1 |            54.6 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 11  |           20.2 | none                      |        1 |            50.9 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 12  |           20.9 | none                      |        1 |            46.9 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 13  |           20.8 | none                      |        1 |            51.3 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 14  |           19.6 | none                      |        1 |            51.4 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 15  |           19.0 | none                      |        1 |            50.7 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 16  |           21.4 | none                      |        1 |            48.3 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 17  |           18.1 | none                      |        1 |            49.0 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 18  |           22.2 | none                      |        1 |            51.1 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 19  |           19.4 | none                      |        1 |            51.3 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 20  |           21.1 | none                      |        1 |            48.6 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 21  |           20.4 | none                      |        1 |            49.4 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 22  |           20.5 | none                      |        1 |            49.6 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 23  |           19.0 | none                      |        1 |            48.2 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 24  |           18.2 | none                      |        1 |            51.0 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 25  |           26.6 | none                      |        1 |            49.8 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 26  |           21.2 | none                      |        1 |            55.8 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 27  |           26.8 | none                      |        1 |            50.5 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 28  |           21.4 | none                      |        1 |            48.6 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 29  |           20.2 | none                      |        1 |            51.0 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 30  |           20.7 | none                      |        1 |            50.2 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 31  |           22.0 | none                      |        1 |            50.8 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 32  |           22.1 | none                      |        1 |            51.4 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 33  |           21.8 | none                      |        1 |            49.9 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 34  |           21.5 | none                      |        1 |            51.8 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 35  |           21.0 | none                      |        1 |            51.8 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 36  |           21.1 | none                      |        1 |            50.2 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 37  |           21.2 | none                      |        1 |            55.7 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 38  |           19.2 | none                      |        1 |            62.4 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 39  |           18.7 | none                      |        1 |            49.7 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 40  |           26.3 | none                      |        1 |            50.2 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / 35-event spot / 41  |           19.5 | none                      |        1 |            58.1 | none                       | [explicit-events-1440.json](explicit-events-1440.json)                                 |
| 1440 / started-first / 5   |           18.8 | none                      |        1 |            50.0 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 6   |           20.5 | none                      |        1 |           547.3 | 482                        | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 7   |           21.1 | none                      |        1 |            51.8 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 8   |           20.6 | none                      |        1 |            51.3 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 9   |           20.8 | none                      |        1 |            49.4 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 10  |           22.4 | none                      |        1 |            51.4 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 11  |           19.4 | none                      |        1 |            55.6 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 12  |           21.4 | none                      |        1 |            49.7 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 13  |           21.5 | none                      |        1 |            51.9 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 14  |           21.2 | none                      |        1 |            51.0 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 15  |           21.6 | none                      |        1 |            50.2 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 16  |           21.4 | none                      |        1 |            49.3 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 17  |           15.7 | none                      |        1 |            49.8 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 18  |           22.4 | none                      |        1 |            52.5 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 19  |           21.1 | none                      |        1 |            49.0 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 20  |           20.8 | none                      |        1 |            48.7 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 21  |           21.1 | none                      |        1 |            50.0 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 22  |           23.1 | none                      |        1 |            49.1 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 23  |           22.0 | none                      |        1 |            52.7 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 24  |           20.7 | none                      |        1 |            50.6 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 25  |           33.8 | none                      |        1 |            49.3 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 26  |           21.2 | none                      |        1 |            49.1 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 27  |           18.6 | none                      |        1 |            50.1 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 28  |           20.6 | none                      |        1 |            47.4 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 29  |           20.3 | none                      |        1 |            51.5 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 30  |           25.7 | none                      |        1 |            48.9 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 31  |           21.7 | none                      |        1 |            51.9 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 32  |           20.4 | none                      |        1 |            51.3 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 33  |           21.5 | none                      |        1 |            50.6 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 34  |           21.6 | none                      |        1 |            48.2 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 35  |           22.0 | none                      |        1 |            67.2 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 36  |           19.6 | none                      |        1 |            55.6 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / started-first / 37  |           17.8 | none                      |        1 |            50.8 | none                       | [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)   |
| 1440 / finished-first / 6  |           21.3 | none                      |        1 |           462.0 | 416                        | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 5  |           29.1 | none                      |        0 |   already shown | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 7  |           21.6 | none                      |        1 |            53.4 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 8  |           20.2 | none                      |        1 |            51.6 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 9  |           27.5 | none                      |        1 |            50.5 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 10 |           21.6 | none                      |        1 |            51.7 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 11 |           21.5 | none                      |        1 |            50.7 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 12 |           21.7 | none                      |        1 |            49.3 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 13 |           20.0 | none                      |        1 |            50.5 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 14 |           18.2 | none                      |        1 |            49.4 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 15 |           21.2 | none                      |        1 |            51.9 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 16 |           21.3 | none                      |        1 |            51.1 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 17 |           22.0 | none                      |        1 |            50.9 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 18 |           21.9 | none                      |        1 |            47.2 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 19 |           20.7 | none                      |        1 |            50.8 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 20 |           20.8 | none                      |        1 |            51.4 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 21 |           22.5 | none                      |        1 |            50.4 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 22 |           20.9 | none                      |        1 |            49.2 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 23 |           19.3 | none                      |        1 |            50.6 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 24 |           22.1 | none                      |        1 |            51.7 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 25 |           20.9 | none                      |        1 |            82.1 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 26 |           20.8 | none                      |        1 |            50.3 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 27 |           18.0 | none                      |        1 |            50.3 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 28 |           19.6 | none                      |        1 |            57.6 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 29 |           18.9 | none                      |        1 |            50.3 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 30 |           22.0 | none                      |        1 |            57.1 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 31 |           20.4 | none                      |        1 |            55.8 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 32 |           20.9 | none                      |        1 |            50.5 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 33 |           23.4 | none                      |        1 |            52.0 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 34 |           20.7 | none                      |        1 |            51.4 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 35 |           19.0 | none                      |        1 |            51.3 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 36 |           20.3 | none                      |        1 |            50.9 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 1440 / finished-first / 37 |           21.3 | none                      |        1 |            49.7 | none                       | [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json) |
| 390 / 35-event spot / 7    |           19.3 | none                      |        1 |           467.6 | 420                        | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 8    |           20.0 | none                      |        1 |            49.4 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 9    |           19.4 | none                      |        1 |            48.8 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 10   |           22.5 | none                      |        1 |            51.5 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 11   |           22.3 | none                      |        1 |            49.5 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 12   |           28.3 | none                      |        1 |            52.5 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 13   |           21.8 | none                      |        1 |            40.8 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 14   |           22.4 | none                      |        1 |            52.4 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 15   |           19.8 | none                      |        1 |            50.2 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 16   |           21.0 | none                      |        1 |            51.0 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 17   |           20.6 | none                      |        1 |            49.3 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 18   |           21.1 | none                      |        1 |            51.4 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 19   |           17.7 | none                      |        1 |            50.4 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 20   |           21.6 | none                      |        1 |            48.8 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 21   |           21.5 | none                      |        1 |            50.8 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 22   |           18.6 | none                      |        1 |            49.0 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 23   |           17.9 | none                      |        1 |            50.2 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 24   |           19.1 | none                      |        1 |            65.9 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 25   |           21.2 | none                      |        1 |            41.4 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 26   |           20.6 | none                      |        1 |            58.9 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 27   |           18.7 | none                      |        1 |            51.4 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 28   |           21.3 | none                      |        1 |            51.7 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 29   |           19.9 | none                      |        1 |            51.0 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 30   |           26.7 | none                      |        1 |            59.1 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 31   |           19.9 | none                      |        1 |            55.2 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 32   |           20.8 | none                      |        1 |            50.2 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 33   |           19.8 | none                      |        1 |            51.7 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 34   |           19.2 | none                      |        1 |            51.0 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 35   |           21.7 | none                      |        1 |            49.8 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 36   |           19.1 | none                      |        1 |            76.4 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 37   |           20.5 | none                      |        1 |            50.7 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 38   |           18.0 | none                      |        1 |            66.6 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 39   |           19.2 | none                      |        1 |            50.5 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 40   |           21.1 | none                      |        1 |            49.2 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / 35-event spot / 41   |           22.2 | none                      |        1 |            51.3 | none                       | [explicit-events-390.json](explicit-events-390.json)                                   |
| 390 / started-first / 5    |           20.8 | none                      |        1 |            48.7 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 6    |           18.9 | none                      |        1 |           551.9 | 502                        | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 7    |           27.0 | none                      |        1 |            46.5 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 8    |           17.2 | none                      |        1 |            50.0 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 9    |           19.4 | none                      |        1 |            47.9 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 10   |           20.1 | none                      |        1 |            48.8 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 11   |           19.8 | none                      |        1 |            49.7 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 12   |           19.9 | none                      |        1 |            56.6 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 13   |           20.0 | none                      |        1 |            51.0 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 14   |           22.8 | none                      |        1 |            45.8 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 15   |           27.8 | none                      |        1 |            49.4 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 16   |           20.9 | none                      |        1 |            51.1 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 17   |           21.9 | none                      |        1 |            55.1 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 18   |           24.4 | none                      |        1 |            79.7 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 19   |           19.4 | none                      |        1 |            55.5 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 20   |           19.4 | none                      |        1 |            49.6 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 21   |           20.9 | none                      |        1 |            56.1 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 22   |           21.6 | none                      |        1 |            66.3 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 23   |           22.4 | none                      |        1 |            51.1 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 24   |           20.7 | none                      |        1 |            50.3 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 25   |           22.0 | none                      |        1 |            69.3 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 26   |           19.2 | none                      |        1 |            48.4 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 27   |           22.0 | none                      |        1 |            50.7 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 28   |           31.1 | none                      |        1 |            51.8 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 29   |           17.2 | none                      |        1 |            51.0 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 30   |           22.1 | none                      |        1 |            50.4 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 31   |           21.6 | none                      |        1 |            62.1 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 32   |           21.0 | none                      |        1 |            51.9 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 33   |           18.9 | none                      |        1 |            50.5 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 34   |           23.1 | none                      |        1 |            50.1 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 35   |           20.9 | none                      |        1 |            52.4 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 36   |           22.1 | none                      |        1 |            50.8 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / started-first / 37   |           27.4 | none                      |        1 |            50.3 | none                       | [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)     |
| 390 / finished-first / 6   |           24.8 | none                      |        1 |           483.9 | 436                        | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 5   |           21.6 | none                      |        0 |   already shown | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 7   |           19.5 | none                      |        1 |            47.7 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 8   |           21.5 | none                      |        1 |            53.1 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 9   |           20.8 | none                      |        1 |            50.7 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 10  |           22.0 | none                      |        1 |            48.8 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 11  |           20.5 | none                      |        1 |            48.3 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 12  |           19.3 | none                      |        1 |            49.2 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 13  |           22.2 | none                      |        1 |            49.8 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 14  |           20.9 | none                      |        1 |            51.4 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 15  |           21.9 | none                      |        1 |            43.2 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 16  |           21.3 | none                      |        1 |            49.7 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 17  |           22.4 | none                      |        1 |            42.7 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 18  |           22.2 | none                      |        1 |            50.2 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 19  |           21.0 | none                      |        1 |            51.4 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 20  |           22.1 | none                      |        1 |            51.6 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 21  |           22.1 | none                      |        1 |            51.9 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 22  |           21.6 | none                      |        1 |            51.5 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 23  |           21.9 | none                      |        1 |            50.7 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 24  |           22.6 | none                      |        1 |            48.9 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 25  |           22.2 | none                      |        1 |            50.0 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 26  |           22.5 | none                      |        1 |            50.5 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 27  |           20.9 | none                      |        1 |            50.3 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 28  |           21.7 | none                      |        1 |            48.8 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 29  |           21.1 | none                      |        1 |            50.8 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 30  |           21.6 | none                      |        1 |            50.8 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 31  |           20.6 | none                      |        1 |            50.7 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 32  |           20.6 | none                      |        1 |            51.0 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 33  |           21.9 | none                      |        1 |            53.1 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 34  |           21.8 | none                      |        1 |            49.5 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 35  |           23.6 | none                      |        1 |            52.1 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 36  |           21.6 | none                      |        1 |            51.1 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |
| 390 / finished-first / 37  |           22.8 | none                      |        1 |            51.5 | none                       | [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)   |

Six primary exact download comparisons pass: two Variables, four final Result. Four earlier Result body pairs are retained and separately verified as supplemental byte comparisons, not additional acceptance cases. All viewing-only snapshots preserve run/thread/events. The four oversized Variables bodies and two oversized controlled streams follow D-034 in [NOT-KEPT.md](NOT-KEPT.md) / [not-kept.json](not-kept.json); all kept artifacts are under 1,000,000 bytes. Raw JSON and script bytes are preserved; only this round's Markdown is formatted, following the merged evidence rule.

Gates, exact commands, Node 22:

| Command                                                                                                                                                                                                                                                                                              | Result | Evidence                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| pnpm.cmd build                                                                                                                                                                                                                                                                                       | PASS   | [build.log.txt](build.log.txt)           |
| pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/inspector/ThreadViewer.test.tsx src/runs/projections.test.ts src/runs/RunInspectorPage.test.tsx src/runs/inspector/EvaluationDetails.test.tsx src/components/ui/bounded-value.test.tsx src/components/ui/bounded-value.deferred.test.tsx | PASS   | [web-units.log.txt](web-units.log.txt)   |
| pnpm.cmd lint                                                                                                                                                                                                                                                                                        | PASS   | [lint.log.txt](lint.log.txt)             |
| pnpm.cmd typecheck                                                                                                                                                                                                                                                                                   | PASS   | [typecheck.log.txt](typecheck.log.txt)   |
| pnpm.cmd --filter @graphgoblin/web exec playwright test --config %TEMP%\gg-qa-e1-r10-playwright.config.mjs                                                                                                                                                                                           | PASS   | [playwright.log.txt](playwright.log.txt) |
| pnpm.cmd check:layers                                                                                                                                                                                                                                                                                | PASS   | [layers.log.txt](layers.log.txt)         |
| pnpm.cmd check:deps                                                                                                                                                                                                                                                                                  | PASS   | [deps.log.txt](deps.log.txt)             |
| pnpm.cmd check:tokens                                                                                                                                                                                                                                                                                | PASS   | [tokens.log.txt](tokens.log.txt)         |
| pnpm.cmd check:docs                                                                                                                                                                                                                                                                                  | PASS   | [docs.log.txt](docs.log.txt)             |
| pnpm.cmd format:check                                                                                                                                                                                                                                                                                | PASS   | [format.log.txt](format.log.txt)         |

Affected units: **103/103**, ThreadViewer, projections, RunInspectorPage, EvaluationDetails, BoundedValue and deferred preview. The new failure-alert focus regression exists and passes; no old-head scratch regression execution was done in this round. Prior failing browser evidence is preserved, and current built-app reproduction establishes the fix. Maintained Edge: **11/11**, inspector-large-values.spec.ts and exit-primitives.spec.ts, one worker, retries **0**. The latter covers gate/exit Result evidence, suppressed/quiet None and a long route label after the merge. Generated-doc check was included because the merged contracts/API metadata changed. Dependency manifests did not change, so licence checking was not required/run. Full package coverage was explicitly waived; no percentage, changed threshold or exclusion is claimed.

Not repeated in this bounded round: the full rounds 1–9 surface/adversarial matrix, #385, all Events pages, 6,000-message window/download, full-thread property order, actual screen-reader speech, native restart/session matrix, live providers, WP-F2b authoring beyond compilation/gates and these adjacent specs, or all-package coverage. All requested round-10 product criteria are tested and passed.

## 4. Report path and evidence folder

Report: docs/qa/2026-10-22-wp-e1-259-qa/round-10/README.md. All kept evidence is in this same folder, linked below. [validation.json](validation.json) / [validation.log.txt](validation.log.txt) audit links, local paths, sizes, hashes, completed cases, invalid-helper classification and gate results.

Prior evidence: **1026 references**, **0 unaccounted missing**, **64 oversized manifest entries**; the 44 still-local round-4/5 raw bodies match their manifests, and 20 round-6/7/8/9 bodies are absent as manifested. No expected kept artifact is missing. Rounds 8 and 9 are now tracked, resolving the previous handoff discrepancy; referenced untracked prior artifacts: **0**. No prior hash changed ([prior-evidence-audit.json](prior-evidence-audit.json), [final-state.json](final-state.json)). Existing oversized untracked bodies were left alone.

- [NOT-KEPT.md](NOT-KEPT.md)
- [browser-environment.json](browser-environment.json)
- [browser-environment.log.txt](browser-environment.log.txt)
- [browser-environment.mjs.txt](browser-environment.mjs.txt)
- [browser-support.mjs.txt](browser-support.mjs.txt)
- [build.log.txt](build.log.txt)
- [cache-errors.json](cache-errors.json)
- [cache-results.json](cache-results.json)
- [cache.log.txt](cache.log.txt)
- [cache.mjs.txt](cache.mjs.txt)
- [change.diff.txt](change.diff.txt)
- [deps.log.txt](deps.log.txt)
- [diagnose-absent.png](diagnose-absent.png)
- [diagnose-fallback.png](diagnose-fallback.png)
- [diagnose-native.png](diagnose-native.png)
- [diagnose-null.png](diagnose-null.png)
- [diagnose-page.log.txt](diagnose-page.log.txt)
- [diagnose-page.mjs.txt](diagnose-page.mjs.txt)
- [diagnose-row-null-precedence.png](diagnose-row-null-precedence.png)
- [diagnosis-errors.json](diagnosis-errors.json)
- [docs.log.txt](docs.log.txt)
- [environment.json](environment.json)
- [evicted-selection-1440-frame-0.png](evicted-selection-1440-frame-0.png)
- [evicted-selection-1440-frame-1.png](evicted-selection-1440-frame-1.png)
- [evicted-selection-1440-frame-25.png](evicted-selection-1440-frame-25.png)
- [evicted-selection-1440.cpuprofile.json.txt](evicted-selection-1440.cpuprofile.json.txt)
- [evicted-selection-1440.json](evicted-selection-1440.json)
- [evicted-selection-1440.trace-evidence.json.txt](evicted-selection-1440.trace-evidence.json.txt)
- [evicted-selection-390-frame-0.png](evicted-selection-390-frame-0.png)
- [evicted-selection-390-frame-13.png](evicted-selection-390-frame-13.png)
- [evicted-selection-390-frame-14.png](evicted-selection-390-frame-14.png)
- [evicted-selection-390-frame-39.png](evicted-selection-390-frame-39.png)
- [evicted-selection-390.cpuprofile.json.txt](evicted-selection-390.cpuprofile.json.txt)
- [evicted-selection-390.json](evicted-selection-390.json)
- [evicted-selection-390.trace-evidence.json.txt](evicted-selection-390.trace-evidence.json.txt)
- [explicit-events-1440.json](explicit-events-1440.json)
- [explicit-events-390.json](explicit-events-390.json)
- [failure-alert-1440.png](failure-alert-1440.png)
- [failure-alert-390.png](failure-alert-390.png)
- [final-state.json](final-state.json)
- [finish.log.txt](finish.log.txt)
- [finish.mjs.txt](finish.mjs.txt)
- [fixture.json](fixture.json)
- [fixture.log.txt](fixture.log.txt)
- [fixture.mjs.txt](fixture.mjs.txt)
- [focus-1440.json](focus-1440.json)
- [focus-390.json](focus-390.json)
- [focus-results.json](focus-results.json)
- [focus.log.txt](focus.log.txt)
- [focus.mjs.txt](focus.mjs.txt)
- [format-qa.log.txt](format-qa.log.txt)
- [format.log.txt](format.log.txt)
- [inspect-results.log.txt](inspect-results.log.txt)
- [inspect-results.mjs.txt](inspect-results.mjs.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [make-report.mjs.txt](make-report.mjs.txt)
- [merge-files.txt](merge-files.txt)
- [not-kept.json](not-kept.json)
- [page-diagnosis.json](page-diagnosis.json)
- [pair-preparation-finished-first-1440.json](pair-preparation-finished-first-1440.json)
- [pair-preparation-finished-first-390.json](pair-preparation-finished-first-390.json)
- [pair-preparation-started-first-1440.json](pair-preparation-started-first-1440.json)
- [pair-preparation-started-first-390.json](pair-preparation-started-first-390.json)
- [paired-finished-first-1440.png](paired-finished-first-1440.png)
- [paired-finished-first-390.png](paired-finished-first-390.png)
- [paired-started-first-1440.png](paired-started-first-1440.png)
- [paired-started-first-390.png](paired-started-first-390.png)
- [playwright.config.mjs.txt](playwright.config.mjs.txt)
- [playwright.log.txt](playwright.log.txt)
- [prepare-continuation.log.txt](prepare-continuation.log.txt)
- [prepare-continuation.mjs.txt](prepare-continuation.mjs.txt)
- [prepare-large-continuation.log.txt](prepare-large-continuation.log.txt)
- [prepare-large-continuation.mjs.txt](prepare-large-continuation.mjs.txt)
- [prior-evidence-audit.json](prior-evidence-audit.json)
- [report.log.txt](report.log.txt)
- [result-absent-events-api.json.txt](result-absent-events-api.json.txt)
- [result-absent-run-api.json.txt](result-absent-run-api.json.txt)
- [result-capture-verification.json](result-capture-verification.json)
- [result-continued-errors.json](result-continued-errors.json)
- [result-continued-results.json](result-continued-results.json)
- [result-fallback-api-1440.json.txt](result-fallback-api-1440.json.txt)
- [result-fallback-api-390.json.txt](result-fallback-api-390.json.txt)
- [result-fallback-download-1440.json.txt](result-fallback-download-1440.json.txt)
- [result-fallback-download-390.json.txt](result-fallback-download-390.json.txt)
- [result-fallback-events-api.json.txt](result-fallback-events-api.json.txt)
- [result-fallback-expanded-1440.png](result-fallback-expanded-1440.png)
- [result-fallback-expanded-390.png](result-fallback-expanded-390.png)
- [result-fallback-run-api.json.txt](result-fallback-run-api.json.txt)
- [result-final-fallback-api-1440.json.txt](result-final-fallback-api-1440.json.txt)
- [result-final-fallback-api-390.json.txt](result-final-fallback-api-390.json.txt)
- [result-final-fallback-download-1440.json.txt](result-final-fallback-download-1440.json.txt)
- [result-final-fallback-download-390.json.txt](result-final-fallback-download-390.json.txt)
- [result-final-fallback-expanded-1440.png](result-final-fallback-expanded-1440.png)
- [result-final-fallback-expanded-390.png](result-final-fallback-expanded-390.png)
- [result-final-native-api-1440.json.txt](result-final-native-api-1440.json.txt)
- [result-final-native-api-390.json.txt](result-final-native-api-390.json.txt)
- [result-final-native-download-1440.json.txt](result-final-native-download-1440.json.txt)
- [result-final-native-download-390.json.txt](result-final-native-download-390.json.txt)
- [result-final-native-expanded-1440.png](result-final-native-expanded-1440.png)
- [result-final-native-expanded-390.png](result-final-native-expanded-390.png)
- [result-fixtures.json](result-fixtures.json)
- [result-fixtures.log.txt](result-fixtures.log.txt)
- [result-fixtures.mjs.txt](result-fixtures.mjs.txt)
- [result-helper-correction.json](result-helper-correction.json)
- [result-large-errors.json](result-large-errors.json)
- [result-large-results.json](result-large-results.json)
- [result-native-api-1440.json.txt](result-native-api-1440.json.txt)
- [result-native-api-390.json.txt](result-native-api-390.json.txt)
- [result-native-download-1440.json.txt](result-native-download-1440.json.txt)
- [result-native-download-390.json.txt](result-native-download-390.json.txt)
- [result-native-events-api.json.txt](result-native-events-api.json.txt)
- [result-native-expanded-1440.png](result-native-expanded-1440.png)
- [result-native-expanded-390.png](result-native-expanded-390.png)
- [result-native-run-api.json.txt](result-native-run-api.json.txt)
- [result-null-events-api.json.txt](result-null-events-api.json.txt)
- [result-null-run-api.json.txt](result-null-run-api.json.txt)
- [result-results.json](result-results.json)
- [result-role-correction.json](result-role-correction.json)
- [result-row-null-precedence-events-api.json.txt](result-row-null-precedence-events-api.json.txt)
- [result-row-null-precedence-run-api.json.txt](result-row-null-precedence-run-api.json.txt)
- [results-continued.log.txt](results-continued.log.txt)
- [results-continued.mjs.txt](results-continued.mjs.txt)
- [results-large.log.txt](results-large.log.txt)
- [results-large.mjs.txt](results-large.mjs.txt)
- [results.log.txt](results.log.txt)
- [results.mjs.txt](results.mjs.txt)
- [run-command.mjs.txt](run-command.mjs.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown.json](shutdown.json)
- [source-context.json](source-context.json)
- [source-context.log.txt](source-context.log.txt)
- [source-context.mjs.txt](source-context.mjs.txt)
- [source-context.txt](source-context.txt)
- [source-map-provenance.json](source-map-provenance.json)
- [support.mjs.txt](support.mjs.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [validate.mjs.txt](validate.mjs.txt)
- [validation.json](validation.json)
- [validation.log.txt](validation.log.txt)
- [web-units.log.txt](web-units.log.txt)

## 5. Observations outside scope

No new outside-scope product defect was recorded. O9-01 is filed as **#385**, explicitly excluded and not re-opened. The completed-row fixture alterations and terminal-readiness/region-selector corrections are QA provenance, not product changes or hidden stored-data repair. The earlier tracking discrepancy is resolved on this head. Temporary stores, scripts/raw oversized captures and maintained-spec output remain for the orchestrator; no directory was deleted. Both owned ports are closed, tracked/staged diffs are empty, prior evidence is preserved, and no commit was made.
