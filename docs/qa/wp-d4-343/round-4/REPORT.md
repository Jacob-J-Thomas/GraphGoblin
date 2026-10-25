# WP-D4 / #343 round 4

## 1. Branch and worktree

Branch `codex-wp-d4-343`, worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-d4-343`. Starting and final HEAD: `63160ef0727a62e1fe10c2a9f5cf4d73d65ea843`. Uncommitted; prepared for orchestrator commit, QA round 3 and final audit. No commits, index changes, branch changes, merges, pushes, sub-agents or manual directory deletion. See [environment.log.txt](environment.log.txt).

## 2. Per bolt

**#343 / D4-343-03: confirmed before the fix; corrected at the tested boundary.** The supplied QA scenarios were adapted to the worker's port/store prefix and the owner's new refusal decision. Both findings were reproduced against the baseline build before production changes. [reproductions.mjs.txt](reproductions.mjs.txt) uses a separate built API process, file SQLite, public composition-root injection of fake providers and real SQL fault triggers. It copies the independent QA's tracked server fixture into a disposable runtime; the independent QA folder is unchanged. This establishes controlled-provider API/storage behavior, not live-provider behavior.

Before: NUL Event key `before\u0000after` returned 202/pending, then failed after one attempt with `EVENT_INTENT_CONFLICT`. Its retry returned the same delivery with key `before` and zero runs. The webhook counterpart returned 202 `{accepted:true}` and started no run. Regression failures quote `202 !== 400` and `202 !== 422`. See [before-reproductions.log.txt](before-reproductions.log.txt) and [before-reproduction-results.json](before-reproduction-results.json).

After: both Event requests return 400 `VALIDATION_FAILED`, with `errors[0].path: "/dedupeKey"` and `message: "dedupeKey must not contain U+0000"`. Webhook-derived NUL keys return 422 `KEY_INVALID`. Neither changes inbound/receipt/run counts; the targeted loop has no receipt or run. The authored Event expression-key path also refuses NUL with 422 `EVENT_KEY_INVALID`, before any delivery. Space and one-character keys still reuse their delivery and retain their literal run-envelope key.

**#343 / D4-343-04: confirmed before the fix; corrected.** Before: two due receipts stayed pending with attempts=1 through three sweeps while the first receipt's metadata write failed. Removing only that metadata fault admitted the healthy recipient. The original assertion was `actual 'pending', expected 'admitted'`. After: the healthy second receipt is admitted in the **first** sweep; the first stays pending with attempts=1 through all three sweeps. Public API and engine regressions also check a second sweep and exactly one healthy run. The per-receipt catch logs a bounded code and admission ID, leaving the failed metadata write's original receipt due for later recovery. The separate ledger-read and webhook-half catches remain.

The final build-backed run passes all three checks: Event key refusal, webhook key refusal, and same-sweep recovery isolation. See [after-reproductions.log.txt](after-reproductions.log.txt) and [after-reproduction-results.json](after-reproduction-results.json). The process stops cooperatively; this is not a new hard-kill or process-tree qualification claim.

## 3. Files changed

Exact source hunks are retained in [files-changed.log.txt](files-changed.log.txt). Twelve tracked files change, plus this round's evidence.

- API: `routes/triggers.ts:199-203` adds the NUL refinement and OpenAPI description; `triggers/trigger-service.ts:133,624-628` refuses webhook-derived and authored Event NUL keys; `targeted-events.test.ts:575-702` extends key boundaries and adds the real-SQLite metadata-fault regression. The webhook helper is the small required additive edit outside `ingestEvent`; URL targeting, authentication and acknowledgment code is untouched.
- Engine shared file: `run-manager.ts:746-754` isolates each Event receipt dispatch, entirely inside the admission region. Shutdown, finalization, child creation and thread reconstruction are untouched. `event-admission.test.ts:217-219,224-261` accommodates the diagnostic identity and tests persistent metadata failure through the public manager with injected fake-port faults.
- Infrastructure: **no edit** to `sqlite/admission.ts`; reviewed comparisons at lines 158-160 stay strict. See [admission-comparison-reviewed.log.txt](admission-comparison-reviewed.log.txt). No infrastructure source, migration or test changes.
- API client: `openapi.json:20873-20874` and generated `src/generated/schema.ts:2223` document the request-key restriction. No client runtime method changes.
- Docs: CHANGELOG, numbered docs 07/08, guide 04 and ADR-0048, as listed below. No web, MCP, dependency or protected-PR source changes.

## 4. Tests

Before-fix API regressions: four failures, four passes and 26 unselected cases. NUL request keys produced `[202,202]` instead of `[400,400]`; webhook and authored Event NUL keys produced `expected 202 to be 422`; recovery produced `state: pending` instead of `admitted`. The new engine regression independently failed with `status: pending` instead of `admitted`. See [before-regressions.log.txt](before-regressions.log.txt) and [before-engine-regression.log.txt](before-engine-regression.log.txt).

After-fix focused runs: API **34/34** and engine admission **11/11**. See [after-api-focused.log.txt](after-api-focused.log.txt) and [after-engine-focused.log.txt](after-engine-focused.log.txt). Full engine coverage ran after correcting the new test adapter's initial TypeScript signature error; no production/test edits occurred during broad coverage, other than already formatted source passing unchanged through the repository formatter. Later edits were documentation/evidence only.

| Package        | Full coverage run                                   | Lines              | Branches           |
| -------------- | --------------------------------------------------- | ------------------ | ------------------ |
| contracts      | PASS: 266 tests, 20 files                           | 99.74% (385/386)   | 95% (190/200)      |
| engine         | PASS: 1,626 tests, 42 files                         | 97.81% (2646/2705) | 92.06% (2273/2469) |
| infrastructure | FAIL: 767 passed / 14 failed, 52 files              | 98.67% (2236/2266) | 94.86% (1865/1966) |
| api            | FAIL: 1,354 passed / 3 failed / 8 skipped, 68 files | 97.77% (1849/1891) | 93.48% (1348/1442) |
| api-client     | PASS: 72 tests, 8 files                             | 100% (246/246)     | 99.37% (160/161)   |

Coverage thresholds/exclusions are unchanged. Exact commands and fresh report locations are in [coverage-gates.json](coverage-gates.json); logs and `coverage-*-summary.json` are retained here. `--coverage.reportOnFailure` preserves measurements without changing a failed gate into a pass. Fresh disposable output directories prevent stale report/lock reuse; full generated HTML/raw coverage directories are not kept in Git.

Every failing file is untouched and receives exactly one isolated diagnostic after all broad coverage finishes. Original package failures remain failures:

| File                                      | Full run                                                    | One isolated diagnostic                                                           |
| ----------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| infrastructure `sqlite/upgrade.test.ts`   | 20 passed / 6 failed; 20-second timeouts                    | 25 passed / 1 failed; same refusal test times out                                 |
| infrastructure `process/scripts.test.ts`  | 36 passed / 3 failed                                        | 36 passed / 3 failed                                                              |
| infrastructure `claude/readiness.test.ts` | 20 passed / 1 failed                                        | 20 passed / 1 failed                                                              |
| infrastructure `adversarial.test.ts`      | 19 passed / 1 failed                                        | 19 passed / 1 failed                                                              |
| infrastructure `claude/process.test.ts`   | 2 passed / 3 failed                                         | 1 passed / 4 failed; additional stream result has timedOut=true rather than false |
| api `main.test.ts`                        | 4 passed / 1 failed / 4 skipped; CLI test 60-second timeout | 5 passed / 4 skipped                                                              |
| api `subloop-restart.test.ts`             | 1 passed / 2 failed; timeout and cleanup failure            | 2 passed / 1 failed; same 60-second afterEach cleanup-hook timeout                |

Exact isolated commands/results/log names are in [isolated-diagnostics.json](isolated-diagnostics.json); the runner is [run-isolated-diagnostics.ps1.txt](run-isolated-diagnostics.ps1.txt). D-015 is observed in native process-tree tests; exact full-run assertion: **`native process-tree cancellation must finish before fixture cleanup: expected true to be false`**, in `process/scripts.test.ts:194`. The SQLite upgrade timeout, API timeouts and the additional isolated Claude stream timedOut mismatch are recorded separately, with causes unconfirmed. No outside-scope source fix or repeated broad suite was attempted.

## 5. Gates

All commands use Node v22.14.0 first on PATH, PowerShell and `pnpm.cmd`. [core-gates.json](core-gates.json), [coverage-gates.json](coverage-gates.json) and the retained runner copies contain exact arguments and results.

| Command                                                                      | Result                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                         | PASS: 20 tasks. Initial run failed on the new test adapter's three-argument mock signature; corrected to the fake's two-argument public method, final run passes. Both logs retained. |
| `pnpm.cmd lint`                                                              | PASS: 11 tasks; existing `ThreadViewer.tsx:106` warning.                                                                                                                              |
| `pnpm.cmd format`                                                            | PASS; final changed-source Prettier check also passes.                                                                                                                                |
| `pnpm.cmd check:layers`                                                      | PASS                                                                                                                                                                                  |
| `pnpm.cmd check:deps`                                                        | PASS                                                                                                                                                                                  |
| `pnpm.cmd check:docs`                                                        | PASS                                                                                                                                                                                  |
| `pnpm.cmd check:migrations`                                                  | PASS; no migration added.                                                                                                                                                             |
| `pnpm.cmd docs:generate`                                                     | PASS; generated references remain byte-identical.                                                                                                                                     |
| `pnpm.cmd --filter @graphgoblin/api-client generate`                         | PASS; OpenAPI and generated TypeScript description updated.                                                                                                                           |
| `pnpm.cmd --filter @graphgoblin/contracts test:coverage`                     | PASS                                                                                                                                                                                  |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                        | PASS                                                                                                                                                                                  |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1` | FAIL in five untouched files, as above.                                                                                                                                               |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                           | FAIL in two untouched files, as above.                                                                                                                                                |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage`                    | PASS; additional changed-package COMMON gate.                                                                                                                                         |
| `pnpm.cmd build`                                                             | PASS: 11 tasks; final built-process reproductions all pass.                                                                                                                           |

Some successful Turbo runs print access-denied warnings; their actual exit codes and task summaries are retained. Coverage command rows abbreviate only the documented output-directory/report-on-failure flags. Gate scripts are [run-core-gates.ps1.txt](run-core-gates.ps1.txt) and [run-coverage-gates.ps1.txt](run-coverage-gates.ps1.txt). Build logs: [before-build.log.txt](before-build.log.txt), [build.log.txt](build.log.txt). No web changes, so no new web coverage/browser gate; no dependency/license changes.

## 6. Docs

`CHANGELOG.md:7` extends the #343 **Upgrade:** note with NUL refusals and same-sweep receipt isolation. `docs/07-api-and-streaming.md:68,532`, `docs/08-triggers-and-integrations.md:102,156,164`, `docs/guide/04-triggers.md:214,321`, and `ADR-0048:17,27` document valid keys, refusal codes and recovery. Event/Poll key-rule references are explicit rather than claiming those rules are unchanged. No new ADR number is used.

OpenAPI describes 1-512 characters of well-formed Unicode excluding U+0000, with literal whitespace. Both generators ran; reference Markdown is unchanged, API-client artifacts change only the description. Logs: [docs-generate.log.txt](docs-generate.log.txt), [api-client-generate.log.txt](api-client-generate.log.txt).

## 7. Decisions and parameters

The owner's NUL refusal decision is implemented at the request contract: 400 `VALIDATION_FAILED` naming `/dedupeKey`, and 422 `KEY_INVALID` for webhook-derived NUL keys. The stored-key inspection found the same admission mismatch in authored Event keys; their existing 422 `EVENT_KEY_INVALID` now covers NUL too. No accepted key is normalized, shortened or silently dropped by this change. Admission's immutable-history checks remain intact; old rows are not repaired or rewritten.

Receipt dispatch errors are caught individually and logged with code `EVENT_RECOVERY_FAILED` plus `admissionId`; ledger reads retain the outer catch, and webhook recovery remains a separate half. No numeric parameter changes: five due Events per sweep, the nonoverlapping 15-second timer and eight-failure 5-to-300-second backoff remain the established engineering settings. There is no new claim of exactly-once external effects.

The other-key/identifier inspection is retained in [identifier-contract-review.log.txt](identifier-contract-review.log.txt), [key-comparison-review.log.txt](key-comparison-review.log.txt), and [key-storage-audit.log.txt](key-storage-audit.log.txt), with source [key-storage-audit.mjs.txt](key-storage-audit.mjs.txt). Persisted run/loop/version/receipt IDs are ULIDs; selected authored node IDs/Event types are slugs. A request containing NUL cannot match those published identifiers. Synthetic cron keys and webhook endpoint identifiers are generated from safe identities. JSON payload/intent strings remain escaped JSON rather than raw key text.

The SQLite probe shows full bytes `6265666F7265006166746572` and SQL equality=1, while text returned to JavaScript is `before`. This narrows the observation to the text decoding/comparison boundary; it does not claim SQLite discarded the stored bytes. Poll preparation also currently accepts the NUL key. Its batched `sqlite/runs.ts:361-385` key projection reads text, while SQL-side key equality remained correct in the probe. No end-to-end Poll failure is established or fixed here; this separate path is reported outside scope.

## 8. Caveats and open items

Observed outside scope (source only): the webhook sweep at `run-manager.ts:759-767` also has one catch around its due-receipt loop; see [webhook-sweep-reviewed.log.txt](webhook-sweep-reviewed.log.txt). That half is unchanged, and no same-ledger webhook metadata-fault reproduction was run here.

The full infrastructure/API coverage gates remain failed; isolated diagnostics do not override them. D-015 native process-tree qualification needs an environment that permits that control. The untouched upgrade/API timing failures also need disposition. No source in those files, the protected PRs, or their issue relationships is changed.

PR #390 (#224) and PR #394 (#240) were open drafts when checked; see [coordination.json](coordination.json). The orchestrator handles the admission-open integration after #390/main lands and the targeted Event browser-spec overlap with #394. This thread does not merge main. The orchestrator still commits, runs QA round 3 and obtains the final audit at the resulting exact head; implementation checks are separate from merge/acceptance.

All round-4 evidence lives here. Logs are `.log.txt`, code copies are `.<ext>.txt`, and local profile paths use `%USERPROFILE%`. [NORMALIZATION.json](NORMALIZATION.json) records original capture byte counts/SHA-256 and normalized retained bytes; original encoding/path spellings are not kept. [MANIFEST.json](MANIFEST.json) pins source/evidence bytes, with [VALIDATION.json](VALIDATION.json) recording final integrity checks. Disposable runtime stores and generated reports remain for orchestrator cleanup; no manual directory deletion was issued.
