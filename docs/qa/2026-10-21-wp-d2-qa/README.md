# Independent QA: WP-D2 bounded webhook return delivery (#246)

## 1. Branch and worktree

Verdict: **FAIL for the overall QA gate: infrastructure and API coverage are red. Targeted #246 acceptance PASSED (25 independent native cases, archived-store upgrade, three built-process acceptances and both Edge specs).** See sections 5 and 8 for failed gates. No WP-D2 product defect has been observed. This is independent QA, not implementation, cross-vendor review, merge sign-off or owner acceptance.

- Tested head: `77d767a6710e2fa04b92a3aa67893b430a926358`; PR source `codex-wp-d2-webhook-retry`, target `main`.
- QA branch: `codex-qa-wp-d2`; worktree: `%WORKTREE%` (repository-relative `.claude/worktrees/codex-qa-wp-d2`). Comparison merge-base with local main: `48ecf6e7a059015b2df604beb0284942f84145fe`.
- Windows PowerShell, Node `v22.14.0` first on PATH, `pnpm.cmd`; Edge selected with `GG_E2E_BROWSER_CHANNEL=msedge`. Test timestamps use UTC; the local QA date is 2026-10-21 (America/Chicago).
- New evidence is uncommitted; ready for orchestrator review. No product file, Git index, branch, commit or external service was changed. No sub-agent was used.

Manual ports: API **5810**, receiver **5811**, proven closed refusal destination **5819**. Archived-store fixture API and receiver used **5812/5813**. The requested repository suites retain their built-in ephemeral test ports; these are separate from the manual listeners. No owner app, store, port 4747/4748 or paid provider turn was used.

Stores (removed by their validated finally cleanup):

- `%TEMP%\gg-qa-246-native-IQkL50`.
- `%TEMP%/gg-qa-246-upgrade-0TVkL4` with `original` and `after` child directories; see [upgrade-cleanup.json](upgrade-cleanup.json) for the exact generated root.
- Repository suite stores use the suites' own temporary prefixes and cleanup; they are not owner stores. Any suite cleanup failure remains a failed test, not proof of successful cleanup.

The separate archived source export is **not a store**. Retained for orchestrator cleanup: `%TEMP%\gg-qa-246-source-523bb0bbf97742c39aa6df6c1e3533af` and its temporary source manifest. See section 8.

Read authority: QA-COMMON.md, COMMON.md, issues #246/#184/#278; branch docs/README, issue workflow, architecture/implementation orientation, ADR-0043 including its 2026-10-21 amendment, docs/05, CHANGELOG #246, main's register D-021 and section 6, and the implementer's October 20 records and October 21 round-four report/procedure. Current documentation and executed results govern; historical reports are not counted as new passes.

## 2. Per bolt and acceptance coverage

Touched systems: return contracts; execution/finalization and parent-child continuation; durable SQLite event journal and migration; real outbound HTTP and acknowledgement classification; process crash/restart/orderly close; REST detail/events and generated client; MCP get/wait; inspector polling; adjacent inbound receiver address flow; migration metadata and documentation.

For each matrix row, the common steps were: publish a current-format manual-trigger/exit loop through the built authenticated REST API; start it; let the real receiver return the named status/body/transport behavior; poll GET /runs/{id}; read GET /runs/{id}/events and the real SQLite run_events rows; compare delivery sequence/type projections; assert the final count, status and identity. No harness/provider node is executed. The 19 classification runs are started together, exercising concurrent delivery workers. Receivers count every request and implement no deduplication.

Expected and actual per check:

| Check / receiver behavior | Expected                                                                     | Actual                                                            | Result | Evidence                                        |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ | ----------------------------------------------- |
| five-success              | 5 attempts; delivered                                                        | delivered; 5/5 attempts; http 503; gaps 2036/5024/10023/20058 ms  | PASS   | [evidence](native-five-success.json)            |
| always                    | 5 attempts; failed                                                           | failed; 5/5 attempts; http 503; gaps 2009/5027/10014/20140 ms     | PASS   | [evidence](native-always.json)                  |
| http-408                  | 5 attempts; failed                                                           | failed; 5/5 attempts; http 408; gaps 2013/5027/10025/20137 ms     | PASS   | [evidence](native-http-408.json)                |
| http-429                  | 5 attempts; failed                                                           | failed; 5/5 attempts; http 429; gaps 2025/5029/10016/20256 ms     | PASS   | [evidence](native-http-429.json)                |
| http-500                  | 5 attempts; failed                                                           | failed; 5/5 attempts; http 500; gaps 2015/5022/10024/20190 ms     | PASS   | [evidence](native-http-500.json)                |
| http-400                  | 1 attempts; failed                                                           | failed; 1/5 attempts; http 400                                    | PASS   | [evidence](native-http-400.json)                |
| http-401                  | 1 attempts; failed                                                           | failed; 1/5 attempts; http 401                                    | PASS   | [evidence](native-http-401.json)                |
| http-404                  | 1 attempts; failed                                                           | failed; 1/5 attempts; http 404                                    | PASS   | [evidence](native-http-404.json)                |
| redirect                  | 1 attempts; failed                                                           | failed; 1/5 attempts; http 302                                    | PASS   | [evidence](native-redirect.json)                |
| never                     | 5 attempts; failed                                                           | failed; 5/5 attempts; timeout; gaps 12049/15033/20034/30202 ms    | PASS   | [evidence](native-never.json)                   |
| slow-body                 | 5 attempts; failed                                                           | failed; 5/5 attempts; timeout; gaps 12037/15042/20039/30132 ms    | PASS   | [evidence](native-slow-body.json)               |
| overflow                  | 5 attempts; failed                                                           | failed; 5/5 attempts; transport; gaps 2039/5013/10015/20192 ms    | PASS   | [evidence](native-overflow.json)                |
| small-body                | 1 attempts; delivered                                                        | delivered; 1/5 attempts                                           | PASS   | [evidence](native-small-body.json)              |
| exact-boundary            | 1 attempts; delivered                                                        | delivered; 1/5 attempts                                           | PASS   | [evidence](native-exact-boundary.json)          |
| late                      | 2 attempts; delivered                                                        | delivered; 2/5 attempts; timeout; gaps 12097 ms                   | PASS   | [evidence](native-late.json)                    |
| drop                      | 2 attempts; delivered                                                        | delivered; 2/5 attempts; transport; gaps 2033 ms                  | PASS   | [evidence](native-drop.json)                    |
| refused                   | 5 attempts; failed                                                           | failed; 5/5 attempts; connection_refused                          | PASS   | [evidence](native-refused.json)                 |
| credentials               | 1 attempts; failed                                                           | failed; 1/5 attempts; invalid_destination                         | PASS   | [evidence](native-credentials.json)             |
| scheme                    | 1 attempts; failed                                                           | failed; 1/5 attempts; invalid_destination                         | PASS   | [evidence](native-scheme.json)                  |
| two-channels              | Distinct ULIDs                                                               | delivered; 1/5 attempts; delivered; 1/5 attempts                  | PASS   | [evidence](native-two-channels.json)            |
| parent-child              | Parent continues while delivery pending; child finalized after final failure | failed; 5/5 attempts; http 503                                    | PASS   | [evidence](native-parent-child.json)            |
| crash-between-two-three   | Exactly five total attempts across restart                                   | failed; 5/5 attempts; http 503                                    | PASS   | [evidence](native-crash-between-two-three.json) |
| delivered-not-resent      | No resend or event changes after hard kill/restart                           | delivered; 1/5 attempts; delivered; 1/5 attempts                  | PASS   | [evidence](native-delivered-not-resent.json)    |
| orderly-backoff           | No new attempt on stop; next boot uses attempt two                           | delivered; 2/5 attempts; http 503; stop 192 ms, zero new requests | PASS   | [evidence](native-orderly-backoff.json)         |
| orderly-attempt           | No new attempt on stop; next boot uses attempt two                           | delivered; 2/5 attempts; timeout; stop 9842 ms, zero new requests | PASS   | [evidence](native-orderly-attempt.json)         |

Additional detail and steps for the non-matrix rows:

- **two-channels:** one exit names two different receiver paths. Expect distinct ULIDs for the two channels, one unchanged identity on each channel. Both journal IDs exactly match the received Idempotency-Key values; all current budgets are five. [analysis.json](analysis.json), [receiver.json](receiver.json).
- **crash-between-two-three:** wait until attempt two is durably finished and the delivery is in backoff; SIGKILL the API; start a new process on the same store. Expect three remaining attempts, not five fresh attempts. Exactly five requests total, one identity, final HTTP 503 failure; the captured before rows and final rows show the remaining budget. [native-crash-between-two-three.json](native-crash-between-two-three.json).
- **delivered-not-resent:** capture a delivered run's full SQLite rows, SIGKILL, restart, observe for 2.3 s. Expect no new request/event or changed row. Counts and full row comparison are unchanged. The migration fixture independently observes a second startup too. [native-delivered-not-resent.json](native-delivered-not-resent.json).
- **orderly-backoff / orderly-attempt:** boot the repository's Windows native IPC-close wrapper, wait for the first backoff or active held request, call its stop bridge and wait for process exit. Expect no new request after stop; a backoff wakes immediately; an in-flight request uses its original ten-second deadline. Actual exits: **192 ms / 9,842 ms**, code zero, zero new requests. Restart resumes each identity on attempt two and delivers. This exercises the real built app.close/container stop path; it is not a claim that Windows delivered a POSIX signal or that physical console Ctrl+C was tested. [process-lifecycle.json](process-lifecycle.json).
- **parent-child:** park a parent on a child input wait; submit the child's input; let its exit webhook fail 503. Expect the parent's execution to continue from the child's recorded successful execution while delivery remains pending; child finalized_at remains null until delivery ends. Observed parent succeeded during pending delivery, child finalized after five failed requests, one child_run.finished notification. [native-parent-child.json](native-parent-child.json).

For #246's two acceptance criteria: **PASS**. Eligible failures have a finite durable budget and stable identity, while unknown acknowledgement and possible prior effects remain visible; the receiver performs no deduplication. Successful execution stays succeeded when its delivery is pending or failed. Late acknowledgement, lost connection, slow body and oversized acknowledgement never become proof that the effect did not happen. Crash/retry retains identity and consumed budget.

The brief's wording “one final return.delivered / return.failed” is interpreted using ADR-0043: webhook terminal receipts are now **delivery.finished** with delivered/failed status. Each channel has exactly one terminal delivery event in REST and SQLite; return.delivered / return.failed apply to other sinks. No retired webhook receipt was expected or fabricated.

## 3. Files changed

Only this evidence directory was added. Scripts: native.mjs (independent API/SQLite/receiver checks), gates.mjs (command runner), upgrade.mjs and base-loader.mjs (adapted documented fixture), prepare-upgrade.mjs, analyse.mjs, package-evidence.mjs and write-report.mjs. Text logs, compact indexes, per-case JSON and this report preserve the observations. No shared/product file was changed, and no edit was made in another worker's package.

Reproduce native evidence after build: `node docs/qa/2026-10-21-wp-d2-qa/native.mjs`. It creates a binary-issued API key kept only in memory, removes its store and records sanitized observations. Per-case files archive the completed run; native.json is the compact index. [api-log.json](api-log.json) contains selected startup/warning log lines, [receiver.json](receiver.json) all 66 timestamped native requests, and each native case includes raw SQLite rows plus API delivery events. Upgrade evidence is [verify.json](verify.json).

## 4. Tests and original-store upgrade

No production fix, unit-test edit or failed-before regression claim is made in this QA thread. The independent acceptance scripts use supported HTTP/storage shapes and real process/network failure injection, without monkey-patching product internals.

The original store was created by an archived `52360d99def690d3cff9f36cc81a76b48c172582` source build, using the implementer's documented base-build emitter and workspace-aware loader. This emits the archived TypeScript to its own dist and borrows installed external dependencies; it is not a fresh old-toolchain install/typecheck. The original built API publishes a child with webhook, retired Event, caller and log returns, and a parent awaiting it. After the old receiver sees one held request, kill the old process. SQLite proves child succeeded with one run.finished, no finalization marker and no return receipt, while the parent is waiting. Open that original store's copy with the tested build.

| Upgrade check                                | Expected                                                                                        | Actual                                                                                                                                                                                                                    | Result / evidence                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Migration 0015 pending projection            | One unknown consumed old attempt, frozen maxAttempts 5; resume without fresh budget             | Imported delivery.attempt_finished row has attempts 1, maxAttempts 5, acknowledgement unknown, interrupted reason. One new request delivers on projected attempt 2. Two requests total including the unkeyed old request. | PASS, verify.json migrationImport and migratedState                        |
| Retired stored Event return                  | Typed LOOP_UPGRADE_REQUIRED warning, no Event receipt/publication, other supported sinks finish | Two first-start warnings name the child run, loop, version and channelKind event; caller/log delivered, webhook delivered, no Event receipt or finalize error; old events and definitions compare unchanged               | PASS, verify.json diagnostics, childApiEvents, originalState/migratedState |
| Parent and finalization                      | Parent continues once with child's recorded outcome; child finalized                            | Child and parent succeeded/finalized; parent result contains old-child-result; one child_run.finished                                                                                                                     | PASS, verify.json                                                          |
| Second startup                               | No new warning, request, run/event/version row                                                  | Exact complete rows unchanged and receiver request count unchanged; no retired-return/finalize warning                                                                                                                    | PASS, verify.json secondStartupUnchanged                                   |
| Migration generation and metadata formatting | No schema drift; shipped journal/snapshot properly formatted                                    | check:migrations says generation is a no-op; explicit Prettier check of 0015_snapshot.json and _journal.json passes                                                                                                       | PASS, migrations.log.txt and metadata-format.log.txt                   |

Coverage summaries and exact package/suite results are in section 5 and their logs. Contracts focused cases: 2 passed; MCP suite: 45 passed; inspector components: 23 passed. Generated-client suite: 70 passed, one template test failed with test and cleanup-hook timeouts; isolated triage also failed the same test and cleanup hook (1 passed / 1 failed); see client-template-triage.log.txt. These fake-harness/component suites supplement, rather than replace, the built-process/SQLite evidence.

## 5. Gates

All commands use Node 22 first on PATH. Coverage packages run directly rather than through a cached Turbo test result; two workers limit contention. No thresholds, timeouts, exclusions or assertions were weakened. Root build: **PASS**, 11 tasks successful (2 cached), build.log.txt.

| Exact command                                                                                                                                                      | Actual                  | Evidence                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------- |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                               | PASS, exit 0, 49.87 s   | [log](engine.log.txt)           |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                       | FAIL, exit 1, 176.90 s  | [log](infrastructure.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                                  | FAIL, exit 1, 1110.40 s | [log](api.log.txt)              |
| `pnpm.cmd test:webhook-retry`                                                                                                                                      | PASS, exit 0, 137.82 s  | [log](webhook-retry.log.txt)    |
| `pnpm.cmd test:recovery-process`                                                                                                                                   | PASS, exit 0, 26.80 s   | [log](recovery-process.log.txt) |
| `pnpm.cmd test:wait-restart`                                                                                                                                       | PASS, exit 0, 125.53 s  | [log](wait-restart.log.txt)     |
| `Set-Location apps/web; $env:GG_E2E_BROWSER_CHANNEL='msedge'; pnpm.cmd exec playwright test e2e/webhook-delivery.spec.ts e2e/webhook-receiver.spec.ts --retries=0` | PASS, exit 0, 31.86 s   | [log](edge.log.txt)             |
| `pnpm.cmd check:migrations`                                                                                                                                        | PASS, exit 0, 5.98 s    | [log](migrations.log.txt)       |
| `pnpm.cmd typecheck`                                                                                                                                               | PASS, exit 0, 126.78 s  | [log](typecheck.log.txt)        |
| `pnpm.cmd lint`                                                                                                                                                    | PASS, exit 0, 272.30 s  | [log](lint.log.txt)             |
| `pnpm.cmd format:check`                                                                                                                                            | FAIL, exit 1, 258.03 s  | [log](format.log.txt)           |
| `pnpm.cmd check:layers`                                                                                                                                            | PASS, exit 0, 7.46 s    | [log](layers.log.txt)           |
| `pnpm.cmd check:deps`                                                                                                                                              | PASS, exit 0, 54.61 s   | [log](deps.log.txt)             |
| `pnpm.cmd check:docs`                                                                                                                                              | PASS, exit 0, 8.29 s    | [log](docs.log.txt)             |

Additional commands: `pnpm.cmd --filter @graphgoblin/contracts exec vitest run src/delivery.test.ts` (PASS, contracts.log.txt); `pnpm.cmd --filter @graphgoblin/api-client test` (FAIL, api-client.log.txt); `pnpm.cmd --filter @graphgoblin/mcp test` (PASS, mcp.log.txt); `pnpm.cmd --filter @graphgoblin/web exec vitest run src/runs/inspector/DeliveryPanel.test.tsx src/runs/RunInspectorPage.test.tsx --maxWorkers=2` (PASS, web-components.log.txt). Explicit migration metadata formatting: `pnpm.cmd exec prettier --check packages/infrastructure/drizzle/meta/0015_snapshot.json packages/infrastructure/drizzle/meta/_journal.json` (PASS, metadata-format.log.txt).

The first root format check failed only native.json, a QA artifact updated during the run. Final evidence formatting/check is recorded separately after evidence stops changing; this is not a product formatting defect. check:deps reports the existing infrastructure drizzle.config.ts orphan warning. No dependency changed, so no additional license gate was needed.

## 6. Docs

No numbered doc, ADR, CHANGELOG or generated reference was edited. Executed behavior agrees with ADR-0043, docs/05 and the #246 upgrade notes: complete bounded 2xx acknowledgement; unknown overflow/timeout/interruption; stable identity without exactly-once guarantees; five total attempts; D-021 stopping; terminal retired-Event bookkeeping without renewed admission. Generated docs check passed. The register correctly distinguishes engineering parameters from owner decisions and records the deferred Retry-After/manual-redelivery/concurrency-cap seams; those were not expanded here.

## 7. Decisions and parameters

No delivery policy was chosen or changed by QA. Tests use the documented 2/5/10/20-second delays, ten-second full acknowledgement deadline and 64-KiB body bound. Timing assertions allow scheduling/storage overhead: retry gaps at least nominal minus 100 ms and under nominal plus 2.5 s; per-attempt deadline observations 9.9–12.5 s. Actual never/slow-body deadlines were approximately 10.01–10.06 s; the persistent-failure and fifth-success request gaps are listed per case.

The built-process Windows close bridge is used because native Windows SIGTERM is forceful. SIGKILL establishes forced-crash recovery. The live receiver does not deduplicate and records all arrivals; no paid provider capability or real-provider behavior is inferred from these runs. The upgrade fixture adapts the documented procedure only for this thread's ports, prefixes, evidence path, frozen-budget assertions and row capture; no product implementation was changed.

## 8. Caveats and open items

No WP-D2 functional defect was found in the completed native acceptance. Required gates are not all green. Infrastructure coverage failed seven exact D-015 native process-tree cases (650 passed; lines **98.65%**, branches **94.77%**):

1. adversarial.test.ts — “6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild” (30 s timeout).
2. process/scripts.test.ts — “kills and closes a real process cancelled with incomplete UTF-8 pending on both streams” (cancellation required emergency fixture cleanup).
3. process/scripts.test.ts — “kills the process tree on timeout” (15 s timeout).
4. process/scripts.test.ts — “kills the process when the signal aborts, including when already aborted” (15 s timeout).
5. claude/process.test.ts — “kills on deadline and output overflow” (EBUSY fixture cleanup).
6. claude/process.test.ts — “does not spawn for an already aborted signal and cancels a running process” (EBUSY fixture cleanup).
7. claude/process.test.ts — “kills the descendant that a long-lived child started” (continued descendant output and EBUSY cleanup).

These match the documented sandbox/native-process class. This run establishes the failures, not a new outside-sandbox pass or proof that they are harmless. Full infrastructure remains FAIL. Locked native fixture directories named in infrastructure.log.txt are separate from GraphGoblin stores: %TEMP%/gg-claude-process-nfD83v, %TEMP%/gg-claude-process-kioFvr and %TEMP%/gg-claude-process-xVwkaH. COMMON leaves non-store directory cleanup to the orchestrator.

Outside-scope test observation: api-client/src/templates.test.ts timed out in “creates an ordinary editable draft with the generated client without automation setup”, then its afterEach hook timed out. The full 70/71 result remains failed even if narrow triage passes. No code was changed and no whole-suite retry-to-green was performed. All explicitly requested suites completed. No broad suite was rerun.

Automatic approval review rejected recursive deletion of the archived source-build directory, stating **“blocked by policy.”** It is not a data store and COMMON also reserves non-store directory cleanup for the orchestrator; the source export and source manifest listed in section 1 are retained. The independently created native and upgrade stores were removed by bounded finally cleanup. No permission to delete other directories was inferred.

### Final suite findings and severity

No confirmed WP-D2 functional defect was found. The following are **validation blockers**, not assertions that a new webhook regression was reproduced:

1. **Major validation blocker — API suite remains red.** Full coverage: 698 passed, 4 failed, 6 skipped; lines 97.83%, branches 92.95%. Failures were the three cases in subloop-restart.test.ts (180 s hard-kill test timeout; constructed child absent/running instead of waiting; 60 s cleanup hooks) and the first controlled GitHub recipe case (20 s timeout). One bounded isolated run, without coverage and with one worker, gave 7 passed / 1 failed across those two files. All eight hard-kill landings, parent-mid-wake recovery and all five recipe cases passed; “the built API recovers a child finished while down with one continuation per parent” failed its 60 s afterEach cleanup hook. The hook failure is reproduced independently of full-suite concurrency. Cause remains unresolved in this sandbox; no new outside-sandbox pass is claimed. See api.log.txt and api-failure-triage.log.txt. The full run is retained as FAIL.
2. **Major validation blocker — infrastructure D-015 cases.** Seven named failures remain as listed above; the high coverage percentages do not turn the command green. The existing D-015 classification is historical context, not fresh proof about host causality or an exemption.
3. **Minor outside-scope validation defect — client template test timeout.** The 5 s test and 10 s cleanup hook fail both in the full client suite (70/71) and a single-file one-worker triage (1/2). No webhook-delivery assertion failed. This is not labelled disproven or cleared by a retry. See api-client.log.txt and client-template-triage.log.txt.

Other results: engine coverage 555 passed, lines 98.05%, branches 92.46%; Edge 2/2 passed with retries zero; webhook-retry, recovery-process and wait-restart all passed. The supplied Edge specs verify the inspector changes a pending delivery to delivered without reload while execution stays succeeded, and the published inbound receiver address creates exactly one run with the submitted JSON.

Exact additional triage commands:

- pnpm.cmd --filter @graphgoblin/api-client exec vitest run src/templates.test.ts --maxWorkers=1 — FAIL, 1 passed / 1 failed.
- pnpm.cmd --filter @graphgoblin/api exec vitest run src/subloop-restart.test.ts src/triggers/github-recipe.test.ts --maxWorkers=1 — FAIL, 7 passed / 1 failed (cleanup hook).

The built wait/restart suite reports its actual temporary stores in wait-restart.log.txt (both polling rates), and recovery-process.log.txt explicitly reports removal. The stock webhook-retry script does not print its generated store basename; its finally cleanup ran on its successful exit. These repository commands retain their existing port/prefix allocation; the independent new drivers use only 5810–5819 and gg-qa-246 stores.

The API recipe tests deliberately retain SQLite fixtures under the worktree's .tmp folder. All **ten** created by the full run plus narrow triage were inventoried, checked to contain only the known synthetic recipe files and gg.db, and removed. Exact manifests and successful deletion results are in suite-store-cleanup.json. Its remainingOwnTempEntries lists only the archived source export and source manifest, not a store. The native/upgrade cleanup records are independent. No current owner or other worker directory was included.

Final formatting: **PASS**, `pnpm.cmd format:check`, exit 0; [final-format.log.txt](final-format.log.txt) and [final-checks.json](final-checks.json). The earlier format failure was confined to the in-progress QA artifact and remains recorded. All manual ports are closed and the final working-tree status contains only this QA folder ([environment.json](environment.json)).
