# Independent QA: WP-E1 bolt #186, server and transport

## Verdict

**Pass with minor defects** for revision `8b760b6b1250bd64ab541cbfd53af83c04e140e2`. D1 is a terminal-cursor latency defect. Interpret the native-restart verdict with the final direct-IPC evidence below, not the discarded fixture attempts. This report qualifies only the server/transport half; it does not close #186, UoW #303 or intent #287.

Branch `codex-qa-wp-e1-186`; worktree `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-qa-wp-e1-186`. No production code, production tests, Git index, commits, other checkouts, owner stores, provider turns or owner ports were changed. Only this QA evidence folder is untracked. Work was performed alone. No commits.

## Environment and method

Node 22.14.0 on Windows; built API public exports, real file-backed SQLite, real TCP/HTTP sockets; fake harnesses only. Edge 156.0.4314.42, headless, 1440 × 900 and 390 × 900. Ports 5950,5952,5954 (and the preserved first restart attempt 5953); benchmark 5955. Disposable runtime/data/output directories are under the `gg-qa-e1-186-` temp prefix. Exact paths and process IDs are in the result JSONs, with local user paths normalized to `%USERPROFILE%`.

Seeded event histories exercise the real append/read/subscribe ports. They are transport fixtures, not proof of live-provider work or integrated sustained-loop acceptance. The perf benchmark additionally executes 1,000 passes through the real manager using a fake producer. The restart fixture uses neutral `signal.received` history so it does not falsely wake an input wait during recovery. Public dependency injection decorates the event-store port for measurement and real query-fault injection; no production method was monkey-patched.

Touched systems enumerated: SQLite event persistence and paging; REST event negotiation, query validation and ownership lookup; SSE replay, live handoff, notification pressure, terminal completion and writable backpressure; typed API-client controls, parsing, retry and cursor recovery; inspector batching, stored cursor, timeline rendering, reachability/reconnect and native restart. Generated API docs and design-token gates were checked. MCP/external providers were not exercised because no independent changed MCP transport path or live-provider authorization is in this half.

## Checks

| System / case                             | Steps                                                                                                                                                                | Expected                                                                                        | Actual                                                                                                                                             | Result                                       | Kept evidence                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Admission                                 | Read binding briefs, issue #186, #303, #287, #278 and ADR-0050; compare HEAD and dependencies.                                                                       | Exact pinned revision; installed local dependencies.                                            | HEAD 8b 760b 6b 1250bd 64ab 541cbfd 53af 83c 04e 140e 2; branch codex-qa-wp-e 1-186; dependencies present; initially clean.                        | PASS                                         | [environment](environment.json), [requirements](inputs/issue-186.md)                                |
| Built product                             | Node 22 first on PATH; pnpm.cmd build; import built package entry points.                                                                                            | Build succeeds; no development-source substitution.                                             | 11/11 build tasks passed; six cache hits; cache-write IO warnings. Runtime workers use built exports.                                              | PASS                                         | [build](build.log.txt), [worker](worker.mjs.txt)                                                    |
| Heavy append / zero cursor                | Seed 40,000 durable events, run fetch and API client plus Edge, append for 15 s.                                                                                     | Every event exactly once and ordered, no slow control for fast transport readers.               | Measured 199.79 events/s; 43006 events; both full readers had zero gaps/duplicates/controls/errors; Edge 43006 ordered rows.                       | PASS                                         | [rate result](rate-results.json), [script](rate-probe.mjs.txt), [Edge](rate-200-inspector-1440.png) |
| Heavy append / mid cursor                 | Same run; two additional readers start after 20,000.                                                                                                                 | Exact suffix, no duplicate/gap/control.                                                         | Both readers received 23006 events through 43006.                                                                                                  | PASS                                         | [rate result](rate-results.json)                                                                    |
| Earlier host-contention workload          | Four readers, 40k log, timer-paced producer.                                                                                                                         | Record actual rate rather than assuming configured rate.                                        | 139.73 events/s; all readers complete; superseded for the requested rate by the measured 199.79 events/s run.                                      | PASS at measured rate                        | [runtime](runtime-results.json)                                                                     |
| Server paging                             | Observe injected public EventStorePort while real sockets read SQLite.                                                                                               | Every replay read limited to 128 events.                                                        | Recorded limits are 128; maximum returned page 128. Notifications remain backed by the durable repository.                                         | PASS                                         | [runtime](runtime-results.json), [rate](rate-results.json)                                          |
| Stored history / timestamps               | Read all events through REST pages and compare complete-event serialization hashes.                                                                                  | No truncation, exactly matching full-reader payloads, ordering by seq despite equal timestamps. | 42,102 events in 329 pages; zero gaps; 41,484 identical adjacent timestamp pairs; both full-reader SHA-256 values equal durable history.           | PASS                                         | [follow-up](followup-results.json), [script](followup.mjs.txt)                                      |
| Socket pause / bounded queue              | Pause a raw HTTP reader 5.6 s while replay writes. Sample ServerResponse and socket writableLength every 5 ms.                                                       | Bounded pending bytes; explicit failure only after drain timeout/ceiling.                       | 17,193-byte sampled peak for stalled socket; longest need-drain interval 5,605.44 ms; received 503 SSE_SLOW_CONSUMER at 5,655.23 ms.               | PASS                                         | [runtime](runtime-results.json), [worker sampler](worker.mjs.txt)                                   |
| Stalled cursor recovery                   | Reconnect after last complete event 268.                                                                                                                             | Exact remaining suffix, no loss or duplicates.                                                  | 268 + 39,734 = 40,002 events, zero gaps/duplicates; no control on resumed connection.                                                              | PASS                                         | [follow-up](followup-results.json)                                                                  |
| Paced reader / actual timeout             | Hold 1 s, then pause 5 ms per HTTP data callback.                                                                                                                    | Respect measured drain deadline; resume any explicit failure.                                   | This pace actually stalled drain 5,063.59 ms and correctly received SSE_SLOW_CONSUMER; 4,108 + 35,894 = 40,002 complete events after resume.       | PASS with harness qualification              | [runtime](runtime-results.json), [follow-up](followup-results.json)                                 |
| Realistic slow benchmark                  | Built perf replay: initial 1 s socket hold, 50 ms paced reads.                                                                                                       | Complete durable payload and reconnect hashes.                                                  | 41,008 events, replayOk true; full, slow, late and interrupted/reconnected checks passed.                                                          | PASS                                         | [perf result](perf-results.json), [measurement log](measurement.log.txt)                            |
| Terminal replay from zero / middle        | Open finished run after 0 and 21,051.                                                                                                                                | End at terminal event with exact count.                                                         | 42,102 and 21,051 events respectively; both end at seq 42,102; no gaps, duplicates or controls.                                                    | PASS                                         | [runtime](runtime-results.json)                                                                     |
| Terminal replay from previous event       | Open after 42,101.                                                                                                                                                   | One terminal event, then EOF.                                                                   | One event; 19.78 ms total.                                                                                                                         | PASS                                         | [runtime](runtime-results.json)                                                                     |
| At / past terminal cursor                 | Open at 42,102 and past at 42,202; repeat separately.                                                                                                                | Zero events and prompt EOF.                                                                     | Zero events, but 1,533.89 / 2,643.72 ms initially and 3,028.24 / 2,052.40 ms in follow-up. Full-history validation precedes the empty response.    | FAIL: D1 (minor latency)                     | [runtime](runtime-results.json), [follow-up](followup-results.json)                                 |
| Transient later-page storage fault        | Public EventStorePort decorator temporarily renames SQLite run_events when read cursor >=128, performs real failing read, restores table, throws actual query error. | SSE_REPLAY_FAILED retry resumes at cursor and finishes without gap.                             | Client reported retryable control, reopened and completed all >600 events without a gap.                                                           | PASS                                         | [runtime](runtime-results.json), [fault implementation](worker.mjs.txt)                             |
| Corrupt later-page storage                | Change seq 129 payload to invalid JSON through real SQLite client, read raw and API-client streams, repair disposable row.                                           | Fatal STORED_EVENT_INVALID control has no id; cursor stays 128.                                 | 128 healthy events; id-less fatal control; client done rejected with STORED_EVENT_INVALID and lastSeq 128.                                         | PASS                                         | [runtime](runtime-results.json)                                                                     |
| Count overflow and oversized notification | After live handoff append 600 events synchronously, then one 1,100,000-character value.                                                                              | Paged catch-up rather than slow-consumer failure; exact delivery.                               | Client completed with no gap, duplicate, error or control.                                                                                         | PASS                                         | [runtime](runtime-results.json)                                                                     |
| REST page boundary                        | GET events?after=20000&limit=128.                                                                                                                                    | Exact 128-event suffix and next cursor.                                                         | First 20001, last 20128, nextAfter 20128, hasMore true.                                                                                            | PASS                                         | [runtime](runtime-results.json)                                                                     |
| Bad query / missing run                   | Request negative after, limit 1001, missing valid-format run id.                                                                                                     | 400,400,404 problem responses.                                                                  | 400 VALIDATION_FAILED; 400 VALIDATION_FAILED; 404 RUN_NOT_FOUND.                                                                                   | PASS                                         | [runtime](runtime-results.json)                                                                     |
| Route named in brief                      | Request /runs/{id}/events/stream.                                                                                                                                    | Reconcile actual supported public API.                                                          | 404 NOT_FOUND. The documented route is /events with Accept:text/event-stream; all transport checks used that route.                                | BRIEF MISMATCH                               | [runtime](runtime-results.json), [API reference](../../reference/api.md)                            |
| Inspector desktop                         | Open long terminal history in Edge at 1440 × 900; verify every DOM seq.                                                                                              | Complete ordered timeline; measure heap and long tasks.                                         | 42,102 ordered rows; 43,893.09 ms navigation-to-check completion; 718,459,780 byte sampled peak heap; 20 long tasks, maximum 5,894 ms.             | PASS correctness; responsiveness observation | [browser result](browser-results.json), [desktop screenshot](long-terminal-1440.png)                |
| Inspector live narrow                     | Open 40k live run at 390 × 900 while more events append; inspect complete sequence.                                                                                  | Complete ordered live timeline without horizontal document overflow.                            | 41,472 rows while loading, then 41,710 caught up; zero gaps/duplicates; document width 390.                                                        | PASS                                         | [browser result](browser-results.json), [narrow screenshot](live-caught-up-390.png)                 |
| Inspector keyboard                        | Focus first timeline control with CSS locator; press Tab.                                                                                                            | Keyboard focus advances to an inspector button.                                                 | Focus state retained in browser results. Two earlier broad accessibility selectors were too costly and replaced with scoped public DOM operations. | PASS at observed control                     | [browser result](browser-results.json), [browser script](browser.mjs.txt)                           |
| Native restart / reload                   | Keep narrow inspector open; kill actual built fake-only API worker, boot new PID on same disposable store, append 100, cancel, reload.                               | Cursor-based ordered recovery and complete terminal/reloaded timeline.                          | See final direct-IPC restart result; benign signal history avoids waking the input-wait fixture.                                                   | PASS                                         | [restart result](restart-results.json), [script](restart-probe.mjs.txt)                             |

### Final native restart evidence

- Pass flag: `true`; error: none.
- Native exit: `{"pid":36944,"code":null,"signal":"SIGTERM"}`; boots: `[{"pid":36944,"ms":9708.189400000001},{"pid":7584,"ms":7356.497599999995}]`.
- Timeline checks: before-kill: 40000/40000, gaps=0, duplicates=0, pass=true; after-restart: 40100/40100, gaps=0, duplicates=0, pass=true; terminal: 40102/40102, gaps=0, duplicates=0, pass=true; reload: 40102/40102, gaps=0, duplicates=0, pass=true.
- API-client result: cursor 40102, gaps 0, rejection none recorded. Reconnect URLs, errors and failures are retained in [restart-results.json](restart-results.json).

## Defects

### D1 — Minor: empty terminal-cursor request scans the complete history

Reproduce by opening the built API stream for a terminal 42,102-event run with `after=42102` or `after=42202`. Expected: immediate empty completion. Actual: no events are delivered, but EOF takes 1.53–3.03 seconds in retained runs; the past-end request took 2.64 seconds initially and 2.05 seconds in the follow-up. Full replay in the follow-up took 2.78 seconds. The terminal confirmation path in [sse.ts](../../../apps/api/src/sse.ts) walks the history from zero,128 events per read, before starting the empty response. No data loss or ordering defect was observed. The probe's 2second flag is an engineering diagnostic, not an owner-approved SLA; the recorded O(history) work is the reason for the finding. Evidence: [runtime-results.json](runtime-results.json), [followup-results.json](followup-results.json).

## Coverage of acceptance criteria

| #186 server/transport criterion                                    | Result                                                   | Evidence / limit                                                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay is paged; server buffers bounded                            | Passed on real sockets and SQLite                        | 128-event reads; sampled queue maximum 17,221 bytes across paced/stalled readers; perf memory samples. A5 ms sampler can miss short peaks.                                                          |
| Fast readers preserve every event during replay and active appends | Passed at 199.79 events/s                                | Four independent fetch/client readers from 0/20000 and Edge timeline through 43,006. Browser raw control-frame absence was not independently captured; UI completion and page errors were observed. |
| Slow/stalled explicit failure and gapless cursor recovery          | Passed                                                   | Measured >5s drain intervals; SSE_SLOW_CONSUMER; both complete suffix recoveries. Permanently unreadable peers cannot guarantee receipt of their own control.                                       |
| Exactly-once in-order delivery and stored history complete         | Passed                                                   | Durable full-log hashes equal both full-reader hashes; prefix/suffix recovery counts; equal timestamps covered.                                                                                     |
| Terminal runs from start/middle/end/past end                       | Correct counts passed; prompt past-end completion has D1 | Zero-event cursors scan complete history.                                                                                                                                                           |
| Read faults recover; corruption stays fatal without cursor advance | Passed                                                   | Actual SQLite query fault after first page; malformed stored JSON at 129; typed client assertions.                                                                                                  |
| Live overflow / oversized notification returns to catch-up         | Passed                                                   | 600-event burst plus 1.1MB payload, no control/error/gap.                                                                                                                                           |
| Inspector long/live/restart, widths 1440/390                       | Long/live passed; native restart per final result        | DOM sequence checks and screenshots. Full browsing retention and Timeline windowing remain explicitly deferred.                                                                                     |
| Memory and long-task measurement, same replay workload             | Measured                                                 | Server profiler and browser CDP/PerformanceObserver. Shared host contention limits timing generalization.                                                                                           |

Not independently isolated in the custom probes: forced writable-ceiling breach with an artificially raised Node high-water mark; deliberate live-notification sequence loss; a permanently stalled peer held beyond the forced-destroy grace; first-page read failure; malformed SSE field/partial-frame parser boundary permutations; direct observer access to the private temporary inspector batch. Maintained focused tests and package coverage, where completed below, are supplementary evidence rather than custom native evidence for those branches. No production internals were exposed to test them.

## Measurements and comparison

Exact workload: `node tooling/perf/measure.mjs replay --passes=1000 --profile=inspector --port=5955 --store-prefix=gg-qa-e1-186- --out=<disposable output>`. No profiler/workload settings were changed. The complete invocation is in [perf/invocation.json](perf/invocation.json). Host: AMD Ryzen 5 3600,12 logical CPUs, 99.13% measured busy; other users/processes uncontrolled. Static and coverage QA work also ran on this shared host at other points. Comparison values below come from the retained [reference-after snapshot](inputs/reference-after.md), not a new baseline checkout.

| Measurement                         | Earlier after report | Independent QA |
| ----------------------------------- | -------------------: | -------------: |
| Durable events                      |               41,008 |         41,008 |
| Full replay first event ms          |                21.69 |          17.53 |
| Full replay total ms                |             7,077.82 |       1,995.78 |
| Maximum event-loop delay ms         |               569.38 |          18.01 |
| Paused outstanding wire bytes       |              538,592 |        522,592 |
| Full replay sampled peak heap bytes |           55,625,912 |     55,505,064 |
| Full replay baseline heap bytes     |           39,803,824 |     39,632,784 |
| Host busy                           |               98.62% |         99.13% |

All 41,008-event full/slow/late/reconnect hash checks passed. Outstanding wire bytes include buffers outside Node's writable queue; do not compare that figure directly with the 256 KiB JavaScript ceiling. Evidence: [perf-results.json](perf-results.json), [measurement.log.txt](measurement.log.txt), [small raw summaries](perf/summary.json), and the [large-capture manifest](NOT-KEPT.md).

Desktop inspector: sampled peak JS heap 718,459,780 bytes, 43,893.09 ms through the full verification/capture, 20 observed long tasks totaling 33,513 ms, maximum 5,894 ms. DOM row creation remains expensive. This is an observation for the deferred windowing work; temporary SSE batching does not bound the retained full DOM/history. CDP samples and individual long tasks are in [browser-results.json](browser-results.json).

## Gates and maintained tests

- `pnpm.cmd typecheck`: PASS, 89.44s; [typecheck.log.txt](typecheck.log.txt).
- `pnpm.cmd lint`: PASS, 191.39s; [lint.log.txt](lint.log.txt).
- `pnpm.cmd format:check`: PASS, 770.59s; [format-check.log.txt](format-check.log.txt).
- `pnpm.cmd check:layers`: PASS, 0.84s; [check-layers.log.txt](check-layers.log.txt).
- `pnpm.cmd check:deps`: PASS, 13.05s; [check-deps.log.txt](check-deps.log.txt).
- `pnpm.cmd check:docs`: PASS, 6.1s; [check-docs.log.txt](check-docs.log.txt).
- `pnpm.cmd check:tokens`: PASS, 5.18s; [check-tokens.log.txt](check-tokens.log.txt).

| Package    | Coverage run  |   Lines | Branches | Evidence                           |
| ---------- | ------------- | ------: | -------: | ---------------------------------- |
| api-client | PASS          |    100% |    98.3% | [log](coverage-api-client.log.txt) |
| web        | not completed | see log |  see log | [log](coverage-web.log.txt)        |
| api        | not completed | see log |  see log | [log](coverage-api.log.txt)        |

Focused tests: 14 server tests in 2 files and 15 inspector-hook tests passed. Exact commands and results are in [focused-results.json](focused-results.json); verbose logs record live-gap catch-up, a paused real high-water-mark writable-ceiling failure and reconnect cleanup. No focused assertion failed. Full-web coverage was deliberately interrupted after 24/127 coverage parts and more than 20 minutes; full API coverage did not start. These two package coverage gates remain unqualified in this QA run; see [coverage-interruption.json](coverage-interruption.json).

Exact coverage commands and exit codes: [coverage-results.json](coverage-results.json). No threshold or exclusion was changed. New/changed production tests: none. Custom QA probes are archived as `.mjs.txt`; execute disposable `.mjs` copies with Node 22 and `--experimental-import-meta-resolve` from the worktree root. No pnpm store-lock fallback was used unless explicitly recorded in a gate log. Cache-write warnings are distinct from command exit status. Licenses were not rerun: no dependency changed. No behavior docs/ADRs/CHANGELOG/generated references were edited by QA.

## Harness failures and evidence provenance

- First transport attempt expected `GET /runs/{id}` to return `{run}`; corrected to the actual direct record. See `probe-attempt-1` artifacts. It is not product evidence.
- Full 40000-row accessibility snapshot and broad role-based selection were too expensive for the harness; kept desktop capture and source attempts, then used scoped DOM selectors and a small nav snapshot. No product behavior was changed to accommodate the harness.
- The file-based control channel read partially written JSON and stopped the first browser/restart attempt. Its long/live observations remain valid; its native-restart stage does not qualify the criterion.
- The first direct-restart fixture contained `run.woken` events, so actual engine recovery finished the wait/run before a manually appended burst. The resulting timeline timeout is a fixture error, not loss of post-terminal events. [Diagnosis](restart-attempt-1-diagnosis.json). The final direct-IPC probe uses a fresh neutral-event fixture.
- The original paced-reader boolean also assumed a fixed callback delay could never cause a 5second drain stall and compared combined recovery against the interrupted paced prefix. Its raw false flag is retained. Measured timeout validity and complete 40002-event recovery are established by the separately kept follow-up; no production retry-to-green was performed.
- Source/provider claims from the implementation/review were not used as independent runtime evidence. The earlier measurement document is used only for the requested numeric comparison.

## Observations outside scope and open items

- The brief's `/events/stream` path returns 404; the current documented negotiation route is `/events`. Reconcile the brief, rather than infer an unrequested new route.
- Full history/windowing remains later work. The desktop measured up to 5,894 ms in one long task and about 685.18 MiB sampled heap; complete transport delivery does not establish responsive full-history rendering.
- No claim of whole-I05 integrated acceptance, owner acceptance, live harness behavior, mobile product acceptance or post-merge human QA is made.
- No directories were deleted. The [NOT-KEPT manifest](NOT-KEPT.md) inventories large disposable stores/profiles; the orchestrator owns final temp/build/coverage cleanup. Local paths are portable placeholders; disposable API credentials are not copied.

## Evidence index

Every kept artifact in this QA folder is linked below. Files exceeding 1000000 bytes are outside the evidence folder and inventoried by original size and SHA-256 in [NOT-KEPT.md](NOT-KEPT.md). The [artifact manifest](artifact-manifest.json) hashes retained bytes after path/encoding normalization; no raw JSON/script reformatting is required for provenance.

- [NOT-KEPT.md](NOT-KEPT.md)
- [artifact-manifest.json](artifact-manifest.json)
- [attempt-1-restart-probe.mjs.txt](attempt-1-restart-probe.mjs.txt)
- [attempt-1-restart-results.json](attempt-1-restart-results.json)
- [attempt-1-restart.log.txt](attempt-1-restart.log.txt)
- [browser-attempt-1-long-terminal-1440.png](browser-attempt-1-long-terminal-1440.png)
- [browser-attempt-1.log.txt](browser-attempt-1.log.txt)
- [browser-attempt-1.mjs.txt](browser-attempt-1.mjs.txt)
- [browser-attempt-2-results.json](browser-attempt-2-results.json)
- [browser-attempt-2.log.txt](browser-attempt-2.log.txt)
- [browser-attempt-2.mjs.txt](browser-attempt-2.mjs.txt)
- [browser-harness-stop.log.txt](browser-harness-stop.log.txt)
- [browser-results.json](browser-results.json)
- [browser.log.txt](browser.log.txt)
- [browser.mjs.txt](browser.mjs.txt)
- [build.log.txt](build.log.txt)
- [check-deps.log.txt](check-deps.log.txt)
- [check-docs.log.txt](check-docs.log.txt)
- [check-evidence.mjs.txt](check-evidence.mjs.txt)
- [check-layers.log.txt](check-layers.log.txt)
- [check-tokens.log.txt](check-tokens.log.txt)
- [coverage-api-client-summary.json](coverage-api-client-summary.json)
- [coverage-api-client.log.txt](coverage-api-client.log.txt)
- [coverage-api.log.txt](coverage-api.log.txt)
- [coverage-interruption.json](coverage-interruption.json)
- [coverage-results.json](coverage-results.json)
- [coverage-web.log.txt](coverage-web.log.txt)
- [environment.json](environment.json)
- [final-format-check.log.txt](final-format-check.log.txt)
- [final-format.log.txt](final-format.log.txt)
- [focused-api.log.txt](focused-api.log.txt)
- [focused-results.json](focused-results.json)
- [focused-web.log.txt](focused-web.log.txt)
- [followup-results.json](followup-results.json)
- [followup.log.txt](followup.log.txt)
- [followup.mjs.txt](followup.mjs.txt)
- [format-check.log.txt](format-check.log.txt)
- [gates.json](gates.json)
- [inputs/ADR-0050.md](inputs/ADR-0050.md)
- [inputs/COMMON.md](inputs/COMMON.md)
- [inputs/QA-COMMON.md](inputs/QA-COMMON.md)
- [inputs/issue-186.md](inputs/issue-186.md)
- [inputs/issue-278.md](inputs/issue-278.md)
- [inputs/issue-287.md](inputs/issue-287.md)
- [inputs/issue-303.md](inputs/issue-303.md)
- [inputs/reference-after.md](inputs/reference-after.md)
- [integrity-results.json](integrity-results.json)
- [lint.log.txt](lint.log.txt)
- [live-caught-up-390.png](live-caught-up-390.png)
- [live-caught-up-390.snapshot.log.txt](live-caught-up-390.snapshot.log.txt)
- [live-loading-390.png](live-loading-390.png)
- [live-loading-390.snapshot.log.txt](live-loading-390.snapshot.log.txt)
- [long-terminal-1440.png](long-terminal-1440.png)
- [long-terminal-1440.snapshot.log.txt](long-terminal-1440.snapshot.log.txt)
- [measurement.log.txt](measurement.log.txt)
- [pack-evidence.mjs.txt](pack-evidence.mjs.txt)
- [perf-location.log.txt](perf-location.log.txt)
- [perf-results.json](perf-results.json)
- [perf/invocation.json](perf/invocation.json)
- [perf/memory-live.jsonl](perf/memory-live.jsonl)
- [perf/memory.jsonl](perf/memory.jsonl)
- [perf/summary.json](perf/summary.json)
- [probe-attempt-1.log.txt](probe-attempt-1.log.txt)
- [probe-attempt-1.mjs.txt](probe-attempt-1.mjs.txt)
- [probe.log.txt](probe.log.txt)
- [probe.mjs.txt](probe.mjs.txt)
- [rate-200-inspector-1440.png](rate-200-inspector-1440.png)
- [rate-probe.mjs.txt](rate-probe.mjs.txt)
- [rate-results.json](rate-results.json)
- [rate-tail.mjs.txt](rate-tail.mjs.txt)
- [rate.log.txt](rate.log.txt)
- [restart-after-restart-390.png](restart-after-restart-390.png)
- [restart-attempt-1-diagnosis.json](restart-attempt-1-diagnosis.json)
- [restart-before-kill-390.png](restart-before-kill-390.png)
- [restart-probe.mjs.txt](restart-probe.mjs.txt)
- [restart-reload-390.png](restart-reload-390.png)
- [restart-results.json](restart-results.json)
- [restart-tail.mjs.txt](restart-tail.mjs.txt)
- [restart-terminal-390.png](restart-terminal-390.png)
- [restart.log.txt](restart.log.txt)
- [runtime-attempt-1.json](runtime-attempt-1.json)
- [runtime-location.log.txt](runtime-location.log.txt)
- [runtime-results.json](runtime-results.json)
- [typecheck.log.txt](typecheck.log.txt)
- [worker-rate.mjs.txt](worker-rate.mjs.txt)
- [worker-restart.mjs.txt](worker-restart.mjs.txt)
- [worker.mjs.txt](worker.mjs.txt)
- [write-report.mjs.txt](write-report.mjs.txt)
