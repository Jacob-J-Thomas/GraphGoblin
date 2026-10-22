# Independent QA, round 2: #321

**Verdict: PASS with the documented D-015 host limitation for `a5cd26c496e7ae59e13748e7c879d072064ace0f`.** 14/14 independent checks passed; MCP wire-summary assertions passed. No new product defect was found. This verdict concerns the round-2 functional/evidence restoration scope. It does not claim the earlier full coverage commands were rerun or all native termination gates passed inside this sandbox.

The current head was verified to differ from round 1 only by the curated QA evidence commit. Deleted historical logs were not fabricated: these scripts were reconstructed from this thread's history, and every result/log here is a fresh round-2 observation. Product files and the Git index are unchanged; nothing was committed. Work was performed alone.

Windows PowerShell, Node 22.14.0, pnpm 12.8.1; built API and web. Independent Edge: 155.0.4283.62, headless. Application listeners stayed in 5920–5929. Stores were new `gg-qa-321-r2-*` directories under the system temp directory. No owner app/store, ports 4747/4748, inference node, paid turn or external provider was used. Maintained component tests use their repository fakes.

## Per-check evidence

Full steps, expectations, actual payloads, identities and timings are in [independent-results.json](independent-results.json); [corrected-results.json](corrected-results.json) is the same fresh dataset under the restored corrected-probe filename. It is not a recovered round-1 result.

| Check                                     | Steps                                                                                                                                                                      | Expected                                                                                                                               | Actual                                                                                                                                 | Result | Evidence                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------ |
| before-dispatch                           | Park before script, hard kill API, restart same store, submit observed waitId.                                                                                             | No dispatch before input; success with one effect.                                                                                     | Effects: 1.                                                                                                                            | PASS   | [JSON](independent-results.json)           |
| interrupted-dispatch-and-resumed-dispatch | Kill after live marker effect; restart twice without consent; Resume; kill second live dispatch; restart; deliberately Resume again.                                       | Uncertainty preserves original IDs; no automatic repeat; same visit and fresh dispatch on each Resume; final success.                  | One effect before consent; second interrupted dispatch has new dispatchId on same visit; final deliberate attempt gives three effects. | PASS   | [JSON](independent-results.json)           |
| completed-before-cursor                   | Inject disposable SQLite cursor-write and error-disposition faults; finish marker; verify durable node.finished with old script cursor; hard kill; remove faults; restart. | Durable completion advances without another dispatch or effect.                                                                        | Pre-kill cursor script/running; SIGKILL; recovery succeeds with one effect and one dispatch.                                           | PASS   | [JSON](independent-results.json)           |
| native-missing                            | Publish and run the real local command; inspect typed failure; repair missing executable in place and Resume.                                                              | Start refusal is resumable/definitely-not-started; exit 7 preserves completed provenance; timeout/cancel classification stays correct. | SCRIPT_START_FAILED; definitely-not-started; repaired command resumes successfully.                                                    | PASS   | [JSON](independent-results.json)           |
| native-cmd                                | Publish and run the real local command; inspect typed failure; repair missing executable in place and Resume.                                                              | Start refusal is resumable/definitely-not-started; exit 7 preserves completed provenance; timeout/cancel classification stays correct. | SCRIPT_START_FAILED; definitely-not-started.                                                                                           | PASS   | [JSON](independent-results.json)           |
| native-nonzero                            | Publish and run the real local command; inspect typed failure; repair missing executable in place and Resume.                                                              | Start refusal is resumable/definitely-not-started; exit 7 preserves completed provenance; timeout/cancel classification stays correct. | SCRIPT_EXIT_CODE; completed; exit 7.                                                                                                   | PASS   | [JSON](independent-results.json)           |
| native-timeout                            | Publish and run the real local command; inspect typed failure; repair missing executable in place and Resume.                                                              | Start refusal is resumable/definitely-not-started; exit 7 preserves completed provenance; timeout/cancel classification stays correct. | SCRIPT_TIMEOUT; completed; exit 0.                                                                                                     | PASS   | [JSON](independent-results.json)           |
| native-cancel                             | Publish and run the real local command; inspect typed failure; repair missing executable in place and Resume.                                                              | Start refusal is resumable/definitely-not-started; exit 7 preserves completed provenance; timeout/cancel classification stays correct. | Cancelled with no failure.                                                                                                             | PASS   | [JSON](independent-results.json)           |
| edge-cancel-live-resume                   | Open uncertain inspector in Edge; Cancel recovery; Resume while marker held; release and observe final status.                                                             | Count remains 1 after Cancel; explicit Resume makes 2; success without document reload; earlier dispatch/failure retained.             | Cancel preserves failed/count 1; Resume gives count 2, visible success, no document reload, retained timeline.                         | PASS   | [JSON](independent-results.json)           |
| edge-replay                               | Recover a second uncertain run with Replay.                                                                                                                                | Navigate to new successful fork; source stays failed; second effect.                                                                   | Effects: 2.                                                                                                                            | PASS   | [JSON](independent-results.json)           |
| edge-non-script-failure                   | Fail a mutation expression and inspect its run.                                                                                                                            | No Recover script button and no failure.script.                                                                                        | Assertions satisfied; full measured payload linked.                                                                                    | PASS   | [JSON](independent-results.json)           |
| child-in-place                            | Kill API during child marker; inspect failed parent; Resume parent using Edge recovery dialog.                                                                             | Parent inherits code/resumability; same child resumes; exactly one additional child effect.                                            | Effects: 2.                                                                                                                            | PASS   | [JSON](independent-results.json)           |
| edge-keyboard-narrow-concurrent-resume    | Use 375px Edge, keyboard open/Escape, second tab, then concurrent explicit API Resume requests.                                                                            | Dialog fits; opening/cancelling has no effect; one resumed dispatch; duplicate gets 409.                                               | Effects: 2.                                                                                                                            | PASS   | [JSON](independent-results.json)           |
| api-client-mcp-provenance                 | Use built public client to GET real script failure; invoke MCP get_run/read_run_events/list_runs and list tools via in-memory transport.                                   | Failure provenance round-trips; summaries include script/resumable for scripts only; Resume description requires explicit choice.      | Public client GET, MCP get_run/read_run_events, exported summaries and explicit-choice description all match.                          | PASS   | [JSON](independent-results.json)           |
| MCP summary over tool transport           | Reopen completed disposable store; call list_runs through linked public MCP transports                                                                                     | Script summaries carry script/resumable; ordinary failure summaries omit those fields                                                  | Exit-code-7 script retains completed provenance; ordinary INTERNAL_ERROR omits script/resumable                                        | PASS   | [mcp-provenance.json](mcp-provenance.json) |

The completed-before-cursor check widens the boundary with real SQLite cursor-write and error-disposition faults in the disposable store, verifies durable `node.finished` while the cursor is still `script`, then performs a real process kill. It establishes recovery at that recorded boundary, not a natural timing-race landing. All live-marker interruptions use the repository marker script, one line per effect. There is no exactly-once external-effect claim.

Timeout and cancellation use finite five-second subprocesses: their final classifications pass, while timely process-tree termination is still D-015-limited. Missing-command repair means installing the executable at its pinned path; editing a live draft does not rewrite the run's immutable version.

## Gates and supported tests

[gate-results.jsonl](gate-results.jsonl) records exact commands, exit statuses and durations. Expected result for each command: exit zero. Logs are linked below.

| Command group    | Actual exit | Seconds | Result | Log                                                  |
| ---------------- | ----------- | ------- | ------ | ---------------------------------------------------- |
| build            | 0           | 2.71    | PASS   | [build.log.txt](build.log.txt)                       |
| prepare          | 0           | 0.3     | PASS   | [prepare.log.txt](prepare.log.txt)                   |
| independent      | 0           | 43.23   | PASS   | [independent.log.txt](independent.log.txt)           |
| recovery-process | 0           | 17.05   | PASS   | [recovery-process.log.txt](recovery-process.log.txt) |
| restart          | 0           | 25.43   | PASS   | [restart.log.txt](restart.log.txt)                   |
| edge             | 0           | 12.1    | PASS   | [edge.log.txt](edge.log.txt)                         |
| native-start     | 0           | 6.21    | PASS   | [native-start.log.txt](native-start.log.txt)         |
| mcp              | 0           | 4.21    | PASS   | [mcp.log.txt](mcp.log.txt)                           |
| client-types     | 0           | 1.34    | PASS   | [client-types.log.txt](client-types.log.txt)         |
| typecheck        | 0           | 48.26   | PASS   | [typecheck.log.txt](typecheck.log.txt)               |
| mcp-wire         | 0           | 3.57    | PASS   | [mcp-wire.log.txt](mcp-wire.log.txt)                 |
| format           | 0           | 31.94   | PASS   | [format.log.txt](format.log.txt)                     |

Built recovery-process acceptance: 1 passed; script restart test: 3 passed; standalone Edge: 1 passed; native start disposition: 2 passed; focused MCP description tests: 8 passed. The generated public client provenance probe compiles. Typecheck passed. Coverage thresholds and exclusions were untouched; full package coverage suites were not rerun in this evidence-only round.

The copied API/browser fixtures are retargeted only for the permitted resource prefix/ports and their new relative location. The browser screenshot becomes a small dialog text capture. Production source, behavioral assertions and original fixtures remain unchanged. [prepare-fixtures.mjs](prepare-fixtures.mjs) regenerates these copies and compile/config probes.

## QA-321-01 disposition and cleanup

The round-2 orchestration brief dispositions QA-321-01 as **D-015**, supplying outside-sandbox evidence on the same product head: the isolated case passed (1 passed, 73 seconds), and the entire child-creation-restart file passed (3 passed, 120 seconds). Those are supplied reviewer observations, not newly executed evidence from this sandbox. The round-1 cleanup timeout remains historical evidence; it is not carried forward as an unresolved #321 product defect. No outside-sandbox native validation is claimed here.

All new stores were removed after their processes exited. 1 remaining store directory was removed by [cleanup.ps1](cleanup.ps1); the passing maintained fixtures removed and asserted absence of their own stores. [cleanup.json](cleanup.json) records zero remaining round-2 directories, and [process-exit.json](process-exit.json) records the independent and MCP-probe API exits. Old round-1 raw temporary logs were left untouched.

## Replay

From <repo> in PowerShell:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/qa/2026-10-22-wp-d1-321-qa/round-2/run-gates.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/qa/2026-10-22-wp-d1-321-qa/round-2/cleanup.ps1
node docs/qa/2026-10-22-wp-d1-321-qa/round-2/sanitize.mjs
node docs/qa/2026-10-22-wp-d1-321-qa/round-2/write-report.mjs
```

The gate runner accepts `-Only` with comma-separated command groups. A full replay rebuilds, regenerates fixtures, executes the independent runner, MCP wire probe and supported tests. Run cleanup after all processes have exited, including after a failed check; a live recorded PID refuses cleanup. Then format the evidence files and invoke `run-gates.ps1 -Only format` for the repository formatter. Regenerate this README after that final result and run [verify-bundle.mjs](verify-bundle.mjs). Replay overwrites individual logs/results and appends gate history; retain the folder first when preserving an earlier run.

## Preservation manifest

Every non-Markdown artifact in this folder is directly linked here so link-based curation keeps the replay bundle, including scripts, generated fixtures/configs, logs, results and metadata.

- [api.config.mts](api.config.mts)
- [build.log.txt](build.log.txt)
- [bundle-validation.json](bundle-validation.json)
- [cleanup.json](cleanup.json)
- [cleanup.ps1](cleanup.ps1)
- [client-config.json](client-config.json)
- [client-contract.ts](client-contract.ts)
- [client-types.log.txt](client-types.log.txt)
- [corrected-edge-observations.json](corrected-edge-observations.json)
- [corrected-results.json](corrected-results.json)
- [edge.log.txt](edge.log.txt)
- [format.log.txt](format.log.txt)
- [gate-results.jsonl](gate-results.jsonl)
- [independent-results.json](independent-results.json)
- [independent.log.txt](independent.log.txt)
- [independent.mjs](independent.mjs)
- [infrastructure.config.mts](infrastructure.config.mts)
- [mcp-provenance.json](mcp-provenance.json)
- [mcp-provenance.mjs](mcp-provenance.mjs)
- [mcp-wire.log.txt](mcp-wire.log.txt)
- [mcp.log.txt](mcp.log.txt)
- [native-start.log.txt](native-start.log.txt)
- [playwright.script-recovery.config.ts](playwright.script-recovery.config.ts)
- [prepare-fixtures.mjs](prepare-fixtures.mjs)
- [prepare.log.txt](prepare.log.txt)
- [process-exit.json](process-exit.json)
- [recovery-process.integration.mjs](recovery-process.integration.mjs)
- [recovery-process.log.txt](recovery-process.log.txt)
- [restart.log.txt](restart.log.txt)
- [retarget.mjs](retarget.mjs)
- [run-gates.ps1](run-gates.ps1)
- [runtime.json](runtime.json)
- [sanitize.mjs](sanitize.mjs)
- [script-recovery.browser.ts](script-recovery.browser.ts)
- [standalone-edge-dialog.txt](standalone-edge-dialog.txt)
- [standalone-edge-results/.last-run.json](standalone-edge-results/.last-run.json)
- [typecheck.log.txt](typecheck.log.txt)
- [verify-bundle.mjs](verify-bundle.mjs)
- [write-report.mjs](write-report.mjs)
