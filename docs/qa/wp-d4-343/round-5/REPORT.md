# WP-D4 (#343), round 5: targeted Event browser fixtures

## 1. Branch and worktree

Branch: codex-wp-d4-343. Base and final HEAD: 96cc1802804c5a2960212e6341ca611d6a89c6e9.

```text
%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-d4-343
```

All work is uncommitted for the orchestrator. The implementation thread did not stage, commit, push, merge, rebase, stash, switch branches, delete directories, or create directory links. Dependencies were present. [Environment record](environment.log.txt).

## 2. Per bolt

For #343 round 5, all maintained inbound Event writers in apps/web/e2e now use one shared sender that first publishes a minimal loop with one Event entry per type, supplies its loopId on every post, and asserts 202.

The inventory was listed before source edits and retained in [INVENTORY.md](INVENTORY.md) and [inventory-search.log.txt](inventory-search.log.txt). It found the refresh helpers/bulk sends, history paging, responsive seed, and two screens-capture seeds. No inbound Event writer was found in apps/web/scripts; its execution-log reads are separate endpoints.

The refresh tests retain their types, payloads, row counts, before filters, 20-request batches, response latches, focus/scroll checks and URL assertions. Loaded snapshots compare stable payload membership/order while delivery/run text can change. The hundredth-receipt fixture retains the actual admissionId and target, controls only its delivery state/run visibility, and scopes its state assertions to that receipt.

The webhook disposition fixture intercepts GET /events with query parameters and returns a valid pagination envelope. Deliberately malformed error-boundary fixtures stay malformed. Product code is unchanged.

## 3. Files changed

Line references describe the final worktree. [Complete source patch](changes.patch.txt).

| File                                                                        | Changed lines                           | Change                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [fixtures.ts](../../../../apps/web/e2e/fixtures.ts)                         | 132, 134, 137, 141-178                  | Optional API base URL on publishLoop; shared publishEventLoop sender factory.                         |
| [events-refresh.spec.ts](../../../../apps/web/e2e/events-refresh.spec.ts)   | 1-47, 75-122, 167-168, 219-246, 260-300 | Targeted setup, stable snapshots, recipient-scoped delivery assertion and retained response metadata. |
| [history.spec.ts](../../../../apps/web/e2e/history.spec.ts)                 | 2, 56-63, 74                            | Targeted 101-row Events dataset and stable first-payload comparison.                                  |
| [responsive.spec.ts](../../../../apps/web/e2e/responsive.spec.ts)           | 20, 248-249, 323, 755                   | Published matching Event recipient and matching readiness label.                                      |
| [screens.capture.ts](../../../../apps/web/e2e/screens.capture.ts)           | 30, 342-348, 503                        | Target both Event seeds; preserve payloads and issue-482 request key.                                 |
| [github-triggers.spec.ts](../../../../apps/web/e2e/github-triggers.spec.ts) | 317-327                                 | Keep the webhook Events fixture active for background queries; include nextCursor.                    |

Other new files are this round's evidence under docs/qa/wp-d4-343/round-5. No product, migration, schema, independent-QA or owner-held implementation file changed.

## 4. Tests

Before changing source, a fresh root build passed all 11 tasks. The original first refresh case then failed on its first untargeted post:

```text
Expected: 202
Received: 400
```

[Before failure](browser-before.log.txt), [build before](build-before.log.txt). The raw trace archive named in the failure log is intentionally not kept; its exact size and SHA-256 are in [NOT-KEPT.md](NOT-KEPT.md). The normalized error context is retained.

Two initial selector invocations did not execute tests: an anchored selector found no matches, then Windows CMD interpreted the regex pipe. Their [first](browser-before-selection.log.txt) and [second](browser-before-selection-2.log.txt) outputs are kept. The corrected selector, --grep admits, produced the quoted 400 regression.

After the change, all 16 browser checks passed with zero retries and one worker, against the fresh build:

| Browser selection                                                                   | Passed | Runner duration | Evidence                                                                                        |
| ----------------------------------------------------------------------------------- | -----: | --------------: | ----------------------------------------------------------------------------------------------- |
| Events refresh, history, GitHub triggers, receiver; incidental thread-history match |     12 |         2.6 min | [Log](browser-events.log.txt), [exact command and wall time](browser-events-status.log.txt)     |
| Responsive screens/transient states, both themes at 360/768/1024/1440 px            |      2 |         1.9 min | [Log](browser-responsive-screens.log.txt), [command](browser-responsive-screens-status.log.txt) |
| Responsive coarse-pointer controls, both themes, including Events                   |      2 |         1.4 min | [Log](browser-responsive-touch.log.txt), [command](browser-responsive-touch-status.log.txt)     |

The 12-case run contains all four refresh cases, all three history cases, all three GitHub cases, the receiver case, and one thread-history case. Playwright treats file filters as regexes, so history.spec.ts also selected thread-history.spec.ts; that extra case passed.

Per-file case-time sums in that run were: events-refresh 4 cases / 55.6 s; history 3 / 43.8 s; github-triggers 3 / 8.2 s; webhook-receiver 1 / 1.4 s; thread-history 1 / 36.5 s. These sums exclude runner setup and teardown.

```powershell
pnpm.cmd --filter @graphgoblin/web test:e2e events-refresh.spec.ts history.spec.ts github-triggers.spec.ts webhook-receiver.spec.ts --retries=0 --workers=1 --output=../../docs/qa/wp-d4-343/round-5/events-test-results
pnpm.cmd --filter @graphgoblin/web test:e2e responsive.spec.ts --grep transient --retries=0 --workers=1 --output=../../docs/qa/wp-d4-343/round-5/responsive-screens-test-results
pnpm.cmd --filter @graphgoblin/web test:e2e responsive.spec.ts --grep pointer.the.controls --retries=0 --workers=1 --output=../../docs/qa/wp-d4-343/round-5/responsive-touch-test-results
```

The full web coverage run failed: 132 passed and 3 failed test files; 1,694 passed and 4 failed tests; two additional worker-start errors. Runner duration: 2,931.27 seconds (48.9 minutes). [Full log](coverage-web.log.txt), [failure excerpts and totals](coverage-web-results.log.txt).

The failures were in unchanged files:

- DecisionAuthoring: two failures with the exact diagnostic, "Test timed out in 20000ms."
- Routing review: "Test timed out in 60000ms."
- ClassifierField: expected the unavailable-scorer explanation; received "Explicit classifier catalog id. Loading classifier models…".
- projections and focus-field.cron: "[vitest-pool-runner]: Timeout waiting for worker to respond".

Each of those five files ran alone exactly once afterward, using the following command template with one worker. All 57 tests passed; these results do not replace the failed full-package run.

```powershell
pnpm.cmd --filter @graphgoblin/web test <file> --maxWorkers=1
```

| File                                  | Passed | Runner duration | Evidence                                                                                          |
| ------------------------------------- | -----: | --------------: | ------------------------------------------------------------------------------------------------- |
| src/editor/DecisionAuthoring.test.tsx |     23 |         98.51 s | [Log](isolated-decision-authoring.log.txt), [command](isolated-decision-authoring-status.log.txt) |
| src/editor/routing-review.test.ts     |     23 |         57.28 s | [Log](isolated-routing-review.log.txt), [command](isolated-routing-review-status.log.txt)         |
| src/editor/ClassifierField.test.tsx   |      7 |         18.03 s | [Log](isolated-classifier-field.log.txt), [command](isolated-classifier-field-status.log.txt)     |
| scripts/projections.test.ts           |      2 |         11.10 s | [Log](isolated-projections.log.txt), [command](isolated-projections-status.log.txt)               |
| src/editor/focus-field.cron.test.tsx  |      2 |         17.44 s | [Log](isolated-focus-field-cron.log.txt), [command](isolated-focus-field-cron-status.log.txt)     |

Web coverage percentages were not produced. The required command used Vitest's default reportOnFailure=false, and no coverage-summary.json existed after it finished. [Installed Vitest help](vitest-coverage-help.log.txt). No old percentages were reused; thresholds, timeouts, exclusions and reporting configuration are unchanged.

The screens capture compiles through root typecheck. It was not executed: even its Events-only selection seeds the broader run-state dataset on this loaded host.

## 5. Gates

All commands used PowerShell pnpm.cmd with Node v22.14.0 first on PATH.

| Command                                                         | Result                                 | Evidence                                                           |
| --------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| pnpm.cmd typecheck                                              | PASS; 20 tasks                         | [Log](typecheck.log.txt), [status](typecheck-status.log.txt)       |
| pnpm.cmd lint                                                   | PASS; 11 tasks                         | [Log](lint.log.txt), [status](lint-status.log.txt)                 |
| pnpm.cmd format:check                                           | PASS                                   | [Log](format-check.log.txt), [status](format-check-status.log.txt) |
| pnpm.cmd build                                                  | PASS; 11 tasks                         | [Log](build.log.txt), [status](build-status.log.txt)               |
| pnpm.cmd check:layers                                           | PASS                                   | [Log](layers.log.txt), [status](layers-status.log.txt)             |
| pnpm.cmd check:deps                                             | PASS                                   | [Log](dependencies.log.txt), [status](dependencies-status.log.txt) |
| pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 | FAIL; counts and isolated reruns above | [Log](coverage-web.log.txt), [status](coverage-web-status.log.txt) |

The browser commands and once-per-file isolated commands/results are recorded in section 4. Logs retain native exit codes separately from PowerShell's formatting of stderr.

## 6. Docs

This round adds the inventory, report, command logs and evidence integrity records. It changes no product behavior, public schema, generated client, numbered product documentation, ADR, migration or CHANGELOG.

[NORMALIZATION.json](NORMALIZATION.json) records original and retained capture sizes/hashes. Logs use UTF-8 LF and replace local profile paths with %USERPROFILE%. [MANIFEST.json](MANIFEST.json) records the source patch/file hashes and retained evidence; [VALIDATION.json](VALIDATION.json) records the integrity checks. Code helpers are retained as .ps1.txt and .py.txt.

## 7. Decisions and parameters

The helper publishes once per dataset and reuses that loop for every send. One Event entry per type makes selection unambiguous. Its optional API base URL keeps the isolated /apps datasets on their own server for both publication and posting.

Published Event triggers require slug types. Layout/capture-only seeds therefore use issue-opened and build-finished, with matching readiness text. Their payloads and request key stay the same. All #240 types, counts, filters, batches and response synchronization stay as before.

Snapshots compare stable payloads because pending-to-admitted transitions can legitimately change row text. Receipt-state assertions select the intended row. GET response overrides retain the real frozen target and admission identity.

Browser retries were zero and workers one, as requested. Full web coverage used two workers; each isolated diagnostic used one. Automated fixtures retained their default disposable stores and ephemeral ports. No hand-started service used a port.

## 8. Caveats and open items

The requested browser regressions pass. The full web coverage gate is still red despite all five isolated reruns passing. A clean full-package CI run remains necessary; this round has no current coverage percentages to claim.

The screenshot capture has compile-only verification. The orchestrator still owns committing this work and subsequent QA/review. No independent QA evidence was edited, and no product correction was made for the unrelated full-suite failures.
