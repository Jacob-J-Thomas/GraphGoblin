# #410 failed-wait projection QA preparation

Prepared from main `f91bd69b79dc417a2997ddb9c7670cb33df7597c`. Root must review and separately bind the actual post-#381 integration baseline and final #410 candidate before execution. Syntax checks were the only executable verification in preparation. Use the controlling W1–W4 matrix and #410 brief. [Matrix](../runtime-381-410-native-preparation/plan.md) [Implementation brief](../runtime-410-implementation-brief.md)

## Execution tiers

Ordinary live cases and both ordinary restarts use the compiled gateway's `main()` in a fresh Node process. A thin wrapper reports the actual OS-assigned loopback address, own PID and Windows creation time from both writer locks after listen. The supervisor confirms that PID and the gateway's instance fingerprint through the real health route. Each readback uses real HTTP, compiled stdio MCP tools and direct read-only SQLite from the independent supervisor process. The gateway's local trusted mode is confined to the owned loopback listener. The fixture uses no user credentials, provider turns, owner store, owner service, 4747/4748, or browser.

W2's first process uses the real compiled container, clock and Fastify. Its harness registry is empty and timer pollers are disabled. A single armed intercept on the public RunRepository transition port applies only to the identified parent transition to failed and holds before the delegate. It forwards all other transitions to SQLite. The restart takes ordinary gateway startup. Native child Node evidence comes from the fixed local inline script, its per-store PID marker, and persisted script dispatch, exit code and stderr. The script refuses to write if the working directory and serving gateway data directory disagree.

The harness follows paged REST and stdio MCP lists with a fixture page bound. W1 forces multiple pages by running two parents from one published loop. It checks full REST/MCP get equality, the documented list fields, REST/MCP durable events, and raw SQLite row/event bytes. It records both IDs, the original child and input wait identities, and the original child `run.woken` payload. The parent's `child_run.finished` must match the child terminal sequence observed by the parent wake. The native child exit 7 produces `SCRIPT_EXIT_CODE` and preserves dispatch and recovery evidence through parent wrapping.

## W1 and W3 live matrix

1. Publish a parent manual → subloop → exit and child manual → input wait → local exit-7 script → exit. Start two parents. Observe real REST parent and child parks and compare the durable and public waits. Submit the observed child input `waitId` for just one pair.
2. Observe both failed runs finalized. Require one parent `run.failed`, the same failure in projection, linked child identity, park/wake/completion history and one script marker. Baseline expects the exact old parent SQL wait and matching public wait. Candidate expects SQL NULL and public omission in GET, paged REST listing, MCP `get_run` and `list_runs`.
3. Keep the second parent and child genuinely waiting across the other cases. Compare their raw rows and events before and after those runs.
4. Answer an independent successful child through its observed input wait. Verify one parent subloop completion, one exit entry, ordinary success and finalized wait-free state. A second submission against the consumed wait ID returns 409 `WAIT_MISMATCH` and leaves raw child rows/events equal.
5. Drive an authored Failure exit past its real input wait. It must report its outcome via `run.finished`, with finalized status and no current wait. Cancel the intentionally parked pair through the ordinary parent command and verify that both linked runs are finalized and wait-free. A separate pause/resume or recoverable-child variant is a focused check if an eventual patch touches those paths.

## W2 deliberate event-first interruption

W2 uses a separate file store. A separate child waits for input before a genuine local failing script. The supervisor verifies both parks and sends an arm request with the observed parent, child and wait IDs. The worker rechecks those identities before acknowledging the arm. The worker signals the exact failed projection transition and holds before delegating. The independent SQLite readback must establish the following.

- The original parent wait remains byte-identical and the projection is still `running`.
- `failure`, `finished_at` and `finalized_at` are still SQL NULL.
- One committed `run.failed` has the same failure as the gated transition, follows the matching child completion and is the last event. The projected thread checkpoint precedes its sequence.
- The original child is finalized, has the genuine exit-7 disposition and has one native script marker.
- The live worker health identity, exact child process handle, store and Windows lock creation time still match.

The supervisor closes and collects the independent SQLite observer, then writes `W2-verified-before-interruption.json`. Only then does it terminate the exact owned gated child handle. It records abrupt exit and pipe close, verifies the former listener refuses TCP, and saves DB/WAL/SHM presence, hashes and file identity before restarting. The ordinary gateway opens the same file, with the gate absent and a new process creation identity. The harness checks the unchanged database device/file identity, exact parent event rows and child row/events, one unchanged failure event and sequence, thread checkpoint at that sequence, finalization and no repeated child/script work. The parent wait must satisfy the phase-specific expectation.

An uncertain landing or unreachable gate leaves the matrix incomplete. The deliberate interruption depends on the saved proof. During failure cleanup the supervisor may send one labelled release so the owned process can settle through ordinary shutdown. It saves first evidence before that release. A managed release supplies no W2 crash witness. If a writer still has active runs, no verified origin, or cannot shut down cleanly, the harness records remaining process/store identities for the admission owner.

## W4 historical boundary

After genuine W1 baseline and W3 controls complete and writer and observers close, the harness makes a private seed from the exclusively probed SQLite store. If WAL and SHM are present, the full closed bundle is copied into fresh history-seed-staging and its source and copy hashes must match. A bounded child of the bound Node executable uses only the staging database and the compiled SQLite entry. It requires a successful truncate checkpoint and DELETE journal mode, then reads back the exact W1 parent and child rows and ordered event payloads. Their recorded raw values must match. The database-file hash can change during checkpointing. The normalization receipt records helper exit and pipe close, checkpoint and mode, exact witness equality, input and output hashes, and the absence of staged sidecars. A partial bundle or helper, hash, witness or inventory disagreement retains evidence. The seed already contains the finalized baseline parent and its stale wait. Baseline and candidate run W4 using separate SHA-verified copies of that seed. Both use real default gateway startup and compare the exact parent and child rows/events across reopen. W4 preserves the existing terminal projection. W1 and W2 exercise new transitions. No fixture writes a replacement historical failure row.

The baseline keeps exactly closed `private-history-seed/graphgoblin.db` as the transfer input for candidate W4. It is outside the report packet. The harness checks its literal path, absence of sidecars and SHA-256 before copying and after use. The W4 run copy is cleaned with the other owned stores. After the last admitted W4 and first-evidence decision, the orchestrator verifies the original seed hash, exact owner-process exit and exclusive access before unlinking only that regular file under the resolved private-seed path. Keep the W1 and W4 receipts.

## Later invocation and teardown

The orchestrator binds the exact source/index/build/fixture hashes, transitive build artifacts, project runtime and clean worktree. The runner uses only isolated `gg-*/GraphGoblin` worktrees and a fresh evidence basename under this directory. It writes the primary compiled path and hashes before application imports, requires exactly `--expose-gc` and refuses `NODE_OPTIONS`. Gateway and MCP child environments are allowlisted. The gateway web and Ollama integrations are off. The real store-lock implementation can use its bounded hidden Windows process-identity helper. Require exact runner/child supervision if native startup or teardown prevents the watchdog from running.

```powershell
$qaNode = 'C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64\node.exe'
$qaHarness = 'C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\runtime-410-native-preparation\run.mjs'
& $qaNode --expose-gc $qaHarness baseline '<admitted post-381 baseline checkout>' evidence-baseline-review
& $qaNode --expose-gc $qaHarness candidate '<admitted 410 candidate checkout>' evidence-candidate-review evidence-baseline-review
```

MCP closes on stdin EOF. Ordinary gateways verify their health identity, absence of active fixture runs and shutdown-control token before drain. Cleanup checks process exit, pipe closure and former-port refusal. The verified W2 gate is the only fixture-authored abrupt gateway termination. After closing the owned clients, cleanup performs two fixed GC passes followed by one hidden Windows exclusivity probe holding the verified disposable SQLite and script-marker paths simultaneously. It unlinks the exact known files and verifies an empty run-store directory. Unrecognized entries, lock files or a sharing disagreement stop cleanup and retain first evidence. Read `summary.json`, both W2 receipts, or any `first-failure.json` before scoring the matrix.

The first admitted execution observed W1 and W3, then stopped at the standalone seed guard with an exclusively accessible DB, WAL and SHM. Those original files and first-failure receipt remain sealed. The revised seed path has received syntax checks only. A fresh admitted execution must establish the seed normalization and W2/W4 observations. Candidate admission must recheck the port seam and build binding. See the first baseline report for the native evidence already obtained.
