# WP-G1 #116: implementation evidence

The round-2 record below is historical. The round-3 subsection supersedes its event-type boundary proof and no-migration decision; earlier logs and measurements retain their original provenance.

## 1. Branch and worktree

- Starting HEAD: `7f88a0665492a28c697ce7ce0773942d7f63aa85`; branch `codex-wp-g1-116`.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-g1-116`.
- Round-2 changes are uncommitted. No index changes, commits, pushes, merges, rebases, stashes, branch switches, sub-agents, owner-instance access or provider turns.
- Review/QA and the orchestrator's commit remain separate. Final local gate disposition is below; no acceptance sign-off is claimed here.

## 2. Per bolt

The three requested #116 review changes are implemented. Validation is complete below. The full web unit gate failed one untouched legacy-editor assertion; its isolated rerun passed. All other requested gates and all three browser runs passed.

### Round 3: persist the checkpoint replay proof (2026-10-24)

**Head and scope.** Started at `b8536e38d16ffeb3264bd89f8d380fd13582eb06` on codex-wp-g1-116. Work stays uncommitted in the assigned worktree; the orchestrator owns commits, QA and audit round 2. No sub-agents or directory deletions. The independent QA folder is unchanged. Read the auditor's report, both drivers and both durable-history captures before production edits: [report capture](round-3-audit-report.txt), [duplicate driver](round-3-audit-duplicate-browser-corrected.mjs.txt), [recovery driver](round-3-audit-supplement.mjs.txt), [duplicate REST/MCP/browser evidence](round-3-audit-duplicate-browser-corrected.json), [recovery evidence](round-3-audit-recovery-duplicate.json). These are attributed historical audit evidence, with local profile paths redacted.

**Persisted-state design.** RunRepository.saveThread now requires (runId, thread, seq, replayState), where domain ReplayState has required strict:boolean and optional openNodeId. SQL migration 0018_thread_checkpoint_replay_state adds nullable runs.thread_snapshot_replay_state; its Drizzle schema, snapshot and journal entry are additive. One UPDATE saves the snapshot, sequence and replay state. Existing snapshots retain NULL. getThreadCheckpoint returns the recorded state when present. getThread reads only after checkpoint.seq-1 if state is present, verifies the first returned event is the checkpoint's sequence, and supplies that stored state to reconcileThread. Missing state/sequence/event falls back to full history; reads do not backfill. loadThread still receives the full log. Boundary event types never supply proof.

| Writer                                                              | Recorded replay state                     | Basis                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Executor park, after its node.started and run.waiting               | strict:true, openNodeId: current node     | That execution visit remains unfinished                                         |
| Executor exit, after its matching node.finished and terminal append | strict:true, no open node                 | The executor completed its own visit                                            |
| Executor done/decision, after its matching node.finished            | strict:true, no open node                 | The executor completed its own visit                                            |
| Recovery completeFromLog                                            | replayStateAt(events,lastSeq)             | Full durable history preserves a different open visit across delayed duplicates |
| Measurement/controlled checkpoint fixtures                          | replayStateAt of the full recorded prefix | Honest explicit checkpoint proof through the public port                        |

The in-memory fake and the delayed SQLite snapshot adapter both carry the state. Snapshot clearing clears it too. All port decorators forward it. The adversarial snapshot test compares each executor writer's state with replayStateAt. No compatibility parsing or event-type inference is introduced. Migration 0018 may need renumbering if WP-D4/#389 lands its migration first.

**Reproduction and regressions.** The baseline component is an immutable capture of d9abfac7:packages/engine/src/run-manager.ts (SHA-256 9995f2fd72d5176287f21d8a66fe772d224dd8798774a7bffebd65e8b93184b7), loaded by Vitest resolution instead of altering code under test. Its [source capture](round-3-d9abfac7-run-manager.ts.txt), [engine configuration](round-3-engine-baseline.config.ts.txt), [REST configuration](round-3-api-baseline.config.ts.txt), [MCP configuration](round-3-mcp-baseline.config.ts.txt) and baseline test captures are retained. The six-event and recovery cases use supported run/event repository ports and public RunManager methods; REST/MCP use real persisted SQLite and the SDK linked transport to HTTP. The additional NULL-state probe combines the same immutable d9abfac7 reader with the new shipped-migration fixture; it is a reader regression, not a claim that d9abfac7 shipped the new column.

| Reader / case                                                                                    | At checkpoint                  | After later durable completion, d9abfac7 reader | After correction                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| RunManager, queued -> started A -> finished A -> started B -> duplicate finished A -> finished B | items:[a], B open, seq 5       | items:[a], fails expected [a,b]                 | items:[a,b], full replay agrees                                                                          |
| REST, same six persisted events                                                                  | items:[a], B open, seq 5       | items:[a], fails expected [a,b]                 | items:[a,b], complete thread equals full replay; row/event bytes unchanged                               |
| MCP, same six persisted events                                                                   | items:[a], B open, seq 5       | items:[a], fails expected [a,b]                 | items:[a,b], complete thread equals full replay; row/event bytes unchanged                               |
| Actual recovery-written checkpoint after durable failure and delayed earlier-node completion     | items:[a], failed B still open | items:[a], fails expected [a,b]                 | items:[a,b]; recovery persisted strict:true/openNodeId:b                                                 |
| Stored snapshot without replay state after shipped SQL migration                                 | NULL state, duplicate boundary | items:[a], fails expected [a,b]                 | Full-history read; items:[a,b], no read-side write; next checkpoint carries persisted state after reopen |
| Current / lagging proven checkpoints                                                             | Honest persisted state         | Existing ordinary bounded cases already passed  | Counting tests require exactly boundary plus tail, never the prefix                                      |

[Engine baseline failures](round-3-engine-before.log.txt), [REST baseline failure](round-3-api-baseline-corrected.log.txt), [MCP baseline failure](round-3-mcp-baseline-corrected.log.txt), [NULL-state baseline failure](round-3-unproven-baseline.log.txt). Each behavioral failure is expected [a,b], received [a]. The initial REST/MCP attempts timed out in fixture cleanup because their intentionally stopped manager retained a queued run; cleanup was corrected through public cancel after assertions, with both original logs retained. No production change preceded the corrected duplicate reproductions.

Focused corrected runs: engine 9/9, shipped migration/storage 1/1 and REST 4/4 passed. MCP's new duplicate regression passed; its existing lifecycle case exceeded its unchanged five-second timeout in that focused run (1 passed/1 failed). [Engine](round-3-engine-focused.log.txt), [migration/storage](round-3-infrastructure-focused.log.txt), [REST](round-3-api-focused.log.txt), [MCP](round-3-mcp-focused.log.txt). The first typecheck caught the new snapshot column missing from RunRecordRow's internal-field omission; that type was corrected. A diff review also caught and corrected locale-decoding corruption before gates.

**Measurements, browser and required gates.** The fresh physical SQLite/loopback HTTP experiment used 10,008 events, a current snapshot and a snapshot 200 events behind, one warm-up then five samples per case. Every complete returned thread matched full replay. Current: one decoded row/read, median 11.357 ms (range 5.206-86.185); lagging: 201 rows/read, median 11.291 ms (range 9.350-26.730). The existing round-2 numbers below remain historical. Load varied; no timing improvement is attributed to the state correction. [New samples](round-3-measure.json), [command log](round-3-measure.log.txt).

Built-code persisted probes also exercised the actual executor failure/recovery writer on physical SQLite, then REST and MCP after a later durable completion. Both full threads match canonical replay, including the other open visit and its later patch; stored run/event bytes hash identically before and after reads. [Driver](round-3-reproduce.mjs.txt), [complete observations and hashes](round-3-reproductions.json), [log](round-3-reproduce.log.txt). These use controlled script behavior and in-process recovery, without native process replacement or provider claims.

N1 uses port 0 and the returned address. N3 registers requestfailed for the inspected run before taking the browser offline and awaits the actual failed request before restoring connectivity. The default-harness built-app browser command passed once, with retries disabled: [log](round-3-browser.log.txt), [observations](round-3-browser.json), [spec capture](round-3-browser.spec.ts.txt). The recorded outage is net::ERR_INTERNET_DISCONNECTED on the inspected run's metadata request. Failure, resumed-unfinished and success agree across REST, the open tab and the reloaded tab; work visits are 1/2/2, the unfinished patch is absent, and persisted run/event bytes remain unchanged. Runtime: Node 22.14.0; browser test 28.1 seconds, command about 64.8 seconds. No fixed browser port or private harness.

**Required commands and results.** Root checks ran with Node 22 first on PATH. Typecheck/lint were repeated after the historical migration fixtures were corrected; their final runs and the build all passed. Lint retains the existing ThreadViewer.tsx:106 warning; Turbo emitted nonfatal cache I/O access warnings. Formatting, layer/dependency checks and generated-doc checks passed. No thresholds, exclusions, existing timeout budgets or runtime test assertions were relaxed.

| Command                                                                                        | Result                                                     | Evidence                                                                                       |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| pnpm.cmd typecheck                                                                             | PASS, including final run                                  | [initial corrected run](round-3-typecheck.log.txt), [final](round-3-final-typecheck.log.txt)   |
| pnpm.cmd lint                                                                                  | PASS, existing warning                                     | [final](round-3-final-lint.log.txt)                                                            |
| pnpm.cmd format                                                                                | PASS; later changed documentation/fixtures also formatted  | [root](round-3-format.log.txt), [fixture formatting](round-3-migration-fixture-format.log.txt) |
| pnpm.cmd check:layers                                                                          | PASS                                                       | [log](round-3-check-layers.log.txt)                                                            |
| pnpm.cmd check:deps                                                                            | PASS                                                       | [log](round-3-check-deps.log.txt)                                                              |
| pnpm.cmd check:docs                                                                            | PASS                                                       | [log](round-3-check-docs.log.txt)                                                              |
| pnpm.cmd --filter @graphgoblin/domain test:coverage                                            | FAIL: untouched conversion timeout                         | [log](round-3-domain-coverage.log.txt)                                                         |
| pnpm.cmd --filter @graphgoblin/engine test:coverage                                            | FAIL: untouched child-wake wait assertion                  | [log](round-3-engine-coverage.log.txt)                                                         |
| pnpm.cmd --filter @graphgoblin/infrastructure test:coverage                                    | FAIL: historical fixture setup and native/timeout failures | [original log](round-3-infrastructure-coverage.log.txt)                                        |
| pnpm.cmd --filter @graphgoblin/api test:coverage                                               | FAIL: untouched subloop-restart cleanup hook               | [log](round-3-api-coverage.log.txt)                                                            |
| pnpm.cmd --filter @graphgoblin/mcp test:coverage                                               | PASS                                                       | [log](round-3-mcp-coverage.log.txt)                                                            |
| pnpm.cmd build                                                                                 | PASS                                                       | [log](round-3-final-build.log.txt)                                                             |
| pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/thread-history.spec.ts --retries=0 | PASS: 1/1, default configuration/harness                   | [log](round-3-browser.log.txt)                                                                 |

[Root command/exit record](round-3-root-results.json), [full package command/exit record](round-3-coverage-results.json), [final typecheck/lint/build/browser record](round-3-final-results.json). These are local command results, not a fresh PR CI observation.

| Package / run                            | Files                          | Tests                                          | Fresh lines               | Fresh branches            |
| ---------------------------------------- | ------------------------------ | ---------------------------------------------- | ------------------------- | ------------------------- |
| domain                                   | 30 passed, 1 failed            | 595 passed, 1 failed (596)                     | Not emitted after failure | Not emitted after failure |
| engine                                   | 41 passed, 1 failed            | 1597 passed, 1 failed (1598)                   | Not emitted after failure | Not emitted after failure |
| infrastructure, original                 | 43 passed, 9 failed            | 709 passed, 64 failed (773)                    | Not emitted after failure | Not emitted after failure |
| infrastructure, after fixture correction | 47 passed, 5 failed            | 762 passed, 11 failed (773)                    | 98.74% (2195/2223)        | 95.09% (1784/1876)        |
| api                                      | 64 passed, 1 failed, 2 skipped | 1324 passed, 1 failed, 8 existing skips (1333) | Not emitted after failure | Not emitted after failure |
| mcp                                      | 10 passed                      | 51 passed (51)                                 | 96.66% (232/240)          | 95.39% (207/217)          |

The second infrastructure run followed an actual fixture correction, not a retry to clear a flaky gate. Its exact command was pnpm.cmd --filter @graphgoblin/infrastructure test:coverage --coverage.reportOnFailure: [log](round-3-infrastructure-after-fixtures-coverage.log.txt), [command/reason record](round-3-extra-results.json), [coverage summary](round-3-infrastructure-after-fixtures-coverage-summary.json). The reporting-only flag emits truthful coverage even on test failure; it does not turn the suite green. MCP's [fresh coverage summary](round-3-mcp-coverage-summary.json) is also retained. Fresh measured coverage exceeds the thresholds in both reporting packages; domain, engine and API have no fresh coverage qualification from their failed runs. Historical percentages below are not substituted. [Derived test-result index](round-3-test-results.json).

Four historical SQLite fixtures rewound the migration ledger while leaving the new column installed, producing SQLITE_ERROR: duplicate column name: thread_snapshot_replay_state. Their setup now drops that structural addition before replaying the corresponding shipped migrations. Each corrected file passed its one isolated run, and all four pass in the final full infrastructure run. This changes test fixture reconstruction, not production migration tolerance or the protected offline-upgrade implementation.

Every initially untouched failing file was run alone exactly once with --maxWorkers=1. The isolated pass does not waive the original failed full gate; no second isolated attempt was made. [Isolated command/exit record](round-3-isolated-results.json), [API isolated command/exit record](round-3-extra-results.json).

| Package and isolated file                                  | Result                             | Evidence                                                                                  |
| ---------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| domain: src/convert-v3-v4/conversion.test.ts               | 102 passed                         | [log](round-3-isolated-domain-src-convert-v3-v4-conversion-test-ts.log.txt)               |
| engine: src/awaited-children.test.ts                       | 24 passed                          | [log](round-3-isolated-engine-src-awaited-children-test-ts.log.txt)                       |
| infrastructure: src/sqlite/catalog.test.ts                 | 7 passed after fixture correction  | [log](round-3-isolated-infrastructure-src-sqlite-catalog-test-ts.log.txt)                 |
| infrastructure: src/sqlite/delivery-runs.test.ts           | 31 passed after fixture correction | [log](round-3-isolated-infrastructure-src-sqlite-delivery-runs-test-ts.log.txt)           |
| infrastructure: src/sqlite/history-summaries.test.ts       | 16 passed after fixture correction | [log](round-3-isolated-infrastructure-src-sqlite-history-summaries-test-ts.log.txt)       |
| infrastructure: src/sqlite/webhook-receipt-upgrade.test.ts | 27 passed after fixture correction | [log](round-3-isolated-infrastructure-src-sqlite-webhook-receipt-upgrade-test-ts.log.txt) |
| infrastructure: src/adversarial.test.ts                    | 19 passed, 1 failed                | [log](round-3-isolated-infrastructure-src-adversarial-test-ts.log.txt)                    |
| infrastructure: src/claude/process.test.ts                 | 2 passed, 3 failed                 | [log](round-3-isolated-infrastructure-src-claude-process-test-ts.log.txt)                 |
| infrastructure: src/claude/readiness.test.ts               | 20 passed, 1 failed                | [log](round-3-isolated-infrastructure-src-claude-readiness-test-ts.log.txt)               |
| infrastructure: src/process/scripts.test.ts                | 36 passed, 3 failed                | [log](round-3-isolated-infrastructure-src-process-scripts-test-ts.log.txt)                |
| infrastructure: src/sqlite/upgrade.test.ts                 | 26 passed                          | [log](round-3-isolated-infrastructure-src-sqlite-upgrade-test-ts.log.txt)                 |
| api: src/subloop-restart.test.ts                           | 1 passed, 2 failed                 | [log](round-3-isolated-api-src-subloop-restart-test-ts.log.txt)                           |

**D-015 and residual full-suite failures.** Native process-control validation remains unavailable in this sandbox. ProcessScripts cancellation with incomplete UTF-8 explicitly failed its native process-tree termination assertion; its timeout/abort cases timed out. The adversarial real-child/grandchild abort case also timed out. Claude process deadline/overflow/abort/descendant cases produced EBUSY cleanup and descendant-output failures; its no-turn hang case retained an assertion failure. API hard-kill subloop restart exceeded its 180-second test budget and the child-finished-while-down cleanup hook exceeded 60 seconds in isolation. These commands were attempted, not skipped; successful termination/restart is not established. The exact logs above retain their assertions and output rather than treating every failure as proven sandbox causation. SQLite upgrade's full-run timeouts, the conversion timeout and the child-wake wait failure passed alone, with cause unestablished. Infrastructure's final 11 failures include three SQLite-upgrade timeouts in addition to native-boundary cases. No additional isolated retry was used to clear the changed full-run observations.

**Files and shared ranges.** Thirty-five source/doc files changed, plus this evidence folder. [Complete file and candidate-line inventory](round-3-changed-files.json) names every changed hunk, including files outside primary ownership. Shared-file edits are restricted to the checkpoint port, getThread/snapshot handling and the additive column:

| Shared file                                  | Final candidate line ranges                      |
| -------------------------------------------- | ------------------------------------------------ |
| packages/engine/src/run-manager.ts           | 47; 1067; 1069-1072; 1740; 1799; 1818; 1855-1856 |
| packages/engine/src/ports.ts                 | 1; 124-132                                       |
| packages/infrastructure/src/sqlite/schema.ts | 1; 89-92                                         |

Changed files by package:

- Domain: src/replay.ts (required strict state and corrected duplicate comment), src/reconcile-thread.ts (writer-proof documentation), src/reconcile-thread.test.ts (delayed other-node duplicate).
- Engine: src/ports.ts, src/run-manager.ts, src/testing/fakes.ts; src/checkpoint-state.test.ts (new), src/thread-read.test.ts, src/adversarial.test.ts, src/recovery.test.ts and src/handlers/gates.test.ts (port forwarding/state invariants).
- Infrastructure: src/sqlite/schema.ts, runs.ts, run-row.ts; drizzle/0018_thread_checkpoint_replay_state.sql, meta/_journal.json, meta/0018_snapshot.json; src/sqlite/checkpoint-state.test.ts (new), storage.test.ts, json-values.test.ts, loop-deletion.test.ts and the four historical fixture files listed above.
- API: src/testing/thread-history.ts, src/thread-history.test.ts, src/wait-identity.test.ts and scripts/thread-read-measure.ts. MCP: src/thread-history.test.ts. Web: e2e/thread-history.spec.ts.
- Docs: docs/05-execution-engine.md, docs/07-api-and-streaming.md, ADR-0053 and CHANGELOG.md (existing #116 bullet, including port/migration upgrade notes). No generated route/node schema changed; check:docs passed.

The delayed snapshot adapter and all test decorators forward the required state. Final code captures remain text: [engine regression](round-3-engine-regression.test.ts.txt), [storage regression](round-3-storage-regression.test.ts.txt), [REST regression](round-3-api-regression.test.ts.txt), [MCP regression](round-3-mcp-regression.test.ts.txt), [measurement script](round-3-thread-read-measure.ts.txt). useRunEvents, the independent QA folder, editor restore/routing tests, protected upgrade implementation, #255 and #185 are unchanged. No dependency or ownership boundary is expanded.

**Evidence integrity and handoff.** Added captures live only in this folder; code copies end in .txt, local profile paths are %USERPROFILE%, and retained sizes/hashes are computed from final bytes in the candidate and evidence manifests. The previous checker capture is preserved as the round-2 capture. The first [checker preflight](round-3-checker-preflight.log.txt) exposed a report-copy suffix that its bare-name parser split; the report copy was renamed to a plain .txt name before the final check. No new capture exceeds 1,000,000 bytes; existing NOT-KEPT entries keep their historical provenance. Final checker, after final artifact formatting and integrity verification:

```text
docs\qa\2026-10-23-wp-g1-116: 174 files, 282 citations, 5 recorded as not kept, 0 missing
```

[Current checker capture](qa-refs.log.txt). The invoked command is node %USERPROFILE%\.claude\codex-runs\GraphGoblin\tools\check-qa-refs.mjs docs\qa\2026-10-23-wp-g1-116.

Implementation and B1/N1/N3 regressions are complete. Full local package gates remain failed/unqualified as shown, with no claim of clean CI or acceptance. PR #397 CI is the clean full-suite signal. The orchestrator must commit, then run independent QA and audit round 2; renumber the additive migration if #389 lands first. Disposable stores/test artifacts are retained for orchestrator cleanup. No commit, push, merge, rebase, stash, branch switch, index change, sub-agent, owner app/store access, provider turn or manual directory deletion was performed.

### Bounded current-thread reads and measurements (round 2, superseded proof)

`RunManager.getThread` requests `events.read(runId, checkpoint.seq - 1)` and requires the first returned event's sequence to equal the checkpoint's. It derives a small replay state only at provable boundaries, then calls the same domain `reconcileThread` owner:

| Boundary        | Proven replay state           | Reason                                                                  |
| --------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `node.started`  | Strict, that node open        | The event itself establishes the latest open visit                      |
| `run.waiting`   | Strict, the waiting node open | Execution starts the node, then parks/checkpoints its still-open visit  |
| `node.finished` | Strict, no node open          | The engine appends the matching completion before saving its checkpoint |
| `run.finished`  | Strict, no node open          | The exit's matching completion precedes this event in the same append   |

Missing boundaries, unsequenced snapshots and other boundary kinds use the full admitted seed/history. In particular, recovery can checkpoint a failed/cancelled or later progress/delivery event without that event proving which visit is open. No new stored state or migration is introduced. The proven state is an optional in-memory checkpoint input to the existing pure owner. Execution's `loadThread` retains its full history and is unchanged in round 2.

The counting-port regression failed on starting HEAD before production changes: the current snapshot expected a sole read after sequence 7 returning event 8, but observed a full read after 0. [Before log](bounded-before.log.txt). After correction, the focused selection passed 33 tests, including current/lagging, parked/started, missing/ambiguous and unsequenced checkpoints and duplicate-patch suppression: [after log](bounded-after.log.txt).

Physical SQLite, real loopback HTTP GET /runs/{id}/thread, Node 22.14.0, 10,008 events, one warm-up and five measured reads per case, fresh disposable store per before/after capture. The controlled workload admits a minimal run then appends synthetic started/completed node pairs; it is a read-path measurement, not evidence of 5,000 native node executions or live providers. Each response is compared with complete replay. The lagging checkpoint omits 200 events. The machine was loaded; these elapsed values are observations, not an SLA or a direct comparison to #190's different payloads/workload.

| Checkpoint         | Rows before | Rows after | Median before (ms) | Median after (ms) |
| ------------------ | ----------: | ---------: | -----------------: | ----------------: |
| current            |       10008 |          1 |            311.421 |            25.814 |
| lagging-200-events |       10008 |        201 |            222.919 |            21.827 |

[Raw before samples](measure-before.json), [raw after samples](measure-after.json), [before command log](measure-before.log.txt), [after command log](measure-after.log.txt). The repeatable measurement source is apps/api/scripts/thread-read-measure.ts; its [final source capture](measure-thread-read.ts.txt) is retained as text. That manual measurement uses reserved port 5933. The browser harness below uses only ephemeral ports.

The successful baseline preceded production changes. Benchmark setup was corrected first to initialize the container and append in 200-event batches within SQLite's parameter limit; those setup failures are not product regressions. Full replay remains available when a checkpoint's state is not provable.

### Default browser harness

The spec now imports the repository fixtures and calls `control(request, '/apps', { threadHistory: true })`. The default e2e/server control surface creates the physical delayed-snapshot fixture, listens with port 0, assigns an instance ID and owns cleanup. The `/thread-history` control path selects that instance and supplies start, held-work observation/release, FIFO snapshot flush and snapshot/stored-byte reads. Unknown instances/actions are rejected.

The standalone server file is deleted as requested; its [historical text capture](thread-history-server.ts.txt) preserves round-1 provenance. No spec child process, fixed browser port, custom Playwright configuration or replacement harness remains. `createThreadHistoryFixture` remains because both the default harness and public API/MCP regressions use it. The normal harness path is unchanged when the new option is absent. `useRunEvents.ts` is unchanged from starting HEAD.

### Evidence relocation and integrity

All 54 original files were moved here with their prefix removed; the report is this README. Historical content is retained in [the round-1 report](round-1-report.md). Code copies are text artifacts ending in .ts.txt, .mjs.txt or .cmd.txt. [Relocation audit](relocation-audit.log.txt) verifies all mappings and 11 raw JSON/code captures against starting HEAD (five byte-identical; the remaining six differ only by pre-existing checkout line endings). The move did not rewrite raw captures. Retained textual logs are normalized to UTF-8/LF and %USERPROFILE%; raw JSON and source captures keep their bytes.

All retained evidence sizes and SHA-256 values are regenerated from the final bytes in the [evidence manifest](evidence-manifest.log.txt); this includes the orchestrator-redacted logs. The [candidate manifest](candidate-manifest.log.txt) is regenerated for current source/document files and drops the removed executable server. Historical oversized captures remain in [NOT-KEPT](NOT-KEPT.md): available bytes are checked again; absent original captures retain their historical metadata rather than inventing replacement hashes.

Reference checker, run after the final gates and artifact formatting:

```text
docs\qa\2026-10-23-wp-g1-116: 91 files, 152 citations, 5 recorded as not kept, 0 missing
```

[Round-2 reference-checker capture](round-2-qa-refs.log.txt). The checker is invoked last with Node 22 using the orchestrator-provided script and this folder as its argument.

## 3. Files changed

- **Domain:** packages/domain/src/reconcile-thread.ts and its test: optional proven checkpoint replay state; full-history consumers keep deriving state as before.
- **Engine:** packages/engine/src/run-manager.ts: bounded public thread reads only; new public-interface counting-port regression in src/thread-read.test.ts.
- **API tooling:** apps/api/scripts/thread-read-measure.ts: supported constructor/port composition, real HTTP and persisted read measurements.
- **Web harness:** apps/web/e2e/server.ts and e2e/thread-history.spec.ts; delete apps/web/scripts/thread-history-server.ts.
- **Docs/evidence:** docs/07-api-and-streaming.md, docs/decisions/ADR-0053-thread-event-tail-reconciliation.md, and the relocated evidence folder.

Shared/unlisted file ranges in the formatted round-2 candidate:

| File                                                        | Candidate lines / baseline removal                                                  | Scope                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| packages/engine/src/run-manager.ts                          | 1066-1085 inserted                                                                  | Only bounded reads inside getThread; loadThread/admission/shutdown/finalization unchanged |
| apps/web/e2e/server.ts                                      | 20-25, 56, 490-520, 522-530                                                         | Testing import, instance registry and thread-history control/app option                   |
| apps/web/e2e/thread-history.spec.ts                         | 3-4, 11-20, 42, 49-55, 68, 84, 87, 89, 103; removes baseline 1-2, 12-43 and 120-133 | Default fixtures/control integration and remove private process lifecycle                 |
| apps/api/scripts/thread-read-measure.ts                     | 1-152 (new)                                                                         | Repeatable supported-port/HTTP measurement tooling                                        |
| packages/engine/src/thread-read.test.ts                     | 1-127 (new)                                                                         | Public constructor/counting-port regressions                                              |
| packages/domain/src/reconcile-thread.ts                     | 2, 7-8, 31                                                                          | Type import, in-memory proven state and its replay input                                  |
| packages/domain/src/reconcile-thread.test.ts                | 54-84                                                                               | Proven-tail/full-replay parity regression                                                 |
| apps/web/scripts/thread-history-server.ts                   | Baseline 1-44 deleted                                                               | Explicitly requested standalone-server removal                                            |
| docs/07-api-and-streaming.md                                | 144-173                                                                             | Bound, proof and measurement section                                                      |
| docs/decisions/ADR-0053-thread-event-tail-reconciliation.md | 38-67, 73-74                                                                        | Same decision refinement and consequences                                                 |

No round-2 edit to useRunEvents.ts, event-store.ts, the inspector component, API/MCP production routes/tools, SQLite storage, run admission, shutdown or finalization. The mandatory repository formatter's incidental changes, if any, are listed with final ranges rather than silently retained.

## 4. Tests

- New engine `thread-read.test.ts` tests through public constructors and injected event ports; it proves the current snapshot never reads the event prefix.
- Extended domain reconciliation test supplies a proven boundary state, verifies tail/full parity and still ignores a checkpoint beyond a selected historical boundary.
- Existing run-manager focused selection: 33 tests passed across two files.
- Persisted API reconciliation focus: three tests passed ([log](round-2-api-focused.log.txt)).
- Existing API/MCP/web reconciliation tests remain in the requested full package runs below.
- Browser scenario retains failure, held unfinished resume, success, open and reloaded tabs, offline/reconnect, complete thread comparisons and persisted-byte read immutability. It now uses the default harness.
- An initial new parked test omitted the required prompt; that fixture was corrected before the recorded baseline ([fixture correction log](bounded-fixture-correction.log.txt)). The corrected baseline has four read-bound failures and one pass; no production change preceded that reproduction.

| Package | Full-run files             | Full-run tests                |                       Lines |                    Branches |
| ------- | -------------------------- | ----------------------------- | --------------------------: | --------------------------: |
| domain  | 31 passed (31)             | 595 passed (595)              |        98.48% ( 2012/2043 ) |         95.8% ( 2282/2382 ) |
| engine  | 41 passed (41)             | 1587 passed (1587)            |        98.06% ( 2534/2584 ) |        93.09% ( 2143/2302 ) |
| api     | 65 passed, 2 skipped (67)  | 1324 passed, 8 skipped (1332) |        97.99% ( 1853/1891 ) |        92.93% ( 1302/1401 ) |
| mcp     | 10 passed (10)             | 50 passed (50)                |          96.66% ( 232/240 ) |          95.39% ( 207/217 ) |
| web     | 1 failed, 130 passed (131) | 1 failed, 1646 passed (1647)  | Not produced (failed suite) | Not produced (failed suite) |

The full web run failed only apps/web/src/editor/EditorPage.restore.test.tsx:129:
`Unable to find role="heading" and name "legacy device copy"`, in the legacy-v1 draft restore/first-save-overwrite case.
That untouched file was rerun alone exactly once with one worker: all 20 tests passed in 34.10 seconds.
The full run remains failed (1 failed, 1646 passed); it took 3615.88 seconds. Its coverage report was not produced.
The isolated pass does not qualify full-package web coverage or establish the original failure's cause.
No editor restoration code or test was changed. No other full-suite file failed, so no other isolated rerun was needed.

Thresholds, exclusions and test timeout budgets are unchanged. An isolated pass never silently clears an earlier failed full run.

## 5. Gates

Node 22 first on PATH for every command; `node --version` reports `v22.14.0`. Direct package coverage avoids Turbo test-cache reuse. Full suites run sequentially; web uses one worker. Untouched failing files receive exactly one isolated rerun, retaining both results under the loaded-machine protocol. PR #397 CI remains the subsequent clean-environment signal; no CI status is asserted here.

| Command                 | Result          | Evidence                            |
| ----------------------- | --------------- | ----------------------------------- |
| `pnpm.cmd typecheck`    | Passed (exit 0) | [log](round-2-typecheck.log.txt)    |
| `pnpm.cmd lint`         | Passed (exit 0) | [log](round-2-lint.log.txt)         |
| `pnpm.cmd format`       | Passed (exit 0) | [log](round-2-format.log.txt)       |
| `pnpm.cmd check:layers` | Passed (exit 0) | [log](round-2-check-layers.log.txt) |
| `pnpm.cmd check:deps`   | Passed (exit 0) | [log](round-2-check-deps.log.txt)   |
| `pnpm.cmd check:docs`   | Passed (exit 0) | [log](round-2-check-docs.log.txt)   |

Root lint retains one unchanged warning at apps/web/src/runs/inspector/ThreadViewer.tsx:106. Turbo also printed cache I/O access warnings; the six root commands all exited 0. [Root result record](round-2-root-results.json).

| Exact command                                                                                              | Result                         | Evidence                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `pnpm.cmd --filter @graphgoblin/domain test:coverage`                                                      | Passed (exit 0)                | [log](round-2-domain-coverage.log.txt)                                     |
| `pnpm.cmd --filter @graphgoblin/engine test:coverage`                                                      | Passed (exit 0)                | [log](round-2-engine-coverage.log.txt)                                     |
| `pnpm.cmd --filter @graphgoblin/api test:coverage`                                                         | Passed (exit 0)                | [log](round-2-api-coverage.log.txt)                                        |
| `pnpm.cmd --filter @graphgoblin/mcp test:coverage`                                                         | Passed (exit 0)                | [log](round-2-mcp-coverage.log.txt)                                        |
| `pnpm.cmd --filter @graphgoblin/web test:coverage --maxWorkers=1`                                          | Failed (exit 1)                | [log](round-2-web-coverage.log.txt)                                        |
| `pnpm.cmd --filter @graphgoblin/web exec vitest run src/editor/EditorPage.restore.test.tsx --maxWorkers=1` | Passed isolated rerun (exit 0) | [log](round-2-web-isolated-src-editor-EditorPage-restore-test-tsx.log.txt) |

[Coverage and isolated-rerun result record](round-2-coverage-results.json).

| Command / trial                                                                                            | Result          | Evidence                         |
| ---------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------- |
| `pnpm.cmd build`                                                                                           | Passed (exit 0) | [log](round-2-build.log.txt)     |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/thread-history.spec.ts --retries=0 (trial 1)` | Passed (exit 0) | [log](round-2-browser-1.log.txt) |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/thread-history.spec.ts --retries=0 (trial 2)` | Passed (exit 0) | [log](round-2-browser-2.log.txt) |
| `pnpm.cmd --filter @graphgoblin/web exec playwright test e2e/thread-history.spec.ts --retries=0 (trial 3)` | Passed (exit 0) | [log](round-2-browser-3.log.txt) |

All three runs used the default Playwright configuration/global setup, default Windows browser channel and `--retries=0`. Each ran the one selected spec and passed once. Three distinct successful runs are repeatability evidence, not retries of a failed run.
Raw observations: [trial 1](round-2-browser-1.json), [trial 2](round-2-browser-2.json), [trial 3](round-2-browser-3.json). Every phase agrees across HTTP current-thread, open inspector and reloaded inspector; stored run/event values are unchanged by reads. [Build/browser result record](round-2-browser-results.json).

All exact commands, exit results and isolated reruns are retained in the result records and linked command logs. No failed full suite is repeatedly rerun to obtain a passing gate.

## 6. Docs

docs/07-api-and-streaming.md and docs/decisions/ADR-0053-thread-event-tail-reconciliation.md document the write-order proof, ambiguous-boundary fallback, in-memory state, unchanged full execution read, workload and before/after measurements. The existing top Unreleased CHANGELOG bullet ending (#116) remains intact. No route/schema, dependency, generated-reference or migration change is needed.

The round-1 docs/05 and docs/09 behavior and the hook integration remain unchanged. Historical reports are labelled as historical, source references distinguish repository files from evidence, and all retained captures have final-byte integrity records.

## 7. Decisions and parameters

- The first event must verify the checkpoint's sequence; checkpoint presence alone is insufficient.
- State is inferred only from the four boundaries justified above. Other shapes fall back rather than guessing an open visit. Persisting state would add an unnecessary storage contract/migration for the common case.
- The same pure owner filters the checkpoint boundary and replays the tail, carrying strict/open-visit state to prevent duplicate completion patches.
- No initial-thread decode is needed on the proven fast path. Without a usable checkpoint, actual admitted seed/full history remains authoritative.
- Measurement: five samples after one warm-up per case, 10,008 events, 200-event lag and append batches of 200. Row counts establish the history bound; elapsed samples show this fixture's loaded-machine behavior.
- Harness instances and its control listener use ephemeral ports and fixture-owned cleanup. The physical fault fixture uses disposable gg-wp-g1-116- stores and no provider calls.
- Code captures remain text; executable measurement tooling lives outside the QA folder. Hashes cover final bytes and do not treat normalized/redacted logs as their previous preimages.
- Round-1 inspector polling/retry parameters and #255 scope remain unchanged.

## 8. Caveats and open items

All three requested implementation changes are present. The remaining local gate failure is the untouched legacy-editor restore assertion above; its isolated rerun passed. Full web coverage therefore remains unqualified locally. The failure is not silently waived or attributed to environment/pre-existing behavior without proof. PR #397 CI and independent QA must disposition it. No unrelated editor fix or timeout increase was attempted.

The independent review, QA and orchestrator commit remain outstanding. Local full-suite results and isolated reruns are reported separately; none substitutes for PR CI or independent acceptance. Disposable stores and generated test-result/coverage directories are retained for orchestrator cleanup. No directory cleanup command was issued. The expressly requested single server file was deleted; ordinary fixture/test-runner cleanup remains owned by the existing harness. No GitHub writes were made.
