# Final affected QA for #386 / #385 at 8632538

**PASS for the assigned finite affected-QA scope** at `8632538fea2c95c3a528ef91ddbaefebf3d3bfba`, tree `0ac0f5afd77d3a418784082398d94c00e7c07375`. All **36 distinct public-component criteria are bound to unchanged runtime inputs**, and **all six built-browser criteria passed on this candidate**, each on its first current-candidate execution with retries zero. Final web types, five-file scoped QA lint and a fresh web build passed. This report does not approve the remaining root-owned coverage, review, CI, publication or merge gates.

## Exact source and component binding

The 6,930-byte candidate receipt SHA-256 is `2a0f2c81528b8110922f3c719a4668cf38681df8eff3efb2403745269af9fed5`. All 25 supplied files matched literal candidate copies and Git blobs. The final commit changes exactly seven supporting test/doc paths from parent `3168250645fe37bced7ace6a664c82fd137b1196`; production and both protected browser fixtures are unchanged.

The binding independently checked **1,520 tracked source/input files** in the owned checkout against D228 before applying the support overlay, then against final Git bytes afterwards. This includes **820 runtime, configuration and fixture inputs**, all unchanged between D228 and this candidate; **809 also match the supplied signed-base commit by blob identity**. Scope includes web/API source and browser harness, package sources/exports/configuration, shared tooling, scripts, patches and named root configuration/lockfiles. Thus inherited FakeApi, render/setup fixtures, imported contracts/domain/API-client/engine/infrastructure and test configuration remain the same inputs. The 81-member D228 diagnostic seal was also reverified. See `component-runtime-input-binding.json` and the post-build/post-browser source snapshots.

Root explicitly authorized carrying forward the executed component evidence rather than rerunning unchanged cases. Its accounting remains **35 passed / 1 fixture precondition failed in the initial 36-case invocation**, followed by **one corrected R2-2 case passed in a scoped invocation**, with four others unselected. The initial invocation remains failed; this is not a single 36-case green run. The exact QA correction changes only the import and parse identifier from RunRecordSchema to RunSnapshotSchema, because legitimate GET detail includes recovery. All foreign-ID/status/sequence/node mutation and desired assertions remain unchanged. Original source, raw failure, actual validation-error capture and scoped closure remain sealed under `../d228-diagnostic-01/`. `bound-d228-case-summary.json` preserves its original source metadata; the separate binding connects it to this final head.

## Positive and negative component criteria

All rows below pass only within the specifically controlled public-component schedules, using the whole inspector/router/providers, actual API client and QueryClient with FakeApi/SSE responses in jsdom.

| Criteria | Established behavior |
| --- | --- |
| R1 predecessor ordering and duplicate/foreign lifecycle negatives | Observation first, stream first and delayed predecessor terminal do not revive the prior attempt after resume. Compatible parked waiting reads settle; duplicate/foreign evidence stays scoped. |
| R2 successive same-status outcomes and node attribution | An older row cannot establish the latest terminal node. A current terminal label appears independently, and an agreeing authorized row qualifies its node as **Last node in run record**. |
| R3 navigation and buffered cleanup | A → B → A preserves supersession, including the accepted cleanup-buffer schedule; callbacks stay associated with their originating scope. |
| C1 cold cursor, old observation and stable terminal positive | An acknowledged unseen resume tail prevents promoting older failure evidence while current reads are held. Compatible fresh terminal reads cover the tail and settle without requiring a new payload or finalizedAt. |
| G1/G2 rejected and recovered generations | Late old page observations, follower responses and obsolete stream frames cannot restore claims after rejection/same-key recovery. Fresh current reads recover. |
| G3/G4 client/provider/key boundaries | API-client replacement, provider/QueryClient replacement, cross-tab key replacement/forget and delayed old-key 401 retain their scoped negative and fresh-positive behavior. The earlier in-place QueryClient-prop hot-swap fixture qualification remains preserved. |
| C2 21-run eviction | An explicitly subscribed, non-aborted old query installs its stale value in the actual cache after eviction; it does not certify the recreated header entry. Fresh current terminal reads settle. Exact internal capacity is supplemental source/unit evidence. |
| C3 refusal | Actual 401/404 reads do not fabricate a terminal claim. |
| I1 finite budgets, persisted shape and action authority | Eight progress batches retain the existing refresh budget, event-cache fields/version and server-row action authority. This is a bounded sample, not an unlimited performance claim. |
| Review 2 R2-1 agreeing cache-only success | With no retained cursor, a current terminal event and matching observation show succeeded/event sequence while the current GET is held, suppressing cached position. Releasing the matching GET qualifies the recorded node. |
| Review 2 R2-2 warm receipt plus foreign-ID collision | An actual wrong-ID 200 with identical status/sequence cannot replace A's inspector/cache or borrow its earlier receipt for a foreign node. A later valid same-ID response settles. |
| Review 2 R2-3 quiet same-key recovery | The visible form recovers the same key after an actual 401. An idle SSE resumes at cursor #3 and one recovered-generation GET starts without test refresh, new events, focus or navigation; the fresh row settles waiting. |
| R2-3 old pending 200 and retired 401 variants | A recovered-generation GET starts while an old handler remains pending. Releasing the old response while the fresh row stays held restores no claim; a retired 401 does not reject or advance the recovered generation. Fresh response then settles waiting. |
| R2-3 quiet read budget | No run work starts during 600 ms rejected. Each recovered 2.2-second quiet sample has exactly one new-generation run GET, at most one observation read, two lifecycle SSE opens, unchanged cursor and accepted recovered generation. |
| Prior independent #386 / #385 controls | Both read models held, stale equal-sequence row, prior terminal/observation, count eviction, navigation, cancel-request/delivery semantics and exact rendered patch operands retain their stated behavior. |

Authored same-generation matching 401, explicit bearer mismatch, anonymous/non-401, aborted read, live 404/500 and other supporting tests remain part of root's ordinary verification; this independent scope does not add their runtime counts to the 36.

## Fresh built-browser verification

The current web build was a cache miss and compiled from the final source. Build passed **9/9 tasks**, with eight unchanged dependency cache hits. Both web and Goblin bundles were generated; the browser checks exercised web. The served index SHA-256 is `accd83d4f333cc14e6f2a21f21b97138e93c22f45d8cb39641efd21e61a6eb83`; all 56 recorded build artifacts remained unchanged after browser execution.

Browser evidence uses installed Microsoft Edge through Playwright, the built UI, real loopback HTTP API, disposable in-memory test database, fake clock and fake harness. The fixed main/control ports are 18786/18787; the unchanged Claude fixture uses its existing disposable loopback instance through the same harness. No real provider/CLI, account credentials or private configuration was used. Component key values were synthetic fixtures.

| Current-candidate browser case | Result | Raw evidence |
| --- | --- | --- |
| Supplied Timeline outcome while run/observation refresh is held | PASS, 1.5 s | `held-projection-browser.json`, retained trace |
| Supplied equal-sequence stale running row, observation held | PASS, 1.4 s | Same report, retained trace |
| Independent both-model-held then stale response, with approved handler drain | PASS, 3.0 s | Same report; `output/playwright/independent/S1-*`, `S2-*` |
| #385 exact recorded repeated appends/non-add diffs at 1440 px | PASS, 5.9 s | Same report; recorded events, exact download, rendered HTML/PNG and trace |
| Same #385 criteria at 390 px | PASS, 4.4 s | Same report; matching narrow-width artifacts and trace |
| Original Claude family-specific publish/run and succeeded assertion | PASS, 4.8 s | `original-claude-browser.json`, retained trace |

The five-case browser invocation passed in 24.3 s and the original-Claude invocation in 11.4 s. Both had retries zero; all six passing traces are retained. The original Claude spec remains SHA-256 `e509374ea3e05cba35232ab0f59559b31f810a4c2c2fe5d228a5bf3ab07936f0`; supplied held/stale spec remains `22dcfccc086503b3bff266f9606cf4af60c51cf1869d45256a13c2667e27c7b7`.

The independent browser source retains the approved active-handler drain: both callbacks increment/decrement in finally, then cleanup releases the held gates, polls activeRoutes zero using the existing expectation budget, and unroutes with wait. On this candidate, **only its artifact destination changed** to this new directory; the exact delta is `browser-destination-only.diff`. New QA source SHA is `d61ed6c4cca62b21879e7b2a3a08f78759d070acc9359f40def4db5e7e754d69`. Its previous failed invocation/source and the unexecuted intermediate drain preparation remain unchanged in the historical evidence. Their dispositions are not retroactively changed by this pass.

The held/stale browser checks establish returned HTTP bodies and public rendered-header assertions after two frames. They do **not** identify which overlapping query/follower response entered React Query or prove every response was consumed. Component cases establish actual cache installation separately. #385 checks compare actual recorded operands, large-value expansion, exact full-thread download, literal dash/escaped path/non-add behavior and horizontal extent at both viewport widths.

## Cleanup, evidence and limits

Final full web types and five-file QA lint passed with the current schema-corrected and destination-only fixtures. All 1,520 tracked input files and eight QA/protected files were unchanged after the browser runs. QA checkout HEAD remains `3a6943a136594162665667a7a55e2b46520912eb`, index SHA `a04bf3d924fe09cee1896f685cfae49ae74066746b08bb57e6b3e930191c2a48`. Common HEAD remains `a60843a9050b3a203726db84f6abf1f45b8bc694`, common index absent.

Both browser command sessions and their servers closed normally. Main/control ports are unbound. The narrow native-process check found zero Node/browser processes whose command lines identify this owned checkout/scratch; raw command lines were not retained and no process was terminated. Root received the heavy-slot release before report/seal work so its coverage could proceed independently.

`FINAL-RESULTS.json`, `component-runtime-input-binding.json`, `source-parity-after-browsers.json`, command scripts/logs, six traces, screenshots, rendered HTML, schedules, recorded events and exact-download JSON retain the evidence. The earlier D226/C1/G2/C2 defects, rejected 0f500 review, QA cleanup failure, zero-selection command and initial D228 schema failure retain their original records and limits.

This is finite affected QA, not full-application regression, real-provider verification, native-persistence acceptance, post-merge owner acceptance, coverage/CI/review completion or merge approval. No installation, production edit, index/Git write, publication, formal scan or review-ledger reset occurred. Root retains the remaining delivery gates.
