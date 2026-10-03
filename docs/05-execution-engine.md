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
| paused to running                       | operator resume                                          | `run.resumed`                                                                       |
| any active to cancelled                 | operator cancel                                          | `run.cancel_requested` then `run.cancelled` once the node has stopped               |
| running to failed                       | an unavoidable or bug-class failure                      | `run.failed` with a failure object                                                  |
| running to succeeded, failed, exhausted | the exit node                                            | `run.finished`                                                                      |

Pause, cancel, and failure intents are persisted first and acted on second, so a process restart never loses them.

Input acceptance uses the waiting-to-running compare-and-set before recording
`input.received` and `run.woken` together. A losing concurrent input command records
neither event. Resume accepts paused runs or failures explicitly marked resumable;
an exit with a failure outcome is not a resumable node failure.

## Iterations and loop-back (Decided)

- The run's `iteration` starts at 1. Only an exit node's loop-back increments it.
- `counters.nodeVisits` increments every time a node starts, which lets decision nodes and exit criteria reason about repeats of a specific node.
- `settings.maxIterations` on the loop is a hard ceiling. When it is reached, the exit node's loop-back is ignored and the run finishes `exhausted`, even if no criterion said so.
- Harness-level turn limits are not a GraphGoblin concept. The loop's iteration limit is the only loop limit.

## Subloops as child runs (Decided)

A subloop node creates a child run with the mapped input thread and parks the parent with wait kind `child`. The child is a normal run: it has its own event log, pins its own version, can itself contain subloops up to the depth limit, and is visible in the run list with a parent link. When it finishes, the parent is woken with the child's outcome and return payload, and the subloop handler applies the output mapping. Cancelling a parent cancels its children. Cancelling a child alone wakes the parent with outcome `cancelled`.

**Which version a child runs (Decided, WP-G).** A `latest` reference resolves when the parent run is _created_, not when the subloop node runs. `startRun` walks every subloop reference reachable from the run's version, through the referenced loops' own subloop nodes at any depth, pins each `latest` loop to the version published at that moment, and records the map (loop id to version id) on the run's `run.queued` event as `subloopVersions`. Numbered references are immutable and need no pin, but are walked for their own references. Every child the run starts uses its pin, so a version published while the parent waits never reaches it. A child inherits its parent's pins and records them on its own `run.queued`, so a whole tree of runs sees one snapshot; a replay fork copies its source's pins; recovery reads them from the log like everything else. A reference that does not resolve at creation is left unpinned and fails with `SUBLOOP_NOT_FOUND` when the child would start, as before; a run whose log predates pinning resolves `latest` when the child starts.

**A child that finishes before its parent parks (Decided, WP-G).** The parent records its `waiting/child` state after the subloop handler has started the child, so a fast child can finish while the parent is still `running`; its notification then finds no waiting parent. After the parent's park transition the run manager therefore checks the child, and wakes the parent at once if the child is already terminal; recovery does the same for every parent waiting on a child. Both paths and the child's own notification go through the waiting-to-running compare-and-set, so exactly one wins. A wake that lands while the parent's executor is still returning is queued until it has returned rather than dropped.

## Parallel runs (Decided)

Every trigger firing starts a new run. Runs of the same loop execute concurrently with no coordination. The run manager caps overall concurrency with a worker pool sized by setting, default 4, with parked runs not counting against it. A per-loop concurrency policy is post-1.0 and will be a loop setting.

## Cancellation (Decided)

Cancellation is cooperative and persisted. The API writes `cancelRequestedAt`, appends `run.cancel_requested`, and signals the in-process abort controller. Handlers observe the abort signal: the harness adapter cancels the session and kills the subprocess tree, the script port kills the process tree, waits and heartbeats drop their timers. Once the handler returns or throws with an abort, the engine appends `run.cancelled`. Children are cancelled first. A restarted process scans for runs with a cancel request and no `run.cancelled` event and completes the cancellation.

The request itself is a compare-and-set (`RunRepository.claimCancel`): `cancelRequestedAt` is written only when it is unset and the run is active. Of concurrent cancels, one records `run.cancel_requested`; the others return the run as it is without appending anything. A cancel that loses to the run finishing is an `INVALID_STATE` error, as a cancel of a terminal run always was.

## Crash recovery (Decided)

At boot the run manager loads every run in `running` or `waiting` status:

- `waiting`: re-arm the wait's timer from its wait spec (`until`: key `timer` or `heartbeat` for those waits, `timeout` for an input or signal wait with a timeout; an upsert, so an armed timer is unchanged), and wake a parent whose child is already terminal. Signals and inputs need nothing.
- `running`: the executor starts from the log. The thread is always replayed from the initial thread (never the snapshot, which can lag a crash), and the cursor is checked against the log: when the log's last node event is the `node.finished` of the node the run record still points at, that node completed and only the cursor write was lost, so the cursor advances along the route it recorded (an exit's loop-back goes to its target, appending the `iteration.incremented` if that was lost too) without running the node again. An exit node that finished without a route (the run was finishing) is evaluated again; its patch is empty and `run.finished` is still written once. Otherwise the last `node.started` without a matching `node.finished` identifies the interrupted node. Recovery depends on its kind.
  - Inferencing: the `harness_sessions` row was written before the subprocess started, so the handler resumes that session and asks it to continue. If the session was never started, it starts fresh.
  - Script: re-executed. Scripts are documented as at-least-once.
  - Decision, mutation, exit: re-executed. They are deterministic given the thread, except Jev and Codex-backed decisions, which are simply asked again.
  - Subloop: if the child exists, re-park and subscribe; otherwise create it.

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

- Events are appended with a monotonically increasing `seq` per run, in one transaction with any state change they imply.
- The first event, `run.queued`, carries the run's initial thread as `initialThread`: the `run` and `invocation` blocks plus, for a subloop child, the seed the parent mapped in. Replaying `node.finished` patches over it reproduces the thread at any event without any other source (the run inspector does exactly this). Logs written before the field existed lack it; readers then start from the thread's `run` and `invocation` with empty collections. Size: the initial thread is the trigger payload (bounded by the request body limits, 8 MB for the API and 1 MB for webhooks) plus, for a child, the seed the subloop mapping selected from the parent thread; it is written once per run, next to the `runs` row's own copy, and has no separate cap in 1.0. Offloading it to the artifact store above a threshold (with a reference on the event) is the follow-up if large seeds appear in practice.
- The thread projection replays `node.finished` patches and wake payloads. It is cached per run in memory and rebuilt on demand.
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
- **Wake payloads live in the log.** The executor finds the pending wake by scanning back from the end of the log to the last `run.woken`, stopping at `node.finished`, `run.waiting`, or `run.started`. Nothing about a wake is held in memory, which is what makes crash recovery trivial.
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
- **Timers are delivered at least once** (ADV-011). `TimerService` removes a timer only after every listener has run, and only while the row still has the fired time (a listener that re-armed the key keeps its new timer); a service with no listener consumes nothing. Recovery re-arms each waiting run's timer from its wait spec. Because a fire can repeat, the run manager's timer listener is idempotent: the wake is a compare-and-set, and a `timer` or `heartbeat` key only wakes a wait of that kind, so a stale fire cannot wake a later, different wait.
- **Cancel requests are claimed once** (ADV-012).
- **A fast child cannot orphan its parent** (ADV-015).
- **The log is the source of truth for the cursor and the thread at every executor start** (ADV-016). The status write and the event append are still separate writes; the recovery rules above make each crash gap between them safe instead of making them one transaction.
- **Expression regexes are checked statically** (ADV-007). The JSONata time budget is cooperative: it is checked at evaluator entry and exit, which a native regex match never returns to. So every regex literal in an expression, and every `redact` and `replace` mutation pattern, is rejected before it runs when it contains a back-reference, a repeated group containing another repetition, or a repeated group whose alternatives can start with the same character (an expression then fails to compile, which loop validation reports as `EXPRESSION_INVALID`; a mutation pattern fails its node when it runs). Ordinary patterns (`^\w+@\w+\.com$`, `\d{4}-\d{2}`, `(foo|bar)+`) are unaffected. Polynomial backtracking and memory are not bounded in-process; see 11.

## Why no error ports (Decided, see ADR-0006)

An error port makes every loop author responsible for failure handling and spreads failure semantics across every graph. The owner's position is that infrastructure failures are the platform's job, inference failures are the harness's job, and the remaining cases are either unavoidable conditions to fix and resume or bugs to fix. Explicit error or debug nodes stay on the post-1.0 list and will only be added if run inspection and node replay prove insufficient.
