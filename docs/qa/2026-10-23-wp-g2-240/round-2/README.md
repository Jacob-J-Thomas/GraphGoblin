# WP-G2 / #240 round 2 evidence

## 1. Branch and worktree

- Starting and current HEAD: `ee0e6d17a6a365f87653d467a9b66accb18d0923`.
- Branch: `codex-wp-g2-240`.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-g2-240`.
- Clean at admission. Round-2 changes are uncommitted; ready for orchestrator commit, subject to the gate results below. No Git index, commit, branch or GitHub mutations.

## 2. Per bolt

The orchestrator approved #240 with one required change: remove its private browser harness and run the existing Events regression through the default configuration.

Deleted the two named single files, `apps/web/playwright.events.config.ts` and `apps/web/e2e/events-refresh-setup.ts`, and removed the deleted configuration's TypeScript include. No directory was deleted. The spec now obtains its isolated instance directly through `control(request, '/apps')`; its private-setup environment fallback is removed. It uses the existing `apps/web/playwright.config.ts` and shared global setup without an override.

The Events implementation and browser assertions are unchanged. The seed still posts the current untargeted `POST /events` body; #343's future contract is not anticipated here.

**Required browser result: PASS under the default configuration.** The exact requested command reports `1 passed (2.1m)`, exit 0. Its first-attempt test result is `Events admits arrivals only on Refresh, preserves filters and pages again (#240) (13.2s)`. No `--config` override or retry was used. The duplicate harness removal is complete; the separate web coverage gate remains failed as detailed below.

## 3. Files changed

- Web: delete `playwright.events.config.ts` and `e2e/events-refresh-setup.ts`; edit `tsconfig.json` and `e2e/events-refresh.spec.ts`.
- Evidence: add this report and `.log.txt` files; add a historical-record notice and round-2 link to the parent round-1 README. Original round-1 logs are preserved.
- No production code, API, contracts, client, dependencies or shared browser-harness files changed.

## 4. Tests

Browser regression: `Events admits arrivals only on Refresh, preserves filters and pages again (#240)` in `apps/web/e2e/events-refresh.spec.ts`. It covers first/older-page arrivals, stable rows/scroll/focus, deliberate Refresh, retained URL filters, subsequent opaque-cursor paging without duplicates and an empty filtered result. Only instance acquisition changed.

The single requested web coverage run finished with **126 files passed, 2 failed (128 executed)**, **1,603 tests passed and 2 failed (1,605 executed)**, plus **2 unhandled fork-worker startup errors**. The affected worker files did not execute. The command took 6,158.15 seconds and exited 1; no coverage percentages were emitted. Round-2 line and branch thresholds therefore remain unqualified. No unchanged retry was performed. The round-1 before-fix regression evidence remains historical in the parent report.

The two failures are `routing-review.test.ts:662` (`Test timed out in 60000ms`) and `EditorPage.restore.test.tsx:129` (`Unable to find role="heading" and name "legacy device copy"`). Worker startup failed for `NodeEditorDialog.test.tsx` and `model-pickers.test.tsx` with `Timeout waiting for worker to respond`. All four test files are unchanged. Their root causes were not established on a separate clean baseline; no pre-existing-defect or sandbox-exemption claim is made.

The browser regression passed through the built web app and the default shared test API, using its own isolated `/apps` instance and controlled providers. The shared test app uses a fixed fake clock and monotonic ULIDs; the passing arrival/paging assertions therefore also exercise equal timestamps with the ID ordering tie-breaker. This is controlled browser evidence, not live-provider evidence. See [browser-default.log.txt](browser-default.log.txt).

[scope.log.txt](scope.log.txt) records the absent private files, direct `/apps` acquisition and unchanged product/shared-harness paths. [progress.log.txt](progress.log.txt) records continuing intermediate coverage writes during the long run; those counts are not test totals or coverage percentages. [environment.log.txt](environment.log.txt) records the admitted head and runtime; [worktree-final.log.txt](worktree-final.log.txt) records the final branch, head and unstaged scope.

## 5. Gates

All commands run from the worktree root with Node `v22.14.0` first on PATH. Each log records its command and final exit code. Local user paths are normalized to `%USERPROFILE%`; no hash is claimed for pre-normalization bytes.

| Exact command                                                                        | Result                                                                               | Log                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                 | PASS: 20 tasks, exit 0                                                               | [typecheck.log.txt](typecheck.log.txt)             |
| `pnpm.cmd lint`                                                                      | PASS: 11 tasks, one existing warning, exit 0                                         | [lint.log.txt](lint.log.txt)                       |
| `pnpm.cmd format`                                                                    | PASS: exit 0, no unrelated tracked edits                                             | [format.log.txt](format.log.txt)                   |
| `pnpm.cmd check:docs`                                                                | PASS: generated docs up to date, exit 0                                              | [check-docs.log.txt](check-docs.log.txt)           |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`                    | FAIL: 2 failed, 1,603 passed, 2 worker-start errors; percentages not emitted; exit 1 | [web-coverage.log.txt](web-coverage.log.txt)       |
| `pnpm.cmd build`                                                                     | PASS: 11 tasks, exit 0                                                               | [build.log.txt](build.log.txt)                     |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/events-refresh.spec.ts` | PASS: `1 passed (2.1m)`, first attempt, exit 0                                       | [browser-default.log.txt](browser-default.log.txt) |

## 6. Docs

Round-1 evidence is explicitly marked historical and linked to this follow-up. No numbered product doc, ADR, CHANGELOG or generated reference changes are needed for removing duplicate test infrastructure; the accepted #240 behaviour is unchanged.

After completing the results, the two evidence READMEs were formatted and checked separately; see [format-evidence.log.txt](format-evidence.log.txt). All retained round-2 artifacts are below the 1,000,000-byte capture limit. No ignored raw coverage output or Playwright temporary output is cited as a retained artifact.

## 7. Decisions and parameters

- Use the standard browser configuration and its existing isolated `/apps` facility, with no alternative server setup or hard-coded port.
- Remove the private fallback along with its setup, retaining a single supported instance-acquisition path.
- Retain all existing browser assertions and the current event seed contract. The required coverage invocation uses one worker; no timeout, retry, threshold, exclusion or skip is added.
- Preserve the earlier evidence as a round-1 record; record the current default-harness result separately.

## 8. Caveats and open items

- WP-D4 (#343) will refuse Events without an explicit target loop and entry trigger. Whichever PR merges second must update this spec's seed helper for the resulting API contract, rebuild and rerun the browser spec. No anticipatory change is made here.
- The orchestrator commits these changes, opens the PR and runs QA. This worker does not grant independent QA or merge sign-off.
- Web coverage remains a failed gate for orchestration/reviewer triage: two unchanged editor tests failed and two other editor files could not start a worker. No round-2 coverage percentages are available. The existing `ThreadViewer.tsx:106` lint warning and Turbo cache-write `Access is denied` warnings are retained; affected commands with exit 0 remain passing.
- Default-browser qualification is complete. Independent QA, PR creation and any merge authority remain with the orchestrator. Round-1 API gate failures remain historical evidence; no round-2 API coverage result is claimed.
