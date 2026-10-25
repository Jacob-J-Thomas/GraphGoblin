# Independent QA round 1: WP-A2 / #241

## 1. Verdict

**PASS at 3ffb23affa0148ce3eeccc7869f69b6da8dbaebb.** The complete local Edge run returned 415 passed, 1 expected live-provider skip and 0 failures, with zero retries and one worker. Its measured command duration was 1678.19 seconds (Playwright: 27.9 minutes). Two independent Linux browser executions at this head also returned 415 passed and one skipped, in 22.1 and 21.1 minutes. CI checked merge e99623068f6de4f26bdb3ffc036635a207d9af4d; its tree equals this head exactly.

The intentionally broken disposable build failed its UI assertion (expected exit 1, 24.252 seconds); the unchanged normal-build control passed (13.109 seconds). This is a negative control, not a product defect. No test retry or whole-suite rerun was used to turn a failure green.

Branch: codex-qa-wp-a2-241. Worktree: %USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-qa-wp-a2-241. Comparison base: f63a0096eddcc4df3b0c4aa1df3cbef10bcaa066. HEAD was checked before testing and again at handoff. Dependencies were present as a nonempty local node_modules directory; no install, link or junction was made. QA artifacts are uncommitted; no staging or commits were performed.

Environment: Windows 11 Pro x64, Node 22.14.0, pnpm 12.8.1, installed Microsoft Edge 156.0.4314.42. The host exposes 12 logical CPUs and about 64 GiB RAM and is shared. LIVE=0, GG_E2E_BROWSER_CHANNEL=msedge, CI=true, GG_E2E_MAIN_PORT=6170 and GG_E2E_CONTROL_PORT=6171. Extra fixture applications use ephemeral ports. Disposable storage uses fresh %USERPROFILE%/AppData/Local/Temp/gg-api-* directories and in-memory SQLite; special history fixtures use their own disposable state. Harness, decider and classifier boundaries are fake-only. No provider turns, owner store, or ports 4747/4748 were used.

## 2. Defects

**None found in this QA scope.** The complete suite had no incidental failures, so no host-load spec rerun was needed.

The seeded failure is fully explained: a style added only to a physical build copy hides h1 headings. actions.spec.ts:41 then fails expect(getByRole(heading, Loops)).toBeFocused because the heading is absent from the accessibility tree. The same test passes without the seed. The retained error-context text and normal-index SHA-256 verification establish a UI failure rather than setup failure.

## 3. Coverage of criteria

Authority: the supplied #241 QA brief, COMMON.md and QA-COMMON.md; #241, its #292 UoW and #283 intent; current WP-A2 register history; and live issue #400 (its brief snapshot was absent). These requirements are retained in the linked logs. The implementer report was treated as historical claims and did not supply passing evidence.

| Criterion/check                             | Steps and expected result                                                                                                                              | Actual result                                                                                                                                                                            | Status                                                                      | Evidence                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission and build                         | Verify exact head, clean tracked tree and nonempty dependencies; select Node 22; pnpm.cmd build                                                        | Exact head and clean tree; all 11 build tasks ran successfully, no cache hits; 61.136 s                                                                                                  | Pass                                                                        | [baseline/diff](evidence/baseline-and-diff.log.txt), [build](evidence/build.log.txt), [environment](evidence/environment-and-isolation.log.txt)                                                                            |
| #241: complete real browser gate            | From apps/web, pnpm.cmd exec playwright test --retries=0 --workers=1, Edge, LIVE=0; execute every functional spec and reject any first-attempt failure | 416 selected tests across 49 spec files: 415 passed, 1 skipped, 0 failed                                                                                                                 | Pass                                                                        | [full log](evidence/edge-full.log.txt), [all individual checks](evidence/edge-full-results.json), [timing](evidence/edge-full.result.json)                                                                                 |
| #241: intentional UI regression is detected | Hide the Loops h1 only in an independent build copy; run the unchanged Loops action test; expect assertion failure, then normal-build success          | Seed: exit 1 on the heading focus assertion; control: exit 0; original index hash unchanged                                                                                              | Pass                                                                        | [seed log](evidence/edge-seeded-regression.log.txt), [context](evidence/seed-error-context.log.txt), [control](evidence/edge-normal-control.log.txt), [verification](evidence/seed-verification.json)                      |
| No weakened assertion                       | Compare every changed spec and helper against the required base; trace changed product expectations to Git history                                     | All 15 changed spec files compared; #204/#205/#244 changes match delivered behavior; exact selectors and durable persistence checks are retained or stronger                             | Pass                                                                        | [per-file assertion audit](evidence/assertion-comparison.md), [full diff](evidence/baseline-and-diff.log.txt), [issue #400](evidence/issue-400.json)                                                                       |
| Strict terminal-delivery regression         | After run.finished require return.delivered in the inspector, exact complete durable sequence, and reconstruction at that sequence                     | inspector-large-values.spec.ts:217 passed locally and in both Linux executions; assertion remains strict                                                                                 | Pass                                                                        | [full results](evidence/edge-full-results.json), [CI attempt 1](evidence/ci-attempt-1-browser-excerpt.log.txt), [CI attempt 2](evidence/ci-attempt-2-browser-excerpt.log.txt)                                              |
| Web unit runner and coverage                | Once: pnpm.cmd --filter @graphgoblin/web test:coverage with threads, isolate:true, maxWorkers:2; retain shared coverage protections                    | 137 files and 1,707 tests passed; exit 0 in 1017.326 s; coverage below                                                                                                                   | Pass                                                                        | [unit log](evidence/web-coverage.log.txt), [timing](evidence/web-coverage.result.json), [coverage](evidence/web-coverage-summary.json)                                                                                     |
| Routing corpus watchdog                     | Same 300 seeded graphs and geometry/count assertions; finite 180-second execution allowance, distinct from native browser performance assertions       | routing-review.test.ts passed; whole-file Vitest cache duration 49.335 s; default reporter has no separate corpus-case duration                                                          | Pass                                                                        | [unit log](evidence/web-coverage.log.txt), [file timings](evidence/web-unit-file-results.json), [assertion audit](evidence/assertion-comparison.md)                                                                        |
| CI actually executes Edge without retries   | Read gh pr checks 351 and gh run view; independently inspect executed jobs/logs and tree identity                                                      | Both browser attempts succeeded; logs show 416 selected tests, msedge, LIVE=0, --retries=0 --workers=1; exact tree matches                                                               | Pass                                                                        | [CI metadata](evidence/ci-run-latest.json), [tree comparison](evidence/ci-tree-comparison.log.txt), [attempt 1](evidence/ci-attempt-1-browser-excerpt.log.txt), [attempt 2](evidence/ci-attempt-2-browser-excerpt.log.txt) |
| CI budgets and full checkout                | Inspect 75-minute job, 60-minute functional step, full history and shared Node pin; verify execution                                                   | fetch-depth:0 executed; frozen-history #170 checks passed. Measured browser steps are below 60 minutes; setup/upload has separate job allowance                                          | Pass                                                                        | [workflow snapshot](evidence/source-and-history.log.txt), [executed steps](evidence/ci-attempt-1-jobs.json), [attempt 2 steps](evidence/ci-attempt-2-jobs.json)                                                            |
| Exclusions and paid-check separation        | Enumerate actual skips and compare summary/selection; no recurring paid job                                                                            | Exactly live.spec.ts is skipped by LIVE=0. Ordinary routing/forms tests still run. Capture/profile/strict optional modes and screens.capture.ts are documented in the always-run summary | Pass                                                                        | [all results](evidence/edge-full-results.json), [executed summary](evidence/ci-attempt-2-browser-excerpt.log.txt), [workflow](evidence/source-and-history.log.txt)                                                         |
| Failure evidence                            | Inspect retained failure tracing/report configuration and upload paths/condition; produce local failure output                                         | CI uses failure() or cancelled(), test-results plus HTML, if-no-files-found:warn. Local seed produced error context and trace/report. Successful CI attempts correctly skip upload       | Pass for configuration/local creation; CI upload failure path not exercised | [workflow](evidence/source-and-history.log.txt), [seed context](evidence/seed-error-context.log.txt), [discarded inventory](evidence/not-kept-files.json)                                                                  |

### Touched systems: positive, negative and adjacent cases

Every row below was executed in the complete suite. Expected: all listed cases pass without retries; actual file-level counts are extracted from the retained list reporter. Individual test names, source locations, expected status and timings are in edge-full-results.json.

| System/spec                    | Cases and steps checked                                                                                              | Actual                         | Status |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| actions.spec.ts                | Settings catalog reasons; cancel/confirm, keyboard focus, pending and refused actions                                | 62 passed; 0 failed; 0 skipped | Pass   |
| cron.spec.ts                   | Preset/custom schedule editing, exact preview, invalid/unreachable schedules, timezone round trips                   | 10 passed; 0 failed; 0 skipped | Pass   |
| drafts.spec.ts                 | Two-tab reload/overwrite conflicts, real IndexedDB upgrade blocking, reload and cutover reconciliation               | 7 passed; 0 failed; 0 skipped  | Pass   |
| earlier-node-outputs.spec.ts   | Narrow and desktop copy/reference authoring after Fit View and native hit-testing                                    | 2 passed; 0 failed; 0 skipped  | Pass   |
| forms.spec.ts                  | Visible model/effort, Advanced separation, validation and keyboard controls                                          | 12 passed; 0 failed; 0 skipped | Pass   |
| inspector-large-values.spec.ts | Bounded large text, keyboard focus, post-terminal delivery, explicit reconstruction and reload                       | 6 passed; 0 failed; 0 skipped  | Pass   |
| issue-170-qa.spec.ts           | All node forms, visible harness/model/effort persistence, malformed input, save/reload and policy refusal            | 41 passed; 0 failed; 0 skipped | Pass   |
| issue-7-qa.spec.ts             | Long typed failure text, overflow and reduced-motion behavior                                                        | 3 passed; 0 failed; 0 skipped  | Pass   |
| model-effort.spec.ts           | Defaults and capability failure, explicit/inherited effort, live-open refresh, save/reload and fake adapter requests | 16 passed; 0 failed; 0 skipped | Pass   |
| pwa.spec.ts                    | Native listener stop/restart, online/offline recovery, stream outage, worker updates, deferral and confirmed reload  | 11 passed; 0 failed; 0 skipped | Pass   |
| qa.spec.ts                     | 1,200 progress events, contiguous durable sequence, exact evidence counts, typed failures and cancellation           | 10 passed; 0 failed; 0 skipped | Pass   |
| routing.spec.ts                | Visual/keyboard geometry, native dragging workload, routing samples and unchanged performance thresholds             | 23 passed; 0 failed; 0 skipped | Pass   |
| thread-history.spec.ts         | Open and reloaded inspectors track persisted failure, resume and success                                             | 1 passed; 0 failed; 0 skipped  | Pass   |
| trigger-types.spec.ts          | Durable implicit default and exact authored fallback, reload and draft export at both widths                         | 4 passed; 0 failed; 0 skipped  | Pass   |
| webhook-delivery.spec.ts       | Unknown acknowledgement, HTTP rejection and eventual success; pending-to-delivered update                            | 2 passed; 0 failed; 0 skipped  | Pass   |

### Coverage and thread isolation

Web V8 coverage: statements 98% (8713/8890), branches 94.89% (7950/8378), functions 98.46% (2308/2344), lines 98.92% (7605/7688). Shared thresholds and include/exclude settings are unchanged. The retained summary is the numeric total derived from the generated coverage-summary.json, without machine-specific filename keys.

Source inspection found no test that depends on separate-process isolation. Node-specific uses are filesystem reads, stable process.cwd() reads and a runInNewContext fixture with its own fake process. No process.chdir, process exit/kill, process event-handler installation or worker-thread/native-addon test dependency was found. JS module/DOM state remains isolated per file; fixtures clear stores/storage and restore timers/mocks. All 137 test files and 1,707 tests passed. The current whole-file routing timing does not independently reproduce the historical 105.6-second coverage run; the 180-second allowance remains a finite correctness watchdog with unchanged assertions. The completed coverage execution is the runtime check of this configuration; it does not establish behavior for future tests.

### Local repository gates

| Command               | Result                                                  |     Duration | Evidence                                                                                                  |
| --------------------- | ------------------------------------------------------- | -----------: | --------------------------------------------------------------------------------------------------------- |
| pnpm.cmd typecheck    | Pass (exit 0)                                           |     71.754 s | [log](evidence/gate-typecheck.log.txt), [metadata](evidence/gate-typecheck.result.json)                   |
| pnpm.cmd lint         | Pass (exit 0)                                           |    132.366 s | [log](evidence/gate-lint.log.txt), [metadata](evidence/gate-lint.result.json)                             |
| pnpm.cmd check:layers | Pass (exit 0)                                           |      0.748 s | [log](evidence/gate-check-layers.log.txt), [metadata](evidence/gate-check-layers.result.json)             |
| pnpm.cmd check:deps   | Pass (exit 0)                                           |     10.865 s | [log](evidence/gate-check-deps.log.txt), [metadata](evidence/gate-check-deps.result.json)                 |
| pnpm.cmd check:tokens | Pass (exit 0)                                           |      1.705 s | [log](evidence/gate-check-tokens.log.txt), [metadata](evidence/gate-check-tokens.result.json)             |
| pnpm.cmd format:check | Pass (exit 0), final check after QA Markdown formatting | See metadata | [log](evidence/gate-format-check-final.log.txt), [metadata](evidence/gate-format-check-final.result.json) |

No pnpm command encountered ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK, so no tool-binary fallback was needed. check:docs and check:licenses were not rerun locally: this candidate changes no node schema, route or dependency; their exact-tree CI Gates steps passed. No source tests were added or modified by QA. Only this QA folder was written in the worktree. No numbered documentation, ADR, CHANGELOG or generated reference edit was made by QA.

### Explicit limits

Paid/live provider checks were intentionally not run. Optional capture/profile/strict-performance modes were not qualified; ordinary default performance checks were. Successful CI attempts do not exercise actual upload on failure, cancellation or whole-job exhaustion; that path was checked by configuration plus local failure-output creation. Branch protection/merge approval was not tested or changed. The historical intermittent terminal-tail report was not reproduced in these runs and is not declared disproven. No full suite was repeatedly rerun locally.

gh pr checks 351 returned HTTP 401. gh run view and REST metadata worked; the GitHub connector supplied actual per-job logs after gh log downloads returned HTTP 403. Retained excerpts identify their exact jobs/attempts. An initial environment helper hit native quoting and an incorrect health endpoint; the corrected helper returned Windows details and HTTP 200 from /healthz. These helper errors are not test failures.

## 4. Report path and evidence folder

Report: docs/qa/2026-10-25-wp-a2-241-qa/README.md. Evidence folder: docs/qa/2026-10-25-wp-a2-241-qa/evidence/. All retained artifacts are directly linked below; [NOT-KEPT.md](NOT-KEPT.md) records generated folders omitted from evidence with sizes and SHA-256 inventories. Final retained bytes are listed in [the SHA-256 manifest](evidence/retained-sha256.json).

| Retained artifact                                                                             | Purpose                         |
| --------------------------------------------------------------------------------------------- | ------------------------------- |
| [assertion-audit-history.log.txt](evidence/assertion-audit-history.log.txt)                   | Retained command/source excerpt |
| [assertion-comparison.md](evidence/assertion-comparison.md)                                   | Per-file audit                  |
| [baseline-and-diff.log.txt](evidence/baseline-and-diff.log.txt)                               | Retained command/source excerpt |
| [binding-requirements.log.txt](evidence/binding-requirements.log.txt)                         | Retained command/source excerpt |
| [build.log.txt](evidence/build.log.txt)                                                       | Retained command/source excerpt |
| [build.result.json](evidence/build.result.json)                                               | Structured evidence/metadata    |
| [ci-attempt-1-browser-direct.log.txt](evidence/ci-attempt-1-browser-direct.log.txt)           | Retained command/source excerpt |
| [ci-attempt-1-browser-excerpt.log.txt](evidence/ci-attempt-1-browser-excerpt.log.txt)         | Retained command/source excerpt |
| [ci-attempt-1-browser.log.txt](evidence/ci-attempt-1-browser.log.txt)                         | Retained command/source excerpt |
| [ci-attempt-1-jobs.json](evidence/ci-attempt-1-jobs.json)                                     | Structured evidence/metadata    |
| [ci-attempt-2-browser-excerpt.log.txt](evidence/ci-attempt-2-browser-excerpt.log.txt)         | Retained command/source excerpt |
| [ci-attempt-2-jobs.json](evidence/ci-attempt-2-jobs.json)                                     | Structured evidence/metadata    |
| [ci-check-runs-initial.json](evidence/ci-check-runs-initial.json)                             | Structured evidence/metadata    |
| [ci-initial.log.txt](evidence/ci-initial.log.txt)                                             | Retained command/source excerpt |
| [ci-pr-checks-recheck.log.txt](evidence/ci-pr-checks-recheck.log.txt)                         | Retained command/source excerpt |
| [ci-run-40168519416.json](evidence/ci-run-40168519416.json)                                   | Structured evidence/metadata    |
| [ci-run-latest.json](evidence/ci-run-latest.json)                                             | Structured evidence/metadata    |
| [ci-run-progress.json](evidence/ci-run-progress.json)                                         | Structured evidence/metadata    |
| [ci-run-rest-initial.json](evidence/ci-run-rest-initial.json)                                 | Structured evidence/metadata    |
| [ci-tree-comparison.log.txt](evidence/ci-tree-comparison.log.txt)                             | Retained command/source excerpt |
| [disposable-data-and-threads.log.txt](evidence/disposable-data-and-threads.log.txt)           | Retained command/source excerpt |
| [edge-full-results.json](evidence/edge-full-results.json)                                     | Structured evidence/metadata    |
| [edge-full.log.txt](evidence/edge-full.log.txt)                                               | Retained command/source excerpt |
| [edge-full.result.json](evidence/edge-full.result.json)                                       | Structured evidence/metadata    |
| [edge-normal-control.log.txt](evidence/edge-normal-control.log.txt)                           | Retained command/source excerpt |
| [edge-normal-control.result.json](evidence/edge-normal-control.result.json)                   | Structured evidence/metadata    |
| [edge-seeded-regression.log.txt](evidence/edge-seeded-regression.log.txt)                     | Retained command/source excerpt |
| [edge-seeded-regression.result.json](evidence/edge-seeded-regression.result.json)             | Structured evidence/metadata    |
| [environment-and-isolation.log.txt](evidence/environment-and-isolation.log.txt)               | Retained command/source excerpt |
| [final-state.log.txt](evidence/final-state.log.txt)                                           | Retained command/source excerpt |
| [final-state.mjs](evidence/final-state.mjs)                                                   | Reproducible QA helper          |
| [finalize-seed.mjs](evidence/finalize-seed.mjs)                                               | Reproducible QA helper          |
| [focused-source-audit.log.txt](evidence/focused-source-audit.log.txt)                         | Retained command/source excerpt |
| [gate-check-deps.log.txt](evidence/gate-check-deps.log.txt)                                   | Retained command/source excerpt |
| [gate-check-deps.result.json](evidence/gate-check-deps.result.json)                           | Structured evidence/metadata    |
| [gate-check-layers.log.txt](evidence/gate-check-layers.log.txt)                               | Retained command/source excerpt |
| [gate-check-layers.result.json](evidence/gate-check-layers.result.json)                       | Structured evidence/metadata    |
| [gate-check-tokens.log.txt](evidence/gate-check-tokens.log.txt)                               | Retained command/source excerpt |
| [gate-check-tokens.result.json](evidence/gate-check-tokens.result.json)                       | Structured evidence/metadata    |
| [gate-format-check-final.log.txt](evidence/gate-format-check-final.log.txt)                   | Retained command/source excerpt |
| [gate-format-check-final.result.json](evidence/gate-format-check-final.result.json)           | Structured evidence/metadata    |
| [gate-format-check.log.txt](evidence/gate-format-check.log.txt)                               | Retained command/source excerpt |
| [gate-format-check.result.json](evidence/gate-format-check.result.json)                       | Structured evidence/metadata    |
| [gate-lint.log.txt](evidence/gate-lint.log.txt)                                               | Retained command/source excerpt |
| [gate-lint.result.json](evidence/gate-lint.result.json)                                       | Structured evidence/metadata    |
| [gate-typecheck.log.txt](evidence/gate-typecheck.log.txt)                                     | Retained command/source excerpt |
| [gate-typecheck.result.json](evidence/gate-typecheck.result.json)                             | Structured evidence/metadata    |
| [inventory-artifacts.mjs](evidence/inventory-artifacts.mjs)                                   | Reproducible QA helper          |
| [issue-400.json](evidence/issue-400.json)                                                     | Structured evidence/metadata    |
| [not-kept-files.json](evidence/not-kept-files.json)                                           | Structured evidence/metadata    |
| [pr-351.json](evidence/pr-351.json)                                                           | Structured evidence/metadata    |
| [requirements-and-product-history.log.txt](evidence/requirements-and-product-history.log.txt) | Retained command/source excerpt |
| [routing-performance.json](evidence/routing-performance.json)                                 | Structured evidence/metadata    |
| [run-command.ps1](evidence/run-command.ps1)                                                   | Reproducible QA helper          |
| [run-gates.ps1](evidence/run-gates.ps1)                                                       | Reproducible QA helper          |
| [runtime-probe-corrected.log.txt](evidence/runtime-probe-corrected.log.txt)                   | Retained command/source excerpt |
| [runtime-probe.log.txt](evidence/runtime-probe.log.txt)                                       | Retained command/source excerpt |
| [runtime-probe.mjs](evidence/runtime-probe.mjs)                                               | Reproducible QA helper          |
| [seed-error-context.log.txt](evidence/seed-error-context.log.txt)                             | Retained command/source excerpt |
| [seed-manifest.json](evidence/seed-manifest.json)                                             | Structured evidence/metadata    |
| [seed-regression.mjs](evidence/seed-regression.mjs)                                           | Reproducible QA helper          |
| [seed-setup.log.txt](evidence/seed-setup.log.txt)                                             | Retained command/source excerpt |
| [seed-verification.json](evidence/seed-verification.json)                                     | Structured evidence/metadata    |
| [source-and-history.log.txt](evidence/source-and-history.log.txt)                             | Retained command/source excerpt |
| [summarize-browser.mjs](evidence/summarize-browser.mjs)                                       | Reproducible QA helper          |
| [verify-report.mjs](evidence/verify-report.mjs)                                               | Reproducible QA helper          |
| [web-coverage-summary.json](evidence/web-coverage-summary.json)                               | Structured evidence/metadata    |
| [web-coverage.log.txt](evidence/web-coverage.log.txt)                                         | Retained command/source excerpt |
| [web-coverage.result.json](evidence/web-coverage.result.json)                                 | Structured evidence/metadata    |
| [web-unit-file-results.json](evidence/web-unit-file-results.json)                             | Structured evidence/metadata    |
| [write-report.mjs](evidence/write-report.mjs)                                                 | Reproducible QA helper          |

## 5. Observations outside scope

No new out-of-scope product defect was established. Local lint passed with the existing apps/web/src/runs/inspector/ThreadViewer.tsx:106 useState destructuring warning. check:deps passed with the existing no-orphans warning for packages/infrastructure/drizzle.config.ts. Turbo also printed IO access-denied warnings while all affected tasks executed and passed. These files and tooling behaviors were not changed by this candidate. This QA verdict does not replace independent review, designated exact-head sign-off, owner acceptance, or merge authorization. Existing build/coverage/cache outputs and the temporary seed/report directories are left for orchestrator cleanup; no manual directory deletion was performed.
