# WP-G2 round 7: migration merge (#231, #236)

## 1. Branch and worktree

Branch: `codex-wp-g2-paging-summaries`. Worktree: `.claude/worktrees/codex-wp-g2-paging-summaries`.
HEAD remains `439ff43b8b64f7b958cae829d6d23d0a3bf64142`; MERGE_HEAD is
`9c196547d8209b5f13909d20e612be1659bf7d3e`. Evidence covers the resolved merge
working tree, with Node `v22.14.0` and Windows PowerShell. The orchestrator stages
and commits the merge; no Git index or history mutation was performed here.

## 2. Per bolt

**#231:** the built API upgrades a disposable format-4 store initialized with main's
exact migration prefix through `0015_webhook_delivery_journal`. Pending migrations
change from **1 to 0**, the ledger changes from 16 to 17 entries, and both the D2
delivery index and G2 owner/history index exist. Three real SQLite runs and three
inbound events with tied timestamps each traverse three limit-one HTTP pages,
without duplicates, in descending id order, and exhaust their opaque cursors.
Active loop/status/parent filters remain on every run request. See
[upgrade results](upgrade-final-results.json) and [the native replay](upgrade-and-history.mjs).
The built Edge history spec passes Runs and Events append, filter preservation,
reading-position preservation and keyboard-focus exhaustion checks.

**#236:** the upgraded store reports the selected tied latest run as `succeeded`
with exact count 3, and a genuine no-history loop as null/count 0. The Edge history
spec also passes the older-than-500-runs summary case. A separate built API,
SQLite fault injection, real restart and Edge replay passes all three damaged
latest-row cases (`pinned`, `initial_thread`, `thread_snapshot`). Each retains a
durable succeeded event beside stored `running`, returns `latestRun: null` and
count 2, exposes `HISTORY_UNREADABLE`, and shows the unavailable copy instead of
an older or stale badge. See [restart results](threads-final-results.json),
[pinned](threads-final-pinned.png), [initial thread](threads-final-initial_thread.png), and
[cached thread](threads-final-thread_snapshot.png). The strict latest-row implementation
from round 6 is retained without changes.

## 3. Files changed

Infrastructure:

| File                                                                  | Merge resolution / change                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `drizzle/0015_webhook_delivery_journal.sql`                           | Main's shipped SQL retained byte for byte, including its one-off rewrite.                       |
| `drizzle/meta/0015_snapshot.json`                                     | Main's stage-3 snapshot retained byte for byte.                                                 |
| `drizzle/0015_loop_owner_history.sql` → `0016_loop_owner_history.sql` | Same index statement; only the migration number changes.                                        |
| `drizzle/meta/0016_snapshot.json`                                     | Regenerated from the merged schema; chains to main's 0015 and adds only the G2 index.           |
| `drizzle/meta/_journal.json`                                          | All main entries retained; G2 appended at index 16 with its original timestamp.                 |
| `src/sqlite/catalog.test.ts`                                          | All three G2 dynamic-count expectations retained; rollback comment now says 0016.               |
| `src/sqlite/classifiers.test.ts`                                      | G2 `shippedSqlMigrationCount() - count` retained.                                               |
| `src/sqlite/storage.test.ts`                                          | Both G2 dynamic-count expectations retained.                                                    |
| `src/sqlite/template-retirement.test.ts`                              | G2 `migrations.length` expectation retained.                                                    |
| `src/sqlite/delivery-runs.test.ts`                                    | Main/D2 fixture now removes the whole post-0014 ledger suffix and the 0016 index before replay. |
| `src/sqlite/webhook-receipt-upgrade.test.ts`                          | Same D2 fixture correction; rollback assertions still require the historical 15-entry prefix.   |

API/MCP:

| File                                        | Merge resolution / change                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/api/src/version-migration.test.ts`    | G2 `removed.rowsAffected` count retained.                                                             |
| `apps/mcp/src/webhook-delivery.test.ts:116` | Main/D2 delivery assertion reads `runs.list(...).items[0]`, preserving the full-page client contract. |

The D2 test-file edits are narrow integration changes to another package's work.
Production `schema.ts` retains both additions from the merge; no further production
TypeScript change was needed. Documentation edits are listed in section 6. Line anchors are recorded in
[changed-lines.json](changed-lines.json).

## 4. Tests

The first infrastructure coverage run recorded **716 total, 656 passed, 60 failed**:
51 migration-fixture failures, seven native termination failures, and two ordinary
upgrade-test timeouts. The fixture regression before correction is:

> DatabaseUpgradeRequiredError: The shipped migration ledger is incomplete or inconsistent

Deleting only 0015 left 0016 in the ledger, so the strict guard correctly refused
the gap. Both fixtures now remove entries at or after 0015 and drop the later index
before the public migrator reapplies them. Production validation was not loosened.
The initial failures are retained in [test results](tests-infrastructure-initial.json)
and [the complete log](round7-coverage-infrastructure.log.txt).

The corrected fixture suites pass **58/58** with exit 0. See [tests-fixtures.json](tests-fixtures.json) and [round7-fixtures.log.txt](round7-fixtures.log.txt).

| Package        | Total | Passed | Failed | Skipped |  Lines | Branches |
| -------------- | ----: | -----: | -----: | ------: | -----: | -------: |
| Infrastructure |   716 |    709 |      7 |       0 | 98.69% |   94.92% |
| API            |   739 |    733 |      0 |       6 | 97.84% |   92.91% |
| WEB            |  1496 |   1496 |      0 |       0 | 98.93% |   94.78% |
| MCP            |    49 |     49 |      0 |       0 | 96.66% |   95.39% |

API coverage includes all **29 run-paging** and **9 loop-summary** cases passing.
The Edge history spec passed **3/3**, without retries. Native upgrade/paging and
all three restart/Edge corruption cases passed. No live providers were used.

Each distinct remaining full-run failure was isolated once with one worker and its
original timeout. Full-run failures remain recorded even when the isolated case passes.

| Isolated case                                                                                                                                            | Result | Class                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------- |
| `src/claude/process.test.ts`: owned native Claude process transport kills on deadline and output overflow                                                | FAIL   | D-015: native termination   |
| `src/adversarial.test.ts`: adversarial infrastructure invariants (forks pool) 6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild | FAIL   | D-015: native termination   |
| `src/claude/process.test.ts`: owned native Claude process transport does not spawn for an already aborted signal and cancels a running process           | FAIL   | D-015: native termination   |
| `src/claude/process.test.ts`: owned native Claude process transport kills the descendant that a long-lived child started                                 | FAIL   | D-015: native termination   |
| `src/process/scripts.test.ts`: ProcessScripts kills and closes a real process cancelled with incomplete UTF-8 pending on both streams                    | FAIL   | D-015: native termination   |
| `src/process/scripts.test.ts`: ProcessScripts kills the process tree on timeout                                                                          | FAIL   | D-015: native termination   |
| `src/process/scripts.test.ts`: ProcessScripts kills the process when the signal aborts, including when already aborted                                   | FAIL   | D-015: native termination   |
| `src/sqlite/upgrade.test.ts`: definitions-only format-4 cutover blocks ordinary queued runs without cancelling them                                      | PASS   | Ordinary timeout; not D-015 |
| `src/sqlite/upgrade.test.ts`: definitions-only format-4 cutover blocks ordinary running runs without cancelling them                                     | PASS   | Ordinary timeout; not D-015 |

D-015 includes this unchanged native assertion:

> native process-tree cancellation must finish before fixture cleanup: expected true to be false

See [isolation-results.json](isolation-results.json) for each assertion, original test name,
exit code and duration.

Two full-name filter attempts selected zero tests and are invalid evidence, regardless
of their exit codes. The corrected leaf-name filters execute exactly one identified
case each; see [isolation-invalid-attempts.json](isolation-invalid-attempts.json).

## 5. Gates

| Command                                                                         | Result                                 |
| ------------------------------------------------------------------------------- | -------------------------------------- |
| `pnpm.cmd format --ignore-path .round7-format.ignore.log`                       | PASS                                   |
| `pnpm.cmd typecheck`                                                            | PASS                                   |
| `pnpm.cmd lint`                                                                 | PASS                                   |
| `pnpm.cmd format:check --ignore-path .round7-format.ignore.log`                 | PASS                                   |
| `pnpm.cmd check:migrations`                                                     | PASS                                   |
| `pnpm.cmd check:docs`                                                           | PASS                                   |
| `pnpm.cmd check:tokens`                                                         | PASS                                   |
| `pnpm.cmd build`                                                                | PASS                                   |
| `pnpm.cmd check:layers`                                                         | PASS                                   |
| `pnpm.cmd check:deps`                                                           | PASS                                   |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                              | PASS                                   |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`               | PASS                                   |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage`                              | PASS                                   |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1`    | FAIL (exit 1) after fixture correction |
| Edge `e2e/history.spec.ts --retries=0` after build                              | PASS, 3/3                              |
| Native 0015 → 0016 upgrade, paging and latest-run summaries after final build   | PASS, pending 1 → 0                    |
| Native restart and Edge for three damaged latest-row variants after final build | PASS, 3/3                              |

The initial typecheck failed on main's newly merged MCP test:

> src/webhook-delivery.test.ts(116,14): error TS7053

It indexed the page object as an array. The assertion now accesses `.items`, and
the corrected full typecheck passes 20/20. The original failed log is retained.
The first native QA harness also exited 1 with `ERR_PACKAGE_PATH_NOT_EXPORTED`
before starting the API: its CommonJS import did not match the package's ESM
export. The replay now imports the built public ESM entry point and passes;
both harness logs are retained. Neither failure is classified as D-015.

`check:deps` passes with zero errors and two no-orphans warnings (the Drizzle
configuration and a pre-existing Playwright trace resource). Turbo also emitted
cache-access warnings; successful command exit codes are recorded separately.
Formatting is scoped to resolved/integration files and this evidence folder so
main's exact 0015 files and the protected QA record are preserved. The exact scope
is retained in [format-scope.log.txt](format-scope.log.txt).

## 6. Docs

- `docs/07-api-and-streaming.md:479`: current migration reference becomes `0016_loop_owner_history`.
- `CHANGELOG.md:14`: same reference update; both sides of the staged union remain present.
- This folder: native upgrade replay, migration-chain proof, sanitized `.log.txt`
  logs, test/coverage summaries and restart/Edge evidence.
- Numbered doc 09 and route schemas are unchanged; generated references remain current.
- Historical QA and delivery-register references keep the migration names used by
  those historical runs. `docs/qa/2026-10-22-wp-g2-qa/` was not edited.

## 7. Decisions and parameters

`pnpm.cmd --filter @graphgoblin/infrastructure db:generate --name loop_owner_history`
generated the new migration and snapshot. Its SQL matches the old G2 statement;
there was no handwritten G2 data rewrite to carry over. Main's 0015 SQL and snapshot
were checked byte for byte against the merge index. After removing only the new
index from the generated snapshot, its schema equals main's 0015 schema exactly.

| Migration | Journal index | Tag                             | `when`          | Snapshot id                            | `prevId`                               |
| --------- | ------------- | ------------------------------- | --------------- | -------------------------------------- | -------------------------------------- |
| Main      | 15            | `0015_webhook_delivery_journal` | `1792454400000` | `d1feab58-5274-4a0b-bb0e-6f23d6ed76f9` | `08aeafd2-e3de-486c-9f4f-b950e3ab1e54` |
| G2        | 16            | `0016_loop_owner_history`       | `1792472004405` | `f2fb7481-7a6b-4aef-9166-34ae803fb00c` | `d1feab58-5274-4a0b-bb0e-6f23d6ed76f9` |

The journal is zero-based: **17 entries (0000 through 0016)**, rather than 16.
Dynamic expected pending counts are 15 after two entries, 14 after three, 13 after
four, 12 after five and six after eleven. Fresh initialization records 17 entries.
See [migration-chain.json](migration-chain.json).

Replay from the worktree root after building:

```powershell
$env:PATH = "$env:APPDATA\nvm\v22.14.0;$env:PATH"
$proofRoot = Join-Path $env:TEMP ("gg-wp-g2-round7-upgrade-" + [guid]::NewGuid())
node docs/qa/2026-10-22-wp-g2-round-7/upgrade-and-history.mjs $proofRoot
```

The replay uses only `$proofRoot/store`, port 5621, and the built web distribution.
It launches and closes its own API, inherits no owner app configuration and does
not need `GG_MASTER_KEY`: the disposable instance generates its own key. The
restart replay uses port 5620 and its own separate disposable store. The browser
fixture chooses free ports. No owner app, store or protected QA record is touched.

## 8. Caveats and open items

The final infrastructure coverage gate fails: 7 failed tests.
7/7 isolated native termination cases fail (D-015).
The ordinary case “definitions-only format-4 cutover blocks ordinary queued runs without cancelling them” passes alone; its original full-run timeout remains a failure, not D-015.
The ordinary case “definitions-only format-4 cutover blocks ordinary running runs without cancelling them” passes alone; its original full-run timeout remains a failure, not D-015.
No thresholds, exclusions, timeouts or production migration guards were weakened.
The known native failures and any ordinary timeout failures require orchestrator follow-up
or verification in the appropriate environment; they are not represented as a green gate.

Conflict markers are removed from the working files. The seven paths still have
unmerged index entries until the orchestrator stages them; the index was left
untouched as instructed. The orchestrator also stages the SQL rename and new
snapshot, commits the merge, obtains Fable review and resumes the independent audit.
This report does not grant product acceptance or close either bolt.
