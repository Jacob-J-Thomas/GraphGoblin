# WP-C7 #224 round 3

## 1. Branch and worktree

`codex-wp-c7-224`, base/head `7650e9510181d5f47187629ae15d7b07af5fc6ec`.
Worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-c7-224`.
Uncommitted; ready for orchestrator commit after the reported gates and review. No Git index,
commit, branch or push operation and no manual directory deletion was performed.

## 2. Per bolt

Both findings reproduced against the built API before production edits, with Node 22,
ports 5760/5761 and disposable `gg-wp-c7-224-` stores. Copies preserve the audit workflows;
only capture locations, ports, prefixes and `.log.txt` output names changed for the baseline.

- Wake during cleanup: `streamClosed: true`, `activeScriptReleased: false`, `apiExited: false`,
  `lock: true`; status/cancel/force each reported `TypeError: fetch failed`.
  `required child executed before exit: false`. See [driver](wake-during-cleanup.mjs.txt),
  [baseline log](before-wake-during-cleanup-native.log.txt) and
  [observations](before/wake-during-cleanup.json).
- Racing Events: `accepted without run: [1,2,3,4,5]`; all five retries after physical restart
  returned `202`, `duplicate: true`, `runIds: []`. See [driver](event-admission-race.mjs.txt),
  [baseline log](before-event-admission-race-native.log.txt) and
  [observations](before/event-admission-race.json).

The first driver-copy attempt decoded its UTF-8 BOM using the host default encoding and
failed to parse before starting the API. Those first logs are retained as setup failures,
not offered as reproduction evidence. The corrected UTF-8 copies produced the results above.

The first rebuilt verification passed both strict native drivers. The wake observation became
`streamClosed: false`, `activeScriptReleased: false`, `apiExited: false`, `lock: true`:
status returned 200, the nondestructive cancel/force probes returned 404/400, and the required
child executed before exit 0. See [verification log](after-wake-during-cleanup.log.txt) and
[observations](after/wake-during-cleanup.json). The Event driver reported
`accepted without run: []`; all six accepted requests held run identities, and after physical
restart all six keys retried against recoverable work which succeeded. See
[verification log](after-event-admission-race.log.txt) and
[observations](after/event-admission-race.json).

The continuation repeats both strict drivers against another fresh build, retaining separate
`handoff-*` logs and [wake](handoff/wake-during-cleanup.json) and
[Event](handoff/event-admission-race.json) observations. Both repeated drivers passed against the fresh build: the wake kept controls open and
completed its required child before exit; the Event race lost zero accepted requests and
recovered all six work identities across restart. The original and repeated captures are
kept independently, with exact commands and results below.

## 3. Files changed

See [the complete changed-file ranges](SHARED-TOUCHES.md) and
[working-tree source hashes](SOURCE-MANIFEST.json). Engine changes cover RunManager,
the new four-case admission regression file, two drain fixtures and one webhook fixture
synchronization. API changes cover Event intake and two maintained native regressions.
Docs changes cover 05, 07, ADR-0049, CHANGELOG and this implementation evidence.

Shared production ranges are RunManager 431-479 (quiescence), 498-500 (force lease wait),
535-585 (admission/scope accounting), plus the additive command wrappers listed in the range
record; Event service 18, 51 and 521-574. WP-D4 owns the Event intake/admission seam;
its required integration is recorded in section 7. No independent QA file, older capture
manifest, migration, dependency or public HTTP schema is changed.

## 4. Tests

`packages/engine/src/drain-admission.test.ts` adds public-interface cases for cleanup rechecks,
in-flight intake ownership, sealed wakes and scoped intake lifetime. The first three failed
before production edits in [the regression baseline](before-engine-regressions.log.txt):
`delivery cleanup must not seal a drain with an awakened executor: expected true to be false`,
`in-flight intake must hold ownership until its durable outcome: expected true to be false`,
and an input promise resolved instead of rejecting after the quiescent handoff.
The native cases repeat both audit workflows through the maintained subprocess fixture.
Their initial wake case mistakenly waited for `delivery.attempt_finished` rather than the
successful `delivery.finished` event, so its finite script ended and the next poll saw
`ECONNREFUSED`. This is a corrected test observation, not a new production drain defect;
both strict audit drivers had already passed. That first standalone result and first API
coverage run remain development evidence; final verification follows the correction.

The additional scope-lifetime case exercises the new capability's public contract; its baseline
is the native Event-loss reproduction, not a claim that the new method existed before.

The old in-flight-start test now expects a durable queued run rather than a commit-time drain
refusal. The parked-run fixture no longer tries to cancel after readiness has sealed mutations.
The first focused run retained those obsolete assumptions; it is recorded as a failed development
run. The corrected focused set passed 20 tests before adding the scope-lifetime case.

The initial full engine run and the one required isolated webhook-admission rerun both
failed the removed-target case: expected `WEBHOOK_TARGET_REMOVED`/`failed`, observed
`WEBHOOK_ADMISSION_RETRY`/`pending`. The fixture advanced its fake clock without waiting
for the initial background dispatch promised separately by the public API. One additive
`waitForWebhookRecovery()` now establishes that observable boundary before target removal
and clock advancement; retry policy and all deadlines remain unchanged.

<!-- COVERAGE -->

| Package        | Tests                           | Lines              | Branches           |
| -------------- | ------------------------------- | ------------------ | ------------------ |
| Engine         | 1610 passed (1610)              | 97.85% (2695/2754) | 92.43% (2321/2511) |
| API            | 1346 passed ; 11 skipped (1357) | 97.47% (1932/1982) | 92.24% (1380/1496) |
| Infrastructure | 13 failed ; 768 passed (781)    | 98.49% (2230/2264) | 95.18% (1819/1911) |

<!-- /COVERAGE -->

## 5. Gates

Executable `.tmp` driver copies are not kept; executed source copies are retained here as
`.mjs.txt` (see [adaptations](DRIVER-ADAPTATIONS.md)).

All gates select Node v22.14.0 first on PATH and use `pnpm.cmd`. Native fixture fences are
`GG_TEST_PORT_START=5760`, `GG_TEST_PORT_COUNT=10`, `GG_TEST_STORE_PREFIX=gg-wp-c7-224-`.
Disposable stores and marker files are runtime fixtures, not kept; retained observations
capture their measured outcomes. Exact commands, results and logs are retained here. No test deadline, exclusion or threshold
is increased. A failure in an untouched file is rerun alone once and both results retained.
Final evidence Markdown/JSON is formatted and checked separately in
[the format log](format-evidence-final.log.txt) and [check log](format-evidence-check.log.txt).
Logs are normalized to UTF-8 with local profile paths written as `%USERPROFILE%`.

The preceding provider turn ended while API coverage and format checking were running.
Their incomplete `*-provider-stopped.log.txt` captures have no completion or test verdict;
the continuation restarted those two gates after checking for surviving worktree jobs.
The earlier complete API run failed the retired-Event cold-start test with
`listen EADDRINUSE: address already in use 127.0.0.1:5762`, followed by
`Hook timed out in 60000ms.` in teardown. Its one required isolated file rerun is retained
separately: [2 tests passed](api-isolated-retired-event-startup.log.txt). The corrected full
API suite also passed (1,346 tests; 11 skipped). Neither result erases the original full-suite
port collision. No production change was made to the retired-Event path.

<!-- GATES -->

| Command                                                                                                 | Result   | Evidence                                                             |
| ------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                    | PASS     | [typecheck-handoff](typecheck-handoff.log.txt)                       |
| `pnpm.cmd lint`                                                                                         | PASS     | [lint-handoff](lint-handoff.log.txt)                                 |
| `pnpm.cmd format`                                                                                       | PASS     | [format](format.log.txt)                                             |
| `pnpm.cmd check:layers`                                                                                 | PASS     | [check-layers](check-layers.log.txt)                                 |
| `pnpm.cmd check:deps`                                                                                   | PASS     | [check-deps](check-deps.log.txt)                                     |
| `pnpm.cmd check:docs`                                                                                   | PASS     | [check-docs](check-docs.log.txt)                                     |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --coverage.reportOnFailure`                        | PASS     | [engine-coverage-final](engine-coverage-final.log.txt)               |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --coverage.reportOnFailure`                           | PASS     | [api-coverage-final](api-coverage-final.log.txt)                     |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure` | FAIL (1) | [infrastructure-coverage](infrastructure-coverage.log.txt)           |
| `pnpm.cmd build`                                                                                        | PASS     | [build-handoff](build-handoff.log.txt)                               |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/shutdown-process.test.ts --maxWorkers=1`        | PASS     | [shutdown-process-final](shutdown-process-final.log.txt)             |
| `node .tmp/wake-during-cleanup-verify-r3.mjs`                                                           | PASS     | [handoff-wake-during-cleanup](handoff-wake-during-cleanup.log.txt)   |
| `node .tmp/event-admission-race-verify-r3.mjs`                                                          | PASS     | [handoff-event-admission-race](handoff-event-admission-race.log.txt) |
| `pnpm.cmd format:check`                                                                                 | PASS     | [format-check-final](format-check-final.log.txt)                     |

<!-- /GATES -->

### Infrastructure gate qualification

The full infrastructure gate failed: **768 passed, 13 failed** (781 tests, 52 files).
Coverage was emitted with reporting enabled on failure: **98.49% lines (2,230/2,264),
95.18% branches (1,819/1,911)**. This is coverage from a failing gate, not a pass.
See [the full log](infrastructure-coverage.log.txt).

Six failures in unchanged files reached D-015 native termination limits:

- `src/process/scripts.test.ts`: `AssertionError: expected [Function] to throw an error`
  at `expect(() => process.kill(childPid, 0)).toThrow()`; the child remained alive.
- `src/claude/process.test.ts`: two cleanup `EBUSY` failures and a descendant marker still
  growing (`expected 'xxxxxxxxxx' to be 'xxxxxx'`), followed by its own `EBUSY` cleanup error.
- `src/adversarial.test.ts`: `EBUSY: resource busy or locked, rmdir` after the real
  child/grandchild abort scenario.
- `src/claude/readiness.test.ts`: expected the ordinary deadline message; received
  `Claude CLI check process did not confirm that it stopped.`

Seven separate timeouts occurred in untouched SQLite files: six in `src/sqlite/upgrade.test.ts`
and one in `src/sqlite/storage.test.ts`, each reporting `Test timed out in 20000ms.`
(the storage test's measured completion was about 30 seconds). These are recorded separately
from D-015, without claiming a proved cause. Each of the six failing files is rerun alone
once with `--maxWorkers=1`; the final isolated results are recorded below. The storage file
passed all 42 tests alone; the upgrade file failed again with nine 20-second timeouts
(17 passed, 9 failed). No cause is proved and no deadline is changed. The full gate remains
failed; the passing storage rerun does not waive its original timeout.
No infrastructure source, test or timeout is changed in this round.

<!-- ISOLATES -->

| Isolated file      | Result   | Tests                     | Evidence                                                                   |
| ------------------ | -------- | ------------------------- | -------------------------------------------------------------------------- |
| `adversarial`      | FAIL (1) | 1 failed ; 19 passed (20) | [infra-isolated-adversarial](infra-isolated-adversarial.log.txt)           |
| `claude-process`   | FAIL (1) | 3 failed ; 2 passed (5)   | [infra-isolated-claude-process](infra-isolated-claude-process.log.txt)     |
| `claude-readiness` | FAIL (1) | 1 failed ; 20 passed (21) | [infra-isolated-claude-readiness](infra-isolated-claude-readiness.log.txt) |
| `process-scripts`  | FAIL (1) | 1 failed ; 38 passed (39) | [infra-isolated-process-scripts](infra-isolated-process-scripts.log.txt)   |
| `sqlite-storage`   | PASS     | 42 passed (42)            | [infra-isolated-sqlite-storage](infra-isolated-sqlite-storage.log.txt)     |
| `sqlite-upgrade`   | FAIL (1) | 9 failed ; 17 passed (26) | [infra-isolated-sqlite-upgrade](infra-isolated-sqlite-upgrade.log.txt)     |

<!-- /ISOLATES -->

## 6. Docs

Updated numbered docs 05 and 07, ADR-0049 and the existing CHANGELOG #224 bullet.
No HTTP route/schema changed, so no reference regeneration is needed. Historical manifests
remain untouched for the orchestrator's committed-byte normalization.

## 7. Decisions and parameters

The existing container still owns shutdown state. RunManager owns command/admission leases
and the final readiness seal. A lease is acquired before the first asynchronous port call;
its generation and outstanding count are checked with executors, family queue and due wakes
before sealing without another await. Recovery/delivery waits are inside the recheck loop.
Late wakes refuse before writes; future timers remain durable. D-038 is unchanged.

`withAdmission(async scope => ...)` reserves an independent intake before any receipt, dedupe
or allocated Event work. Its scoped `startRun` may finish after drain closes new intake; the
resulting independent run stays queued for restart. The callback awaits all durable writes
and linkage updates; the scope expires on return. Manual, webhook, cron, poll and replay
manager entry points use the same lease accounting. Force waits for earlier command leases
before its final family-queue pass. No new timeout or numeric engineering parameter is added.

#343 must wrap its targeted intake transaction in `manager.withAdmission`, before allocating
or storing the inbound row, receipt, target, frozen intent and run identity; await all transaction
and admission/linkage writes inside the callback. Use the callback's scoped `startRun` when
calling that manager method, rather than reacquiring independent admission after the transaction.
If #343 commits frozen durable work itself, keep that transaction inside the same scope.
Do not swallow `SHUTTING_DOWN` as successful ingestion. In the current Event service retain
the `withAdmission` dependency at 51, scope opened before allocation at 521-522,
`admission.startRun` at 555, refusal propagation at 568, and linkage within the callback
at 572-574. For #343 these positions move, but the targeted transaction must obey the same
scope lifetime. The manager's public scope is at 546-565 and its shared lease accounting at
568-585; do not replace that reservation with a momentary preflight assertion.

## 8. Caveats and open items

The orchestrator commits, recomputes the older manifests and runs final audit round 3 of 3.
P3-2/P3-3 remain set aside under D-035. Windows native tree termination remains constrained by
D-015; Linux-only successful signal/tree/harness cases cannot be claimed from this host.
Earlier P3 manifest discrepancies and independent QA are left untouched. No live provider turn.
The infrastructure gate remains failed, including unresolved upgrade-test timeouts in a held
implementation outside this bolt; orchestration must retain and classify these results.
Native cleanup failures also left some disposable directories; [cleanup candidates](CLEANUP-CANDIDATES.json)
records only the exact EBUSY paths printed by these runs. Inspect their owned test processes
before removal outside the D-015 sandbox. No manual cleanup or broad process termination was attempted.

Existing ADR residuals remain: Windows Codex descendants (N10) and the prior cron slot race
(N11). #319 builds on the existing shutdown state/control API; this round adds no UI.

Scratch files are intentionally left under ignored `.tmp/` for orchestrator removal after
the verification processes finish; they are not evidence. Driver source copies are kept
here under `.mjs.txt`. No manual directory cleanup was performed:

- `.tmp/r3-run.py`
- `.tmp/r3-report.py`
- `.tmp/r3-finish.py`
- `.tmp/wake-during-cleanup-r3.mjs`
- `.tmp/event-admission-race-r3.mjs`
- `.tmp/wake-during-cleanup-verify-r3.mjs`
- `.tmp/event-admission-race-verify-r3.mjs`
