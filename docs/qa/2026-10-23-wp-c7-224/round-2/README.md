# WP-C7 #224 round 2

## 1. Branch and worktree

Branch `codex-wp-c7-224`; starting HEAD `5d8591df186ca476924a6dae0ddf227249fe866f`
(PR #390). Worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-c7-224`.
Uncommitted; the orchestrator owns the commit, push, review and QA. No index or branch operation was performed.

## 2. Per bolt

All three blocking findings were reproduced through public interfaces before production edits.

| Finding | Before                                                                                                                                                                                                                          | Implementation and verification                                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1      | `durable parks must not hold a normal drain: expected false to be true`; force changed future-timer and paused-input records to failed, `RUN_INTERRUPTED_BY_STOP`, non-resumable. [Baseline](baseline-blockers-engine.log.txt). | D-038 quiescence: no active executor, no queued family continuation, no due family wake. Durable input/signal/future-timer/child parks and pauses retain their records. Engine regressions and native normal/force restart cases verify preservation and resumption.                                                 |
| B2      | Event ingestion returned 202, with an inbound record and empty run IDs, where the behavior assertion expected 503. [Baseline](baseline-blocker-event.log.txt).                                                                  | Public `RunManager.assertAdmissionOpen()` is called before Event record allocation/insertion. HTTP tests verify Event 503, webhook 503, unchanged cron slots and unused poll dedupe; the built-app test retries the same Event/dedupe key after restart and starts a run.                                            |
| B3      | Earlier script timeout: normal drain rejected with `Native process termination unconfirmed; ownership retained`. [Baseline](baseline-blockers-engine.log.txt).                                                                  | Earlier unconfirmed cleanup is diagnostic only. First-abort causality distinguishes this force from an earlier timeout/cancel. Native cases verify normal exit after an earlier failure, and explicit further force after `force-failed`: exit 1, durable failure unchanged, lock retained and reclaimed by restart. |

Additional causal regressions found while checking the requested boundaries:

- A drain observation failure racing force incorrectly became `force-failed`: `expected 'force-failed' to be 'drain-failed'`. [Before](baseline-drain-error-race.log.txt). A typed `ShutdownCleanupError` distinguishes the stop's own native cleanup veto; drain failures retain their origin and reject force with 409.
- Interrupting an executing child woke and failed its parked parent. [Before](baseline-force-parent-park.log.txt). Child-result notification now defers to restart during force.
- A future timer that became due during force cleanup changed from waiting to running. [Before](baseline-force-timer-park-corrected.log.txt). Force defers timer delivery, retaining the durable park and timer.
- Restoring authored heartbeat timeout semantics initially let an unconfirmed force-owned probe release ownership: `promise resolved "undefined" instead of rejecting`. [Before](baseline-heartbeat-force-corrected.log.txt). Heartbeat probes now retain first-abort causality: authored timeouts remain predicate input, while this stop's unconfirmed interruption blocks release. All 11 engine regression cases pass in [the focused run](heartbeat-causality.log.txt).
- A forwarded duplicate of a deliberate force generated another force command. [Before](baseline-forwarded-force.log.txt). Every accepted signal is coalesced for one second, including force, so forwarding cannot acknowledge failed cleanup. The signal driver also recognizes an API-initiated stop.

The B2 pre-edit HTTP fixture had no matching published Event trigger: it demonstrates the
incorrect 202 and persisted receipt while admission is closed, not an independent native
reproduction of losing a matching trigger's run. The post-edit native case uses a matching
published trigger and proves that the refused Event's same dedupe key starts a run after restart.

The HTTP/native normal-drain scenario keeps an executor active while answering input, admitting a required child, firing its timer, completing a multi-node parent and observing SSE. Independent queued work does not start until restart. The native park cases preserve a paused input and parent/child waits, resume them after restart, and let a past timer finish. No paid provider turns were made; harness component tests use fakes.

Required smaller fixes:

- N1: one-second signal coalescing uses fake timers, including forwarded force and a signal after API stop.
- N2: heartbeat timeout/unconfirmed evidence reaches the authored predicate without failing the run.
- N3: a drain 202 awaits capture and includes actual executor/queued-family IDs.
- N4: invalid controls return 409 with current phase; drain failures are distinct from force cleanup failures.
- N5: no-kill-timer verification uses fake time (including a full day); process cleanup tests observe completion instead of counting microtasks. Public HTTP assertions cover status, input and cancellation during drain. Round-2 baselines assert behavior, rather than missing routes. Historical round-1 404 baselines are not used as round-2 proof.
- N6: main test budgets restored to 60 seconds; the GitHub recipe restores its ordinary 20-second budget.
- N9: duplicate config comment removed. Definition-pin teardown uses normal stop again.

## 3. Files changed

See [shared-file ranges](SHARED-TOUCHES.md) and the [source manifest](SOURCE-MANIFEST.json) for exact paths and hashes.
The shared Event service change is deliberately small for #343: preserve the manager's public
admission check in its dependency type and call it before targeted admission records anything.
Run-manager and inference changes overlapping #375 are additive shutdown bookkeeping and
first-abort metadata; child-creation recovery and uncertain-turn algorithms were not rewritten.
No #355 reset/conversion files or reserved migrations were changed.

The startup test preserves `GG_TEST_` fixture fences while sanitizing product configuration, including on failure. The existing native harnesses accept test-only port-range and temporary-prefix environment
selection so this run can stay within 5760-5769 and `gg-wp-c7-224-`. Their defaults and product
configuration are unchanged. In-memory component fixtures retain their existing isolated names.

## 4. Tests

The final engine run passed **1,598 tests in 42 files**, with **97.75% lines (2,651/2,712)** and **92.43% branches (2,284/2,471)**. [Coverage gate](engine-coverage-final.log.txt).

The initial full coverage gates remain failed results: infrastructure **771 passed / 10 failed**; API **1,334 passed / 10 failed / 11 skipped**; client **71 passed / 1 failed**. These failing runs did not emit coverage summaries. The serial runs below retain failure reporting and supply measured coverage without waiving earlier failures.

| One isolated rerun            | Result                                                  | Evidence                                     |
| ----------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| Infrastructure SQLite upgrade | 20 passed, 6 timeouts at 20 seconds                     | [log](sqlite-upgrade-isolated.log.txt)       |
| Client template               | 2 passed                                                | [log](client-templates-isolated.log.txt)     |
| API startup                   | 5 passed, 4 platform skips; 60-second budgets unchanged | [log](api-main-isolated.log.txt)             |
| API shutdown processes        | 6 passed, 3 Linux-only skips                            | [log](api-shutdown-process-isolated.log.txt) |
| API subloop restart           | 2 passed, 1 teardown timeout at 60 seconds              | [log](api-subloop-restart-isolated.log.txt)  |
| API GitHub recipe             | 5 passed; 20-second budget unchanged                    | [log](api-github-recipe-isolated.log.txt)    |
| API template packaging        | 4 passed                                                | [log](api-catalog-package-isolated.log.txt)  |

The infrastructure initial failures comprise six native termination/cleanup cases (D-015) and four SQLite upgrade timeouts. Its isolated rerun remained failed and is not waived. The subloop restart file also remains failed after its isolated rerun. The focused Windows process run and its isolated repeat both passed all six applicable cases.

The final serial results follow. Initial failed gates and isolated reruns remain separate results.
The earlier development logs remain retained: invalid fixture fields/types and fake-clock setup
errors were corrected, rather than hidden or accepted as product regressions.
The first timer-during-force baseline used a nonexistent fake timer helper; only the corrected
baseline linked above is behavioral evidence. The first heartbeat-force baseline also had an invalid fixture (missing a heartbeat termination condition); its corrected baseline is the behavioral evidence.

<!-- FINAL-PACKAGES -->

| Final full package run                                                  | Result   | Tests                                      | Lines              | Branches           |
| ----------------------------------------------------------------------- | -------- | ------------------------------------------ | ------------------ | ------------------ |
| [Engine](engine-coverage-final.log.txt)                                 | PASS     | 1598 passed (1598)                         | 97.75% (2651/2712) | 92.43% (2284/2471) |
| [Infrastructure diagnostic](infrastructure-coverage-diagnostic.log.txt) | FAIL (1) | 6 failed ; 775 passed (781)                | 98.58% (2232/2264) | 95.18% (1819/1911) |
| [API serial](api-coverage-serial.log.txt)                               | FAIL (1) | 1 failed ; 1343 passed ; 11 skipped (1355) | 97.47% (1931/1981) | 92.35% (1378/1492) |
| [Client serial](client-coverage-serial.log.txt)                         | PASS     | 72 passed (72)                             | 100% (246/246)     | 99.37% (160/161)   |

<!-- /FINAL-PACKAGES -->

## 5. Gates

Final command results are generated into `COMMAND-RESULTS.json`. Every gate uses Node 22 first
on PATH; the confirmed runtime is `v22.14.0`.

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:GG_TEST_PORT_START = '5760'
$env:GG_TEST_PORT_COUNT = '10'
$env:GG_TEST_STORE_PREFIX = 'gg-wp-c7-224-'
```

The first focused native Windows run passed six cases and skipped the three Linux-only signal/
fake-CLI cases. The later full API coverage run also executes the native specification against
the rebuilt app. Windows native controls use HTTP: programmatic Windows SIGINT/SIGTERM bypass
JavaScript, and sandbox tree termination is restricted by D-015.

<!-- FINAL-GATES -->

| Command                                                                                                 | Result   | Evidence                                          |
| ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                    | PASS     | [log](typecheck-handoff.log.txt)                  |
| `pnpm.cmd lint`                                                                                         | PASS     | [log](lint-handoff.log.txt)                       |
| `pnpm.cmd format`                                                                                       | PASS     | [log](format.log.txt)                             |
| `pnpm.cmd check:docs`                                                                                   | PASS     | [log](check-docs-final.log.txt)                   |
| `pnpm.cmd docs:generate`                                                                                | PASS     | [log](docs-generate.log.txt)                      |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                   | PASS     | [log](engine-coverage-final.log.txt)              |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1`                            | FAIL (1) | [log](infrastructure-coverage.log.txt)            |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                      | FAIL (1) | [log](api-coverage.log.txt)                       |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage`                                               | FAIL (1) | [log](client-coverage.log.txt)                    |
| `pnpm.cmd build`                                                                                        | PASS     | [log](build-heartbeat-final.log.txt)              |
| `pnpm.cmd test:recovery-process`                                                                        | PASS     | [log](recovery-process.log.txt)                   |
| `pnpm.cmd test:wait-restart`                                                                            | PASS     | [log](wait-restart.log.txt)                       |
| `pnpm.cmd check:layers`                                                                                 | PASS     | [log](check-layers.log.txt)                       |
| `pnpm.cmd check:deps`                                                                                   | PASS     | [log](check-deps.log.txt)                         |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=1 --coverage.reportOnFailure`            | FAIL (1) | [log](api-coverage-serial.log.txt)                |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --maxWorkers=1`                                | PASS     | [log](client-coverage-serial.log.txt)             |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure` | FAIL (1) | [log](infrastructure-coverage-diagnostic.log.txt) |

The final `pnpm.cmd format:check` passed; its result is recorded in [its log](format-check-final.log.txt) and the command index. The serial diagnostic flags change scheduling and reporting only; no thresholds, exclusions or test deadlines were relaxed. The initial API wrapper elapsed time includes its wait for infrastructure; Vitest prints its own execution duration.
<!-- /FINAL-GATES -->

## 6. Docs

ADR-0049 now states D-038, typed cleanup ownership, failure transitions, the explicit nonzero
exit, signal coalescing and residual N10/N11. Updated docs 05, 07, 11, guide 07 and CHANGELOG
(including Upgrade). API references and API-client OpenAPI/types are regenerated. No stored
column or migration 0019 is needed; interruption and cleanup evidence use existing events and
failure details.

## 7. Decisions and parameters

The container remains the sole shutdown-state owner. Main translates signals and closes resources
only at readiness. Normal drain permits captured family continuations and due wakes, while
parks/pauses and independent queued work remain recoverable. Force targets executing and queued
family work; timer and child-result wakes defer until restart so existing parks stay unchanged.

Earlier cleanup warnings appear in `unconfirmedRunIds`. Only this shutdown's own first-abort
cause can veto release. `force-failed` offers a further explicit force: main exits 1, preserves
the recorded failure and leaves ownership for dead-PID reclamation. A drain observation failure
is `drain-failed`, and invalid transitions return the current state with 409.

Engineering parameters: five-minute configurable grace (notification only); 50 ms drain
observation; five-second native cleanup reporting bound; one-second coalescing per accepted
signal; 100 ms response-flush allowance for the explicit failed-stop exit. None is an owner-selected
number. Compose retains its external one-hour example deadline. `wait` installs no hidden kill timer.
#319 can consume accurate run IDs, warnings, phase, choices, 202 acknowledgements and 409 refusals;
no browser shutdown UI is implemented here.

## 8. Caveats and open items

The orchestrator must commit the source and evidence together, then run the specified review/QA/
audit gates. N10 (Codex descendants on Windows) and N11 (cron's pre-existing gap between slot
advancement and listener admission) remain documented residual risks. The new cron admission
gate prevents ordinary stopped polling from consuming a slot; it does not make slot admission
atomic. Native Windows API control evidence establishes no Linux/macOS real-signal or live-provider claim.

The required initial infrastructure coverage command failed in six native termination/cleanup
cases under D-015 and four SQLite upgrade timeouts. The native failures include
`expected [Function] to throw an error` for a PID still reachable after cancellation, Claude
readiness reporting `Claude CLI check process did not confirm that it stopped` instead of
its ordinary timeout guidance, a descendant's marker assertion
`expected 'xxxxxxxxxxxxxxxxx' to be 'xxxxxxxxxxxx'`, and
`EBUSY: resource busy or locked, rmdir` during cleanup.
Those assertions are retained in [the original infrastructure gate](infrastructure-coverage.log.txt).
The unchanged SQLite upgrade file was rerun alone once: **20 passed, 6 timed out** at its
existing 20-second deadline. It remains a failed result, not a waived gate.
The final full infrastructure diagnostic passed all 26 SQLite upgrade tests and failed only
the same six D-015 native cases: **775 passed, 6 failed**, with **98.58% lines** and
**95.18% branches**. Its descendant marker assertion was `expected 'xxxxxxxx' to be 'xxxx'`;
the PID, readiness and `EBUSY` failures have the same shape as the original gate.

The API's final serial coverage run still fails the unchanged subloop restart test's
`afterEach` at `src/subloop-restart.test.ts:23`: **`Hook timed out in 60000ms.`**
Its single isolated rerun also failed that teardown (2 passed, 1 failed). All round-2 shutdown
and admission tests pass. The teardown timeout is unresolved; it is not attributed to D-015
without further evidence, and this report does not call the API gate green. Other initial
API timeout files and the client timeout passed their one isolated rerun; full serial client
coverage also passes. No timeout, threshold or exclusion was increased to obtain these results.
