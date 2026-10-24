# Independent QA: #240 round 2

## 1. Verdict

**FAIL** at `cc1c3fceca4f9ed914915fd1e2a2e2fbde6cecd1`. **The 70 product/browser checks pass and D1-D4 are resolved; this verdict is caused by the nonzero full coverage gate (V1).** The four round-1 defect reproductions and all seven original cases were exercised at **1440 x 900** and **390 x 900** in real Edge. The late-response, rapid Refresh, filter-clearing and shared-history regressions are recorded below. No production code or maintained tests were changed; no staging, commits, branch operations, GitHub writes or owner-environment actions were performed. The worktree is intentionally detached.

### Environment and provenance

- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-g2-240`. Node `v22.14.0` first on PATH; Edge `156.0.4314.42`, channel msedge, headless. [admission.json](admission.json).
- Built API, real HTTP, SQLite and actual child processes; both harness ports injected with public FakeHarness overrides. **Fake-harness-only:** no provider turns and no claim of live-provider behavior. Minimal history loops contain only a manual trigger and exit.
- API keys minted by the built binary; secrets used in local storage/bearer headers and not retained. All Events created by untargeted `POST /events` with only type/payload.
- Primary stores: `%USERPROFILE%\AppData\Local\Temp\gg-qa-g2-240-ManU4g` and `%USERPROFILE%\AppData\Local\Temp\gg-qa-g2-240-rO8qPF`, reused serially on `http://127.0.0.1:5820`. New PIDs reopen the same data directory on restart. All native instances use the assigned port range and data prefix. Every recorded ready API has a matching STOPPED marker; see [outcomes.json](outcomes.json).
- Normal seven-case contexts allow service workers. Only the controlled race/error context blocks service workers so Playwright transport interception is deterministic. Those faults are labelled controlled, not real server failures. Actual process stop/restart supplies native outage evidence separately.
- First cold startup exceeded the QA script's 20-second setup allowance, then stopped cleanly before any product assertion. Retained [startup-attempt.json](startup-attempt.json), [startup-attempt.log.txt](startup-attempt.log.txt), [startup-server.log.txt](startup-server.log.txt); setup allowance increased to 60 seconds only. Product expectations were unchanged.
- Implementer/reviewer reports are claims; this report uses independently collected evidence. Round-1 before values are historical measurements at fb37c1b0 from the retained parent folder, not re-execution of that old head.

## 2. Defects

No remaining product defect has been reproduced in the completed browser checks. D1-D4 disposition is shown per width below. This is independent QA evidence for #240, not merge sign-off or integrated acceptance of #310/#289.

| Defect                       | Width | Before at fb37c1b0                                                                                     | Actual after at this head                                                                                           | Result / evidence                                                                                                                                                  |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1: failed Refresh           | 1440  | 200 to 0 rows; [../1440-failed-refresh-keeps-rows.json](../1440-failed-refresh-keeps-rows.json)        | **200 to 200**; same IDs and URL; explicit refresh-failed/retry message                                             | PASS; [1440-failed-refresh-keeps-rows.json](1440-failed-refresh-keeps-rows.json), [1440-failed-refresh.png](1440-failed-refresh.png)                               |
| D2: filter clearing          | 1440  | No clear controls; [../1440-filter-clearing-controls.json](../1440-filter-clearing-controls.json)      | Both named controls reached via Tab/Enter; each removes only its parameter, retains keep=reader and focuses Refresh | PASS; [1440-D2-keyboard-clear-controls.json](1440-D2-keyboard-clear-controls.json)                                                                                 |
| D3: orientation              | 1440  | No position status; [../1440-refresh-position-explained.json](../1440-refresh-position-explained.json) | Showing the newest events. after successful Refresh                                                                 | PASS; [1440-refresh-position-explained.json](1440-refresh-position-explained.json), [1440-filters-refresh.png](1440-filters-refresh.png)                           |
| D4: notice plus failed check | 1440  | Arrival notice hid failed check; [../1440-notice-outage.json](../1440-notice-outage.json)              | Both messages visible; recovery clears only failure and retains pending notice and all rows                         | PASS; [1440-notice-outage.json](1440-notice-outage.json), [1440-notice-outage.png](1440-notice-outage.png), [1440-notice-recovered.png](1440-notice-recovered.png) |
| D1: failed Refresh           | 390   | 200 to 0 rows; [../390-failed-refresh-keeps-rows.json](../390-failed-refresh-keeps-rows.json)          | **200 to 200**; same IDs and URL; explicit refresh-failed/retry message                                             | PASS; [390-failed-refresh-keeps-rows.json](390-failed-refresh-keeps-rows.json), [390-failed-refresh.png](390-failed-refresh.png)                                   |
| D2: filter clearing          | 390   | No clear controls; [../390-filter-clearing-controls.json](../390-filter-clearing-controls.json)        | Both named controls reached via Tab/Enter; each removes only its parameter, retains keep=reader and focuses Refresh | PASS; [390-D2-keyboard-clear-controls.json](390-D2-keyboard-clear-controls.json)                                                                                   |
| D3: orientation              | 390   | No position status; [../390-refresh-position-explained.json](../390-refresh-position-explained.json)   | Showing the newest events. after successful Refresh                                                                 | PASS; [390-refresh-position-explained.json](390-refresh-position-explained.json), [390-filters-refresh.png](390-filters-refresh.png)                               |
| D4: notice plus failed check | 390   | Arrival notice hid failed check; [../390-notice-outage.json](../390-notice-outage.json)                | Both messages visible; recovery clears only failure and retains pending notice and all rows                         | PASS; [390-notice-outage.json](390-notice-outage.json), [390-notice-outage.png](390-notice-outage.png), [390-notice-recovered.png](390-notice-recovered.png)       |

D1 exact status: `Refresh failed. Your current events are still shown. Refresh to try again.` D4 outage status: `New events available Could not check for new events. Refresh to try again.` D4 recovery is verified against a restarted process and unchanged row IDs, not only a cleared banner.

### V1 — Major verification blocker: the full coverage command could not start one worker

This is a test-run infrastructure failure, not a reproduced application defect or a reopened D1-D4 finding. Reproduction command: `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`, with Node 22 first on PATH after build. Expected: every test file starts and the command exits 0. Actual: **130 files / 1642 tests passed**, but Vitest reported `Failed to start forks worker` for `src/components/ErrorBoundary.test.tsx`, caused by `Timeout waiting for worker to respond`, and exited **1** after **4185.00 s**. No failed assertion was reported; the one file's test body did not execute in that run.

The one unexecuted file was then run once in isolation, without coverage or changed timeouts. Its command exited **0**. [error-boundary-isolated.log.txt](error-boundary-isolated.log.txt), [error-boundary-isolated.json](error-boundary-isolated.json). This closes only the omitted test-body check if it passes; **the original full coverage gate remains failed**. No whole-suite retry was made and the first error is retained. Evidence: [web-coverage.log.txt](web-coverage.log.txt), [coverage-result.json](coverage-result.json), [test-totals.json](test-totals.json).

## 3. Coverage of criteria

### Original seven cases

| Case                             | 1440 px                                                                                                            | 390 px                                                    | Result                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------- |
| Arrival while reading page 3     | 300 rows stable; notice **1912 ms** after 202; scroll 23593 to 23593                                               | 300 rows stable; **1386 ms**; scroll 97986 to 97986       | PASS; unchanged order/focus/boundaries              |
| Refresh                          | Newest 100 equal API; next 100 give 200 unique IDs; type/before retained; newest status                            | Same                                                      | PASS                                                |
| URL filters                      | Both shown; independent keyboard clearing and URL retention verified                                               | Same                                                      | PASS                                                |
| Empty results                    | Separate empty-store/filter text; later match announced in 1957 ms from POST start; appears on Refresh             | Same; 2095 ms                                             | PASS                                                |
| Reconnect/errors                 | Old 200 rows survive outage and failed Refresh; real restart recovers; pending notice and failed check coexist     | Same                                                      | PASS                                                |
| Keyboard/screen-reader semantics | Named filter controls and Refresh reached; focus preserved on notice and returned on clearing; Edge AX live=polite | Same                                                      | PASS for requested semantics; no speech/audio claim |
| 5000-event load                  | 3 limit=1 requests / 7399 ms; 0 long tasks; max rAF 4 ms                                                           | 3 limit=1 requests / 7538 ms; 0 long tasks; max rAF 44 ms | PASS for measured window                            |

Notice sampling is 50 ms, timed from receipt of HTTP 202 to observed DOM text. Load windows contain exactly 5000 accepted POSTs before later two-tab/supplemental arrivals. Check intervals: 2010, 2023 ms / 2040, 2020 ms. Long Tasks uses the browser's standard greater-than-50-ms entry type. The exploratory 200 ms task / 500 ms rAF thresholds are QA parameters, not an owner SLA. No whole-page reads occurred in either measured idle window.

Paging remains cumulative **Load more**, as in the merged predecessor: three 100-item pages and the original fourth cursor were compared against real GET /events responses. After Refresh, two API pages matched the UI's 200 IDs with no duplicate or missing boundary record. Scrolling to earlier/newer loaded rows exercises that model; there are no buttons labelled Older/Newer.

The raw outage checks compare absolute document offsets and thus report false when the global offline banner appears. Supplemental geometry resolves this: the same visible IDs shift at most **0.5 px / 0.203125 px**, within a 1 px CSS rounding tolerance; document offsets change 37 px / 152 px and recover exactly. This is a reader-preservation pass, not an ignored failure. [1440-outage-anchor.json](1440-outage-anchor.json), [390-outage-anchor.json](390-outage-anchor.json), [measurements.json](measurements.json).

### Every primary check

| Width | Case / steps                                                                             | Expected                                                       | Actual                                                    | Result / evidence                                                                            |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1440  | empty-store: Open a fresh store                                                          | Distinct empty-store message                                   | 0 rows; No inbound events yet.                            | PASS; [1440-empty-store.json](1440-empty-store.json)                                         |
| 1440  | initial-3-page-api-agreement: POST 301 matching events and one other type; append twice  | UI IDs equal GET /events pages                                 | 300 UI IDs equal three API pages in order                 | PASS; [1440-initial-3-page-api-agreement.json](1440-initial-3-page-api-agreement.json)       |
| 1440  | arrival-reading-preserved: Read row 230; retain Load more focus; POST a matching arrival | Keep rows, order, focus and scroll                             | 300 rows/order/focus unchanged; scroll 23593 to 23593     | PASS; [1440-arrival-reading-preserved.json](1440-arrival-reading-preserved.json)             |
| 1440  | notice-latency: Time 202 receipt to DOM notice                                           | Notice within a few seconds                                    | 1912 ms after 202                                         | PASS; [1440-notice-latency.json](1440-notice-latency.json)                                   |
| 1440  | arrival-boundary-preserved: Use the original fourth cursor after arrival                 | No arrival insertion or boundary gaps                          | 301 original IDs; arrival excluded until Refresh          | PASS; [1440-arrival-boundary-preserved.json](1440-arrival-boundary-preserved.json)           |
| 1440  | polite-live-region: Inspect Edge AX status properties                                    | Polite announcement semantics                                  | status live=polite                                        | PASS; [1440-polite-live-region.json](1440-polite-live-region.json)                           |
| 1440  | refresh-newest-and-filters: Refresh after arrival; compare first GET page                | Newest page with original type/before URL                      | 100 IDs equal API; same filter URL                        | PASS; [1440-refresh-newest-and-filters.json](1440-refresh-newest-and-filters.json)           |
| 1440  | refresh-position-explained: Read status after successful Refresh                         | Explain newest reading position                                | Showing the newest events.                                | PASS; [1440-refresh-position-explained.json](1440-refresh-position-explained.json)           |
| 1440  | refresh-next-boundary: Append again; compare first two API pages                         | No duplicate or missing boundary event                         | 200 unique IDs equal API sequence                         | PASS; [1440-refresh-next-boundary.json](1440-refresh-next-boundary.json)                     |
| 1440  | older-newer-controls: Inventory paging controls                                          | Retain established paging model                                | Cumulative Load more; scroll to newer loaded rows         | PASS; [1440-older-newer-controls.json](1440-older-newer-controls.json)                       |
| 1440  | url-filters-visible: Open type and before in URL                                         | Show both active values                                        | Both values shown                                         | PASS; [1440-url-filters-visible.json](1440-url-filters-visible.json)                         |
| 1440  | filter-clearing-controls: Inspect named clear buttons                                    | Separate clear controls                                        | Clear type filter and Clear before filter exist           | PASS; [1440-filter-clearing-controls.json](1440-filter-clearing-controls.json)               |
| 1440  | D2-keyboard-clear-controls: Tab from Refresh; Enter each clear control                   | Remove only its parameter; preserve keep=reader; focus Refresh | Both reached by Tab; correct URLs; focus returned twice   | PASS; [1440-D2-keyboard-clear-controls.json](1440-D2-keyboard-clear-controls.json)           |
| 1440  | clear-before-via-url: Remove before via address and Refresh                              | Keep type                                                      | 100 rows; type retained                                   | PASS; [1440-clear-before-via-url.json](1440-clear-before-via-url.json)                       |
| 1440  | clear-type-via-url: Remove type via address and Refresh                                  | Keep before                                                    | 100 rows; before retained                                 | PASS; [1440-clear-type-via-url.json](1440-clear-type-via-url.json)                           |
| 1440  | empty-filter-distinct: Open unmatched filter                                             | Distinct filtered empty state                                  | 0 rows; No inbound events match these filters.            | PASS; [1440-empty-filter-distinct.json](1440-empty-filter-distinct.json)                     |
| 1440  | empty-arrival-refresh: POST a later match; wait for notice, then Refresh                 | Announce before admitting row                                  | 0 rows before Refresh; 1 matching row after               | PASS; [1440-empty-arrival-refresh.json](1440-empty-arrival-refresh.json)                     |
| 1440  | keyboard-refresh-reachable: Traverse 22 real Tab stops                                   | Refresh reachable                                              | Refresh in recorded Tab sequence                          | PASS; [1440-keyboard-refresh-reachable.json](1440-keyboard-refresh-reachable.json)           |
| 1440  | api-outage-preserves-reader: Stop actual API while reading 200 rows                      | Keep rows and reading anchor; show failed check                | 200 rows; same visible IDs; max shift 0.5 px              | PASS; [1440-api-outage-preserves-reader.json](1440-api-outage-preserves-reader.json)         |
| 1440  | native-restart-preserves-reader: Start new API PID on same store                         | Recover without replacing reader                               | 200 rows/order and original scroll restored               | PASS; [1440-native-restart-preserves-reader.json](1440-native-restart-preserves-reader.json) |
| 1440  | failed-refresh-keeps-rows: Stop API; focus Refresh without scrolling; Enter              | Keep all rows and filters and report failure                   | 200 to 200 rows; identical IDs/URL; Refresh failed status | PASS; [1440-failed-refresh-keeps-rows.json](1440-failed-refresh-keeps-rows.json)             |
| 1440  | invalid-api-inputs: Invalid before, cursor and empty event type                          | Typed 4xx                                                      | Three 400 responses                                       | PASS; [1440-invalid-api-inputs.json](1440-invalid-api-inputs.json)                           |
| 1440  | load-only-limit-one: Reach exactly 5000 POSTed events; observe idle network              | Only limit=1 checks between Refreshes                          | 5000 stored; 3 limit=1 requests / 7399 ms                 | PASS; [1440-load-only-limit-one.json](1440-load-only-limit-one.json)                         |
| 1440  | load-responsiveness: Observe Long Tasks and 12 rAF round trips                           | Measure responsiveness                                         | 0 long tasks; max rAF 4 ms                                | PASS; [1440-load-responsiveness.json](1440-load-responsiveness.json)                         |
| 1440  | two-tab-isolation: Refresh second tab after arrival                                      | First reader remains unchanged                                 | First 100 IDs retained                                    | PASS; [1440-two-tab-isolation.json](1440-two-tab-isolation.json)                             |
| 1440  | reload-filter-retained: Reload filtered second tab                                       | Retain type and data                                           | Type URL retained; 100 rows                               | PASS; [1440-reload-filter-retained.json](1440-reload-filter-retained.json)                   |
| 390   | empty-store: Open a fresh store                                                          | Distinct empty-store message                                   | 0 rows; No inbound events yet.                            | PASS; [390-empty-store.json](390-empty-store.json)                                           |
| 390   | initial-3-page-api-agreement: POST 301 matching events and one other type; append twice  | UI IDs equal GET /events pages                                 | 300 UI IDs equal three API pages in order                 | PASS; [390-initial-3-page-api-agreement.json](390-initial-3-page-api-agreement.json)         |
| 390   | arrival-reading-preserved: Read row 230; retain Load more focus; POST a matching arrival | Keep rows, order, focus and scroll                             | 300 rows/order/focus unchanged; scroll 97986 to 97986     | PASS; [390-arrival-reading-preserved.json](390-arrival-reading-preserved.json)               |
| 390   | notice-latency: Time 202 receipt to DOM notice                                           | Notice within a few seconds                                    | 1386 ms after 202                                         | PASS; [390-notice-latency.json](390-notice-latency.json)                                     |
| 390   | arrival-boundary-preserved: Use the original fourth cursor after arrival                 | No arrival insertion or boundary gaps                          | 301 original IDs; arrival excluded until Refresh          | PASS; [390-arrival-boundary-preserved.json](390-arrival-boundary-preserved.json)             |
| 390   | polite-live-region: Inspect Edge AX status properties                                    | Polite announcement semantics                                  | status live=polite                                        | PASS; [390-polite-live-region.json](390-polite-live-region.json)                             |
| 390   | refresh-newest-and-filters: Refresh after arrival; compare first GET page                | Newest page with original type/before URL                      | 100 IDs equal API; same filter URL                        | PASS; [390-refresh-newest-and-filters.json](390-refresh-newest-and-filters.json)             |
| 390   | refresh-position-explained: Read status after successful Refresh                         | Explain newest reading position                                | Showing the newest events.                                | PASS; [390-refresh-position-explained.json](390-refresh-position-explained.json)             |
| 390   | refresh-next-boundary: Append again; compare first two API pages                         | No duplicate or missing boundary event                         | 200 unique IDs equal API sequence                         | PASS; [390-refresh-next-boundary.json](390-refresh-next-boundary.json)                       |
| 390   | older-newer-controls: Inventory paging controls                                          | Retain established paging model                                | Cumulative Load more; scroll to newer loaded rows         | PASS; [390-older-newer-controls.json](390-older-newer-controls.json)                         |
| 390   | url-filters-visible: Open type and before in URL                                         | Show both active values                                        | Both values shown                                         | PASS; [390-url-filters-visible.json](390-url-filters-visible.json)                           |
| 390   | filter-clearing-controls: Inspect named clear buttons                                    | Separate clear controls                                        | Clear type filter and Clear before filter exist           | PASS; [390-filter-clearing-controls.json](390-filter-clearing-controls.json)                 |
| 390   | D2-keyboard-clear-controls: Tab from Refresh; Enter each clear control                   | Remove only its parameter; preserve keep=reader; focus Refresh | Both reached by Tab; correct URLs; focus returned twice   | PASS; [390-D2-keyboard-clear-controls.json](390-D2-keyboard-clear-controls.json)             |
| 390   | clear-before-via-url: Remove before via address and Refresh                              | Keep type                                                      | 100 rows; type retained                                   | PASS; [390-clear-before-via-url.json](390-clear-before-via-url.json)                         |
| 390   | clear-type-via-url: Remove type via address and Refresh                                  | Keep before                                                    | 100 rows; before retained                                 | PASS; [390-clear-type-via-url.json](390-clear-type-via-url.json)                             |
| 390   | empty-filter-distinct: Open unmatched filter                                             | Distinct filtered empty state                                  | 0 rows; No inbound events match these filters.            | PASS; [390-empty-filter-distinct.json](390-empty-filter-distinct.json)                       |
| 390   | empty-arrival-refresh: POST a later match; wait for notice, then Refresh                 | Announce before admitting row                                  | 0 rows before Refresh; 1 matching row after               | PASS; [390-empty-arrival-refresh.json](390-empty-arrival-refresh.json)                       |
| 390   | keyboard-refresh-reachable: Traverse 22 real Tab stops                                   | Refresh reachable                                              | Refresh in recorded Tab sequence                          | PASS; [390-keyboard-refresh-reachable.json](390-keyboard-refresh-reachable.json)             |
| 390   | api-outage-preserves-reader: Stop actual API while reading 200 rows                      | Keep rows and reading anchor; show failed check                | 200 rows; same visible IDs; max shift 0.203125 px         | PASS; [390-api-outage-preserves-reader.json](390-api-outage-preserves-reader.json)           |
| 390   | native-restart-preserves-reader: Start new API PID on same store                         | Recover without replacing reader                               | 200 rows/order and original scroll restored               | PASS; [390-native-restart-preserves-reader.json](390-native-restart-preserves-reader.json)   |
| 390   | failed-refresh-keeps-rows: Stop API; focus Refresh without scrolling; Enter              | Keep all rows and filters and report failure                   | 200 to 200 rows; identical IDs/URL; Refresh failed status | PASS; [390-failed-refresh-keeps-rows.json](390-failed-refresh-keeps-rows.json)               |
| 390   | invalid-api-inputs: Invalid before, cursor and empty event type                          | Typed 4xx                                                      | Three 400 responses                                       | PASS; [390-invalid-api-inputs.json](390-invalid-api-inputs.json)                             |
| 390   | load-only-limit-one: Reach exactly 5000 POSTed events; observe idle network              | Only limit=1 checks between Refreshes                          | 5000 stored; 3 limit=1 requests / 7538 ms                 | PASS; [390-load-only-limit-one.json](390-load-only-limit-one.json)                           |
| 390   | load-responsiveness: Observe Long Tasks and 12 rAF round trips                           | Measure responsiveness                                         | 0 long tasks; max rAF 44 ms                               | PASS; [390-load-responsiveness.json](390-load-responsiveness.json)                           |
| 390   | two-tab-isolation: Refresh second tab after arrival                                      | First reader remains unchanged                                 | First 100 IDs retained                                    | PASS; [390-two-tab-isolation.json](390-two-tab-isolation.json)                               |
| 390   | reload-filter-retained: Reload filtered second tab                                       | Retain type and data                                           | Type URL retained; 100 rows                               | PASS; [390-reload-filter-retained.json](390-reload-filter-retained.json)                     |

Supplemental checks: same visible row geometry through native outage/recovery, and D4 combined-status/recovery at both widths. [supplemental-results.json](supplemental-results.json), [supplemental.log.txt](supplemental.log.txt).

### New regression checks

Held-response races use actual fetched API responses, delayed by the QA transport rule until the new filter is active. No component state, private method, QueryClient internals or production export was accessed. Each result keeps old, pending and final snapshots and the API response IDs.

| Width | Check / steps                                                                                            | Expected                                                                            | Actual / result                                                         | Evidence                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1440  | Hold a broad-filter Refresh; use same-document browser Back to select type=qa-main; release old response | Late response cannot overwrite new filter                                           | New filter IDs equal live API page; PASS                                | [1440-race-filter-navigation.json](1440-race-filter-navigation.json)           |
| 1440  | Load 200; hold Refresh; clear type; release old response                                                 | Keep old 200 while pending, then retain newly cleared filter view and Refresh focus | IDs equal broad-filter API; keep=reader retained; PASS                  | [1440-race-clear-type-inflight.json](1440-race-clear-type-inflight.json)       |
| 1440  | Hold restrictive-before Refresh; clear before; release old response                                      | Late restrictive page cannot replace newest type page                               | Correct type IDs and URL; Refresh focused; PASS                         | [1440-race-clear-before-inflight.json](1440-race-clear-before-inflight.json)   |
| 1440  | Double-click Refresh 30 ms apart while first response held                                               | Only one request; preserve 200 rows until success                                   | One request; 200 during, 100 after; newest status; PASS                 | [1440-race-rapid-refresh.json](1440-race-rapid-refresh.json)                   |
| 1440  | Seed 101 actual runs; inject 503 for cold/refetch/append reads; recover append                           | Default cold/refetch error visible; append error keeps old rows                     | 0 rows on cold/refetch error; 100 with append error; recovery 101; PASS | [1440-history-runs-errors.json](1440-history-runs-errors.json)                 |
| 1440  | Repeat the three error paths on loop-filtered Runs                                                       | Same default HistoryState policy with loop filter                                   | 0 / 0 / 100 rows; recovery 101 with loop URL retained; PASS             | [1440-history-loop-history-errors.json](1440-history-loop-history-errors.json) |
| 1440  | Load actual loop history; fail only GET /loops; reload                                                   | Loops QueryState still displays its error                                           | Could not load loops visible; PASS                                      | [1440-loops-overview-error.json](1440-loops-overview-error.json)               |
| 390   | Hold a broad-filter Refresh; use same-document browser Back to select type=qa-main; release old response | Late response cannot overwrite new filter                                           | New filter IDs equal live API page; PASS                                | [390-race-filter-navigation.json](390-race-filter-navigation.json)             |
| 390   | Load 200; hold Refresh; clear type; release old response                                                 | Keep old 200 while pending, then retain newly cleared filter view and Refresh focus | IDs equal broad-filter API; keep=reader retained; PASS                  | [390-race-clear-type-inflight.json](390-race-clear-type-inflight.json)         |
| 390   | Hold restrictive-before Refresh; clear before; release old response                                      | Late restrictive page cannot replace newest type page                               | Correct type IDs and URL; Refresh focused; PASS                         | [390-race-clear-before-inflight.json](390-race-clear-before-inflight.json)     |
| 390   | Double-click Refresh 30 ms apart while first response held                                               | Only one request; preserve 200 rows until success                                   | One request; 200 during, 100 after; newest status; PASS                 | [390-race-rapid-refresh.json](390-race-rapid-refresh.json)                     |
| 390   | Seed 101 actual runs; inject 503 for cold/refetch/append reads; recover append                           | Default cold/refetch error visible; append error keeps old rows                     | 0 rows on cold/refetch error; 100 with append error; recovery 101; PASS | [390-history-runs-errors.json](390-history-runs-errors.json)                   |
| 390   | Repeat the three error paths on loop-filtered Runs                                                       | Same default HistoryState policy with loop filter                                   | 0 / 0 / 100 rows; recovery 101 with loop URL retained; PASS             | [390-history-loop-history-errors.json](390-history-loop-history-errors.json)   |
| 390   | Load actual loop history; fail only GET /loops; reload                                                   | Loops QueryState still displays its error                                           | Could not load loops visible; PASS                                      | [390-loops-overview-error.json](390-loops-overview-error.json)                 |

There is no separate LoopHistoryPage in this head: HistoryState consumers are EventsPage and RunsPage; loop-specific history is RunsPage with a loop URL filter. The Loops overview separately uses QueryState and was checked too. The error fixture is RFC 9457 HTTP 503, QA_UNAVAILABLE, with a labelled detail; it is a controlled external response. Success and recovery use the actual API. Source/call-site evidence: [source-context.log.txt](source-context.log.txt).

The first regression script passed all four desktop races and both desktop Runs history variants, then its Loops-only fault rule also intercepted /app/loops HTML navigation. This was a QA routing error: [races-history-attempt.log.txt](races-history-attempt.log.txt), [races-history-attempt.json](races-history-attempt.json), [attempt-route-fatal-page.json](attempt-route-fatal-page.json), [attempt-route-fatal-page.png](attempt-route-fatal-page.png). The rule was restricted to the exact API pathname. The continuation resumes at Loops on desktop, then runs previously unexecuted mobile cases; passed product cases were not rerun. No production failure was retried to green.

### Touched systems, gates and limits

Touched systems tested: Events cache/refresh/availability polling; URL filters and focus; HTTP intake/listing and opaque paging; empty/error states; process persistence/restart; accessibility semantics; responsive rendering; independent tabs/reload; shared HistoryState cold/refetch/append policies; Loops overview errors. #240's criterion and verification are covered by the matrix. #231 paging behavior is covered at the Events boundary; no acceptance of all Runs/MCP paging or integrated #310/#289 execution/finalization is claimed.

| Command                                                         | Actual result / evidence                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pnpm.cmd build                                                  | PASS, 11 tasks, 10 cached, 15.751 s; [build.log.txt](build.log.txt)                                                                                                                                    |
| pnpm.cmd typecheck                                              | PASS, 20 tasks, 17 cached, 1m58.983s; [gates.log.txt](gates.log.txt)                                                                                                                                   |
| pnpm.cmd lint                                                   | PASS, 11 tasks, one existing ThreadViewer use-state warning, 4m4.366s; [gates.log.txt](gates.log.txt)                                                                                                  |
| pnpm.cmd check:layers                                           | PASS; [gates.log.txt](gates.log.txt)                                                                                                                                                                   |
| pnpm.cmd check:deps                                             | 0 errors / 1 no-orphans warning, 910 modules / 3716 dependencies; [gates.log.txt](gates.log.txt)                                                                                                       |
| pnpm.cmd check:tokens                                           | PASS, 169 files; [gates.log.txt](gates.log.txt)                                                                                                                                                        |
| pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1 | Exit 1; [web-coverage.log.txt](web-coverage.log.txt)                                                                                                                                                   |
| pnpm.cmd format:check                                           | Exit 0; 106.68 s; [format.log.txt](format.log.txt)                                                                                                                                                     |
| pnpm.cmd check:docs / check:licenses                            | Not required: candidate adds no schema, route or dependency. Main's pnpm audit advisory policy is not a new dependency.                                                                                |
| Independent Edge scripts                                        | 52 primary, 4 supplemental, 14 completed race/history checks; [browser-run.log.txt](browser-run.log.txt), [supplemental.log.txt](supplemental.log.txt), [races-history.log.txt](races-history.log.txt) |

Fresh independent package coverage: **98.88% lines (7465/7549)**, **95% branches (7779/8188)**, 98% statements, 98.4% functions. Test files: 130 passed (130); tests: 1642 passed (1642); duration: 4185.00s (tests 38%, environment 36%, setup 12%, import 12%, transform 2%, worker 1%). [coverage-summary.json](coverage-summary.json), [test-totals.json](test-totals.json). Thresholds/exclusions/retry settings were unchanged. This is the new head's run, not an implementer result or a retry of round-1 failures.

No pnpm ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK occurred; no direct-binary fallback was needed. Nonfatal Turbo cache access-denied warnings and native stderr PowerShell wrappers are retained in logs. No new/changed regression tests were supplied by QA: the round-1 reproductions provide the measured before state, and the scripts provide this head's after state. No whole suite was repeated. The sole unexecuted ErrorBoundary file had one isolated execution: exit 0; [error-boundary-isolated.log.txt](error-boundary-isolated.log.txt), [error-boundary-isolated.json](error-boundary-isolated.json). The failed full gate is not reclassified as green.

Verification limits: polite live-region text and Edge AX properties were inspected; actual screen-reader speech was not tested. Load is measured over the stated short windows, not an endurance claim. Pending receipt component behavior is included in the package tests; native pending-receipt load is not the 5000 untargeted-event workload. The unchanged default e2e harness hardcodes ephemeral listener ports and a separate temp prefix; its exact listener-control runtime is not executed under this QA's assigned limits unless a separate exception is granted. This is distinct from the independently verified built API stop/restart behavior. The source diff and selected-instance listener routing were inspected, but static evidence is not called a native harness-control pass.

## 4. Report path and evidence folder

Report: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-g2-240\docs\qa\2026-10-23-wp-g2-240-qa\round-2\README.md`. All round-2 evidence is in this folder. The original round-1 folder remains intact and is linked for historical before measurements. [artifact-manifest.json](artifact-manifest.json) records file sizes/SHA-256, excluding itself. Every retained artifact is linked below; oversized captures, if any, are listed in NOT-KEPT with size/hash instead of retained. Scripts are .mjs.txt; use Node 22 and UTF-8 input, e.g. Get-Content -Raw -Encoding utf8 <script> | node --input-type=module -. The regression continuation additionally passes --resume-loops and reads the kept partial attempt.

| Artifact                                                                               | Bytes  |
| -------------------------------------------------------------------------------------- | ------ |
| [1440-D2-keyboard-clear-controls.json](1440-D2-keyboard-clear-controls.json)           | 83090  |
| [1440-api-down.png](1440-api-down.png)                                                 | 91449  |
| [1440-api-outage-preserves-reader.json](1440-api-outage-preserves-reader.json)         | 107878 |
| [1440-arrival-boundary-preserved.json](1440-arrival-boundary-preserved.json)           | 10587  |
| [1440-arrival-older-page.png](1440-arrival-older-page.png)                             | 91005  |
| [1440-arrival-reading-preserved.json](1440-arrival-reading-preserved.json)             | 156700 |
| [1440-clear-before-via-url.json](1440-clear-before-via-url.json)                       | 26696  |
| [1440-clear-type-via-url.json](1440-clear-type-via-url.json)                           | 26759  |
| [1440-empty-arrival-refresh.json](1440-empty-arrival-refresh.json)                     | 3470   |
| [1440-empty-filter-distinct.json](1440-empty-filter-distinct.json)                     | 1334   |
| [1440-empty-filter.png](1440-empty-filter.png)                                         | 24125  |
| [1440-empty-store.json](1440-empty-store.json)                                         | 1133   |
| [1440-empty-store.png](1440-empty-store.png)                                           | 20783  |
| [1440-failed-refresh-keeps-rows.json](1440-failed-refresh-keeps-rows.json)             | 106786 |
| [1440-failed-refresh.png](1440-failed-refresh.png)                                     | 95126  |
| [1440-filter-clearing-controls.json](1440-filter-clearing-controls.json)               | 1317   |
| [1440-filters-refresh.png](1440-filters-refresh.png)                                   | 92457  |
| [1440-history-loop-history-errors.json](1440-history-loop-history-errors.json)         | 31488  |
| [1440-history-runs-errors.json](1440-history-runs-errors.json)                         | 31379  |
| [1440-history-seed.json](1440-history-seed.json)                                       | 7646   |
| [1440-initial-3-page-api-agreement.json](1440-initial-3-page-api-agreement.json)       | 10268  |
| [1440-invalid-api-inputs.json](1440-invalid-api-inputs.json)                           | 1099   |
| [1440-keyboard-refresh-reachable.json](1440-keyboard-refresh-reachable.json)           | 1292   |
| [1440-load-5000.png](1440-load-5000.png)                                               | 93328  |
| [1440-load-only-limit-one.json](1440-load-only-limit-one.json)                         | 543    |
| [1440-load-responsiveness.json](1440-load-responsiveness.json)                         | 543    |
| [1440-loop-history-history.png](1440-loop-history-history.png)                         | 203757 |
| [1440-loops-overview-error.json](1440-loops-overview-error.json)                       | 868    |
| [1440-native-restart-preserves-reader.json](1440-native-restart-preserves-reader.json) | 107084 |
| [1440-notice-latency.json](1440-notice-latency.json)                                   | 24     |
| [1440-notice-outage.json](1440-notice-outage.json)                                     | 30056  |
| [1440-notice-outage.png](1440-notice-outage.png)                                       | 98733  |
| [1440-notice-recovered.png](1440-notice-recovered.png)                                 | 87139  |
| [1440-older-newer-controls.json](1440-older-newer-controls.json)                       | 122    |
| [1440-outage-anchor.json](1440-outage-anchor.json)                                     | 30232  |
| [1440-polite-live-region.json](1440-polite-live-region.json)                           | 1997   |
| [1440-race-clear-before-inflight.json](1440-race-clear-before-inflight.json)           | 96263  |
| [1440-race-clear-type-inflight.json](1440-race-clear-type-inflight.json)               | 131799 |
| [1440-race-filter-navigation.json](1440-race-filter-navigation.json)                   | 84558  |
| [1440-race-rapid-refresh.json](1440-race-rapid-refresh.json)                           | 90482  |
| [1440-refresh-newest-and-filters.json](1440-refresh-newest-and-filters.json)           | 54708  |
| [1440-refresh-next-boundary.json](1440-refresh-next-boundary.json)                     | 6837   |
| [1440-refresh-position-explained.json](1440-refresh-position-explained.json)           | 9122   |
| [1440-reload-filter-retained.json](1440-reload-filter-retained.json)                   | 76     |
| [1440-runs-history.png](1440-runs-history.png)                                         | 203757 |
| [1440-two-tab-isolation.json](1440-two-tab-isolation.json)                             | 6963   |
| [1440-url-filters-visible.json](1440-url-filters-visible.json)                         | 51197  |
| [390-D2-keyboard-clear-controls.json](390-D2-keyboard-clear-controls.json)             | 79507  |
| [390-api-down.png](390-api-down.png)                                                   | 39339  |
| [390-api-outage-preserves-reader.json](390-api-outage-preserves-reader.json)           | 104099 |
| [390-arrival-boundary-preserved.json](390-arrival-boundary-preserved.json)             | 10587  |
| [390-arrival-older-page.png](390-arrival-older-page.png)                               | 39138  |
| [390-arrival-reading-preserved.json](390-arrival-reading-preserved.json)               | 151706 |
| [390-clear-before-via-url.json](390-clear-before-via-url.json)                         | 25552  |
| [390-clear-type-via-url.json](390-clear-type-via-url.json)                             | 25615  |
| [390-empty-arrival-refresh.json](390-empty-arrival-refresh.json)                       | 3425   |
| [390-empty-filter-distinct.json](390-empty-filter-distinct.json)                       | 1309   |
| [390-empty-filter.png](390-empty-filter.png)                                           | 16728  |
| [390-empty-store.json](390-empty-store.json)                                           | 1108   |
| [390-empty-store.png](390-empty-store.png)                                             | 13581  |
| [390-failed-refresh-keeps-rows.json](390-failed-refresh-keeps-rows.json)               | 103009 |
| [390-failed-refresh.png](390-failed-refresh.png)                                       | 47869  |
| [390-filter-clearing-controls.json](390-filter-clearing-controls.json)                 | 1315   |
| [390-filters-refresh.png](390-filters-refresh.png)                                     | 48910  |
| [390-history-loop-history-errors.json](390-history-loop-history-errors.json)           | 30710  |
| [390-history-runs-errors.json](390-history-runs-errors.json)                           | 30601  |
| [390-history-seed.json](390-history-seed.json)                                         | 7643   |
| [390-initial-3-page-api-agreement.json](390-initial-3-page-api-agreement.json)         | 10268  |
| [390-invalid-api-inputs.json](390-invalid-api-inputs.json)                             | 1099   |
| [390-keyboard-refresh-reachable.json](390-keyboard-refresh-reachable.json)             | 1461   |
| [390-load-5000.png](390-load-5000.png)                                                 | 45238  |
| [390-load-only-limit-one.json](390-load-only-limit-one.json)                           | 548    |
| [390-load-responsiveness.json](390-load-responsiveness.json)                           | 548    |
| [390-loop-history-history.png](390-loop-history-history.png)                           | 53633  |
| [390-loops-overview-error.json](390-loops-overview-error.json)                         | 805    |
| [390-native-restart-preserves-reader.json](390-native-restart-preserves-reader.json)   | 103290 |
| [390-notice-latency.json](390-notice-latency.json)                                     | 24     |
| [390-notice-outage.json](390-notice-outage.json)                                       | 28157  |
| [390-notice-outage.png](390-notice-outage.png)                                         | 53874  |
| [390-notice-recovered.png](390-notice-recovered.png)                                   | 45719  |
| [390-older-newer-controls.json](390-older-newer-controls.json)                         | 134    |
| [390-outage-anchor.json](390-outage-anchor.json)                                       | 28231  |
| [390-polite-live-region.json](390-polite-live-region.json)                             | 1997   |
| [390-race-clear-before-inflight.json](390-race-clear-before-inflight.json)             | 96257  |
| [390-race-clear-type-inflight.json](390-race-clear-type-inflight.json)                 | 131787 |
| [390-race-filter-navigation.json](390-race-filter-navigation.json)                     | 84550  |
| [390-race-rapid-refresh.json](390-race-rapid-refresh.json)                             | 90474  |
| [390-refresh-newest-and-filters.json](390-refresh-newest-and-filters.json)             | 53527  |
| [390-refresh-next-boundary.json](390-refresh-next-boundary.json)                       | 6837   |
| [390-refresh-position-explained.json](390-refresh-position-explained.json)             | 8698   |
| [390-reload-filter-retained.json](390-reload-filter-retained.json)                     | 76     |
| [390-runs-history.png](390-runs-history.png)                                           | 54458  |
| [390-two-tab-isolation.json](390-two-tab-isolation.json)                               | 6960   |
| [390-url-filters-visible.json](390-url-filters-visible.json)                           | 49467  |
| [admission.json](admission.json)                                                       | 161    |
| [artifact-audit.json](artifact-audit.json)                                             | 364    |
| [attempt-route-fatal-page.json](attempt-route-fatal-page.json)                         | 245    |
| [attempt-route-fatal-page.png](attempt-route-fatal-page.png)                           | 11872  |
| [await-and-finalize.mjs.txt](await-and-finalize.mjs.txt)                               | 1156   |
| [browser-qa.mjs.txt](browser-qa.mjs.txt)                                               | 19934  |
| [browser-results.json](browser-results.json)                                           | 12120  |
| [browser-run.log.txt](browser-run.log.txt)                                             | 4364   |
| [build.log.txt](build.log.txt)                                                         | 3969   |
| [coverage-result.json](coverage-result.json)                                           | 160    |
| [coverage-summary.json](coverage-summary.json)                                         | 61971  |
| [error-boundary-isolated.json](error-boundary-isolated.json)                           | 264    |
| [error-boundary-isolated.log.txt](error-boundary-isolated.log.txt)                     | 530    |
| [extra-results.json](extra-results.json)                                               | 63     |
| [final-state.log.txt](final-state.log.txt)                                             | 148    |
| [finalize.mjs.txt](finalize.mjs.txt)                                                   | 6415   |
| [format-result.json](format-result.json)                                               | 113    |
| [format.log.txt](format.log.txt)                                                       | 374    |
| [gates.log.txt](gates.log.txt)                                                         | 8116   |
| [make-report.mjs.txt](make-report.mjs.txt)                                             | 26017  |
| [measurements.json](measurements.json)                                                 | 1669   |
| [outcomes.json](outcomes.json)                                                         | 1608   |
| [prepare.mjs.txt](prepare.mjs.txt)                                                     | 5080   |
| [race-server-1440.log.txt](race-server-1440.log.txt)                                   | 93     |
| [race-server-390.log.txt](race-server-390.log.txt)                                     | 47     |
| [races-history-attempt.json](races-history-attempt.json)                               | 1324   |
| [races-history-attempt.log.txt](races-history-attempt.log.txt)                         | 965    |
| [races-history-attempt.mjs.txt](races-history-attempt.mjs.txt)                         | 13286  |
| [races-history-results.json](races-history-results.json)                               | 2210   |
| [races-history.log.txt](races-history.log.txt)                                         | 473    |
| [races-history.mjs.txt](races-history.mjs.txt)                                         | 13543  |
| [server-1440.log.txt](server-1440.log.txt)                                             | 141    |
| [server-390.log.txt](server-390.log.txt)                                               | 141    |
| [server.mjs.txt](server.mjs.txt)                                                       | 731    |
| [source-context.log.txt](source-context.log.txt)                                       | 27792  |
| [startup-attempt.json](startup-attempt.json)                                           | 829    |
| [startup-attempt.log.txt](startup-attempt.log.txt)                                     | 700    |
| [startup-server.log.txt](startup-server.log.txt)                                       | 47     |
| [supplemental-results.json](supplemental-results.json)                                 | 297    |
| [supplemental-server-1440.log.txt](supplemental-server-1440.log.txt)                   | 140    |
| [supplemental-server-390.log.txt](supplemental-server-390.log.txt)                     | 141    |
| [supplemental.log.txt](supplemental.log.txt)                                           | 739    |
| [supplemental.mjs.txt](supplemental.mjs.txt)                                           | 6313   |
| [test-totals.json](test-totals.json)                                                   | 170    |
| [web-coverage.log.txt](web-coverage.log.txt)                                           | 2850   |
| [width-1440.json](width-1440.json)                                                     | 949064 |
| [width-390.json](width-390.json)                                                       | 947110 |

## 5. Observations outside scope

Existing lint/dependency warnings and the main-merge advisory policy were not fixed by QA. Full release/merge sign-off, other UoW/intent bolts, live provider turns, and the default harness's configuration exception remain separate. No owner ports/store were touched. [final-state.log.txt](final-state.log.txt) confirms no tracked/staged edits. [artifact-audit.json](artifact-audit.json) confirms every round-1 manifest hash still matches. Disposable stores, build output and coverage output are left for the orchestrator; no directories were deleted. [startup-attempt.json](startup-attempt.json) identifies the setup-only store in addition to the two primary stores above.
