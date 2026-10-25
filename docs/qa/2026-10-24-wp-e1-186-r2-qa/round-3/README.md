# Independent QA round 3 - WP-E1 #186 round 2

## 1. Verdict

**FAIL (required gates), revision cf1a8bef261d79c0473c6e6ad9e5cc537cfcb29f.** The two targeted round-2 feature defects pass the exercised reproductions and extensions. No new production defect was established in the bounded-history/cancellation/recovery scenarios. Mandatory Edge assertions remain red, and the infrastructure gate result is recorded below rather than waived.

Branch: `codex-qa-wp-e1-186-r2-3`. Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-e1-186-r2-3`. Implementation branch/PR: `codex-wp-e1-186-r2` / #405. Comparison base: `e83b5b56936c2e2677f4ad184f0d02f45c953c6d`. HEAD matched before testing and in the final [environment record](environment.json). No production edit, earlier-round edit, index action, commit, branch change, sub-agent, GitHub write or owner-instance operation occurred. Only round-3 evidence is a deliverable; ignored scratch/build/coverage folders remain for the orchestrator.

Node **v22.14.0** was first on PATH. Dependencies were populated; no installation, link or junction was used. The built gateway used physical disposable SQLite stores with the prefix `gg-qa-e1-186r2-3-`, real HTTP/SSE and real Node processes. Edge was headless; service workers were blocked for an explicit built revision. Inference, classifiers, structured completions and deciders were **fake-only**. Historical choice/cancellation/classifier fixtures and post-terminal audit suffixes are explicitly synthetic; they were appended through supported repository interfaces. No live-provider result is claimed.

The independent principal gateway used **6150/6151**; bounded Edge servers used **6152/6153** and auxiliary **6154-6159**, with webhook receiver **6159**. Required API process gates use `GG_TEST_PORT_START=6154`, `GG_TEST_PORT_COUNT=6`, `GG_TEST_STORE_PREFIX=gg-qa-e1-186r2-3-gate-`. Existing unit fixtures retain their own internal temporary names. **Initial e2e harness deviation:** the first complete run still allowed auxiliary ephemeral ports and existing `gg-api-` / `gg-wp-g1-116-` fixture names. This was discovered and corrected in QA-only copies; the seven specs were then run individually with all listener ports bounded and disposable prefixes corrected. No owner listener/store was used. The first result and every setup failure remain retained, and are not substituted for the bounded rerun.

**D-015 registered:** the sandbox denies native process-tree termination. Graceful gateway disposal/exit and a changed process after restart are established; forced descendant termination is not. Disposable processes managed by the independent browser scripts exited gracefully; their exit records are linked in the inventory.

## 2. Defects

### Targeted defects: fixed in exercised current-head cases

- **QA-186R2-002 (previous major):** an actual >700-event run was cancelled through REST and browsed at event 50, then from enabled older/newer boundaries, frozen reload and Follow live. Execution context retained the recorded API-key actor. A separate 700-row synthetic post-terminal suffix also preserved it. Pending observation explicitly says it is reading the cancellation record, a controlled HTTP 503 exhausts read retries and explicitly says it could not be read, and a restored response recovers the actor. A request answered by a resume is omitted; a second cancellation uses its second actor. See [browser results](browser-results.json), [corrected pure real-run reproduction](extras-results.json), [recorded cancellation events](cancel-events.json) and [corrected screenshot](cancel-corrected.png).
- **QA-186R2-003 (previous minor):** **162** accepted boundary pages and **110** emitted continuations were exercised, for 0/1/2/1,003-event histories, limits 1/2/500, both directions, first/tail neighbours and the three largest safe integer positions. Every emitted continuation returned HTTP 200; an empty newer maximum-safe page bounds its older continuation by the durable tail, and empty older pages lead to the first event. Empty logs emit no cursor. See [full response excerpts](browser-results.json) and [script](browser.mjs.txt).

### QA-R3-TEST-001 - minor - mandatory large-value spec uses an obsolete Timeline label selector

Run `inspector-large-values.spec.ts` on Edge. Both 1440 px and 390 px cases reach their rendered long Result, then time out at line 97 looking for `/node\.finished work\b/`. The real accessible row is `#11 node.finished Work (work) ...`. Expected: the mandatory test reaches its patch/thread/control checks with the pinned label. Actual: it cannot select the existing row. This is a stale test selector, not evidence of a product freeze. The original spec and failures remain unchanged. A disposable-copy diagnostic changes only that selector and records the rest of both scenarios separately: [diagnostic log](large-value-diagnostic.log.txt), [diagnostic spec](large-value-diagnostic.spec.mjs.txt). See [mandatory log](edge-inspector-large-values.log.txt) and [first failure snapshot](first-e2e-errors/inspector-large-values-lar-faef7-s-width-at-1440-px-259-380-/error-context.md.txt).

### QA-R3-TEST-002 - minor - unchanged failure-code assertion is stale; known stream assertion also fails

The unchanged `qa.spec.ts` has two failures. Its 1,200-item test still expects the old exact Timeline total/complete heading before its incompatible all-rows assertion; the brief explicitly says its 1,200 mounted rows cannot satisfy this change's 80-row window. This is **known and not a defect of this round**. Its failure-reason test expects `HARNESS_TURN_FAILED`, whereas the recorded uncertain-submission failure is `HARNESS_DELIVERY_UNCERTAIN`. The latter assertion is outside this diff and is reported for orchestration, with no production fix. See [mandatory qa log](edge-qa.log.txt), the original [failure snapshot](first-e2e-errors/qa-failure-reasons-are-typ-0d3ec-ure-and-decider-unavailable/error-context.md.txt), and the once-alone diagnostics [streaming](qa-isolated-streams.log.txt) / [failure](qa-isolated-failure.log.txt). The earlier combined-filter diagnostic selected no tests and is retained as a harness failure, not counted as a diagnostic pass or failure of product behavior.

### Required API gate failure - native worker crash in an unchanged file

The complete API coverage command failed with **one unhandled worker error**: exit **3221225477 (0xC0000005)** while running unchanged **src/classifiers.test.ts**. It reported **82 passed / 2 skipped files** and **1,422 passed / 11 skipped tests**, with an incomplete 1,464-test total. Its emitted percentages (lines **96.72%**, branches **91.37%**) do not make that failed run valid acceptance evidence. The one once-alone diagnostic **pnpm.cmd --filter @graphgoblin/api exec vitest run src/classifiers.test.ts** passed **40/40 tests**. Both results stand; no full gate rerun or attribution of the native crash to #186 is claimed. [Original gate](api.log.txt), [one isolated diagnostic](classifiers-isolated.log.txt).

### Required infrastructure gate and environment limit

The gate failed **6 tests / 800 passed**, **4 failed / 52 passed files**, and emitted no coverage summary. Failures: ProcessScripts real child/grandchild abort cleanup EBUSY; Claude deadline/overflow cleanup EBUSY; aborted/running cancellation cleanup EBUSY; descendant marker continued from 7 to 10 characters plus EBUSY cleanup; readiness hang returned unconfirmed-stop wording; incomplete-UTF-8 cancellation left the child detectable. These are the recorded native termination/cleanup boundary, not six established #186 regressions. There was no ordinary timing failure in an untouched infrastructure test, so no such retry was applicable. See [complete infrastructure output](infrastructure.log.txt) and the gate table. Native process cancellation/descendant cleanup failures must be resolved or verified in an environment capable of those operations. D-015 is not a coverage waiver and does not establish that #186 introduced the failures. Timing failures in unchanged files, if present, have their one isolated diagnostic recorded below. No full suite was retried to green.

## 3. Coverage of criteria

Touched systems: SQLite history windows, boundary validation and indexed observations; REST history/thread/observation and authorization; generated API-client resources; paged domain replay; browser retention/persistence, independent SSE acknowledgement and browsing; whole-run cancellation/lifecycle/fresh-session evidence; missing-session control eligibility and concurrent requests; pinned labels/raw values/patch/messages/decision percentages; 80-row Timeline and keyboard/layout; Events pagination/targeting; shutdown notice; webhook result delivery and stream completion/recovery.

| Requirement                                                                                               | Current-head result and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #186 paged replay / bounded temporary buffers / recoverable slow readers                                  | Real paused socket: 6100 ms hold, typed 503 SSE_SLOW_CONSUMER, 18 complete events plus 64 resumed = 82; zero gaps/duplicates. [Result](native-slow-reader.json), [accepted/partial stream](paused-stream.log.txt), [script](native-slow-reader.mjs.txt).                                                                                                                                                                                                                                                                                                  |
| #186 ordering, zero/empty/extreme cursors, both-direction older browsing                                  | 162 pages + 110 emitted continuations passed. Count/byte window bounds, active acknowledgement while rows freeze, reload, exact live suffix and <=80 mounted rows tested. [Browser](browser-results.json), [active/cancel checks](extras-results.json), [bounded-history Edge](edge-bounded-history.log.txt).                                                                                                                                                                                                                                             |
| #303 scope: preserve intended/stored context while repairing measured costs                               | Current/history thread, delayed snapshot failure/resume/success, exact raw event and durable state after restart passed exercised checks. [Thread-history Edge](edge-thread-history.log.txt), [restart](extras-results.json). A fresh before/after memory benchmark was not repeated because this round targets the recorded regression/merge changes; earlier rounds' measurements remain historical, not reasserted as current-head measurements. Other #303 bolts are not accepted by this report.                                                     |
| #265 missing-session recovery inside bounded inspector                                                    | Three >1,000-event real fake-harness failures plus explicit synthetic historical choices: browse old/new/reload, decline plain resume (409), recover from inspector/another tab/API, observe success at event 1,740 without reloading observer, latest 20 notes oldest first, stale recovery 409. Concurrent same-failure requests return 200/409 and append one fresh choice. [Browser results](browser-results.json), [concurrency](extras-results.json), [missing-session Edge](edge-missing-session.log.txt). No live-adapter retention/recall claim. |
| #255 accurate cancellation / pinned labels / exact patches and messages / readable routes and percentages | Cancellation and unknown-history cases, pinned worker in Timeline/patch/messages while browsing, exact downloaded event equality, 1440/390 px in both themes, exact numeric probability 0.123456 with 12.35% display, readable pinned route tested. [Browser](browser-results.json), [supplemental](supplemental-results.json), [exact event](exact-label-event.json).                                                                                                                                                                                    |
| #259 large-value preview/full access and ordinary controls                                                | Required spec's obsolete row selector fails two cases; oversized exact event/thread and focus tests pass. Focused selector-corrected QA-only diagnostic reports the remaining long-value checks separately. [Mandatory spec](edge-inspector-large-values.log.txt), [focused diagnostic](large-value-diagnostic.log.txt). This does not complete #259's separate owner acceptance.                                                                                                                                                                         |
| #319 shutdown notice merged above inspector                                                               | Real gateway drain exposed active run link, explicit Force stop confirmation and inert dismissal; Keep waiting and cancellation reached ready. [Native/browser result](extras-results.json), [screenshot](shutdown-notice.png), [ARIA](shutdown-notice.aria.txt). Forced native tree termination remains D-015-limited.                                                                                                                                                                                                                                   |
| #343 Events / history and webhook merge regression                                                        | Events pagination past 100, stable reading/focus, Runs/Loops history, unknown webhook acknowledgement then success and delivery update without reload passed. [History](edge-history.log.txt), [webhook](edge-webhook-delivery.log.txt).                                                                                                                                                                                                                                                                                                                  |
| Empty runs / malformed or unauthorized requests                                                           | Empty histories emit no continuation; cancelled zero-event record labels missing terminal evidence honestly; reader 200 / wrong scope 403 / other owner 404 / absent key 401; malformed/unsafe cursor and invalid query 400. [Browser](browser-results.json), [corrected empty check](supplemental-results.json).                                                                                                                                                                                                                                         |

### Per-check ledger

The scripts linked here contain the exact supported-interface steps and assertions. Each row retains its expectation, result, numbers/response excerpts or failure, and a link to the complete JSON evidence. Failed harness preconditions are kept separately from product defects.

#### browser-results.json

Steps: [script](browser.mjs.txt); complete results: [JSON](browser-results.json).

| Case                                                          | Steps                                                                                                                                                                  | Expected                                                                                                                        | Actual / excerpt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Result                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| cursor limits, both directions, empty and populated histories | Seed 0/1/2/1003 rows; request limits 1/2/500 at zero, first/tail neighbours and maximum safe integer neighbours; follow each emitted cursor                            | Every accepted page and every emitted continuation is valid, ordered and includes the opposite edge                             | 162 boundary pages; 110 emitted continuations followed; all valid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | PASS                                          |
| observation authorization and malformed history               | GET observation with reader, wrong scope, other owner, absent key; invalid cursors, unsafe integer and fractional seeks                                                | 200/403/404/401 and 400 respectively                                                                                            | [{"status":200,"body":{"lifecycle":{"runId":"01M5S86KFNS1EWH8DKJME36BEQ","seq":28,"ts":"2026-10-25T10:02:50.515Z","type":"run.finished","status":"succeeded","outcome":"success"},"exit":{"runId":"01M5S86KFNS1EWH8DKJME36BEQ","seq":26,"ts":"2026-10-25T10:02:50.515Z","type":"exit.evaluated","nodeId":"done","outcome":"success"},"gate":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"again","confidence":null,"reasoning":null},"portId":"limit-reached","gate":{"previousPasses":2,"passes":2,"repeatRouteId":"again","maxPasses":2,"elapsedSeconds":0.222,"limit":"ma                                                                                                                                        | PASS                                          |
| QA-186R2-002 real long cancellation, both browsing directions | Cancel >700-event running workload; seek 50; Load newer and older; reload frozen window; Follow live                                                                   | Execution context always retains the recorded actor, bounded window and 80 mounted rows                                         | TimeoutError: locator.click: Timeout 30000ms exceeded. Call log: [2m - waiting for getByRole('button', { name: 'Load older', exact: true })[22m [2m - locator resolved to <button disabled type="button" class="relative inline-flex max-w-full min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-md border font-semibold leading-none cursor-pointer select-none no-underline transition-[background-color,border-color,box-shadow,translate] active:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none aria-disabled:cursor-default aria-disabled:opacity-4…>…</button>[22m [2m - attempting click action[22m [2m 2 × waiting for element to be visible, enabled and sta | FAIL - retained harness result; see follow-up |
| QA-186R2-002 synthetic post-terminal suffix                   | Append 700 explicit synthetic audit rows after cancellation; reload then seek 50 and tail                                                                              | Whole-run recorded actor survives eviction and opposite-direction seek                                                          | {"text":"Execution context\n\nIndependent QA 1792922572586 v1 · version ID 01M5S86NSH237WA9W8DG0R322Y\n\nCancelled by api-key 01M5S80Q6HBDZQ90Z2XXGG2QBJ (request #725; cancellation #726). Recorded node position: Work (work).\n\nExact run record\nPinned definition JSON","observation":{"lifecycle":{"runId":"01M5S86NTA7E79PCGCWTMBKZ66","seq":726,"ts":"2026-10-25T10:02:57.642Z","type":"run.cancelled"},"gate":{"provenance":{"kind":"expression","provider":null,"classifierId":null,"model":null,"effort":null},"observation":{"kind":"route","routeId":"again","confidence":null,"reasoning":null},"portId":"again","gate":{"previousPasses":72,"passes":73,"r                                                                                                                                        | PASS                                          |
| observation pending, failed, then answered                    | Intercept observation at the HTTP boundary, hold read; return 503 for all retries; restore real response and reload                                                    | Reading the cancellation record, explicit unreadable record, then correct actor                                                 | {"requests":6,"pending":"Execution context\n\nIndependent QA 1792922572586 v1 · version ID 01M5S86NSH237WA9W8DG0R322Y\n\nLoading pinned definition…\n\nCancelled. Reading the cancellation record… Recorded node position: work.\n\nExact run record","failed":"Execution context\n\nIndependent QA 1792922572586 v1 · version ID 01M5S86NSH237WA9W8DG0R322Y\n\nCancelled. The cancellation record could not be read. Recorded node position: Work (work).\n\nExact run record\nPinned definition JSON","answered":"Execution context\n\nIndependent QA 1792922572586 v1 · version ID 01M5S86NSH237WA9W8DG0R322Y\n\nCancelled by api-key 01M5S80Q6HBDZQ90Z2XXGG2QBJ (reque                                                                                                                                        | PASS                                          |
| request answered by resume and twice-cancelled run            | Synthetic valid event histories: request, resume, cancel; then second request, 600 intervening rows and cancellation                                                   | Answered request omitted; latest second actor retained across event 1 and tail browsing                                         | {"first":{"lifecycle":{"runId":"01M5S86KFNS1EWH8DK00000005","seq":3,"ts":"2026-10-25T10:03:32.370Z","type":"run.cancelled"},"cancelled":{"runId":"01M5S86KFNS1EWH8DK00000005","seq":3,"ts":"2026-10-25T10:03:32.370Z","type":"run.cancelled"},"freshSessionChoices":[]},"firstText":"Execution context\n\nIndependent QA 1792922570097 v1 · version ID 01M5S86KDXP71F37FED0F6B70V\n\nCancelled; actor not recorded. Node position not recorded.\n\nExact run record\nPinned definition JSON","second":{"lifecycle":{"runId":"01M5S86KFNS1EWH8DK00000005","seq":606,"ts":"2026-10-25T10:03:32.940Z","type":"run.cancelled"},"cancelled":{"runId":"01M5S86KFNS1EWH8DK0000000                                                                                                                                        | PASS                                          |
| missing-session long bounded inspector recovery via inspector | Create >1000-event real fake-harness failure with 25 explicit synthetic historical choices outside window; older/newer/reload; decline plain resume; recover inspector | Latest 20 notes remain ordered; recovery choice remains available; one choice succeeds; observer follows outcome without reload | succeeded, final seq 1740; latest 20 notes; failure seq 1635; plain/stale requests 409                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PASS                                          |
| missing-session long bounded inspector recovery via other-tab | Create >1000-event real fake-harness failure with 25 explicit synthetic historical choices outside window; older/newer/reload; decline plain resume; recover other-tab | Latest 20 notes remain ordered; recovery choice remains available; one choice succeeds; observer follows outcome without reload | succeeded, final seq 1740; latest 20 notes; failure seq 1635; plain/stale requests 409                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PASS                                          |
| missing-session long bounded inspector recovery via api       | Create >1000-event real fake-harness failure with 25 explicit synthetic historical choices outside window; older/newer/reload; decline plain resume; recover api       | Latest 20 notes remain ordered; recovery choice remains available; one choice succeeds; observer follows outcome without reload | succeeded, final seq 1740; latest 20 notes; failure seq 1635; plain/stale requests 409                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PASS                                          |
| #255 pinned labels and exact historical patch/message         | Run pinned worker with messages; append 700 rows; seek original node.finished; inspect patch and messages and exact download; phone and desktop in light/dark          | Pinned Worker in Timeline, patch and messages; exact downloaded bytes match durable event; no horizontal overflow               | {"eventSeq":11,"dimensions":[{"width":1440,"theme":"dark","innerWidth":1440,"scroll":1440},{"width":1440,"theme":"light","innerWidth":1440,"scroll":1440},{"width":390,"theme":"dark","innerWidth":390,"scroll":390},{"width":390,"theme":"light","innerWidth":390,"scroll":390}]}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | PASS                                          |

#### extras-results.json

Steps: [script](extras.mjs.txt); complete results: [JSON](extras-results.json).

| Case                                                                   | Steps                                                                                                                                                           | Expected                                                                                                                                        | Actual / excerpt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Result                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| active browsing freezes membership while live acknowledgement advances | Seek 50 in active >700-event run; wait 100 more live events; reload; Follow live                                                                                | Frozen rows unchanged, acknowledgement advances, reload preserves history mode, live returns exact bounded suffix                               | {"before":{"ack":871,"first":1,"last":50},"after":{"ack":985,"first":1,"last":50},"live":{"ack":1039,"rows":163,"bytes":114032}}                                                                                                                                                                                                                                                                                                                                                                                                                                               | PASS                                          |
| corrected pure real long cancellation reproduction                     | Before any synthetic suffix: seek 50, then 600; Load older and newer from enabled edges; reload frozen window; Follow live                                      | Actual actor preserved at all positions; exact suffix and <=80 Timeline rows                                                                    | run 01M5S952FCHYY8H8GPZPFD920N; 1046 events; actor 01M5S80Q6HBDZQ90Z2XXGG2QBJ; {"rows":128,"first":919,"last":1046,"bytes":90292,"mounted":80}                                                                                                                                                                                                                                                                                                                                                                                                                                 | PASS                                          |
| empty cancelled run honestly labels missing history                    | Create an explicitly synthetic zero-row cancelled record; open inspector and seek unavailable event                                                             | No invented actor; terminal cancellation event not recorded; zero persisted rows                                                                | TypeError: Cannot read properties of undefined (reading 'events')                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | FAIL - retained harness result; see follow-up |
| concurrent fresh-session requests admit exactly one choice             | Real failed two-visit fake-harness run; send two recover-session requests with the same failureSeq concurrently; follow it                                      | One 200 and one 409; one new fresh-session event; success                                                                                       | {"runId":"01M5S95CS8DDRKSTD0NNWNGZMS","requests":[{"status":200},{"status":409,"code":"INVALID_STATE"}],"choice":{"runId":"01M5S95CS8DDRKSTD0NNWNGZMS","seq":20,"ts":"2026-10-25T10:19:39.303Z","type":"run.resumed","actor":{"kind":"api-key","id":"01M5S80Q6HBDZQ90Z2XXGG2QBJ"},"freshSession":{"visitId":"01M5S95CS8DDRKSTD0NNWNGZMS:15","harness":"codex","sessionId":"fake-session-188","origin":"resume-previous","model":"gpt-6-luna","effort":"low","nodeId":"work","failureSeq":19,"priorContextCarried":false,"prompt":"controlled measurement"}}}                   | PASS                                          |
| real gateway graceful restart preserves history and observation        | Stop original gateway through QA control; mint a key with built main.js on the same store; spawn new built fake gateway; compare record/observation/thread      | New PID, built CLI key success, unchanged durable data and old credentials still valid                                                          | {"oldPid":26776,"newPid":22960,"cliCode":0,"cliKeyMinted":true,"dir":"%USERPROFILE%\\AppData\\Local\\Temp\\gg-qa-e1-186r2-3-gfQnhS","equal":["run","observation","thread"]}                                                                                                                                                                                                                                                                                                                                                                                                    | PASS                                          |
| #319 shutdown notice above bounded inspector                           | Start active fake run; open inspector; POST drain; observe run link, open force confirmation and dismiss; choose Keep waiting; cancel run and observe readiness | Draining notice names active run, force requires confirmation, dismissal is inert, no new independent admission, stored history still browsable | {"runId":"01M5S95KNN6VF75STQQBBFGBYK","drain":{"phase":"draining","graceMs":300000,"startedAt":"2026-10-25T10:19:47.466Z","choiceAt":"2026-10-25T10:24:47.466Z","activeRunIds":["01M5S95KNN6VF75STQQBBFGBYK"],"unconfirmedRunIds":[],"choices":["wait","force"],"controlToken":"45909653-65db-403c-aff2-43b0b9e99059:1:draining"},"final":{"phase":"ready","graceMs":300000,"startedAt":"2026-10-25T10:19:47.466Z","choiceAt":"2026-10-25T10:24:47.466Z","activeRunIds":[],"unconfirmedRunIds":[],"choices":[],"controlToken":"45909653-65db-403c-aff2-43b0b9e99059:3:ready"}} | PASS                                          |

#### supplemental-results.json

Steps: [script](supplemental.mjs.txt); complete results: [JSON](supplemental-results.json).

| Case                                                                         | Steps                                                                                                   | Expected                                                                                               | Actual / excerpt                                                                                                                                                                                                                                                                                                                                                                                 | Result |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| empty cancellation corrected cache precondition                              | Synthetic empty cancelled run; read observation and UI; allow absent zero-event cache entry             | Explicit terminal cancellation event not recorded; no invented actor; zero rows, no page error         | {"id":"01M5S9RV98MPJAYF8H00000001","text":"Execution context\n\nIndependent QA 1792924216514 v1 · version ID 01M5S9RV88609DTKNNNWS6NG9D\n\nCancelled; terminal cancellation event not recorded, so its actor cannot be established. Node position not recorded.\n\nExact run record\nPinned definition JSON","observation":{"freshSessionChoices":[]},"cachePresent":false,"rows":0,"errors":[]} | PASS   |
| #255 recorded probabilities remain exact while formatted routes are readable | Seed recorded classifier decision from actual decision event; 700 later synthetic rows; seek decision 1 | 12.35%/87.65%, exact 0.123456 title and Pinned Again (again); selected raw event equals durable source | {"id":"01M5S9RV98MPJAYF8H00000002","seq":1,"display":["12.35%","87.65%"],"rawProbability":0.123456,"route":"Pinned Again (again)"}                                                                                                                                                                                                                                                               | PASS   |

The first real-cancellation navigation check wrongly clicked disabled Load older while its window still started at event 1. Its corrected reproduction seeks 600 before loading older and passes; no product fix occurred. The first empty-run check wrongly assumed a zero-event run must have a persisted cache object; the corrected check allows absent cache and separately asserts zero mounted rows and the missing-evidence wording. Setup failures in the QA-only e2e harness (incorrect relocated working directory/import, then the combined grep selecting no tests) did not execute a product test; their logs remain linked. The initial unbounded-port e2e run and the later correctly bounded runs are distinct evidence sets. No passing diagnostic erases a mandatory failure.

### Required gates

Node v22.14.0; pnpm commands used throughout. No ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK occurred, so no store-lock binary fallback was used. Coverage was invoked directly per package, rather than relying on a Turbo coverage cache.

| Exact command                                               | Result                                                                                                                                                                                            | Evidence                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| pnpm.cmd build                                              | PASS; 11/11 tasks                                                                                                                                                                                 | [Log](build.log.txt)          |
| pnpm.cmd typecheck                                          | PASS; Tasks: 20 successful, 20 total                                                                                                                                                              | [Log](typecheck.log.txt)      |
| pnpm.cmd lint                                               | PASS; Tasks: 11 successful, 11 total                                                                                                                                                              | [Log](lint.log.txt)           |
| pnpm.cmd format:check                                       | PASS;                                                                                                                                                                                             | [Log](format.log.txt)         |
| pnpm.cmd check:layers                                       | PASS;                                                                                                                                                                                             | [Log](layers.log.txt)         |
| pnpm.cmd check:deps                                         | PASS;                                                                                                                                                                                             | [Log](deps.log.txt)           |
| pnpm.cmd check:docs                                         | PASS;                                                                                                                                                                                             | [Log](docs.log.txt)           |
| pnpm.cmd check:tokens                                       | PASS;                                                                                                                                                                                             | [Log](tokens.log.txt)         |
| pnpm.cmd --filter @graphgoblin/web test:coverage            | PASS; Test Files 145 passed (145); Tests 1770 passed (1770); Duration 306.33s (tests 42%, environment 33%, setup 12%, import 11%, transform 2%, worker 1%)                                        | [Log](web.log.txt)            |
| pnpm.cmd --filter @graphgoblin/api test:coverage            | FAIL; Test Files 82 passed \| 2 skipped (85); Tests 1422 passed \| 11 skipped (1464); Duration 178.51s (tests 75%, import 22%, transform 2%, worker 1%); Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL | [Log](api.log.txt)            |
| pnpm.cmd --filter @graphgoblin/api-client test:coverage     | PASS; Test Files 9 passed (9); Tests 94 passed (94); Duration 10.46s (import 55%, transform 31%, tests 13%, worker 1%)                                                                            | [Log](api-client.log.txt)     |
| pnpm.cmd --filter @graphgoblin/domain test:coverage         | PASS; Test Files 32 passed (32); Tests 612 passed (612); Duration 10.16s (import 41%, tests 39%, transform 17%, worker 3%)                                                                        | [Log](domain.log.txt)         |
| pnpm.cmd --filter @graphgoblin/infrastructure test:coverage | FAIL; Test Files 4 failed \| 52 passed (56); Tests 6 failed \| 800 passed (806); Duration 42.39s (tests 54%, import 37%, transform 7%, worker 1%); Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL       | [Log](infrastructure.log.txt) |

Coverage columns in the raw logs are statements, branches, functions and lines. No threshold, denominator or exclusion was changed. check:docs and check:tokens were required and passed; check:licenses was not rerun because no dependency/lockfile changed. The initial format gate passed before report creation; final report formatting and artifact-integrity checks are recorded in final-verification.json.

### Coverage summaries

| Package        |              Lines |           Branches | Gate qualification                     |
| -------------- | -----------------: | -----------------: | -------------------------------------- |
| web            | 98.71% (7828/7930) | 94.59% (8289/8763) | PASS                                   |
| api            | 96.72% (2218/2293) | 91.37% (1590/1740) | FAILED; worker crash, incomplete suite |
| api-client     |     100% (271/271) |   98.39% (184/187) | PASS                                   |
| domain         | 98.48% (2017/2048) | 95.81% (2288/2388) | PASS                                   |
| infrastructure |        not emitted |        not emitted | FAILED; native termination/cleanup     |

### Required Edge specs

All use Microsoft Edge, retries 0, workers 1, built web assets and QA-only disposable harness copies that constrain ports and preserve directories. Required spec assertions are unchanged; only import relocation and webhook listener port were adapted in their copies. The large-value diagnostic is explicitly separate.

| Spec                   | Result                    | Evidence                                   |
| ---------------------- | ------------------------- | ------------------------------------------ |
| bounded-history        | 1 passed (12.6s)          | [Log](edge-bounded-history.log.txt)        |
| thread-history         | 1 passed (11.8s)          | [Log](edge-thread-history.log.txt)         |
| inspector-large-values | 2 failed; 4 passed (2.3m) | [Log](edge-inspector-large-values.log.txt) |
| missing-session        | 1 passed (10.1s)          | [Log](edge-missing-session.log.txt)        |
| history                | 5 passed (34.9s)          | [Log](edge-history.log.txt)                |
| webhook-delivery       | 2 passed (14.7s)          | [Log](edge-webhook-delivery.log.txt)       |
| qa                     | 2 failed; 8 passed (1.2m) | [Log](edge-qa.log.txt)                     |

### Not established / required follow-up

Forced process-tree termination remains D-015-limited and the failing infrastructure gate is not waived. No live provider turn, native provider recall/retention, cross-browser comparison, PWA offline/update installation, fresh before/after memory pair or owner product acceptance was performed. The mandatory stale browser assertions need orchestrator disposition; the known 1,200-row assertion remains the explicitly deferred #351/#241 coordination item. No feature acceptance is inferred from a fake provider response alone.

## 4. Report path and evidence folder

Report: `docs/qa/2026-10-24-wp-e1-186-r2-qa/round-3/README.md`. Evidence: this round-3 folder. [Artifact manifest](artifact-manifest.json) gives byte counts and SHA-256 values. [NOT-KEPT](NOT-KEPT.md) records every oversized scratch capture by size and SHA-256. JSON and script/log artifacts are UTF-8 without BOM; images retain original bytes. Existing rounds are unmodified. Ignored `.tmp/qa3`, `apps/web/.tmp/qa3`, build outputs, coverage outputs and retained disposable stores are for orchestrator cleanup; no directory deletion was performed by an independent QA cleanup command.

Every retained artifact is linked below, including initial failures and setup scripts.

- [NOT-KEPT.md](NOT-KEPT.md)
- [adjust-bounded.mjs.txt](adjust-bounded.mjs.txt)
- [adjust-diagnostic.mjs.txt](adjust-diagnostic.mjs.txt)
- [adjust-e2e-import.mjs.txt](adjust-e2e-import.mjs.txt)
- [adjust-e2e.mjs.txt](adjust-e2e.mjs.txt)
- [api-client.log.txt](api-client.log.txt)
- [api.log.txt](api.log.txt)
- [artifact-manifest.json](artifact-manifest.json)
- [browser-results.json](browser-results.json)
- [browser.mjs.txt](browser.mjs.txt)
- [build.log.txt](build.log.txt)
- [cancel-corrected.aria.txt](cancel-corrected.aria.txt)
- [cancel-corrected.png](cancel-corrected.png)
- [cancel-events.json](cancel-events.json)
- [cancel-suffix.aria.txt](cancel-suffix.aria.txt)
- [cancel-suffix.png](cancel-suffix.png)
- [classifiers-isolated.log.txt](classifiers-isolated.log.txt)
- [classifiers-isolated.mjs.txt](classifiers-isolated.mjs.txt)
- [coverage.log.txt](coverage.log.txt)
- [deps.log.txt](deps.log.txt)
- [docs.log.txt](docs.log.txt)
- [domain.log.txt](domain.log.txt)
- [e2e-bounded.mjs.txt](e2e-bounded.mjs.txt)
- [e2e-global-setup.ts.mjs.txt](e2e-global-setup.ts.mjs.txt)
- [e2e-prepare.mjs.txt](e2e-prepare.mjs.txt)
- [e2e-server-bounded.ts.mjs.txt](e2e-server-bounded.ts.mjs.txt)
- [e2e-server.ts.mjs.txt](e2e-server.ts.mjs.txt)
- [e2e-test-app.ts.mjs.txt](e2e-test-app.ts.mjs.txt)
- [e2e-thread-history.ts.mjs.txt](e2e-thread-history.ts.mjs.txt)
- [edge-bounded-history.log.txt](edge-bounded-history.log.txt)
- [edge-history.log.txt](edge-history.log.txt)
- [edge-inspector-large-values-errors/inspector-large-values-lar-0ecd6-ts-width-at-390-px-259-380-/error-context.md.txt](edge-inspector-large-values-errors/inspector-large-values-lar-0ecd6-ts-width-at-390-px-259-380-/error-context.md.txt)
- [edge-inspector-large-values-errors/inspector-large-values-lar-faef7-s-width-at-1440-px-259-380-/error-context.md.txt](edge-inspector-large-values-errors/inspector-large-values-lar-faef7-s-width-at-1440-px-259-380-/error-context.md.txt)
- [edge-inspector-large-values.log.txt](edge-inspector-large-values.log.txt)
- [edge-missing-session.log.txt](edge-missing-session.log.txt)
- [edge-qa-errors/qa-failure-reasons-are-typ-0d3ec-ure-and-decider-unavailable/error-context.md.txt](edge-qa-errors/qa-failure-reasons-are-typ-0d3ec-ure-and-decider-unavailable/error-context.md.txt)
- [edge-qa-errors/qa-streams-1-200-harness-i-a6f9e-ates-or-a-refetch-per-event/error-context.md.txt](edge-qa-errors/qa-streams-1-200-harness-i-a6f9e-ates-or-a-refetch-per-event/error-context.md.txt)
- [edge-qa-isolated.log.txt](edge-qa-isolated.log.txt)
- [edge-qa.log.txt](edge-qa.log.txt)
- [edge-results.json](edge-results.json)
- [edge-thread-history.log.txt](edge-thread-history.log.txt)
- [edge-webhook-delivery.log.txt](edge-webhook-delivery.log.txt)
- [empty-cancel-corrected.aria.txt](empty-cancel-corrected.aria.txt)
- [empty-cancel-corrected.png](empty-cancel-corrected.png)
- [environment.json](environment.json)
- [exact-label-event.json](exact-label-event.json)
- [execution-browser.log.txt](execution-browser.log.txt)
- [execution-classifiers-isolated-command.log.txt](execution-classifiers-isolated-command.log.txt)
- [execution-e2e-bounded-final.log.txt](execution-e2e-bounded-final.log.txt)
- [execution-e2e-bounded.log.txt](execution-e2e-bounded.log.txt)
- [execution-e2e-second.log.txt](execution-e2e-second.log.txt)
- [execution-e2e-third.log.txt](execution-e2e-third.log.txt)
- [execution-e2e.log.txt](execution-e2e.log.txt)
- [execution-final-diagnostics.log.txt](execution-final-diagnostics.log.txt)
- [execution-remaining.log.txt](execution-remaining.log.txt)
- [execution-server.log.txt](execution-server.log.txt)
- [execution-supplemental.log.txt](execution-supplemental.log.txt)
- [extras-results.json](extras-results.json)
- [extras.log.txt](extras.log.txt)
- [extras.mjs.txt](extras.mjs.txt)
- [final-diagnostics.mjs.txt](final-diagnostics.mjs.txt)
- [first-e2e-errors/inspector-large-values-lar-0ecd6-ts-width-at-390-px-259-380-/error-context.md.txt](first-e2e-errors/inspector-large-values-lar-0ecd6-ts-width-at-390-px-259-380-/error-context.md.txt)
- [first-e2e-errors/inspector-large-values-lar-faef7-s-width-at-1440-px-259-380-/error-context.md.txt](first-e2e-errors/inspector-large-values-lar-faef7-s-width-at-1440-px-259-380-/error-context.md.txt)
- [first-e2e-errors/qa-failure-reasons-are-typ-0d3ec-ure-and-decider-unavailable/error-context.md.txt](first-e2e-errors/qa-failure-reasons-are-typ-0d3ec-ure-and-decider-unavailable/error-context.md.txt)
- [first-e2e-errors/qa-streams-1-200-harness-i-a6f9e-ates-or-a-refetch-per-event/error-context.md.txt](first-e2e-errors/qa-streams-1-200-harness-i-a6f9e-ates-or-a-refetch-per-event/error-context.md.txt)
- [format.log.txt](format.log.txt)
- [gates-typecheck.json](gates-typecheck.json)
- [gates-web.json](gates-web.json)
- [gates.mjs.txt](gates.mjs.txt)
- [infrastructure.log.txt](infrastructure.log.txt)
- [labels-1440-dark.aria.txt](labels-1440-dark.aria.txt)
- [labels-1440-dark.png](labels-1440-dark.png)
- [labels-1440-light.aria.txt](labels-1440-light.aria.txt)
- [labels-1440-light.png](labels-1440-light.png)
- [labels-390-dark.aria.txt](labels-390-dark.aria.txt)
- [labels-390-dark.png](labels-390-dark.png)
- [labels-390-light.aria.txt](labels-390-light.aria.txt)
- [labels-390-light.png](labels-390-light.png)
- [large-value-diagnostic.log.txt](large-value-diagnostic.log.txt)
- [large-value-diagnostic.mjs.txt](large-value-diagnostic.mjs.txt)
- [large-value-diagnostic.spec.mjs.txt](large-value-diagnostic.spec.mjs.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [missing-api-browsed.aria.txt](missing-api-browsed.aria.txt)
- [missing-api-browsed.png](missing-api-browsed.png)
- [missing-api-outcome.aria.txt](missing-api-outcome.aria.txt)
- [missing-api-outcome.png](missing-api-outcome.png)
- [missing-inspector-browsed.aria.txt](missing-inspector-browsed.aria.txt)
- [missing-inspector-browsed.png](missing-inspector-browsed.png)
- [missing-inspector-outcome.aria.txt](missing-inspector-outcome.aria.txt)
- [missing-inspector-outcome.png](missing-inspector-outcome.png)
- [missing-other-tab-browsed.aria.txt](missing-other-tab-browsed.aria.txt)
- [missing-other-tab-browsed.png](missing-other-tab-browsed.png)
- [missing-other-tab-outcome.aria.txt](missing-other-tab-outcome.aria.txt)
- [missing-other-tab-outcome.png](missing-other-tab-outcome.png)
- [native-slow-reader.json](native-slow-reader.json)
- [native-slow-reader.log.txt](native-slow-reader.log.txt)
- [native-slow-reader.mjs.txt](native-slow-reader.mjs.txt)
- [normalize-queue.mjs.txt](normalize-queue.mjs.txt)
- [observation-failed.aria.txt](observation-failed.aria.txt)
- [observation-failed.png](observation-failed.png)
- [observation-pending.aria.txt](observation-pending.aria.txt)
- [observation-pending.png](observation-pending.png)
- [paused-stream.log.txt](paused-stream.log.txt)
- [playwright.config.ts.mjs.txt](playwright.config.ts.mjs.txt)
- [prepare-slow.mjs.txt](prepare-slow.mjs.txt)
- [probabilities-browsed.aria.txt](probabilities-browsed.aria.txt)
- [probabilities-browsed.png](probabilities-browsed.png)
- [qa-isolated-failure-context.md.txt](qa-isolated-failure-context.md.txt)
- [qa-isolated-failure.log.txt](qa-isolated-failure.log.txt)
- [qa-isolated-streams-context.md.txt](qa-isolated-streams-context.md.txt)
- [qa-isolated-streams.log.txt](qa-isolated-streams.log.txt)
- [remaining.json](remaining.json)
- [remaining.mjs.txt](remaining.mjs.txt)
- [report.mjs.txt](report.mjs.txt)
- [requirements-186.txt](requirements-186.txt)
- [requirements-255.txt](requirements-255.txt)
- [requirements-259.txt](requirements-259.txt)
- [requirements-265.txt](requirements-265.txt)
- [requirements-303.txt](requirements-303.txt)
- [requirements-ADR-0050-bounded-sse-replay.txt](requirements-ADR-0050-bounded-sse-replay.txt)
- [requirements-ADR-0055-explicit-missing-session-recovery.txt](requirements-ADR-0055-explicit-missing-session-recovery.txt)
- [requirements-COMMON.txt](requirements-COMMON.txt)
- [requirements-QA-COMMON.txt](requirements-QA-COMMON.txt)
- [restart-exit.json](restart-exit.json)
- [restart-server.log.txt](restart-server.log.txt)
- [retain.mjs.txt](retain.mjs.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup-failed-edge-bounded-history.log.txt](setup-failed-edge-bounded-history.log.txt)
- [setup-failed-edge-history.log.txt](setup-failed-edge-history.log.txt)
- [setup-failed-edge-inspector-large-values.log.txt](setup-failed-edge-inspector-large-values.log.txt)
- [setup-failed-edge-missing-session.log.txt](setup-failed-edge-missing-session.log.txt)
- [setup-failed-edge-qa-isolated.log.txt](setup-failed-edge-qa-isolated.log.txt)
- [setup-failed-edge-qa.log.txt](setup-failed-edge-qa.log.txt)
- [setup-failed-edge-results.json](setup-failed-edge-results.json)
- [setup-failed-edge-thread-history.log.txt](setup-failed-edge-thread-history.log.txt)
- [setup-failed-edge-webhook-delivery.log.txt](setup-failed-edge-webhook-delivery.log.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [shutdown-notice.aria.txt](shutdown-notice.aria.txt)
- [shutdown-notice.png](shutdown-notice.png)
- [source.diff.txt](source.diff.txt)
- [supplemental-exit.json](supplemental-exit.json)
- [supplemental-results.json](supplemental-results.json)
- [supplemental-server.log.txt](supplemental-server.log.txt)
- [supplemental.mjs.txt](supplemental.mjs.txt)
- [tokens.log.txt](tokens.log.txt)
- [twice-cancelled.aria.txt](twice-cancelled.aria.txt)
- [twice-cancelled.png](twice-cancelled.png)
- [typecheck.log.txt](typecheck.log.txt)
- [web.log.txt](web.log.txt)

- [final-verification.json](final-verification.json)

- [final-format.log.txt](final-format.log.txt)
- [finish-report.mjs.txt](finish-report.mjs.txt)
- [verify.mjs.txt](verify.mjs.txt)

## 5. Observations outside scope

The mandatory large-value spec needs its Timeline selector aligned with #255's pinned labels. The unchanged qa.spec.ts provider-failure assertion expects the older failure classification. Its streaming test is the brief's known incompatibility and was not logged as a new bounded-history defect. The API worker crash remains a failed full gate despite its isolated 40-test pass. Infrastructure native cancellation/cleanup failures require D-015-capable verification. The shared host limits timing attribution; once-alone diagnostics preserve their original results rather than declaring intermittent failures fixed. No out-of-scope production fix was made.
