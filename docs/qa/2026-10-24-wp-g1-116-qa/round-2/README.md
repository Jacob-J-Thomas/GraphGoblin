# Independent QA round 2: WP-G1 bolt #116

## Verdict

**FAIL for full QA qualification at `a553d429ad50cf9b528d660b8d39948fc554dda9`.** All five requested #116 case groups passed, including both B1 reproductions. The full infrastructure gate failed with 10 failed / 763 passed tests across five files, and its one isolated rerun per affected file did not clear the failures. The non-native format-cutover timeouts cannot be attributed to D-015. No new #116 production logic defect was reproduced. This is independent QA, not implementation, code review, merge authorization, issue closure, or acceptance of #308/#289.

Branch `codex-qa-wp-g1-116-2`; base `0a1ff340dc8e0eb0ad6621b4020d100dcdc3be71`; worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-g1-116-2`. HEAD and populated local dependencies were checked before launch. Only this evidence folder was added. No production code, maintained tests, dependency installation, Git index, commit, branch, owner instance/store, or GitHub record was changed. No sub-agents were used.

Node `v22.14.0` was first on PATH. `pnpm.cmd build` completed 11 tasks (one cache hit) in 2m6.344s before any fixture launch. Edge `156.0.4314.42` ran headless at 1440 x 1000 and 390 x 844 (recovery reproduction uses 390 x 1000). Manual API ports were 5870-5877. Physical stores and executable fixture copies are under `%USERPROFILE%\AppData\Local\Temp\gg-qa-g1-116-2-scripts-bP2DPL\gg-qa-g1-116-2-store-*`. The repository browser spec additionally used its standard automatically allocated ephemeral port and fixture-owned temporary store. Package gate subprocess tests also use their existing fixture-owned allocations (the API log records port 5601 and gg-api-process-* directories); these are separate from the manual 5870-5877 cases. No owner port was accessed.

Evidence tiers: **fake-only execution, real built API processes, SQLite, loopback HTTP, MCP SDK protocol, and Edge.** The harness composes the built API through its public composition exports with a `FakeHarness` and a controlled `ScriptPort`. API calls use the disposable local-user authentication path; this is not a binary-generated-key authentication qualification. MCP initially uses SDK linked transports and real HTTP to that API. A further B1 probe launches the built MCP stdio binary in its own process and enumerates its tools. A repository subclass delays checkpoint writes, and a public event-port wrapper counts rows; no component is monkey-patched. `state` reads bypass the counting wrapper solely to obtain the stored seed, full log, full `replayThread` result, and hashes. Row measurements count the manager's event reads per REST/MCP thread request, excluding oracle/control reads. Literal expected values independently check the distinguishing B1 values; full-thread parity uses the shipped full replay. B1 event ordering is injected through public storage ports; this does not claim an ordinary executor emits that ordering. No provider turn occurred.

## Defects

No blocker, major, or minor production logic defect was reproduced in the requested #116 scenarios. B1's two histories pass. The following major qualification failure keeps the overall verdict failed.

**G1 - Major: required infrastructure test gate fails.** Reproduce with `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --reporter=verbose --coverage.reportOnFailure`. Expected: all maintained tests pass and coverage exceeds 90%. Actual: 10 failed / 763 passed tests, 5 failed / 47 passed files; coverage is 98.74% lines / 95.12% branches, so the failure is not a denominator or threshold failure. The 11 failure records include one test with both an assertion and a cleanup error. See [complete full log](infrastructure-complete.log.txt), [command result](infrastructure-complete.json), and [coverage summary](infrastructure-coverage-summary.json).

The untouched `packages/infrastructure/src/sqlite/upgrade.test.ts:118` cutover test times out at 20,470 ms in the full suite and 20,046 ms alone. The status-blocking parameterization at line 205 times out for **queued** in the full suite and **paused** alone. Its one isolated file rerun is 2 failed / 24 passed; these are not identical status-case failures. Cause is not established, and D-015 is not an explanation for these SQL cutover timeouts. See [isolated upgrade log](isolated-src-sqlite-upgrade-test-ts.log.txt), [isolated command records](isolation-results.json). No second isolated rerun or source change was attempted.

The remaining failing files exercise native trees/process shutdown/readiness. D-015 is recorded as the supplied native-tree restriction, with actual failed assertions preserved. All four additional affected untouched files were rerun once alone, sequentially; the earlier adversarial file already had its one isolated rerun. These isolated failures do not establish a newly introduced #116 defect and do not make the full gate green. Details are in the gate tables and outside-scope observations.

Four harness failures are retained and are not counted as product failures or silent successful retries:

1. The first damage probe expected HTTP 409 and `UNREADABLE_RUN_HISTORY`. The API maps `UnreadableRunHistoryError` to HTTP 500 `STORED_RUN_INVALID`. The corrected focused probe checks that public contract and the explanatory field-specific detail. See [original broad log](broad.log.txt), [original driver](broad.mjs.txt), [corrected driver](damage-fallback.mjs.txt), and [corrected results](damage-fallback-results.json).
2. The first unsequenced fixture passed `undefined` as the new required sequence argument; Drizzle omitted that update, retaining the old sequence alongside a deliberately unrelated seed snapshot. This was not an unsequenced checkpoint. The corrected disposable-store fault uses explicit SQL NULL for both sequence and state. See [original server](server.mjs.txt), [corrected server](server-corrected.mjs.txt), and the corrected fallback results.
3. The original child probe called unsupported `GET /runs?parentRunId=...` and received the correct 400 validation response. That unused query was removed from the focused probe; child identity comes from persisted parent linkage. See [lifecycle log](lifecycle.log.txt), [original driver](lifecycle.mjs.txt), [focused driver](child-corrected.mjs.txt), and [child results](child-results.json).
4. The original cancellation fixture incorrectly expected `ScriptPort.run` to receive its signal as a second argument. The real port passes `request.signal`; the hold therefore lasted past the 60-second observer deadline. The corrected composition honors `request.signal`, and cancellation excludes the script's returned patch. See lifecycle log, [corrected cancellation server](server-cancel-corrected.mjs.txt), [focused cancellation driver](cancel-corrected.mjs.txt), and [cancellation results](cancel-results.json).

These corrections change the experiments, not production behavior. The first two broad failures and the two lifecycle failures remain visible in their logs and original scripts. Lifecycle results retain both successes and failures; their checks are not collectively reported as a green run.

## Coverage of criteria

Touched systems: domain replay and reconciliation; checkpoint writer port, executor completion/parking, recovery and read fallback; SQLite schema/migration/decoding; REST current-thread and error isolation; MCP tools; inspector reconstruction, resumed-attempt following, lifecycle metadata, reconnect, reload, responsive and keyboard controls; replay forks and child runs; upgrade and operator documentation.

| System / case                    | Steps                                                                                                                                                      | Expected                                                                                                   | Actual                                                                                                                                                                                              | Result / evidence                                                                                                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission/build                  | Check exact HEAD, branch, dependencies; Node 22; `pnpm.cmd build`                                                                                          | Assigned head and supported built artifacts                                                                | Exact assigned head, populated dependencies; 11 successful build tasks                                                                                                                              | PASS: [environment](environment.log.txt), [build](build.log.txt), [exit](build-exit.log.txt)                                                                                                                                                               |
| B1 delayed other-node duplicate  | Stop executor; admit run; append A start/finish, B start, duplicate finish(A); write honest sequence-5 snapshot/state; append finish(B)                    | B stays open at checkpoint; completion applies once everywhere                                             | Six events; state `{strict:true,openNodeId:'b'}`; REST, MCP, full replay, desktop and narrow inspector all return `items:['a','b']`; raw run/events hashes unchanged                                | PASS: [driver](duplicate-browser-corrected.mjs.txt), [result](duplicate-browser-corrected.json), [desktop](duplicate-browser-corrected.png), [390 px](duplicate-390.png)                                                                                   |
| B1 actual recovery writer        | Fail real execution at work; append duplicate completion for prepare; mark for recovery; restart manager with writes enabled; append later work completion | Recovery records work open and later durable completion remains visible                                    | Recovery checkpoint at sequence 10 records work open; sequence 11 includes `completed:true`, ignores duplicate patch; REST/MCP/full replay/both inspector widths agree; hashes stable               | PASS: [adapted audit supplement](supplement.mjs.txt), [checkpoint and reads](recovery-duplicate.json), [browser result](recovery-duplicate.json), [1440 px](recovery-duplicate-1440.png), [390 px](recovery-duplicate-390.png), [summary](supplement.json) |
| 0017 to 0018 upgrade             | Create store with shipped migrations 0000-0017; seed current (seq 5) and lagging (seq 4) snapshots; start built API                                        | Only new column is added; no guessed state, no rewritten old history                                       | 18 old migration entries; both new state values NULL; old run columns and all event rows byte-for-byte equal                                                                                        | PASS: [driver](upgrade.mjs.txt), [before/after](upgrade.json), [results](upgrade-results.json)                                                                                                                                                             |
| Upgrade reads and next write     | Read both upgraded runs through REST and MCP, hash before/after; save next checkpoint via public repository writer; read again and reopen process          | NULL state requires full history; next writer persists proof and permits bounded reads                     | Each initial request reads all 5 rows. Next current and lagging reads decode 1 and 2 rows respectively; both return `['a','b']`; reads leave runs/events unchanged; proof survives reopen           | PASS: upgrade results and before/after above                                                                                                                                                                                                               |
| 10,001-event bound               | Append 5,000 node pairs; persist current and 200-event-lagging snapshots/state; count public event-port rows                                               | Full replay parity; 1 / 201 rows per request                                                               | REST and MCP each read exactly 1 / 201 rows; final `count:5000`, visits 5000; row/event hashes stable                                                                                               | PASS: [driver](broad.mjs.txt), [counted measurements](bounded.json)                                                                                                                                                                                        |
| Built MCP stdio                  | Spawn `apps/mcp/dist/main.js` with explicit disposable API URL; list tools and read the six-event B1 thread                                                | Native MCP process agrees with REST/full replay                                                            | `get_run_thread` returns `items:[a,b]`; counted reads and hashes agree                                                                                                                              | PASS: [driver](stdio.mjs.txt), [results](stdio-results.json), [diagnostics](stdio-server.log.txt), [log](stdio.log.txt)                                                                                                                                    |
| Damaged replay state             | SQL-inject malformed JSON and seven wrong shapes into one disposable run; read it and healthy neighbor                                                     | Clear error, no invented thread, independent healthy run readable, no read repair                          | All 8 cases return 500 `STORED_RUN_INVALID` with malformed/invalid `thread_snapshot_replay_state` detail; healthy requests succeed; whole runs/events unchanged                                     | PASS: [focused driver](damage-fallback.mjs.txt), [results](damage-fallback-results.json)                                                                                                                                                                   |
| Proven and unproven boundaries   | Checkpoint at starts/completions; remove boundary event; also set sequence NULL or state NULL                                                              | Bound only with stored proof and first returned matching sequence; otherwise use admitted seed/full prefix | Proven boundaries read 4/3/2/1 rows; unsequenced/no-state read all 5. Missing seq 4 first reads seq 5, then all 4 remaining rows; returns actual replay prefix without B's missing start; no repair | PASS: damage/fallback results                                                                                                                                                                                                                              |
| Failure with delayed snapshots   | Trigger -> prepare -> failing controlled script; open inspectors                                                                                           | Unfinished script patch excluded; one work visit; all surfaces agree                                       | failed, seq 9, `{prepared:true}`, work visits 1; both headers/cursors/full threads agree                                                                                                            | PASS: [failure capture](lifecycle-failed.json), [1440](lifecycle-failed-1440.png), [390](lifecycle-failed-390.png)                                                                                                                                         |
| Native API restart/reconnect     | Keep both tabs open; orderly close old API; observe failed network requests; start new PID on same physical store                                          | Existing tabs reconnect without reopening                                                                  | PID 42764 -> 22344; both tabs observe `ERR_CONNECTION_REFUSED`; failed status/cursor 9/thread converge after restart                                                                                | PASS: [restart record](lifecycle-results.json), [capture](lifecycle-restarted.json), [1440](lifecycle-restarted-1440.png), [390](lifecycle-restarted-390.png)                                                                                              |
| Held resume and reload           | Resume failed run into held work; compare REST/MCP/UI; reload 390-px tab while held                                                                        | Two visits, no completion patch, existing/reloaded tabs agree                                              | running, seq 11, `{prepared:true}`, work visits 2; both lifecycle headers, selected cursor and entire threads agree                                                                                 | PASS: [held](lifecycle-held.json), [reload](lifecycle-reloaded.json), four linked screenshots in inventory                                                                                                                                                 |
| Success despite delayed snapshot | Release script; wait idle; compare surfaces, then flush delayed writes                                                                                     | Completed patch appears once; reads never write state                                                      | succeeded, seq 18, `{prepared:true,completed:true}`, work visits 2; all surfaces agree. Flushed executor checkpoint records `{strict:true}`; reads remain equal and immutable                       | PASS: [success](lifecycle-success.json), [1440](lifecycle-success-1440.png), [390](lifecycle-success-390.png), lifecycle results                                                                                                                           |
| Four checkpoint types            | Use real executed node.started, node.finished, run.finished boundaries; execute actual wait and retain run.waiting snapshot before input                   | Parity through each boundary; parked writer records open wait                                              | Started/finished/terminal cases match full replay. Actual waiting seq 6 snapshot records `{strict:true,openNodeId:'wait'}`; parked read is 1 row, post-input tail is 10 rows and matches replay     | PASS: lifecycle results                                                                                                                                                                                                                                    |
| Replay fork                      | Execute successful source; `POST /runs/{id}/replay` with nodeId work; compare fork seed/results and source hashes                                          | Inherited pre-work seed, own run identity, one new work visit; source unchanged                            | Fork vars prepared/completed, work visits 1; seed has prepared and no prior work visit; source raw row/events unchanged                                                                             | PASS: [fork](fork.json), [supplement](supplement.json)                                                                                                                                                                                                     |
| Child run                        | Execute parent subloop with controlled child mutation                                                                                                      | Child identity/context isolated; parent receives mapped return                                             | Child `childOnly:73`; parent `childResult:{childOnly:73}`; different IDs; REST/MCP/full replay agree                                                                                                | PASS: [focused child results](child-results.json)                                                                                                                                                                                                          |
| Cancellation                     | Hold script via request.signal; cancel through REST; allow handler cancellation                                                                            | No unfinished returned patch                                                                               | cancelled seq 9; `{prepared:true}`, work visits 1; REST/MCP/replay agree; stored bytes unchanged                                                                                                    | PASS: [focused cancellation](cancel-results.json)                                                                                                                                                                                                          |
| Concurrent readers               | Six paced readers while 100 start/finish pairs append; move checkpoint every 10 pairs                                                                      | No per-reader regressions, no fabricated completion, final replay parity                                   | 262 responses (44/44/44/44/43/43), no errors; visit count is completed count or one open visit; final count/visits 100                                                                              | PASS: [driver](broad.mjs.txt), [values](concurrency.json)                                                                                                                                                                                                  |
| Negative run IDs                 | GET malformed and valid-looking missing IDs                                                                                                                | Validation / not found                                                                                     | HTTP 400 / 404                                                                                                                                                                                      | PASS: duplicate result                                                                                                                                                                                                                                     |
| Repository Edge regression       | Run unchanged default harness/spec once with retries 0                                                                                                     | Observed failed poll before restored connectivity; open/reloaded views agree                               | 1 passed in 2.0m; retained outage `ERR_INTERNET_DISCONNECTED`; all three phases match API and preserve stored bytes                                                                                 | PASS: [log](default-browser.log.txt), [observations](default-browser.json), [exit](default-browser-exit.log.txt)                                                                                                                                           |
| Narrow/keyboard inspector        | Use full thread JSON; focus its button, Enter, Tab                                                                                                         | Thread readable and keyboard reaches next inspector control                                                | 390-px captures show complete expected values; next focused control is Node progress button                                                                                                         | PASS: screenshots, lifecycle results                                                                                                                                                                                                                       |
| Docs/upgrade note                | Compare observed migration/writer/read behavior with ADR-0053 and CHANGELOG #116                                                                           | Describe NULL-state upgrade, proof contract, bounded and fallback paths accurately                         | Upgrade behavior and 1/201-row structural claim reproduced. saveThread requires sequence/state; no historical backfill or read-side repair claimed                                                  | PASS: [assigned diff](assigned-diff.patch.txt), upgrade and bounded results                                                                                                                                                                                |

#116 AC1 and AC2 are **tested and passed** for the specified persisted histories, lifecycle transitions, delayed writes, existing/reloaded/reconnected tabs, REST/MCP agreement, no unfinished patches, and read immutability. #308's history-agreement outcome is exercised only at #116's scope. #289's other paging, summaries, evidence browsing and finalization bolts are not accepted by this QA.

Not tested: live Codex/Claude/Jev providers; Linux/POSIX behavior; arbitrary corruption of otherwise shape-valid proof; indefinite endurance or a latency SLA; forced native process-tree termination. **D-015:** native process-tree termination is denied by the supplied sandbox constraint. Orderly process replacement is independently exercised; it does not qualify force-kill behavior. No manual tree-kill command was issued. Package tests' actual native-process results are retained with the gates. Full infrastructure coverage reported the untouched child/grandchild abort case timing out at 30,134 ms, then produced no further console result before I interrupted it. Quiet output did not establish a stalled process; the full run is incomplete because of that interruption. Its one isolated rerun failed the same test at 30,201 ms (19 passed / 1 failed). Both logs are retained; this is a testable failure under the supplied D-015 limit, not proof of a new #116 defect. The eight focused SQLite files passed 147 tests.

## Gates

The completed commands were launched with Node 22 first on PATH; package coverage bypasses Turbo caching. No threshold, denominator, timeout, maintained test, or exclusion was changed. A failed untouched timing test gets one isolated file rerun, with both outcomes retained, rather than another broad suite. The command record is [gates.json](gates.json); complete results are appended below.

No dependency or public node/route schema changed, so check:licenses and check:docs were not required. The new SQLite schema is checked by check:migrations. Root lint/dependency checks retain their existing nonfatal warnings; exact output is in the linked logs. No ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK has been observed, so no direct-binary fallback has been used.

## Evidence and reproduction

Scripts are retained as `.mjs.txt`. Copy the desired driver and the server version it used to a fresh `%TEMP%\gg-qa-g1-116-2-*` directory with `.mjs` filenames; set `AUDIT_ROOT` to this worktree and Node 22 first on PATH, then run the driver. The server filename expected by each driver is `audit-server.mjs`. `setup.mjs.txt` documents the adaptations to the two supplied audit reproducers. The supplement and initial broad/lifecycle use server.mjs.txt; corrected damage/upgrade/child use server-corrected.mjs.txt; cancellation and stdio use server-cancel-corrected.mjs.txt. The retained prepare.mjs.txt is an unexecuted preliminary setup draft; setup.mjs.txt is the setup actually run. Helper assembly scripts retain exactly how each complete driver was formed. The default browser command is `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/thread-history.spec.ts --retries=0 --output <temporary-output>` with `GG_E2E_BROWSER_CHANNEL=msedge` and `GG_THREAD_EVIDENCE=<temporary-json>`.

Local user paths in retained text are normalized to `%USERPROFILE%`; command logs are normalized from PowerShell output encodings where needed. An early collector pass mishandled UTF-16 logs and met open-log EBUSY errors; the retained logs affected by that pass are normalized readable records, not original terminal bytes. Structured gate exit records and copied fresh coverage totals support the numerical results independently. [Evidence-handling notes](evidence-handling-notes.log.txt) retain these limitations. Hashes in scenario JSON describe the raw selected SQLite rows/event rows at observation time. Final artifact hashes describe the retained normalized bytes. [NOT-KEPT.md](NOT-KEPT.md) inventories temporary stores and unretained browser bundles, with sizes and SHA-256. No directories were deleted. Coverage/report/test-result directories remain for orchestrator cleanup.

## Observations outside scope

- The append patch panel displays absent Before/After values for `/vars/items/-`, while the full thread correctly contains `['a','b']`. This was visible in [duplicate desktop](duplicate-browser-corrected.png) and [narrow](duplicate-390.png) captures and is rendered through apps/web/src/runs/inspector/ThreadViewer.tsx:126 (patchDiff). It belongs to #255; no repair was made.
- D-015/native cases: adversarial child/grandchild timeout; script cancellation requiring fixture cleanup and two timeout/abort cases; Claude fixture descendants still writing after cancellation, EBUSY cleanup, and readiness reporting unconfirmed termination instead of a normal deadline. These files are unchanged by the assigned diff. Their full and one isolated result are retained. Live providers and native process-tree shutdown are unqualified. Disposable fixture directories/descendants could not be independently certified cleaned; no manual tree kill or directory deletion was performed.
- Non-native format-cutover timeouts above remain unexplained and require orchestrator disposition. The requested 0017-to-0018 snapshot migration and its read/write/reopen cases passed independently; that does not waive the broader gate.
- Other #308/#289 bolts and integrated I01-I07 acceptance remain separate.

## Retained artifact inventory

Inventory and final gate tables are generated below after evidence collection.

<!-- FINAL-GATES -->

## Final gate records

| Command                                                                                                                                                                                                                                                                                                                                                   | Result                                                                                                                                                         | Evidence                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                                                                                                                                                                                                                      | PASS; 119.02 s                                                                                                                                                 | [typecheck.log.txt](typecheck.log.txt)                                                         |
| `pnpm.cmd lint`                                                                                                                                                                                                                                                                                                                                           | PASS; 144.75 s                                                                                                                                                 | [lint.log.txt](lint.log.txt)                                                                   |
| `pnpm.cmd format:check`                                                                                                                                                                                                                                                                                                                                   | PASS; 468.78 s                                                                                                                                                 | [format-check.log.txt](format-check.log.txt)                                                   |
| `pnpm.cmd check:layers`                                                                                                                                                                                                                                                                                                                                   | PASS; 0.64 s                                                                                                                                                   | [layers.log.txt](layers.log.txt)                                                               |
| `pnpm.cmd check:deps`                                                                                                                                                                                                                                                                                                                                     | PASS; 14.49 s                                                                                                                                                  | [deps.log.txt](deps.log.txt)                                                                   |
| `pnpm.cmd check:tokens`                                                                                                                                                                                                                                                                                                                                   | PASS; 1.81 s                                                                                                                                                   | [tokens.log.txt](tokens.log.txt)                                                               |
| `pnpm.cmd check:migrations`                                                                                                                                                                                                                                                                                                                               | PASS; 4.44 s                                                                                                                                                   | [migrations.log.txt](migrations.log.txt)                                                       |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`                                                                                                                                                                                                                                                                                                     | PASS; 33.17 s                                                                                                                                                  | [domain-coverage.log.txt](domain-coverage.log.txt)                                             |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                                                                                                                                                                                                                                                                     | PASS; 99.46 s                                                                                                                                                  | [engine-coverage.log.txt](engine-coverage.log.txt)                                             |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/checkpoint-state.test.ts src/sqlite/catalog.test.ts src/sqlite/delivery-runs.test.ts src/sqlite/history-summaries.test.ts src/sqlite/json-values.test.ts src/sqlite/loop-deletion.test.ts src/sqlite/storage.test.ts src/sqlite/webhook-receipt-upgrade.test.ts --maxWorkers=1` | PASS; 127.31 s                                                                                                                                                 | [sqlite-focused.log.txt](sqlite-focused.log.txt)                                               |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage --maxWorkers=1`                                                                                                                                                                                                                                                                                         | PASS; 101.89 s                                                                                                                                                 | [mcp-coverage.log.txt](mcp-coverage.log.txt)                                                   |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2`                                                                                                                                                                                                                                                                                         | PASS; 1672.76 s                                                                                                                                                | [web-coverage.log.txt](web-coverage.log.txt)                                                   |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2`                                                                                                                                                                                                                                                                                         | PASS; 742.16 s                                                                                                                                                 | [api-coverage.log.txt](api-coverage.log.txt)                                                   |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/adversarial.test.ts --maxWorkers=1`                                                                                                                                                                                                                                                    | FAIL (exit 1); 89.42 s                                                                                                                                         | [infrastructure-adversarial-isolated.log.txt](infrastructure-adversarial-isolated.log.txt)     |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --reporter=verbose --coverage.reportOnFailure`                                                                                                                                                                                                                                | FAIL (exit 1); 290.45 s                                                                                                                                        | [infrastructure-complete.log.txt](infrastructure-complete.log.txt)                             |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts --maxWorkers=1`                                                                                                                                                                                                                                                 | FAIL (exit 1); 159.29 s                                                                                                                                        | [isolated-src-sqlite-upgrade-test-ts.log.txt](isolated-src-sqlite-upgrade-test-ts.log.txt)     |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/scripts.test.ts --maxWorkers=1`                                                                                                                                                                                                                                                | FAIL (exit 1); 51.82 s                                                                                                                                         | [isolated-src-process-scripts-test-ts.log.txt](isolated-src-process-scripts-test-ts.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/process.test.ts --maxWorkers=1`                                                                                                                                                                                                                                                 | FAIL (exit 1); 38.33 s                                                                                                                                         | [isolated-src-claude-process-test-ts.log.txt](isolated-src-claude-process-test-ts.log.txt)     |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/readiness.test.ts --maxWorkers=1`                                                                                                                                                                                                                                               | FAIL (exit 1); 29.36 s                                                                                                                                         | [isolated-src-claude-readiness-test-ts.log.txt](isolated-src-claude-readiness-test-ts.log.txt) |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1`                                                                                                                                                                                                                                                                              | INCOMPLETE: native child/grandchild test failed; first run was interrupted after its native failure; quiet output did not establish a stall, no final coverage | [log](infrastructure-coverage.log.txt), [interruption](infrastructure-interruption.json)       |

[Fresh coverage totals](coverage-totals.json). The full infrastructure gate and its measured coverage are distinct: reporting on failure does not turn a failed suite green. The focused SQLite selection and isolated native-file rerun remain separate commands.

## Package coverage

| Package        | Full test gate |              Lines |           Branches |
| -------------- | -------------- | -----------------: | -----------------: |
| domain         | passed         | 98.48% (2012/2043) | 95.79% (2280/2380) |
| engine         | passed         | 98.06% (2538/2588) | 92.95% (2150/2313) |
| infrastructure | failed         | 98.74% (2201/2229) | 95.12% (1797/1889) |
| mcp            | passed         |   96.66% (232/240) |   95.39% (207/217) |
| web            | passed         | 98.91% (7491/7573) | 94.93% (7773/8188) |
| api            | passed         | 97.99% (1853/1891) | 92.99% (1301/1399) |

## All retained artifacts

- [NOT-KEPT.md](NOT-KEPT.md)
- [api-coverage-summary.json](api-coverage-summary.json)
- [api-coverage.log.txt](api-coverage.log.txt)
- [artifact-hashes.json](artifact-hashes.json)
- [assemble-cancel.mjs.txt](assemble-cancel.mjs.txt)
- [assemble-child.mjs.txt](assemble-child.mjs.txt)
- [assemble-lifecycle.mjs.txt](assemble-lifecycle.mjs.txt)
- [assemble-stdio.mjs.txt](assemble-stdio.mjs.txt)
- [assemble-upgrade.mjs.txt](assemble-upgrade.mjs.txt)
- [assemble.mjs.txt](assemble.mjs.txt)
- [assigned-diff.patch.txt](assigned-diff.patch.txt)
- [bounded.json](bounded.json)
- [broad-body.mjs.txt](broad-body.mjs.txt)
- [broad-exit.log.txt](broad-exit.log.txt)
- [broad.log.txt](broad.log.txt)
- [broad.mjs.txt](broad.mjs.txt)
- [build-exit.log.txt](build-exit.log.txt)
- [build.log.txt](build.log.txt)
- [cancel-corrected.log.txt](cancel-corrected.log.txt)
- [cancel-corrected.mjs.txt](cancel-corrected.mjs.txt)
- [cancel-exit.log.txt](cancel-exit.log.txt)
- [cancel-results.json](cancel-results.json)
- [child-corrected.log.txt](child-corrected.log.txt)
- [child-corrected.mjs.txt](child-corrected.mjs.txt)
- [child-exit.log.txt](child-exit.log.txt)
- [child-results.json](child-results.json)
- [collect.mjs.txt](collect.mjs.txt)
- [concurrency.json](concurrency.json)
- [correct-fixtures.mjs.txt](correct-fixtures.mjs.txt)
- [coverage-totals.json](coverage-totals.json)
- [damage-fallback-exit.log.txt](damage-fallback-exit.log.txt)
- [damage-fallback-progress.json](damage-fallback-progress.json)
- [damage-fallback-results.json](damage-fallback-results.json)
- [damage-fallback.log.txt](damage-fallback.log.txt)
- [damage-fallback.mjs.txt](damage-fallback.mjs.txt)
- [default-browser-exit.log.txt](default-browser-exit.log.txt)
- [default-browser.json](default-browser.json)
- [default-browser.log.txt](default-browser.log.txt)
- [deps.log.txt](deps.log.txt)
- [domain-coverage-summary.json](domain-coverage-summary.json)
- [domain-coverage.log.txt](domain-coverage.log.txt)
- [duplicate-390.png](duplicate-390.png)
- [duplicate-browser-corrected.json](duplicate-browser-corrected.json)
- [duplicate-browser-corrected.mjs.txt](duplicate-browser-corrected.mjs.txt)
- [duplicate-browser-corrected.png](duplicate-browser-corrected.png)
- [duplicate-exit.log.txt](duplicate-exit.log.txt)
- [duplicate.log.txt](duplicate.log.txt)
- [engine-coverage-summary.json](engine-coverage-summary.json)
- [engine-coverage.log.txt](engine-coverage.log.txt)
- [environment.log.txt](environment.log.txt)
- [evidence-handling-notes.log.txt](evidence-handling-notes.log.txt)
- [final-audit.json](final-audit.json)
- [final-audit.mjs.txt](final-audit.mjs.txt)
- [finalize.mjs.txt](finalize.mjs.txt)
- [fork.json](fork.json)
- [format-check.log.txt](format-check.log.txt)
- [gates-rest.json](gates-rest.json)
- [gates-rest.ps1.txt](gates-rest.ps1.txt)
- [gates.json](gates.json)
- [gates.ps1.txt](gates.ps1.txt)
- [infrastructure-adversarial-isolated.json](infrastructure-adversarial-isolated.json)
- [infrastructure-adversarial-isolated.log.txt](infrastructure-adversarial-isolated.log.txt)
- [infrastructure-complete.json](infrastructure-complete.json)
- [infrastructure-complete.log.txt](infrastructure-complete.log.txt)
- [infrastructure-coverage-summary.json](infrastructure-coverage-summary.json)
- [infrastructure-coverage.log.txt](infrastructure-coverage.log.txt)
- [infrastructure-interruption.json](infrastructure-interruption.json)
- [instructions-COMMON.md.txt](instructions-COMMON.md.txt)
- [instructions-QA-COMMON.md.txt](instructions-QA-COMMON.md.txt)
- [isolated-reruns.ps1.txt](isolated-reruns.ps1.txt)
- [isolated-src-claude-process-test-ts.log.txt](isolated-src-claude-process-test-ts.log.txt)
- [isolated-src-claude-readiness-test-ts.log.txt](isolated-src-claude-readiness-test-ts.log.txt)
- [isolated-src-process-scripts-test-ts.log.txt](isolated-src-process-scripts-test-ts.log.txt)
- [isolated-src-sqlite-upgrade-test-ts.log.txt](isolated-src-sqlite-upgrade-test-ts.log.txt)
- [isolation-results.json](isolation-results.json)
- [layers.log.txt](layers.log.txt)
- [lifecycle-body.mjs.txt](lifecycle-body.mjs.txt)
- [lifecycle-exit.log.txt](lifecycle-exit.log.txt)
- [lifecycle-failed-1440.png](lifecycle-failed-1440.png)
- [lifecycle-failed-390.png](lifecycle-failed-390.png)
- [lifecycle-failed.json](lifecycle-failed.json)
- [lifecycle-held-1440.png](lifecycle-held-1440.png)
- [lifecycle-held-390.png](lifecycle-held-390.png)
- [lifecycle-held.json](lifecycle-held.json)
- [lifecycle-reloaded-1440.png](lifecycle-reloaded-1440.png)
- [lifecycle-reloaded-390.png](lifecycle-reloaded-390.png)
- [lifecycle-reloaded.json](lifecycle-reloaded.json)
- [lifecycle-restarted-1440.png](lifecycle-restarted-1440.png)
- [lifecycle-restarted-390.png](lifecycle-restarted-390.png)
- [lifecycle-restarted.json](lifecycle-restarted.json)
- [lifecycle-results.json](lifecycle-results.json)
- [lifecycle-success-1440.png](lifecycle-success-1440.png)
- [lifecycle-success-390.png](lifecycle-success-390.png)
- [lifecycle-success.json](lifecycle-success.json)
- [lifecycle.log.txt](lifecycle.log.txt)
- [lifecycle.mjs.txt](lifecycle.mjs.txt)
- [lint.log.txt](lint.log.txt)
- [mcp-coverage-summary.json](mcp-coverage-summary.json)
- [mcp-coverage.log.txt](mcp-coverage.log.txt)
- [migrations.log.txt](migrations.log.txt)
- [normalization.json](normalization.json)
- [paths.json](paths.json)
- [prepare.mjs.txt](prepare.mjs.txt)
- [recovery-duplicate-1440.png](recovery-duplicate-1440.png)
- [recovery-duplicate-390.png](recovery-duplicate-390.png)
- [recovery-duplicate.json](recovery-duplicate.json)
- [report-format-result.json](report-format-result.json)
- [report-format.log.txt](report-format.log.txt)
- [requirement-116.md.txt](requirement-116.md.txt)
- [requirement-289.md.txt](requirement-289.md.txt)
- [requirement-308.md.txt](requirement-308.md.txt)
- [server-22344.log.txt](server-22344.log.txt)
- [server-23152.log.txt](server-23152.log.txt)
- [server-25488.log.txt](server-25488.log.txt)
- [server-29680.log.txt](server-29680.log.txt)
- [server-31048.log.txt](server-31048.log.txt)
- [server-42764.log.txt](server-42764.log.txt)
- [server-45168.log.txt](server-45168.log.txt)
- [server-49540.log.txt](server-49540.log.txt)
- [server-5544.log.txt](server-5544.log.txt)
- [server-61400.log.txt](server-61400.log.txt)
- [server-9728.log.txt](server-9728.log.txt)
- [server-cancel-corrected.mjs.txt](server-cancel-corrected.mjs.txt)
- [server-corrected.mjs.txt](server-corrected.mjs.txt)
- [server.mjs.txt](server.mjs.txt)
- [setup.mjs.txt](setup.mjs.txt)
- [sqlite-focused.log.txt](sqlite-focused.log.txt)
- [stdio-exit.log.txt](stdio-exit.log.txt)
- [stdio-results.json](stdio-results.json)
- [stdio-server.log.txt](stdio-server.log.txt)
- [stdio.log.txt](stdio.log.txt)
- [stdio.mjs.txt](stdio.mjs.txt)
- [supplement-exit.log.txt](supplement-exit.log.txt)
- [supplement.json](supplement.json)
- [supplement.log.txt](supplement.log.txt)
- [supplement.mjs.txt](supplement.mjs.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [upgrade-body.mjs.txt](upgrade-body.mjs.txt)
- [upgrade-exit.log.txt](upgrade-exit.log.txt)
- [upgrade-results.json](upgrade-results.json)
- [upgrade.json](upgrade.json)
- [upgrade.log.txt](upgrade.log.txt)
- [upgrade.mjs.txt](upgrade.mjs.txt)
- [verified-environment.json](verified-environment.json)
- [web-coverage-summary.json](web-coverage-summary.json)
- [web-coverage.log.txt](web-coverage.log.txt)
- [README.md](README.md)
- [artifact-hashes.json](artifact-hashes.json)
