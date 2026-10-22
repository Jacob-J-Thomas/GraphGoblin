# WP-D1 #320 implementation evidence

## Branch and worktree

Branch `codex-wp-d1-child-recovery`, worktree `<local>\source\repos\GraphGoblin\.claude\worktrees\codex-wp-d1-child-recovery`. Base `48ecf6e7`; inherited WIP `6bc37e2cd3d88b48a15920c334874253ad15bbc9`. This continuation is uncommitted for orchestrator review and commit. No index operations, commits, branch changes, pushes or merges were performed.

## Per bolt

#320 retains the planned representation: the child's admission transaction also appends its parent's `child_run.started`, including the parent sequence projection. Before commit neither exists; after commit recovery finds the same child even when the admission call never returned or the parent never parked. The inherited C6 reconciliation handles already parked and already terminal children. The real SQLite cases cover pre-admission interruption, post-admission interruption, rollback of the parent-link insertion, re-parking an unfinished input child, a terminal child before parking, and interruption after recording the child finish. The API trial executes nested children in a separate built process and uses real SIGKILL/restart.

Finish deduplication identifies an observed child outcome by child id plus terminal-event sequence, carried durably as `childFinishedSeq` in the existing child wake's JSON payload. It preserves the finish across an interrupted completion or parent failure, records a new observed outcome after an independent retry, and reuses the existing outcome on a parent output-mapping retry. A changed outcome is parked/woken before consumption. The child outcome, terminal sequence and thread come from one log snapshot. Outcomes never consumed by the parent are not backfilled, preserving C6. This refines the inherited finish scan without changing the admission representation or stored shapes.

Implementation verification is complete with the explicitly retained environment-class gate failures below. Cross-vendor review and independent QA remain separate delivery gates. #321 is deferred to the second round, including its owner QA README; both bolts use `aidlc-ready` per the current owner clarification.

## Files changed

The complete package includes the inherited WIP, not just the continuation diff:

- Engine: `src/admission.ts`, `handler.ts`, `handlers/subloop.ts`, `run-manager.ts`, `testing/fakes.ts`, `testing/admission-contract.ts`, `recovery.test.ts`, `adversarial.test.ts`, and new `child-creation.test.ts`.
- Infrastructure: `src/sqlite/admission.ts`, `admission-contract.test.ts`, and new `child-admission-recovery.test.ts`.
- API: new `src/child-creation-restart.test.ts`; `src/testing/api-subprocess.ts` accepts an optional disposable-directory prefix and port range, allocating the port before creating the store.
- Documentation: docs 04 and 05, ADR-0046 and the decision index, CHANGELOG, the package plan, and this evidence folder.

Shared production file `packages/engine/src/run-manager.ts` changes only lines **104-108, 443-445, 1476-1484, 1955-1956, 1960-1968, 2011, 2082-2096 and 2099-2108** (current-file ranges): the optional parent node/admission argument, refresh of the committed parent link, `notifyParent`'s outcome identity, child-start argument, and child-outcome snapshot. The child-outcome reader is the necessary child-bookkeeping refinement to bind its thread and outcome to the same terminal event; the plan records this scope detail. `reconcileChild`, `recover`, finalisation and return delivery are unchanged. The shared subprocess helper changes lines **36-50 and 122-135**. Shared docs 04/05 and CHANGELOG have additive #320 text. Inference and adapter turn paths are untouched.

## Tests and failing-before evidence

The baseline is `48ecf6e7`. Seven compiled implementation/helper files were temporarily replaced with that commit's content in this worktree, preserving the regression tests, then restored byte-for-byte in a `finally` block. No Git state was mutated. The baseline build passed all 11 tasks. An initial build attempt exposed that the exported admission-contract helper is also compiled; including that helper in the baseline substitution resolved the test setup mismatch.

| Scenario                                                                             | Baseline result                                                                                                                                              | Evidence                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Engine success/failure finish interrupted before the next parent event               | Both record `child_run.finished` twice                                                                                                                       | [before-engine.txt](before-engine.txt)                       |
| Parent output-mapping retry with unchanged child outcome                             | `expected ... length of 1 but got 2`                                                                                                                         | [before-engine.txt](before-engine.txt)                       |
| Independent child retry while parent interrupted, with the inherited finish scan     | `expected ... length of 2 but got 1`                                                                                                                         | [before-independent-retry.txt](before-independent-retry.txt) |
| Real SQLite child admission commits but its port never returns; close/reopen/recover | Expected only child `...007`, received it plus `...001`                                                                                                      | [before-sqlite.txt](before-sqlite.txt)                       |
| Real SQLite interruption after child finish recording                                | `expected ... length of 1 but got 2`                                                                                                                         | [before-sqlite.txt](before-sqlite.txt)                       |
| Built API, read-only observer, real kill, restart                                    | Observer detected an unlinked child after 45,171 coherent snapshots; restart produced child counts `2,1,...`, with 25 parent rows instead of the expected 24 | [before-api.txt](before-api.txt)                             |

The baseline engine run had 3 expected failures and 2 passes; the selected SQLite run had 2 expected failures and 4 unselected cases. The API baseline exercised the 0 ms case, originally the first iteration of one test; the final test separates the same 0/5/25 ms cases so each has its own bounded process-test timeout. Each case uses 12 root parents, nested middle/leaf children and API concurrency 8. The observer joins child rows and parent links in one read-only SQL statement and starts before the API; it never constructs a gap from separate reads. Before/after assertions for the 0 ms case are unchanged.

Before the final gates, all 6 SQLite cases passed alone, and the then-current 5 engine cases passed. The inherited engine C6/recovery selection passed 89 tests before the additional mapping/retry cases. The final outcome-identity design passed the 92-test child-creation/C6/recovery selection. The first package-wide run of that design exposed ADV-015's synthetic fixture: it changed the child's row to succeeded without recording its terminal event. The fixture now constructs the durable event before the row, matching production's log-first contract; its success assertion is unchanged.

Final package-wide results (thresholds and source denominators unchanged):

| Package        | Tests                                             | Lines  | Branches | Statements | Functions |
| -------------- | ------------------------------------------------- | ------ | -------- | ---------- | --------- |
| Engine         | 543 passed, 1 load timeout; 544 total             | 98.10% | 92.36%   | 96.91%     | 98.69%    |
| Infrastructure | 624 passed, 8 failed; 632 total                   | 98.42% | 94.47%   | 97.65%     | 98.23%    |
| API            | 702 passed, 1 failed, 6 existing skips; 709 total | 97.83% | 92.90%   | 96.41%     | 94.05%    |

All four coverage metrics exceed 90% in all three packages. These coverage commands still exited 1; passing coverage percentages do not erase test failures.

- Engine: `edge-cases.test.ts`'s compound subloop test exceeded its 5-second limit (5,275 ms). It passed unchanged in isolation at the original limit: [engine-edge-isolated.txt](engine-edge-isolated.txt). All seven new child-creation/finish tests, C6's `awaited-children.test.ts`, the recovery tests and the repaired ADV-015 passed in the final full run.
- Infrastructure: seven native transport/process-tree failures are the known D-015 sandbox class, including one descendant fixture cleanup error. Six safe-to-clean cases reproduced in isolation ([native-isolated.txt](native-isolated.txt)); the descendant case was not rerun to leave another uncleanable fixture. The remaining `upgrade.test.ts:302` timeout persisted in isolation at 20 seconds and with one bounded 60-second diagnostic limit ([upgrade-isolated.txt](upgrade-isolated.txt), [upgrade-diagnostic-60s.txt](upgrade-diagnostic-60s.txt)). It remains an unresolved environment-class check for external QA; no upgrade code was changed. The final real-SQLite child admission/crash/shared-contract selection passed **23/23**: [sqlite-final.txt](sqlite-final.txt).
- API: C6's mid-wake case failed during its one-second initial setup poll, before it constructed the crash window, followed by a cleanup-hook timeout. The same case passed unchanged in isolation, including its second restart: [subloop-midwake-isolated.txt](subloop-midwake-isolated.txt). C6's other two cases, its eight real-kill sweep, and all `subloop-failure.test.ts` cases passed in the full run. The original full-run failure is retained in [api-coverage.txt](api-coverage.txt).

The **three new built-API child-admission trials passed**. Across 36 root runs and 72 nested parent visits, the observer saw no missing child link and each parent had one child, one child-finish event and the expected output after restart:

| Kill delay after first child observed | Coherent observer snapshots | Children at kill | Unlinked child | Parent visits after restart    |
| ------------------------------------- | --------------------------- | ---------------- | -------------- | ------------------------------ |
| 0 ms                                  | 36,973                      | 1                | none           | 24, all with exactly one child |
| 5 ms                                  | 28,030                      | 1                | none           | 24, all with exactly one child |
| 25 ms                                 | 16,162                      | 1                | none           | 24, all with exactly one child |

Each new API case also asserted that its disposable directory was removed. A post-run inventory found no `%TEMP%\gg-wp-d1-*` directories. No test was excluded or changed to skip, and no full failed suite was retried to claim a green gate. Isolated results qualify the failure class while the full-run exit codes stay red.

## Gates

All pnpm commands use Node `v22.14.0` from this worktree. Final commands, exit codes and logs are recorded in [verification-results.json](verification-results.json); [gate-results.json](gate-results.json) preserves the initial sweep. Package coverage runs use `--maxWorkers=2 --coverage.reportOnFailure`, retaining the repository's source include list and thresholds. No production source exclusions were added.

- `pnpm.cmd build`: passed, 11/11 tasks, on the final production source ([build-final.txt](build-final.txt)).
- `pnpm.cmd typecheck`: passed, 20/20 tasks ([typecheck-final.txt](typecheck-final.txt)); engine and API typechecks also passed after the last fixture/observer typing fixes.
- `pnpm.cmd lint`: passed, 11/11 tasks ([lint-verified.txt](lint-verified.txt)).
- `pnpm.cmd check:layers`: passed ([layers-final.txt](layers-final.txt)).
- `pnpm.cmd check:deps`: passed with the existing orphan warning for `infrastructure/drizzle.config.ts`; the inherited type-only `admission.ts -> ports.ts -> admission.ts` cycle was removed by deriving the child link type from contracts ([deps-final.txt](deps-final.txt)).
- `pnpm.cmd check:docs`: passed; generated references are current ([docs-final.txt](docs-final.txt)).
- `pnpm.cmd format:check`: the result is captured after writing this report in [verification-results.json](verification-results.json) and [format-check.txt](format-check.txt).
- The three package coverage commands: thresholds passed, commands exited 1 for the cases above. Full logs are retained as `engine-coverage-final.txt`, `infrastructure-coverage.txt` and `api-coverage.txt`.
- `pnpm.cmd test:recovery-process`: passed **1/1**, including healthy recovery beside two damaged histories, manual repair and successful fixture removal ([recovery-process.txt](recovery-process.txt)).

No dependency, node-schema, route or web-source change required licence regeneration, node/API reference regeneration or browser specs in this round. Review, independent QA and authoritative CI are still required before integration.

## Docs

[Plan](../2026-10-20-wp-d1-plan.md), [docs 04](../../04-node-catalog.md), [docs 05](../../05-execution-engine.md), [ADR-0046](../../decisions/ADR-0046-atomic-child-admission.md) and the CHANGELOG describe the transaction and recovery. The event types and stored shapes are unchanged: no migration or reset is required. ADR-0046 is proposed for review. There is no node-schema or route change.

## Decisions and parameters

- One transaction avoids the two inconsistent child/link states instead of introducing a separate recoverable intent table. This keeps the inherited plan.
- The in-memory admission stages the same transaction and now updates the parent `lastEventSeq`, verified by the shared contract.
- A parent's output-mapping failure does not change its child outcome. Child id plus terminal-event sequence identifies each observed outcome in the existing child wake; a changed outcome gets a fresh park/wake before consumption. This handles independent retries with identical statuses while preserving C6's rule that an unconsumed earlier failure stays unconsumed.
- SQLite boundary waits allow 10 seconds, replacing inherited one-second waits that timed out under concurrent host load. Each native API kill trial allows 240 seconds; splitting the three cases prevents cumulative Windows process-start time from consuming one shared timeout. These are test parameters, not owner-approved product settings.
- New stores use `%TEMP%\gg-wp-d1-*`; new API trials use ports 5910-5919. SQLite cleanup closes handles, collects native statements and removes its own store with bounded Windows handle-release retries; the new API cases assert directory removal after fixture cleanup. Existing shared subprocess tests retain their established port defaults.

## Caveats and open items

- Review and independent QA are pending; #321 and its owner QA recipe remain next round's work.
- Historical orphan children created before this transaction are not inferred or rewritten. This is a child-admission guarantee, not exactly-once external effects inside a child.
- The register in this inherited checkout ends at D-023 and has no section 4b. The current handoff is the authority for the substitution recorded as D-026 and the superseded #321 gate.
- One store from the initial inherited test run remains at `%TEMP%\gg-child-admission-gUVE9d` (created 2026-10-21 18:12:03). Inspection found only `graphgoblin.db`. Automatic approval review rejected both recursive cleanup and a narrower explicit-file/empty-directory cleanup as **blocked by policy**. Its removal needs the orchestrator. Older pre-existing `gg-child-admission-*` directories were left alone.
- The full infrastructure run also reported `EBUSY` cleaning its existing native descendant fixture, `%TEMP%\gg-claude-process-N8hTZB`. Its marker was unchanged over a 200 ms observation after the run; process cleanup could not be verified because CIM process inspection was denied. The descendant case is not rerun to create another fixture that this sandbox cannot reliably clean. Native transport tests belong to the known D-015 environment class and are not changed here.
- Read-only cleanup inventory also found `%TEMP%\gg-api-process-V9vDMa` (created 19:31:33) and `%TEMP%\gg-api-process-5tvf4I` (created 19:34:02), both containing the C6 fixture's `Restart leaf` / `Constructed middle` / `Constructed top` definitions and three waiting runs. They are candidates from concurrent C6 work, including the failed setup/cleanup in this coverage run; their individual ownership cannot be established from the shared fixture names. They were preserved for orchestrator reconciliation, not deleted. The successful isolated mid-wake trial returned without a cleanup-hook error.
