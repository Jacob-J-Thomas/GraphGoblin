# WP-G1: #255 execution evidence

## 1. Branch and worktree

Branch `codex-wp-g1-255`, base `d32aa382cfc5578632e8b2b2cfd11813df9f8c44`.
Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-g1-255`.
Uncommitted; ready for orchestrator commit after the review process. Candidate file sizes and SHA-256 are in [implementation-files.json](implementation-files.json). Final scope and artifact checks are recorded in [final-check.json](final-check.json). No index changes, commits, GitHub writes, owner-store access or owner-port access.

## 2. Per bolt

**#255: confirmed UI defects, implemented.** The initial built frontend came from the clean base. Public API admission and controls created real SQLite histories in a disposable `gg-wp-g1-255-` directory. Browser and HTTP reads used built packages on port 6002; harness, classifier, LLM route and clock used injected engine ports. This establishes controlled-provider behavior, not live-provider behavior.

| Case                   | Inspector: before → after                                                                                                                                                                                                                         | Run list: before → after                                                             | API: before → after                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Append patch           | `/-` additions showed absent values → each recorded message/artifact addition is shown as Added value; exact event/thread remain available.                                                                                                       | Correct succeeded state → preserved, with original pinned loop name.                 | Recorded `add.value` and completed array were already present → unchanged.                                  |
| Classifier + LLM route | Chosen Label row already used the pin; timeline/alternative labels were absent and confidence showed long decimals → original labels beside IDs, 87.65% classifier and 91.23% informational LLM confidence; raw numbers inspectable/downloadable. | Correct succeeded state → preserved.                                                 | Both decisions, original route IDs, exact probabilities and immutable version already recorded → unchanged. |
| User cancellation      | No top cancellation context and empty terminal description → Cancelled by user local, recorded request/terminal sequence and node position when available; a cancelled run cannot show a stale provider failure Alert.                            | Cancelled badge → preserved. Actor evidence is available through the inspector link. | Cancel request with user/local and terminal cancellation, no run.failed → unchanged.                        |
| Run deadline           | Already showed RUN_DEADLINE_EXCEEDED → preserves the recorded deadline failure and raw failure event.                                                                                                                                             | Failed badge only → recorded deadline code/message also shown.                       | Status failed with RUN_DEADLINE_EXCEEDED → unchanged; the record is not reclassified as cancellation.       |
| Provider failure       | Recorded provider diagnostic already correct → preserved and exact failure event available.                                                                                                                                                       | Failed badge only → HARNESS_TRANSPORT_FAILED and recorded diagnostic shown.          | Controlled provider code/message already recorded → unchanged.                                              |
| Rename after run       | Labels were partly pinned but omitted on several surfaces → timeline, node progress, patch, wait and evaluation context use run.versionId.                                                                                                        | Current renamed loop name → original immutable run pin name.                         | Original run pin/version and new published names both readable → unchanged.                                 |

Before snapshots are in [before-readers.json](before-readers.json) and `before-*.png`; after snapshots are in [after-readers.json](after-readers.json) and `after-*.png`. Each reader capture includes the run, events, current thread, pinned version, run-list row, overview and selected-event text. The exact downloaded event is [after-decision-event.json](after-decision-event.json). Owner paths alone are normalized to `%USERPROFILE%`.

Screenshots: append: [before](before-append.png) / [after](after-append.png); decision: [before](before-decision.png) / [after](after-decision.png); cancelled: [before](before-cancelled.png) / [after](after-cancelled.png); deadline: [before](before-deadline.png) / [after](after-deadline.png); provider: [before](before-provider.png) / [after](after-provider.png).

Visual inspection of all five after captures confirmed the displayed appended values, pinned labels, cancellation context and distinct failure diagnostics. Native 390/768 px width checks also passed. This is implementation evidence; independent QA and owner acceptance remain separate.

No missing or unreadable engine/API fact was found. Therefore no contract, stored record or API read changed. In particular, the tested deadline is already recorded as `RUN_DEADLINE_EXCEEDED` with status `failed`; it is displayed as that recorded deadline failure. The provider inspector diagnostic and cancellation API status were already accurate on the base. The cancellation summary, terminal description, list causes and stale-failure suppression address reproduced presentation gaps without reclassifying history.

Additional component/projection checks cover unrecorded actors, missing terminal events, incomplete history, requests from a prior resumed attempt, unavailable pinned definitions and tiny/near-one probabilities. Native 390/768 px tests exercise maximum-length authored labels through input waiting, patch/evaluation panels and node progress.

## 3. Files changed

**Repository docs**

- `CHANGELOG.md`
- `docs/09-frontend-and-pwa.md`

**Web browser tests/configuration**

- `apps/web/e2e/classifiers.spec.ts`
- `apps/web/e2e/decision-routes.spec.ts`
- `apps/web/e2e/execution-evidence-setup.ts`
- `apps/web/e2e/execution-evidence.spec.ts`
- `apps/web/e2e/exit-primitives.spec.ts`
- `apps/web/playwright.evidence.config.ts`
- `apps/web/tsconfig.json`

**Web unit/component tests**

- `apps/web/src/runs/RunInspectorPage.test.tsx`
- `apps/web/src/runs/RunsPage.test.tsx`
- `apps/web/src/runs/inspector/EvaluationDetails.test.tsx`
- `apps/web/src/runs/inspector/ExecutionEvidence.test.tsx`
- `apps/web/src/runs/inspector/ThreadViewer.test.tsx`
- `apps/web/src/runs/projections.exact-values.test.ts`
- `apps/web/src/runs/projections.test.ts`

**Web runtime**

- `apps/web/src/runs/RunInspectorPage.tsx`
- `apps/web/src/runs/RunsPage.tsx`
- `apps/web/src/runs/inspector/EvaluationDetails.tsx`
- `apps/web/src/runs/inspector/ExecutionEvidence.tsx`
- `apps/web/src/runs/inspector/ProgressDrawer.tsx`
- `apps/web/src/runs/inspector/ThreadViewer.tsx`
- `apps/web/src/runs/inspector/Timeline.tsx`
- `apps/web/src/runs/inspector/WaitPanel.tsx`
- `apps/web/src/runs/projections.ts`

Shared-file changes against this base (new-file line ranges; imports included) are enumerated below. No edits to `useRunEvents.ts`, stream-status logic, `RunControls.tsx`, resume eligibility or failure actions. The control-adjacent failure Alert guard in `RunInspectorPage.tsx` only suppresses stale failure metadata when current status is not failed.

| File                                                     | Base ranges                                                                                                                                                     | Candidate ranges                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHANGELOG.md`                                           | 6 (anchor; no lines)                                                                                                                                            | 7-8                                                                                                                                                              |
| `apps/web/e2e/classifiers.spec.ts`                       | 1, 540                                                                                                                                                          | 1, 540                                                                                                                                                           |
| `apps/web/e2e/decision-routes.spec.ts`                   | 1, 689, 691                                                                                                                                                     | 1, 689, 691                                                                                                                                                      |
| `apps/web/e2e/exit-primitives.spec.ts`                   | 1, 194-195                                                                                                                                                      | 1, 194-195                                                                                                                                                       |
| `apps/web/src/runs/RunInspectorPage.test.tsx`            | 190, 836 (anchor; no lines)                                                                                                                                     | 190, 837-852                                                                                                                                                     |
| `apps/web/src/runs/RunInspectorPage.tsx`                 | 0 (anchor; no lines), 19, 84, 89-99, 101, 126, 143, 151-152, 170, 177 (anchor; no lines), 187 (anchor; no lines), 205                                           | 1, 20, 84 (anchor; no lines), 89, 91, 116-120, 137, 145-146, 164-170, 178, 189, 207                                                                              |
| `apps/web/src/runs/RunsPage.test.tsx`                    | 1, 32, 34 (anchor; no lines), 49, 236 (anchor; no lines)                                                                                                        | 1, 32-36, 39, 54, 242-263                                                                                                                                        |
| `apps/web/src/runs/RunsPage.tsx`                         | 44, 144, 147 (anchor; no lines)                                                                                                                                 | 43 (anchor; no lines), 143, 147-151                                                                                                                              |
| `apps/web/src/runs/inspector/EvaluationDetails.test.tsx` | 1, 264, 273-275, 320, 410, 474, 519-522, 555                                                                                                                    | 1, 264, 273-275, 320, 410, 474, 519-522, 555                                                                                                                     |
| `apps/web/src/runs/inspector/EvaluationDetails.tsx`      | 12, 92, 120, 157-158, 227, 229, 236, 277-278, 336, 371, 403, 407                                                                                                | 12-19, 99-109, 137-140, 177-178, 247, 249-253, 260, 301-305, 363, 398-402, 434, 438-442                                                                          |
| `apps/web/src/runs/inspector/ProgressDrawer.tsx`         | 1, 4, 63, 67, 75, 85, 88                                                                                                                                        | 1, 4, 63, 67, 75-81, 91-93, 96                                                                                                                                   |
| `apps/web/src/runs/inspector/ThreadViewer.test.tsx`      | 264 (anchor; no lines)                                                                                                                                          | 265-293                                                                                                                                                          |
| `apps/web/src/runs/inspector/ThreadViewer.tsx`           | 14, 28, 55, 234, 296                                                                                                                                            | 14-20, 34, 61-63, 242, 304-306                                                                                                                                   |
| `apps/web/src/runs/inspector/Timeline.tsx`               | 1, 20 (anchor; no lines), 22 (anchor; no lines), 62                                                                                                             | 1, 21, 24, 64-66                                                                                                                                                 |
| `apps/web/src/runs/inspector/WaitPanel.tsx`              | 0 (anchor; no lines), 18, 41, 56 (anchor; no lines)                                                                                                             | 1-2, 20-26, 49, 65-67                                                                                                                                            |
| `apps/web/src/runs/projections.test.ts`                  | 224, 267, 322                                                                                                                                                   | 224, 267, 322                                                                                                                                                    |
| `apps/web/src/runs/projections.ts`                       | 14, 161, 176, 181, 194, 196, 198, 200, 202, 212, 214, 216, 227, 228 (anchor; no lines), 233, 239, 251, 254, 257, 269, 278-279, 287, 296, 393 (anchor; no lines) | 14, 161, 176, 181-182, 195, 197, 199, 201, 203, 213, 215, 217, 227 (anchor; no lines), 229-230, 235-239, 245, 257, 260, 263, 275, 284-288, 296-299, 308, 406-451 |
| `apps/web/tsconfig.json`                                 | 1, 22 (anchor; no lines)                                                                                                                                        | 1, 23                                                                                                                                                            |
| `docs/09-frontend-and-pwa.md`                            | 80 (anchor; no lines)                                                                                                                                           | 81-86                                                                                                                                                            |

## 4. Tests

Regression evidence:

- [unit-before.log.txt](unit-before.log.txt): the appended-value projection returned undefined instead of recorded values, the route timeline omitted authored labels, and the append component omitted the recorded null. Four new regression tests failed on the base: “expected [ undefined, undefined, undefined ] to deeply equal [ null, …(2) ]” and “to contain Original ship (ship)”.
- [browser-before.log.txt](browser-before.log.txt): the representative test captured all five histories/readers before its expected failures for missing append value, renamed list name, missing timeline/alternative labels, missing exact-event disclosure/cancellation actor and missing list causes.
- [partial-history-before.log.txt](partial-history-before.log.txt): two new cancellation-history cases failed before distinguishing incomplete/missing terminal history. [partial-history-after.log.txt](partial-history-after.log.txt): all five ExecutionEvidence tests passed after that correction.

New and changed tests use public projections, actual components, public API controls and native browser reads. `projections.exact-values.test.ts` covers add/null/nested/escaped-pointer values, pinned labels, probability boundaries and cancellation attribution. `ExecutionEvidence.test.tsx` checks disclosure/large-value/download controls, exact numbers, missing pins, incomplete history and unknown actors. Existing inspector/list/evaluation/thread component tests cover the connected presentation. `execution-evidence.spec.ts` covers the five built-app histories, downloaded JSON equality, unavailable-pin behavior and two narrow-screen flows. Existing classifier, decision-route and exit specs were updated for labels/percentages.

**web**: 134 passed (134); 1673 passed (1673). Lines 98.9%, branches 94.96%, statements 98.01%, functions 98.41%. [Coverage summary](web-coverage-summary.json).

**domain**: 31 passed (31); 596 passed (596). Lines 98.48%, branches 95.79%, statements 97.32%, functions 97.13%. [Coverage summary](domain-coverage-summary.json).

**browser**: 3 passed (1.4m); exit 0.

**existing-browser**: 23 passed (4.9m); exit 0.

## 5. Gates

Node v22.14.0 was first on PATH. Commands ran from this worktree root through pnpm.

| Command                                                                                                                                   | Result   | Evidence                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                                      | PASS (0) | [typecheck.log.txt](typecheck.log.txt)                     |
| `pnpm.cmd format:check`                                                                                                                   | PASS (0) | [format-final-output.log.txt](format-final-output.log.txt) |
| `pnpm.cmd lint`                                                                                                                           | PASS (0) | [lint.log.txt](lint.log.txt)                               |
| `pnpm.cmd check:layers`                                                                                                                   | PASS (0) | [layers.log.txt](layers.log.txt)                           |
| `pnpm.cmd check:deps`                                                                                                                     | PASS (0) | [deps.log.txt](deps.log.txt)                               |
| `pnpm.cmd check:docs`                                                                                                                     | PASS (0) | [docs.log.txt](docs.log.txt)                               |
| `pnpm.cmd check:tokens`                                                                                                                   | PASS (0) | [tokens.log.txt](tokens.log.txt)                           |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`                                                                                        | FAIL (1) | [web-coverage.log.txt](web-coverage.log.txt)               |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`                                                                                     | PASS (0) | [domain-coverage.log.txt](domain-coverage.log.txt)         |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`                                                                         | PASS (0) | [web-coverage-serial.log.txt](web-coverage-serial.log.txt) |
| `pnpm.cmd build`                                                                                                                          | PASS (0) | [build.log.txt](build.log.txt)                             |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test -c playwright.evidence.config.ts`                                                | PASS (0) | [browser.log.txt](browser.log.txt)                         |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/exit-primitives.spec.ts e2e/classifiers.spec.ts e2e/decision-routes.spec.ts` | PASS (0) | [existing-browser.log.txt](existing-browser.log.txt)       |

Full format final output: [format-final-output.log.txt](format-final-output.log.txt). The result metadata is retained alongside each command log.

An earlier lint invocation found that the new Playwright config was missing from the TypeScript project and four assertions were unnecessary. The config was included and the assertions removed before the successful full lint gate; [lint-attempt-1.log.txt](lint-attempt-1.log.txt) retains the failure.

The first full web coverage attempt is retained separately: 16 editor/form timeout or asynchronous assertions failed, and a forks worker did not start (1,644 passed). Recovery reduces test-worker concurrency to one, after repository formatting completes. Test/hook timeouts and coverage policy are unchanged. This is a resource-contention diagnosis and bounded recovery, not a retry with identical conditions. The final result is reported above.

The initial non-TTY format invocation was interrupted after prolonged enumeration with no formatting verdict; it is recorded as interrupted, not a formatting failure. The completed root invocation and its exit status are retained. New QA Markdown was formatted and checked with `pnpm.cmd exec prettier --write docs/qa/2026-10-24-wp-g1-255/REPORT.md docs/qa/2026-10-24-wp-g1-255/NOT-KEPT.md` and `pnpm.cmd exec prettier --check docs/qa/2026-10-24-wp-g1-255/REPORT.md docs/qa/2026-10-24-wp-g1-255/NOT-KEPT.md`, both exit 0. Logs: [evidence-format.log.txt](evidence-format.log.txt), [evidence-format-check.log.txt](evidence-format-check.log.txt).

No engine/API/api-client coverage or licence gate was required because those packages and dependencies did not change. Domain coverage ran as explicitly requested.

## 6. Docs

`docs/09-frontend-and-pwa.md` documents exact values/downloads, add-patch values, pinned labels, percentage precision and missing-history/cancellation/provider semantics. The top Unreleased CHANGELOG bullet ends `(#255)`.
No decision, schema, route or stored record changed, so no ADR-0056, migration, upgrade instructions or generated-reference change was needed. `check:docs` still ran.

## 7. Decisions and parameters

- Add-patch cells use the recorded operation value, preserving each append and null even when the destination is `/-`; other patch semantics/reconciliation stay intact.
- Labels resolve only against `run.versionId`. Run-list names use the immutable pin; unavailable definitions yield an explicit notice and stable IDs, never live renamed labels.
- Probabilities show percentages to at most two decimal places. Positive values below 0.01% and values above 99.99% but below one use inequalities so formatting does not imply exact zero/one. Raw event and pinned-definition JSON retain exact recorded numeric values.
- Every selected event and the run/pinned definition have bounded JSON disclosures and an explicit JSON download at every size. Existing BoundedValue limits remain unchanged.
- Cancellation uses the latest terminal event and the preceding request within the current resume interval; it cites actor/request/terminal sequence only when recorded. Incomplete tail and missing terminal records are distinguished from a terminal cancellation with an unrecorded actor.
- Provider causes remain the recorded code/message. The tested deadline remains a deadline failure. The current status guards top-level failure rendering against stale metadata.
- Browser retries are zero. The dedicated server uses port 6002; the existing suites use `GG_E2E_MAIN_PORT=6003` and `GG_E2E_CONTROL_PORT=6004`, with their automatic ephemeral auxiliary servers. The dedicated port is within the assigned browser-compatible range. Physical stores use the prescribed prefix and are left for orchestrator cleanup.

## 8. Caveats and open items

The reduced-concurrency full web coverage run and the final build/browser suites passed. The initial parallel coverage failure remains recorded. The existing ThreadViewer useState lint warning is unchanged; Turbo also reported cache-access warnings with successful source-gate exit codes.

Independent review/QA, exact-head audit, integration and owner product acceptance are pending. A future PR must use **Part of #255**; this work does not close the bolt or establish integrated I07 completion.

Raw retained files must be included by the orchestrator in the eventual commit. [NOT-KEPT.md](NOT-KEPT.md) records oversized/local-only captures with byte sizes and SHA-256. Temporary stores, build backups and generated ignored coverage/browser output remain local; no manual directory deletion was performed.

Observed outside scope: `RunsPage.tsx:154`'s existing Started cell uses `run.startedAt ?? run.createdAt`. This is a source-only candidate for a separately admitted assessment; no native defect claim or fix is made here.
