# WP-G1 #116: round-2 implementation handoff

## 1. Branch and worktree

- Starting HEAD: `7f88a0665492a28c697ce7ce0773942d7f63aa85`; branch `codex-wp-g1-116`.
- Worktree: `%USERPROFILE%\source\repos\GraphGoblin\.claude\worktrees\codex-wp-g1-116`.
- Round-2 changes are uncommitted. No index changes, commits, pushes, merges, rebases, stashes, branch switches, sub-agents, owner-instance access or provider turns.
- Review/QA and the orchestrator's commit remain separate. Final local gate disposition is below; no acceptance sign-off is claimed here.

## 2. Per bolt

The three requested #116 review changes are implemented. Validation is complete below. The full web unit gate failed one untouched legacy-editor assertion; its isolated rerun passed. All other requested gates and all three browser runs passed.

### Bounded current-thread reads and measurements

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

[Reference-checker capture](qa-refs.log.txt). The checker is invoked last with Node 22 using the orchestrator-provided script and this folder as its argument.

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
