# Independent QA: WP-G2 bolt #240

## 1. Verdict

**FAIL** at `fb37c1b04ae23003b7020aaace2530f932b50a84`. All seven requested cases ran in real Microsoft Edge at **1440 × 900** and **390 × 900**. Failed Refresh removes the current rows at both widths. Three additional minor findings concern clearing filters, explaining the post-Refresh position, and reporting a failed check while an arrival notice is present. No production code, tests, Git index, commits, branches or GitHub records were changed by this QA.

The earlier dependency blocker is resolved. Its preflight artifacts remain historical evidence, not the current verdict. The expected QA branch is `codex-qa-wp-g2-240`; candidate base is `fbd48d3da5f162539964516a34d5de7e387d63c6`. This report does not grant merge sign-off or claim #310/#289 integrated acceptance.

### Environment and evidence boundaries

- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-g2-240`.
- Node `v22.14.0`; Edge `156.0.4314.42`, Playwright channel `msedge`, headless. Built web assets served by the real built API, real HTTP and SQLite. Browser service workers were allowed.
- Test time: `2026-10-24T05:24:34.322Z` to `2026-10-24T05:28:15.386Z` UTC, plus the retained supplemental run.
- Disposable store at 1440 px: `%USERPROFILE%\AppData\Local\Temp\gg-qa-g2-240-IRTPPf`; at 390 px: `%USERPROFILE%\AppData\Local\Temp\gg-qa-g2-240-TZlT7m`. Both used `http://127.0.0.1:5820` sequentially. All API processes were stopped after use. No owner app/store/ports were used.
- API keys were minted by `node apps/api/dist/main.js --create-api-key`; tokens were used in browser local storage and bearer headers and not retained. Events were seeded only through `POST /events` using type and payload, without target fields.
- **Fake-harness-only**: both harness ports were injected using the supported public container override. This is native process/browser/storage evidence with fake harnesses; it establishes no live-provider behavior.
- Evidence: [admission.json](admission.json), [browser-results.json](browser-results.json), [width-1440.json](width-1440.json), [width-390.json](width-390.json), [measurements.json](measurements.json), [source-context.log.txt](source-context.log.txt). Reviewer/implementer claims were not counted as evidence.

## 2. Defects

### D1 — Major: failed Refresh removes the reader's current Events

1. Open Events with `?type=qa-main&before=2099-01-01T00%3A00%3A00.000Z` and append a second page (200 rows).
2. Stop the real API process.
3. Click Refresh; wait for its request/retry to fail.

Expected: current 200 rows remain available with an error. Actual: **200 → 0 rows** at both widths; the table becomes an Offline panel. The header also says “New events available” after the reset. The type/before URL survives, but the loaded reading snapshot is gone. The query reset and error rendering paths are preserved in [source-context.log.txt](source-context.log.txt).

Evidence: [1440-failed-refresh-keeps-rows.json](1440-failed-refresh-keeps-rows.json), [390-failed-refresh-keeps-rows.json](390-failed-refresh-keeps-rows.json), [1440-failed-refresh.png](1440-failed-refresh.png), [390-failed-refresh.png](390-failed-refresh.png).

### D2 — Minor: active URL filters have no clearing controls

Open the URL above. Both Type and Before appear as plain text. Inspect all controls and traverse with Tab. Expected: each active filter can be cleared from the UI and its control is keyboard reachable. Actual: there are no filter inputs, clear buttons or clear links at either width. Editing the address manually removes each filter correctly, but does not meet the requested control interaction.

Evidence: [1440-filter-clearing-controls.json](1440-filter-clearing-controls.json), [390-filter-clearing-controls.json](390-filter-clearing-controls.json), [1440-keyboard-refresh-reachable.json](1440-keyboard-refresh-reachable.json), [390-keyboard-refresh-reachable.json](390-keyboard-refresh-reachable.json), [1440-filters-refresh.png](1440-filters-refresh.png), [390-filters-refresh.png](390-filters-refresh.png).

### D3 — Minor: Refresh does not explain the new reading position

Load three pages, receive an event, and click Refresh. Expected: newest events appear and the UI says where the reader is. Actual: the view resets to the newest 100 and preserves filters, but provides no newest/latest/page/showing position label at either width. Since this UI appends cumulatively, an explicit description of the reset is especially useful.

Evidence: [1440-refresh-position-explained.json](1440-refresh-position-explained.json), [390-refresh-position-explained.json](390-refresh-position-explained.json), [1440-refresh-newest-and-filters.json](1440-refresh-newest-and-filters.json), [390-refresh-newest-and-filters.json](390-refresh-newest-and-filters.json).

### D4 — Minor: an existing arrival notice hides the failed-check message

Read older events; POST a matching event; wait for “New events available”; stop the API and leave the page open for six seconds. Expected: the Events live region also reports that checks are failing. Actual: it continues to say only “New events available”. **The global offline banner does appear**, so this is a missing Events check-status message, not a total absence of error feedback. Rows remain present.

Evidence: [1440-notice-outage.json](1440-notice-outage.json), [390-notice-outage.json](390-notice-outage.json), [1440-notice-outage.png](1440-notice-outage.png), [390-notice-outage.png](390-notice-outage.png), [supplemental-results.json](supplemental-results.json).

## 3. Coverage of criteria

### Required seven cases

| Case                     | 1440 px actual                                                                                             | 390 px actual                                                             | Outcome / evidence                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1. Arrival while reading | 300 rows unchanged; notice **1376 ms** after 202; scroll 23581 → 23581 px                                  | 300 rows unchanged; notice **1498 ms** after 202; scroll 97934 → 97934 px | PASS: rows/order/focus/boundaries; [measurements.json](measurements.json) and arrival JSONs below |
| 2. Refresh and paging    | Newest 100 equal API; next page gives 200 unique matching IDs                                              | Same                                                                      | PARTIAL FAIL: D3 position label absent; data/filter/paging checks pass                            |
| 3. URL filters           | Type and before visible; both survive Refresh; each removable by address edit                              | Same                                                                      | PARTIAL FAIL: D2 UI clearing controls absent                                                      |
| 4. Empty result          | Distinct empty-store/filter messages; later match announced in 1870 ms from POST start; appears on Refresh | Same; 1961 ms                                                             | PASS; empty JSONs/screenshots below                                                               |
| 5. Reconnect/errors      | Outage keeps 200 rows; explicit failed-check text without prior notice; new PID recovers same store        | Same                                                                      | FAIL: D1 failed Refresh loses rows; D4 prior notice hides failed-check text                       |
| 6. Keyboard/live region  | Edge AX status live=polite; Refresh in Tab sequence; arrival keeps focus                                   | Same                                                                      | PARTIAL FAIL: D2 filter controls unavailable; no actual screen-reader audio test claimed          |
| 7. Load                  | Exactly 5000 POSTed events; 3 limit=1 reads / 7327 ms; **0 long tasks**; max rAF round trip 10 ms          | Exactly 5000; 4 limit=1 reads / 8049 ms; **0 long tasks**; max rAF 111 ms | PASS for measured idle windows; [measurements.json](measurements.json)                            |

The notice latency starts after POST returns 202 and ends when its DOM text is observed; the sampling loop is 50 ms. Idle-check intervals were 2025, 2022 ms at 1440 px and 2071, 1974, 2021 ms at 390 px. Long Tasks uses the browser's standard greater-than-50-ms entry type. Responsiveness is measured, not an owner-approved SLA; the script's exploratory thresholds are 200 ms for a task and 500 ms for a rAF round trip. The load window precedes the two-tab test's 5001st event and the supplemental event.

**Paging adaptation:** this accepted predecessor presents cumulative **Load more**, with no buttons labelled Older/Newer. The raw `older-newer-controls` check records false for those labels. This is an inventory observation, not a separate defect. Three initial API pages (100 each) matched the 300 rendered IDs; the old fourth cursor then returned the remaining original event after an arrival. Refresh re-established the API's newest first page, and appending matched the next 100 with no gaps/duplicates across that boundary. Earlier/newer loaded rows remain available by scrolling the cumulative list.

**Outage anchor refinement:** the primary raw check compared absolute scroll offsets and recorded false. The offline banner grows above the list, so the document offset changes by 36 px / 151 px. Supplemental geometry proves the same visible event IDs shift at most **0.5 px / 0.796875 px**, within a 1 px rounding tolerance, and return exactly on recovery. This is a pass for preserving the reader, not a movement defect. Both raw observations are retained: [1440-outage-anchor.json](1440-outage-anchor.json), [390-outage-anchor.json](390-outage-anchor.json), [measurements.json](measurements.json).

### Every individual check

| Width | Check / steps                                                                               | Expected                                          | Actual / result                                                                               | Evidence                                                                               |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1440  | empty-store: Open pristine store                                                            | Distinct empty-store message                      | PASS: Recorded structured values                                                              | [1440-empty-store.json](1440-empty-store.json)                                         |
| 1440  | initial-3-page-api-agreement: POST 301 qa-main and one excluded event; append twice         | 300 UI IDs equal three GET pages in order         | PASS: Recorded structured values                                                              | [1440-initial-3-page-api-agreement.json](1440-initial-3-page-api-agreement.json)       |
| 1440  | arrival-reading-preserved: Read row 230 of 300; retain Load more focus; POST matching event | Rows/order/scroll/focus unchanged before Refresh  | PASS: Recorded structured values                                                              | [1440-arrival-reading-preserved.json](1440-arrival-reading-preserved.json)             |
| 1440  | notice-latency: Time HTTP 202 to visible notice                                             | Notice within a few seconds                       | PASS: 1376 ms after 202                                                                       | [1440-notice-latency.json](1440-notice-latency.json)                                   |
| 1440  | arrival-boundary-preserved: Append fourth page after arrival using original nextCursor      | 301 original IDs, no arrival/gap/duplicate        | PASS: Recorded structured values                                                              | [1440-arrival-boundary-preserved.json](1440-arrival-boundary-preserved.json)           |
| 1440  | polite-live-region: Inspect Edge accessibility tree                                         | status live property is polite                    | PASS: Recorded structured values                                                              | [1440-polite-live-region.json](1440-polite-live-region.json)                           |
| 1440  | refresh-newest-and-filters: Refresh with type and before active; compare GET first page     | Newest 100 IDs and same URL filters               | PASS: Recorded structured values                                                              | [1440-refresh-newest-and-filters.json](1440-refresh-newest-and-filters.json)           |
| 1440  | refresh-position-explained: Read refreshed screen text                                      | Explicit refreshed reading position               | FAIL: No position label (D3)                                                                  | [1440-refresh-position-explained.json](1440-refresh-position-explained.json)           |
| 1440  | refresh-next-boundary: Append after Refresh and compare two GET pages                       | 200 unique IDs equal API sequence                 | PASS: Recorded structured values                                                              | [1440-refresh-next-boundary.json](1440-refresh-next-boundary.json)                     |
| 1440  | older-newer-controls: Inventory pagination buttons                                          | Record actual navigation model                    | OBSERVATION: Load more; cumulative list, labels absent                                        | [1440-older-newer-controls.json](1440-older-newer-controls.json)                       |
| 1440  | url-filters-visible: Load type and before from URL                                          | Both active values displayed                      | PASS: Recorded structured values                                                              | [1440-url-filters-visible.json](1440-url-filters-visible.json)                         |
| 1440  | filter-clearing-controls: Inventory visible interactive controls                            | Separate controls to clear active filters         | FAIL: No clear controls (D2)                                                                  | [1440-filter-clearing-controls.json](1440-filter-clearing-controls.json)               |
| 1440  | clear-before-via-url: Remove before in address; Refresh                                     | Type survives and before is absent                | PASS: Recorded structured values                                                              | [1440-clear-before-via-url.json](1440-clear-before-via-url.json)                       |
| 1440  | clear-type-via-url: Remove type in address; Refresh                                         | Before survives and type is absent                | PASS: Recorded structured values                                                              | [1440-clear-type-via-url.json](1440-clear-type-via-url.json)                           |
| 1440  | empty-filter-distinct: Open unmatched type                                                  | Empty-filter text differs from empty-store        | PASS: Recorded structured values                                                              | [1440-empty-filter-distinct.json](1440-empty-filter-distinct.json)                     |
| 1440  | empty-arrival-refresh: POST matching event to empty filtered view; Refresh                  | Notice first; row appears only on Refresh         | PASS: Recorded structured values                                                              | [1440-empty-arrival-refresh.json](1440-empty-arrival-refresh.json)                     |
| 1440  | keyboard-refresh-reachable: Traverse 22 Tab stops from fresh document                       | Refresh receives keyboard focus                   | PASS: Recorded structured values                                                              | [1440-keyboard-refresh-reachable.json](1440-keyboard-refresh-reachable.json)           |
| 1440  | api-outage-preserves-reader: Stop real API while 200 rows loaded; observe check error       | Keep rows and visible reading anchor              | PASS after anchor measurement: 200 rows; document offset changes; visible shift ≤ 0.5 px      | [1440-api-outage-preserves-reader.json](1440-api-outage-preserves-reader.json)         |
| 1440  | native-restart-preserves-reader: Start new API PID on same store                            | Error clears, rows and reading position preserved | PASS: Recorded structured values                                                              | [1440-native-restart-preserves-reader.json](1440-native-restart-preserves-reader.json) |
| 1440  | failed-refresh-keeps-rows: Stop API, then click Refresh and wait for failure                | Retain 200 loaded rows                            | FAIL: 200 → 0 rows (D1)                                                                       | [1440-failed-refresh-keeps-rows.json](1440-failed-refresh-keeps-rows.json)             |
| 1440  | invalid-api-inputs: Invalid before, malformed cursor, empty type payload                    | Typed 4xx responses                               | PASS: Recorded structured values                                                              | [1440-invalid-api-inputs.json](1440-invalid-api-inputs.json)                           |
| 1440  | load-only-limit-one: Reach exactly 5000 accepted POSTs; observe idle network                | Only limit=1 GET checks between Refreshes         | PASS: 3 limit=1 requests                                                                      | [1440-load-only-limit-one.json](1440-load-only-limit-one.json)                         |
| 1440  | load-responsiveness: Observe Long Tasks and 12 requestAnimationFrame round trips            | Measure main-thread responsiveness                | PASS: 0 long tasks; max rAF round trip 10 ms                                                  | [1440-load-responsiveness.json](1440-load-responsiveness.json)                         |
| 1440  | two-tab-isolation: Second tab refreshes after new event                                     | First reader keeps exact IDs                      | PASS: Recorded structured values                                                              | [1440-two-tab-isolation.json](1440-two-tab-isolation.json)                             |
| 1440  | reload-filter-retained: Reload second tab with type URL                                     | Type URL retained; 100 rows loaded                | PASS: Recorded structured values                                                              | [1440-reload-filter-retained.json](1440-reload-filter-retained.json)                   |
| 390   | empty-store: Open pristine store                                                            | Distinct empty-store message                      | PASS: Recorded structured values                                                              | [390-empty-store.json](390-empty-store.json)                                           |
| 390   | initial-3-page-api-agreement: POST 301 qa-main and one excluded event; append twice         | 300 UI IDs equal three GET pages in order         | PASS: Recorded structured values                                                              | [390-initial-3-page-api-agreement.json](390-initial-3-page-api-agreement.json)         |
| 390   | arrival-reading-preserved: Read row 230 of 300; retain Load more focus; POST matching event | Rows/order/scroll/focus unchanged before Refresh  | PASS: Recorded structured values                                                              | [390-arrival-reading-preserved.json](390-arrival-reading-preserved.json)               |
| 390   | notice-latency: Time HTTP 202 to visible notice                                             | Notice within a few seconds                       | PASS: 1498 ms after 202                                                                       | [390-notice-latency.json](390-notice-latency.json)                                     |
| 390   | arrival-boundary-preserved: Append fourth page after arrival using original nextCursor      | 301 original IDs, no arrival/gap/duplicate        | PASS: Recorded structured values                                                              | [390-arrival-boundary-preserved.json](390-arrival-boundary-preserved.json)             |
| 390   | polite-live-region: Inspect Edge accessibility tree                                         | status live property is polite                    | PASS: Recorded structured values                                                              | [390-polite-live-region.json](390-polite-live-region.json)                             |
| 390   | refresh-newest-and-filters: Refresh with type and before active; compare GET first page     | Newest 100 IDs and same URL filters               | PASS: Recorded structured values                                                              | [390-refresh-newest-and-filters.json](390-refresh-newest-and-filters.json)             |
| 390   | refresh-position-explained: Read refreshed screen text                                      | Explicit refreshed reading position               | FAIL: No position label (D3)                                                                  | [390-refresh-position-explained.json](390-refresh-position-explained.json)             |
| 390   | refresh-next-boundary: Append after Refresh and compare two GET pages                       | 200 unique IDs equal API sequence                 | PASS: Recorded structured values                                                              | [390-refresh-next-boundary.json](390-refresh-next-boundary.json)                       |
| 390   | older-newer-controls: Inventory pagination buttons                                          | Record actual navigation model                    | OBSERVATION: Load more; cumulative list, labels absent                                        | [390-older-newer-controls.json](390-older-newer-controls.json)                         |
| 390   | url-filters-visible: Load type and before from URL                                          | Both active values displayed                      | PASS: Recorded structured values                                                              | [390-url-filters-visible.json](390-url-filters-visible.json)                           |
| 390   | filter-clearing-controls: Inventory visible interactive controls                            | Separate controls to clear active filters         | FAIL: No clear controls (D2)                                                                  | [390-filter-clearing-controls.json](390-filter-clearing-controls.json)                 |
| 390   | clear-before-via-url: Remove before in address; Refresh                                     | Type survives and before is absent                | PASS: Recorded structured values                                                              | [390-clear-before-via-url.json](390-clear-before-via-url.json)                         |
| 390   | clear-type-via-url: Remove type in address; Refresh                                         | Before survives and type is absent                | PASS: Recorded structured values                                                              | [390-clear-type-via-url.json](390-clear-type-via-url.json)                             |
| 390   | empty-filter-distinct: Open unmatched type                                                  | Empty-filter text differs from empty-store        | PASS: Recorded structured values                                                              | [390-empty-filter-distinct.json](390-empty-filter-distinct.json)                       |
| 390   | empty-arrival-refresh: POST matching event to empty filtered view; Refresh                  | Notice first; row appears only on Refresh         | PASS: Recorded structured values                                                              | [390-empty-arrival-refresh.json](390-empty-arrival-refresh.json)                       |
| 390   | keyboard-refresh-reachable: Traverse 22 Tab stops from fresh document                       | Refresh receives keyboard focus                   | PASS: Recorded structured values                                                              | [390-keyboard-refresh-reachable.json](390-keyboard-refresh-reachable.json)             |
| 390   | api-outage-preserves-reader: Stop real API while 200 rows loaded; observe check error       | Keep rows and visible reading anchor              | PASS after anchor measurement: 200 rows; document offset changes; visible shift ≤ 0.796875 px | [390-api-outage-preserves-reader.json](390-api-outage-preserves-reader.json)           |
| 390   | native-restart-preserves-reader: Start new API PID on same store                            | Error clears, rows and reading position preserved | PASS: Recorded structured values                                                              | [390-native-restart-preserves-reader.json](390-native-restart-preserves-reader.json)   |
| 390   | failed-refresh-keeps-rows: Stop API, then click Refresh and wait for failure                | Retain 200 loaded rows                            | FAIL: 200 → 0 rows (D1)                                                                       | [390-failed-refresh-keeps-rows.json](390-failed-refresh-keeps-rows.json)               |
| 390   | invalid-api-inputs: Invalid before, malformed cursor, empty type payload                    | Typed 4xx responses                               | PASS: Recorded structured values                                                              | [390-invalid-api-inputs.json](390-invalid-api-inputs.json)                             |
| 390   | load-only-limit-one: Reach exactly 5000 accepted POSTs; observe idle network                | Only limit=1 GET checks between Refreshes         | PASS: 4 limit=1 requests                                                                      | [390-load-only-limit-one.json](390-load-only-limit-one.json)                           |
| 390   | load-responsiveness: Observe Long Tasks and 12 requestAnimationFrame round trips            | Measure main-thread responsiveness                | PASS: 0 long tasks; max rAF round trip 111 ms                                                 | [390-load-responsiveness.json](390-load-responsiveness.json)                           |
| 390   | two-tab-isolation: Second tab refreshes after new event                                     | First reader keeps exact IDs                      | PASS: Recorded structured values                                                              | [390-two-tab-isolation.json](390-two-tab-isolation.json)                               |
| 390   | reload-filter-retained: Reload second tab with type URL                                     | Type URL retained; 100 rows loaded                | PASS: Recorded structured values                                                              | [390-reload-filter-retained.json](390-reload-filter-retained.json)                     |

Supplemental checks at each width: outage row-geometry comparison and recovery (PASS within 1 px); outage after an existing notice (FAIL, D4). Full steps/code and results are in [supplemental.mjs.txt](supplemental.mjs.txt), [supplemental.log.txt](supplemental.log.txt) and [supplemental-results.json](supplemental-results.json). The 50 primary checks plus these four supplemental checks were executed once against the product; setup attempts reached no product assertion.

### Touched systems and parent criteria

- **Events history cache/Refresh:** delayed arrival visibility, stable membership/order, independent tab caches, refresh success/failure, preserved URL, real API reconnect/restart. Positive/negative evidence is in the individual checks above.
- **REST intake and event paging:** 202 seeding without targets, all page comparisons, typed invalid before/cursor/payload 4xx responses; raw GET bodies and opaque cursors in the width JSONs.
- **Filters/empty states and user feedback:** both URL values, removing either by address edit, filtered and pristine empty stores, notice arrival and failed checks. Missing controls/labels/errors are defects, not untested passes.
- **Accessibility/responsive rendering:** both widths visually inspected, polite live semantics read from Edge's AX tree, real Tab traversal, focus unchanged on notice. No automated output is presented as actual screen-reader speech.
- **Performance:** exactly 5000 stored events at each load measurement; only lightweight checks in the stated windows. Pending receipt recovery may intentionally reread loaded pages; that workload was not the normal no-target event store used here.
- **#231 predecessor contribution:** event opaque cursor/filter preservation, malformed cursor handling, API/UI boundary agreement, exhaustion of original 301 matching events, and reload/two-tab behavior were tested. No reacceptance of all Runs/MCP paging is claimed.
- **#310/#289:** this tests #240's Events evidence-access contribution only. Other bolts, live execution/replay and return finalization were outside this QA; integrated UoW/intent acceptance is not established.

### Tests and gates

| Command                                                                                                                                                                      | Result / evidence                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                                                                                             | PASS; 11 tasks, 10 cached; 40.212 s; cached-log path text was redacted. [build.log.txt](build.log.txt)                                                                                                                                                     |
| `pnpm.cmd typecheck`                                                                                                                                                         | PASS; 20 tasks, 17 cached; 3m35.165s. [typecheck.log.txt](typecheck.log.txt)                                                                                                                                                                               |
| `pnpm.cmd lint`                                                                                                                                                              | PASS with 1 use-state warning at ThreadViewer.tsx:106. [lint.log.txt](lint.log.txt)                                                                                                                                                                        |
| `pnpm.cmd check:layers`                                                                                                                                                      | PASS, Layer rules OK. [other-gates.log.txt](other-gates.log.txt)                                                                                                                                                                                           |
| `pnpm.cmd check:deps`                                                                                                                                                        | 0 errors, 1 no-orphans warning for infrastructure/drizzle.config.ts; 909 modules / 3714 dependencies. [other-gates.log.txt](other-gates.log.txt)                                                                                                           |
| `pnpm.cmd check:tokens`                                                                                                                                                      | PASS, 169 files. [other-gates.log.txt](other-gates.log.txt)                                                                                                                                                                                                |
| `pnpm.cmd --filter @graphgoblin/web test:coverage`                                                                                                                           | FAILED/INCOMPLETE: eight test failures reported before interruption during severe slowdown; no final coverage summary. [web-coverage.log.txt](web-coverage.log.txt)                                                                                        |
| `pnpm.cmd --filter @graphgoblin/web exec vitest run src/events/EventsPage.test.tsx src/events/EventsPage.refresh.test.tsx src/api/queries.reconnect.test.tsx --maxWorkers=2` | PASS, 3 files / 42 tests, 88.54 s. This focused follow-up covers changed Events/reconnect and pending-delivery component scenarios; it does not erase broad-suite failures or establish package coverage. [targeted-tests.log.txt](targeted-tests.log.txt) |
| `pnpm.cmd format:check`                                                                                                                                                      | Initial attempt interrupted after Checking formatting during the broad gate run. Final attempt: exit 0, 174.33 s; [format-final.log.txt](format-final.log.txt), [format-final.json](format-final.json). [other-gates.log.txt](other-gates.log.txt)         |
| `pnpm.cmd check:docs` / `check:licenses`                                                                                                                                     | Not required: candidate changes neither schemas/routes nor dependencies. No generated reference or license changes made.                                                                                                                                   |
| Edge scripts, both widths                                                                                                                                                    | Complete; 50 primary + 4 supplemental checks, with defects/refinements described above. [browser-run.log.txt](browser-run.log.txt), [supplemental.log.txt](supplemental.log.txt)                                                                           |

Turbo emitted IO access-denied cache warnings; successful gate exit results above were still returned. PowerShell wraps native stderr as NativeCommandError even for successful commands; that wrapper is not itself a failed gate. No pnpm command produced ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK, so no direct-binary fallback for that error was necessary. No repeated whole test suite was run.

The broad coverage attempt reported these eight failures, retained without attributing them to this patch or calling them pre-existing: JSON section parent revalidation; sparse graph geometry/detours; TriggerEditor keyboard undo/validation; DecisionAuthoring classifier guidance and device ownership restore (two); failed cached harness catalog recovery; ThreadViewer reconstruction cache; model-picker validation warning forwarding. The changed-file targeted suite passed, including controlled pending-delivery and reconnect paths; no before-fix regression run was made because QA supplied no corrective patch.

### Criteria not established / limits

- No final web package line/branch percentage: the broad coverage gate remains failed/incomplete, and its failures need separate triage.
- Root formatting's final attempt exited 0; see the gate result above.
- No actual screen-reader/audio session; polite announcement semantics and message text were inspected in the real Edge accessibility tree.
- No live provider turns, pending-receipt native recovery workload, exhaustive Runs/MCP regression, or integrated #310/#289 acceptance. Focused fake component tests supplement the native normal-event cases.
- Load observations cover only the stated 7–8-second stable windows, not sustained/endurance traffic or receipt-recovery load.
- No production correction, new regression test, numbered-doc/ADR/CHANGELOG edit or generated-reference change was made by QA. Candidate behavior docs/CHANGELOG were inspected in the retained source diff. The #240 entry describes manual refresh/filter retention and does not require an operator migration.

## 4. Report path and evidence folder

Report: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-g2-240\docs\qa\2026-10-23-wp-g2-240-qa\README.md`. Evidence folder is this report's containing folder. Scripts are retained as .mjs.txt; run the browser scripts from the worktree root with Node 22 first on PATH, using `Get-Content -Raw <script> | node --input-type=module -`. No scripts require a production edit. The original setup failures are separately named and must not be counted as product tests. [gate-results.json](gate-results.json) records returned command outcomes; [final-state.log.txt](final-state.log.txt) confirms the exact head and no tracked/staged changes.

[artifact-manifest.json](artifact-manifest.json) records sizes and SHA-256 hashes (excluding itself). Every retained artifact is linked below. No retained file exceeds 1,000,000 bytes; if the final artifact audit finds one, its size and hash go to NOT-KEPT and the oversized capture is moved out of the retained folder.

| Artifact                                                                               | Bytes  |
| -------------------------------------------------------------------------------------- | ------ |
| [1440-api-down.png](1440-api-down.png)                                                 | 93315  |
| [1440-api-outage-preserves-reader.json](1440-api-outage-preserves-reader.json)         | 105738 |
| [1440-arrival-boundary-preserved.json](1440-arrival-boundary-preserved.json)           | 10587  |
| [1440-arrival-older-page.png](1440-arrival-older-page.png)                             | 92111  |
| [1440-arrival-reading-preserved.json](1440-arrival-reading-preserved.json)             | 154958 |
| [1440-clear-before-via-url.json](1440-clear-before-via-url.json)                       | 25886  |
| [1440-clear-type-via-url.json](1440-clear-type-via-url.json)                           | 25946  |
| [1440-empty-arrival-refresh.json](1440-empty-arrival-refresh.json)                     | 2883   |
| [1440-empty-filter-distinct.json](1440-empty-filter-distinct.json)                     | 1074   |
| [1440-empty-filter.png](1440-empty-filter.png)                                         | 23381  |
| [1440-empty-store.json](1440-empty-store.json)                                         | 996    |
| [1440-empty-store.png](1440-empty-store.png)                                           | 20802  |
| [1440-failed-refresh-keeps-rows.json](1440-failed-refresh-keeps-rows.json)             | 55997  |
| [1440-failed-refresh.png](1440-failed-refresh.png)                                     | 44226  |
| [1440-filter-clearing-controls.json](1440-filter-clearing-controls.json)               | 951    |
| [1440-filters-refresh.png](1440-filters-refresh.png)                                   | 90153  |
| [1440-initial-3-page-api-agreement.json](1440-initial-3-page-api-agreement.json)       | 10268  |
| [1440-invalid-api-inputs.json](1440-invalid-api-inputs.json)                           | 1099   |
| [1440-keyboard-refresh-reachable.json](1440-keyboard-refresh-reachable.json)           | 1410   |
| [1440-load-5000.png](1440-load-5000.png)                                               | 93867  |
| [1440-load-only-limit-one.json](1440-load-only-limit-one.json)                         | 544    |
| [1440-load-responsiveness.json](1440-load-responsiveness.json)                         | 544    |
| [1440-native-restart-preserves-reader.json](1440-native-restart-preserves-reader.json) | 104946 |
| [1440-notice-latency.json](1440-notice-latency.json)                                   | 24     |
| [1440-notice-outage.json](1440-notice-outage.json)                                     | 20210  |
| [1440-notice-outage.png](1440-notice-outage.png)                                       | 96541  |
| [1440-older-newer-controls.json](1440-older-newer-controls.json)                       | 96     |
| [1440-outage-anchor.json](1440-outage-anchor.json)                                     | 30234  |
| [1440-polite-live-region.json](1440-polite-live-region.json)                           | 1997   |
| [1440-refresh-newest-and-filters.json](1440-refresh-newest-and-filters.json)           | 53758  |
| [1440-refresh-next-boundary.json](1440-refresh-next-boundary.json)                     | 6837   |
| [1440-refresh-position-explained.json](1440-refresh-position-explained.json)           | 9186   |
| [1440-reload-filter-retained.json](1440-reload-filter-retained.json)                   | 76     |
| [1440-two-tab-isolation.json](1440-two-tab-isolation.json)                             | 6964   |
| [1440-url-filters-visible.json](1440-url-filters-visible.json)                         | 50386  |
| [390-api-down.png](390-api-down.png)                                                   | 39156  |
| [390-api-outage-preserves-reader.json](390-api-outage-preserves-reader.json)           | 103288 |
| [390-arrival-boundary-preserved.json](390-arrival-boundary-preserved.json)             | 10587  |
| [390-arrival-older-page.png](390-arrival-older-page.png)                               | 39086  |
| [390-arrival-reading-preserved.json](390-arrival-reading-preserved.json)               | 151312 |
| [390-clear-before-via-url.json](390-clear-before-via-url.json)                         | 25261  |
| [390-clear-type-via-url.json](390-clear-type-via-url.json)                             | 25321  |
| [390-empty-arrival-refresh.json](390-empty-arrival-refresh.json)                       | 2827   |
| [390-empty-filter-distinct.json](390-empty-filter-distinct.json)                       | 1049   |
| [390-empty-filter.png](390-empty-filter.png)                                           | 16035  |
| [390-empty-store.json](390-empty-store.json)                                           | 971    |
| [390-empty-store.png](390-empty-store.png)                                             | 13594  |
| [390-failed-refresh-keeps-rows.json](390-failed-refresh-keeps-rows.json)               | 54747  |
| [390-failed-refresh.png](390-failed-refresh.png)                                       | 38451  |
| [390-filter-clearing-controls.json](390-filter-clearing-controls.json)                 | 952    |
| [390-filters-refresh.png](390-filters-refresh.png)                                     | 47791  |
| [390-initial-3-page-api-agreement.json](390-initial-3-page-api-agreement.json)         | 10268  |
| [390-invalid-api-inputs.json](390-invalid-api-inputs.json)                             | 1099   |
| [390-keyboard-refresh-reachable.json](390-keyboard-refresh-reachable.json)             | 1704   |
| [390-load-5000.png](390-load-5000.png)                                                 | 45002  |
| [390-load-only-limit-one.json](390-load-only-limit-one.json)                           | 650    |
| [390-load-responsiveness.json](390-load-responsiveness.json)                           | 650    |
| [390-native-restart-preserves-reader.json](390-native-restart-preserves-reader.json)   | 102496 |
| [390-notice-latency.json](390-notice-latency.json)                                     | 24     |
| [390-notice-outage.json](390-notice-outage.json)                                       | 18863  |
| [390-notice-outage.png](390-notice-outage.png)                                         | 54587  |
| [390-older-newer-controls.json](390-older-newer-controls.json)                         | 108    |
| [390-outage-anchor.json](390-outage-anchor.json)                                       | 28231  |
| [390-polite-live-region.json](390-polite-live-region.json)                             | 1997   |
| [390-refresh-newest-and-filters.json](390-refresh-newest-and-filters.json)             | 53132  |
| [390-refresh-next-boundary.json](390-refresh-next-boundary.json)                       | 6837   |
| [390-refresh-position-explained.json](390-refresh-position-explained.json)             | 8762   |
| [390-reload-filter-retained.json](390-reload-filter-retained.json)                     | 76     |
| [390-two-tab-isolation.json](390-two-tab-isolation.json)                               | 6961   |
| [390-url-filters-visible.json](390-url-filters-visible.json)                           | 49161  |
| [admission.json](admission.json)                                                       | 210    |
| [artifact-audit.json](artifact-audit.json)                                             | 378    |
| [browser-import-error.json](browser-import-error.json)                                 | 932    |
| [browser-import-error.log.txt](browser-import-error.log.txt)                           | 801    |
| [browser-qa.mjs.txt](browser-qa.mjs.txt)                                               | 17897  |
| [browser-results.json](browser-results.json)                                           | 11954  |
| [browser-run.log.txt](browser-run.log.txt)                                             | 4201   |
| [browser-script-error.log.txt](browser-script-error.log.txt)                           | 1465   |
| [browser-selector-error.json](browser-selector-error.json)                             | 1228   |
| [browser-selector-error.log.txt](browser-selector-error.log.txt)                       | 946    |
| [browser-startup-error.log.txt](browser-startup-error.log.txt)                         | 1525   |
| [build.log.txt](build.log.txt)                                                         | 3969   |
| [final-state.log.txt](final-state.log.txt)                                             | 159    |
| [finalize.mjs.txt](finalize.mjs.txt)                                                   | 4827   |
| [format-final.json](format-final.json)                                                 | 106    |
| [format-final.log.txt](format-final.log.txt)                                           | 375    |
| [gate-results.json](gate-results.json)                                                 | 727    |
| [lint.log.txt](lint.log.txt)                                                           | 2720   |
| [make-report.mjs.txt](make-report.mjs.txt)                                             | 23660  |
| [measurements.json](measurements.json)                                                 | 1665   |
| [other-gates.log.txt](other-gates.log.txt)                                             | 1699   |
| [preflight.json](preflight.json)                                                       | 624    |
| [preflight.log.txt](preflight.log.txt)                                                 | 640    |
| [preflight.mjs.txt](preflight.mjs.txt)                                                 | 1101   |
| [qa-format.log.txt](qa-format.log.txt)                                                 | 62     |
| [server-1440.log.txt](server-1440.log.txt)                                             | 141    |
| [server-390.log.txt](server-390.log.txt)                                               | 141    |
| [server-import-error.log.txt](server-import-error.log.txt)                             | 1121   |
| [server-selector-error.log.txt](server-selector-error.log.txt)                         | 47     |
| [server.mjs.txt](server.mjs.txt)                                                       | 731    |
| [source-context.log.txt](source-context.log.txt)                                       | 22299  |
| [supplemental-results.json](supplemental-results.json)                                 | 299    |
| [supplemental-server-1440.log.txt](supplemental-server-1440.log.txt)                   | 93     |
| [supplemental-server-390.log.txt](supplemental-server-390.log.txt)                     | 94     |
| [supplemental.log.txt](supplemental.log.txt)                                           | 633    |
| [supplemental.mjs.txt](supplemental.mjs.txt)                                           | 5840   |
| [targeted-tests.log.txt](targeted-tests.log.txt)                                       | 576    |
| [typecheck.log.txt](typecheck.log.txt)                                                 | 3994   |
| [web-coverage.log.txt](web-coverage.log.txt)                                           | 1925   |
| [width-1440.json](width-1440.json)                                                     | 940767 |
| [width-390.json](width-390.json)                                                       | 937854 |

## 5. Observations outside scope

The failed broad-suite tests and existing lint/dependency warnings were not fixed or classified as patch-caused. No staging, commits, GitHub messages or owner-environment actions were performed. The QA branch name is expected; no branch discrepancy remains.

Disposable directories left for the orchestrator (none deleted): primary stores listed above, plus setup-only stores `%USERPROFILE%\AppData\Local\Temp\gg-qa-g2-240-ZPQpgd` and `%USERPROFILE%\AppData\Local\Temp\gg-qa-g2-240-wYeI3V`. Build output, Turbo metadata, and any partial coverage artifacts are left in place.
