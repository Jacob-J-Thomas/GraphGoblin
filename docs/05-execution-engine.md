# 05 - Execution engine

## Overview (Decided)

The engine is a small interpreter over a loop version. It walks the graph with one active token, calls a node handler per node, applies the returned patch to the context thread, follows the returned route, and appends everything it does to the run's event log. The event log is the only persistence the engine needs. The current thread, the current node, and the run status are projections over it.

The engine is pure TypeScript in `packages/engine`, written against the ports listed in 02, and must pass its full test suite with fake ports.

## Node handler contract (Decided)

```ts
interface NodeHandler<K extends NodeKind> {
  kind: K;
  execute(ctx: NodeContext<K>): Promise<NodeResult>; // returns when the node is done or parks
}

type NodeContext<K> = {
  node: NodeOfKind<K>;
  config: NodeOfKind<K>['config']; // already validated by contracts
  definition: LoopDefinition;
  thread: Readonly<ContextThread>;
  run: Readonly<RunRecord>;
  attempt: number; // 1 on first execution; higher after a park or a crash
  wake?: {
    reason: 'input' | 'timer' | 'signal' | 'child' | 'timeout' | 'manual';
    payload?: JsonValue;
  };
  previousWait?: WaitSpec; // what this node recorded when it parked
  signal: AbortSignal; // cancellation
  ports: EnginePorts;
  services: HandlerServices; // render, record events, resolve model, start child, read events, working directory, ids, clock
};

type NodeResult =
  | { kind: 'done'; patch: JsonPatch; route: string }
  | { kind: 'park'; patch: []; wait: WaitSpec } // wait, heartbeat, subloop: the run stops here and resumes later
  | {
      kind: 'exit';
      patch: JsonPatch;
      outcome: Outcome;
      reason: string;
      returnPayload?: JsonValue;
      channels: ReturnChannel[];
    }
  | { kind: 'loop-back'; patch: JsonPatch; targetNodeId: string };
```

Output ports are derived from the node's kind and config by `domain`, not declared by handlers. A parked node is resumed by calling `execute` again with `attempt` incremented, the wake reason and payload in `wake`, and its own earlier wait spec in `previousWait`. A parked node records no patch; everything it learned arrives through `wake` on the next execution. Handlers must therefore be written as "look at the context and decide what to do", never as "remember what I did last time in a closure".

## Run lifecycle (Decided)

```
queued --> running --> succeeded | failed | cancelled | exhausted
             |  ^
             v  |
           waiting   (wait, heartbeat, subloop child, timer)
             |  ^
             v  |
           paused    (operator intent, persisted)
```

| Transition                              | Caused by                                                | Persisted as                                                                        |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| queued to running                       | run manager picks it up                                  | `run.started`                                                                       |
| running to waiting                      | a node returns `park`                                    | `run.waiting` with the wait spec and a `timers` row or signal registration          |
| waiting to running                      | timer fires, signal or input arrives, child run finishes | `run.woken`                                                                         |
| running or waiting to paused            | operator pause                                           | `run.paused`; the current node is allowed to finish, then the token is not advanced |
| paused to running (or waiting)          | operator resume                                          | `run.resumed`; a run paused while parked goes back to waiting on the same wait      |
| any active to cancelled                 | operator cancel                                          | `run.cancel_requested` then `run.cancelled` once the node has stopped               |
| running to failed                       | an unavoidable or bug-class failure                      | `run.failed` with a failure object                                                  |
| running to succeeded, failed, exhausted | the exit node                                            | `run.finished`                                                                      |

Pause, cancel, and failure intents are persisted first and acted on second, so a process restart never loses them.

**The log is written first, the status second (Decided, WP-G review).** The event store and the
run record are separate writes. Wakes and terminal transitions, the ones a crash could lose or
duplicate, write their event first and their status second, and recovery completes a transition
whose event is durable but whose status write was lost. Operator commands between non-terminal
statuses (start, pause, resume of a paused run) write the status first and record their event
after it; losing that event in a crash loses only the audit record. Resuming a failed run leaves a
terminal status, so it is event-first like the rest: it clears the run's finalization marker,
appends `run.resumed`, then moves the status, and recovery completes a resume whose
`run.resumed` is durable (a resume that never reached the log never happened). Three mechanisms
make this safe:

- **Wakes are a conditional append.** `EventStorePort.append` accepts `expectedLastSeq` and
  refuses (`AppendConflictError`) when the log has moved. A wake (input, signal, timer, child)
  reads the log from the current wait's `node.started`, checks that the run is parked in the
  expected wait and nobody has woken it, and appends `input.received` (for an input) and
  `run.woken` together, conditional on the log being exactly as read; on a conflict it reads
  again. Of concurrent wakes exactly one is recorded, payload and all. Then the status moves
  from waiting to running. A crash in between leaves a durable wake on a waiting run, which
  recovery (or the next wake attempt) moves to running. A wake is consumed only when its node
  finishes or parks again: recovery markers such as `run.started` do not hide it.
- **Terminal events come before terminal status.** An exit appends its `node.finished` and
  `run.finished` in one append, carrying the outcome and result it computed; failure appends
  `run.failed` and cancellation `run.cancelled` before their status writes, and a terminal event
  already in the log is completed rather than recorded a second time (for example when a run's
  version is missing at recovery). At recovery a run whose log ends in such an event (not
  followed by `run.resumed` or `run.started`) gets its status from the event. Nothing is
  executed again, so an exit is never re-evaluated.
- **Finalization is recorded.** After a terminal status the engine drops the run's timers,
  cancels its children (when it was cancelled), delivers its returns (when it finished), wakes
  its parent, and only then marks the run finalized (`RunRepository.markFinalized`, column
  `finalized_at`). Each step is idempotent: returns are delivered per channel, skipping channels
  whose `return.delivered` or `return.failed` is already in the log. At boot the run manager
  finalizes every terminal run not marked finalized (`listUnfinalized`), so a crash right after
  the status write loses no return and leaves no child running. A channel interrupted
  mid-delivery is delivered again: returns are at least once. Migration `0002` marks runs that
  were already terminal as finalized. Finalization belongs to one terminal outcome: resuming a
  failed run clears the marker, so its next terminal outcome is finalized again. A child that
  cannot be cancelled (and is not terminal by then) leaves the parent unmarked, so the next
  recovery tries again.

Resume accepts paused runs or failures explicitly marked resumable; an exit with a failure
outcome is not a resumable node failure. A run paused while parked (or while parking) resumes
to `waiting` on the same wait, not by re-running its node: a wait keeps its deadline, a subloop
keeps its child. Its timers are re-armed and a child that finished meanwhile is delivered.

## Iterations and loop-back (Decided)

- The run's `iteration` starts at 1. Only an exit node's loop-back increments it.
- `counters.nodeVisits` increments every time a node starts, which lets decision nodes and exit criteria reason about repeats of a specific node.
- `settings.maxIterations` on the loop is a hard ceiling. When it is reached, the exit node's loop-back is ignored and the run finishes `exhausted`, even if no criterion said so.
- Harness-level turn limits are not a GraphGoblin concept. The loop's iteration limit is the only loop limit.

## Subloops as child runs (Decided)

A subloop node creates a child run with the mapped input thread and parks the parent with wait kind `child`. The child is a normal run: it has its own event log, pins its own version, can itself contain subloops up to the depth limit, and is visible in the run list with a parent link. When it finishes, the parent is woken with the child's outcome and return payload, and the subloop handler applies the output mapping. Cancelling a parent cancels its children. Cancelling a child alone wakes the parent with outcome `cancelled`.

**Which version a child runs (Decided, WP-G).** A `latest` reference resolves when the parent run is _created_, not when the subloop node runs. `startRun` walks every subloop reference reachable from the run's version, through the referenced loops' own subloop nodes at any depth, pins each `latest` loop to the version published at that moment, and records the map (loop id to version id) on the run's `run.queued` event as `subloopVersions`. Numbered references are immutable and need no pin, but are walked for their own references. Every child the run starts uses its pin, so a version published while the parent waits never reaches it. A child inherits its parent's pins and records them on its own `run.queued`, so a whole tree of runs sees one snapshot; a replay fork copies its source's pins; recovery reads them from the log like everything else. A reference that does not resolve at creation is left unpinned and fails with `SUBLOOP_NOT_FOUND` when the child would start, as before; a run whose log predates pinning resolves `latest` when the child starts. A pinned version that is gone or no longer published fails the subloop with `SUBLOOP_NOT_FOUND`; it never falls back to latest. Deleting a loop is refused (409 `LOOP_IN_USE`) while any active run (queued, running, waiting, or paused) can still start it: a run of that loop, or one whose pins or subloop references reach it (`RunManager.loopInUse`). The check and the deletion run in one critical section with the subloop pinning in `startRun` (`RunManager.deleteLoopUnlessInUse`), together with replay-fork admission and a re-check that a new run's own version still exists, so a parent or fork created concurrently either pins the loop first (the deletion then refuses) or is created after it (and fails at that subloop like any reference to a deleted loop). A run or fork whose own version was deleted meanwhile is refused with `LOOP_NOT_FOUND`. The check reads only the first event (`run.queued`, with the pins) of each active run, plus the versions its pins reach.

**A child that finishes before its parent parks (Decided, WP-G).** The parent records its `waiting/child` state after the subloop handler has started the child, so a fast child can finish while the parent is still `running`; its notification then finds no waiting parent. After the parent's park transition the run manager therefore checks the child, and wakes the parent at once if the child is already terminal; recovery does the same for every parent waiting on a child. Both paths and the child's own notification go through the waiting-to-running compare-and-set, so exactly one wins. A wake that lands while the parent's executor is still returning is queued until it has returned rather than dropped.

## Parallel runs (Decided)

Every trigger firing starts a new run. Runs of the same loop execute concurrently with no coordination. The run manager caps overall concurrency with a worker pool sized by setting, default 4, with parked runs not counting against it. A per-loop concurrency policy is post-1.0 and will be a loop setting.

## Cancellation (Decided)

Cancellation is cooperative and persisted. The API writes `cancelRequestedAt`, appends `run.cancel_requested`, and signals the in-process abort controller. Handlers observe the abort signal: the harness adapter cancels the session and kills the subprocess tree, the script port kills the process tree, waits and heartbeats drop their timers. Once the handler returns or throws with an abort, the engine appends `run.cancelled` and then moves the status. Children are cancelled after the parent is terminal. A restarted process scans for runs with a cancel request and no `run.cancelled` event and completes the cancellation.

The request itself is a compare-and-set (`RunRepository.claimCancel`): `cancelRequestedAt` is written only when it is unset and the run is active. Of concurrent cancels, one records `run.cancel_requested`; the others return the run as it is without appending anything. A cancel that loses to the run finishing is an `INVALID_STATE` error, as a cancel of a terminal run always was.

## Crash recovery (Decided)

**One run manager per store.** There is no execution lease: two run managers over the same database would both pick up a queued or recovered run and execute it twice (the review demonstrated a doubled inference). 1.0 runs one API process with one run manager per data directory; a lease belongs with the post-1.0 hosted work (11).

At boot the run manager loads every run in `queued`, `running`, `waiting`, or `paused` status:

- Terminal runs never marked finalized: finalized now (timers, children, returns per channel, parent; see "Finalization is recorded").
- Any of them whose log ends in a terminal event: completed from the log (above), nothing executed.
- `waiting` with a durable wake in the log: moved to running, so the woken node runs.
- Other `waiting` runs: re-arm the wait's timers from its wait spec, both of them when a wait has two (`until` under key `timer` or `heartbeat`, `timeoutAt` under key `timeout`; an input or signal wait written before `timeoutAt` existed uses `until`), as an upsert so an armed timer is unchanged; and wake a parent whose child is already terminal. Signals and inputs need nothing.
- `running`: the executor starts from the log. The thread is the last verified checkpoint plus the events after it (see "Event log and projections"), and the cursor is checked against the log: when the log's last node event is the `node.finished` of the node the run record still points at, that node completed and only the cursor write was lost, so the cursor advances along the route it recorded (an exit's loop-back goes to its target, at the iteration recorded in the same append) without running the node again. Otherwise the last `node.started` without a matching `node.finished` identifies the interrupted node. Recovery depends on its kind.
  - Inferencing: the `harness_sessions` row was written before the subprocess started, so the handler resumes that session and asks it to continue. If the session was never started, it starts fresh.
  - Script: re-executed. Scripts are documented as at-least-once.
  - Decision, mutation, exit: re-executed. They are deterministic given the thread, except Jev and Codex-backed decisions, which are simply asked again. (An exit whose `run.finished` is durable is completed from the log instead.)
  - Subloop: if the visit already recorded `child_run.started`, the handler re-parks on that child, or maps its outcome if it has finished; otherwise it creates the child. A crash between creating the child and recording `child_run.started` can still leave an orphan child and start a second one; closing that needs the child id allocated before the child is created.

Recovery is automatic and silent apart from a `node.started` event with `attempt` incremented.

## Resiliency model (Decided)

Resiliency is built into the engine. Users do not model it. Failures fall into four classes.

| Class                    | Examples                                                                                                                                                                | Engine behaviour                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient infrastructure | SQLite busy, Jev network blip, outbound webhook 503                                                                                                                     | Internal retry with backoff, bounded, logged. Invisible to the loop.                                                                                                                                |
| Harness-internal         | Model errors, tool failures inside a Codex turn                                                                                                                         | Delegated entirely to Codex. GraphGoblin does not retry turns.                                                                                                                                      |
| Unavoidable              | Subscription exhausted, login expired, harness not installed, working directory missing, script exits non-zero without a route, schema repair exhausted with `fail-run` | Run moves to `failed` with a typed, human-readable reason and `resumable: true`. The operator fixes the cause and resumes from the failed node.                                                     |
| Bug                      | A handler throws anything else                                                                                                                                          | Run moves to `failed` with `resumable: true`, full diagnostics in the event, and the error is surfaced prominently. This is a defect to fix in GraphGoblin, never a case for users to route around. |

Resuming a failed run re-executes the failed node using the crash-recovery rules above.

## Timeouts (Decided minimal)

Optional `timeoutSeconds` exists on inferencing and script nodes and on wait and heartbeat nodes through their own fields. Defaults are none. A timed-out inferencing or script node is an unavoidable failure. A timed-out wait or heartbeat follows its `onTimeout` setting.

## Event log and projections (Decided)

- Events are appended with a monotonically increasing `seq` per run, atomically per append (several events in one append are stored together or not at all). The event store and the run record are separate writes: events go first and recovery completes the status (see "The log is written first" above).
- The first event, `run.queued`, carries the run's initial thread as `initialThread`: the `run` and `invocation` blocks plus, for a subloop child, the seed the parent mapped in. Replaying `node.finished` patches over it reproduces the thread at any event without any other source (the run inspector does exactly this). Logs written before the field existed lack it; readers then start from the thread's `run` and `invocation` with empty collections. Size: the initial thread is the trigger payload (bounded by the request body limits, 8 MB for the API and 1 MB for webhooks) plus, for a child, the seed the subloop mapping selected from the parent thread; it is written once per run, next to the `runs` row's own copy, and has no separate cap in 1.0. Offloading it to the artifact store above a threshold (with a reference on the event) is the follow-up if large seeds appear in practice.
- The thread projection replays `node.finished` patches (a `node.finished` is applied only when it completes the open visit, the node most recently started and not yet finished; a second record of the same completion, immediate or delayed, is applied once), `iteration.incremented`, and `node.started` visit counts. **Verified checkpoints:** the executor saves the thread snapshot together with the `seq` of the event it reflects, always after that event is durable (`RunRepository.saveThread(runId, thread, seq)`, column `thread_snapshot_seq`). At every executor start it loads the checkpoint and, when its `seq` is in the log, replays only the events after it, carrying over the visit open at the checkpoint so a duplicate completion straddling it is still applied once; a snapshot without a `seq`, or one the log does not reach, is ignored and the thread is replayed from the initial thread. A run resumed after 10,000 completions replays only what follows its last checkpoint.
- Replay also counts `node.started` events, including resumed attempts, in `counters.nodeVisits`. Recovery reconstructs a pending wake before appending its new `run.started`, so an accepted input is still available to the resumed node.
- The SSE stream (07) is a tail of the same log, which is why reconnecting clients can resume from a sequence number without loss.
- Large payloads such as transcripts, full probe responses, and return payloads above a size threshold are stored as artifacts on disk, keyed by content hash, and referenced from events.

## Replay and debugging (Decided by implementation, 2026-10-03)

Because every node input is reconstructible, the API offers "re-run this node with the same input", producing a new run forked at that node. This is the intended debugging tool, in place of error nodes. `RunManager.replay({ runId, nodeId, source?, caller? })`, exposed as `POST /runs/{id}/replay` and the MCP tool `replay_run`:

- **The source may be in any status**, including running or waiting; it is never modified. It must have a `node.started` event for `nodeId`, otherwise the request fails with `REPLAY_NODE_NOT_REACHED` (409). The node must still exist in the pinned version (drafts are edited in place), otherwise `INVALID_STATE`.
- **The fork's thread** is the source's initial thread replayed (`replayThread`) up to the event just before the node's _first_ `node.started`: every earlier `node.finished` patch and `iteration.incremented`, with `counters.nodeVisits` counted from the earlier `node.started` events. `run.id` is the fork's id; `run.parentRunId` is dropped, so forking a child run gives a top-level run that never wakes the original parent.
- **The invocation** keeps the trigger envelope (node, kind, payload, `receivedAt`, dedupe key) and gets a fresh id and `replayOf: { runId, nodeId }`. Source and caller are those of whoever asked for the replay (the API passes them; the engine keeps the source's when none are given). The source's `returnDefaults` are dropped: they belong to the source's caller. Return channels declared on exit nodes still deliver.
- **The fork** is a new run on the same loop version with its own id and event log, created `queued` with `currentNodeId` set to the node and `iteration` from the thread, so the executor starts there. Its first event is `run.queued` with `replayOf`. Nothing before the node is re-executed, and the source's child runs are not copied: a subloop node in the fork starts a new child.
- **Harness sessions are not carried over.** A node that resumes "the previous session" of its run finds none in the fork and starts fresh; named sessions (`resume-named`) are looked up by scope key and still resume. Files the source wrote into a per-run working directory are not copied.

## Implementation notes from M2 (Decided by implementation, 2026-10-02)

- **Status changes are compare-and-set.** `RunRepository.transition(runId, fromStatuses, changes)` applies a change only when the current status is one of the expected ones. Start, park, wake, pause, resume, finish, fail, and cancel all go through it, so a pause that lands while the executor is starting a run is never clobbered.
- **Pause is allowed on queued runs** as well as running and waiting ones. A paused queued run has no `startedAt`; its first execution after resume records `run.started`.
- **Wake payloads live in the log.** The executor finds the pending wake by scanning back from the end of the log to the last `run.woken`, stopping at `node.finished` or `run.waiting` (a recovery `run.started` does not consume it; see "The log is written first"). Nothing about a wake is held in memory, which is what makes crash recovery trivial.
- **Attempts are counted from the log** too: the number of `node.started` events for the node since its last `node.finished`, plus one.
- **Parent cancellation marks the parent terminal before cancelling children**, so a child's cancellation does not wake the parent.
- **Subloop results land in `lastOutput` as `{ status, outcome, result, childRunId }`**, so a following decision node can branch on the child's outcome, not only its payload. `resultTo.var` stores the bare result.
- **Wait inputs become `user` messages tagged `input`; signals become `note` messages tagged `signal`.** Timeouts that continue set `lastOutput` to `{ timedOut: true }`.
- **Heartbeat outputs** are `{ beat, probe, satisfied: true }` when the condition holds and `{ beat, probe, exhausted: true }` when it runs out and is configured to continue.
- **Inference recovery resumes the recorded session** with a continuation prompt when a node is re-executed with `attempt > 1` and a session id is on file.
- **Return channels merge** the exit node's list with any `returnDefaults` the caller supplied on the invocation, de-duplicated.

## Implementation notes from WP-D2 (Decided by implementation, 2026-10-03)

- **Model and effort resolve node, then loop defaults, then owner settings, then configuration.** `EngineSettings.ownerDefaults(ownerId)` is read every time a run starts or resumes; the API reads the owner settings `defaultModel` and `defaultEffort` there, so a change in Settings applies to the next run without a restart. `GG_DEFAULT_MODEL` and `GG_DEFAULT_EFFORT` remain the last fallback.
- **The executor yields to the event loop between nodes** (one `setTimeout(0)` per node). With fast ports every await settles as a microtask, and a graph cycle (a decision routing back to itself) used to starve timers, API requests, and the cancel request that could stop it. Such a cycle is still unbounded: it runs until cancelled, because `maxIterations` counts only exit loop-backs (open question in 13).

## Implementation notes from WP-G (Decided by implementation, 2026-10-03)

The adversarial design review (`docs/qa/2026-10-03-adversarial-design-review.md`) found eight open defects; WP-G closed them. The rules they settle are in the sections above; in short:

- **Subloop versions are pinned at parent creation** (ADV-004), transitively, and recorded on `run.queued` as `subloopVersions`.
- **Timers are delivered at least once** (ADV-011). `TimerService` removes a timer only after every listener handled it without throwing, and only while the row still has the fired time (a listener that re-armed the key keeps its new timer); a listener error leaves it for the next poll, and a service with no listener consumes nothing. Timer keys carry the wait identity (`timer@<startedSeq>`, where `startedSeq` is the seq of the `node.started` that parked, recorded on the wait spec), and the wake is a conditional append checked against that wait, so a stale or repeated fire cannot wake a later wait. Recovery and resume re-arm both deadlines of a wait (`until`, `timeoutAt`). A bare key (armed before identities existed) only wakes a wait without an identity; at recovery such a wait gets its identity from the log (the `node.started` before its `run.waiting`), the record is updated, and its bare timers are replaced by keyed ones. Residual: a pre-upgrade duration wait with a separate timeout has no `timeoutAt`, so only its own timer is re-armed.
- **Cancel requests are claimed once** (ADV-012).
- **A fast child cannot orphan its parent** (ADV-015).
- **The log is the source of truth** (ADV-016 and the WP-G review): events are written before status, wakes and terminal outcomes are completed from the log at recovery, the cursor follows a durable `node.finished`, and the thread comes from a verified checkpoint plus the events after it.
- **Expression regexes are checked statically** (ADV-007). The JSONata time budget is cooperative: it is checked at evaluator entry and exit, which a native regex match never returns to. So every regex literal in an expression, and every `redact` and `replace` mutation pattern, is rejected before it runs when it contains a back-reference, a repeated group containing another repetition, or a repeated group whose body can match the empty string or split the same text two ways (overlapping alternatives, or an optional part overlapping what follows it), looking through nested groups without their own repetition. JSONata's `$eval`, which compiles a string at run time, is shadowed by a binding that first compiles the string through the same check and then hands it to JSONata's own `$eval`, so it keeps the caller's lexical variables and functions and shares the caller's depth and deadline budget (an expression then fails to compile, which loop validation reports as `EXPRESSION_INVALID`; a mutation pattern fails its node when it runs). Ordinary patterns (`^\w+@\w+\.com$`, `\d{4}-\d{2}`, `(foo|bar)+`) are unaffected. Polynomial backtracking and memory are not bounded in-process; see 11.

## Why no error ports (Decided, see ADR-0006)

An error port makes every loop author responsible for failure handling and spreads failure semantics across every graph. The owner's position is that infrastructure failures are the platform's job, inference failures are the harness's job, and the remaining cases are either unavoidable conditions to fix and resume or bugs to fix. Explicit error or debug nodes stay on the post-1.0 list and will only be added if run inspection and node replay prove insufficient.
