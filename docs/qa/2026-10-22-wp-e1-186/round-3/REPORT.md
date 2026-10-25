# #186 round 3: bounded terminal confirmation

## 1. Branch and worktree

Branch `codex-wp-e1-186`, worktree `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-e1-186`, base/head `3289c122cdaa985d90d1c48e7d10bb8b5c830d58`. Uncommitted; ready for orchestrator commit after review. No staging, commit, push, merge, rebase, stash, branch switch or manual directory deletion. Owner ports/stores/checkout untouched. Manual built-API probes use port 5745; disposable stores use `gg-wp-e1-186-` under system temp. Existing automated tests use their ordinary ephemeral ports.

The independent QA folder's Git-canonical content matches the committed record; an invalid formatter attempt was reverted exactly (see the setup incident below). Its untouched working-copy logs retain CRLF; all 87 entries match the original manifest after Git's LF normalization ([check](original-qa-manifest-integrity.json)). Its final integrity result: 90 files checked; unchanged=true. [Integrity record](independent-qa-integrity.json). This evidence folder's round 3 is an implementation review-fix round, separate from deferred history browsing.

## 2. Per bolt

**#186 / QA D1: reproduced and bounded.** Before corrective production edits, five count regressions failed on source byte-identical to QA head `8b760b6b`. Empty replies made 26 reads for 3,000 events and 49 for 6,000, against a maximum of two. Catch-up past a terminal event followed by 300 delivery audits made 30 reads against four. [Initial red log](red.log.txt), [baseline source](baseline-sse.ts.txt), [source identity/proof](baseline-proof.json).

The final seven regressions were also run against the archived `8b760b6b` SSE source on the current dependency set, with the fixed source restored and SHA-256 checked in a finally block: 7 failed, 6 skipped. Quotes: `expected 26 to be less than or equal to 2`, `expected 49 to be less than or equal to 2`, `expected 30 to be less than or equal to 4`, and `expected +0 to be 2` for missing/resumed metadata not being consulted. [Final red log](final-red.log.txt), [proof runner](regression-proof.mjs.txt), [regression source as executed before final formatting](terminal-regression.test.ts.txt).

Both terminal-confirmation sites now query the indexed lifecycle tail. Empty first-page confirmation stays before headers so a corrupt marker is still an HTTP problem; the post-catch-up confirmation uses the same bounded callback and existing control-error handling. No current terminal marker retains defensive grace and the live subscription. New focused API cases: 13 passed (13); SQLite cases: 5 passed (5). [API](final-focused-api.log.txt), [SQLite](final-focused-infrastructure.log.txt). The earlier three-file API focused run also passed: 33 passed (33).

Built API, real file-backed SQLite, real raw HTTP reader, 42,102 events, three rounds at each cursor on fresh stores per phase; Node 22.14.0. Medians and observed ranges in milliseconds:

| Cursor |  Before median (range) ms | After median (range) ms | Paged reads before / after | Replay rows before / after | Lifecycle lookups before / after |
| ------ | ------------------------: | ----------------------: | -------------------------- | -------------------------- | -------------------------------- |
| 42102  | 3427.42 (2063.75–3810.80) |       7.70 (7.33–19.98) | 331 / 2                    | 42102 / 0                  | 0 / 1                            |
| 42202  | 2080.32 (2057.71–2164.80) |       6.92 (6.50–14.90) | 331 / 2                    | 42102 / 0                  | 0 / 1                            |

Every measured reply is HTTP 200, has zero event ids and zero error controls. Replay-row counts exclude the lifecycle lookup, which decodes at most one marker row after five fixed index seeks. Thus the after empty reply decodes one marker rather than the whole log. [Before results](terminal-before.json), [after results](terminal-after.json), [before log](terminal-before.log.txt), [after log](terminal-after.log.txt), [same probe source](terminal-probe.mjs.txt). Commands: `node --experimental-import-meta-resolve .tmp/gg-wp-e1-186-r3-terminal-probe.mjs before` and `after`, after their corresponding builds. The public-port fixture seeds/cancels a waiting run; it is transport evidence, not live-provider or whole-intent acceptance. Shared-host timings support only this case; no full-replay throughput claim or latency SLA is made.

## 3. Files changed

API: `sse.ts`, count/grace regressions in `sse-catchup.test.ts`, and the malformed-marker fixture in `sse.test.ts`. The only route edit is additive SSE callback wiring in `routes/runs.ts` (shared WP-G1 surface); JSON event paging and ownership checks stay intact. Infrastructure: one additional public SQLite query in `events.ts` and new `lifecycle-tail.test.ts`; no changes to the existing page/read/append methods, schema or index definitions. Docs and evidence are listed below.

| Tracked file                                    | Changed candidate line ranges                                      |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `CHANGELOG.md`                                  | 7                                                                  |
| `apps/api/src/routes/runs.ts`                   | 227                                                                |
| `apps/api/src/sse-catchup.test.ts`              | 151–195, 197–207, 209–218, 222–226, 230–233, 235, 239–242, 248–288 |
| `apps/api/src/sse.test.ts`                      | 98, 117                                                            |
| `apps/api/src/sse.ts`                           | 24–25, 246–252                                                     |
| `docs/07-api-and-streaming.md`                  | 133                                                                |
| `docs/10-testing-and-quality.md`                | 118–120                                                            |
| `docs/decisions/ADR-0050-bounded-sse-replay.md` | 6, 22–34                                                           |
| `packages/infrastructure/src/sqlite/events.ts`  | 119–149                                                            |

New files are the infrastructure test, implementation evidence README and round-3 artifacts. There are no proposed engine or protected recovery/reset implementation changes; incidental formatter edits were restored from HEAD. Source copies: [SSE](sse.ts.txt), [API regressions](sse-catchup.test.ts.txt), [route](routes-runs.ts.txt), [SQLite query](sqlite-events.ts.txt), [SQLite tests](lifecycle-tail.test.ts.txt), [SSE contract tests](sse.test.ts.txt). [Frozen tested-source hashes](source-frozen.json).

## 4. Tests

New/changed public-interface tests cover at/past terminal cursors at 3,000 and 6,000 events, post-terminal audit catch-up, missing/resumed marker grace, deep delivery bookkeeping, started/resumed invalidation followed by a newer outcome, run isolation, and corrupt current markers. No new timing assertion or private production access. The existing pre-header corruption test now corrupts `run.finished`, the marker actually read by bounded confirmation; an empty cursor no longer validates unrelated earlier history. Full replay still validates its requested pages normally.

| Package        | Full invocation counts                    |              Lines |           Branches |
| -------------- | ----------------------------------------- | -----------------: | -----------------: |
| api            | 2 failed ; 1339 passed ; 8 skipped (1349) | 97.92% (1936/1977) | 92.89% (1359/1463) |
| api-client     | 1 failed ; 79 passed (80)                 |     100% (261/261) |    98.3% (174/177) |
| infrastructure | 11 failed ; 766 passed (777)              | 98.69% (2199/2228) |  95.1% (1786/1878) |

| Untouched file rerun alone once         | Counts                    | Result |
| --------------------------------------- | ------------------------- | ------ |
| `src/subloop-restart.test.ts`           | 3 passed (3)              | PASS   |
| `src/templates/catalog-package.test.ts` | 4 passed (4)              | PASS   |
| `src/templates.test.ts`                 | 2 passed (2)              | PASS   |
| `src/adversarial.test.ts`               | 1 failed ; 19 passed (20) | FAIL   |
| `src/sqlite/upgrade.test.ts`            | 8 failed ; 18 passed (26) | FAIL   |
| `src/claude/process.test.ts`            | 3 failed ; 2 passed (5)   | FAIL   |
| `src/claude/readiness.test.ts`          | 1 failed ; 20 passed (21) | FAIL   |
| `src/process/scripts.test.ts`           | 3 failed ; 36 passed (39) | FAIL   |

Original and isolated outcomes are both kept; an isolated pass never relabels a failed full invocation. No thresholds, exclusions, assertions or test timeouts were relaxed. Initial SQLite fixture failure is retained in [focused-infrastructure.log.txt](focused-infrastructure.log.txt): `HARNESS_FAILED` was not a valid failure-code enum; corrected to `HARNESS_TURN_FAILED` before final focused/full gates.

## 5. Gates

Node 22 first on PATH, PowerShell `pnpm.cmd`. Baseline `pnpm.cmd build` passed: [log](before-build.log.txt). Coverage adds `--coverage.reportOnFailure=true` to preserve truthful denominators on failures. Infrastructure coverage is additional to the brief because its query changed.

| Command                                                                                                                        | Result       | Capture                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------- |
| `pnpm.cmd typecheck`                                                                                                           | PASS         | [log](typecheck.log.txt)                                         |
| `pnpm.cmd lint`                                                                                                                | PASS         | [log](lint.log.txt)                                              |
| `pnpm.cmd format --ignore-path .gitignore --ignore-path .prettierignore --ignore-path .r3-prettierignore`                      | PASS         | [log](format.log.txt)                                            |
| `pnpm.cmd format:check --ignore-path .gitignore --ignore-path .prettierignore --ignore-path .r3-prettierignore`                | PASS         | [log](format-check.log.txt)                                      |
| `pnpm.cmd check:layers`                                                                                                        | PASS         | [log](layers.log.txt)                                            |
| `pnpm.cmd check:deps`                                                                                                          | PASS         | [log](deps.log.txt)                                              |
| `pnpm.cmd check:docs`                                                                                                          | PASS         | [log](docs.log.txt)                                              |
| `pnpm.cmd build`                                                                                                               | PASS         | [log](pretest-build.log.txt)                                     |
| `pnpm.cmd --filter @graphgoblin/api test:coverage --coverage.reportOnFailure=true`                                             | **FAIL (1)** | [log](coverage-api.log.txt)                                      |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/subloop-restart.test.ts --maxWorkers=1 --reporter=verbose`             | PASS         | [log](alone-api-src-subloop-restart.test.ts.log.txt)             |
| `pnpm.cmd --filter @graphgoblin/api exec vitest run src/templates/catalog-package.test.ts --maxWorkers=1 --reporter=verbose`   | PASS         | [log](alone-api-src-templates-catalog-package.test.ts.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/api-client test:coverage --coverage.reportOnFailure=true`                                      | **FAIL (1)** | [log](coverage-api-client.log.txt)                               |
| `pnpm.cmd --filter @graphgoblin/api-client exec vitest run src/templates.test.ts --maxWorkers=1 --reporter=verbose`            | PASS         | [log](alone-api-client-src-templates.test.ts.log.txt)            |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --coverage.reportOnFailure=true`                                  | **FAIL (1)** | [log](coverage-infrastructure.log.txt)                           |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/adversarial.test.ts --maxWorkers=1 --reporter=verbose`      | **FAIL (1)** | [log](alone-infrastructure-src-adversarial.test.ts.log.txt)      |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/sqlite/upgrade.test.ts --maxWorkers=1 --reporter=verbose`   | **FAIL (1)** | [log](alone-infrastructure-src-sqlite-upgrade.test.ts.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/process.test.ts --maxWorkers=1 --reporter=verbose`   | **FAIL (1)** | [log](alone-infrastructure-src-claude-process.test.ts.log.txt)   |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/claude/readiness.test.ts --maxWorkers=1 --reporter=verbose` | **FAIL (1)** | [log](alone-infrastructure-src-claude-readiness.test.ts.log.txt) |
| `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/process/scripts.test.ts --maxWorkers=1 --reporter=verbose`  | **FAIL (1)** | [log](alone-infrastructure-src-process-scripts.test.ts.log.txt)  |
| `pnpm.cmd build`                                                                                                               | PASS         | [log](build.log.txt)                                             |
| `node --experimental-import-meta-resolve .tmp/gg-wp-e1-186-r3-terminal-probe.mjs after`                                        | PASS         | [log](terminal-after.log.txt)                                    |

The accepted formatting commands explicitly load .gitignore and .prettierignore plus a root-scoped temporary QA exclusion. The first attempt placed the extra ignore below the root and was invalid; its incidental tracked-file edits were restored from HEAD before the accepted run. See [restoration](format-restoration.json), [initial gate record](gates-attempt-1.json) and [initial formatter log](format-invalid-ignore.log.txt). The additional pre-test build refreshes generated outputs before package tests; the requested final build still runs. [Exact ignore copy](format-ignore.txt), [gate runner](run-gates.mjs.txt). No tracked formatting configuration changes. New text captures use UTF-8/LF; [copy provenance](source-copy-provenance.json) records original and retained code-copy hashes. Execution helpers under `.tmp/` are not kept as executables; code/log copies here are the retained artifacts. Final evidence Markdown formatting/checks are captured separately after the report is assembled. No web change: web coverage/browser gates are not required this round. No dependency change: license gate not required. No contract/OpenAPI shape change: generated references unchanged; the requested docs gate still runs.

## 6. Docs

Docs 07 describes bounded terminal confirmation and preserved grace. Docs 10 links this targeted measurement. ADR-0050 records why the terminal event is not always the final row, resume invalidation, and the fixed indexed query. The existing top Unreleased #186 bullet is extended, ending in `(#186)`; no new migration or dependency. The implementation README indexes all rounds and includes a round-3 subsection. Independent QA Git-canonical content matches HEAD; raw working-copy bytes are preserved throughout the accepted run.

## 7. Decisions and parameters

The engine's `terminalEvent` scans backward until the newest of `run.finished`, `run.failed`, `run.cancelled`, `run.started`, or `run.resumed`. Terminal append precedes status writes; `completeFromLog` uses the same rule for lost-status recovery. Finalization appends return-delivery audit events afterward, so neither the final row nor a fixed number of trailing events suffices. Source reasoning: [engine helper](../../../../packages/engine/src/run-manager.ts#L239), resume path around 762, lost-write completion around 1832, and finalization around 1938 (engine source unchanged).

The new query selects the maximum seq across those five fixed types using existing `run_events_delivery_idx (run_id, type, seq)`, then reads/validates exactly that row through the primary key. One statement supplies a coherent snapshot. Only a terminal-type marker with seq at/before the written cursor confirms completion; a reset marker invalidates older failures. Bounded work is five indexed seeks plus at most one intrinsic event payload, independent of history/audit length. [SQL-shape EXPLAIN and bytecode](query-plan.json), [diagnostic source](query-plan.mjs.txt), [diagnostic log](query-plan.log.txt): five covering-index searches, no full scan. This diagnostic is not a timing benchmark.

No new numeric transport policy: 128-event pages, existing buffer/writable bounds, 5-second drain timeout and 2-second forced-close/grace remain unchanged. Five is the count of existing lifecycle marker types, not a tuning parameter or owner-approved value.

## 8. Caveats and open items

Native process-control qualification remains unavailable for the failing infrastructure cases under **D-015**: `src/adversarial.test.ts` (real child/grandchild abort), `src/process/scripts.test.ts` (cancellation, timeout and signal abort), `src/claude/process.test.ts` (deadline/overflow, cancellation and descendant termination), and `src/claude/readiness.test.ts` (hung executable termination). All four files still fail in their single isolated rerun. Exact assertion: `native process-tree cancellation must finish before fixture cleanup: expected true to be false`. Claude readiness expected `Claude CLI did not answer before the check deadline` but received `Claude CLI check process did not confirm that it stopped`; native cleanup also reports `EBUSY`. The worker's direct attempt to terminate only its own formatter tree returned `ERROR: Access denied`: [D-015 capture](format-stop.log.txt). No elevation or alternative process-control workaround was attempted. The fixture cleanup failures and disposable processes/stores require the orchestrator's environment; no manual directory cleanup was performed.

Full API has 2 failures (1,339 passed, 8 skipped); both untouched files pass alone: subloop restart 3/3 and catalog packaging 4/4. Full client has 1 timeout (79 passed); its untouched template file passes alone 2/2. Full infrastructure has 11 failures (766 passed) across five untouched files. In addition to native failures, `src/sqlite/upgrade.test.ts` has 3 timeout failures in the full invocation and 8 in its isolated invocation (18 passed). Its cause is unconfirmed and is **not attributed to D-015**. No protected upgrade/reset implementation was changed. Every full invocation remains failed even where its isolated rerun passes; no further retry was performed. Clean CI/native gate acceptance belongs to the orchestrator.

**Formatter setup incident, repaired:** the initial temporary ignore was under `.tmp`, so its patterns resolved below the root and replaced the default ignore files. That invalid formatter attempt failed with exit 2 before coverage started. After it ended, 190 incidental tracked-file edits, including 19 independent-QA JSON artifacts, were restored from HEAD using read-only Git blobs; the six candidate source hashes stayed unchanged. The accepted run explicitly loads `.gitignore`, `.prettierignore` and a root-scoped QA exclusion. [Restoration](format-restoration.json), [invalid attempt](gates-attempt-1.json), [old formatter log](format-invalid-ignore.log.txt), [accepted-scope check](ignore-correct.log.txt), [post-format hashes](post-format-integrity.log.txt). All 19 restored QA artifacts match the original manifest. All 87 original entries match after Git's LF normalization; 26 untouched working-copy logs retain CRLF. New evidence text uses LF, with source/retained hashes recorded in [copy provenance](source-copy-provenance.json).

Historical QA decorators target their recorded revision. A new disposable decorator used with the current API composition root must forward `lastLifecycleEvent`, as the current [D1 probe](terminal-probe.mjs.txt) does; the independent QA scripts are preserved as historical records.

Git status still lists restored QA/browser-evidence files as modified from stale stat information in the read-only index. They are byte-identical to HEAD and absent from the content diff; [status/hash comparison](git-status-disposition.json) records every path. No staging or index refresh was performed. The orchestrator can refresh that stat information when it stages the reviewed change.

History browsing, per-run browser history bounds and Timeline windowing remain later #186 work. Full #186/intent completion is not claimed. The orchestrator commits and runs the final audit on the resulting exact head; no independent audit sign-off or CI verification is supplied here. Large raw stores/captures are not proposed for commit; [NOT-KEPT.md](NOT-KEPT.md) records original bytes and SHA-256. Temp/build/coverage cleanup belongs to the orchestrator; no manual directory cleanup was performed.
