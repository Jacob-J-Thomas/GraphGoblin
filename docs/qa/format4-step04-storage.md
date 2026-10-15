# #164 step 04 storage foundations

Stored definition format remains **3**. All four storage tasks are implemented in this worktree; no split, commit, push, merge or branch change was performed.

## Changes

- One `CURRENT_DEFINITION_FORMAT` in contracts supplies current definition/export literals, the existing schema-version export, current fixture/editor/export writers, readiness, initialization, manifest validation, apply markers and offline tooling. Frozen conversion stages and generated v2/v3 schemas retain their literals.
- The current-store descriptor derives tables, columns and checks from Drizzle, index names/uniqueness from shipped SQL, and exact migration hashes/timestamps from shipped migrations. The container reuses its read-only preflight under the data-directory lock. Definitions still undergo strict parsing before startup writes. Fresh initialization retains its transactional race recheck.
- Whole-store hashing spills sorted 500-row canonical-JSON chunks and hashes their merge incrementally, preserving the old hash algorithm. Runs, archive rows and final validation are batched, with event-loop yields between batches/runs to release transient native statements without releasing the transaction; histories use the `(run_id,seq)` primary index and materialize one run at a time.
- `0011_snapshot.json` reconstructs the final baseline. The schema now declares the already-shipped template expression indexes and JSON checks so the snapshot includes them. Shipped SQL and journal entries are unchanged. `check:migrations` generates only in a disposable directory and rejects new SQL or a failure to confirm a no-op.

## Files changed

| Area               | Files                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts          | `packages/contracts/src/loop.ts`, `index.ts`, `testing/index.ts`, `format.test.ts`                                                                              |
| Current writers    | `packages/domain/src/loop-io.ts`, `apps/web/src/editor/model.ts`                                                                                                |
| Startup            | `apps/api/src/container.ts`, `apps/api/src/container.test.ts`, `packages/infrastructure/src/sqlite/db.ts`                                                       |
| Storage            | `packages/infrastructure/src/sqlite/upgrade.ts`, `upgrade.test.ts`, `readiness.ts`, `readiness.test.ts`, `upgrade-scan.ts`, `upgrade-scan.test.ts`, `schema.ts` |
| Migration baseline | `packages/infrastructure/drizzle/meta/0011_snapshot.json`                                                                                                       |
| Tooling and gates  | `tooling/scripts/upgrade.mjs`, `check-migrations.mjs`, `check-migrations.test.mjs`, `package.json`, `.github/workflows/ci.yml`                                  |
| Documentation      | `docs/architecture/README.md`, `docs/10-testing-and-quality.md`, `CHANGELOG.md`, this report                                                                    |

26 files in total. Neither ordinary run paging nor the other worker's run repository/routes/client files changed.

## Added tests

- Contracts: **reads every current definition/export format literal from the single format constant**.
- Readiness: **refuses missing table / missing column / ledger hash mismatch / ledger timestamp mismatch / missing ledger entry / wrong marker before any startup write** (six parameter cases); **refuses malformed stored definitions before any startup write**; **derives current readiness and the fresh marker from the format constant and shipped ledger**.
- Startup: **checks stored definitions once per existing-store start before startup writes**; **refuses malformed current definitions before master-key creation or database writes**.
- Inventory/hash: **matches the old hash across batches, duplicate rows and UTF-16/control-character ordering**; **propagates a failed inventory read while cleaning up its temporary sort**; **preserves the original canonical whole-store hash on upgrade fixtures**.
- Scale: **inventories and applies 50 loops, 500 versions, 500 runs and 50,000 events with fixture-equivalent results**. It checks inventory counts/refusals, applied counts, converted definitions and decision evidence against the small fixture, 50,000 original event archives, unchanged event count and final readiness. RSS is diagnostic output, never an assertion.
- Migration gate: **migration gate confirms no-op generation and leaves shipped migrations untouched**; **migration gate rejects an additive schema change without writing shipped migrations**. Both hash every shipped SQL/meta file before and after.

## Validation

All Vitest commands used `$env:VITEST_MAX_WORKERS='2'`; Vitest package test runs were sequential. No threshold or coverage-source exclusion changed.

| Package        | Lines  | Branches | Statements | Functions | Test result                                                          |
| -------------- | ------ | -------- | ---------- | --------- | -------------------------------------------------------------------- |
| contracts      | 99.76% | 99.14%   | 99.77%     | 100%      | 250 passed                                                           |
| infrastructure | 98.24% | 93.02%   | 97.07%     | 97.22%    | 470 passed, six known sandbox cases skipped for this coverage report |
| api            | 95.87% | 90.93%   | 94.18%     | 96.09%    | 1,337 passed, four existing conditional skips                        |
| domain         | 97.89% | 94.33%   | 96.81%     | 96.34%    | 491 passed                                                           |
| web            | 98.65% | 93.88%   | 97.77%     | 98.37%    | 1,212 passed                                                         |

The unfiltered infrastructure command ran all 476 tests: **470 passed, six failed** due to denied native process termination. Vitest discarded coverage on test failure, so a subsequent run selected the remaining 470 tests to produce the report above; coverage still includes every normal source file. The following six tests require the orchestrator's unsandboxed run:

1. `src/adversarial.test.ts`: **6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild**.
2. `src/process/scripts.test.ts`: **kills the process tree on timeout**.
3. `src/process/scripts.test.ts`: **kills the process when the signal aborts, including when already aborted**.
4. `src/claude/process.test.ts`: **kills on deadline and output overflow**.
5. `src/claude/process.test.ts`: **does not spawn for an already aborted signal and cancels a running process**.
6. `src/claude/process.test.ts`: **kills the descendant that a long-lived child started**.

Final infrastructure coverage command (the negative name pattern skips only those six tests):

```powershell
$env:VITEST_MAX_WORKERS='2'
pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --coverage.reportOnFailure --silent=false --testNamePattern '^(?!.*(?:6/QA-LIMIT-001|kills the process tree on timeout|kills the process when the signal aborts|kills on deadline and output overflow|does not spawn for an already aborted signal and cancels a running process|kills the descendant that a long-lived child started))'
```

| Gate command                                                  | Result                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm.cmd --filter @graphgoblin/contracts typecheck`          | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/contracts lint`               | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage`      | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/domain typecheck`             | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/domain lint`                  | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`         | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/infrastructure typecheck`     | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/infrastructure lint`          | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage` | Six known sandbox failures; remaining 470 pass; filtered coverage command above passes               |
| `pnpm.cmd --filter @graphgoblin/api typecheck`                | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/api lint`                     | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`            | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/web typecheck`                | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/web lint`                     | Pass                                                                                                 |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`            | Pass                                                                                                 |
| `pnpm.cmd check:layers`                                       | Pass                                                                                                 |
| Node 22 dependency-cruiser command below                      | Pass: zero errors; one existing `no-orphans` warning for `packages/infrastructure/drizzle.config.ts` |
| `pnpm.cmd check:docs`                                         | Pass; no regeneration needed                                                                         |
| `pnpm.cmd check:migrations`                                   | Pass: generation is a no-op                                                                          |
| `node --test tooling/scripts/check-migrations.test.mjs`       | Pass: both positive and deliberate-drift tests                                                       |
| `pnpm.cmd --filter @graphgoblin/tooling test`                 | Pass: 49 tests; tooling has no separate typecheck/lint or Vitest coverage script                     |
| `pnpm.cmd build`                                              | Pass: all 11 build tasks; nonfatal sandbox cache-access warnings                                     |
| `pnpm.cmd test:upgrade`                                       | Pass: 10 passed, two host file-symlink capability skips                                              |
| `pnpm.cmd exec prettier --check` on all changed files         | Pass                                                                                                 |
| `git diff --check`                                            | Pass                                                                                                 |

Dependency command:

```powershell
& "$env:APPDATA\nvm\v22.14.0\node.exe" node_modules/dependency-cruiser/bin/dependency-cruiser.mjs packages apps --config .dependency-cruiser.cjs
```

The two startup tests also passed independently after strengthening the malformed-definition test to omit the master key configuration.

## Measured owner-size store

The isolated test without coverage completed inventory plus apply in **80,562 ms**, with **327.1 MiB peak RSS**, on Windows with Node 23.10.0. `process.resourceUsage().maxRSS` supplies the worker's process high-water mark, including fixture construction and runtime/test overhead; elapsed time starts immediately before inventory. This is a measurement, not an assertion, and does not establish the separate multi-million-event target.

```powershell
$env:VITEST_MAX_WORKERS='2'
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts -t 'inventories and applies 50 loops' --silent=false
```

This run passed. Its emitted record was:

```json
{
  "loops": 50,
  "versions": 500,
  "runs": 500,
  "events": 50000,
  "elapsedMs": 80562,
  "peakRssMiB": 327.1
}
```

## Decisions and review points

- Readiness requires the exact recorded ledger prefix through the latest structural migration. A trailing data-only migration (currently 0011) remains eligible for ordinary startup migration. This preserves the existing Fable migration test and owner-switch behavior; no dates or structural migration numbers are hard-coded in admission.
- `DatabaseHandle.migrate(readiness?)` accepts the result of a prior guard only for a caller holding the exclusive data-directory lock. Normal callers that omit it still receive full readiness validation. The existing-store container regression proves strict definition parsing occurs once.
- `DatabaseUpgradeInventory.tables` became `tableCounts`; the CLI's emitted inventory/manifest shape is unchanged. Later cutover code should use batched storage reads rather than depend on a raw whole-store snapshot.
- The bounded scope deliberately retains definitions and smaller webhook/default provenance sets, and the existing domain converter still materializes one run's history. It does not claim the debt register's much larger multi-million-event target, a bound on a single huge run, or streaming audit export.
- The baseline records logical equivalents of the shipped inline JSON checks with stable Drizzle check names. Exact existing expression-index DDL remains in shipped SQL, including the existing Drizzle Kit expression-index rendering limitation.
- Full infrastructure tests must be rerun outside the sandbox for native process termination. No coverage thresholds or exclusions changed.

## Documentation and changelog

The architecture README now describes the descriptor, single startup preflight, atomic fresh initialization, incremental canonical hashes, batched archive/apply and the 0011 baseline. Docs 10 lists `pnpm check:migrations` as a gate and explains temporary generation and drift testing.

CHANGELOG, Unreleased: "Internal: centralized the current format (still 3), checked declarative storage readiness once per startup, batched offline history inventory/apply with canonical incremental hashes, and restored the Drizzle snapshot baseline with a no-op generation gate. (#164, step 04)"
