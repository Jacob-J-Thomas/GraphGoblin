# Competing-wake investigation (#225 / B21)

**Result: not reproduced.** This is a bounded negative result, not proof that every
possible interleaving is safe. Executed on 2026-10-19 at
`9070207ee11b86c31aee54a911ff3d16992fc67f` (main including WP-C2 / PR #357), Windows,
Node `v22.14.0`. No corrective production or maintained-test change was made.

## Hypothesis and method

Two independent wake sources for one run might both pass the waiting check, lose
an accepted payload, duplicate a completion, or let a wake observed at visit A
affect visit B. In particular, `wake` retries its conditional event append; a
caller without an expected visit could reread a newer park during that retry.

The probes use public `RunManager` commands, API loop creation/publication, real
file-backed SQLite repositories, and the real `TimerService`. A fake clock moves
deadlines; automatic pollers are disabled and the public `timers.poll()` performs
delivery. Both supported example polling settings, 50 and 1,000 ms, are configured.
This tests delivery ordering, not elapsed scheduler latency. No engine/private
method was called, replaced, paused or exported for these probes. No provider
turns were made. Restart cases close the store and reopen it in a **fresh Node
process**; they are orderly restarts, not hard-kill/parking-window experiments.

## Scenarios and observations

Counts below are **per polling setting**. Raw run IDs, wake sequences, accepted
payloads, refusals and restart process IDs are in
[results.json](2026-10-18-wp-c3-evidence/results.json) and
[fast-child.json](2026-10-18-wp-c3-evidence/fast-child.json).

| Scenario                                               | Exact sequence / attempts per setting                                                                                                                                                             | Observed result                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input before timeout, negative control                 | Park input wait with 1 s timeout; answer; advance 1 s; poll. 10 runs.                                                                                                                             | Input wins 10/10; one input event, one wake and one wait completion.                                                                                                                                                                                                                  |
| Timeout before input, negative control                 | Same wait; advance 1 s; await poll; submit original input. 10 runs.                                                                                                                               | Timeout wins 10/10; input returns `WAIT_MISMATCH`; no input event; one wake/completion.                                                                                                                                                                                               |
| Concurrent timeout and input                           | Advance 1 s; `Promise.allSettled([input(), poll()])`, then reversed call order. 10 runs each.                                                                                                     | Input wins all 20; one wake/completion each, exact winning payload returned. Reversing invocation order did not produce a timeout winner in this unpaused schedule.                                                                                                                   |
| Two matching signals                                   | Park named-signal wait; send payloads 1 and 2 concurrently, then reverse their invocation order. 10 runs each.                                                                                    | One accepted signal and one `WAIT_MISMATCH` per run; one `signal.received`, one wake; result equals winner's payload.                                                                                                                                                                 |
| Nonmatching/filtered signals, negative control         | Send wrong name, matching name with failing filter, then passing signal. 1 run.                                                                                                                   | First two recorded without waking; third wakes once; all three signal events retained.                                                                                                                                                                                                |
| Old visit after a new wait                             | Answer input A; await input B at a different node; send A's input and signal identities; advance A's old deadline and poll; finally answer B. 1 run.                                              | Both stale commands refuse with `WAIT_MISMATCH`; event log unchanged by refusals/poll; B requires its own answer. Old timer was cancelled, so this does **not** claim a stale timer delivery occurred.                                                                                |
| Timeout race followed by child timer/completion        | Parent input wait with 1 s timeout; race input/poll at deadline; parent parks on duration-wait child; advance child's 1 s deadline; race poll with a non-waking signal append to parent. 20 runs. | Initial input wins 20/20; child timer completes child; parent has exactly one input wake and one child wake, one child run, and succeeds. No conflicting non-waking signal append was demonstrated.                                                                                   |
| Immediate-child control (winner unobserved)            | Child is trigger directly to exit; parent subloop leads to input wait. Five batches of ten concurrent parents under default global capacity 4.                                                    | All 50 parents stay at the input wait with exactly one child wake and one child. Real input then succeeds with exactly two total wakes and the supplied result. No old child wake consumed the input visit. This does not establish that post-park reconciliation won.                |
| Restart, due timer and caller-pending signal           | Persist a named-signal wait with 1 s timeout; close store; fresh process starts at +2 s; race public timer poll with signal carrying the persisted identity. 1 run.                               | Timeout wins; pending caller receives `WAIT_MISMATCH`; one wake and no accepted signal event. There is no durable matching-signal inbox here: “pending” means held by the caller until restart.                                                                                       |
| Restart with durable signal observation                | Park signal-count heartbeat; record one non-waking signal; close store; fresh process starts at +2 s and polls its overdue timer. 1 run.                                                          | Signal event survives; heartbeat condition `probe.count >= 1` completes; one timer wake, no duplicate signal.                                                                                                                                                                         |
| Child completion plus timer **on the same child park** | Source admission check, not an executed race.                                                                                                                                                     | Current subloop parks have `childRunId` but no authored `until`/`timeoutAt`. Ordinary handlers cannot arm a timer for that park. The adjacent-visit/child-timer scenarios above are the available production paths; no parent timer was fabricated to claim a same-park reproduction. |

Across the 80 timer/input runs, 40 matching-signal runs, 40 timed-child runs and
100 immediate-child runs, no accepted payload was lost, no completion duplicated,
and no wake applied to the wrong observed visit. These counts include ordered
controls, not just simultaneous calls. They do not establish that every possible
event-loop/SQLite schedule occurred.

## Existing controls and constructed evidence

The unchanged `packages/engine/src/handlers/waiting.test.ts` and
`packages/engine/src/adversarial.test.ts` passed **57 tests**. This preserves
concurrent-input `ADV-001`, durable-wake recovery `ADV-002`, stray-timer,
input/signal/filter/timeout and child-completion controls. The existing
`ADV-015` before-park tests intercept repository transitions, and its recovery
case directly stages child status: those are **constructed controls**, not new
natural reproductions. They are retained unchanged and are not counted above.

The unchanged API `wait-identity.test.ts` and `poll-items.test.ts` passed all
**39 tests**, but their command exited 1 during global teardown with
Windows `EBUSY` unlinking a temporary C2 `store.db`. The command was not retried.
See [verification.txt](2026-10-18-wp-c3-evidence/verification.txt).

## Comparison with WP-C2 and what remains open

Historical source at `aef7efd` already used conditional event appends and
`startedSeq`-keyed timer wakes. Its `provideInput` and `signal` callers could not
name the observed wait, signals were appended separately, and status
acknowledgements were not visit-fenced. This is a **source/history comparison**;
no pre-C2 runtime was executed and no comparison worktree was needed.

WP-C2 makes `waitId` mandatory for input/signals, binds matching signal receipt
and wake atomically, guards the status transition by identity, and arms timers
after a durable park. Its independent
[QA record](2026-10-19-wp-c2-qa.md) separately records same-node revisits, stale
answers, native hard restarts, paused deadlines and constructed parking/fault
boundaries; those historical results are not represented as rerun here. These
mechanisms address external-input/signal cross-visit intent and timer identity;
they do not turn this negative competing-wake investigation into a proven fix.

The per-run lock at `run-manager.ts:601` serializes finalization and failed-run
resume. Wake exclusion comes from `expectedLastSeq`, the parked-event check and
the guarded status transition, not a lock around all wake callers.

**Still open:** `notifyParent` at `run-manager.ts:1869` checks the child's identity
before calling `wake` at line 1884, but omits the parent's `waitId`. A delayed
notification/conditional-append retry is consequently not bound end-to-end to
the park it inspected. The immediate-child runs did not reproduce a crossing.
#242 (awaited subloops) owns the identity-bound child wake; no speculative repair
is made here. Matching-signal idempotency keys are outside this result. The
independent review's natural and constructed evidence is distinguished below.

## Independent review evidence

Source: the independent Claude Opus 5.5 review, Task 2 (natural scenarios), supplied in the
round-two brief. These are reviewer observations, not experiments rerun by this
worker. The review approved #225 as bounded closing evidence with these
corrections, not as proof that the child-wake path is fully fenced.

| Natural review scenario | Workload                                                                  | Result              |
| ----------------------- | ------------------------------------------------------------------------- | ------------------- |
| H1                      | 180 parents looping back to one subloop node; 820 child completions       | No natural crossing |
| H2                      | 60 parents; 874 signals and 874 mismatched inputs during child completion | No natural crossing |
| H3                      | 32 hard kills over 192 parents and 512 child visits                       | No natural crossing |
| H4                      | 60 parents through 4,308 pause/resume cycles                              | No natural crossing |
| H5                      | 40 runs; 240 concurrent answers carrying an earlier wait ID               | No natural crossing |

Across approximately 1,572 child completions, the review observed no natural
crossing. In its 420 inspected parks, child completion followed the park event
every time: the immediate-child experiment does not establish that post-park
reconciliation ever won. The timed-child experiment likewise does not establish
that its non-waking signal append conflicted with the child notification's wake.

**Constructed only (review finding N1):** delaying one parent re-read inside `wake()` called from
`notifyParent` let a stale child wake reach a later input park or the next visit
of the same subloop node. That forced internal delay is not a natural production
reproduction. The review requires #242 to pass the parent's observed `waitId`
from `notifyParent`, require a child wake to match `parked.wait.kind === 'child'`
and `childRunId`, and have the subloop handler refuse an outcome from a child
that has not finished.

## Reproduction and delivery

[Driver source](2026-10-18-wp-c3-evidence/driver.mjs.txt),
[fast-child driver](2026-10-18-wp-c3-evidence/fast-child.mjs.txt),
[commands/results](2026-10-18-wp-c3-evidence/verification.txt), and the
[environment/store manifest](2026-10-18-wp-c3-evidence/environment.json) are
retained. For #225, only QA documents/evidence are delivered; engine wake code
and its maintained tests remain unchanged. The separate #140 round-two fix
changes poll validation/admission and its tests and docs. Disposable stores are closed and retained for
orchestrator cleanup; the owner app/store was not used.
