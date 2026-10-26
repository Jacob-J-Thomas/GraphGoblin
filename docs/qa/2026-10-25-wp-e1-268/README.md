# WP-E1 / #268: measured hot paths

## 1. Branch and worktree

Branch `codex-wp-e1-268`, worktree `%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-wp-e1-268`, base `4585ff5702d91e141645d34dffdc5d71b1524524`.
Uncommitted; ready for orchestrator commit. The native infrastructure gate still requires an unrestricted rerun. Implementation evidence is separate from orchestrator review, independent QA, Astra audit and owner acceptance.

## 2. Per bolt

Only #268's finite ranked list is admitted. Workload commands use Node 22.14.0, Inspector profiling, file-backed disposable stores prefixed `gg-wp-e1-268-`, and ports 5810–5812. No provider calls. The host is a shared Ryzen 5 3600 / 12 logical CPUs / 64 GiB Windows workstation. Agent measurements run serially without overlapping agent tests/builds; external activity remains uncontrolled. These observations establish workload-specific causes and effects, not an SLA or capacity guarantee.

### Rank 1: finalisation

Confirmed on the current base. One unlimited read materialises and validates all history synchronously. The bounded change calls a new helper from `finalizeTerminalLocked`: 256-event pages, with an event-loop yield between full pages. It preserves every event and collects the complete history before interpreting terminal/return evidence. Memory remains proportional to history; this is the admitted paging alternative, not a streaming reducer or a byte bound.

| Passes | Before maximum read ms | Before loop maximum ms | After maximum read ms | After loop maximum ms |
| ------ | ---------------------: | ---------------------: | --------------------: | --------------------: |
| 100    |                 45.583 |              1,173.357 |                 8.333 |                24.035 |
| 1,000  |                714.875 |                731.906 |                17.848 |                52.265 |
| 10,000 |              3,440.123 |              3,443.524 |                30.730 |               200.933 |

The 100-pass maximum delay is not attributed to finalisation: it exceeds its read span. At 10,000 passes the before read and loop maximum coincide. The after build has only rank 1 changed: 5 / 44 / 430 finalisation reads, totaling 33.084 / 381.961 / 4,167.498 ms. Total reading is still history-sized; the 10,000-pass single-read maximum falls by 99.1%, and whole-run maximum delay by 94.2%. Whole-invocation host busy fractions were 74.1% before and 59.0% after, so wall/CPU differences are not treated as quiet-host paired throughput estimates. The count-bounded reads plus per-read spans identify the corrected stall.

`rank1-equivalence-v2.json` matches normalized event and state hashes at 100 / 1,000 / 10,000 passes (1,108 / 11,008 / 110,008 events). Full replay matches each checkpoint on both sides. The first comparison (`rank1-equivalence.json`) exposed unnormalised node-output `at` timestamps in otherwise identical patches. Adding that documented clock observation to the comparator resolves the difference without changing application values or rerunning the workload.

### Rank 2: metadata projections

**Not reproduced; left unchanged.** Current `SqliteRunRepository` gets, updates, transitions, cancellation returns and list reads use `rawRunColumns` from `run-decoding.ts`. That projection contains metadata only, excluding `initial_thread`, `thread_snapshot`, snapshot sequence and replay-state JSON. Required thread/checkpoint reads and stored snapshots remain intact. Metadata still has measurable SQL/schema-validation cost; that alone does not establish this ranked cause.

| Context passes | Before metadata get/update/transition ms | Before CPU ms | Before snapshot writes ms | After metadata ms | After CPU ms |
| -------------- | ---------------------------------------: | ------------: | ------------------------: | ----------------: | -----------: |
| 100            |                                1,484.005 |         2,889 |                   251.415 |         1,987.698 |        3,280 |
| 1,000          |                               13,196.596 |        21,468 |                 2,858.926 |        28,425.411 |       25,140 |
| 10,000         |                              163,713.979 |       381,515 |               158,367.898 |       176,839.991 |      387,250 |

The final 10,000-pass snapshot is 1,311,484 bytes on both sides. Snapshot writes remain required (after: 167,854.163 ms total). The after context observation is a control with the other admitted changes, not a metadata optimization or a claimed rank-2 speedup. `context-equivalence.json` matches events and state at every size, including 50,010 events at 10,000 passes; both checkpoints match full replay.

Host busy fraction changed from 61.6% to 75.9%. The after 1,000-pass case has an unattributed 11,406.132 ms `runs.update` span and an 11,425.284 ms loop maximum; its maximum finalisation read is only 10.502 ms. This is not evidence that unused thread JSON is being decoded: the projection excludes it. No speculative fix to that separate update stall is made.

### Rank 3: fresh-entry counting

Confirmed: the baseline 10,000-pass case has 12,802 V8 samples in `countEntries`. The bounded design rebuilds per-node attempt-1 counts from the already-loaded persisted history once per executor, then records only successfully returned committed starts. It does not use display counters (which include wake/retry attempts and inherited fork counters), cache across executor lifetimes, or change `attemptFor`.

Rank 3's before is the rank-1-only build, so finalisation and visit-count changes are measured independently.

| Long passes | Before CPU ms (rank 1 only) | After CPU ms | Before wall ms | After wall ms |
| ----------- | --------------------------: | -----------: | -------------: | ------------: |
| 100         |                       3,094 |        5,359 |      3,833.969 |    16,151.168 |
| 1,000       |                      31,906 |       35,265 |     42,272.454 |    49,575.408 |
| 10,000      |                     406,078 |      415,016 |    517,701.054 |   526,857.214 |

**No file-backed end-to-end CPU speedup is established.** Host busy fraction changed from 59.0% to 77.2%; the measured totals and curves above remain reported without relabelling the regression as a gain. The changed responsibility is fresh-entry counting, so a finite interleaved public-engine control separates it from SQLite/serialization. It runs the same long-loop definition, real handlers and streamed items with public fake ports, Inspector profiling and GC before each case. It is component evidence, not file-backed API throughput or native recovery evidence.

Order: before-1, after-1, after-2, before-2. Each is a fresh Node process. Only built `run-manager.js` is exchanged between the retained rank-1-only and final snapshots; `finally` restores the final file. Both source snapshots and `guard-control.mjs.txt` are retained, and `runtime-restored.json` verifies the final runtime hash. No source or Git/index mutation occurs in this control.

| Passes | Trial 1 before CPU ms | Trial 1 after CPU ms | Trial 2 before CPU ms | Trial 2 after CPU ms |
| ------ | --------------------: | -------------------: | --------------------: | -------------------: |
| 100    |                   219 |                  282 |                   360 |                  376 |
| 1,000  |                 2,156 |                2,515 |                 2,000 |                2,343 |
| 10,000 |               117,500 |               85,297 |               101,984 |               87,422 |

At 10,000 passes, component CPU falls 27.4% / 14.3%, wall time 148,351.649 → 109,421.752 ms / 130,110.037 → 113,016.670 ms. Old scanner samples are 6,713 / 5,659; new count/record samples are 14 / 3. Samples are attribution, not milliseconds. Host busy fractions are before/after 62.1% / 64.4% and 40.4% / 65.5%; these remain shared-host observations. Small cases do not establish a CPU benefit. `guard-equivalence.json` matches all six event/state pairs; each has exact starts, counters and gate passes.

The file-backed pass curve is retained honestly as well (checkpoint after each work snapshot, before its following gate):

| Work pass | Rank-1-only elapsed ms | Final elapsed ms |
| --------- | ---------------------: | ---------------: |
| 1,000     |             41,802.933 |       45,963.934 |
| 2,000     |             83,806.924 |       93,083.915 |
| 3,000     |            127,887.137 |      142,503.843 |
| 4,000     |            172,574.709 |      193,430.776 |
| 5,000     |            219,365.036 |      247,569.177 |
| 6,000     |            270,033.137 |      302,851.838 |
| 7,000     |            319,416.942 |      356,316.189 |
| 8,000     |            378,327.226 |      408,562.745 |
| 9,000     |            435,255.041 |      462,665.804 |
| 10,000    |            512,536.312 |      522,155.045 |

`rank3-equivalence.json` and `cumulative-equivalence.json` match event/state hashes at every API size, with full replay matching every checkpoint. The five visit controls pass on both baseline and final implementations; they are equivalence controls, not claimed red-before behavioral regressions. The measured scanner cost and interleaved component improvement establish this bounded change's performance benefit.

### Rank 4: append measurement only

The additive `append` workload uses ten inference passes, 100 items/turn, 256 bytes/item. The burst has no item delay; the paced stream has a 10 ms delay before each item. A separately constructed SQLite event repository receives an observed client through `databaseView`; neither the repository under measurement nor its client is patched. Transaction begin, sequence lookup, insert, run sequence update and commit are timed separately. No append implementation changes.

Both workloads retain all 1,100 events and exactly two return-delivery audits. The current live stream closes at sequence 1,098; an explicit cursor reconnect fetches the two durable audits. The combined raw payload hash equals the stored log hash. Clearing the finalisation marker through the repository port, closing the container and reopening its file-backed store leaves raw event bytes, thread and run result unchanged and finalises without duplicate delivery. This is a controlled lost-marker/reopen fixture, not a native process-kill claim.

The first append observations intentionally fail their completeness check and are retained in `append-burst.log.txt` / `append-paced.log.txt`. The v2 commands explicitly recover the durable delivery tail and succeed. This is a measurement-protocol correction around the existing SSE issue owned by #185/#404, not a product fix or retry to green.

| Stream            | Append calls |    Wall ms | CPU ms | Append total / mean ms | Begin ms | Sequence lookup ms | Insert ms | Run sequence update ms | Commit ms | First live event ms |
| ----------------- | -----------: | ---------: | -----: | ---------------------: | -------: | -----------------: | --------: | ---------------------: | --------: | ------------------: |
| Burst             |        1,087 |  2,197.767 |  2,140 |      1,792.257 / 1.649 |  152.902 |            126.298 |   104.385 |                 91.940 |   895.311 |              22.715 |
| Paced, 10 ms/item |        1,087 | 13,731.699 |  3,125 |      2,427.130 / 2.233 |  233.066 |            189.271 |   136.787 |                109.227 | 1,103.888 |              19.466 |

Commit accounts for 50.0% / 45.5% of inclusive append time; sequence lookup is 7.0% / 7.8%. Timed SQL phases do not sum to the inclusive append span: draft validation, query construction, encoding and notifications are outside them. Begin includes the existing serialized-client wait/yield policy. Host busy fractions were 63.1% / 70.2%; pacing changes scheduling and commit conditions, so the different per-call means are observations, not a provider throughput prediction.

**Measured child-bolt candidate:** investigate bounded coalescing of adjacent progress drafts at the inference append boundary, preserving every payload, sequence, commit-before-publish rule, flush-before-terminal ordering, validation/failure behavior, cancellation and first-event responsiveness. The measured dominant transaction commit cost motivates that investigation. No batching, sequence-lookup, transaction or yield-policy change is implemented here.

After both engine changes, both append controls pass again. `append-burst-equivalence.json` and `append-paced-equivalence.json` match all 1,100 normalized events and the final state; exact live-plus-reconnect/store hashes and raw pre/post-reopen hashes pass independently within every run. The existing early live-stream close remains visible on both sides.

### #268 acceptance mapping

- Each selected corrective change has a reproduced cause, a separate before/after build and public behavior/equivalence evidence: rank 1's history-sized read and rank 3's fresh-entry scan. The helper responsibilities are only paged finalisation evidence and executor-local fresh counts. The API CPU limitation above is explicit.
- Only the finite #190 candidates are addressed. Rank 2 is not reproduced and unchanged; rank 4 is measurement-only. No general RunManager, persistence, yield-policy or coordinator rewrite.
- Verification includes before/after profiles, event-loop/read spans, CPU/pass curves, real file-backed API/SSE/reopen controls, normalized cross-run sequences/state and exact within-run hashes. The native infrastructure gate remains unresolved and is not waived by these controls.

## 3. Files changed

Production changes are confined to the target functions in `run-manager.ts` and two new helpers. The shared file is adjacent to PR #401's resume work: final line ranges are 80–81 (imports), 1941 (rebuild counts), 1950 (record committed starts), 2100 (guard lookup), and 2457 (paged finalisation call). The functions around those additions are otherwise unchanged. PR #404's API/SSE/read-model files and PR #405's SQLite event/history files are untouched. No changes to `sqlite/runs.ts`, `sqlite/events.ts`, routes, schemas, migrations or dependencies.

Engine: `finalization-history.ts`, `fresh-entries.ts`, `hot-paths.test.ts`, and the five ranges above. Tooling: additive observations/controls in `measure.mjs`, `worker.mjs`, `common.mjs`, the new append observer, equivalence comparator and their tests, plus its README. Docs: 05, 10, CHANGELOG and this evidence folder. `touched-ranges.json` contains every tracked hunk and complete added-source ranges.

## 4. Tests

`hot-paths.test.ts` exercises RunManager's constructor and public lifecycle methods with injected port implementations. It covers bounded/yielding finalisation, complete return evidence, pending finalisation after a failed page, idempotent recovery, exact finite caps, wake attempts, paused resume, restart, Unlimited mode, and fresh-start append failures before/after commit. No private access or patched component under test.

The corrected baseline run is five controls passing and the paging regression failing: `AssertionError: expected 1 to be greater than 2`. The first test attempt additionally had five invalid one-route fixtures; adding the required second route corrected those fixtures before the baseline was rerun. Rank-1 controls then pass 6/6. The final seven-test file was also run against actual baseline source, temporarily restored from `git show HEAD:packages/engine/src/run-manager.ts`, then the rank-1 source restored byte for byte in `finally`, with no Git/index mutation. Both paging regressions fail and five equivalence controls pass: the failed-page control sees deliveries on the unlimited baseline (`expected [ { ... }, { ... } ] to deeply equal []`). On the rank-1 source all seven pass. Logs: `baseline-controls-final.log.txt` and `rank1-controls-final.log.txt`.

Tooling observer tests check clock/identity-normalised equivalence without hiding payload order and verify transparent SQL timing through an injected client. Final tooling: 87 tests pass; this command has no percentage coverage report and its script/thresholds are unchanged.

Final engine coverage: 1,687 tests / 53 files pass; lines 97.65%, branches 91.79%. API coverage: 1,440 pass, 11 skipped / 80 files pass, two skipped; lines 97.26%, branches 92.45%. Infrastructure: 798 pass, six fail; coverage percentages are not emitted for the failed suite. No threshold or exclusion changed.

## 5. Gates

All commands run from the worktree with Node 22.14.0 first on PATH. Logs are named below; final measurement records retain complete command argument arrays.

| Exact command                                                                | Result                                                                                                 | Log                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `pnpm.cmd typecheck`                                                         | Pass, 20/20 tasks; initial test-narrowing errors corrected without casts                               | `typecheck-final.log.txt`         |
| `pnpm.cmd lint`                                                              | Pass, 11/11; existing ThreadViewer warning and Turbo cache-access warnings                             | `lint.log.txt`                    |
| `pnpm.cmd format:check`                                                      | Pass before final build; first report-format failure corrected; final report check recorded separately | `format-check-final.log.txt`      |
| `pnpm.cmd check:layers`                                                      | Pass                                                                                                   | `layers.log.txt`                  |
| `pnpm.cmd check:deps`                                                        | Pass, existing `drizzle.config.ts` orphan warning                                                      | `deps.log.txt`                    |
| `pnpm.cmd check:docs`                                                        | Pass; generated references unchanged                                                                   | `docs.log.txt`                    |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                        | Pass, 1,687 tests; 97.65% lines / 91.79% branches                                                      | `engine-coverage.log.txt`         |
| `pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --maxWorkers=1` | Fail, six native process termination/cleanup tests; 798 pass; no coverage percentages emitted          | `infrastructure-coverage.log.txt` |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                           | Pass, 1,440 tests, 11 skipped; 97.26% lines / 92.45% branches                                          | `api-coverage.log.txt`            |
| `pnpm.cmd --filter @graphgoblin/tooling test:coverage`                       | Pass, 87 tests; no percentage report in this package's command                                         | `tooling-coverage.log.txt`        |
| `pnpm.cmd build`                                                             | Pass, 11/11 tasks                                                                                      | `build-final.log.txt`             |

Direct ESLint over all changed tooling JavaScript also passes (`tooling-lint.log.txt`). The only isolated native re-run was `pnpm.cmd --filter @graphgoblin/infrastructure exec vitest run src/adversarial.test.ts -t '6/QA-LIMIT-001'`: it fails again with `EBUSY` removing its still-held disposable process directory (`native-control-isolated.log.txt`). There is no whole-suite retry or unrelated test change.

The six infrastructure failures are ProcessScripts' child/grandchild abort; incomplete-UTF-8 cancellation; Claude process deadline/overflow; running-process cancellation; descendant termination; and no-turn hanging-CLI readiness (unconfirmed stop rather than the expected confirmed deadline). These are consistent with COMMON.md's D-015 native process-control restriction; their underlying failures and cleanup errors remain real unresolved gate failures, not passes. They require an unrestricted orchestrator rerun.

## 6. Docs

Docs 05 describes the paged finalizer and executor-local fresh counts. Docs 10 records measured results and their limits. The first Unreleased CHANGELOG bullet ends `(#268)`. This report and retained portable summaries/detailed metrics/equivalence records live here; original captures above 1,000,000 bytes are listed with size and SHA-256 in `NOT-KEPT.md`. No decision, contract, schema or route change requires an ADR or generated-reference change.

## 7. Decisions and parameters

- 256 events per finalisation page is an engineering quantum chosen to shorten the observed synchronous validation span. Arbitrarily large individual events can still be expensive. Complete history remains resident.
- Visit counts are scoped to one executor and rebuilt from durable starts, so a failed or ambiguously committed append is reconciled on the next resume/recovery. Only attempt 1 contributes to the guard; display counters remain unchanged.
- Ten passes × 100 items isolates 1,000 progress appends without an endurance run. The 10 ms item pacing is a measurement condition, not a provider claim or a batching policy.
- Cross-run equivalence sorts keys, consistently renames generated ULIDs, and excludes observed timestamps/durations/elapsed seconds, including node-output `at`. Payloads, order, attempts, sequences, counters and results remain compared. These controlled fixtures contain no application data under the excluded clock keys; the comparator is not a universal arbitrary-payload equivalence validator. Raw SSE/store hashes compare exact bytes within a run. The read-only comparison replays events and also checks the stored checkpoint against full replay.

## 8. Caveats and open items

- Other unlimited reads in resume, cancel, recovery and executor startup remain out of scope. Recovery's initial unlimited read is still present before the newly paged finalizer. No claim that startup/recovery as a whole is paged.
- The append probe observes the pre-existing live-stream finalisation gap at `apps/api/src/sse.ts` (owned by #185/#404); it is reported without changing it.
- No owner store, main checkout, ports 4747/4748, Git index, commit, push, PR or GitHub records were changed. Disposable stores remain for the orchestrator; no directories are deleted.
- Review, independent QA and exact-head Astra audit remain orchestrator work under D-037. No merge or owner-acceptance claim.
- The file-backed CPU totals and the isolated 11.4-second metadata update stall do not establish an overall CPU/latency guarantee. Rank 3's benefit is established by the interleaved component control; other engine/persistence work remains outside this finite change.
- Infrastructure native fixture cleanup may leave processes/directories behind. An attempted read-only WMI process inventory returned `Access denied` (`0x80041003`), so a global zero-leftover claim cannot be made. No unidentified process was terminated and no cleanup directory was deleted. The measurement worker itself is closed and awaited by each invocation; these are separate claims.
