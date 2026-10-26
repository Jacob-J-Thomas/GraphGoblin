# WP-G2 round 5: unreadable latest runs (#236, D-029)

## 1. Branch and worktree

Branch `codex-wp-g2-paging-summaries`, worktree
`.claude/worktrees/codex-wp-g2-paging-summaries`, base
`851524d37dca3bb3968edb9e09ee6f6df275bfe4`. Working-tree patch; no commit.
Node 22.14.0, Windows PowerShell and `pnpm.cmd` throughout.

## 2. Per bolt

**#236 — confirmed and corrected.** The final audit's storage fault reproduced on
the base above before any corrective change, using the built API, public HTTP,
file-backed SQLite, a real process restart and Microsoft Edge. The auditor's
`status-probe.mjs` and `status-browser.mjs` both reproduced the wrong badge.

The fault prevents only the succeeded snapshot write and damages its pins:

```sql
CREATE TRIGGER audit_lost_terminal_status
BEFORE UPDATE OF status ON runs WHEN NEW.status = 'succeeded'
BEGIN
  UPDATE runs SET pinned = '{broken' WHERE id = NEW.id;
  SELECT RAISE(IGNORE);
END;
```

The trigger was dropped after the durable terminal event, then the owned API was
stopped and restarted against the same disposable store. Quoted reproduction:

```text
stored: {"status":"running","pinned":"{broken"}
terminal: {"status":"succeeded","outcome":"success"}
GET /loops: latestRun.status = "running", runCount = 2
GET /runs/{latestId}: 500 STORED_RUN_INVALID
Edge Last run: running
```

The older run is healthy. After the fix the identical fault yields
`latestRun: null`, `runCount: 2`, the same typed inspector error, a diagnostics
entry naming the latest run, and Edge's "latest run unavailable" plus "Check run
history diagnostics." Neither the stale badge nor the older run is substituted.
[Before JSON](before.json), [after JSON](after.json), [before Edge](before.png),
[after Edge](after.png) retain the observations. This is deliberate storage-fault
injection, not evidence of spontaneous pin corruption.

The existing >500 unrelated-history, tied-order and no-history controls pass in
the repository and API summary files. Healthy loops remain readable beside a
damaged latest row; exact counts include damaged rows.

**#231 — unchanged.** Agree with the orchestrator's cursor disposition. Cursors
encode a position, and consumers preserve active filters. Changing filters can
return 200 from the same position; no filter authentication or binding is claimed.
The contract prose in docs/07, the guide and CHANGELOG is consistent with this.
The restored `2026-10-22-wp-g2-qa/` evidence folder is unchanged.

## 3. Files changed

- Infrastructure `src/sqlite/loops.ts`: select the latest full raw run and decode it with `decodeRunRecord` before projecting summary fields; isolate only `UnreadableRunHistoryError`.
- Infrastructure `src/sqlite/history-summaries.test.ts`: damaged summary/non-summary fields, preserved exact count, healthy neighbour and no older-run substitution.
- API `src/routes/loop-summaries.test.ts`: real SQLite corruption cases through `GET /loops` and diagnostics.
- Web `src/loops/LoopsPage.tsx`: visible diagnostics guidance beside the unavailable state.
- Web `src/loops/LoopsPage.test.tsx`: verifies that guidance and absence of a running link.
- `docs/07-api-and-streaming.md`: full selected-row decoding, restart truthfulness, exact count and no fallback.
- `docs/09-frontend-and-pwa.md`: the actual unavailable copy and diagnostic procedure.
- `CHANGELOG.md`: an Unreleased unavailable-state bullet ending `(#236)`.
- This evidence directory: executable native/Edge regression, before/after JSON and screenshots, focused test outputs, `verification.json` with full-suite totals/coverage and every isolated result, `taskkill.json`, and this report.

The `loops.ts` edit overlaps WP-C1's historical ownership, only within
`listWithRunSummaries` and its imports. No change to `run-decoding.ts`, engine
execution, run/event paging, route schemas, migrations or dependencies. The docs/09
edit is confined to the loop-summary section, outside the other packages' inspector
regions. Guide 03 does not describe this badge, so it needs no change.

## 4. Tests

Before/after focused test output is retained in [before.txt](before.txt) and
[focused.txt](focused.txt).

| Test file / regression                                                                                      | Before fix                                                      | After fix                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Infrastructure `history-summaries.test.ts`: `isolates damaged latest %s without substituting an older run`  | Seven new non-summary cases fail; invalid-status control passes | 11/11 file tests pass                                                                                        |
| API `routes/loop-summaries.test.ts`: `isolates damaged latest-run %s and identifies it through diagnostics` | Four new non-summary cases fail; invalid-status control passes  | 6/6 file tests pass                                                                                          |
| Web `LoopsPage.test.tsx`: `distinguishes an unavailable latest summary from a loop with no history`         | New diagnostics-copy assertion fails                            | 18/18 file tests pass                                                                                        |
| `status-regression.mjs`: built API restart and Edge                                                         | Fails on the stale running summary                              | Passes: null summary, count 2, typed inspector error, diagnostics, unavailable copy and no older/stale badge |

Quoted pre-fix assertions:

```text
AssertionError: expected { …(8) } to match object { runCount: 2, latestRun: null }
AssertionError: expected { …(8) } to match object { runCount: 1, latestRun: null }
TestingLibraryElementError: Unable to find an element with the text: Check run history diagnostics.
AssertionError [ERR_ASSERTION]: unreadable latest snapshot must be unavailable, never a stale badge or older run
+ actual: { status: 'running', ... }
- expected: null
```

The terminal payload is read directly from SQLite: the run-event HTTP route
requires a readable snapshot and correctly returns `STORED_RUN_INVALID` after this
fault. Summary, inspector and diagnostics observations use public HTTP.

| Package        | Full suite                                        | Lines              | Branches           | Functions | Statements |
| -------------- | ------------------------------------------------- | ------------------ | ------------------ | --------- | ---------- |
| Infrastructure | 629 passed, 7 failed, 636 total                   | 98.62% (2007/2035) | 94.71% (1559/1646) | 98.25%    | 97.83%     |
| API            | 726 passed, 1 failed, 6 existing skips, 733 total | 97.84% (1771/1810) | 92.91% (1259/1355) | 94.07%    | 96.39%     |
| Web            | 1483 passed, 0 failed, 1483 total                 | 98.93% (6989/7064) | 94.87% (7163/7550) | 98.50%    | 98.03%     |

The seven infrastructure failures are D-015 native process-tree termination cases,
not summary failures. A fresh owned-process probe returned exit 1 and the exact
stderr `ERROR: Access denied` for `taskkill /PID <ownedPid> /T /F`; direct child
cleanup succeeded. [taskkill.json](taskkill.json) retains that result.

| Failing test                                                                                                         | Quoted assertion/error                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `adversarial.test.ts`: `6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild`                  | `Test timed out in 30000ms.`                                                                                                |
| `claude/process.test.ts`: `kills on deadline and output overflow`                                                    | `EBUSY: resource busy or locked, rmdir '<temp>/gg-claude-process-*'`                                                        |
| `claude/process.test.ts`: `does not spawn for an already aborted signal and cancels a running process`               | `EBUSY: resource busy or locked, rmdir '<temp>/gg-claude-process-*'`                                                        |
| `claude/process.test.ts`: `kills the descendant that a long-lived child started`                                     | `expect(await readFile(marker, 'utf8')).toBe(stopped)` fails because the marker keeps growing; cleanup also reports `EBUSY` |
| `process/scripts.test.ts`: `kills and closes a real process cancelled with incomplete UTF-8 pending on both streams` | `native process-tree cancellation must finish before fixture cleanup: expected true to be false`                            |
| `process/scripts.test.ts`: `kills the process tree on timeout`                                                       | `Test timed out in 15000ms.`                                                                                                |
| `process/scripts.test.ts`: `kills the process when the signal aborts, including when already aborted`                | `Test timed out in 15000ms.`                                                                                                |

The API failure is separate: `templates/catalog-package.test.ts:49`,
`ships only declared starting-point assets and removes stale files on rebuild`,
reported `Test timed out in 20000ms.` Its body copies and verifies template assets;
it does not call the loop-summary query. It is not classified D-015. It passes
alone in 1.244 seconds, with its assertions and timeout unchanged. The full-suite
failure remains; the timing cause is not established.

All eight failures were run individually after the full suites, selecting exactly
one test per command. All seven D-015 tests still fail alone; the asset-copy test
passes. [verification.json](verification.json) records every selection and result.
Each command was `pnpm.cmd --filter @graphgoblin/<package> exec vitest run <file>
--maxWorkers=1 -t <escaped-test-title> --reporter=default --reporter=json
--outputFile.json=<local-result-file>`; no test deadline, assertion or source was
changed. These isolated results do not replace either failed full-suite gate.

## 5. Gates

All commands run from the worktree root with Node 22 first on PATH. Full coverage
runs use `--maxWorkers=1 --coverage.reportOnFailure --reporter=default --reporter=json`
and a JSON output file. Focused tests use `pnpm.cmd --filter @graphgoblin/<package>
exec vitest run <file> --maxWorkers=1`; the pre-fix web check additionally selects
`-t 'distinguishes an unavailable'`.

| Command                                                                                                                                                                      | Result                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                                         | PASS, 20/20 tasks                                                                                                      |
| `pnpm.cmd lint`                                                                                                                                                              | PASS, 11/11 tasks                                                                                                      |
| `pnpm.cmd format:check`                                                                                                                                                      | PASS on the final full check; the initial new-script formatting failure was corrected                                  |
| `pnpm.cmd check:layers`                                                                                                                                                      | PASS                                                                                                                   |
| `pnpm.cmd check:deps`                                                                                                                                                        | PASS, 0 errors; existing no-orphans warnings for infrastructure's Drizzle config and an ignored browser trace resource |
| `pnpm.cmd check:migrations`                                                                                                                                                  | PASS, generation is a no-op                                                                                            |
| `pnpm.cmd check:tokens`                                                                                                                                                      | PASS, 162 files                                                                                                        |
| `pnpm.cmd check:docs`                                                                                                                                                        | PASS                                                                                                                   |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage` with the flags above                                                                                           | FAIL, seven D-015 cases; all coverage thresholds pass                                                                  |
| `pnpm.cmd --filter @graphgoblin/api test:coverage` with the flags above                                                                                                      | FAIL, template asset rebuild timeout; all coverage thresholds pass                                                     |
| `pnpm.cmd --filter @graphgoblin/web test:coverage` with the flags above                                                                                                      | PASS, 1483/1483; all coverage thresholds pass                                                                          |
| `pnpm.cmd build`                                                                                                                                                             | PASS before baseline reproduction and after the fix, 11/11 tasks each                                                  |
| Auditor `status-probe.mjs` with the single corrected postcondition below                                                                                                     | PASS against the rebuilt fix                                                                                           |
| `node docs/qa/2026-10-22-wp-g2-latest-summary/status-regression.mjs <fresh-temp-root>`                                                                                       | PASS, native restart and Microsoft Edge                                                                                |
| `GG_E2E_BROWSER_CHANNEL=msedge`, `LIVE=0`; `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/history.spec.ts --retries=0 --output <temp>/gg-wp-g2-round5-history` | PASS, 3/3 on Edge, zero retries; Runs, Events and Loops                                                                |
| `git diff --check`                                                                                                                                                           | PASS for this working-tree patch                                                                                       |

Root gates can print a Turbo cache-write `IO error: Access is denied` warning;
the passing task/exit results above are recorded separately. The native regression
uses manual API port 5620; standard automated fixtures retain their existing free
port allocation. No dependency change was made, so `check:licenses` is not required.

The built audit probe was rerun with only its final defect-presence assertion
changed from `summary.latestRun.status === 'running'` to `summary.latestRun === null`.
It passes. Its original postcondition deliberately asserts the bug, so retaining
that postcondition would not be a valid fixed-build expectation.

The in-repository replay is independently executable after `pnpm.cmd build`:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
node docs/qa/2026-10-22-wp-g2-latest-summary/status-regression.mjs
```

It chooses a fresh `%TEMP%/gg-wp-g2-summary-*` store, uses only port 5620, unsets
inherited application configuration through an environment allowlist, and starts
the built API with the built web distribution and authentication disabled on
loopback. `GG_MASTER_KEY` is not required; the disposable instance creates its own.
It creates a healthy older run and an unreadable latest run in one loop through
the public API, injects the SQLite trigger, observes the durable terminal event,
restarts, checks HTTP and Edge, saves proof and closes its owned browser/API.
It retains the store for inspection and never deletes directories. An optional
argument specifies a fresh `gg-wp-g2-*` directory under `%TEMP%`.

## 6. Docs

docs/07 and docs/09 now describe strict full-record validation of the selected
latest run, count preservation, no fallback, and the visible diagnostics guidance.
The new CHANGELOG bullet describes the unavailable state and ends `(#236)`.
No route schema changed, so no regeneration or client generation is needed.
`check:docs` was nevertheless run. No architecture decision changed and no ADR
was added. The old partial-decode justification is superseded by D-029's reproduced
counterexample and this strict-decoder fix.

## 7. Decisions and parameters

Keep the existing one-statement owner-scoped latest/count query, deterministic
`created_at DESC, id DESC` order, and owner-history index. Select raw run columns
to avoid eager JSON decoding outside per-run isolation. Decode exactly the latest
row with the existing authoritative decoder, then project `id/status/createdAt`.
Catch only the typed unreadable-history error: unrelated database/programming
failures still propagate. No older-run scan, event replay or inferred terminal
status is introduced in the summary path. These are engineering choices.

The replay's 60-second readiness/state budget and 50-ms polling match existing
native test practice; they bound failure detection rather than asserting latency.
Fault injection uses a supported external storage boundary and public HTTP, never
private-member access or monkey-patching. No timeout, threshold or exclusion was
relaxed.

## 8. Caveats and open items

The controlled local/API/Edge evidence does not establish live-provider behaviour
or owner product acceptance. Both bolts retain their acceptance/closure obligations;
this worker grants no merge approval. No commit, staging, push or GitHub mutation.
The owner's listeners/store and the restored QA folder were not changed. Disposable
stores and standard test reports remain for orchestrator cleanup, without manual
directory deletion.

The infrastructure full-suite gate remains red for the seven confirmed D-015
cases; a runner with working Windows process-tree termination is needed for that
native gate. The API full-suite gate remains red for the template-copy timeout,
despite its isolated pass; exact-head quiet-runner verification is still needed.
These are outside this bounded summary-path fix. No failing summary or paging
case remains in the runs performed here. Both failed full-suite gates remain
explicit rather than being replaced by isolated successes.
