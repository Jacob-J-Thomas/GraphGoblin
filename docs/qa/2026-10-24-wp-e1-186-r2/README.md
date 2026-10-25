# #186 round 2: browser history evidence

Measured on Node v22.14.0, Windows, headless Microsoft Edge 156.0.4314.42. The before candidate is main `456fcd613abb05701dcd8bcccfef410541716e68` with additive observer fields only. The after candidate is the uncommitted `codex-wp-e1-186-r2` implementation. Both use disposable stores and the same built-app workload: `browser --passes=1000 --aged=2000 --profile=inspector --browser-ms=5000`, 250 ms nominal sampling. Before uses port 5820, final after 5821; both use `gg-wp-e1-186r2-` store names. The before measurement ran October 24 local time; the final after rerun ran October 25 local time. The folder retains the requested October 24 batch date.

## Measurements

| Measurement                                   |                Before |                After |
| --------------------------------------------- | --------------------: | -------------------: |
| Inspector heap first / last / peak (MiB)      | 8.05 / 69.00 / 136.38 | 8.20 / 22.18 / 36.94 |
| Persisted cache peak (estimated UTF-16 bytes) |             3,420,384 |              384,288 |
| Timeline mounted rows, peak                   |                 4,586 |                   80 |
| Timeline descendant DOM nodes, peak           |                22,930 |                  400 |
| First rows observed (ms)                      |                2334.8 |               1246.8 |
| Loaded-history readiness (ms)                 |                2422.1 |               1406.2 |
| Pre-navigation target sequence                |                  3744 |                 3724 |

Both workloads completed all 1,000 passes with 13,010 stored events, 2,000 progress events, one terminal event and all context/visit/gate correctness checks true. The browser reported no page errors in either run; execution continued and the run remained active throughout observation. Heap is public CDP `JSHeapUsedSize`, without forced per-sample GC. First/last samples span navigation plus the 5-second post-readiness observation; a GC can lower a later sample. The table reports sample maxima rather than a claimed retained-heap ceiling. Cache bytes use JSON string length times two; Timeline DOM nodes are list descendants, excluding its surrounding controls.

This is one before/after observation pair on a shared workstation, not a quiet-host causal latency benchmark or SLA. Measured host busy fractions were 0.81114 before and 0.75377 after; web coverage was active during the final after invocation. First rows is an upper bound observed after shell readiness. The additive readiness guard now checks both acknowledgement and rendered tail against the pre-navigation target; the old unbounded list already made these agree. The after readiness count is 80 mounted rows, not total history; its rendered last sequence reached the target. The preliminary after capture was superseded after functional browser corrections and is listed in NOT-KEPT. The final after capture was repeated after the run/client cancellation fix and current build. Earlier after captures are superseded and listed in NOT-KEPT; they are not substituted for this revision's results.

Raw inputs: [before browser](before-browser.json), [after browser](after-browser.json), [before invocation](before-invocation.json), [after invocation](after-invocation.json), [before raw summary](before-raw-summary.json), [after raw summary](after-raw-summary.json). Heap/DOM/cache over time are retained in [before samples](before-inspector-samples.csv) and [after samples](after-inspector-samples.csv), with full CDP data in the browser JSON. [Before screenshot](before-browser-inspector.png) and [after screenshot](after-browser-inspector.png) show the actual served inspector. [Normalized results](measurement-results.json) contain exact bytes and milliseconds.

## Parameters and meaning

- 512 retained rows per run: about 40 passes of this cyclic workload, independently capped at 1,048,576 estimated UTF-16 row-JSON bytes. Cache framing, cursors and metadata add bounded overhead; JavaScript object overhead is not represented by this byte estimate. The existing maximum of 20 cached runs remains. No full-history array or per-sequence thread cache remains in the browser.
- 128 events per history page: matches bounded server replay reads; older/newer cursors are opaque to the client and sequence-based on the server. Identical timestamps do not affect order or membership. A page merge deduplicates by sequence and trims the opposite end, invalidating a displaced cursor.
- 80 mounted Timeline rows: bounded DOM without a dependency or fixed-height assumptions. Explicit row-window controls and keyboard movement preserve focus and names. Reader wheel/touch/scrollbar gestures pause follow; layout and programmatic scrolling do not.
- One explicitly selected oversized event can exceed the history byte budget transiently. It stays out of persistence, has a small selectable marker, and is released on the next selection. Current/selected thread values also retain their intrinsic requested size; this work bounds incidental history, not execution context or requested values.
- Follow live catches at most eight additional 128-event pages per action. Empty/nonadvancing or continuously outpacing history leaves browsing mode intact with a visible error. This is a finite recovery bound, not a run execution limit.
- Device cache version 2 discards the old unbounded cache once. No server stored shape or migration changes. Storage denial and failed cleanup remain nonfatal.

These numbers are engineering choices, not owner-approved product budgets.

## Projection audit

| Consumer                                                             | Source before                      | Source after                                            | Test                                                                   |
| -------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Status, position, failure, delivery and controls                     | Run record                         | Same record                                             | RunInspectorPage, attempt follower, thread-history Edge                |
| Latest exit, gate, finish and result fallback                        | Whole event array                  | Run record plus indexed `/observation`                  | history-browsing; API run-history; SQLite event-validation             |
| Current variables, messages, gate/visit/usage counters and iteration | Browser replay                     | #116 current-thread read                                | history-browsing; thread-history Edge; engine projection script        |
| Selected historical thread and patch values                          | Browser replay and 32-thread cache | `thread?at=N` and `at=N-1`; carried domain replay state | API run-history; domain replay; ThreadViewer; bounded-history Edge     |
| Timeline order, identity and selection                               | Whole event array                  | Retained rows; exact server seek/payload on demand      | event-retention; useRunHistory; history-browsing; bounded-history Edge |
| Node progress groups                                                 | Whole event array                  | Labelled retained window; older activity browsable      | existing Inspector progress tests; history-browsing                    |
| Attempt lifecycle                                                    | Browser array summary              | Indexed lifecycle evidence, with record reconciliation  | follow-run-attempts; resumed thread-history Edge                       |

The latest-gate read performs one indexed descending type scan with JSON gate filtering rather than one SQL round trip per ungated decision; stored corruption is still reported. Historical reconstruction carries replay state between pages and starts from the admitted seed or a verified preceding checkpoint. Current and selected server values never derive from the truncated browser window.

## Verification and delivery state

See [the eight-section handoff](REPORT.md) for exact command results, package coverage, regression provenance, changed files and remaining limitations. [NOT-KEPT](NOT-KEPT.md) records original capture sizes and SHA-256, including captures above 1,000,000 bytes. No directories were deleted. The implementation is uncommitted for orchestrator review. Independent review, QA, audit, CI and owner acceptance remain separate gates; this evidence does not close #186.
