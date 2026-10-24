# WP-G2 #240, round 3

## 1. Branch and worktree

- Branch: `codex-wp-g2-240`.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-g2-240`.
- Admission and base HEAD: `fb37c1b04ae23003b7020aaace2530f932b50a84` (first command: `git rev-parse HEAD`).
- Uncommitted implementation; no Git index changes, publication or integration. The orchestrator commits and runs independent QA again.
- Node `v22.14.0`, pnpm `12.8.1`: [environment](environment.log.txt). Every command below used PowerShell with Node 22 first on PATH and `pnpm.cmd` from the worktree root.

## 2. Per bolt: #240

All four defects were reproduced on the unchanged built admission HEAD before production edits, at **1440 × 900 and 390 × 900** in headless installed Edge `156.0.4314.42`. The real built API used disposable SQLite stores and port 5920. Its process was stopped, then restarted with a different PID against the same store. Harness ports were fakes supplied through the supported container overrides; no provider turns were run. [Before](reproduction-before.log.txt), [after](reproduction-after.log.txt), [diagnostic source](reproduce.mjs.txt).

| Defect and reading position                                                                                  | Before, quoted observation at both widths                                                                                                               | After at both widths                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1: two loaded pages, `type=qa-main`, exclusive `before=2099-01-01T00:00:00.000Z`; API stopped, then Refresh | `"beforeRows":200`, `"afterRows":0`, `"sameIds":false`, `"filtersRetained":true`; list replaced by Offline while header retained `New events available` | `"duringRows":200`, `"afterRows":200`, `"sameIds":true`, `"filtersRetained":true`. Header says `Refresh failed. Your current events are still shown. Refresh to try again.` Reading-anchor shift **0 px desktop, −0.5 px mobile**. After process restart, another deliberate Refresh brings the newest 100 rows, retains filters and announces the newest page. |
| D2: newest filtered page, both URL filters active                                                            | `"clearType":0,"clearBefore":0`                                                                                                                         | One named clear button per filter. `typeTab`, `beforeTab`, `firstFocus`, `finalFocus` all `true`; clearing type retains before, clearing before retains unrelated `keep=reader`. No horizontal overflow.                                                                                                                                                        |
| D3: successful Refresh from older loaded history to the newest page                                          | `"statuses":[""],"newestExplained":false`                                                                                                               | `"statuses":["Showing the newest events."],"newestExplained":true` in the existing polite live region.                                                                                                                                                                                                                                                          |
| D4: older loaded history with an arrival notice, then API stopped                                            | `"arrival":true,"checkFailed":false,"offlineBanner":true`; Events status still only `New events available`                                              | `"arrival":true,"checkFailed":true`; status includes `New events available Could not check for new events. Refresh to try again.` Recovery clears the check error while keeping the pending arrival information and the old rows until Refresh succeeds.                                                                                                        |

Reproduction commands (Node 22 first on PATH): pipe `Get-Content -Raw docs/qa/2026-10-23-wp-g2-240/round-3/reproduce.mjs.txt` into `node --input-type=module - before`, then repeat with `- after` following the production fix and rebuild. The first diagnostic attempt stopped when the intentionally missing D1 anchor was measured unconditionally. [Original failure](reproduction-before-attempt-1.log.txt) is retained. Only the diagnostic was repaired to record an absent anchor as `null`; the complete before run still used unchanged production code. The after command exited 0; its exit marker was appended separately after a transient log-sharing error, as labelled in the log. No product or test failure was retried away.

Before stores: `gg-wp-g2-240-r3-XHitWR` (PIDs 38148 → 50984), `gg-wp-g2-240-r3-aFu900` (29340 → 50044). After stores: `gg-wp-g2-240-r3-pr1RTg` (45928 → 40704), `gg-wp-g2-240-r3-rzQTPM` (54804 → 46684), all under `%USERPROFILE%\AppData\Local\Temp`. Owned API processes and browsers were closed; store directories were left intact. Owner ports 4747/4748, store and checkout were not used.

The default browser spec preserves its original first-page and older-page arrival checks, scroll/focus preservation, opaque-cursor paging, uniqueness, filters and empty-result checks. Its added case covers an isolated HTTP outage, failed Refresh with all 200 rows and the anchor retained, recovery, newest-page status, exact API-to-UI cursor sequence after Refresh, and keyboard clearing of each filter. Native process restart evidence above supplements that listener outage.

## 3. Files changed

Web production:

- `apps/web/src/api/queries.ts`: manual first-page read with atomic cache replacement on success; no destructive reset on failure. Existing history membership, receipt updates and availability checks retained.
- `apps/web/src/events/EventsPage.tsx`: separate filter clear controls and focus return; independently composed pending, failure, arrival, check-failure and newest-page statuses.
- `apps/web/src/components/HistoryState.tsx`: optional cached-data retention on refetch errors, enabled only for Events.

Web tests:

- `apps/web/src/events/EventsPage.recovery.test.tsx`: five public-page recovery, orientation, keyboard and filter-race regressions.
- `apps/web/src/events/EventsPage.refresh.test.tsx`: wait for the Refresh control's accessible busy state before activation.
- `apps/web/e2e/events-refresh.spec.ts`: add outage/recovery, status, cursor and keyboard regression under the default configuration.
- `apps/web/e2e/server.ts`: existing `/api/listener` control now accepts the existing `instanceId` selector, so only the spec's `/apps` instance stops; teardown restores paused instances before closing them.

Docs: `docs/09-frontend-and-pwa.md`, top #240 `CHANGELOG.md` bullet, and this evidence directory. No API route, OpenAPI document, generated client, dependency, migration or ADR changed. Shared files outside WP-G2's primary-file list are `HistoryState.tsx` and the existing browser server; their changes are limited to the opt-in error policy and per-instance listener control. No other wave's assigned production region changed. Shared-file touched ranges: `HistoryState.tsx` lines 13, 18, 32–36 and 50–52; `e2e/server.ts` lines 196–202, 285 and 525, plus removal of base line 191.

## 4. Tests

Four new regression cases were executed before the production fix: **1 file failed, 4 tests failed**, exit 1 ([log](regressions-before.log.txt)):

- `keeps both loaded pages during a Refresh and after failure, then commits a successful newest page`: `expect(element).toBeInTheDocument()` failed immediately after the held refresh read started, because the old row had been removed.
- `clears each filter with the keyboard, preserves other parameters and returns focus to Refresh`: `Unable to find an accessible element with the role "button" and name "Clear type filter"`.
- `announces that a successful Refresh is showing the newest events in the existing live region`: `Unable to find an element with the text: Showing the newest events.`
- `reports a failed check alongside an existing arrival notice and clears only the failure on recovery`: expected `Could not check for new events`; received only `New events available`.

The first focused after run passed **3 files / 15 tests** ([log](events-components-after.log.txt)). A fifth case was then added: `keeps a late Refresh response scoped to the filters it started with`, covering a filter cleared during the pending read. The final focused run passed **3 files / 16 tests**, including the fifth case and both existing Events suites ([log](events-components-final.log.txt)). The default browser run passed **2 tests**, exit 0, with retries explicitly disabled; bodies took **9.6 s** and **11.8 s** (2.9 minutes including harness startup and teardown).

Initial typecheck found unsupported Testing Library `exact` options in the new tests; [failure](typecheck-attempt-1.log.txt) retained, options removed. Lint found a new test's redundant `async`, then the synchronous `act` overload's non-Promise await; [first](lint-attempt-1.log.txt) and [second](lint-attempt-2.log.txt) failures retained. The final form explicitly returns a Promise from `act`. Production fixes were not changed to conceal failures, and thresholds, exclusions, test budgets and retry settings were not relaxed.

The full requested web coverage command passed **131 files / 1,643 tests**, exit 0, in **2,841.76 seconds**. Coverage: **98.92% lines (7,468/7,549), 94.98% branches (7,777/8,188), 98.04% statements and 98.48% functions**. All policy thresholds remain unchanged and pass. [Full run](web-coverage.log.txt), [generated coverage summary](coverage-summary.log.txt). No files failed, so the requested one-time isolated rerun exception was not needed. The earlier round-2 failures are historical and are not reported as round-3 failures.

## 5. Gates

Exact commands, from the worktree root with Node 22 first on PATH:

| Command                                                                                          | Result                                                      | Evidence                                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                                                             | PASS after correcting the new test types                    | [initial passing log](typecheck.log.txt), [final log](typecheck-final.log.txt) |
| `pnpm.cmd lint`                                                                                  | PASS; existing ThreadViewer warning only                    | [log](lint.log.txt)                                                            |
| `pnpm.cmd format`                                                                                | PASS                                                        | [log](format.log.txt)                                                          |
| `pnpm.cmd check:docs`                                                                            | PASS                                                        | [log](check-docs.log.txt)                                                      |
| `pnpm.cmd check:layers`                                                                          | PASS                                                        | [log](check-layers.log.txt)                                                    |
| `pnpm.cmd check:deps`                                                                            | PASS                                                        | [log](check-deps.log.txt)                                                      |
| `pnpm.cmd check:tokens`                                                                          | PASS                                                        | [log](check-tokens.log.txt)                                                    |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`                                | PASS: 131 files, 1,643 tests; lines 98.92%, branches 94.98% | [log](web-coverage.log.txt)                                                    |
| `pnpm.cmd build`                                                                                 | PASS, 11 successful tasks, 10 cached                        | [log](build.log.txt)                                                           |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/events-refresh.spec.ts --retries=0` | PASS: 2 tests, zero retries, default `playwright.config.ts` | [log](browser-default.log.txt)                                                 |

The final repository `pnpm.cmd format:check` also passed ([log](format-check.log.txt)). The admission build also passed ([log](build-before.log.txt)). Non-fatal Turbo `Access is denied` cache I/O warnings and Vite's existing large-chunk warning are retained in their logs. The existing untouched `ThreadViewer.tsx` lint warning is not treated as an error. API/client coverage is not required for this web-only change.

## 6. Docs

- Numbered `docs/09`, Events/history section: successful replacement, retained rows during pending/failed Refresh, retry message, newest-page announcement, individual filter clearing with focus return, independent check error and recovery.
- The existing #240 bullet remains at the top of `## Unreleased`, updated for these behaviors and ending `(#240)`.
- No API or settled architecture decision changed; no generated reference or ADR update required. `check:docs` passed.

## 7. Decisions and parameters

- Keep the existing two-second `limit=1` availability check and pending-receipt poll. No count/scan, arrival insertion, focus/reconnect replacement, cursor change or new endpoint.
- Refresh is a separate manual GET. It uses `networkMode: 'always'` so an explicit offline attempt fails visibly rather than being queued for automatic later execution. Only success cancels older history reads and atomically installs one fresh first page and its cursor. Mutation state is scoped by filters; the late-response regression protects a newer filter selection.
- Events opts into retaining cached rows if receipt polling also fails. Other `HistoryState` consumers retain their existing policy.
- Refresh uses `aria-disabled` with an activation guard while busy, following the existing history button pattern. It remains focusable so removing a clear control can reliably return focus during the next filter fetch.
- Compose arrival and check-failure messages independently in the existing mounted polite live region. A successful Refresh announces the newest page; a later arrival suppresses that now-stale newest claim.
- Browser setup batches at most 20 seed requests concurrently, then uses the real isolated API listener outage. The default test configuration, 60-second test budget and 10-second assertions remain unchanged, and retries are explicitly zero. The native diagnostic is a retained one-off QA script, not a private suite configuration or server harness.

## 8. Caveats and open items

All requested local gates pass. No implementation defect remains open from D1–D4. Independent QA acceptance and verification of the eventual committed PR HEAD remain with the orchestrator; this report makes no new CI claim for the uncommitted working tree.

- This is implementation verification, not independent QA acceptance. The orchestrator commits and runs independent QA again, then owns PR #394 and integration.
- The spec still posts untargeted `POST /events` under this HEAD's contract. Whichever PR merges second with WP-D4 #343 must update its seeds for the explicit target loop and entry trigger; that contract was deliberately not anticipated here.
- Original independent QA's passing 5,000-event/performance and wider acceptance observations were read as background evidence; this round does not present them as new measurements.
