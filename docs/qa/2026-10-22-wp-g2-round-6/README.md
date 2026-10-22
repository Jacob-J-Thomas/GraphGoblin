# WP-G2 round 6: unreadable latest-run threads (#236)

## 1. Branch and worktree

Branch: `codex-wp-g2-paging-summaries`. Worktree: `.claude/worktrees/codex-wp-g2-paging-summaries`.
Base and unchanged HEAD: `1ab402b851223d19c92f6077965a5634460cb0ae`, a descendant of `de285942`.
The working-tree diff is the implementation under test; the orchestrator handles commits and review.
Runtime: Node `v22.14.0`, Windows PowerShell, `pnpm.cmd`.

## 2. Per bolt

**#236 / D-029: reproduced on the base before the production change.** The original
`thread-summary.mjs` audit was run against the built API, file-backed SQLite and Edge,
using a fresh disposable store. For each thread column the terminal event was
`{"status":"succeeded","outcome":"success"}`, but the stored row remained
`{"status":"running","bad":"{}","finalized_at":null}` after restart. `/loops`
returned a `running` latest summary, its exact count was two, diagnostics identified
the newest run as `HISTORY_UNREADABLE`, and Edge showed the `running` badge.
Both recorded `pass` values were false. See [auditor-before.json](auditor-before.json)
and [audit-before.log.txt](audit-before.log.txt).

The checked-in [thread-regression.mjs](thread-regression.mjs) independently covers
`pinned`, `initial_thread` and `thread_snapshot`. A SQLite trigger preserves a durable
`run.finished` while refusing its terminal status update and damaging the selected
column. Each case then closes and restarts the real built API against the same store,
checks public HTTP responses, opens the actual Loops page in Edge, and records a capture.
Its raw-row assertion requires the stale `running` status to survive the restart;
accidentally testing a repaired healthy row cannot pass this regression.

| Fault                    | Durable event / stored status | Before: API / Edge                  | After: API / Edge  | Count |
| ------------------------ | ----------------------------- | ----------------------------------- | ------------------ | ----- |
| `pinned = '{broken'`     | succeeded / running           | null / unavailable (control passes) | null / unavailable | 2     |
| `initial_thread = '{}'`  | succeeded / running           | running / running (fails)           | null / unavailable | 2     |
| `thread_snapshot = '{}'` | succeeded / running           | running / running (fails)           | null / unavailable | 2     |

The native replay's before-fix exit was 1, with these quoted failures:

> initial_thread: expected latestRun null; received
>
> initial_thread: Edge must show unavailable with diagnostics, never running, succeeded or never run
>
> thread_snapshot: expected latestRun null; received
>
> thread_snapshot: Edge must show unavailable with diagnostics, never running, succeeded or never run

The full received objects and IDs are preserved in [native-before.json](native-before.json).
The after-fix replay exited 0, all three cases passed, no older run replaced the selected
one, and Edge showed both `latest run unavailable` and `Check run history diagnostics.`
See [native-after.json](native-after.json), [native-after.log.txt](native-after.log.txt),
[before capture](before-thread_snapshot.png) and [after capture](after-thread_snapshot.png).

Healthy neighbouring loops, exact counts, an unreadable older row, a genuine no-history
loop, and a legitimately absent cached snapshot are covered by the repository/API/web tests.
The selected latest row is the only row decoded. **#231 is unchanged in this round.**

To replay independently from the worktree root (no provider calls):

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
pnpm.cmd build
$proofRoot = Join-Path $env:TEMP ("gg-wp-g2-round6-owner-" + [guid]::NewGuid())
node docs/qa/2026-10-22-wp-g2-round-6/thread-regression.mjs $proofRoot
```

This binds only `127.0.0.1:5620`, uses `$proofRoot/store` as `GG_DATA_DIR`, and serves
the built web app through `GG_WEB_DIST`. The script launches and closes its own API
and headless installed Edge. `GG_MASTER_KEY` is not required: the disposable instance
generates its own key. Trusted loopback mode is set only in the spawned process.
`results.json`, `native-api.log.txt` and three PNGs remain under `$proofRoot`.
Do not point the script at an existing owner store.

## 3. Files changed

Shared-file ranges refer to the new working-tree lines; the edits are limited to the
latest-summary path and its tests/documentation.

| Package / file                                         | Lines                        | Change                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure: `src/sqlite/loops.ts`                  | 12, 157–161, 184–188         | Import the existing thread decoder, select raw thread text for the one latest row, and validate both thread columns before returning its badge summary. Shared with history/pin work; other repository methods are unchanged. |
| Infrastructure: `src/sqlite/history-summaries.test.ts` | 13, 92–101, 112–114, 142–152 | Durable success beside stale status and damaged threads; malformed cached JSON; corrupt older-row and absent-cache controls.                                                                                                  |
| API: `src/routes/loop-summaries.test.ts`               | 25–27, 46–54                 | Public-route assertions for both damaged threads and malformed cached JSON, with a durable terminal event and stale status.                                                                                                   |
| Web: `src/loops/LoopsPage.test.tsx`                    | 64–96                        | Check unavailable versus never-run states for pin and both thread variants with count two.                                                                                                                                    |
| Shared numbered docs: `docs/07-api-and-streaming.md`   | 467–476                      | Define readable latest rows, strict thread validation and valid SQL NULL cache absence.                                                                                                                                       |
| Shared numbered docs: `docs/09-frontend-and-pwa.md`    | 637–642                      | Describe the corresponding unavailable state.                                                                                                                                                                                 |
| Shared `CHANGELOG.md`                                  | 7–8                          | Add the thread-damage unavailable-state bullet ending in `(#236)`.                                                                                                                                                            |
| This QA directory                                      | new                          | Executable restart/Edge replay, structured results, captures and sanitized `.log.txt` evidence.                                                                                                                               |

`run-decoding.ts`, run readers, recovery, API schemas, generated clients, migrations,
and the production Loops component are unchanged. The existing component already
renders a null summary correctly. The orchestrator-owned `2026-10-22-wp-g2-qa` folder
is untouched.

## 4. Tests

Before the production fix, the expanded repository file had **3 failures / 11 passes**:

> to match object { runCount: 2, latestRun: null }

The received latest object had `"status": "running"`. The cases were invalid
`initial_thread`, invalid `thread_snapshot`, and malformed `thread_snapshot` JSON.
After the fix: **14/14 passed**. See [infra-before.log.txt](infra-before.log.txt)
and [infra-after.log.txt](infra-after.log.txt).

Before the fix, the public API regression file had **3 failures / 6 passes**:

> to match object { runCount: 1, latestRun: null }

Again the received latest object was `running`. After: **9/9 passed**, with the
unreadable run identified by diagnostics and the healthy neighbour still available.
See [api-before.log.txt](api-before.log.txt) and [api-after.log.txt](api-after.log.txt).

The expanded controlled LoopsPage file passed **20/20** after the fix. These component
tests supply the existing null-summary contract; the failure-before evidence for the
actual page comes from the native Edge replay, not from claiming the component failed
to render an already-null summary. See [web-after.log.txt](web-after.log.txt).

| Package        | Total | Passed | Failed | Skipped | Lines  | Branches | Full gate |
| -------------- | ----- | ------ | ------ | ------- | ------ | -------- | --------- |
| Infrastructure | 639   | 630    | 9      | 0       | 98.42% | 94.53%   | FAIL      |
| API            | 737   | 730    | 1      | 6       | 97.95% | 93.06%   | FAIL      |
| Web            | 1,488 | 1,488  | 0      | 0       | 98.93% | 94.87%   | PASS      |

The changed `loops.ts` has 100% line and 92.59% branch coverage. All 14 repository,
9 API and 20 LoopsPage tests passed inside these full runs as well as in the focused runs.
No coverage threshold failed; infrastructure and API failed because tests failed.
See [infrastructure coverage](coverage-infrastructure.log.txt),
[API coverage](coverage-api.log.txt), [web coverage](coverage-web.log.txt), and
[structured verification](verification.json).

All ten failures were run individually with the original timeout, one worker, and no retries.
The JSON reporter verified exactly one executed test in each command (other tests in its file were filtered out).
The command shape was:

```text
pnpm.cmd --filter <package> exec vitest run <file> --maxWorkers=1 -t <escaped title> --reporter=default --reporter=json --outputFile.json=<worktree>/round6-isolate-NN-results.log
```

| Case       | Test                                                                                                                                                          | Full-run failure                                                                                                                         | Isolated result             | Classification           | Evidence                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------ | ------------------------- |
| isolate-01 | `@graphgoblin/infrastructure / src/adversarial.test.ts`: 6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild                           | `Error: Test timed out in 30000ms.`                                                                                                      | FAIL (30.152 s), selected 1 | D-015 native termination | [log](isolate-01.log.txt) |
| isolate-02 | `@graphgoblin/infrastructure / src/claude/process.test.ts`: kills on deadline and output overflow                                                             | `Error: EBUSY: resource busy or locked, rmdir '<temp>\gg-claude-process-7vhZiZ'`                                                         | FAIL (16.033 s), selected 1 | D-015 native termination | [log](isolate-02.log.txt) |
| isolate-03 | `@graphgoblin/infrastructure / src/claude/process.test.ts`: does not spawn for an already aborted signal and cancels a running process                        | `Error: EBUSY: resource busy or locked, rmdir '<temp>\gg-claude-process-LwKPiD'`                                                         | FAIL (5.112 s), selected 1  | D-015 native termination | [log](isolate-03.log.txt) |
| isolate-04 | `@graphgoblin/infrastructure / src/claude/process.test.ts`: kills the descendant that a long-lived child started                                              | `AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' // Object.is equality` | FAIL (6.471 s), selected 1  | D-015 native termination | [log](isolate-04.log.txt) |
| isolate-05 | `@graphgoblin/infrastructure / src/process/scripts.test.ts`: kills and closes a real process cancelled with incomplete UTF-8 pending on both streams          | `AssertionError: native process-tree cancellation must finish before fixture cleanup: expected true to be false // Object.is equality`   | FAIL (8.040 s), selected 1  | D-015 native termination | [log](isolate-05.log.txt) |
| isolate-06 | `@graphgoblin/infrastructure / src/process/scripts.test.ts`: kills the process tree on timeout                                                                | `Error: Test timed out in 15000ms.`                                                                                                      | FAIL (15.023 s), selected 1 | D-015 native termination | [log](isolate-06.log.txt) |
| isolate-07 | `@graphgoblin/infrastructure / src/process/scripts.test.ts`: kills the process when the signal aborts, including when already aborted                         | `Error: Test timed out in 15000ms.`                                                                                                      | FAIL (15.026 s), selected 1 | D-015 native termination | [log](isolate-07.log.txt) |
| isolate-08 | `@graphgoblin/infrastructure / src/sqlite/upgrade.test.ts`: refuses changed source, damaged SQL/ledger, malformed template identities and invalid definitions | `Error: Test timed out in 20000ms.`                                                                                                      | FAIL (20.032 s), selected 1 | non-D-015                | [log](isolate-08.log.txt) |
| isolate-09 | `@graphgoblin/infrastructure / src/sqlite/upgrade.test.ts`: rolls back deletions, DDL, ledger, rewrites and marker on a failure after structural SQL          | `Error: Test timed out in 20000ms.`                                                                                                      | PASS (19.332 s), selected 1 | non-D-015                | [log](isolate-09.log.txt) |
| isolate-10 | `@graphgoblin/api / src/adversarial.test.ts`: ADV-008: every advertised route against every scope                                                             | `Error: Test timed out in 20000ms.`                                                                                                      | PASS (4.301 s), selected 1  | non-D-015                | [log](isolate-10.log.txt) |

The seven native failures are **D-015**. In particular:

> native process-tree cancellation must finish before fixture cleanup: expected true to be false

A fresh probe targeted only a child created by this worker; `taskkill /T /F` returned exit 1 with
`ERROR: Access denied`. Direct child cleanup then completed. See [native-termination-probe.log.txt](native-termination-probe.log.txt).
The upgrade and scope-matrix timeouts are **not D-015**. One upgrade timeout persists in isolation;
the rollback and API scope cases pass alone. Every failed full-run gate remains a failure.

## 5. Gates

All commands run from the worktree root with Node 22 first on PATH. Coverage is run
directly per package, rather than accepting Turbo's cached dependency results.

| Command                                                                                                                                                                          | Result                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                                             | PASS: 20/20 tasks                                                                                     |
| `pnpm.cmd lint`                                                                                                                                                                  | PASS: 11/11 tasks; Turbo also logged cache I/O warnings                                               |
| `pnpm.cmd build`                                                                                                                                                                 | PASS before reproduction and after the fix: 11/11 tasks                                               |
| `pnpm.cmd format --ignore-path .round6-format.ignore.log`                                                                                                                        | PASS; scope excludes the protected QA record                                                          |
| `pnpm.cmd format:check --ignore-path .round6-format.ignore.log`                                                                                                                  | PASS                                                                                                  |
| `pnpm.cmd check:layers`                                                                                                                                                          | PASS                                                                                                  |
| `pnpm.cmd check:deps`                                                                                                                                                            | PASS                                                                                                  |
| `pnpm.cmd check:migrations`                                                                                                                                                      | PASS, no migration changes                                                                            |
| `pnpm.cmd check:docs`                                                                                                                                                            | PASS                                                                                                  |
| `pnpm.cmd check:tokens`                                                                                                                                                          | PASS                                                                                                  |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage` with the flags below                                                                                               | FAIL: nine tests, despite coverage exceeding thresholds                                               |
| `pnpm.cmd --filter @graphgoblin/api test:coverage` with the flags below                                                                                                          | FAIL: one 20-second scope-matrix timeout; build completed first                                       |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1` with the reporting flags below                                                                                 | PASS: 1,488/1,488 tests                                                                               |
| `GG_E2E_BROWSER_CHANNEL=msedge`, then `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/history.spec.ts --retries=0 --output <temp>/gg-wp-g2-round6-history-<unique>` | PASS: Runs, Events and Loops, 3/3 (24.7 s)                                                            |
| `node <temp>/gg-audit-g2-20261022-round2/thread-summary.mjs <fresh gg-wp-g2 store>` after coverage                                                                               | FAIL: both cases recorded true, then process exit `-1073741819` (`0xC0000005`); no final results file |
| Same original auditor command, run alone once for diagnosis; explicit JSON postconditions                                                                                        | PASS: process 0, checks 0, 2/2; preceding failure remains recorded                                    |
| `node docs/qa/2026-10-22-wp-g2-round-6/thread-regression.mjs <fresh gg-wp-g2 store>` after coverage                                                                              | PASS: 3/3, process 0                                                                                  |

Each full coverage command also used `--maxWorkers=1 --coverage.reportOnFailure
--reporter=default --reporter=json --outputFile.json=<worktree>/round6-coverage-<package>-results.log`.
The web command explicitly includes the requested `--maxWorkers=1`. No timeout,
coverage threshold, test exclusion or retry count was changed. Isolated reruns are
diagnostics and do not turn a failed full gate green.

Formatting uses a root-local ignore file limited to this patch, with an explicit
exclusion for the orchestrator-owned QA folder. Its contents are recorded in
[format-scope.log.txt](format-scope.log.txt). This is a scoped formatting result,
not a claim that protected artifacts were rewritten or checked. Gate logs are
retained here as `.log.txt` files; local user paths are redacted.

The auditor's script exits zero even when a recorded `pass` is false. Its results
therefore need an explicit assertion check. An initial after-run checker failed
before assertions because PowerShell stripped quotes passed to `node -e`; the
corrected stdin checker read the same existing JSON, with no application rerun,
and confirmed both cases true. Both outputs are retained in
[audit-check-after.log.txt](audit-check-after.log.txt) and
[audit-check-corrected.log.txt](audit-check-corrected.log.txt). This tooling failure
is separate from the application and from D-015.

## 6. Docs

Docs 07 and 09 now name the record (including its pin), initial thread and any present
cached thread snapshot. They distinguish damaged stored data from an absent cache,
retain the exact count and explain why an older run is never substituted. The new
Unreleased CHANGELOG bullet ends in `(#236)`. No API schema or stored format changed,
so generated references, client generation, an upgrade migration and an ADR are not required.

## 7. Decisions and parameters

The latest-row query keeps the existing owner scope, timestamp/ID ordering, correlated
single-row selection and indexed exact count. It adds two raw text columns so Drizzle
cannot parse them before the per-row error boundary. `decodeRunRecord` and the existing
`decodeStoredThread` enforce the same row/thread schemas as the run readers and recovery.
Only `UnreadableRunHistoryError` becomes a null summary; unexpected failures still surface.
No new decoder, tolerant schema, older-row fallback, event replay or N+1 query was added.

The comment explains the correctness boundary: recovery checks threads before repairing
a stale status, so the badge must check those threads too. SQL NULL cache absence remains
valid, matching the existing reader's reconstruction path. These are engineering choices.
There are no new production timing parameters. The replay polls its disposable instance
at 50 ms with a 60-second deadline per observable state; Edge assertions use the served UI.

## 8. Caveats and open items

Infrastructure and API coverage gates remain failed. Seven failures belong to the reproduced
D-015 sandbox native-termination class. The remaining failures are separate 20-second timeouts:

- `packages/infrastructure/src/sqlite/upgrade.test.ts:302`: source-damage/ledger/template/definition refusals; still fails alone at 20 seconds. **Unresolved, outside the latest-summary path.** Its imports and execution use upgrade/database functions, not the loop summary reader.
- `packages/infrastructure/src/sqlite/upgrade.test.ts:323`: rollback after structural SQL; passes alone, but the full-run failure remains recorded.
- `apps/api/src/adversarial.test.ts:178`: all advertised routes against every scope; passes alone, but the full-run failure remains recorded. This fixture creates API keys and requests unknown resource IDs; it has no latest run to decode.

The persistent upgrade timeout needs separate investigation. Full infrastructure/API gates need
a successful run in a suitable runner; neither the coverage percentages nor isolated passes establish that result.
No timeout was enlarged and no unrelated implementation or test was changed to conceal these failures.

Record-only `GET /runs/{id}` still returns 200 for thread-only damage: the record itself
is valid. The cached-thread route returns `STORED_RUN_INVALID` for a damaged cache;
an initial-thread fault can coexist with a healthy readable cache. The evidence records
these responses rather than claiming every inspector request returns 500. Diagnostics
and recovery identify both thread faults; this change aligns the loop summary with them.

The final post-coverage invocation of the **original auditor script failed** with Windows
access violation `0xC0000005` after emitting two passing functional records. Its API had
stopped and port 5620 was released, but teardown did not reach the final `results.json`
write. The follow-up file-based checker therefore failed with `ENOENT`. This is a separate,
**unresolved native crash, not D-015**; the responsible native component is not established.
See [auditor-final-records.json](auditor-final-records.json), [audit-final.log.txt](audit-final.log.txt),
[audit-final-check.log.txt](audit-final-check.log.txt) and [port/record check](audit-crash-record-check.log.txt).
An initial cleanup diagnostic assumed the API was still listening; it received `ECONNREFUSED`
and did not signal a process. The corrected record/port check confirmed both assertions and
that the API was already stopped. Both diagnostic outputs are retained.

One isolated original replay then exited 0 and wrote both passing results; the explicit checker
also exited 0. This diagnostic pass does not erase the failed invocation or establish a reliable
green gate. See [auditor-isolated.json](auditor-isolated.json) and [audit-isolated-check.log.txt](audit-isolated-check.log.txt).
The checked-in three-case replay also passed again **after** coverage, with all pin/thread
postconditions and actual Edge rows correct: [native-final.json](native-final.json),
[native-final.log.txt](native-final.log.txt), [final capture](final-thread_snapshot.png).
The independent acceptance audit remains to be resumed by the orchestrator.

The orchestrator commits, obtains Fable review and resumes the independent audit.
Owner acceptance and issue closure are not granted by this worker report. Disposable
stores, ignored coverage output and test-created fixtures are retained; no manual
directory cleanup was performed. No owner app/store access, branch/index mutation, GitHub mutation,
live provider turn or environment installation was part of this round.
