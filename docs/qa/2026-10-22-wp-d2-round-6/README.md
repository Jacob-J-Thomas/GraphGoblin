# WP-D2 round 6: frozen historical webhook receipts (#246)

## 1. Branch and worktree

Branch `codex-wp-d2-webhook-retry`, worktree
`%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-d2-webhook-retry`.
Base HEAD: `62c7bba188f1fc819ab51aceeec588861adad476`, checked before any other command.
Uncommitted; ready for orchestrator commit after the recorded verification and review.

## 2. Per bolt

#246, round-2 audit finding 4: reproduced before implementation using the auditor's
[driver](migration-boundaries.mjs) and [checker](migration-boundaries-check.mjs) on the built API,
port 5644, independently copied pre-0015 store and archived base-build schema.
[Before](before-migration-boundaries-check.json): **16/20 passed, four failed**:
NUL target overflow, NUL secret overflow, NUL error overflow and invalid URL.
Each failed with **"An invalid historical receipt must remain byte-identical"**;
the final assertion was **"Historical receipt conversion must preserve every invalid row: 4 !== 0"**.
The target was erased into readable successful history; the other three converted events
failed the current contract and REST event reads returned 500. Valid controls returned 200.

Conversion now validates the archived receipt/channel contract in code, before the migration's
pending-return allocation. Invalid receipts are never updated. Every converted snapshot validates
against the current contract. The migration SQL no longer rewrites receipts. A single write
transaction includes conversion, pending allocations, index and ledger; rollback and a second
migration call are tested through `DatabaseHandle.migrate()`.

The [final replay](final-migration-boundaries-check.json), after rebuilding the final source,
passes **20/20**: all eleven valid controls convert and all nine invalid controls remain
byte-identical. The [raw evidence](final-migration-boundaries.json) records each original and
current-schema result, stored row and REST response. All eleven converted rows satisfy the current
event contract and `GET /runs/:id/events` returns **200** for each (also asserted by the evidence
collector in `final-rest-check.json`). The four reported cases now keep their original type and
payload, rather than erasing invalid evidence or generating invalid current events.

## 3. Files changed

- Infrastructure: new `webhook-receipt-upgrade.ts` and boundary tests;
  `0015_webhook_delivery_journal.sql`, `db.ts`, `upgrade.ts`, `delivery-runs.test.ts`
  and the fresh-initialization race fixture.
  Shared-file edits are confined to migration imports, runner and transaction dispatch;
  exact changed line ranges are in `source-ranges.txt`.
- Docs: ADR-0043, CHANGELOG and this report with reproducible drivers and sanitized evidence.
- No engine, inspector, runtime contract, API route, client or dependency changes.

## 4. Tests

`webhook-receipt-upgrade.test.ts` covers the frozen URL/string boundaries, eleven historical-valid
controls, valid short NUL strings, 4096 astral code points, rejection of 4097 code points,
strict keys, current-schema validity, byte preservation, idempotence and transactional rollback.
`delivery-runs.test.ts` now invokes the public migration entry point and proves completed receipts
do not acquire a new pending delivery or retry budget.

Before the fix, the initial boundary file had **4 failed / 17 passed**, with the four reported
cases failing **"An invalid historical receipt must remain byte-identical"**. The expanded
file was also run against the base implementation using its original SQL and migration runners,
restoring the working source bytes afterwards: **6 failed / 20 passed**. Its additional failures
were invalid stored timestamp and unexpected node ID. Valid/invalid controls that already worked
are retained as controls, not reported as new failures. Focused post-fix suites: **68/68 passed**
across boundary, delivery projection and database tests. The added URL-preservation control
brings those suites to **69/69**. It preserves valid raw URL values even when the frozen parser
normalizes its output. The fresh-initialization suite passes **14/14** after confining its injected
freshness race to the first transaction; ordinary migration now uses the same transaction API.
All schema, ledger, migration-effect and repeated-startup assertions remain in place. The runner
applies a losing initializer's pending SQL under that same lock.

| Package        | Full final result                                     | Statements | Branches | Functions | Lines  |
| -------------- | ----------------------------------------------------- | ---------- | -------- | --------- | ------ |
| engine         | 557 passed / 31 files                                 | 96.87%     | 92.48%   | 98.72%    | 98.05% |
| infrastructure | 695 passed, 7 failed / 702 tests, 47 files            | 97.78%     | 94.88%   | 97.90%    | 98.67% |
| api            | 701 passed, 1 failed, 6 skipped / 708 tests, 53 files | 96.46%     | 92.88%   | 94.30%    | 97.83% |
| web            | 1481 passed, 1 failed / 1482 tests, 118 files         | 98.00%     | 94.73%   | 98.45%    | 98.93% |

The new `webhook-receipt-upgrade.ts` has **100% statements, branches, functions and lines**
(28/28 statements, 14/14 branches, 4/4 functions, 24/24 lines). Full V8 counts for changed
production files and package totals are in [coverage.json](coverage.json).

The seven infrastructure failures are D-015: three in `process/scripts.test.ts`, three in
`claude/process.test.ts`, and the adversarial real-child/grandchild abort. The exact assertion
includes **"native process-tree cancellation must finish before fixture cleanup: expected true
to be false"**; other failures include 15/30-second termination timeouts, continuing descendant
output and `EBUSY` fixture removal. The API failure is native fixture teardown in
`subloop-restart.test.ts`: **"Hook timed out in 60000ms"** from `afterEach`, which force-kills
children and waits for `close`. Its recovery/continuation assertions completed; the cleanup hook
failed. The web failure is the existing TriggerEditor keyboard/undo case:
**"Test timed out in 20000ms"**, a load/deadline failure rather than D-015.

Earlier full infrastructure coverage, before the startup-race fixture correction and final
raw-channel preservation, had 689 passed / 12 failed (701 tests): the same seven D-015 failures,
four 20-second `upgrade.test.ts` timeouts and the freshness-race fixture assumption. The final
full run has no migration or initialization failure. Those earlier timeout failures remain
recorded, with isolated triage below; they are not erased by later passes. Earlier API coverage
passed 702 with six skips; its final-source recheck above supersedes that gate result.

One isolated command per affected file/selection ran sequentially after all full runs finished:

| Selection                                                                             | Isolated result                 | Evidence                                       |
| ------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| infrastructure `src/process/scripts.test.ts --maxWorkers=1`                           | 36 passed, 3 failed             | [log](logs/round6-isolated-scripts.txt)        |
| infrastructure `src/claude/process.test.ts --maxWorkers=1`                            | 2 passed, 3 failed              | [log](logs/round6-isolated-claude-process.txt) |
| infrastructure `src/adversarial.test.ts --maxWorkers=1`                               | 19 passed, 1 failed             | [log](logs/round6-isolated-adversarial.txt)    |
| infrastructure `src/sqlite/upgrade.test.ts --maxWorkers=1 --testNamePattern=ordinary` | 11 passed, 3 failed, 12 skipped | [log](logs/round6-isolated-upgrade.txt)        |
| api `src/subloop-restart.test.ts --maxWorkers=1 --testNamePattern=down`               | 1 passed, 2 skipped             | [log](logs/round6-isolated-api-subloop.txt)    |
| web `src/editor/TriggerEditor.test.tsx --maxWorkers=1 --testNamePattern=keyboard`     | 1 passed, 12 skipped            | [log](logs/round6-isolated-web-trigger.txt)    |

Commands use `pnpm.cmd --filter @graphgoblin/<package> exec vitest run <selection>`;
[exact commands and exits](logs/round6-isolated-results.json) are retained. The three isolated
upgrade failures are the history/template cutover case and the queued/waiting ordinary-run
refusals, each **"Test timed out in 20000ms"**. The running-run refusal passed on that run.
These variable deadline failures remain a caveat. The API and web isolated passes do not turn
their failed full-suite gates green. No assertions, timeouts, thresholds or exclusions changed.

The URL-preservation control exposed normalization in the first converter implementation;
its full-file failure and subsequent correction are retained. An earlier quoted test-name
filter selected no tests; its skipped result is excluded from verification counts.

## 5. Gates

All commands select Node `v22.14.0` first on PATH and use `pnpm.cmd`.
Process-local `pnpm_config_verify_deps_before_run=false` uses the installed dependencies;
the sandbox cannot acquire pnpm's global automatic-install lock. No dependency or configuration
was changed. Results (all raw output retained under `logs/`):

| Command                                                                                                                                                       | Result                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                                          | Pass, final 20/20 tasks                                                                         |
| `pnpm.cmd lint`                                                                                                                                               | Pass, final 11/11 tasks; initial new-test string-coercion error corrected with a type check     |
| `pnpm.cmd check:layers`                                                                                                                                       | Pass                                                                                            |
| `pnpm.cmd check:deps`                                                                                                                                         | Pass, 0 errors; existing orphan warning for `packages/infrastructure/drizzle.config.ts` only    |
| `pnpm.cmd check:migrations`                                                                                                                                   | Pass, Drizzle generation is a no-op (rerun after final source changes)                          |
| `pnpm.cmd check:docs`                                                                                                                                         | Pass; no schema/route regeneration needed                                                       |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                          | Pass                                                                                            |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure=true`                                                  | Fail, seven D-015 failures; coverage thresholds pass                                            |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                             | Fail, one native teardown hook timeout; coverage thresholds pass                                |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure=true`                                                             | Fail, one load/deadline timeout; coverage thresholds pass                                       |
| `pnpm.cmd build`                                                                                                                                              | Pass, final 11/11 tasks                                                                         |
| `pnpm.cmd test:webhook-retry`                                                                                                                                 | Pass, final nine scenarios; exhaustion five requests, crash two requests; no new drain requests |
| `GG_E2E_BROWSER_CHANNEL=msedge pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/webhook-delivery.spec.ts e2e/webhook-receiver.spec.ts --workers=1` | Pass, final 3/3 in 50.2 seconds                                                                 |
| Auditor driver and checker after final build                                                                                                                  | Pass, 20/20                                                                                     |
| `pnpm.cmd format:check`                                                                                                                                       | Pass; full-repository scan, then a targeted check of final report metadata                      |

Final acceptance drain measurements: **306 ms** in backoff and **10,141 ms** mid-attempt, with
**zero new requests** in both and durable delivery resumed after restart. These are wall-clock
process-stop durations, including persistence/exit; the request deadline remains 10 seconds.
The earlier acceptance run also passed (36 ms / 9,954 ms). No new runtime behavior is inferred
from coverage-only tests. Turbo's sandbox cache-write access warnings do not change exit status.

To replay the native boundary checks from this worktree after building:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$env:GG_WP_D2_BASE_ROOT = Join-Path $env:TEMP 'gg-audit-d2-20261022/base-52360d9'
$env:GG_WP_D2_CURRENT_ROOT = (Get-Location).Path
$env:GG_AUDIT_D2_OUT = Join-Path $env:TEMP ('gg-wp-d2-boundary-replay-' + [guid]::NewGuid().ToString('N'))
$loader = ([uri](Join-Path (Get-Location).Path 'docs/qa/2026-10-21-wp-d2-report/base-loader.mjs')).AbsoluteUri
node --experimental-loader $loader docs/qa/2026-10-22-wp-d2-round-6/migration-boundaries.mjs
node docs/qa/2026-10-22-wp-d2-round-6/migration-boundaries-check.mjs
```

The auditor's retained base export/store manifest must exist. The driver starts and kills only
its disposable built API on 5644. Do not delete its directories in the Codex sandbox; record
them for orchestrator cleanup. Raw before/after rows, old/current schema outcomes and REST
responses are retained in the linked JSON evidence.

## 6. Docs

ADR-0043 records the code conversion, exact frozen schema, ordering, transaction, rollback,
idempotence and damaged-row behavior. The CHANGELOG **Upgrade:** note says URL validity and
full code-point bounds past embedded NULs are enforced, invalid rows remain byte-identical and
surface as per-run `HISTORY_UNREADABLE`, while healthy runs and the API start normally.
No new class, outcome, parameter, schema or route was introduced; generated references do not change.

## 7. Decisions and parameters

Use the archived format-3 receipt schemas, whose receipt/channel shape remained unchanged in
the pre-#246 build. Derive payload schemas by omitting only stored envelope fields; validate
the envelope too, so damaged metadata and unknown payload evidence cannot be hidden.
Zod supplies exact URL semantics and code-point bounds, including embedded NUL and astral
characters. SQL `length()`, `replace()` and `LIKE` cannot implement those semantics.
There is one eligibility rule and no runtime compatibility reader.

The existing transactional SQL runner now applies ordinary startup migrations too; fresh-store
initialization and offline upgrades already use it. Invoke conversion only at the frozen 0015
timestamp, before its SQL, and record the ledger in the same transaction. A failed transaction
has no partial conversion or allocation; a committed ledger skips the rewrite. Candidate reads
use the existing bounded 500-row upgrade scan. Historical completed returns keep one attempt
and no new budget; pending historical returns retain the frozen budget of five. Runtime delivery
policy and all engineering parameters remain unchanged.

## 8. Caveats and open items

Independent exact-head confirmation remains the orchestrator's next step. This migration has
not shipped. Stores already migrated by an earlier PR candidate must use a pre-upgrade backup
to exercise the revised one-off step; rewriting an already damaged receipt cannot restore lost
evidence. No owner app/store, paid provider, Git index, commit, publication or branch operation
was used. Disposable native replay stores are retained in `retained-stores.json` for orchestrator
cleanup, respecting the no-directory-deletion rule. Existing test fixture cleanup remains owned
by those test harnesses. Any coverage or environment caveats are listed with the gate results.
Native fixtures with D-015 cleanup failures can remain, with paths in their raw logs. Migration
timestamp/ordering reconciliation is still integration work: if the orchestrator changes the
0015 journal timestamp, its frozen code dispatch and test boundary must move with it. Existing
deferrals (manual redelivery, `Retry-After`, recovery concurrency and conservative never-sent
classification) are unchanged. No review/merge approval is claimed from these local results.
