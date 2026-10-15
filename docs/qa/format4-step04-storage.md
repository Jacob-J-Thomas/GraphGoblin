# #164 step 04: storage foundations QA record

Stored definition format remains **3**. This step centralizes the current format, separates format readiness from ordinary SQL migration, bounds offline scans and restores the Drizzle snapshot baseline after migrations **0000-0011**.

## Verified behavior and review findings

| Finding                            | Implementation and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: external sort fan-in           | Canonical JSON chunks merge in multiple passes with at most 63 input readers plus one output file and a binary min-heap. String comparison retains JavaScript UTF-16 code-unit order. Tests force fan-in 3 and chunk size 3, compare against an in-memory sort, measure the reader limit, and check success/failure cleanup.                                                                                                                                                                                                                                                                                                                       |
| F2: baseline versus head           | `FORMAT_BASELINES` binds format 3 to `0008_github_triggers`. Both catalogues come from executing shipped SQL in disposable in-memory databases. Before writes, the marker must be current/complete, the timestamp ledger must be a shipped prefix containing the baseline, baseline structure must be present and definitions must parse. Drizzle applies pending migrations normally. Post-migration validation requires the complete timestamp ledger and full head tables, columns, checks, named constraints and indexes. Tests cover 0008/0009/0010 startup, baseline damage, non-prefix ledgers and a claimed head missing a template table. |
| F3: historical SQL hashes          | Admission compares `created_at` only, matching Drizzle's applied-migration identity. A regression changes stored hashes and successfully migrates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F4: provenance scans               | Inbound delivery provenance projects needed fields and streams 500-row batches. Endpoint, loop, version and run lookups use Maps, with historical webhook modes cached per endpoint. Webhook runs project only identity/owner/version/loop/initial-thread fields. A 1,002-delivery regression checks batching and projections.                                                                                                                                                                                                                                                                                                                     |
| F5: issue order                    | Run and orphan-event scans use the same bounded canonical sort as whole-store hashes, preserving the former full-row order, including events that interleave across run IDs. Projected inbound and pending-receipt rows retain the canonical keys through their unique ID. Batched scans and projected provenance queries have explicit SQL ordering; canonical merging restores the original full-row order. An independent old-algorithm reference asserts the complete issue sequence.                                                                                                                                                          |
| F6: remaining current literals     | The editor draft loader and engine scenario factory use `CURRENT_DEFINITION_FORMAT`. The v2-to-v3 domain stage keeps its frozen literal 3, with comments at the definition, passthrough and export output sites.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F7: preflight ownership            | `migrate()` always repeats marker, ledger and structure checks before writes. Only definition parsing may be skipped, and only when real database/data-directory paths establish lock coverage. External database URLs are reparsed. Tests cover both locations, cheap rechecks and refusal of an external definition changed after construction.                                                                                                                                                                                                                                                                                                  |
| F8: vanished linked run            | Apply removes visited run IDs from the rewrite set and refuses any remainder before commit. A database trigger removes a proven linked run during apply; the test requires the specific refusal and verifies complete rollback.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| F9: index and constraint catalogue | SQLite executes `DROP INDEX` and `CREATE INDEX IF NOT EXISTS` while deriving the catalogue; no index regex is needed. Named constraints and balanced CHECK expressions are checked separately. Tests cover dropped indexes, repeated conditional creation and renamed baseline constraints.                                                                                                                                                                                                                                                                                                                                                        |
| F10 and QA record                  | The architecture migration range is `0000-0011`. This record describes behavior, evidence and limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Regression tests

- `upgrade-scan.test.ts`: **merges multiple bounded fan-in passes with hash parity and removes all spill files**; **closes merge readers and cleans intermediate output when a merge read fails**; six **rejects invalid sort bounds** cases. Existing canonical hash/Unicode/control-character and failed-read cases remain.
- `readiness.test.ts`: **accepts historical applied hashes because Drizzle identifies migrations by timestamp**; three **starts a format-3 store at migration %s and finishes at the shipped head** cases (8/9/10); **refuses a head ledger with missing additive structure after a no-op migration**; **requires the shipped baseline constraint names as well as their expressions**; **derives dropped and IF NOT EXISTS indexes from the executed migration catalogue**. Existing baseline table/column/ledger/marker/definition refusals remain.
- `upgrade.test.ts`: **preserves old canonical issue ordering for orphan runs, interleaved orphan events and pending receipts**. Existing hash-parity, conversion, atomicity and 50,000-event cases remain.
- `trigger-structural-upgrade.test.ts`: **rolls back when a proven linked webhook run vanishes before rewrite traversal**; **batches projected webhook delivery provenance without loading payloads or complete run rows**.
- API `container.test.ts`: two **reuses only the definition parse when the database is covered by the data-directory lock: %s** cases; **repeats cheap readiness checks inside migrate even after a protected preflight**; **reparses external database definitions changed after construction before startup writes**. Existing refusal before master-key/database writes remains.

## Coverage and gates

All Vitest package runs use `$env:VITEST_MAX_WORKERS='2'` and run one package at a time. Coverage thresholds and source exclusions are unchanged.

| Package        | Lines  | Branches | Statements | Functions | Tests                                         |
| -------------- | ------ | -------- | ---------- | --------- | --------------------------------------------- |
| infrastructure | 98.26% | 93.26%   | 97.14%     | 97.33%    | 498 passed, six known sandbox cases skipped   |
| api            | 95.88% | 90.95%   | 94.19%     | 96.09%    | 1,349 passed, four existing conditional skips |
| engine         | 98.35% | 93.53%   | 97.22%     | 97.26%    | 515 passed                                    |
| domain         | 97.89% | 94.33%   | 96.81%     | 96.34%    | 491 passed                                    |
| web            | 98.65% | 93.89%   | 97.77%     | 98.38%    | 1,215 passed                                  |

| Gate command                                                                                                  | Result                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm.cmd --filter @graphgoblin/infrastructure typecheck`                                                     | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/infrastructure lint`                                                          | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage` with the six sandbox test names skipped (below) | Pass: 498 passed, six skipped                                                                    |
| `pnpm.cmd --filter @graphgoblin/api typecheck`                                                                | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/api lint`                                                                     | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                            | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/engine typecheck`                                                             | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/engine lint`                                                                  | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                         | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/domain typecheck`                                                             | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/domain lint`                                                                  | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`                                                         | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/web typecheck`                                                                | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/web lint`                                                                     | Pass                                                                                             |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`                                                            | Pass                                                                                             |
| `pnpm.cmd check:layers`                                                                                       | Pass                                                                                             |
| Node 22 dependency-cruiser command below                                                                      | Pass: zero errors; existing `no-orphans` warning for `packages/infrastructure/drizzle.config.ts` |
| `pnpm.cmd check:migrations`                                                                                   | Pass                                                                                             |
| `pnpm.cmd check:docs`                                                                                         | Pass                                                                                             |
| `node --test tooling/scripts/check-migrations.test.mjs`                                                       | Pass: two tests                                                                                  |
| `pnpm.cmd exec prettier --check` on every changed file                                                        | Pass                                                                                             |
| `git diff --check`                                                                                            | Pass                                                                                             |
| `pnpm.cmd test:upgrade`                                                                                       | Pass: 10 passed, two host file-symlink capability skips                                          |

Dependency command:

```powershell
& "$env:APPDATA\nvm\v22.14.0\node.exe" node_modules/dependency-cruiser/bin/dependency-cruiser.mjs packages apps --config .dependency-cruiser.cjs
```

Infrastructure coverage selects all tests except the following six native process-kill cases, for which sandbox policy denies `taskkill`. The previous complete 476-test suite was independently reported passing outside the sandbox; that result predates these review fixes. This record's current coverage result describes only the selected tests and retains all normal source files and thresholds.

1. `src/adversarial.test.ts`: **6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild**.
2. `src/process/scripts.test.ts`: **kills the process tree on timeout**.
3. `src/process/scripts.test.ts`: **kills the process when the signal aborts, including when already aborted**.
4. `src/claude/process.test.ts`: **kills on deadline and output overflow**.
5. `src/claude/process.test.ts`: **does not spawn for an already aborted signal and cancels a running process**.
6. `src/claude/process.test.ts`: **kills the descendant that a long-lived child started**.

```powershell
$env:VITEST_MAX_WORKERS='2'
pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --coverage.reportOnFailure --silent=false --testNamePattern '^(?!.*(?:6/QA-LIMIT-001|kills the process tree on timeout|kills the process when the signal aborts|kills on deadline and output overflow|does not spawn for an already aborted signal and cancels a running process|kills the descendant that a long-lived child started))'
```

## Owner-size measurement

The scale test inventories and applies **50 loops, 500 versions, 500 runs and 50,000 events**, compares converted definitions and decisions with the small fixture, checks original event archives and final readiness, and prints time/RSS without asserting either performance number.

The isolated final run without coverage completed inventory plus apply in **78,231 ms**, with **335.2 MiB peak RSS**, on Windows / Node 23.10.0. The test passed. The full infrastructure coverage run also passed the scale case (106,632 ms, 440.7 MiB); the isolated measurement is the primary record because coverage changes runtime and garbage-collection behavior.

```powershell
$env:VITEST_MAX_WORKERS='2'
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts -t 'inventories and applies 50 loops' --silent=false
```

`process.resourceUsage().maxRSS` is the worker's process high-water mark, including fixture construction and test/runtime overhead. The elapsed interval starts immediately before inventory. Measurements do not establish a bound for a single enormous run or a multi-million-event store.

## Scope and documentation

The current-format contracts, initialization transaction, frozen parsers, snapshot baseline and migration no-op gate remain in place. No shipped SQL, journal entry, snapshot or dependency changes for this review revision. The previous-release catalog fixture uses the existing historical SQL helper rather than applying current startup admission to an older release's truncated migration folder; the initializer-race test retains extension-only migration-folder coverage.

Residual resident sets are definitions, loop/endpoint/default provenance, projected webhook-run identities and initial threads, pending-receipt metadata, returned issues and proven rewrite keys. A run's history is still materialized individually. Inbound event payloads are excluded from provenance reads, but canonical whole-store hashes and archives necessarily read every original field in bounded batches.

Docs 10 describes baseline admission, ordinary migration, head verification and their tests. The architecture README describes the same rule, bounded fan-in/provenance/order behavior and limits. The internal CHANGELOG line reflects pre-write baseline and post-migration head checks with bounded fan-in hashing.

## Changed files

- `apps/api/src/container.ts`, `apps/api/src/container.test.ts`.
- `apps/web/src/editor/useLoadEditor.ts`.
- `packages/engine/src/testing/scenario.ts`, `packages/domain/src/upgrade-current.ts`.
- `packages/infrastructure/src/sqlite/`: `db.ts`, `readiness.ts`, `readiness.test.ts`, `upgrade-scan.ts`, `upgrade-scan.test.ts`, `upgrade.ts`, `upgrade.test.ts`, `trigger-upgrade.ts`, `trigger-structural-upgrade.test.ts`, `catalog.test.ts`.
- `docs/10-testing-and-quality.md`, `docs/architecture/README.md`, `docs/qa/format4-step04-storage.md`, `CHANGELOG.md`.
