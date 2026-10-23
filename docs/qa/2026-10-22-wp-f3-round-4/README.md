# WP-F3 / #243 implementer round 4

## 1. Branch and worktree

Branch `codex-wp-f3-unlimited-mode`; worktree `.claude/worktrees/codex-wp-f3-unlimited-mode`.
HEAD `1192929aff36b62b696510b94e5b874d21269b62`; MERGE_HEAD `a78e12a3713bc73cf440de7ea2058b4324709e76`.
Worktree files are resolved; Git's unmerged index entries intentionally remain for the orchestrator to stage. No commit, staging, merge, reset, branch switch or publication was performed. Uncommitted; ready for orchestrator review and commit.

## 2. Per bolt

#243: all twenty remaining conflict-marked paths resolved, preserving main F1/F4/G2/D2 behavior and F3 limits. Exact ranges and invariants are in [resolutions](resolutions.md) and [machine-readable ranges](changed-line-ranges.json). Additional test-fixture changes are explicitly included there.

The migration is now 0017_run_execution_limits. The [chain check](migration-chain.json) verifies unchanged SQL, main's journal prefix and 0015/0016 artifacts, and a data-only snapshot with prevId `f2fb7481-7a6b-4aef-9166-34ae803fb00c`. The [Drizzle gate](check-migrations.log.txt) reports a no-op.

The [public-component disk proof](migration-proof.mjs), [final capture](migration-proof-final.log.txt), and [results](migration-proof-results.json) passed five checks: main SQL through 0016 gives 17 ledger entries; candidate startup applies 0017 for 18; omitted pins become 10/null; explicit 4/5 and null/null survive in the run, queued event and both saved admission pins; reopen is idempotent; a fresh database applies all 18 migrations. This uses actual main SQL and public SQLite components, not an archived main application build. The older replay kit retains its historical migration numbering and counts on its stated heads; this round's migration proof is the current 0016/0017 replay.

## 3. Files changed

The [resolution table](resolutions.md) lists every conflict and additional production/test/doc edit by package. Main-identical resolutions retain their full main content. The limits SQL is renamed, not changed. Generated node/API references and client artifacts were regenerated from the merged source.

Only this directory contains new round-4 evidence. [Baseline](baseline.json), [resolution procedure record](resolution-plan.json), and [closing boundary](boundary.json) distinguish this work from the orchestrator's already-staged mechanical merge resolutions. The index and protected C6 test are verified unchanged at the closing boundary.

## 4. Tests and coverage

The final focused engine run passed **111 tests** across three files; the two new public-port cases prove accepted transport work is never resent and unconfirmed cleanup prevents retry. The shared ranked-evidence matrix passed **872 tests**. [Focused capture](engine-focused-final.log.txt), [matrix capture](evidence-matrix.log.txt).

The initial infrastructure gate failed **9 / 767** (758 passed): eight D-015 native termination/readiness-stop/locked-cleanup cases and one separate history-index fixture failure. Before correction, the fixture failed with `DatabaseUpgradeRequiredError: Stored indexes are incomplete: runs`. It incorrectly removed only the newest ledger row after 0017 was appended. It now identifies its own index migration and rewinds from that timestamp; the focused regression passed **16 tests**. [Original failures](infrastructure-initial-failures.json), [original capture](coverage-infrastructure.log.txt), [regression capture](history-index-regression.log.txt). No original failure is converted into a pass.

| Package        | Result/counts                        | Lines                | Branches             |
| -------------- | ------------------------------------ | -------------------- | -------------------- |
| infrastructure | FAIL; 8 failed / 759 passed (767)    | 98.73% ( 2191/2219 ) | 95.1% ( 1786/1878 )  |
| engine         | PASS; 1581 passed (1581)             | 98.06% ( 2530/2580 ) | 93.07% ( 2137/2296 ) |
| api            | PASS; 1314 passed / 6 skipped (1320) | 98.05% ( 1816/1852 ) | 93.3% ( 1296/1389 )  |
| web            | PASS; 1590 passed (1590)             | 98.91% ( 7197/7276 ) | 94.9% ( 7483/7885 )  |
| contracts      | PASS; 266 passed (266)               | 99.74% ( 385/386 )   | 95% ( 190/200 )      |
| api-client     | PASS; 72 passed (72)                 | 100% ( 246/246 )     | 99.37% ( 160/161 )   |

Any final infrastructure run with reportOnFailure retains FAIL as the gate outcome even when it emits coverage. No thresholds or exclusions were changed. No before/after failure claim is made for the two added retry negatives; the history-index regression did fail before its fixture correction.

## 5. Gates

Node **22.14.0**, PowerShell, pnpm.cmd. The frozen/prefer-offline install failed with ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK (access denied); existing dependencies were present and the subsequent gates used them. It was not retried with another store or checkout link. An initial direct script invocation was refused because the script was unsigned, before pnpm ran; the retained helper was interpreted in PowerShell without changing execution policy.

| Capture                                                                                                                                                                | Exact command                                                                                                                                    | Exit | Result |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ |
| [install.log.txt](install.log.txt); [install-result.json](install-result.json)                                                                                         | `pnpm.cmd install --frozen-lockfile --prefer-offline`                                                                                            | 1    | FAIL   |
| [docs-generate.log.txt](docs-generate.log.txt); [docs-generate-result.json](docs-generate-result.json)                                                                 | `pnpm.cmd docs:generate`                                                                                                                         | 0    | PASS   |
| [client-generate.log.txt](client-generate.log.txt); [client-generate-result.json](client-generate-result.json)                                                         | `pnpm.cmd --filter @graphgoblin/api-client generate`                                                                                             | 0    | PASS   |
| [engine-focused.log.txt](engine-focused.log.txt); [engine-focused-result.json](engine-focused-result.json)                                                             | `pnpm.cmd --filter @graphgoblin/engine exec vitest run src/unlimited.test.ts src/handlers/claude.test.ts src/handlers/inference-failure.test.ts` | 0    | PASS   |
| [typecheck.log.txt](typecheck.log.txt); [typecheck-result.json](typecheck-result.json)                                                                                 | `pnpm.cmd typecheck`                                                                                                                             | 0    | PASS   |
| [lint.log.txt](lint.log.txt); [lint-result.json](lint-result.json)                                                                                                     | `pnpm.cmd lint`                                                                                                                                  | 0    | PASS   |
| [format.log.txt](format.log.txt); [format-result.json](format-result.json)                                                                                             | `pnpm.cmd format`                                                                                                                                | 0    | PASS   |
| [engine-focused-final.log.txt](engine-focused-final.log.txt); [engine-focused-final-result.json](engine-focused-final-result.json)                                     | `pnpm.cmd --filter @graphgoblin/engine exec vitest run src/unlimited.test.ts src/handlers/claude.test.ts src/handlers/inference-failure.test.ts` | 0    | PASS   |
| [docs-generate-final.log.txt](docs-generate-final.log.txt); [docs-generate-final-result.json](docs-generate-final-result.json)                                         | `pnpm.cmd docs:generate`                                                                                                                         | 0    | PASS   |
| [typecheck-final.log.txt](typecheck-final.log.txt); [typecheck-final-result.json](typecheck-final-result.json)                                                         | `pnpm.cmd typecheck`                                                                                                                             | 0    | PASS   |
| [lint-final.log.txt](lint-final.log.txt); [lint-final-result.json](lint-final-result.json)                                                                             | `pnpm.cmd lint`                                                                                                                                  | 0    | PASS   |
| [check-docs.log.txt](check-docs.log.txt); [check-docs-result.json](check-docs-result.json)                                                                             | `pnpm.cmd check:docs`                                                                                                                            | 0    | PASS   |
| [build.log.txt](build.log.txt); [build-result.json](build-result.json)                                                                                                 | `pnpm.cmd build`                                                                                                                                 | 0    | PASS   |
| [check-migrations.log.txt](check-migrations.log.txt); [check-migrations-result.json](check-migrations-result.json)                                                     | `pnpm.cmd check:migrations`                                                                                                                      | 0    | PASS   |
| [migration-proof.log.txt](migration-proof.log.txt); [migration-proof-result.json](migration-proof-result.json)                                                         | `pnpm.cmd exec node docs/qa/2026-10-22-wp-f3-round-4/migration-proof.mjs`                                                                        | 1    | FAIL   |
| [coverage-infrastructure.log.txt](coverage-infrastructure.log.txt); [coverage-infrastructure-result.json](coverage-infrastructure-result.json)                         | `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1`                                                                     | 1    | FAIL   |
| [evidence-matrix.log.txt](evidence-matrix.log.txt); [evidence-matrix-result.json](evidence-matrix-result.json)                                                         | `pnpm.cmd --filter @graphgoblin/engine exec vitest run src/handlers/inference-evidence-matrix.test.ts`                                           | 0    | PASS   |
| [migration-proof-fixed.log.txt](migration-proof-fixed.log.txt); [migration-proof-fixed-result.json](migration-proof-fixed-result.json)                                 | `pnpm.cmd exec node docs/qa/2026-10-22-wp-f3-round-4/migration-proof.mjs`                                                                        | 1    | FAIL   |
| [migration-proof-final.log.txt](migration-proof-final.log.txt); [migration-proof-final-result.json](migration-proof-final-result.json)                                 | `pnpm.cmd exec node docs/qa/2026-10-22-wp-f3-round-4/migration-proof.mjs`                                                                        | 0    | PASS   |
| [history-index-regression.log.txt](history-index-regression.log.txt); [history-index-regression-result.json](history-index-regression-result.json)                     | `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/history-summaries.test.ts --maxWorkers=1`                              | 0    | PASS   |
| [coverage-engine.log.txt](coverage-engine.log.txt); [coverage-engine-result.json](coverage-engine-result.json)                                                         | `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                                                            | 0    | PASS   |
| [coverage-api.log.txt](coverage-api.log.txt); [coverage-api-result.json](coverage-api-result.json)                                                                     | `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                                                               | 0    | PASS   |
| [coverage-web.log.txt](coverage-web.log.txt); [coverage-web-result.json](coverage-web-result.json)                                                                     | `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`                                                                                | 0    | PASS   |
| [coverage-contracts.log.txt](coverage-contracts.log.txt); [coverage-contracts-result.json](coverage-contracts-result.json)                                             | `pnpm.cmd --filter @graphgoblin/contracts test:coverage`                                                                                         | 0    | PASS   |
| [coverage-api-client.log.txt](coverage-api-client.log.txt); [coverage-api-client-result.json](coverage-api-client-result.json)                                         | `pnpm.cmd --filter @graphgoblin/api-client test:coverage`                                                                                        | 0    | PASS   |
| [check-layers.log.txt](check-layers.log.txt); [check-layers-result.json](check-layers-result.json)                                                                     | `pnpm.cmd check:layers`                                                                                                                          | 0    | PASS   |
| [check-deps.log.txt](check-deps.log.txt); [check-deps-result.json](check-deps-result.json)                                                                             | `pnpm.cmd check:deps`                                                                                                                            | 0    | PASS   |
| [check-tokens.log.txt](check-tokens.log.txt); [check-tokens-result.json](check-tokens-result.json)                                                                     | `pnpm.cmd check:tokens`                                                                                                                          | 0    | PASS   |
| [coverage-infrastructure-final.log.txt](coverage-infrastructure-final.log.txt); [coverage-infrastructure-final-result.json](coverage-infrastructure-final-result.json) | `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1 --coverage.reportOnFailure`                                          | 1    | FAIL   |
| [typecheck-integrated.log.txt](typecheck-integrated.log.txt); [typecheck-integrated-result.json](typecheck-integrated-result.json)                                     | `pnpm.cmd typecheck`                                                                                                                             | 0    | PASS   |
| [lint-integrated.log.txt](lint-integrated.log.txt); [lint-integrated-result.json](lint-integrated-result.json)                                                         | `pnpm.cmd lint`                                                                                                                                  | 0    | PASS   |
| [format-final.log.txt](format-final.log.txt); [format-final-result.json](format-final-result.json)                                                                     | `pnpm.cmd format`                                                                                                                                | 0    | PASS   |

The first formatter changed exactly the [four recorded files](format-changed-files.json). The closing formatter's exact result and further changed files are retained in [closing format result](format-final-result.json), [closing format log](format-final.log.txt), and [closing formatting changes](format-final-changed-files.json).

The carried-record checker output is quoted verbatim:

> docs\qa\2026-10-22-wp-f3-qa: 87 files, 587 citations, 0 recorded as not kept, 0 missing

[Carried checker capture](carried-checker.log.txt); [all twelve tracked/readable carried text logs](carried-logs.json). The supplied checker over this new directory is run last and quoted in the final handoff; it does not rerun historical observations.

## 6. Docs

Numbered doc 05 retains nullable visits/passes, pinned values, no default deadline and absolute authored deadlines; main's ranked failure/persistence documentation is retained. Numbered doc 07 now explicitly describes the same API pins, queue exclusion, deadline child cancellation and the distinction from client/MCP observation deadlines. The #243 CHANGELOG upgrade bullet now names SQL 0017 and still states no existing run or loop gains a deadline. Doc 06, the run guide, generated references and generated client retain both sides' contracts. ADR-0047's no-default decision is unchanged.

## 7. Decisions and parameters

The data-only snapshot is copied from 0016 with a new id and correctly chained prevId; no physical schema change is invented. The one retry consults F4's existing ranked evidence, never weakens acceptance, refuses after recording faults, cancels before retry, and establishes the exact uninvoked intent before its fallible append. Transport/output codes remain typed. No new cutoff, cost, usage, token or provider-turn parameter was added.

Captured text is sanitized; captures above 1,000,000 bytes are omitted under D-034 with name/size/SHA-256 in [NOT-KEPT](NOT-KEPT.md). Raw QA scripts/results are excluded from repository formatting by main's existing ignore rules.

## 8. Caveats and open items

The install failure remains a failure. D-015 failures remain host-qualified failures, not passes. The history-index failure was a distinct corrected fixture issue. The Linux subloop-restart C6 race remains outside this round, unchanged and owner-gated in PR #375; a Windows gate cannot close that Linux blocker. Fable review, orchestrator staging/merge commit and audit round 2 of 3 remain pending.

The first conflict-marker replacement pass was discarded after a file-length check; affected files were reconstructed from main and F3's original semantic hunks were reapplied before the passing checks. The merge index was never modified.

Two migration-proof fixture attempts failed and are retained in [first failure](migration-proof.log.txt), [second failure](migration-proof-fixed.log.txt), and [preserved fixture error](migration-proof-fixture-error.json). The corrected proof authors the historical definition before publication, respecting immutable snapshots. Windows native handles required database-file cleanup after the proof process exited; [parent cleanup](cleanup-proof.ps1) and [cleanup result](migration-cleanup.json) verify zero database files remain. Three empty SQL fixture directories and their empty meta children are preserved because this thread must not delete directories. Native failed-test directories named in the infrastructure captures are inventoried separately in [native fixture inventory](native-failure-directories.json); none was deleted. No owner app/store or paid provider turn was used; this proof started no listener.

Complete retained capture metadata and hashes are in [manifest](manifest.json). All failures, including setup/fixture failures, remain visible in the gate table and captures.
