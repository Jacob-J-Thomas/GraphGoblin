# Independent WP-G2 QA report

## 1. Branch and worktree

Tested head: 9896cf769fb46fd9a474c7de2a20078971eda9a2. Branch: codex-qa-wp-g2. Worktree: GraphGoblin/.claude/worktrees/codex-qa-wp-g2. Initial tracked tree and index were clean. This is an independent QA thread; no subagents, product edits, commits, staging, GitHub writes or owner-app actions were performed.

**Behavioral verdict: PASS for the round-4 requested-page isolation fix and the #231/#236 acceptance criteria. Full required-suite/gate verdict: FAIL (infrastructure and web full suites red; frozen install host-blocked). All requested runs and isolated triage are complete.** This report does not grant integration, CI or designated-session merge sign-off.

Environment and exact commands are in [environment.txt](environment.txt). Node 22.14.0, built native API/MCP, real file-backed SQLite, Microsoft Edge 155.0.4283.62. The main QA listener was 5633; the unchanged Edge specs used a temporary test-harness copy on 5634/5635 with control 5639, against built public packages and the built web app. Test-only API fixtures use ephemeral loopback listeners. All stores were confined under the QA temporary root. Cleanup passed: the root was removed, including 63 database files; assigned QA listeners are closed. See cleanup.txt and cleanup-inventory.txt.

The [prior independent audit](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/367#issuecomment-6327114818) at 0536cdff3227295530d5599a99b0071b1517b82f was read live. Its malformed-lookahead defect was retested rather than assumed fixed. The recipe, seed and round-4 report were read as instructions/history, not counted as fresh evidence.

## 2. Per bolt and defects

The audit finding is FIX VERIFIED on this head. No remaining product defect was reproduced within #231/#236, so no new product-defect severity is assigned. Required test gates remain failed as detailed below.

| Criterion or requested check                                          | Result                                                                                                                                                                        | Evidence                                                                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| #231 opaque cursors and active filters through API/client/MCP/browser | PASS in custom native checks; package-suite result below                                                                                                                      | [checks.md](checks.md), filtered/tied traversal and MCP cursor comparisons                           |
| #231 tied timestamps do not skip/duplicate a fixed dataset            | PASS: 105 run IDs and 105 inbound IDs, limit-one traversal, descending ID tie-break and null exhaustion                                                                       | functional.jsonl, tied-runs-filtered-continuation and tied-events-filtered-continuation              |
| #231 invalid status/cursor/filter inputs return typed 4xx             | PASS: status unknown, malformed/empty cursors, invalid limits, unknown run filter and invalid before                                                                          | functional.jsonl, invalid-query-problems                                                             |
| Run-event lookahead with {} and malformed JSON                        | PASS: unchanged page 200 seq 1/nextAfter 1/hasMore true; requested seq 2 and larger page containing it 500 STORED_EVENT_INVALID; restore 200; native MCP agrees               | [lookahead-retest.jsonl](lookahead-retest.jsonl)                                                     |
| Inbound payload and run_ids malformed lookahead                       | PASS: page 200 and non-null cursor; own/middle requested corruption 500 application/problem+json INTERNAL_ERROR; restore 200                                                  | functional.jsonl, inbound-lookahead-payload and inbound-lookahead-run_ids                            |
| Damaged run lookahead; inspector/diagnostics; API/MCP continuation    | PASS: healthy page retained, empty unreadable page carries cursor, following healthy run reachable, inspector 500 STORED_RUN_INVALID, diagnostics identifies damaged row      | functional.jsonl, runs-corrupt-lookahead-mcp-diagnostics                                             |
| Runs real all-unreadable page                                         | PASS: first 100 damaged rows produce an empty readable page with a real cursor; UI continues to 100 healthy older rows                                                        | functional.jsonl, runs-native-unreadable-page                                                        |
| Events successful empty-readable page                                 | PASS with controlled-response evidence only: empty first response retains a real cursor; UI loads final 5                                                                     | functional.jsonl, events-empty-page-controlled                                                       |
| Events actual malformed requested page                                | Strict error contract verified. A whole malformed page returns500 without cursor; UI cannot skip it without repair. This does not establish real malformed-page continuation. | [adjacent.jsonl](adjacent.jsonl), whole-unreadable-inbound-page-contract; events-corrupt-page-repair |
| #236 older loop beyond 500 unrelated runs                             | PASS: older succeeded run correctly linked beyond 606 newer runs; only genuine empty loop says never run                                                                      | native seed/summaries; Edge history spec; loop-summaries.txt                                         |
| #236 tie order and unreadable latest summary                          | PASS: latest ID follows descending ID tie-break; damaged latest retains count 501 and shows unavailable rather than never run                                                 | tied-runs-filtered-continuation; damaged-latest-summary in adjacent.jsonl                            |
| Delete warning                                                        | PASS: busy-history warning includes all 501 runs; Keep preserves all 4 loops                                                                                                  | recipe-loop-summaries-delete                                                                         |
| Outage and restart/retry                                              | PASS: stopping QA native API retains 100 event rows and long payload; restart same store then retry reaches 105 once                                                          | recipe-native-outage-retry; outage.txt and outage-recovered.txt                                      |
| Keyboard focus, scroll, payload and 390px                             | PASS in dark/light at 1440/390:100 to 105, zero scroll/payload-top delta, exhaustion focused, no page overflow, solid 2px focus outline                                       | recipe-runs/events entries; [visual-inspection.txt](visual-inspection.txt)                           |
| Background polling and rapid actions                                  | PASS: held background poll keeps enabled opacity 1; two Enter presses issue one append and produce 105 unique rows                                                            | polling-focus-rapid-activation in adjacent.jsonl                                                     |
| Two tabs                                                              | PASS with explicit activation of each tab and unchanged timeouts; initial inactive-tab simultaneous-click timeout retained as an automation limitation                        | [two-tabs-retest.jsonl](two-tabs-retest.jsonl); initial adjacent.jsonl failure                       |

The additional browser row 101 check retains 100 runs and appends 4 healthy rows (104 total); damaged-run-inspector.txt visibly names STORED_RUN_INVALID. The native inbound run_ids boundary check similarly retains 100, reports the requested corrupt page, and reaches 105 after repair. A supplemental logger failed after the inspector assertion and snapshot because it referenced a nonexistent main element; that failed harness record is retained, and no broad suite was rerun for it.

All gate and suite checks expected exit0, with coverage above90% for lines and branches. The tables and raw command outputs record the actual result.

Every custom check has its steps, expected result, actual result, pass/fail and evidence in [checks.md](checks.md). Initial QA harness errors remain visible: an MCP readable error was mistakenly parsed as JSON, and a simultaneous click targeted an inactive Edge tab. Corrected targeted follow-ups changed only the QA harness, retained timeouts and did not rerun broad suites.

**Brief interpretation limit:** the request to page past an all-unreadable Events page has two meanings. A successful empty page with nextCursor continues. Requested malformed inbound JSON is explicitly rejected with500 and supplies no continuation. The latter cannot be claimed passed as skip/continue behavior; the report preserves this distinction and does not silently turn a rejected page into an empty page. No clarification arrived during this run. If the brief literally requires skipping a rejected malformed inbound page, that condition is not met; the successful empty-page continuation check is controlled-response evidence, not a production malformed-row skip.

## 3. Files changed

Only this QA evidence directory is added. Small text reports, exact commands, scripts, JSONL responses, DOM snapshots and suite/triage excerpts are retained. No production source, existing tests, numbered docs, generated references, dependencies or lockfile were changed. No edits to another work package's owned files.

## 4. Tests

No product regression test was added or changed. Custom reproducible scripts use public HTTP/MCP/browser interfaces and real external SQLite fault injection.

The unchanged Edge history.spec.ts passed 3/3 with zero retries after build: Runs append/filter preservation, Events reading position/focus, and older loop summary beyond 500 unrelated runs. See [gate-edge.txt](gate-edge.txt). The temporary harness changes only listener ports and uses built public package entries; its fake harness is not provider evidence.

| Package        | Full suite                                                    | Lines              | Branches           |
| -------------- | ------------------------------------------------------------- | ------------------ | ------------------ |
| Infrastructure | FAIL: 607 passed, 22 failed/629;4 failed and 41 passed files  | 96.79% (1966/2031) | 93.49% (1537/1644) |
| API            | PASS: 723 passed, 6 skipped/729;54 passed and 2 skipped files | 97.84% (1771/1810) | 92.91% (1259/1355) |
| API-client     | PASS: 72/72;8 files                                           | 100% (246/246)     | 99.37% (160/161)   |
| MCP            | PASS: 47/47;8 files                                           | 96.66% (232/240)   | 95.81% (206/215)   |
| Web            | FAIL: 1450 passed, 15 failed/1465                             | 98.25% (6941/7064) | 93.70% (7073/7548) |

The infrastructure full-run failures comprise seven native process-tree cases (D-015) and fifteen 20-second upgrade deadlines. Web had seven 20-second deadlines and eight restoration assertions. All 37 failures were exercised alone after all full suites finished, with exactly one selected test per command and unchanged timeouts/assertions.

**Isolated results: 30 passed, 7 failed.** All 15 upgrade cases and all 15 web cases passed alone. The seven native cases still failed through cancellation/deadline/marker assertions and busy fixture cleanup. Full-run timeouts are classified as load/deadline failures; the restoration assertions were not reproduced individually and remain a full-run timing/order concern. This does not resolve either failed full suite.

Every isolated check includes its file/title, steps, expected, full-run actual, isolated actual, selected count, result and evidence in [triage.md](triage.md) and [triage-results.json](triage-results.json). Exact full-suite commands and counts are in [suites.json](suites.json). The duplicate descendant failure header was a test plus its cleanup error, not an extra test.

The first selector attempt selected zero tests in37 collection-only commands; all are excluded from pass totals and preserved as selector-miss-*.txt. The corrected title-word selectors executed exactly one intended case each; no product assertion or timeout was changed, and no broad suite was rerun.

## 5. Gates

| Command                                                             | Result                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| pnpm.cmd install --frozen-lockfile                                  | FAIL: sandbox denies pnpm global store-operation lock; existing provisioned dependencies used                                      |
| pnpm.cmd build                                                      | PASS: 11/11 tasks;5 cached;3m50.956s                                                                                               |
| pnpm.cmd typecheck                                                  | PASS                                                                                                                               |
| pnpm.cmd lint                                                       | PASS                                                                                                                               |
| pnpm.cmd format:check                                               | PASS; subsequent QA artifacts also pass scoped formatting verification                                                             |
| pnpm.cmd check:layers                                               | PASS                                                                                                                               |
| pnpm.cmd check:deps                                                 | PASS                                                                                                                               |
| pnpm.cmd check:docs                                                 | PASS                                                                                                                               |
| pnpm.cmd check:tokens                                               | PASS                                                                                                                               |
| Five requested package test:coverage commands                       | Infrastructure/web FAIL; API/API-client/MCP PASS; all coverage thresholds pass; isolated triage complete: 30 pass/7 D-015 failures |
| Edge history specs with GG_E2E_BROWSER_CHANNEL=msedge and retries 0 | PASS: 3/3                                                                                                                          |

Exact gate output is in the gate-*.txt files. No dependency or schema was changed by QA; licence/migration generation was not needed for QA edits.

## 6. Docs

Reviewed current behavior in docs 07/09, guide 03 and CHANGELOG. The recipe's preformatted-payload wording matches the actual renderer; it no longer claims an expanded disclosure. CHANGELOG lines 7/9 describe requested-page-only decoding, cursor/client upgrade behavior, strict inbound filter validation and authoritative run-event metadata. Line 10 describes loop-specific latest/count summaries and migration 0015. Generated documentation passed its currentness check. No docs correction is proposed by this QA.

## 7. Decisions and parameters

No engineering parameter, schema, timeout, threshold or product behavior was changed. All native fixture loops are deterministic manual-trigger/exit loops with no paid provider turns. Provider-backed behavior is not claimed. The user's explicit temp-store removal instruction takes precedence over the older common brief's no-directory-deletion rule; cleanup is restricted to the QA-created root after all processes/tests finish.

## 8. Caveats and open items

- Full-suite failures remain failures. The15 upgrade deadlines and seven web deadlines passed alone (load/deadline class); eight full-run restoration assertions also passed alone and remain a timing/order concern. No passing isolated result is substituted for a failed gate.
- D-015 native process-tree cases are sandbox artifacts; that classification is separate from the paging verdict.
- The frozen install could not be completed because of the global pnpm lock permission. Build and execution used provisioned dependencies. Critical workspace links resolve into this worktree. The installed lockfile differs only by the package-manager document and two unreachable dependency definitions; see installed-lock-diff.txt. No importer-version change appears in that diff; this is not substituted for a successful frozen install.
- Windows process inventory through CIM was denied; process cleanup uses owned child handles and assigned listener checks.
- No CI, target-branch integration/conflict resolution or final designated Codex merge sign-off was performed or inferred.
- Cleanup is complete:63 database files and the full QA temp root removed; all four assigned listeners closed. Final HEAD remains 9896cf769fb46fd9a474c7de2a20078971eda9a2, tracked diff and index diff are empty, and only this QA folder is untracked. No QA command remains running; owned API/MCP/browser handles were closed.

Completed 2026-10-22T04:17:18.910Z. Uncommitted QA evidence only; no commit created.
