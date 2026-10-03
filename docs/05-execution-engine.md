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

## Iterations and loop-back (Decided)

- The run's `iteration` starts at 1. Only an exit node's loop-back increments it.
- `counters.nodeVisits` increments every time a node starts, which lets decision nodes and exit criteria reason about repeats of a specific node.
- `settings.maxIterations` on the loop is a hard ceiling. When it is reached, the exit node's loop-back is ignored and the run finishes `exhausted`, even if no criterion said so.
- Harness-level turn limits are not a GraphGoblin concept. The loop's iteration limit is the only loop limit.

## Subloops as child runs (Decided)

A subloop node creates a child run with the mapped input thread and parks the parent with wait kind `child`. The child is a normal run: it has its own event log, pins its own version, can itself contain subloops up to the depth limit, and is visible in the run list with a parent link. When it finishes, the parent is woken with the child's outcome and return payload, and the subloop handler applies the output mapping. Cancelling a parent cancels its children. Cancelling a child alone wakes the parent with outcome `cancelled`.

## Parallel runs (Decided)

Every trigger firing starts a new run. Runs of the same loop execute concurrently with no coordination. The run manager caps overall concurrency with a worker pool sized by setting, default 4, with parked runs not counting against it. A per-loop concurrency policy is post-1.0 and will be a loop setting.

## Cancellation (Decided)

Cancellation is cooperative and persisted. The API writes `cancelRequestedAt`, appends `run.cancel_requested`, and signals the in-process abort controller. Handlers observe the abort signal: the harness adapter cancels the session and kills the subprocess tree, the script port kills the process tree, waits and heartbeats drop their timers. Once the handler returns or throws with an abort, the engine appends `run.cancelled`. Children are cancelled first. A restarted process scans for runs with a cancel request and no `run.cancelled` event and completes the cancellation.

## Crash recovery (Decided)

At boot the run manager loads every run in `running` or `waiting` status:

- `waiting`: re-register the timer, signal, or child subscription. Nothing else.
- `running`: the last `node.started` without a matching `node.finished` identifies the interrupted node. Recovery depends on its kind.
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
- The thread projection replays `node.finished` patches and wake payloads. It is cached per run in memory and rebuilt on demand.
- The SSE stream (07) is a tail of the same log, which is why reconnecting clients can resume from a sequence number without loss.
- Large payloads such as transcripts, full probe responses, and return payloads above a size threshold are stored as artifacts on disk, keyed by content hash, and referenced from events.

## Replay and debugging (Draft)

Because every node input is reconstructible, the API offers "re-run this node with the same input" on a finished run, producing a new run forked at that node. This is the intended debugging tool, in place of error nodes.

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

## Why no error ports (Decided, see ADR-0006)

An error port makes every loop author responsible for failure handling and spreads failure semantics across every graph. The owner's position is that infrastructure failures are the platform's job, inference failures are the harness's job, and the remaining cases are either unavoidable conditions to fix and resume or bugs to fix. Explicit error or debug nodes stay on the post-1.0 list and will only be added if run inspection and node replay prove insufficient.
