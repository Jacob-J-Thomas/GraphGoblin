# Engine: current-thread reads omit the last node start after an expression failure

## Observed behavior

The public RunManager.getThread method returns the saved thread immediately when a snapshot exists, even when later durable events describe a failed node's start. Replaying the same run from its initial thread and events gives a more recent counters.nodeVisits value.

This was observed with the real RunManager and production handlers over testing fakes in the #167 scratch scenarios, and the cross-vendor review confirmed it as an unrelated engine finding. The test is committed on research/167-exit-comparison at 9711f6a8d7f14743c793048502c47828a107a755; the engine source is the unchanged main code from c379f806ba8a04433779d98ded7e4196c9d4b663.

Both examples complete four work passes, then their exit/decision expression throws EVALUATION_EXPRESSION_FAILED. The failure is nonresumable, no terminal return runs, and the two views differ as follows:

| Example | RunManager.getThread returns. | Full event replay returns. |
| --- | --- | --- |
| A, with the failed exit node. | nodeVisits is {start: 1, work: 4, exit: 3}. | nodeVisits is {start: 1, work: 4, exit: 4}. |
| B, with the failed decision node. | nodeVisits is {start: 1, work: 4, decide: 3}. | nodeVisits is {start: 1, work: 4, decide: 4}. |

The fourth exit/decision start is durable, but there is no corresponding completion. The last saved work-completion snapshot therefore omits that start. Variables agree in these reproductions; this is not evidence that the work patch was lost.

The run-thread API forwards getThread's result, so source inspection indicates that its "current context thread" response can expose the same stale counter. This API implication was not verified through a live server or SQLite in this research. Execution recovery already reconstructs from the event log and is not shown to be incorrect.

## Reproduction

From the research worktree root in PowerShell, run the existing single scratch file:

~~~powershell
pnpm.cmd --filter @graphgoblin/engine exec vitest run src/issue-167-scratch.test.ts
~~~

All 40 characterization checks pass today. The two cases named "A: expression evaluation error at ceiling" and "B: expression evaluation error at ceiling" deliberately assert the observed read/replay difference; green checks do not mean the proposed expected behavior is implemented.

The test runs production handlers with input {k: 99, failAt: 999}, a ceiling of 4, and an expression that throws once vars.count >= 4. In A, the first exit predicate throws; in B, the routing decision throws. It then obtains getThread, obtains the initial thread and stored events, and compares their counters to domain replayThread.

Inspect the generated records with this optional PowerShell command:

~~~powershell
$lagEvidence = Get-Content -Raw -Encoding utf8 issue-167-observations.json | ConvertFrom-Json
$lagEvidence.records | Where-Object { $_.scenario -eq 'expression error at ceiling' } |
  Select-Object design, @{Name='Read';Expression={$_.readThread.counters.nodeVisits}},
    @{Name='Replay';Expression={$_.thread.counters.nodeVisits}}
~~~

Equivalent Bash reproduction:

~~~bash
pnpm --filter @graphgoblin/engine exec vitest run src/issue-167-scratch.test.ts
~~~

The test regenerates its scratch observations artifact and removes its own temporary restart JSON files. It starts no server and does not use the owner's live data.

## Expected behavior

A current-thread read should represent a consistent durable event-log prefix through the sequence read, including node.started counters even when the node then fails before completion. For these examples, both reads should report four starts of the failed node.

Use a verified checkpoint plus the remaining events, carrying its open-visit replay state, or replay from the initial thread when no trustworthy checkpoint exists. The read must not apply a patch for an unfinished node, advance iteration without an increment event, or change run status, outcomes, or delivery acknowledgments.

This issue concerns consistency of reads. It does not request changes to exit loop-back, decision routing, confidence handling, or #167's architecture.

## Affected code

- packages/engine/src/run-manager.ts:906 implements getThread; line 908 returns any snapshot without replaying the event tail.
- packages/engine/src/run-manager.ts:1329 records node.started; line 1343 increments the in-memory nodeVisits counter.
- packages/engine/src/run-manager.ts:1404 sends handler failures to failRun before normal completion saves the thread.
- packages/engine/src/run-manager.ts:1489 saves a normal completed-node snapshot.
- packages/engine/src/run-manager.ts:1707 implements failRun and records the terminal failure without saving that in-memory start count.
- packages/engine/src/run-manager.ts:1929 implements loadThread with verified checkpoints and event-tail replay for execution; its approach is a useful reference for a shared read projection.
- packages/domain/src/replay.ts:35 replays every node.started into nodeVisits and only applies completed patches.
- apps/api/src/routes/runs.ts:189 declares the current-thread route; line 200 returns manager.getThread.
- packages/engine/src/issue-167-scratch.test.ts:117 captures both read and replay results; line 125 characterizes the difference, and line 514 defines the two expression-failure scenarios.

## Suggested acceptance criteria

1. Add a focused engine regression test for each expression-failure example. Assert that current-thread reads equal replay through the captured durable sequence, including failed-node starts.
2. Preserve the completed work variables, attempts, logical iterations, terminal failure code/resumability, and lack of returns. Do not apply any unfinished-node patch.
3. Verify checkpoint-plus-tail replay with open visits, missing checkpoints, and stale or invalid checkpoint sequences. Reads must not double-apply completions or count starts twice.
4. Cover the real run-thread API over its repository implementation, including a failed run with a saved snapshot and later start/failure events. Keep the response schema-valid and consistent with the event projection.
5. Ensure reads do not append events, update statuses, deliver returns, or mutate snapshots as an unintended side effect. Repeated reads should give the same result when the log is unchanged.
6. Reuse verified checkpoints where possible so repeated current-thread reads need not replay an entire long run. Retain existing execution recovery semantics and repository quality gates.

No fix is included in this draft. The orchestrator should file it separately from the #167 owner decision comment.

