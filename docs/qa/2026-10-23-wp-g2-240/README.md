# WP-G2 / #240 implementation evidence

**Round 1 record.** The follow-up [round-2 report](round-2/README.md) removes the private browser harness and records the default-configuration result. The logs below remain the original round-1 evidence.

## 1. Branch and worktree

- Branch: `codex-wp-g2-240`.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-g2-240`.
- Base: `fbd48d3da5f162539964516a34d5de7e387d63c6` (clean at admission).
- Uncommitted; ready for orchestrator commit with the gate caveats below. No Git index, commit, branch, GitHub or owner-instance mutations. Include the evidence files alongside the source in that commit before downstream QA cites them as committed artifacts.

## 2. Per bolt

**#240: confirmed baseline gap; implementation supplied.** The built baseline was reproduced before implementation with the real built API, built web app, Edge, port 5920 and an independent physical SQLite store named `gg-wp-g2-240-baseline-*` under the system temp directory. No loops or provider turns were started. [baseline.mjs](baseline.mjs) is the retained reproduction program; [baseline-complete.log.txt](baseline-complete.log.txt) contains the completed observations.

| Reading position               | Before                                                                                                                                                                                                                                                                                                            | After and evidence                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First page, no pending receipt | `"unchanged":true,"backgroundReads":0,"refreshControls":0` after arrival and 2.4 seconds. No in-page means to bring arrivals in.                                                                                                                                                                                  | One-row availability checks announce new events; rows remain fixed until Refresh. Component test `keeps the first page stable until Refresh and retains existing pending-receipt updates`; built browser regression.                                                                                |
| Older appended page            | `"unchanged":true,"rows":101,"backgroundReads":0,"newerNotice":0`. No automatic jump, and no indication that arrivals exist.                                                                                                                                                                                      | Notice without row, scroll or focus replacement; Refresh deliberately returns to a fresh first page, and Load more uses its new opaque cursor. Component test `announces arrivals on an older page without replacing rows, then refreshes and pages with filters intact`; built browser regression. |
| URL filters                    | Request was only `/events`; `"excludedTypeVisible":1`. The URL retained `type` and `before`, but neither affected the result. No background reads after arrival.                                                                                                                                                  | `type` and `before` are applied, visibly displayed, and retained on list, probe, Refresh and subsequent cursor requests. Unrelated event types stay excluded. Component and browser assertions cover the URL and results.                                                                           |
| Pending receipt                | Controlled public-page regression on the unchanged baseline failed: `expected document not to contain element, found <pre ... data-testid="payload-new-arrival">`. Its existing two-second refetch admitted the arrival without asking. This is component evidence, separate from the native no-pending baseline. | Background polling updates matching loaded receipt fields while retaining row identities, order and original page boundaries. The same regression passes after the fix.                                                                                                                             |
| Empty result                   | No deliberately refreshed, filtered page was available; URL filters were ignored.                                                                                                                                                                                                                                 | `No inbound events match these filters.` for an empty filtered result; existing `No inbound events yet.` for an unfiltered empty result. First arrival is announced and requires Refresh. Component and browser checks.                                                                             |

The synthetic visibility event in the native baseline did **not** cause a refetch; no live focus-reordering claim is made. Source defaults enabled focus/reconnect refetch, but the observed no-pending native pages stayed fixed. [baseline.log.txt](baseline.log.txt) retains the first reproduction attempt, whose additional visibility assertion timed out; the assertion was replaced with a recorded observation before the completed baseline run. Its startup output and browser captures were not kept.

## 3. Files changed

- Web: `src/api/queries.ts` and `src/api/queries.reconnect.test.tsx`, `src/events/EventsPage.tsx`, existing `EventsPage.test.tsx`, new `EventsPage.refresh.test.tsx`, new `e2e/events-refresh.spec.ts`, `e2e/events-refresh-setup.ts`, `playwright.events.config.ts` and its explicit `tsconfig.json` include entry.
- Documentation: Events paragraphs in `docs/09-frontend-and-pwa.md`; the consumer-history paragraph in `docs/07-api-and-streaming.md`; one shared `CHANGELOG.md` bullet at the top of Unreleased; this evidence directory.
- No API, generated client, contract, infrastructure, migration or dependency changes. WP-D4's shared `triggers.ts` is untouched. The shared docs/09 edit is confined to Events; no editor or inspector sections changed. **Shared WP-D4 file:** docs/07 changes only the history-consumer paragraph around lines 423 to 432, removing its now-stale statement that manual Events refresh is absent; no route or streaming sections changed. No files owned by held PRs #355/#375 changed.

## 4. Tests

New component regressions in `apps/web/src/events/EventsPage.refresh.test.tsx` exercise the public page and the normal fake HTTP port. They cover older and first pages, pending-receipt polling, filters, refresh, subsequent paging, empty results and failed availability checks. Existing pending-disposition and unmount tests still distinguish receipt polling from the new one-row availability checks.

New test names:

- `announces arrivals on an older page without replacing rows, then refreshes and pages with filters intact`
- `keeps the first page stable until Refresh and retains existing pending-receipt updates`
- `shows an empty filtered result and refreshes it without losing the filter`
- `retains history when an availability check fails and lets the reader refresh`
- Browser: `Events admits arrivals only on Refresh, preserves filters and pages again (#240)`

Changed existing tests: `appends an exactly full final event page and preserves expanded content and keyboard focus` now verifies active URL filters; `refreshes a pending receipt when it becomes $state and stops polling` and `stops pending refreshes when the Events page unmounts` distinguish history reads from availability checks. The reconnect matrix `recovers the cold offline $name query` preserves its three history attempts and separately verifies Events' one availability check.

[regression-before.log.txt](regression-before.log.txt) records **three failures before the production change**:

- `Unable to find an element with the text: New events available.`
- `expected document not to contain element` for `payload-new-arrival` after a pending-receipt poll.
- `Unable to find an element with the text: No inbound events match these filters.`

[events-after.log.txt](events-after.log.txt) records the first targeted post-fix pass: 2 files, 10 tests. Additional negative-case coverage and final full-package results are recorded separately in the gate logs.

[events-final.log.txt](events-final.log.txt) records **2 files and 11 tests passing**, including the added availability-check fault case. [browser-built.log.txt](browser-built.log.txt) records **1 browser test passing**, with zero retries, against the built API and web app.

The complete web run subsequently exposed two assertions affected by the new background request. [reconnect-before.log.txt](reconnect-before.log.txt) establishes successful offline recovery followed by `expected "vi.fn()" to be called 3 times, but got 4 times`; its repaired test separately requires three history attempts and one availability check. The older-page test identifies cursor-bearing continuation requests instead of assuming the last HTTP call is paging, and waits for the enabled Refresh control. Its interval clock is driven explicitly through supported fake timers, leaving input and rendering timers real. [events-reconnect-verified.log.txt](events-reconnect-verified.log.txt) records **42 tests passing across the three Events/reconnect files** after these test changes. These focused passes do not turn earlier full-package failures green.

The new browser spec exercises real event ingestion and history through a built API and built web app in Edge, with a separate `gg-wp-g2-240-browser-*` physical store and port 5921. It checks first and older reading positions, unchanged rows/scroll/keyboard focus before refresh, filters and URL, fresh first-page membership, correct subsequent pagination without duplicates, and an empty filtered result. The dedicated configuration has retries disabled.

The settled full-package run in [web-coverage-settled.log.txt](web-coverage-settled.log.txt) passes **130 files and 1,638 tests**, with **98.93% lines (7,456/7,536), 94.97% branches (7,763/8,174), 98.48% functions (2,274/2,309) and 98.03% statements (8,550/8,721)**. No threshold or exclusion changed. API/client production code did not change; the attempted API coverage run failed before emitting percentages, and API-client coverage was not required.

## 5. Gates

Every gate selects Node `v22.14.0` first on PATH and runs through `pnpm.cmd`. Logs are retained in this directory; `EXIT_CODE` is authoritative. PowerShell can render ordinary pnpm stderr as `NativeCommandError` text even when the final exit code is zero. Turbo cache write warnings are also retained.

| Exact command                                                                                | Result                                                                                        | Retained log                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm.cmd typecheck`                                                                         | PASS: 20 tasks, exit 0                                                                        | [typecheck-handoff.log.txt](typecheck-handoff.log.txt)       |
| `pnpm.cmd lint`                                                                              | PASS: 11 tasks, exit 0; one untouched ThreadViewer warning                                    | [lint-handoff.log.txt](lint-handoff.log.txt)                 |
| `pnpm.cmd format:check`                                                                      | PASS: all matched files use Prettier style, exit 0                                            | [format-check-handoff.log.txt](format-check-handoff.log.txt) |
| `pnpm.cmd check:layers`                                                                      | PASS, exit 0                                                                                  | [check-layers-final.log.txt](check-layers-final.log.txt)     |
| `pnpm.cmd check:deps`                                                                        | PASS: no errors, one untouched orphan warning, exit 0                                         | [check-deps-final.log.txt](check-deps-final.log.txt)         |
| `pnpm.cmd check:tokens`                                                                      | PASS: 169 source files, exit 0                                                                | [check-tokens-final.log.txt](check-tokens-final.log.txt)     |
| `pnpm.cmd check:docs`                                                                        | PASS: generated docs up to date, exit 0                                                       | [check-docs-final.log.txt](check-docs-final.log.txt)         |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2`                            | FAIL on earlier test snapshot: 7 failed, 1,431 passed, 12 worker-start errors; no percentages | [web-coverage-bounded.log.txt](web-coverage-bounded.log.txt) |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=2 --coverage.reportOnFailure` | PASS: 130 files, 1,638 tests; all four coverage thresholds passed; exit 0                     | [web-coverage-settled.log.txt](web-coverage-settled.log.txt) |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --maxWorkers=2`                            | FAIL: 9 failed, 1,312 passed, 8 skipped; 4 failed files, 60 passed, 2 skipped; exit 1         | [api-coverage.log.txt](api-coverage.log.txt)                 |
| `pnpm.cmd build`                                                                             | PASS: 11 tasks, exit 0                                                                        | [build-handoff.log.txt](build-handoff.log.txt)               |
| From `apps/web`: `pnpm.cmd exec playwright test --config playwright.events.config.ts`        | PASS: 1 test after final build, zero retries, exit 0                                          | [browser-handoff.log.txt](browser-handoff.log.txt)           |

The exact unrestricted `pnpm.cmd --filter @graphgoblin/web test:coverage` attempt was interrupted for resource contention; [web-coverage.log.txt](web-coverage.log.txt) is its partial output. The bounded invocation is the complete-package attempt, not a test subset. API-client coverage was not run because the package did not change. No dependency change required a license gate or new ledger entry.

The first `pnpm.cmd exec playwright test e2e/events-refresh.spec.ts e2e/history.spec.ts` attempt failed in the shared source-server global setup before any test ran: `the E2E server did not start within 60 s` ([browser.log.txt](browser.log.txt)). The dedicated built-API setup replaced that dependency for the new spec. The existing history spec's assertions were not exercised in that failed attempt; the passing dedicated spec independently covers cursor paging after refresh.

The earlier full web run failed seven tests and could not start twelve fork workers (`Timeout waiting for worker to respond`). Two failures were feature-related request assertions: the recovered Events query made four calls rather than three, and the older-page test saw `expected null to be 'event-2'` because it treated the last availability request as paging. These assertions were repaired without removing the UI/data checks; the new polling tests use a fake interval clock. The settled full web run started after the API and static batches finished; the final native browser check ran briefly alongside it. `--coverage.reportOnFailure` changes reporting only, so coverage would remain inspectable if unrelated tests failed. All 130 files and 1,638 tests passed on the settled run. Earlier failures remain recorded, and the current API failures were not rerun unchanged to green.

Earlier typecheck/lint attempts caught errors in the new code and harness: exact optional cursor typing, Testing Library options, an async callback, and the missing TypeScript include for the new config. They were fixed before the final passing commands, rather than retried unchanged. An earlier repository-wide format attempt was interrupted during implementation after its warning for the then-changing query file; the completed final root format gate and the separate [format-touched.log.txt](format-touched.log.txt) are passing.

## 6. Docs

`docs/09-frontend-and-pwa.md` documents Refresh, stable membership and cursors, displayed URL filters, filtered/unfiltered emptiness, separate presence checks, pending receipt updates, check failures and focus/reconnect behaviour. The history-consumer paragraph in docs/07 is synchronized because it explicitly said manual refresh was absent; the API contract is unchanged. The new top Unreleased bullet ends `(#240)`. OpenAPI, generated references and generated client stay unchanged. No ADR or migration is required.

## 7. Decisions and parameters

- Poll availability every two seconds, requesting only one newest matching event. The existing route supports this already. Presence rather than an exact count avoids traversing history or adding a route parameter. The response still includes the normal event payload; this is a bounded row count, not a payload-byte optimization.
- Compare exposed event `(receivedAt, id)` fields in their documented descending ordering. Never parse, construct or modify an opaque cursor.
- Preserve loaded row membership, order and `nextCursor` on background refetch; merge matching row data to retain pending-receipt recovery. Focus, reconnect and remount do not automatically replace history. An explicit exact-key query reset admits new membership and starts fresh paging.
- Retain the existing two-second pending-receipt interval. A row displaced beyond the fetched range by many arrivals can retain its last receipt data until Refresh; the preserved row stays marked pending and continues polling. Refresh obtains current data. No claim is made that a presence probe follows all off-page receipt changes.
- Apply the requested type/time filter preservation to URL filters and show them plainly in the page. The baseline's intentional lack of Events filters is recorded above rather than silently assumed to support them.
- The dedicated browser setup uses 5921, a disposable prefixed store and a 250 ms readiness interval (up to 121 attempts, each health request bounded to two seconds). It stops only its own spawned process and leaves the store for cleanup. These are engineering choices, not owner-approved parameters.
- Under the default browser suite the new spec requests an isolated control-server app, preserving other specs' data. Under the dedicated config it uses the built API directly; that setup clears the control-server URL in its own test process. [browser-verified.log.txt](browser-verified.log.txt) records the current native spec passing with this isolation handling.
- Package coverage uses two workers to bound resource use. The initial unrestricted web coverage attempt was stopped when it stalled concurrent checks; its partial log is retained, with no passing claim. The first ordinary browser run failed shared source-server startup before tests, so the new spec uses the built API setup rather than retrying that harness to green.
- New component tests drive the two-second interval with a fake interval clock; asynchronous rendering and user input retain real timers. Browser scroll comparisons retain the sibling #231 specification's one-pixel tolerance for subpixel rounding. The built-API startup diagnostic keeps only its last 64,000 characters.

## 8. Caveats and open items

Independent Claude review, independent Sol QA, Astra audit and the batch's exact-head merge sign-off remain with the orchestrator. This implementation does not grant any of them or close the bolt.

Disposable stores, ignored package coverage output and any ignored Playwright output are preserved for orchestrator cleanup; no directories were deleted. Files cited here are retained under repository names, except captures explicitly recorded as not kept. Logs are sanitized only for local user-path spelling (`%USERPROFILE%`); no recorded hash refers to pre-sanitization log bytes.

The current API coverage failures need orchestration/reviewer triage before claiming a completely green gate set. All nine are native timing/state-wait failures in unchanged files; their root cause was not established on a separate baseline. Register D-015 documents specific infrastructure process-tree denials in the Codex sandbox, but these API logs do not establish that same denial, so no automatic exemption or passing claim is applied.

Observed outside scope, left unchanged:

- `apps/web/src/runs/inspector/ThreadViewer.tsx:106`: ESLint `@eslint-react/use-state` warning.
- `packages/infrastructure/drizzle.config.ts:1`: dependency-cruiser `no-orphans` warning.
- The earlier web run reported timeouts in `NodeEditorDialog.test.tsx:829`, `DecisionAuthoring.test.tsx:372`, `harness-switch.test.tsx:124`, and `ThreadViewer.test.tsx:165` and `:191`. These tests are unchanged and passed on the settled full run; the earlier timeout observations remain in the log and are not claimed to be confirmed baseline defects.
- The API run reported failures in `triggers/github-recipe.test.ts:144`, `subloop-restart.test.ts:133`, `:191` and `:253`, `main.test.ts:49`, `:67`, `:87` and `:101`, and the disposal hook at `retired-event-startup.test.ts:23`. Its result is 9 failed, 1,312 passed and 8 skipped, with no coverage percentages emitted.
- Browser qualification is desktop Edge at 1440 by 900. No claim of separate mobile qualification or live-provider behaviour is made.
- `TODO(#343 integration):` when integrating WP-D4, reconcile the Events browser seed helper (`e2e/events-refresh.spec.ts`, its current `POST /events` body) with the targeted-event request contract, then rebuild and rerun the spec. The present helper follows the accepted base's contract; no compatibility path is added.
