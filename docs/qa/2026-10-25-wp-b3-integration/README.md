# WP-B3 integration verification, 2026-10-25

## 1. Branch and worktree

- Branch: `wp-b3-integrate`.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-b3-integrate`.
- PR #355 head/base of this work: `32568edd3756207d7790bf771b5bd7e7746c2303`.
- Merge parent: `642da39194dc052dc58da7298bf099a14e5356a2` (`origin/main`).
- Common ancestor: `dbf850861329be21410407e8282fa80373caf593`.
- Uncommitted; ready for orchestrator commit after review of the verification caveats below. No index, commit, branch, remote or owner-instance mutation was performed. Git continues to report unmerged index entries until the orchestrator stages the resolved working tree.
- Worked alone. No edits under `apps/api/src/reset/`. The separately assigned reset fixes are not part of this result.

## 2. Per bolt

| Bolt / acceptance criterion                                                                                                                                                     | Evidence in this integration                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #266: Empty/current stores initialize or reopen reliably; unsupported stores/imports/device drafts refuse clearly.                                                              | `test:upgrade`: fresh startup, genuine pre-0015 current-format fixture startup, data-preserving migration and restart at head; marked format-3 and unmarked startup exit 1 with found/required format and reset guidance. SQLite store guard, fresh-initialization, API format refusal and import tests retained. Edge `device-draft-format.spec.ts` refuses unsupported, missing-definition and null drafts without saving or discarding them implicitly. |
| #266: Explicit reset names its target and removes only relevant app data/draft state; unrelated repositories and harness installs remain untouched.                             | Existing `test:reset` acceptance passed against disposable storage: dry-run/refused confirmation preserves bytes; explicit reset stays within its manifest and starts fresh afterward. Browser explicit discard is scoped to one local copy. Existing reset unit suite is included in API coverage. No owner data or installed harness was used.                                                                                                           |
| #266: Explicit bounded manifest and clear refusal; no silent wipe or standing cutover permission.                                                                               | Reset acceptance and existing reset tests retained; runtime unsupported-store test asserts exit 1, “No stored data was changed” and `--reset --data-dir` guidance. ADR-0042 remains the governing decision.                                                                                                                                                                                                                                                |
| #188: Retired converters, frozen historical shapes and upgrade-only tests have no surviving current-format consumers; current examples, initialization and recovery still pass. | Source/dependency inventory, build, typecheck and layer/dependency gates; current fixtures and tests preserved. The receipt rewrite's accidental dependency on the deleted full V3 schema and scanner was replaced by a narrow current-format migration input schema and the shared bounded scanner.                                                                                                                                                       |
| #188: Retire obsolete converters and upgrade-only fixtures/CI while retaining corruption, timer, identity and initialization protection; historical evidence stays historical.  | All five delete/modify conflict files are absent. Full retirement inventory below. Main's current migrations, ledger, corruption/fresh-initialization tests, pinned-run restart and CI jobs survive. `test:upgrade` now covers only ordinary current-format migration. Historical QA evidence remains untouched and current docs identify old conversion descriptions as historical.                                                                       |

These are integration results, not issue closure or owner product acceptance. Coverage limitations and remaining review work are recorded in sections 4 and 8.

## 3. Files changed

This is a merge of a large main delta, including its existing QA artifacts. The table covers all 20 conflicts named in the brief and the orchestrator's already resolved `package.json` conflict. “Both” means #355's format-retirement/refusal policy plus main's applicable current-format behavior.

| Conflicted file                                                           | Resolution                                                                                                                                                    | Side(s) kept                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `.github/workflows/ci.yml`                                                | Preserve every main job/step, including Browser and Template image; reset acceptance follows Build; retain upgrade acceptance with current-format scope/name. | Both                                             |
| `CHANGELOG.md`                                                            | Union every bullet; #355's #266/#188 bullets lead Unreleased; explain retained current-format `test:upgrade`.                                                 | Both                                             |
| `apps/api/src/pinned-run-restart.test.ts`                                 | Preserve current pinned-run restart; remove old-format conversion seeds/scenarios.                                                                            | Both; obsolete main conversion scenarios retired |
| `apps/api/src/routes/loops.ts`                                            | Strict current import/refusal; retain main readiness behavior and its no-probe draft-import call.                                                             | Both                                             |
| `apps/web/e2e/drafts.spec.ts`                                             | Keep main reload/two-tab/storage-connection coverage; remove obsolete conversion scenarios.                                                                   | Both                                             |
| `apps/web/src/editor/EditorPage.restore.test.tsx`                         | Keep current/unsupported draft restoration; remove converter-loader imports and conversion-only cases.                                                        | Both                                             |
| `docs/05-execution-engine.md`                                             | Retired-conversion explanation plus main limits, Event admission, structured deadlines and subsequent recovery sections.                                      | Both                                             |
| `docs/10-testing-and-quality.md`                                          | Retain current fixtures and all main CI descriptions; document reset and current-format migration gates separately.                                           | Both                                             |
| `docs/decisions/README.md`                                                | Union ADR-0042, ADR-0043 and all later main entries.                                                                                                          | Both                                             |
| `package.json`                                                            | Union scripts; retain main gates/acceptance and #355 reset; `test:upgrade` invokes the replacement current-only acceptance suite.                             | Both                                             |
| `packages/domain/src/__snapshots__/upgrade-composed.test.ts.snap`         | Delete from working tree.                                                                                                                                     | #355 deletion                                    |
| `packages/domain/src/convert-v3-v4/__snapshots__/conversion.test.ts.snap` | Delete from working tree.                                                                                                                                     | #355 deletion                                    |
| `packages/domain/src/convert-v3-v4/index.ts`                              | Delete; main #243/#270 converter synchronization has no retained consumer.                                                                                    | #355 deletion                                    |
| `packages/domain/src/index.ts`                                            | Retain main readiness export; remove all converter exports.                                                                                                   | Both                                             |
| `packages/infrastructure/src/sqlite/catalog.test.ts`                      | Current-format refusal plus main dynamic shipped-migration counts.                                                                                            | Both                                             |
| `packages/infrastructure/src/sqlite/classifiers.test.ts`                  | Current-format refusal plus main dynamic shipped-migration counts.                                                                                            | Both                                             |
| `packages/infrastructure/src/sqlite/db.ts`                                | Guard first, then atomic fresh initialization or current migration through `store-format.ts`.                                                                 | Both                                             |
| `packages/infrastructure/src/sqlite/fresh-initialization.test.ts`         | Retain main concurrent initializer pending-migration regression and one-time race injection; adapt entry point.                                               | Both                                             |
| `packages/infrastructure/src/sqlite/storage.test.ts`                      | Current-format refusal plus main dynamic shipped-migration counts.                                                                                            | Both                                             |
| `packages/infrastructure/src/sqlite/upgrade.test.ts`                      | Delete retired format-conversion tests, including main's converter-only additions.                                                                            | #355 deletion                                    |
| `packages/infrastructure/src/sqlite/upgrade.ts`                           | Delete module after moving current-format functions into `store-format.ts`; retire only format conversion.                                                    | Both intentions; path deleted                    |

Current-format pieces preserved from `upgrade.ts`:

| Main piece                                               | Final home / behavior                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrateCurrentDatabase`                                 | `sqlite/store-format.ts`: `migrateCurrentStore`, one write transaction for pending ordinary SQL, one-off data rewrites, ledger inserts and head verification.                                                         |
| Structural migration runner                              | `sqlite/store-format.ts`: `structuralMigrations`, ordered shipped SQL and ledger timestamps/hashes.                                                                                                                   |
| `verifyDatabaseHead`                                     | `sqlite/store-format.ts`: `verifyStoreHead`, full current head/ledger check without reparsing definitions.                                                                                                            |
| Concurrent `initializeFreshDatabase` path                | `sqlite/store-format.ts`: `initializeFreshStore`; recheck under the write lock, migrate an initializer winner's remaining SQL under that same lock, verify and commit. Fresh schema, marker and ledger remain atomic. |
| `convertHistoricalWebhookReceipts` before migration 0015 | Remains in `sqlite/webhook-receipt-upgrade.ts`, invoked by `structuralMigrations` before 0015. Invalid evidence stays unchanged; valid completed webhook receipts receive current delivery evidence.                  |
| Bounded table scan needed by the current rewrite         | `sqlite/readiness.ts`: `tableBatches`; rowid pagination, batches of 500, scheduler yield and optional SQL filter. The retired `upgrade-scan` module is absent.                                                        |

Additional integration edits, grouped by package:

- Contracts: new `src/webhook-receipt-migration.ts` and root exports describe only the persisted input to ordinary current-format migration 0015; no old definition parser or export format was restored.
- Infrastructure: `store-format.ts`, `readiness.ts`, receipt rewrite and its tests remove dependencies on deleted conversion modules; `db.ts` uses the atomic current runner. Main's `openStoreBefore`/`storeLoopBefore`, migrations, indexes, data rewrites and ledger remain.
- Domain: root exports retain current readiness and omit conversion.
- Engine: retain #355's removal of two converter-backed webhook-admission cases and their frozen-schema imports; the remaining admission cases and all main engine implementations survive.
- API/web: conflict resolutions above retain main's surviving behavior and #355's clear refusal boundaries. No reset implementation changes.
- Tooling/root/CI: replacement `tooling/scripts/upgrade.acceptance.mjs`; root script union; remove only domain Turbo inputs for retired conversion tests' API-template fixtures. All main CI jobs and steps remain.
- Docs: current prose in docs 03, 05, 06, 10, 12, architecture README/debt register, settings guide, ADR index and CHANGELOG. Historical measurements were not rewritten.

Shared WAVE ownership touched by these integration edits: `.github/workflows/ci.yml` (WP-A1/A2/B3: preserve setup/runtime/cache and Browser; alter only reset/current-migration intent); `turbo.json`/root scripts (WP-A1: retire only converter fixture coupling/add scripts); `apps/web/e2e/drafts.spec.ts` and docs/10 (WP-A2: preserve two-tab and Browser behavior); docs/03 and docs/05 (WP-C1/G1/F3/F4: only merge/refusal wording, retain their sections); docs/06 and settings guide (WP-F2a/F3/F4: remove obsolete conversion guidance, retain harness/catalog/session content). No shared run-manager, SSE, process-kill, adapter, trigger or session implementation regions were edited.

Semantic breakages found beyond the textual conflicts:

1. Main receipt migration imported deleted `V3RunEventSchema` and `upgrade-scan`. Replaced those imports with the narrow migration schema and shared bounded scanner; preserved validation and rollback/ledger tests.
2. #355's opening path would have used ordinary Drizzle migrations without main's atomic receipt rewrite. Restored the combined runner and same-lock concurrent initialization path.
3. Removing the old acceptance script would remove current-format migration/startup protection. Replaced its conversion cases with current-only native acceptance and retained the root/CI gate.
4. Domain Turbo test inputs still referred to API templates solely for deleted conversion tests. Removed those obsolete task overrides.
5. Unconflicted docs still described converter stages, offline progress, repair/conversion and frozen exports as current. Corrected live guidance and marked the architecture/history material as historical. Historical QA logs and historical ADR evidence remain.
6. Generated API/client/reference files required reconciliation with the final routes. Regenerated using source generators; no manual conflict editing. Generated working-tree diff against the merged index is empty.

Retired paths relative to the supplied main parent are listed in [retired-files.txt](retired-files.txt). The inventory contains 70 paths; it includes the API test rename (`version-migration.test.ts` to the surviving current `pinned-run-restart.test.ts`) and frozen-contract tests. In addition, the old conversion contents of `upgrade.acceptance.mjs` were retired while keeping its path for the replacement current-format suite. The five conflicted deletion paths are physically absent.

## 4. Tests

Changed/new test scope:

- Current-format native acceptance: “fresh and earlier current-format stores start; ordinary migrations preserve data and receipts”; “format-3 and unmarked stores refuse startup with exit 1 and the reset guidance”. Passed 2/2.
- Focused SQLite: fresh initialization, guard/readiness, receipt rewrite, definition pins, catalog, classifiers and storage: 8 files, 143 tests passed. Includes “applies pending ordinary migrations when another initialiser wins the write-lock race”, original-error preservation, repeated starts, and atomic receipt/structure/ledger rollback.
- Receipt boundary table retains valid/invalid optional fields, Unicode bounds, NULs, URL preservation, damaged JSON/envelope and idempotence cases, now through `handle.migrate()` without the deleted full V3 contract.
- Current pinned run: “recovers a current-format pinned run across restart mid-run without migration”. Kept while retiring converter-specific API scenarios.
- Reset native acceptance passed 1/1. Existing reset unit tests are included in API coverage, without editing their source.
- Edge: `e2e/drafts.spec.ts` and `e2e/device-draft-format.spec.ts`, 6/6 passed, retries 0, workers 1, `GG_E2E_BROWSER_CHANNEL=msedge`, `LIVE=0`. Relevant browser-source search found no imports of retired converters; the intentional format-3 draft seed tests refusal.

Initial failures and recovery are retained in the evidence logs:

- Initial typecheck found the receipt rewrite importing removed V3/scanner modules. Those integration defects were fixed; final typecheck passed all 20 tasks.
- First coverage run: tooling child Git rejected the worktree as dubious ownership. Scoped `GIT_CONFIG_COUNT/KEY_0/VALUE_0` grants only this worktree for the test process; no global Git configuration was changed. Isolated dockerignore test passed 4/4, then tooling passed 87/87.
- Second coverage run: engine 8 files failed, 11 tests failed / 1,691 passed; timeout/fake-clock progress failures. Two-worker diagnosis passed 8 selected files / 102 tests.
- Two-worker coverage: engine 2 own-session cases failed / 1,700 passed, both “Test timed out in 5000ms” at `own-session.test.ts:184`. These cases execute 12 worker/reviewer passes. This justified a 30-second CLI test/hook budget for completing package coverage, without source or threshold changes. A native infrastructure process-tree assertion also failed before Turbo canceled that suite; retained in the log and checked in the completed run.

Coverage completion details and per-package values are in [verification-results.md](verification-results.md). No coverage threshold or exclusion was lowered. These are integration checks, not a claim that a separately introduced product regression was reproduced and fixed.

## 5. Gates

All commands used the project runtime first on PATH:

```text
node --version
v22.23.4
(Get-Command node).Source
%USERPROFILE%\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe
```

| Command                                                                                                                     | Result                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                                            | Passed, 11 tasks. Interrupted earlier build was rerun.                                                                                                                                         |
| `pnpm.cmd typecheck`                                                                                                        | Passed, 20 tasks, including a final rerun after generation.                                                                                                                                    |
| `pnpm.cmd lint`                                                                                                             | Passed, 11 tasks.                                                                                                                                                                              |
| `pnpm.cmd format:check`                                                                                                     | Passed after source formatting. A redundant later full scan was stopped after more than 18 minutes; only subsequently added Markdown is checked directly, as recorded in verification results. |
| `pnpm.cmd check:layers`                                                                                                     | Passed, including final rerun.                                                                                                                                                                 |
| `pnpm.cmd check:deps`                                                                                                       | Passed; interrupted earlier invocation rerun.                                                                                                                                                  |
| `pnpm.cmd check:migrations`                                                                                                 | Passed.                                                                                                                                                                                        |
| `pnpm.cmd check:docs`                                                                                                       | Passed after generation.                                                                                                                                                                       |
| `pnpm.cmd check:tokens`                                                                                                     | Passed.                                                                                                                                                                                        |
| `pnpm.cmd check:templates`                                                                                                  | Passed.                                                                                                                                                                                        |
| `pnpm.cmd check:licenses`                                                                                                   | Passed; no dependency changes retained.                                                                                                                                                        |
| `pnpm.cmd exec turbo run test:coverage --concurrency=2 --force`                                                             | Failed tooling Git ownership; process-scoped correction documented above.                                                                                                                      |
| `pnpm.cmd exec turbo run test:coverage --concurrency=2 --force --env-mode=loose`                                            | Tooling/contracts/domain passed; engine failures documented above.                                                                                                                             |
| Bounded/completion coverage commands                                                                                        | Exact commands and all package results in verification results.                                                                                                                                |
| `pnpm.cmd test:reset`                                                                                                       | Passed, 1 native acceptance test.                                                                                                                                                              |
| `pnpm.cmd test:upgrade`                                                                                                     | Passed, 2 current-format/native-refusal acceptance tests.                                                                                                                                      |
| `pnpm.cmd test:migrations`                                                                                                  | Not run: no such script exists. `check:migrations` and tooling migration tests ran.                                                                                                            |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                                                                        | Passed.                                                                                                                                                                                        |
| `pnpm.cmd docs:generate`                                                                                                    | Passed.                                                                                                                                                                                        |
| From `apps/web`: `pnpm.cmd exec playwright test e2e/drafts.spec.ts e2e/device-draft-format.spec.ts --retries=0 --workers=1` | Passed, 6 tests on Edge after build.                                                                                                                                                           |

API coverage receives `GG_TEST_PORT_START=5600`, `GG_TEST_PORT_COUNT=100`. Native acceptance uses 6300..6309 and `gg-wp-b3-int-` disposable directories. Existing reset/unit fixtures retain their own test prefixes. Logs contain nonfatal shared Turbo cache “Access is denied” warnings; tasks execute rather than using that unwritable cache.

## 6. Docs

- `CHANGELOG.md`: #266/#188 at top of Unreleased, every main bullet kept; explicit reset/refusal and retirement upgrade notes, retained current-format acceptance described.
- Numbered docs 03/05/06/10/12 reconcile current-format SQL migrations with retired pre-format conversion. Doc 10 retains current fixture helpers and all main CI jobs.
- Architecture README/debt register identify frozen conversion material and measurements as historical; settings guide removes obsolete offline-conversion repair instructions.
- ADR-0042 retained; ADR index union retains all main entries. No new design decision required a new ADR.
- OpenAPI/client schema regenerated from final routes, then `docs/reference` regenerated. Outputs agree with the merged generated files; no hand merge.
- This report, retirement inventory, verification results and selected raw gate logs are the integration evidence.

## 7. Decisions and parameters

- Keep current-format migration logic in #355's existing `store-format.ts`, deleting the retired `upgrade.ts` path. This gives one opening policy and one atomic SQL/data/ledger runner.
- Keep the receipt rewrite as ordinary current-format evolution before 0015; narrow its frozen input to webhook receipt fields instead of restoring obsolete full format contracts. Contracts already owns Zod; no dependency was added.
- Keep `test:upgrade` and the main CI step with current-format-only meaning; remove `--expose-gc`, converter invocations, format-3 conversion acceptance and offline upgrade scripts. Add #355 reset acceptance directly after Build.
- Preserve all 21 migration entries actually shipped at the supplied parent (`0000` through `0020_targeted_event_admission`). The brief mentions `0021`, but no such migration exists at `642da391`; no migration was invented or renumbered.
- New native acceptance uses a 120-second child/startup bound, 300-second test bound and 100ms readiness polling to accommodate real Windows startup while remaining bounded. These are test engineering choices, not owner-approved product parameters.
- Preserve the existing 500-row cooperative scanner bound. Coverage scheduling changes are CLI-only, as recorded above; production timing and coverage policy are unchanged.

## 8. Caveats and open items

- The orchestrator must review, stage the resolved/deleted files, commit the merge and integrate the separately assigned reset-worker patch. No `git add` or commit was attempted; the 21 unmerged index entries are expected until staging. No reset source was edited.
- The combined coverage gate is not green. All eleven instrumented packages exceed the line/branch thresholds, but failed full runs remain unresolved. The final API collection passed 1,541 tests; its earlier cleanup failure was not fixed by this work. Tooling's existing script has no numeric coverage reporter (87 tests passed).
- **Observed outside scope:** engine `src/recovery.test.ts:678` measured 5,534ms against 2,000ms; the later engine run failed `src/webhook-returns.test.ts:92` waiting for the first fake delivery. Infrastructure native/cleanup findings occur in `src/adversarial.test.ts:225`, `src/process/scripts.test.ts:154`, `src/claude/process.test.ts:69`, `:84`, `:97`, and `src/claude/readiness.test.ts:62`; the resumed-finalization wait failed at `src/adversarial.test.ts:441`. API `src/subloop-restart.test.ts:23` exceeded its 60-second disposal-hook budget. These test files and relevant engine/process implementations match main, except the unrelated removal of converter-backed cases from `webhook-admission.test.ts`. No separate main execution or proven root cause is claimed. COMMON section 2 requires outside-scope findings to be reported with file/line rather than fixed; see the raw diagnostics and final counts in verification results.
- Owner acceptance and independent review remain pending. No issue was closed and no GitHub message was posted. No paid/live provider turn, owner reset or owner-instance startup was performed; ports 4747/4748 and `~/.graphgoblin` were not used.
- Native cleanup failures can leave disposable test fixture directories behind; their exact names are in the raw logs. No directory cleanup outside the tests was attempted. No EADDRINUSE occurred in either API run, so the conditional shutdown-process-only rerun was unnecessary.
- A direct attempt to add Zod to infrastructure was refused by the sandbox's external pnpm lock. It left no retained dependency change; the final code uses contracts' existing Zod boundary. Git test ownership was resolved through process-local configuration, without changing global Git settings.
- The host interruption terminated in-flight commands; unfinished gates were rerun after confirming unchanged HEAD/MERGE_HEAD and preserved edits. A broad inventory scan was replaced with bounded enumeration. A redundant final full formatting scan was stopped after more than 18 minutes; the earlier full source check and the final check of subsequently added Markdown passed.
