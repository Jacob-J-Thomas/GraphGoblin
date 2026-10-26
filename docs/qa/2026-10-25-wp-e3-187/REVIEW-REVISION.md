# WP-E3 phase 1: orchestrator-review revision (#187)

## 1. Branch and worktree

Branch `codex-wp-e3-187-322`; worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-e3-187-322`; unchanged HEAD/base `a5a600bff5d1ef7982919970011633b401c21135`. All implementation remains uncommitted. No index actions, commits, publication, branch changes or sub-agents. This report supersedes the [initial handoff](REPORT.md) for current behavior and affected verification.

COMMON.md was reread. Every pnpm command used its override:

```text
node --version: v22.23.4
(Get-Command node).Source:
%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe
```

API coverage uses `GG_TEST_PORT_START=5600 GG_TEST_PORT_COUNT=100`; other tests use `5650/300`. Edge main/control used 5948/5949 with `msedge`, `--retries=0 --workers=1`. New real disposable data uses system-temp `gg-wp-e3-` directories. No owner ports 4747/4748, home data or main-checkout source was used.

## 2. Per bolt and review requirement

| Requirement                                               | Result and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #187: remove execution-path whole-history revocation scan | Migration 0021 records indexed replay sources. Admission writes the source with the initial thread; one-time migration backfills existing history. Traversal joins run ID, parent and replay-source indexes directly. An unapproved row's event append checks only its own prior approval; unrelated approvals cause no recursive traversal or JSON parsing.                                                                                                                                  |
| Bound the append work with approvals elsewhere            | Actual SQLite VM instruction counts for the event writer's sequence UPDATE: **100 rows: 1,322 before, 80 after; 10,000 rows: 110,222 before, 80 after**. Reproducible script and bound described below.                                                                                                                                                                                                                                                                                       |
| Preserve consent/protection and lifecycle guarantees      | Public SQLite repository/event-store tests cover complete-component selection and withdrawal, stale/ABA tokens, Resume of an approved component member, child/replay admission, old/new relationship revocation, migration backfill, event/finalization changes, and no-op/unrelated metadata changes. Real API persistence, atomic rollback and retained-artifact tests remain.                                                                                                              |
| Restore ADR-0033 loop deletion                            | Production `loops.ts`, API loop routes and storage loop-deletion tests are identical to HEAD. API loop-deletion/webhook tests restore the original assertions; only disposable-prefix changes remain in those two files. No `LOOP_HISTORY_REQUIRED`, finalization guard, retained-relative refusal or changed `LoopInUseError` wording remains. Added API regression verifies deleting an unfinalized terminal parent keeps the other loop's child history and clears its parent association. |
| #187: browser consent remains specific                    | Edge: 3/3 passed. Confirmation, cancellation, persisted approval after reload, withdrawal, frozen bulk selection with later history, protected/stale/invalid refusal remain verified.                                                                                                                                                                                                                                                                                                         |
| #322                                                      | Not started. No capacity policy, cleanup, pressure warning, resource deletion or compaction was implemented. Stop again for orchestrator review.                                                                                                                                                                                                                                                                                                                                              |

These results do not constitute independent review, owner product sign-off or integrated #304/#287 acceptance.

## 3. Files changed

The initial handoff lists the full phase-1 manifest. Review changes are concentrated in:

- **Storage:** `packages/infrastructure/drizzle/0021_run_deletion_eligibility.sql`, its `meta/0021_snapshot.json`, `src/sqlite/schema.ts`, `runs.ts`, `run-row.ts`, `deletion-eligibility.ts`, `deletion-eligibility.test.ts`; historical migration fixture rewinds in `catalog.test.ts`, `delivery-runs.test.ts`, `history-summaries.test.ts`, `webhook-receipt-upgrade.test.ts`.
- **Loop restoration/API:** restored production `packages/infrastructure/src/sqlite/loops.ts` and `apps/api/src/routes/loops.ts`, restored storage loop-deletion tests, restored original API/adversarial/webhook expectations, removed finalization additions in `definition-pins.test.ts`; extended `apps/api/src/deletion-eligibility.test.ts` with separate-consent regression. Restored files with no remaining diff will not appear in the orchestrator's commit.
- **Docs/generated:** CHANGELOG, docs/03, docs/05, docs/07, guide/03, ADR-0060, regenerated `docs/reference/api.md`, `packages/api-client/openapi.json`, `src/generated/schema.ts`; this report and `measure-append.py`. docs/09's phase-1 browser documentation remains accurate and unchanged by this revision.

Shared edits remain additive: contracts `src/run.ts`'s optional approval field, the API-client generated files, and web `src/runs/RunsPage.tsx` / `RunInspectorPage.tsx`'s selection and approval UI. `apps/api/src/routes/runs.ts` is untouched. This revision adds no new edits to those shared UI/contract regions. Regenerate the client again after integrating #256. No reformatting of unrelated shared regions. Migration 0021 remains unshipped; no 0022 or 0023 was added, and ADR-0061 is untouched.

## 4. Tests and measurements

Focused storage command:

```text
pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/deletion-eligibility.test.ts src/sqlite/loop-deletion.test.ts src/sqlite/catalog.test.ts src/sqlite/definition-pins.test.ts src/sqlite/delivery-runs.test.ts src/sqlite/webhook-receipt-upgrade.test.ts src/sqlite/history-summaries.test.ts --maxWorkers=2
```

**122/122 passed, 7 files.** Eligibility has 16 cases, including four added regression cases. The initial revised run exposed incomplete historical rewind fixtures; those were corrected before the final run. An editing-script encoding mistake in an astral-character fixture was also corrected from the unchanged UTF-8 source. Test expectations and coverage thresholds were not weakened.

Measurement:

```text
python docs/qa/2026-10-25-wp-e3-187/measure-append.py --assert-bounded --measure-resume
{"sqlite": "3.39.4", "vm_steps": {"100": 80, "10000": 80}}
{"resume_vm_steps": {"100": 297, "10000": 297}}
```

The script creates disposable real SQLite databases under system temp, applies every shipped SQL migration, seeds unrelated history and an approval, warms the statement and counts executed VM instructions through the public `sqlite3.set_progress_handler(..., 1)`. It measures precisely `UPDATE runs SET last_event_seq=? WHERE id=?`, the event store's hot write, excluding preparation and transaction setup. It asserts equal instruction counts at 100 and 10,000 rows and an absolute bound of 200. Before the correction, the same measurement returned 1,322 and 110,222. This is an instruction-work bound using CPython's SQLite 3.39.4, not a latency or page-I/O claim about production libsql. A separate test calls the real `SqliteEventStore.append` 20 times on an unapproved child and proves unrelated approval and preview-token stability.

The optional Resume measurement marks every unrelated component too, then resumes one isolated approved run: **297 VM instructions at both 100 and 10,000 rows**, asserting equality and at most 1,000. This also checks that revocation itself does not walk unrelated approved history.

| Current affected coverage run | Lines  | Branches | Test result                                                           |
| ----------------------------- | ------ | -------- | --------------------------------------------------------------------- |
| `@graphgoblin/infrastructure` | 98.68% | 95.14%   | 828 passed, 6 failed; unchanged native process/readiness cases below. |
| `@graphgoblin/api-client`     | 100%   | 98.42%   | 97 passed.                                                            |
| `@graphgoblin/api`            | 97.36% | 92.44%   | 1,476 passed, 11 skipped; 89 files passed, 2 skipped.                 |

Exact commands: `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=2 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-review-infra-coverage`; `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=4 --coverage.reportOnFailure --coverage.reportsDirectory=%USERPROFILE%/AppData/Local/Temp/gg-wp-e3-review-api-coverage`; client uses `pnpm.cmd --filter @graphgoblin/api-client test:coverage`. API and infrastructure coverage outputs are separate disposable locations. Thresholds remain unchanged and exceed 90% lines/branches in completed affected runs.

Unchanged phase-1 packages were not rerun for this storage/API revision: the initial report retains contracts 99.74%/95%, engine 97.48%/91.43% (one existing checkpoint timing failure), MCP 96.69%/95.19%, and web 98.67%/94.57% (one existing detached-element test failure). These are explicitly historical results, not new passes. Root build/typecheck/lint still cover every package.

After full API coverage, both test-helper scratch directories were also given the required `gg-wp-e3-` prefix (the actual file-backed database already used it). The final `pnpm.cmd --filter @graphgoblin/api exec vitest run src/deletion-eligibility.test.ts --maxWorkers=1` passed **9/9**. No production code changed after coverage. Final owned-file Prettier checking passes; final root formatting still flags only the untouched WP-D1 QA file.

Raw local logs are `review-*.log` in this QA folder (ignored by Git). They preserve nonzero results. No retry-to-green was used for native failures.

## 5. Gates

All gates use `pnpm.cmd` and the runtime above. `pnpm.cmd --filter @graphgoblin/api-client generate` and `pnpm.cmd docs:generate` completed before checking generated outputs.

| Exact root command          | Current result                                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`            | PASS, 11 tasks.                                                                                                                                                                                 |
| `pnpm.cmd typecheck`        | PASS, 20 tasks.                                                                                                                                                                                 |
| `pnpm.cmd lint`             | PASS, 11 tasks.                                                                                                                                                                                 |
| `pnpm.cmd format:check`     | FAIL, only unchanged `docs/qa/2026-10-25-wp-d1-integration/README.md`; left untouched per instruction. All owned files, including this report, are formatted; the WP-D1 file remains untouched. |
| `pnpm.cmd check:layers`     | PASS.                                                                                                                                                                                           |
| `pnpm.cmd check:deps`       | PASS.                                                                                                                                                                                           |
| `pnpm.cmd check:migrations` | PASS; Drizzle generation is a no-op.                                                                                                                                                            |
| `pnpm.cmd check:docs`       | PASS; generated docs current.                                                                                                                                                                   |
| `pnpm.cmd check:tokens`     | PASS.                                                                                                                                                                                           |

`git diff --check` passes. Some PowerShell logs wrap native stderr (including pnpm's normal `$ ...` lines) as `NativeCommandError`; the table uses process exit codes and final tool summaries, not the presence of that wrapper. Build/typecheck/lint also emitted cache I/O access warnings while their task results passed.

## 6. Documentation

ADR-0060 now documents indexed replay provenance, complete-component revocation, its per-row event guard and measurement limits. It explicitly states that loop deletion is separate explicit consent with its own confirmation and leaves ADR-0033 unchanged. Domain, engine, API and user-guide descriptions agree. The #187 CHANGELOG bullet retains its **Upgrade:** migration 0021/client-regeneration note and ends `(#187)`. No #322 delivery bullet is claimed before phase 2. The initial report is clearly marked historical and superseded.

## 7. Decisions, protection and parameters

| Condition/event                                                | Protection or eligibility lifecycle                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Newly created history                                          | Retained; never inherits approval.                                                                                                            |
| Active/paused or incomplete terminal finalization              | Cannot be marked.                                                                                                                             |
| Parent/child and replay-source/fork dependency component       | Select every member together or require existing approval; missing/foreign dependencies refuse marking. No protected row is silently omitted. |
| Finalized success/failure/cancelled/exhausted                  | Identical specific-confirmation rule.                                                                                                         |
| Approved component member resumes or approved evidence changes | Revoke affected approvals in the same transaction; later completion does not restore consent.                                                 |
| New child/replay or changed relationship involving approval    | Indexed direct-record probes gate indexed traversal; revoke former and newly connected components.                                            |
| Ordinary append on an unapproved run/component                 | No relationship traversal or thread parsing, regardless of approvals elsewhere.                                                               |
| Explicit withdrawal                                            | Selected records and their related component become retained.                                                                                 |
| Cancelled/invalid/stale/protected confirmation                 | No partial approval or implicit future-history consent.                                                                                       |
| Artifacts required by retained history                         | Protected; phase 1 removes no references or bytes.                                                                                            |
| Explicit loop deletion                                         | Separate history consent; ADR-0033 active/admission/pin guards and cross-loop behavior unchanged.                                             |

The 500-ID explicit-selection bound and SHA-256 state/revision freshness scheme are unchanged engineering choices. There is no age-based eligibility or broad future-history preference. The 200-instruction measurement bound is a regression guard, not a storage-policy threshold.

Capacity port, pressure thresholds and their justification remain phase-2 work. What the new service deletes: nothing. Existing explicit loop deletion removes its loop-scoped database history/dependent rows by run identity, retaining other loops and shared artifact files; it does not delete workspaces or artifact bytes. Demonstrable filesystem ownership remains a requirement for phase 2.

Interruption: eligibility and revision changes remain one SQLite transaction; real fault injection verifies rollback. There is no automatic cleanup to interrupt in phase 1, and no cleanup-recovery or reclaimed-space claim.

## 8. Caveats and observed outside scope

Stop after this revision for orchestrator review/commit. Phase 2 remains pending explicit resumption. No new owner judgment is needed for these two requested corrections.

The unfinalized terminal case is not claimed as a new data-loss defect: loop deletion already explicitly confirms losing that loop's history. The restored real webhook lifecycle tests reproduce the existing behavior by holding a response in flight or during backoff, deleting the terminal loop (204), releasing the response, and verifying the run is absent with no orphan events. This stays within ADR-0033; this work adds no finalization guard.

The initial handoff's full engine/web/native failures remain historical evidence unless explicitly replaced by the current runs above. Root formatting's WP-D1 QA file must be left untouched as the orchestrator requested. Current infrastructure coverage reproduces the same six unchanged native failures: `src/adversarial.test.ts` child/grandchild abort (EBUSY cleanup), three `src/claude/process.test.ts` cases (EBUSY/descendant remains live), `src/claude/readiness.test.ts` hang classification, and `src/process/scripts.test.ts:203` cancellation still observing a live PID. Their production implementations and tests were not modified. These are unresolved failures, not passing acceptance; no retry was used to replace them with a green result. Disposable failure evidence is left for orchestrator disposition. Existing production-method spies in older loop/adversarial tests remain outside this change, as recorded in the initial report.
