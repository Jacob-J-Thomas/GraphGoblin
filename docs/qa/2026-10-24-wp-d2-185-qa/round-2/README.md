# Independent QA round 2: WP-D2 / #185

## 1. Verdict

**PASS** at **`0fbcc11f9ff14d392af1507ca92ee20958f793ad`** for the scoped round-2 recheck. QA-185-01 is verified fixed. Both minute-long timing probes, native completion checks, lifecycle-change checks and the requested once-alone targeted tests pass. No new defect was found.

Branch `codex-qa-wp-d2-185`; worktree `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-qa-wp-d2-185`. Initial HEAD matched and the worktree was clean; dependencies were populated (17 entries, ordinary node_modules directory). Node `v22.14.0`. Build: 11/11 successful, zero cache hits. [environment.log.txt](environment.log.txt), [final-state.log.txt](final-state.log.txt), [build.log.txt](build.log.txt). No production edits, commits, index changes, sub-agents, owner ports/store, or live provider turns. Round-1 files are unchanged. All new files are under round-2.

## 2. Defects

None newly observed. **QA-185-01: verified fixed.** Minimum measured intervals after initial catch-up were 249.259 ms with the real 15-second heartbeat and 249.467 ms with a 20 ms heartbeat. The sub-millisecond shortfall from nominal 250 ms is within the brief's few-millisecond timer jitter allowance. The harness uses the maintained regression's 245 ms lower tolerance; it did not lower or modify any production/test threshold. No intervals below 249 ms were observed in either minute.

## 3. Coverage of criteria

Touched surfaces this round: built SSE pending-confirmation scheduling, heartbeat writes, finalization acknowledgement, lifecycle notifications at normal and ahead-of-tail cursors, API-client subscription settlement and consumed-cursor reconnect. [head-change.patch.txt](head-change.patch.txt) preserves the fix, maintained regression and doc changes. The orchestrator's before-fix regression-failure claim was not rerun here; this report independently establishes the after-fix result at the pinned head.

### Waiting cost: three streams, one minute per heartbeat setting

Steps: run [cost.mjs.txt](cost.mjs.txt) from a temporary .mjs copy with `GG_QA_HEARTBEAT_MS=15000`, then `20`, sequentially after the targeted test process exited. Each uses a real Fastify HTTP listener on 6132 and the built SSE handler with explicit public EventStorePort/finalizer injection. Finalization remains false; the cursor has consumed the terminal event; no journal/lifecycle notifications occur. This is synthetic-store component evidence, not a direct SQLite read count. The probe derives from the round-1 cost script, adding heartbeat selection, pending-stream evidence and two post-close observations.

Expected: periodic checks no sooner than nominal 250 ms (245 ms lower tolerance for timer jitter), bounded counts, no stream.complete while pending, then no further reads and zero subscribers after close. Intervals exclude the first 1,000 ms after all streams open. Counts include initial confirmation; each store also has two initial page reads.

| Heartbeat | Duration ms | Stream | Finalization checks at close | Lifecycle reads | Minimum gap ms | Maximum gap ms | Result |
| --------- | ----------- | ------ | ---------------------------- | --------------- | -------------- | -------------- | ------ |
| 15000 ms  | 60054.483   | 1      | 229                          | 230             | 249.279        | 316.756        | PASS   |
| 15000 ms  | 60054.483   | 2      | 229                          | 230             | 249.272        | 316.757        | PASS   |
| 15000 ms  | 60054.483   | 3      | 229                          | 230             | 249.259        | 316.753        | PASS   |
| 20 ms     | 60096.924   | 1      | 224                          | 225             | 249.467        | 465.597        | PASS   |
| 20 ms     | 60096.924   | 2      | 224                          | 225             | 249.468        | 465.596        | PASS   |
| 20 ms     | 60096.924   | 3      | 224                          | 225             | 249.467        | 465.597        | PASS   |

Closing released all six subscriptions (one unsubscribe each, active count zero). The complete page/lifecycle/finalization counters were identical before abort, one second after abort, and another second later in both probes. Timer delays above 250 ms reflect observed scheduling; they did not create early rechecks. Raw call timestamps, heartbeat bodies and closure counts: [standard-cost.json](standard-cost.json) / [short-cost.json](short-cost.json); logs: [standard-cost.log.txt](standard-cost.log.txt) / [short-cost.log.txt](short-cost.log.txt).

### Completion and reconnect latency

Steps: [gateway.mjs.txt](gateway.mjs.txt) starts the built gateway in a separate Node process with real SQLite in `%USERPROFILE%/AppData/Local/Temp/gg-qa-d2-185-round2-60zMiC`, a FakeHarness and an API key minted by the built gateway. [completion.mjs.txt](completion.mjs.txt) controls a real webhook receiver on 6131. It first returns 503, holds the retry, then acknowledges 200; a separate run holds its first response, then returns permanent 400. Open raw streams at 0, consumed run.finished cursor 8, and ahead cursor 10008, plus an API-client subscription. While held, REST has succeeded/pending with no marker; waitForRun and all subscriptions stay unfinished. Then release, observe finalizedAt and record stream.complete.

| Case              | Final delivery / attempts | Completion after recorded finalizedAt, by cursor 0 / 8 / 10008 | API-client completion ms | Reconnect at final cursor ms | Result |
| ----------------- | ------------------------- | -------------------------------------------------------------- | ------------------------ | ---------------------------- | ------ |
| delayed-success   | delivered / 2             | 197 / 197 / 198 ms                                             | 108                      | 11.055                       | PASS   |
| permanent-failure | failed / 1                | 143 / 143 / 212 ms                                             | 212                      | 9.976                        | PASS   |

All six existing raw streams completed within 212 ms of the recorded finalization marker, below one nominal recheck. Consumed-final-cursor reconnects emitted stream.complete without replaying any durable event in about 10-11 ms. The API client received delivery.finished and no duplicate sequence numbers. A final delivery failure settled observation while execution remained succeeded. The harness failure budget was 300 ms (250 ms plus modest transport/scheduling allowance); actual observations were all below 250 ms. Recorded-marker timing includes any work between timestamp creation and its persistence, so it is an observational upper bound rather than instrumentation of the marker write. [completion.json](completion.json) and [completion.log.txt](completion.log.txt).

### Lifecycle changes during pending finalization

Explicit public store injection over real HTTP tests cursors 1 and 1000. Start with terminal seq 1 and finalization false; append run.resumed seq 2 and present an old acknowledgement as true. The stream must remain live. Then reset finalization false and append a new terminal seq 3; the lifecycle notification must trigger confirmation despite the armed timer. After 40 ms, set the new eventless marker true and expect completion within one recheck. This is a synthetic lifecycle-race fixture, not a native engine resume/crash qualification.

| Cursor | New terminal notification to confirmation ms | New marker to stream.complete ms | Completion cursor | Result |
| ------ | -------------------------------------------- | -------------------------------- | ----------------- | ------ |
| 1      | 4.793                                        | 191.090                          | 3                 | PASS   |
| 1000   | 0.567                                        | 210.569                          | 1000              | PASS   |

Both resumed lifecycles were observed, neither settled on the old marker, and the new terminal outcomes/markers completed truthfully. [completion.json](completion.json) retains the lifecycle/read timestamps and complete frames.

### Commands and maintained tests

| Command                                                                                      | Execution / result                                           | Evidence                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| `pnpm.cmd build`                                                                             | Once; exit 0; 11 successful, zero cached                     | [build.log.txt](build.log.txt)                   |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/sse src/finalization --maxWorkers=1` | Once, alone after build; exit 0; 44 tests / 5 files; 67.52 s | [targeted-tests.log.txt](targeted-tests.log.txt) |
| `GG_QA_HEARTBEAT_MS=15000 node %TEMP%/gg-qa-d2-185-round2-cost.mjs`                          | One minute, three streams; exit 0                            | [standard-result.json](standard-result.json)     |
| `GG_QA_HEARTBEAT_MS=20 node %TEMP%/gg-qa-d2-185-round2-cost.mjs`                             | One minute, three streams; exit 0                            | [short-result.json](short-result.json)           |
| `node %TEMP%/gg-qa-d2-185-round2-completion.mjs`                                             | Native completion and component lifecycle cases; exit 0      | [completion-result.json](completion-result.json) |

The targeted run includes "rechecks a pending finalization at most every 250 ms, even with frequent heartbeats" and both finalization HTTP cases. There was no timeout or retry in this run. No ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK occurred; direct-binary fallback was unnecessary.

The scope follows the explicit round-2 brief: broad coverage, MCP timeout suites, full repository gates and Edge scenarios were not rerun. The orchestrator accepted round-1 functional evidence and assigned exact-head CI as quiet-runner evidence; that CI result was not queried or claimed here. No schemas, dependencies or web source changed in this fix. QA Markdown is formatted and checked separately.

### Check ledger

Steps and expected results are defined by the probes above and their linked scripts; each row retains the actual recorded assertion. Full values are in [checks.json](checks.json) and [completion.json](completion.json).

| Check                                                     | Expected                               | Actual                                                                                                                                                                                                                                                                                                                                                         | Result |
| --------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 15 s stream 1                                             | Satisfies stated probe bound/condition | {"minMs":249.27869999999893,"finalizationChecks":229}                                                                                                                                                                                                                                                                                                          | PASS   |
| 15 s stream 2                                             | Satisfies stated probe bound/condition | {"minMs":249.27219999999943,"finalizationChecks":229}                                                                                                                                                                                                                                                                                                          | PASS   |
| 15 s stream 3                                             | Satisfies stated probe bound/condition | {"minMs":249.2592999999979,"finalizationChecks":229}                                                                                                                                                                                                                                                                                                           | PASS   |
| 15 s pending and close cleanup                            | Satisfies stated probe bound/condition | {"pending":true,"active":0,"noReadsAfterClose":true}                                                                                                                                                                                                                                                                                                           | PASS   |
| 20 ms stream 1                                            | Satisfies stated probe bound/condition | {"minMs":249.46659999999974,"finalizationChecks":224}                                                                                                                                                                                                                                                                                                          | PASS   |
| 20 ms stream 2                                            | Satisfies stated probe bound/condition | {"minMs":249.46770000000015,"finalizationChecks":224}                                                                                                                                                                                                                                                                                                          | PASS   |
| 20 ms stream 3                                            | Satisfies stated probe bound/condition | {"minMs":249.46690000000035,"finalizationChecks":224}                                                                                                                                                                                                                                                                                                          | PASS   |
| 20 ms pending and close cleanup                           | Satisfies stated probe bound/condition | {"pending":true,"active":0,"noReadsAfterClose":true}                                                                                                                                                                                                                                                                                                           | PASS   |
| delayed-success pending remains unfinished                | Satisfies stated probe bound/condition | {"pending":{"id":"01M5RTNB2M269MABTT3RMX2EGF","ownerId":"local","loopId":"01M5RTNB0VCSVQ8SGCMY54RXBF","versionId":"01M5RTNB0VCSVQ8SGCMY54RXBG","pinned":{"source":"published","version":1,"name":"Round 2 delayed-success","label":"Round 2 delayed-success v1","defaults":{"owner":{"byHarness":{}},"process":{"byHarness":{"codex":{"model":"gpt-6-luna",... | PASS   |
| delayed-success execution unchanged and delivery final    | Satisfies stated probe bound/condition | {"status":"succeeded","finalizedAt":"2026-10-25T06:06:16.140Z","delivery":{"id":"01M5RTNB5J0TWA6BAXBDGBBDF7","channel":{"kind":"webhook","url":"http://127.0.0.1:6131/delayed-success"},"status":"delivered","attempts":2,"maxAttempts":5,"inFlight":false,"acknowledgement":"accepted","effectMayHaveHappened":true,"acknowledgementUncertain":true,"lastE... | PASS   |
| delayed-success stream.complete follows marker promptly   | Satisfies stated probe bound/condition | [{"after":0,"fromRecordedMarkerMs":197,"fromMarkerObservedMs":190.79039999999986,"fromReleaseMs":217.36160000000018},{"after":8,"fromRecordedMarkerMs":197,"fromMarkerObservedMs":191.35639999999876,"fromReleaseMs":217.92759999999907},{"after":10008,"fromRecordedMarkerMs":198,"fromMarkerObservedMs":191.61699999999837,"fromReleaseMs":218.1881999999... | PASS   |
| delayed-success client settles on final tail              | Satisfies stated probe bound/condition | {"clientLatencyMs":108,"events":5}                                                                                                                                                                                                                                                                                                                             | PASS   |
| delayed-success consumed final cursor reconnect prompt    | Satisfies stated probe bound/condition | {"after":13,"reconnectMs":11.054599999999482}                                                                                                                                                                                                                                                                                                                  | PASS   |
| delayed-success stable request identity                   | Satisfies stated probe bound/condition | [{"path":"/delayed-success","key":"01M5RTNB5J0TWA6BAXBDGBBDF7","at":1792908373239},{"path":"/delayed-success","key":"01M5RTNB5J0TWA6BAXBDGBBDF7","at":1792908375495}]                                                                                                                                                                                          | PASS   |
| permanent-failure pending remains unfinished              | Satisfies stated probe bound/condition | {"pending":{"id":"01M5RTNE9Y6BGD76R86Q30JBFC","ownerId":"local","loopId":"01M5RTNE94F5GEZQA0P6JW7ASY","versionId":"01M5RTNE94F5GEZQA0P6JW7ASZ","pinned":{"source":"published","version":1,"name":"Round 2 permanent-failure","label":"Round 2 permanent-failure v1","defaults":{"owner":{"byHarness":{}},"process":{"byHarness":{"codex":{"model":"gpt-6-lu... | PASS   |
| permanent-failure execution unchanged and delivery final  | Satisfies stated probe bound/condition | {"status":"succeeded","finalizedAt":"2026-10-25T06:06:17.140Z","delivery":{"id":"01M5RTNEC7WSX941FKK9SB989S","channel":{"kind":"webhook","url":"http://127.0.0.1:6131/permanent-failure"},"status":"failed","attempts":1,"maxAttempts":5,"inFlight":false,"acknowledgement":"rejected","effectMayHaveHappened":false,"acknowledgementUncertain":false,"last... | PASS   |
| permanent-failure stream.complete follows marker promptly | Satisfies stated probe bound/condition | [{"after":0,"fromRecordedMarkerMs":143,"fromMarkerObservedMs":135.99979999999778,"fromReleaseMs":154.67540000000008},{"after":8,"fromRecordedMarkerMs":143,"fromMarkerObservedMs":136.5056999999979,"fromReleaseMs":155.1813000000002},{"after":10008,"fromRecordedMarkerMs":212,"fromMarkerObservedMs":204.80329999999958,"fromReleaseMs":223.4789000000019}] | PASS   |
| permanent-failure client settles on final tail            | Satisfies stated probe bound/condition | {"clientLatencyMs":212,"events":3}                                                                                                                                                                                                                                                                                                                             | PASS   |
| permanent-failure consumed final cursor reconnect prompt  | Satisfies stated probe bound/condition | {"after":11,"reconnectMs":9.975600000001577}                                                                                                                                                                                                                                                                                                                   | PASS   |
| permanent-failure stable request identity                 | Satisfies stated probe bound/condition | [{"path":"/permanent-failure","key":"01M5RTNEC7WSX941FKK9SB989S","at":1792908376479}]                                                                                                                                                                                                                                                                          | PASS   |
| lifecycle 1 resume invalidates old finality               | Satisfies stated probe bound/condition | {"resumedAt":19404.1313,"finalizedOldMarker":true,"streamEnded":false,"lifecycle":[{"at":19366.5388,"type":"run.cancelled","seq":1},{"at":19367.6209,"type":"run.cancelled","seq":1},{"at":19618.1606,"type":"run.resumed","seq":2},{"at":20034.5955,"type":"run.cancelled","seq":3},{"at":20291.1684,"type":"run.cancelled","seq":3}]}                        | PASS   |
| lifecycle 1 notification triggers prompt confirmation     | Satisfies stated probe bound/condition | {"notificationLatencyMs":4.792600000000675}                                                                                                                                                                                                                                                                                                                    | PASS   |
| lifecycle 1 new marker settles promptly                   | Satisfies stated probe bound/condition | {"completionLatencyMs":191.09019999999873,"control":{"after":3}}                                                                                                                                                                                                                                                                                               | PASS   |
| lifecycle 1000 resume invalidates old finality            | Satisfies stated probe bound/condition | {"resumedAt":20346.7401,"finalizedOldMarker":true,"streamEnded":false,"lifecycle":[{"at":20301.3253,"type":"run.cancelled","seq":1},{"at":20301.5861,"type":"run.cancelled","seq":1},{"at":20346.9263,"type":"run.resumed","seq":2},{"at":20553.3039,"type":"run.resumed","seq":2},{"at":20698.1054,"type":"run.cancelled","seq":3},{"at":20971.6196,"type"... | PASS   |
| lifecycle 1000 notification triggers prompt confirmation  | Satisfies stated probe bound/condition | {"notificationLatencyMs":0.5666999999994005}                                                                                                                                                                                                                                                                                                                   | PASS   |
| lifecycle 1000 new marker settles promptly                | Satisfies stated probe bound/condition | {"completionLatencyMs":210.5694999999978,"control":{"after":1000}}                                                                                                                                                                                                                                                                                             | PASS   |
| build command                                             | Satisfies stated probe bound/condition | {"exit":0,"command":"pnpm.cmd build"}                                                                                                                                                                                                                                                                                                                          | PASS   |
| targeted command                                          | Satisfies stated probe bound/condition | {"exit":0,"command":"pnpm.cmd --filter @graphgoblin/api exec vitest run src/sse src/finalization --maxWorkers=1"}                                                                                                                                                                                                                                              | PASS   |
| standard command                                          | Satisfies stated probe bound/condition | {"exit":0,"heartbeatMs":15000}                                                                                                                                                                                                                                                                                                                                 | PASS   |
| short command                                             | Satisfies stated probe bound/condition | {"exit":0,"heartbeatMs":20}                                                                                                                                                                                                                                                                                                                                    | PASS   |
| completion command                                        | Satisfies stated probe bound/condition | {"exit":0,"command":"node %TEMP%/gg-qa-d2-185-round2-completion.mjs"}                                                                                                                                                                                                                                                                                          | PASS   |

## 4. Report path and evidence folder

`docs/qa/2026-10-24-wp-d2-185-qa/round-2/README.md`; evidence is the same round-2 folder. Every kept artifact is linked below. [SHA256.json](SHA256.json) records final retained sizes/hashes; it excludes itself. Local user paths are written as %USERPROFILE%. No raw result formatting is applied by Prettier. [NOT-KEPT.md](NOT-KEPT.md) records oversized captures, if any.

- [NOT-KEPT.md](NOT-KEPT.md)
- [build-result.json](build-result.json)
- [build.log.txt](build.log.txt)
- [checks.json](checks.json)
- [completion-result.json](completion-result.json)
- [completion.json](completion.json)
- [completion.log.txt](completion.log.txt)
- [completion.mjs.txt](completion.mjs.txt)
- [cost.mjs.txt](cost.mjs.txt)
- [environment.log.txt](environment.log.txt)
- [final-state.log.txt](final-state.log.txt)
- [format.log.txt](format.log.txt)
- [gateway.log.txt](gateway.log.txt)
- [gateway.mjs.txt](gateway.mjs.txt)
- [head-change.patch.txt](head-change.patch.txt)
- [report.mjs.txt](report.mjs.txt)
- [short-cost.json](short-cost.json)
- [short-cost.log.txt](short-cost.log.txt)
- [short-result.json](short-result.json)
- [standard-cost.json](standard-cost.json)
- [standard-cost.log.txt](standard-cost.log.txt)
- [standard-result.json](standard-result.json)
- [targeted-result.json](targeted-result.json)
- [targeted-tests.log.txt](targeted-tests.log.txt)
- [SHA256.json](SHA256.json)

## 5. Observations outside scope

No new out-of-scope product defect. The build log retains optional Turbo cache access-denied warnings; the build completed uncached. Round-1 MCP/coverage observations and D-015 remain in the committed round-1 report with the orchestrator dispositions; they were not reclassified by this scoped pass. No native forced termination or provider validation was attempted. The disposable store is preserved and the gateway shut down cooperatively. Owner acceptance, exact-head CI and merge audit remain separate from this QA verdict.
