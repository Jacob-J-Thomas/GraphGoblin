# Independent QA: WP-G1 bolt #116

## Verdict

**PASS at `d7371f25b87ee4d474d1bb75258a851e3cde648f`.** No production defect was found in the completed checks. This is independent QA of PR #397, not implementation, review, merge approval, issue closure, or integrated I07 acceptance.

Branch: `codex-qa-wp-g1-116`. Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-g1-116`. No production code, maintained test files, Git index, commits, branches, dependencies, owner instance, or GitHub records were changed. All source additions are evidence in this folder. No sub-agents were used.

**Fake-only execution:** real built API processes, physical disposable SQLite stores, loopback HTTP, MCP SDK transport, and Microsoft Edge; script behavior was supplied through the supported `ScriptPort`, with a `FakeHarness` available at composition. No provider turn occurred. Snapshot delays use a repository subclass at composition, and event counting uses an `EventStorePort` wrapper. Nothing patches the component under test. An independent full replay starts from the stored admitted seed and implements the fixture's JSON Patch operations separately from domain replay.

The build used Node `v22.14.0`, with Node 22 first on PATH, and completed all 11 tasks in 2m7.444s (one cache hit). Dependencies were already populated; no install or cross-checkout link was needed. The pinned HEAD was verified before testing. Disposable HTTP ports were 5870, 5871, 5872, and 5873. All data and executable-script directories use the `gg-qa-g1-116-` prefix under system temp. The owner's ports 4747/4748 and store were not accessed. API keys were created by the built binary and redacted from retained output.

## Defects

No blocker, major, or minor production defect was reproduced.

Two **QA harness errors** remain visible in the original evidence and do not count as successful tests:

1. The original replay-fork check expected two visits to `work` and observed one. Replay deliberately forks before the node's **first** start. The source's resumed visit count must not become the fork's starting visit count. The original assertion failure is retained in `results.json` and `run.log.txt`; the separate corrected experiment retains the fork's actual seed, full event history, returned thread, and unchanged source hashes in `fork-corrected.json`.
2. The original unpaced load experiment (six continuous readers, no sequenced checkpoint, 1,500 separately committed node pairs) exceeded its harness's 120-second IPC deadline. An unhandled rejected promise then terminated the runner before a load result or final cleanup record was saved. Its stdout/error and source are retained. This is **incomplete evidence**, not a product timing verdict. The replacement experiment changes the experiment: 12 bounded append windows, six paced readers, current/lagging honest checkpoints, known committed watermarks, and post-GC memory samples. Its separate result is retained in `load-bounded.json`. These results do not establish an SLA, indefinite leak freedom, or throughput for native node execution.

The supplemental harness also has an explicit 180-second cleanup deadline. Its queued measurement run is deliberately admitted with its executor stopped; the server helper's `waitForIdle()` can therefore wait on queued work during cleanup. This is a harness cleanup limitation. Disposable process and port absence is checked separately at the end; no production shutdown conclusion is drawn from this helper.

The final report audit exposed a weakness in the original observer: it waited for full-thread equality but not lifecycle metadata or the selected event cursor. Of its 20 frames, 17 have an agreeing lifecycle header, one has an explicit Offline header, two have stale lifecycle headers, and 19 have the expected event cursor. All 20 reconstructed threads match REST. These are retained observations, not 20 complete status/cursor passes. Two failed report-audit assertions and their original sources are retained.

A new focused native-process/Edge experiment strengthens the wait to require the expected lifecycle header, selected durable cursor, and full thread together. All five phases passed in four tabs (two at each width), including an API process restart and midway reload. The 20 new captures all agree across status, cursor, thread, REST and MCP, with unchanged stored bytes. The held-resume observation took 6.530 seconds across all four tabs; this includes polling/capture overhead. The 60-second observation bound was chosen to cover ADR-0053's maximum 30-second reconnect delay with margin; it is a QA parameter, not an owner-approved product SLA. This establishes observed convergence and excludes a persistent disagreement in this experiment. It does not claim atomic UI/REST updates or erase the initial transient frames.

## Systems and checks

Touched systems: domain replay/reconciliation and package exports; engine execution/resume/recovery and checkpoint reads; SQLite run snapshots and durable events; REST thread/status/error handling; MCP `get_run_thread` and `get_run`; inspector event following, reconstructed threads, metadata, reload/reconnect, and responsive controls; replay seeds and subloop composition; operator documentation and CHANGELOG. The actual MCP tool is named `get_run_thread`, rather than `get_thread`; the discovered tool names are retained.

Every PASS below comes from the pinned product and the retained independent experiments. Existing implementer measurements are identified as claims and used only for comparison.

| Case / system                                 | Steps                                                                                                                                                                                | Expected                                                                                             | Actual                                                                                                                                                                                   | Result / evidence                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admission and build                           | Verify HEAD and populated `node_modules`; select Node 22; run `pnpm.cmd build`                                                                                                       | Exact assigned revision; supported runtime; built apps before launch                                 | Exact HEAD; Node v22.14.0; 11 successful build tasks                                                                                                                                     | PASS — `environment.log.txt`, `build.log.txt`                                                                                                    |
| Failure: engine, SQLite, REST, MCP, inspector | Run trigger → mutate → failing script → exit with delayed snapshots; observe four Edge tabs                                                                                          | Failure excludes returned script patch; one work visit; all surfaces converge                        | Event 9, failed, vars `{prepared:true}`, work visits 1; strict headers, cursors and complete threads agree                                                                               | PASS — `strict-failed.json`, strict failure screenshots; original `failed.json` also retained                                                    |
| Read immutability at every browser stage      | Hash exact stored snapshot text/sequence, entire raw run row, and ordered raw event rows before and after REST, MCP and inspector reads while execution is quiescent/held            | Reads change none of those bytes                                                                     | All three before/after hashes match at failure, restart, held resume, midway reload and success                                                                                          | PASS — five stage JSON captures                                                                                                                  |
| Initial inspector metadata observations       | Inspect all original headers and cursors                                                                                                                                             | Do not infer status/cursor agreement from thread equality                                            | 17 agreeing headers, 1 explicit Offline header, 2 stale headers; 19 expected cursors; all 20 threads agree                                                                               | Recorded transients, not complete metadata PASS — `ui-metadata-check.json`, original stage captures                                              |
| Real process restart and reconnect            | Keep four tabs open while replacing native API process on same physical store; then resume and succeed                                                                               | All tabs converge without reopening                                                                  | Original PID 60876 → 59304; strict experiment PID 3644 → 21328 on port 5873. All strict headers/cursors/threads agree after restart and through later resume/success                     | PASS — `strict-native-processes.json`, five strict stage captures and screenshots; initial restart capture retains transient offline/error state |
| Resume with unfinished work                   | Resume into held fake script; wait for lifecycle, cursor and thread together                                                                                                         | Only work visit increases; no completion patch                                                       | Event 11, running, vars `{prepared:true}`, work visits 2; REST/MCP/four strict views agree after observation; 6.530 s for four-tab check                                                 | PASS — `strict-resumed-unfinished.json`, strict screenshots; original transient stale header retained separately                                 |
| Reload midway                                 | Reload one tab at each width during held resumed script                                                                                                                              | Full thread, running status and event cursor agree with existing tabs                                | Event 11 and entire thread/status agree in all four strict tabs and REST/MCP; bytes unchanged                                                                                            | PASS — `strict-midway-reload.json`, screenshots                                                                                                  |
| Success after failure/resume/restart          | Release held script and wait for all three inspector values                                                                                                                          | Completion patch once; full terminal state follows earlier failure                                   | Event 18, succeeded, vars `{prepared:true,completed:true}`, work visits 2; REST/MCP/all strict tabs agree                                                                                | PASS — `strict-succeeded.json`, screenshots; initial lagging narrow-view frame retained separately                                               |
| Narrow viewport and keyboard                  | Run at 1440×1000 and 390×1000; focus full-thread disclosure and toggle twice with Enter                                                                                              | Controls usable; JSON disclosure keyboard accessible; no document overflow                           | Disclosure closes/reopens; document overflow false at both widths; screenshots visually inspected                                                                                        | PASS — `results.json`, desktop success and narrow held-resume screenshots                                                                        |
| Negative REST/auth/control inputs             | Invalid ULID; valid missing ULID; unauthenticated thread request; resume already successful run                                                                                      | 400, 404, 401, 409; successful run unchanged                                                         | Exact expected statuses; stored snapshot, run row and events unchanged                                                                                                                   | PASS — `negative.json`                                                                                                                           |
| Current and lagging bounded reads             | Persist 5,000 controlled start/finish pairs on an admitted run; install honest current and 200-event-lagging checkpoints; one warm-up and five measured HTTP reads per case          | Full replay equality; exactly boundary plus tail rows                                                | 10,001 events; 1 and 201 rows; HTTP medians 5.639 ms and 10.971 ms; snapshot bytes unchanged                                                                                             | PASS — `bounded-read.json`                                                                                                                       |
| Checkpoint proof boundaries                   | Install honest full-replay checkpoints at actual `node.started`, `run.waiting`, `node.finished`, and `run.finished` events; read through REST                                        | Read equals seed plus full replay, without prefix read at proven boundaries                          | All four compare equal; exactly one read starts at checkpoint sequence minus 1                                                                                                           | PASS — `boundaries.json`                                                                                                                         |
| Waiting checkpoint with a later completion    | Checkpoint an actual parked wait; provide input using observed wait ID; delay subsequent snapshots; read after success                                                               | Open visit at waiting boundary permits its later finished patch                                      | Checkpoint 6, final event 15; output `{answer:42}`; returned thread equals full replay; snapshot unchanged                                                                               | PASS — `waiting-tail.json`                                                                                                                       |
| Recovery-written checkpoint                   | Simulate lost status write through public repository update after durable failure; restart manager; allow actual recovery snapshot write                                             | Recovery failure boundary is ambiguous, so read full history and agree with replay                   | Checkpoint at `run.failed` event 9; boundary read plus full 9-event fallback; read does not write                                                                                        | PASS — `recovery.json`                                                                                                                           |
| Resume from recovery-written checkpoint       | Repeat recovery, then resume successfully with later snapshot writes delayed                                                                                                         | Ambiguous boundary fallback includes resumed completion once                                         | Failure checkpoint remains 9; final event 18; vars `{prepared:true,completed:true}` and work visits 2 agree with full replay                                                             | PASS — `recovery-tail.json`                                                                                                                      |
| Missing and unsequenced checkpoint negatives  | Write an unsequenced snapshot, then an impossible sequence 999999 through the repository interface                                                                                   | Use admitted seed and complete durable log; do not repair storage on read                            | Both read the full prefix and return the full replay; snapshot hash unchanged                                                                                                            | PASS — `fallback.json`                                                                                                                           |
| Replay fork                                   | Fork at `work` before its first visit; execute with delayed snapshots; compare own seed/history and original raw hashes                                                              | Own run identity and replay seed; completed value present; original unchanged                        | Corrected fork has inherited prepared var, no seeded work visit, one completed work visit, distinct run ID; all source hashes unchanged                                                  | PASS — `fork-corrected.json`; original incorrect assertion retained separately                                                                   |
| Subloop child                                 | Start parent with fresh child input and result mapping; delay snapshots in both; compare REST and MCP for each run                                                                   | Each reconciles its own identity/seed; child result reaches parent                                   | One child; child vars `{childOnly:73}`; parent has `childResult` and no leaked top-level `childOnly`; both full threads agree                                                            | PASS — `children.json`                                                                                                                           |
| Cancellation while parked                     | Cancel an input wait; poll thread repeatedly                                                                                                                                         | No invented input patch; visits preserved; reads immutable                                           | Status cancelled; full replay equality and unchanged run/event/snapshot hashes                                                                                                           | PASS — `cancelled.json`                                                                                                                          |
| Cancellation during unfinished resumed script | Fail, resume into blocked script, cancel, release the fake script's patch                                                                                                            | Completed patch absent despite fake return; second visit remains                                     | Status cancelled; vars `{prepared:true}`, work visits 2; stored bytes unchanged by read                                                                                                  | PASS — `cancel-resumed.json`                                                                                                                     |
| Load and bounded memory observation           | Six readers with 20 ms pacing; 12 windows of 100 start/finish pairs; alternate current/100-event-lagging checkpoints; compare responses to committed watermark and previous response | No stale/regressing prefix; valid unfinished counter; final replay equality; memory samples recorded | 2,401 events, 1,027 requests in 8.644 s; no watermark/regression/count failures; final value 1199; post-GC heap growth 837,784 bytes                                                     | PASS within finite experiment — `load-bounded.json`; original deadline experiment remains incomplete                                             |
| Strict complete browser observation           | Five phases, four tabs at 1440 and 390 px; require lifecycle badge, event cursor and full thread together                                                                            | All 20 stabilized captures agree, reads do not write                                                 | Five phase checks passed; native restart check 10.645 s including process replacement and intentional 2.5 s outage; failure/resume/reload/success checks 0.722 / 6.530 / 0.672 / 0.930 s | PASS — `strict-results.json`, `strict-browser.log.txt`, `strict-browser.mjs.txt`, strict captures                                                |
| Operator contract/docs                        | Inspect retained requirements, ADR, documented read semantics and upgrade statement                                                                                                  | Durable events authoritative; reads do not persist; fallback explained; no invented migration        | ADR-0053 describes proven boundaries and recovery fallback; no schema/migration is introduced                                                                                            | PASS — `requirements.log.txt`, `source-context.log.txt`                                                                                          |

## Bounded-read comparison

| Checkpoint            | Independent event rows / median HTTP ms | Implementer claim: rows / median HTTP ms |
| --------------------- | --------------------------------------- | ---------------------------------------- |
| Current               | 1 / 5.639                               | 1 / 25.814                               |
| Lagging by 200 events | 201 / 10.971                            | 201 / 21.827                             |

The independent run has 10,001 events; the implementer fixture had 10,008. Both use physical SQLite and controlled appended node pairs, not thousands of native executions or providers. The independent capture includes API `reply.elapsedTime` alongside loopback HTTP timing and the counting-port reads. The matching structural row counts support the bounded-read claim. Elapsed times are observations on a shared machine, not a speedup claim between comparable controlled environments. The implementer claim is copied into this folder as `implementer-measurement-claim.json`; it is not treated as independent QA evidence.

## Repository gates

<!-- GATE_TABLE -->

| Exact command                                                                                                                                                        | Result        | Evidence                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                                 | PASS (exit 0) | [typecheck log](typecheck.log.txt)             |
| `pnpm.cmd lint`                                                                                                                                                      | PASS (exit 0) | [lint log](lint.log.txt)                       |
| `pnpm.cmd check:layers`                                                                                                                                              | PASS (exit 0) | [layers log](layers.log.txt)                   |
| `pnpm.cmd check:deps`                                                                                                                                                | PASS (exit 0) | [deps log](deps.log.txt)                       |
| `pnpm.cmd check:tokens`                                                                                                                                              | PASS (exit 0) | [tokens log](tokens.log.txt)                   |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`                                                                                                                | PASS (exit 0) | [domain-coverage log](domain-coverage.log.txt) |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                                                                                | PASS (exit 0) | [engine-coverage log](engine-coverage.log.txt) |
| `pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/projections.test.ts src/runs/follow-run-attempts.test.ts src/runs/useRunEvents.test.tsx --maxWorkers=1` | PASS (exit 0) | [web-focused log](web-focused.log.txt)         |

`pnpm.cmd format:check` passed for the repository; see [format-check.log.txt](format-check.log.txt). After correcting the reconnect wording, the changed QA Markdown was formatted and checked with `pnpm.cmd exec prettier --check docs/qa/2026-10-24-wp-g1-116-qa/README.md docs/qa/2026-10-24-wp-g1-116-qa/NOT-KEPT.md`; see [the scoped check](qa-format-check.log.txt).

**domain coverage:** lines 98.48% ( 2012/2043 ); branches 95.8% ( 2282/2382 ); Test Files 31 passed (31); Tests 595 passed (595).

**engine coverage:** lines 98.06% ( 2534/2584 ); branches 93.09% ( 2143/2302 ); Test Files 41 passed (41); Tests 1587 passed (1587).

Full API/MCP/web coverage suites were not rerun for this evidence-only QA change. The existing `apps/mcp/src/thread-history.test.ts` binds port 5932, and the existing shared thread fixture uses a different temp-directory prefix; those fixtures were not launched under this brief's stricter isolation constraints. The independent harness instead exercises their relevant REST/MCP/persistence/browser scenarios on allowed ports and prefixed stores. Domain and engine coverage and focused web tests are run without lowering thresholds, adding exclusions, or changing timeout budgets. Generated-doc and dependency-license gates are not required by a schema/dependency change here; none was made.

Timing failures in a file untouched by this change, if encountered in the gate run, receive one isolated rerun with both results retained. A retry does not erase an original failure. Gate results describe this checkout only; no current GitHub CI status is claimed.

## Coverage of criteria

- **#116 acceptance criterion 1 — tested and passed:** persisted failure → resume → success agrees across current-thread reads, lifecycle records, open/reloaded/reconnected inspector tabs; unfinished patches are excluded and reads are immutable. Evidence: five strict stage JSON captures and 20 strict screenshots after status/cursor/thread convergence, plus cancellation/tail cases. The original transient frames are separately recorded.
- **#116 acceptance criterion 2 — tested and passed:** existing and midway-reloaded tabs at both widths, REST and actual MCP tools agree despite delayed snapshots; the old failed terminal event does not prevent later resumed success. Evidence: the strict captures, two independent native process replacements, and held-resume/cancelled variants.
- **Requested bounded reads, boundaries, forks/children and reconnect — tested and passed:** event-row counts and timings, all four provable checkpoint kinds, actual recovery snapshot plus resumed tail, own fork/child threads, and a new native API process with existing tabs.
- **Requested load/stability — tested and passed within the retained finite sample:** six concurrent readers with committed-watermark checks and memory samples. The initial different workload timed out in its harness and remains incomplete. Indefinite memory stability and provider/native-executor throughput are not established.
- **#308 / #289 broader acceptance — not assessed as complete:** this QA covers #116's execution-history contribution and the requested adjacent fork/child behavior. Other bolts, history paging UX, finalization/return-delivery obligations, issue closure, and integrated intent acceptance are outside this task.

Not tested: live provider behavior (explicitly excluded); indefinite/endurance leak freedom; cross-device/PWA installation behavior; API restart during an actively executing external effect; every possible corrupt checkpoint payload. No unavailable behavior is called disproven. No failing production regression test was added because no production defect was found.

## Report path and evidence folder

Report: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-g1-116\docs\qa\2026-10-24-wp-g1-116-qa\README.md`. Evidence folder: this directory. Sources are retained as `.mjs.txt`, logs as `.log.txt`, plus JSON and PNG captures. Textual local user paths are normalized to `%USERPROFILE%` as requested. Snapshot/raw-row hashes refer to the actual stored bytes, independently of path normalization in capture metadata.

Every retained artifact is linked directly below. `manifest.log.txt` records final artifact byte sizes and SHA-256 values. `NOT-KEPT.md` records any oversized captures and their original size/hash. Temporary executables and disposable stores are listed in the environment evidence for orchestrator cleanup; no directories were deleted.

<!-- ARTIFACT_INDEX -->

- [NOT-KEPT.md](NOT-KEPT.md)
- [audit-initial-failure.log.txt](audit-initial-failure.log.txt)
- [audit-initial.mjs.txt](audit-initial.mjs.txt)
- [audit-second-failure.log.txt](audit-second-failure.log.txt)
- [audit-second.mjs.txt](audit-second.mjs.txt)
- [audit.log.txt](audit.log.txt)
- [audit.mjs.txt](audit.mjs.txt)
- [boundaries.json](boundaries.json)
- [bounded-read.json](bounded-read.json)
- [build.log.txt](build.log.txt)
- [cancel-resumed.json](cancel-resumed.json)
- [cancelled.json](cancelled.json)
- [children.json](children.json)
- [complete-report.mjs.txt](complete-report.mjs.txt)
- [definitions.json](definitions.json)
- [deps.log.txt](deps.log.txt)
- [domain-coverage.log.txt](domain-coverage.log.txt)
- [engine-coverage.log.txt](engine-coverage.log.txt)
- [environment.log.txt](environment.log.txt)
- [failed-open-1440.png](failed-open-1440.png)
- [failed-open-390.png](failed-open-390.png)
- [failed-reload-1440.png](failed-reload-1440.png)
- [failed-reload-390.png](failed-reload-390.png)
- [failed.json](failed.json)
- [fallback.json](fallback.json)
- [final-state.json](final-state.json)
- [finalize.mjs.txt](finalize.mjs.txt)
- [finish-report.mjs.txt](finish-report.mjs.txt)
- [fork-corrected.json](fork-corrected.json)
- [format-check.log.txt](format-check.log.txt)
- [gate-run.log.txt](gate-run.log.txt)
- [gates.json](gates.json)
- [gates.mjs.txt](gates.mjs.txt)
- [implementer-measurement-claim.json](implementer-measurement-claim.json)
- [key-cli.log.txt](key-cli.log.txt)
- [layers.log.txt](layers.log.txt)
- [lint.log.txt](lint.log.txt)
- [load-bounded.json](load-bounded.json)
- [make-strict-browser.mjs.txt](make-strict-browser.mjs.txt)
- [manifest.log.txt](manifest.log.txt)
- [mcp-tools.json](mcp-tools.json)
- [midway-reload-open-1440.png](midway-reload-open-1440.png)
- [midway-reload-open-390.png](midway-reload-open-390.png)
- [midway-reload-reload-1440.png](midway-reload-reload-1440.png)
- [midway-reload-reload-390.png](midway-reload-reload-390.png)
- [midway-reload.json](midway-reload.json)
- [native-processes.json](native-processes.json)
- [negative.json](negative.json)
- [normalization.log.txt](normalization.log.txt)
- [oracle.mjs.txt](oracle.mjs.txt)
- [qa-final-format.log.txt](qa-final-format.log.txt)
- [qa-format-before-strict.log.txt](qa-format-before-strict.log.txt)
- [qa-format-check-before-strict.log.txt](qa-format-check-before-strict.log.txt)
- [qa-format-check.log.txt](qa-format-check.log.txt)
- [qa-format.log.txt](qa-format.log.txt)
- [recovery-tail.json](recovery-tail.json)
- [recovery.json](recovery.json)
- [requirements.log.txt](requirements.log.txt)
- [restart-failed-open-1440.png](restart-failed-open-1440.png)
- [restart-failed-open-390.png](restart-failed-open-390.png)
- [restart-failed-reload-1440.png](restart-failed-reload-1440.png)
- [restart-failed-reload-390.png](restart-failed-reload-390.png)
- [restart-failed.json](restart-failed.json)
- [results.json](results.json)
- [resumed-unfinished-open-1440.png](resumed-unfinished-open-1440.png)
- [resumed-unfinished-open-390.png](resumed-unfinished-open-390.png)
- [resumed-unfinished-reload-1440.png](resumed-unfinished-reload-1440.png)
- [resumed-unfinished-reload-390.png](resumed-unfinished-reload-390.png)
- [resumed-unfinished.json](resumed-unfinished.json)
- [run.log.txt](run.log.txt)
- [runner.mjs.txt](runner.mjs.txt)
- [server-60876.log.txt](server-60876.log.txt)
- [server.mjs.txt](server.mjs.txt)
- [source-context.log.txt](source-context.log.txt)
- [strict-browser.log.txt](strict-browser.log.txt)
- [strict-browser.mjs.txt](strict-browser.mjs.txt)
- [strict-failed-open-1440.png](strict-failed-open-1440.png)
- [strict-failed-open-390.png](strict-failed-open-390.png)
- [strict-failed-reload-1440.png](strict-failed-reload-1440.png)
- [strict-failed-reload-390.png](strict-failed-reload-390.png)
- [strict-failed.json](strict-failed.json)
- [strict-key-cli.log.txt](strict-key-cli.log.txt)
- [strict-midway-reload-open-1440.png](strict-midway-reload-open-1440.png)
- [strict-midway-reload-open-390.png](strict-midway-reload-open-390.png)
- [strict-midway-reload-reload-1440.png](strict-midway-reload-reload-1440.png)
- [strict-midway-reload-reload-390.png](strict-midway-reload-reload-390.png)
- [strict-midway-reload.json](strict-midway-reload.json)
- [strict-native-processes.json](strict-native-processes.json)
- [strict-restart-failed-open-1440.png](strict-restart-failed-open-1440.png)
- [strict-restart-failed-open-390.png](strict-restart-failed-open-390.png)
- [strict-restart-failed-reload-1440.png](strict-restart-failed-reload-1440.png)
- [strict-restart-failed-reload-390.png](strict-restart-failed-reload-390.png)
- [strict-restart-failed.json](strict-restart-failed.json)
- [strict-results.json](strict-results.json)
- [strict-resumed-unfinished-open-1440.png](strict-resumed-unfinished-open-1440.png)
- [strict-resumed-unfinished-open-390.png](strict-resumed-unfinished-open-390.png)
- [strict-resumed-unfinished-reload-1440.png](strict-resumed-unfinished-reload-1440.png)
- [strict-resumed-unfinished-reload-390.png](strict-resumed-unfinished-reload-390.png)
- [strict-resumed-unfinished.json](strict-resumed-unfinished.json)
- [strict-server-21328.log.txt](strict-server-21328.log.txt)
- [strict-server-3644.log.txt](strict-server-3644.log.txt)
- [strict-succeeded-open-1440.png](strict-succeeded-open-1440.png)
- [strict-succeeded-open-390.png](strict-succeeded-open-390.png)
- [strict-succeeded-reload-1440.png](strict-succeeded-reload-1440.png)
- [strict-succeeded-reload-390.png](strict-succeeded-reload-390.png)
- [strict-succeeded.json](strict-succeeded.json)
- [succeeded-open-1440.png](succeeded-open-1440.png)
- [succeeded-open-390.png](succeeded-open-390.png)
- [succeeded-reload-1440.png](succeeded-reload-1440.png)
- [succeeded-reload-390.png](succeeded-reload-390.png)
- [succeeded.json](succeeded.json)
- [supplement-results.json](supplement-results.json)
- [supplement-server.log.txt](supplement-server.log.txt)
- [supplement.log.txt](supplement.log.txt)
- [supplement.mjs.txt](supplement.mjs.txt)
- [tail-cases.mjs.txt](tail-cases.mjs.txt)
- [tail-results.json](tail-results.json)
- [tail-server.log.txt](tail-server.log.txt)
- [tail.log.txt](tail.log.txt)
- [tokens.log.txt](tokens.log.txt)
- [typecheck.log.txt](typecheck.log.txt)
- [ui-metadata-check.json](ui-metadata-check.json)
- [waiting-tail.json](waiting-tail.json)
- [web-focused.log.txt](web-focused.log.txt)

## Observations outside scope

No outside-scope production defect was reproduced. Root lint passed with one existing warning at `apps/web/src/runs/inspector/ThreadViewer.tsx:106` about destructuring `useState`. Turbo also printed cache I/O access-denied warnings; the affected root gates still exited 0. These warnings are retained in the gate logs. Unavailable coverage evidence, any unrelated gate failure, the QA harness limitations, and the original transient metadata/cursor observations and the strict convergence evidence are reported above rather than silently cleared. Product outcome and delivery finalization remain separate; this QA does not grant merge or integrated intent sign-off.
