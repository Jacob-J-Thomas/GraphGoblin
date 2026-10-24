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
  | { kind: 'park'; patch: []; wait: Omit<WaitSpec, 'waitId' | 'startedSeq'> } // wait, heartbeat, subloop: the run stops here and resumes later
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
  `finalized_at`). Non-webhook returns skip channels whose `return.delivered` or `return.failed`
  is already in the log. Webhooks use their durable delivery journal and finite attempt budget
  ([ADR-0043](decisions/ADR-0043-bounded-webhook-return-delivery.md)). During recovery the finalizer
  skips a retired Event return of an execution that already finished before upgrade, logging
  `LOOP_UPGRADE_REQUIRED` with the run, loop and version identities. It neither publishes the
  Event nor records a fictitious delivery receipt, and does not rewrite the historical outcome
  or definition. Other returns finish normally, the parent receives the child's execution
  outcome, and the run is finalized. This terminal bookkeeping exception does not admit or
  execute a definition with a retired destination; those definitions still require repair.
  At boot the run manager
  finalizes every terminal run not marked finalized (`listUnfinalized`), so a crash right after
  the status write loses no return and leaves no child running. A channel interrupted
  mid-delivery has an unknown acknowledgement; webhook recovery consumes that attempt and
  retries with the same identity and remaining budget. Migration `0002` marks runs that
  were already terminal as finalized. Finalization belongs to one terminal outcome: resuming a
  failed run clears the marker, so its next terminal outcome is finalized again; the resume waits
  for any finalizer of the failure still in flight (they share a per-run lock), so that finalizer
  cannot set the marker again after it was cleared. A child that
  cannot be cancelled (and is not terminal by then) leaves the parent unmarked, so the next
  recovery tries again.

Resume accepts paused runs or failures explicitly marked resumable; an exit with a failure
outcome is not a resumable node failure. A run paused while parked (or while parking) resumes
to `waiting` on the same wait, not by re-running its node: a wait keeps its deadline, a subloop
keeps its child. Its timers are re-armed and a child that finished meanwhile is delivered.

## Which definition a run executes (Decided, ADR-0041)

A run executes one immutable definition record for its whole life: the record its `versionId` names. Every executor start (the first, a wake after a wait, a resume, crash recovery) and every replay fork loads that record, never the loop's live draft. A published start pins the published version. A draft start (`allowDraft`, a test run) freezes the draft it read and validated into a `snapshot` record with its own id and the draft's number; the admission port commits the snapshot, the run, its initial thread and its `run.queued` event in one transaction. Editing, saving or publishing the draft afterwards never reaches the run. A snapshot cannot be started directly (`VERSION_NOT_PUBLISHED`), is not part of the version history, and storage triggers refuse its change, or its deletion while a run pins it.

`run.pinned` (on the run record and on `run.queued`, with `versionId`) describes the pin: `source`, version number, the loop name in the pinned definition, a readable `label` and the inherited defaults. Model and effort resolve node, loop (in the pinned definition), `pinned.defaults.owner` (the owner's Settings when the run was created), then `pinned.defaults.process` (`GG_DEFAULTS` when the run was created). Changing Settings, restarting with other process defaults, or editing a model selection in the loop therefore reaches new runs only. The model catalog stays live: a model disabled or removed meanwhile fails the node explicitly and is never substituted. Classifier decisions call `pinned.classifiers[<id>]`, the catalog entry's provider, model, endpoint, primitives and secret name as they were at start; the entry's existence, enabled switch and secret value are checked when the decision runs, so editing the entry reaches new runs only, and a removed or disabled classifier fails explicitly. A classifier that had no entry at start fails non-resumably without a catalog lookup. Subloop children get their own pins, inherit the parent's pinned defaults and keep the parent's binding for shared classifier ids; replay forks keep the source's `versionId` and `pinned`.

A pinned definition stored before [ADR-0044](decisions/ADR-0044-awaited-subloops.md) can still hold an exit that publishes an Event, which the current contract refuses. It is refused before anything executes: admission and replay throw `LoopUpgradeRequiredError` (API 409 `LOOP_UPGRADE_REQUIRED`, 07), every executor start of a run pinned to it fails the run with the non-resumable failure `LOOP_UPGRADE_REQUIRED` before its next node (an awaiting parent then fails with it), and a subloop whose child loop holds one fails its parent at the subloop node. Its `details` name the loop, the version and the destination paths.

## Decision gates, passes and terminal exits

A decision becomes a gate when exactly one route is marked `repeat: true`. This marker belongs on an expression/LLM route, Choice option, Noul side or Score band; it is never inferred from canvas direction. Require `maxPasses` (1 to 10,000 or null for Unlimited); optionally set `maxRunTimeSeconds` (positive integer seconds, at most 31,536,000). Without a repeat marker neither limit is allowed. Reserve the port ID `limit-reached`: authors cannot use it as a route ID. The gate exposes **Limit reached** only while a repeat is marked, and that output must be connected. The repeat route must lead through a cycle back to the gate; exits are terminal and triggers cannot be repeat targets.

Passes are one-based, available to JSONata as `gates.<nodeId>.passes` (quote an ID with punctuation, for example `gates."my-gate".passes`). Every marked gate starts at 1. Evaluation happens first. An allowed repeat increments its count once; a non-repeat choice or a refused repeat leaves it unchanged. A non-repeat choice on the last allowed pass wins. If the decision chooses repeat at `maxPasses`, or after the optional run-time limit, it takes `limit-reached` instead. Both limits reached together are recorded as `max-passes`.

Maximum run time is elapsed wall time from `run.startedAt` (falling back to `createdAt`), including waits, pauses and recovery downtime. It is checked after evaluation and only on a repeat choice; it does not interrupt running work or override a finishing choice. A replay fork keeps the checkpoint's passes and starts its own run clock.

Exits are terminal: `{outcome, returns, destinations}`. `outcome` is `success` (default), `failure` or `exhausted`; `returns` is a JSONata expression or `none` (default); `destinations` defaults to `[{kind:"caller"}]` and supports caller, webhook, file and log (no Event: loops compose as awaited subloops, ADR-0044). Exits have no criteria, predicate, default routing or loop-back, and no output ports.

Success finishes `succeeded`, Failure finishes `failed`, and Exhausted finishes the distinct terminal status `exhausted`. Exhausted means the authored graph gave up further repetition; normally a gate's Limit reached output leads here. It is an outcome, not a resumable node failure. Every outcome evaluates the same return expression and delivers its value unchanged; Exhausted adds no wrapper or implicit last output. Use `outputs.<workNodeId>.value` when returning work output, because the preceding gate replaces `lastOutput`.

`decision.made` records the chosen actual port and optional `gate`: `previousPasses`, `passes`, `repeatRouteId`, `maxPasses`, optional `maxRunTimeSeconds`, `elapsedSeconds`, and `limit` (`null`, `max-passes`, `max-run-time`). The observed route remains the evaluator's choice even when the actual port is Limit reached. The manager appends this event atomically with `node.finished`; replay projects the absolute count, so recovery, resume and replay do not double-count a durable decision. The saved cursor advances using that recorded actual route.

`exit.evaluated` records `{nodeId,outcome}` atomically with `node.finished` and `run.finished`. Return mapping failures follow normal node-failure handling. Fresh runs retain `run.iteration: 1`; factual old `iteration.incremented` events remain replayable but new gates do not emit them.

`settings.maxNodeVisits` (default 10, maximum 10,000, `null` explicitly unlimited) independently caps fresh entries per node. A `node.started` with attempt 1 counts; a wake, recovery or resumable retry of the same visit does not. Exceeding the cap fails before starting the node with `MAX_NODE_VISITS`, `resumable: false`, its node ID and `details.maxNodeVisits`. This catches unmarked cycles; it does not turn them into gate exhaustion. Configure enough visits for intentional work and gates.

Validation reports `GATE_PASSES_ABOVE_VISIT_CAP` at `config.maxPasses` when a gate's maximum passes exceeds a finite visit cap (including unlimited passes). The warning names both numbers and all nodes on repeat-target paths back to that gate (excluding paths after the gate and exit branches). Continued repetition cannot reach the maximum-pass Limit reached output before the safety cap fails the run. This is a warning rather than an error because an earlier non-repeat choice or maximum run time can still finish the run as intended. All admission endpoints return the same warning, and the editor shows it beside Maximum passes.

Every new `decision.made` event contains `{portId, provenance, observation}` and empty diagnostics. Expression and LLM observations have kind `route`, with the declared routeId, nullable confidence and nullable reasoning; classifier observations have kind `classifier` with a typed answer. Boolean observations retain factual history; current decisions use routes or classifier answers. Fresh events pass per-kind validation before append. Diagnostics preserve at most three historical facts; provider error bodies remain excluded.

### Explicit decision failures (#98)

A decision never substitutes another evaluator. `EVALUATION_UNAVAILABLE` is resumable when selected configuration or credentials can be restored. `EVALUATION_PROVIDER_FAILED` is resumable for connection/timeout failures, HTTP 429/5xx and restorable authentication failures; deterministic protocol/request failures are not. `EVALUATION_INVALID_CONFIGURATION`, `EVALUATION_INVALID_RESPONSE`, `EVALUATION_RESULT_REJECTED` and `EVALUATION_EXPRESSION_FAILED` are nonresumable: correct the configuration/input and replay or start a new run. Cancellation remains cancellation. Classifier confidence rejection retains the validated classifier observation, provenance and failed acceptance gate in safe failure details, but emits no decision or output patch. It is not a hidden uncertainty port. Decision LLM self-reported confidence is never thresholded. Typed classifier, route and boolean operations take caller-prepared inputs and dispatch exhaustively. The expression route operation accepts only a scalar declared string ID; all other results fail. Operations do not render instructions/questions or select context.

## Subloops as child runs (Decided)

A subloop is an awaited call ([ADR-0044](decisions/ADR-0044-awaited-subloops.md)); it is the only way one loop uses another (exits do not publish Events). The node creates a child run with the mapped input thread and parks the parent with wait kind `child`. The child is a normal run: it has its own event log, pins its own version, can itself contain subloops up to the depth limit, and is visible in the run list with a parent link. The parent continues only once the child is terminal: the child's exit returns its configured output, and the subloop handler applies the output mapping. A child exit is the child's outcome, never the parent's: the parent continues to its own subsequent nodes and its own exit. A child that returns no output (`returns: "none"`) passes none: `result` is absent from the parent's summary and custom mapping, and `resultTo.var` is removed; a child that returns JSON `null` passes `null`. `resultTo.var` is applied after any variable merge, so a merged variable of the same name (the child's inherited copy, say) never overrides the result or its absence. Cancelling a parent cancels its children.

**Child failures follow the inline rules (Decided, #251).** A child's execution error is the parent's, exactly as if the failing node had run inline in the parent; nesting adds no silent success and consumes no error. The parent fails at its subloop node with the child's failure code and resumability, the message `subloop child <id> failed: <child message>`, and `details: { childRunId, childNodeId?, childDetails? }`; its `child_run.finished` records `status: failed`. Deterministic failures stay non-resumable in the parent as they are in the child. Explicitly resuming such a parent re-executes its subloop node, which resumes the same child in place (`run.resumed` with actor `{ kind: 'run', id: <parent> }`): the child's failed node runs again under the ordinary crash-recovery rules, with its thread, pins and recorded sessions intact, and no second child is started. A parent re-executed by crash recovery (not resumed) fails again with the child's failure instead of resuming the child. A child resumed directly while its parent stays failed finishes on its own; the parent's later resume then maps that outcome. Cancelling a child (operator or API) cancels the parent that awaits it, as cancelling inline work cancels its run: the parent records `run.cancel_requested` with actor `{ kind: 'run', id: <child> }` and `run.cancelled`, and its own parent follows in turn. An authored outcome is not an execution error: a child that finishes through a Failure (or Exhausted) exit returns its configured output as ordinary data, and the parent continues.

**Child wakes are bound to the observed park (Decided, #242).** A finished child's notification reads the parent's park and carries its `waitId`; the wake is a conditional append that the parent's current park accepts only when it has that `waitId`, kind `child` and that child run. A notification delayed past that park (the parent was woken by the other notifier, ran on and parked again on an input wait or on the next visit of the same subloop node) finds a different `waitId` and does nothing. The subloop handler never maps an unfinished child: woken for a child that is no longer terminal (resumed after it notified), it parks on that child again.

**Which version a child runs (Decided, WP-G).** A `latest` reference resolves when the parent run is _created_, not when the subloop node runs. `startRun` walks every subloop reference reachable from the run's version, through the referenced loops' own subloop nodes at any depth, pins each `latest` loop to the version published at that moment, and records the map (loop id to version id) on the run's `run.queued` event as `subloopVersions`. Numbered references are immutable and need no pin, but are walked for their own references. Every child the run starts uses its pin, so a version published while the parent waits never reaches it. A child inherits its parent's pins and records them on its own `run.queued`, so a whole tree of runs sees one snapshot (it also inherits the parent's pinned model defaults, ADR-0041); every later visit of the parent's subloop node starts its new child on the same pinned selection; a replay fork copies its source's pins; recovery reads them from the log like everything else. A reference that does not resolve at creation is left unpinned and fails with `SUBLOOP_NOT_FOUND` when the child would start, as before; a run whose log predates pinning resolves `latest` when the child starts. A pinned version that is gone or no longer published fails the subloop with `SUBLOOP_NOT_FOUND`; it never falls back to latest. Deleting a loop is refused (409 `LOOP_IN_USE`) while any active run (queued, running, waiting, or paused) can still start it: a run of that loop, or one whose pins or subloop references reach it (`RunManager.loopInUse`). The check and the deletion run in one critical section with the subloop pinning in `startRun` (`RunManager.deleteLoopUnlessInUse`), together with replay-fork admission and a re-check that a new run's own version still exists, so a parent or fork created concurrently either pins the loop first (the deletion then refuses) or is created after it (and fails at that subloop like any reference to a deleted loop). A run or fork whose own version was deleted meanwhile is refused with `LOOP_NOT_FOUND`. The check reads only the first event (`run.queued`, with the pins) of each active run, plus the versions its pins reach.

**A child that finishes before its parent parks (Decided, WP-G).** The parent records its `waiting/child` state after the subloop handler has started the child, so a fast child can finish while the parent is still `running`; its notification then finds no waiting parent. After the parent's park transition the run manager therefore checks the child, and wakes the parent at once if the child is already terminal; recovery does the same for every parent waiting on a child, after finalizing any child that finished while the process was down. These paths and the child's own notification go through the same identity-bound conditional append, so exactly one wins and the parent continues once. A wake that lands while the parent's executor is still returning is queued until it has returned rather than dropped.

## Parallel runs (Decided)

Every trigger firing starts a new run. Runs of the same loop execute concurrently with no coordination. The run manager caps overall concurrency with a worker pool sized by setting, default 4, with parked runs not counting against it. A per-loop concurrency policy is post-1.0 and will be a loop setting.

## Cancellation (Decided)

Cancellation is cooperative and persisted. The API writes `cancelRequestedAt`, appends `run.cancel_requested`, and signals the in-process abort controller. Handlers observe the abort signal: the harness adapter cancels the session and kills the subprocess tree, the script port kills the process tree, waits and heartbeats drop their timers. Once the handler returns or throws with an abort, the engine appends `run.cancelled` and then moves the status. Children are cancelled after the parent is terminal. A restarted process scans for runs with a cancel request and no `run.cancelled` event and completes the cancellation.

The request itself is a compare-and-set (`RunRepository.claimCancel`): `cancelRequestedAt` is written only when it is unset and the run is active. Of concurrent cancels, one records `run.cancel_requested`; the others return the run as it is without appending anything. A cancel that loses to the run finishing is an `INVALID_STATE` error, as a cancel of a terminal run always was.

## Template storage retirement (Decided)

Templates are catalogue assets copied into ordinary loops, never runnable instances. Migration `0012_retire_template_instances` drops the six template subject indexes, `runs.template_subject` (including its inline JSON CHECK), and `template_instances` with its owner index. The ordinary run, thread/checkpoint, parent, finalization and trigger-deduplication table layouts remain; the offline cutover below empties their historical contents. Liquid, ordinary settings/model fields and working-directory kind `template` are unrelated and remain supported.

`FORMAT_BASELINES[4]` requires `0013_trigger_configuration` in the migration ledger and its resulting structure before any startup writes. Startup refuses older stores, including a format-4 marker at 0011; it never applies this cutover SQL to them. Fresh initialization executes all migrations, ledger entries and the format-4 marker in one transaction.

The offline server-store cutover keeps ordinary loop versions and drafts and deletes all run history, artifact files and configured template instances with their definitions ([ADR-0039](decisions/ADR-0039-format-four-definitions-only-cutover.md)). Inspect locks the stopped directory and reads without writes. Apply requires a verified complete backup, zero ordinary active runs/pending receipts or admission intents, resolved per-version review items and an unchanged plan hash. Template work never blocks retirement. History deletion, template retirement, SQL through 0013, definition rewrites, schedule disarming, completion marker and head verification share one transaction. Artifact files are removed after commit, with explicit post-commit failure reporting and backup recovery. No in-database archive or historical replay conversion remains. Polls and crons in every retained version/draft and schedule row are disabled; webhooks retain their armed state. See the [offline guide](guide/08-offline-upgrade.md).

## Offline definitions and portable exports

`upgradeLoopCurrent` and `upgradeExportCurrent` are async, explicit definition-only
converters to format 4. They compose frozen 1?2?3 stages with
`convertDefinitionV3ToV4`, or validate already-current input. Resolutions have
separate `v1`, `v2` and `v3` namespaces. Results always report `notices` and
`reviewItems`; success supplies `value`, while pending/invalid conversion supplies
`issues` and withholds the candidate. Each issue has an explicit `kind` of `pending`
or `invalid`; a refusal can contain both. Review items retain E2 IDs, source-bound
hashes, reasons and statuses. Stale and unused resolutions refuse.

The export CLI and API import use this composition. Automatic old exports import
normally; pending imports return a structured `LOOP_FORMAT_UPGRADE_REQUIRED` problem
and need offline review. See the [offline guide](guide/08-offline-upgrade.md).
The offline server-store tool uses the same composition for each retained version and draft. Portable export and device conversion do not authorize or perform a server cutover.

## Crash recovery (Decided)

Webhook return delivery is independent of execution. `delivery.queued` is atomic with
`run.finished`; `delivery.attempted` consumes an attempt before network I/O. A background
worker records `delivery.attempt_finished` for a retry or `delivery.finished` for delivered /
failed. `acknowledgementUncertain` retains any earlier unknown attempt separately from the
latest error and acknowledgement, including after eventual success. An invalid HTTP response
status becomes retryable `transport` / unknown, without an invalid `httpStatus` in the journal.
Five attempts have 10-second deadlines and 2/5/10/20-second retry delays. Recovery
turns an in-flight attempt into unknown and preserves its identity, deadline and remaining
budget, including a final failure if the interrupted attempt was the last. Recovery does not
wait for the network before serving the API. Delivery work does not occupy execution slots;
`waitForIdle` drains it while running. After `stop()` (D-021), backoff waits wake immediately
and no new request starts. In-flight requests finish or time out within their existing
10-second deadline and journal their outcome; pending deliveries retain identity, attempts
and retry deadline for recovery on the next start. Forced termination retains the same
durable budget, with an unfinished acknowledgement recorded as unknown during recovery.
Deleting a loop also stops its delivery workers: they re-read the run before each attempt
and journal append; the append checks existence transactionally, preventing orphan events.
The run remains succeeded when its execution succeeded. Finalization
is marked only after every delivery finishes. See ADR-0043 for eligible failures and ambiguity.

Recovery enumerates raw run identities and decodes each candidate separately. Candidates
are active runs and terminal runs awaiting finalization; startup checks and logs damaged
candidates only. Finalized terminal history is checked through `GET /runs/diagnostics`.
A malformed JSON field, invalid current-contract run record/thread (including a missing,
malformed or invalid definition pin, ADR-0041), or unreadable event page is isolated to its run: startup logs `HISTORY_UNREADABLE` with the run ID and reason,
skips its work, and continues healthy recovery. Recovery leaves its rows and events
unchanged. Store-level schema, format, and I/O failures still fail startup; they are not
reclassified as damaged runs.

`GET /runs/{id}` and MCP `get_run` decode only the run row. A readable row returns its
stored snapshot even when its events or thread checkpoint are damaged; an unreadable row
returns `500 STORED_RUN_INVALID`, including on `/events` and `/thread`, which check the owned run row first. Event reads (`GET /runs/{id}/events`, MCP
`read_run_events`) decode the requested event page and return `500 STORED_EVENT_INVALID`
when it is unreadable. Thread reads (`GET /runs/{id}/thread`, MCP `get_run_thread`)
decode the stored snapshot or, when it is absent, the initial thread and replay events.
Unreadable thread data returns `500 STORED_RUN_INVALID`, and unreadable replay events
return `500 STORED_EVENT_INVALID`. MCP exposes the same problem codes as tool errors.

`GET /runs/diagnostics` (owner-scoped, `runs:read`) is the identification path for damaged
history across all runs, including finalized terminal runs and rows that cannot supply a
snapshot. Follow its `nextCursor` until null; each request checks at most 20 runs and 2,000
events. This read-only diagnostic does not change lifecycle status: a damaged snapshot
may still say queued, running, or waiting.

The operator must explicitly repair the named row by hand or explicitly delete the
containing loop through the existing deletion path after all of its runs are terminal.
There is no automatic repair, quarantine archive, history reconstruction, deletion, or
whole-store reset. See the troubleshooting guide for the manual disposition procedure.

Before run recovery, fresh SQLite initialisation commits the schema migrations, their ledger and the complete stored-format marker in one write transaction. An interruption before commit rolls all of them back, so the next ordinary startup can initialise the empty store again without duplicate migration effects. Freshness requires no application tables and no recorded migrations; an empty migration-ledger table alone is allowed. Empty user tables do not establish freshness. An existing unmarked schema, a marker table without its complete row, an incomplete upgrade state or recorded migrations without application tables still stop startup with `DATA_UPGRADE_REQUIRED`. Preserve those stores for the [offline upgrade and recovery workflow](guide/08-offline-upgrade.md); startup does not stamp or repair them by inference.

If another initialiser completes before this startup acquires its write lock, the recheck recognises the current store and startup still applies any pending ordinary migrations. If initialisation fails and rollback also fails, startup preserves the original initialisation error.

**One run manager per store.** There is no execution lease: two run managers over the same database would both pick up a queued or recovered run and execute it twice (the review demonstrated a doubled inference). 1.0 enforces one API process with one run manager per data directory using `<dataDir>/graphgoblin.lock`, exclusively acquired before opening SQLite, migrations, or recovery. A live PID refuses startup with `another GraphGoblin process holds <path>` and exit code 1, regardless of port; a confirmed dead PID or this process's own PID without an in-process hold permits stale-lock replacement. The container holds the lock until `stop()` has stopped scheduling, waited for active runs, and closed SQLite; main also stops it on startup failure, clean HTTP close, SIGINT, or SIGTERM. `--create-api-key` uses the same lock, while read-only `--preflight` may run alongside the server. Processes sharing an overridden `GG_DB_URL` must use the same data directory. Execution and scheduler leases belong with the post-1.0 hosted work (11).

At boot the run manager loads every run in `queued`, `running`, `waiting`, or `paused` status:

- Terminal runs never marked finalized: finalized now (timers, children, returns per channel, parent; see "Finalization is recorded").
- Any of them whose log ends in a terminal event: completed from the log (above), nothing executed.
- `waiting` with a durable wake in the log: moved to running, so the woken node runs.
- Any active run with a durable `run.waiting` and no later wake or node execution: complete the park from that event, including an interrupted snapshot/status write. Keep its original `waitId` and deadlines. Paused runs retain their pause. Re-arm both `until` (timer or heartbeat) and `timeoutAt` with keys containing the recorded `waitId`, then reconcile a completed child for runs that are waiting.
- `running`: the executor starts from the log. The thread is the last verified checkpoint plus the events after it (see "Event log and projections"), and the cursor is checked against the log: when the log's last node event is the `node.finished` of the node the run record still points at, that node completed and only the cursor write was lost, so the cursor advances along the route it recorded (a gate follows its recorded actual port, with passes in the same append) without running the node again. Otherwise the last `node.started` without a matching `node.finished` identifies the interrupted node. Recovery depends on its kind.
  - Inferencing: reconstruct the open logical visit and its pending turn from the event log. A proven refusal resends the exact saved task with its original policy selection; uncertain work continues a usable session, or stops non-resumably. An inherited previous/named/own ID alone is unusable for unaccepted authored work. A missing session also stops. See below.
  - Script: re-executed. Scripts are documented as at-least-once.
  - Decision, mutation, exit: re-executed. They are deterministic given the thread, except Jev and Codex-backed decisions, which are simply asked again. (An exit whose `run.finished` is durable is completed from the log instead.)
  - Subloop: if the visit already recorded `child_run.started`, the handler re-parks on that child, or handles its outcome if it has finished (maps it, or fails or cancels the parent with the child's runtime failure or cancellation); otherwise it creates the child. A crash between creating the child and recording `child_run.started` can still leave an orphan child and start a second one; closing that needs the child id allocated before the child is created.
- A child that finished while the process was down is finalized first, which wakes its waiting parent; a parent whose child wake was durable but whose status write was lost is moved to running. Either way the parent continues exactly once, at any nesting depth (the built API is checked with real kills and restarts around child completion, `apps/api/src/subloop-restart.test.ts`).

Recovery is automatic and silent apart from a `node.started` event with `attempt` incremented.

## Per-node provider continuity (#33)

`resume-own` starts fresh on the first visit and then resumes only this node's last
completed conversation in the same run and harness. The handler derives completed
visits and the last completed visit's final attempt from this run's event log, then
queries the existing session row by run/node/attempt/harness. Attempt numbers restart
on a new visit; selecting the largest historical attempt would resume stale work.
A locally finished row without durable `node.finished` remains unfinished work under
the submission/recovery rules below.

The optional authored `resetAfterVisits` accepts positive safe integers (1 through
9,007,199,254,740,991), without a default. N completed visits share one conversation;
the next visit starts fresh. Retries and schema repairs do not consume visits.
Reset selection runs only for a new visit: a pending definitely-unsubmitted task
retains its original fresh/resume selection and exact prompt, and uncertain accepted
work uses its usable session. The shared thread, feedback and other node sessions
are never cleared. Existing loop guardrails still apply independently.

A restart retains the reference in SQLite and reconstructs counts/provenance from
the durable log. Forks and child runs have distinct run IDs and logs, so they start
their own conversations and reset counts even when their initial graph thread carries
messages, gates or counters from the source/parent. Native provider expiry still
fails explicitly; #265 owns the future explicit fresh-session recovery action.

Fresh provider sessions can deliberately receive current main-loop context via
existing prompt/input/context-file controls. Own continuity adds provider history;
it does not implicitly copy conversation transcripts into the shared thread or
change configured output behavior. See [ADR-0052](decisions/ADR-0052-node-own-session-continuity.md).

## Inference submission and recovery

One logical visit begins at the first `node.started` after that node last finished. Its identity
is `<runId>:<first-start-seq>`, retained across retries and restarts until `node.finished`.
Each initial, repair or continuation turn records `harness.turn` before adapter invocation,
including its exact rendered `prompt`, `promptKind`, `turnId`, harness and selected
`resumeSessionId`. Refused retries retain the saved prompt and policy selection, even if init
announced a different ID. They do not rerender against a changed thread. Repair refusals retain
the repair task, including a synchronous refusal before the repair invocation returns a session
handle. Launch exceptions, streamed errors and rejected results share the same failure and
submission mapping. A synchronous missing-session refusal is durably `session-missing` with
`HARNESS_SESSION_MISSING`, regardless of retryability; Resume returns 409 without another
harness call. An explicit delivery-uncertain transport failure or unconfirmed termination is
never downgraded to safe non-submission because no handle was returned. Pinned policy,
configuration and argument refusals remain non-resumable. Every provider boundary uses one pure evidence fold, shared by the engine and Codex adapter:

| Rank (highest first) | Evidence                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| 1                    | Unconfirmed termination                                                          |
| 2                    | Missing session (typed cause or explicit session-missing metadata)               |
| 3                    | Pinned argument, configuration or policy refusal                                 |
| 4                    | Valid explicit submission metadata                                               |
| 5                    | Ordinary typed authentication, quota, transport, timeout or installation failure |
| 6                    | Generic final wrappers                                                           |

Higher-ranked evidence wins; within a rank the later observation wins. This applies to
launch exceptions, streamed errors, rejected promises/results, iterator throws, Codex top-level
errors and `turn.failed`, cleanup and cancellation. Unconfirmed termination overrides
cancellation. A successful Codex turn can still tolerate nonfatal top-level diagnostics.
Acceptance cannot be downgraded to safe non-submission by later metadata.

Classification is decided independently of persistence. A failed classification/status write
adds `failure.details.recording` diagnostics without replacing the primary cause, submission,
provenance or Resume eligibility. The terminal failure also records the selected submission,
so recovery uses it if an earlier classification append was lost. Turn intents (initial tasks, exact retries and repairs) and their identities
are established before their fallible appends. Reconciliation reads are guarded: if an ambiguous
append cannot be reconciled, `failure.inference.retry` carries the exact uninvoked prompt,
harness and selected resume ID. Recovery reconciles that same turn identity when storage is
available, rather than sending a generic continuation or cancelling the completed invocation.
This requires storage to recover sufficiently to record the terminal failure; a sustained outage
that also prevents terminal persistence cannot establish a durable outcome.

These authored prompts are part of private run
history, with the same access
and deletion boundary as its context thread. The entire prompt is stored inline with no schema
size limit or automatic artifact offloading; large prompts therefore enlarge the event log.

| Classification (`failure.inference.submission`) | Failure code                                                                                                                                               | Resume behavior                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definitely-not-submitted`                      | Original cause, such as `HARNESS_NOT_INSTALLED`, `HARNESS_NOT_AUTHENTICATED`, `HARNESS_TURN_FAILED` or `INFERENCE_TIMEOUT`                                 | After fixing a resumable cause, submit the saved task with the original fresh/previous/named selection. Init alone cannot change that selection.                                                                                                           |
| `delivery-uncertain`                            | `HARNESS_DELIVERY_UNCERTAIN` for generic turn failures; specific causes such as `INFERENCE_TIMEOUT`, quota, artifact or termination failures remain intact | When eligible under the harness rule below, continue only a usable session with the continuation prompt. No usable session means `resumable: false`; use Replay from the node for a deliberate new attempt. Unconfirmed termination is also non-resumable. |
| `session-missing`                               | `HARNESS_SESSION_MISSING`                                                                                                                                  | Non-resumable. Do not silently start fresh or repeat the invalid session. Explicit fresh-session recovery is deferred to #265.                                                                                                                             |

`failure.inference` also contains `visitId`, `turnId`, `promptKind` and the session ID when
known. `harness.submission` records `submitted` on positive acceptance, with its marker, or
one of the three failure classifications when a turn fails. Acceptance does not prove that
the result was durably recorded; recovery of an accepted unfinished turn remains uncertain.
The crash window between durable intent and adapter invocation is conservatively uncertain:
absence of an acceptance marker, even init-only output, never proves non-submission. Adapters
may assert definite refusal only with positive pre-send/startup/refusal evidence. Once accepted,
a later authentication/refusal error cannot downgrade the turn to safe resubmission.

Under previous/named/own policy, an authored or retried authored turn with no durable acceptance
cannot use its inherited `resumeSessionId` alone for continuation (ADR-0045, D-022). It fails
non-resumably on explicit failure and at visit-start recovery. A different newly announced
session, an accepted turn, or a repair/continuation on the visit's own session can continue.
For non-pinned generic failures, Codex permits Resume even when its adapter reports
`retriable: false` for an exit or lost stream. Claude permits Resume only with the adapter's
`retriable` evidence. Unsupported policy, invalid configuration and rejected arguments remain
non-resumable for both harnesses because the definition is pinned. Continuation safety is
checked separately: uncertain delivery must still have a usable session under D-022.
Restorable login, installation and quota failures retain their specific eligibility. Resume
is still unavailable if delivery is uncertain and no usable session exists.

The continuation prompt is: "The previous turn was interrupted before GraphGoblin recorded its
result. Continue the task from where you left off and finish it." A new continuation has its own
turn ID within the same visit. Successful provider work followed by transcript storage failure
uses this same continuation path. Engine persistence faults preserve their original failure
cause; durable intent still governs subsequent recovery.

Each repeated visit starts new provenance. Replay forks and child runs have their own logs and
inherit no pending turn or submission state; an explicitly authored named-session policy keeps
its existing lookup semantics. Own-session lookup is also limited to the new run; explicit fresh-session
recovery remains deferred to #265. Other turn failures stop the run; the existing #243 positively unsubmitted transient
transport failure can retry once in-process without creating another visit. Explicit Resume and automatic startup recovery apply the saved provenance: resend
proven refused tasks, continue accepted/otherwise usable unfinished sessions, and fail
uncertain work without a usable session. Recovery can therefore invoke the provider again.

## Resiliency model (Decided)

Resiliency is built into the engine. Users do not model it. Failures fall into four classes.

| Class                    | Examples                                                                                                                                                                | Engine behaviour                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient infrastructure | SQLite busy, Jev network blip, outbound webhook 503                                                                                                                     | Internal retry with backoff, bounded, logged. Invisible to the loop.                                                                                                                     |
| Harness-internal         | Model errors, tool failures inside a Codex turn                                                                                                                         | Handled inside the harness turn. GraphGoblin stops on a reported failure; explicit resume and startup recovery follow submission provenance above.                                       |
| Unavoidable              | Subscription exhausted, login expired, harness not installed, working directory missing, script exits non-zero without a route, schema repair exhausted with `fail-run` | Run moves to `failed` with a typed, human-readable reason. Resume eligibility follows the cause and, for inference, the submission evidence above.                                       |
| Bug                      | A handler throws anything else                                                                                                                                          | Run moves to `failed` with full diagnostics. Resume is available when recovery is safe; inference without a usable session stops non-resumably. The defect must be fixed in GraphGoblin. |

Provider exceptions from decision evaluation use a shared fixed summary instead of raw diagnostics. The catch-all also sanitizes errors carrying `DECIDER_*`: it stores a recognized code and the selected strategy when available, without provider messages or stacks. Engine provider warnings contain only safe name, code, numeric HTTP status, and run/node/strategy identifiers. Ordinary internal defects retain their full diagnostics.

Resuming a failed run re-executes the failed node using the crash-recovery rules above. A failure that came from a subloop child carries the child's class and resumability; resuming the parent resumes that child in place (see "Child failures follow the inline rules").

## Timeouts (Decided minimal)

Wait and heartbeat handlers describe their deadlines without arming timers. The manager first appends `run.waiting`, saves its thread and parks the run; only then does it upsert the timers. Recovery completes an interrupted park from the recorded spec before arming its timers, so downtime never restarts a duration or extends a recorded wall-clock deadline. A past deadline is immediately eligible on the next poll (supported polling settings include 50 ms and 1,000 ms).

Timer keys are `<kind>@<waitId>`. The opaque `waitId` combines the run ID and the durable `node.started` sequence for this park; it is recorded in the event and snapshot, rather than kept in memory. A due delivery before parking is visible returns a deferred acknowledgement: the row is conditionally requeued one configured polling interval later. A paused run acknowledges its timer without waking; resume and recovery re-arm its recorded deadline. Timers for unreadable run history are also acknowledged, leaving that history for diagnostics and explicit deletion rather than logging on every poll. This prevents deferred rows from starving other overdue timers in a full batch. The original deadline stays in the wait spec. Resume re-arms the original deadline and the next poll wakes a passed deadline. A stale timer cannot wake a later park. Wake events are conditional appends. Their status acknowledgements also compare the recorded `waitId`, so a delayed acknowledgement cannot move a later wait to running. Redelivery after a lost status response completes or queues the durable wake without appending it twice, including when the running status committed before its response was lost. The scheduler acknowledges only after all listeners accept delivery and only while the row still has the fired deadline. It also serializes same-run timer mutations and preserves any re-arm overlapping delivery, including an identical deadline on resume; an old acknowledgement cannot delete that resumed timer.

After `pnpm build`, `pnpm test:wait-restart` checks observed input identities, passed deadlines, paused waits and heartbeat counts through real API process restarts at 50 ms and 1,000 ms polling. CI runs it next to `pnpm test:recovery-process`; neither command makes provider calls.

Optional `timeoutSeconds` exists on inferencing and script nodes and on wait and heartbeat nodes through their own fields. Defaults are none. A timed-out inferencing or script node is an unavoidable failure. A timed-out wait or heartbeat follows its `onTimeout` setting.

## Event log and projections (Decided)

- Events are appended with a monotonically increasing `seq` per run, atomically per append (several events in one append are stored together or not at all). The event store and the run record are separate writes: events go first and recovery completes the status (see "The log is written first" above).
- The first event, `run.queued`, carries the run's initial thread as `initialThread`: the `run` and `invocation` blocks plus, for a subloop child, the seed the parent mapped in. Replaying `node.finished` patches over it reproduces the thread at any event without any other source (the run inspector does exactly this). Logs written before the field existed lack it; readers then start from the thread's `run` and `invocation` with empty collections. Size: the initial thread is the trigger payload (bounded by the request body limits, 8 MB for the API and 1 MB for webhooks) plus, for a child, the seed the subloop mapping selected from the parent thread; it is written once per run, next to the `runs` row's own copy, and has no separate cap in 1.0. Offloading it to the artifact store above a threshold (with a reference on the event) is the follow-up if large seeds appear in practice.
- The thread projection replays `node.finished` patches (a `node.finished` is applied only when it completes the open visit, the node most recently started and not yet finished; a second record of the same completion, immediate or delayed, is applied once), `decision.made` absolute gate counts, historical `iteration.incremented`, and `node.started` visit counts. **Verified checkpoints:** the executor saves the thread snapshot together with the `seq` of the event it reflects, always after that event is durable (`RunRepository.saveThread(runId, thread, seq)`, column `thread_snapshot_seq`). At every executor start it loads the checkpoint and, when its `seq` is in the log, replays only the events after it, carrying over the visit open at the checkpoint so a duplicate completion straddling it is still applied once; a snapshot without a `seq`, or one the log does not reach, is ignored and the thread is replayed from the initial thread. A run resumed after 10,000 completions replays only what follows its last checkpoint.
- Replay also counts `node.started` events, including resumed attempts, in `counters.nodeVisits`. Recovery reconstructs a pending wake before appending its new `run.started`, so an accepted input is still available to the resumed node.
- The SSE stream (07) is a tail of the same log, which is why reconnecting clients can resume from a sequence number without loss.
- Large output payloads such as transcripts, full probe responses, and return payloads above a size threshold are stored as artifacts on disk, keyed by content hash, and referenced from events. Pending `harness.turn.prompt` and `run.queued.initialThread` remain inline without a separate schema size limit; they are not automatically offloaded.
- The filesystem artifact store publishes flushed temporary files by atomic same-directory rename and verifies content hashes on reads (11). Failed publication raises the resumable node failure `ARTIFACT_WRITE_FAILED`, carrying its reference and publishing no transcript/output patch. After repairing storage, explicitly resume: inference continues the recorded provider session with the continuation prompt instead of resending the authored prompt. Corrupt downloads return the API problem `ARTIFACT_CORRUPT` (07); it is not a run failure code.

### Durable event validation

Every generated durable event is validated against the current `RunEventSchema` before
persistence. SQLite validates the entire append before inserting any rows, moving the sequence,
or notifying subscribers; atomic admission already validates its initial event. A rejected
event fails the run with `EVENT_INVALID`, `resumable: false`. Successful values are never
silently truncated. Wait prompts and terminal failure messages are bounded at 10,000
JavaScript string characters (UTF-16 code units); progress summaries have their separate
2,000-character contract bound. Literal and rendered templates obey the same event bound.

Failure reporting validates its own metadata and bounds oversized messages with a visible
`[truncated; original N characters]` suffix within that bound. The same valid failure is
stored in the terminal event and run record. A restart sees the durable failure and does
not automatically repeat the node that produced the rejected event.

SQLite event reads enforce the current contract. A non-conforming row rejects the whole
read page with an error naming its run, sequence, and type, without exposing its payload.
Recovery cannot consume a partial invalid page. JSON pages and SSE replay use this same
reader; SSE validates replay before sending any frames (07). Stored data repairs belong
to migrations, including `0007` for historical decisions without `skipped`. Existing damaged
history requires explicit manual repair or deletion; recovery does not repair it automatically.

## General webhook admission (#168 T4)

**Webhook admission (#168 T4).** All three authentication recipes freeze their run admission under
the deletion lock and acknowledge once claim saves the inbound row and receipt, complete intent,
pending pins and key reservation. Dispatch separately commits the run/thread, queued event, pins,
admitted receipt and inbound run link, then notifies. Retry metadata failure cannot invalidate the
earlier acknowledgement. Recovery uses the saved intent and ID, with a non-overlapping 15-second
sweep of at most five due receipts and backoff capped at five minutes. The exported
`@graphgoblin/engine/testing` admission contract cases run the same assertions on staged fake writes
and SQLite transactions, including faults at every claim/create write. Identical unkeyed raw bodies
receive distinct receipts and runs; raw hashes are audit evidence only. Authored keys share the same
claim rule across both signing recipes. None establishes no sender identity. JSON/text/bytes decoding and event extraction precede
admission; extracted metadata is optional `invocation.trigger.eventType`, preserved in the
initial thread and sequence-1 queued event without publishing an Event. Timestamp
freshness authenticates a request; it does not select a deduplication window. Retry backoff uses
attempts re-read under the deletion lock, rather than the due-list snapshot. See
[ADR-0037](decisions/ADR-0037-webhook-acknowledgement.md).

## Replay and debugging (Decided by implementation, 2026-10-03)

Because every node input is reconstructible, the API offers "re-run this node with the same input", producing a new run forked at that node. This is the intended debugging tool, in place of error nodes. `RunManager.replay({ runId, nodeId, source?, caller? })`, exposed as `POST /runs/{id}/replay` and the MCP tool `replay_run`:

- **The source may be in any status**, including running or waiting; it is never modified. It must have a `node.started` event for `nodeId`, otherwise the request fails with `REPLAY_NODE_NOT_REACHED` (409). The node must exist in the source's pinned definition, otherwise `INVALID_STATE`; pins never change, so a node the source started is always there.
- **The fork's thread** is the source's initial thread replayed (`replayThread`) up to the event just before the node's _first_ `node.started`: every earlier `node.finished` patch, gate count and historical `iteration.incremented`, with `counters.nodeVisits` counted from the earlier `node.started` events. `run.id` is the fork's id; `run.parentRunId` is dropped, so forking a child run gives a top-level run that never wakes the original parent.
- **The invocation** keeps the trigger envelope (node, kind, payload, `receivedAt`, dedupe key) and gets a fresh id and `replayOf: { runId, nodeId }`. Source and caller are those of whoever asked for the replay (the API passes them; the engine keeps the source's when none are given). The source's `returnDefaults` are dropped: they belong to the source's caller. Return channels declared on exit nodes still deliver.
- **The fork** is a new run on the source's pinned definition record (a draft run's snapshot included) with the source's `pinned`, its own id and event log, created `queued` with `currentNodeId` set to the node and `iteration` from the thread, so the executor starts there. Its first event is `run.queued` with `replayOf` and `initialThread`, exactly the seed admitted to storage and used by the executor. `GET /runs/{id}/thread` returns that seed even before the fork starts. Nothing before the node is re-executed, and the source's child runs are not copied: a subloop node in the fork starts a new child.
- **Reconstruction continues from the seed**, including inherited messages, variables, outputs, counters, gate passes and iteration. Each fork `node.started` adds one visit to the inherited counter; decision events set absolute gate passes, and historical `iteration.incremented` events set iteration. The fresh-entry guardrail (`maxNodeVisits`) counts only this fork's own attempt-1 starts, independently of its inherited display counters. The inspector uses the same `replayThread` rule and never resets the recorded seed's counters.
- **Harness sessions are not carried over.** A node using `resume-previous` or `resume-own` finds no conversation in the fork and starts fresh; named sessions (`resume-named`) are looked up by scope key and still resume. Files the source wrote into a per-run working directory are not copied.

## Implementation notes from M2 (Decided by implementation, 2026-10-02)

- **Status changes are compare-and-set.** `RunRepository.transition(runId, fromStatuses, changes)` applies a change only when the current status is one of the expected ones. Start, park, wake, pause, resume, finish, fail, and cancel all go through it, so a pause that lands while the executor is starting a run is never clobbered.
- **Pause is allowed on queued runs** as well as running and waiting ones. A paused queued run has no `startedAt`; its first execution after resume records `run.started`.
- **Wake payloads live in the log.** The executor finds the pending wake by scanning back from the end of the log to the last `run.woken`, stopping at `node.finished` or `run.waiting` (a recovery `run.started` does not consume it; see "The log is written first"). Nothing about a wake is held in memory, which is what makes crash recovery trivial.
- **Attempts are counted from the log** too: the number of `node.started` events for the node since its last `node.finished`, plus one.
- **Parent cancellation marks the parent terminal before cancelling children**, so a child's cancellation does not wake the parent.
- **Subloop results land in `lastOutput` as `{ status, outcome, result, childRunId }`**, so a following decision node can branch on the child's outcome, not only its payload. `resultTo.var` stores the bare result. A child without output leaves `result` out and removes `resultTo.var` (#242).
- **Wait inputs become `user` messages tagged `input`; signals become `note` messages tagged `signal`.** Timeouts that continue set `lastOutput` to `{ timedOut: true }`.
- **Heartbeat outputs** are `{ beat, probe, satisfied: true }` when the condition holds and `{ beat, probe, exhausted: true }` when it runs out and is configured to continue.
- **Inference recovery follows visit submission provenance**, rather than attempt numbers or a session row alone. Proven refusal retains the authored task; uncertainty never blindly resends it.
- **Return channels merge** the exit node's list with any `returnDefaults` the caller supplied on the invocation, de-duplicated.

## Implementation notes from WP-D2 (Decided by implementation, 2026-10-03)

- **Model and effort resolve within the selected harness: node, loop, owner, process.** Loop and owner defaults use `defaults.byHarness`; the process supplies the same shape through `GG_DEFAULTS`. A decision LLM explicitly selects inheritance or a value. Unknown catalog models, wrong-harness models and unsupported effective effort are errors; invalid explicit selections are never bypassed. Disabled or unconfigured selections block publication and are checked again at execution. In-flight provider calls retain their starting selection. Owner and process defaults are the ones pinned when the run was created (ADR-0041), not re-read at each executor start. Old `GG_DEFAULT_MODEL` and `GG_DEFAULT_EFFORT` variables are rejected with upgrade guidance.
- **The executor yields to the event loop between nodes** (one `setTimeout(0)` per node). With fast ports every await settles as a microtask, and a graph cycle (a decision routing back to itself) used to starve timers, API requests, and the cancel request that could stop it. Such a cycle is now bounded by the per-node visit cap under `maxNodeVisits` (see "Decision gates, passes and terminal exits").

## Implementation notes from WP-G (Decided by implementation, 2026-10-03)

The adversarial design review (`docs/qa/2026-10-03-adversarial-design-review.md`) found eight open defects; WP-G closed them. The rules they settle are in the sections above; in short:

- **Subloop versions are pinned at parent creation** (ADV-004), transitively, and recorded on `run.queued` as `subloopVersions`.
- **Timers are delivered at least once** (ADV-011, #226). Timer arming, observed identities, deferred acknowledgement and restart reconciliation are described under "Timeouts" above.
- **Cancel requests are claimed once** (ADV-012).
- **A fast child cannot orphan its parent** (ADV-015).
- **The log is the source of truth** (ADV-016 and the WP-G review): events are written before status, wakes and terminal outcomes are completed from the log at recovery, the cursor follows a durable `node.finished`, and the thread comes from a verified checkpoint plus the events after it.
- **Expression regexes are checked statically** (ADV-007). The JSONata time budget is cooperative: it is checked at evaluator entry and exit, which a native regex match never returns to. So every regex literal in an expression, and every `redact` and `replace` mutation pattern, is rejected before it runs when it contains a back-reference, a repeated group containing another repetition, or a repeated group whose body can match the empty string or split the same text two ways (overlapping alternatives, or an optional part overlapping what follows it), looking through nested groups without their own repetition. JSONata's `$eval`, which compiles a string at run time, is shadowed by a binding that first compiles the string through the same check and then hands it to JSONata's own `$eval`, so it keeps the caller's lexical variables and functions and shares the caller's depth and deadline budget (an expression then fails to compile, which loop validation reports as `EXPRESSION_INVALID`; a mutation pattern fails its node when it runs). Ordinary patterns (`^\w+@\w+\.com$`, `\d{4}-\d{2}`, `(foo|bar)+`) are unaffected. Polynomial backtracking and memory are not bounded in-process; see 11.

## Why no error ports (Decided, see ADR-0006)

An error port makes every loop author responsible for failure handling and spreads failure semantics across every graph. The owner's position is that infrastructure failures are the platform's job, inference failures are the harness's job, and the remaining cases are either unavoidable conditions to fix and resume or bugs to fix. Explicit error or debug nodes stay on the post-1.0 list and will only be added if run inspection and node replay prove insufficient.

## Definition conversion from format 3 (internal, #164 E2)

`convertDefinitionV3ToV4` in `@graphgoblin/domain` is an asynchronous, pure definition rule for surviving ordinary loops. It returns either a refusal with issues, or a schema- and graph-validated format-4 candidate with `reviewItems` and `ready`. A candidate with `ready: false` still needs owner answers. This rule does not admit old data at runtime or compose the offline upgrade. Steps 26–28 own composition, the manifest, history, replay maps and application; #165 retires configured template instances and their loops before this rule runs.

| Frozen source               | Conversion and review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Choice expression           | Preserve the exact snippet, route IDs and labels; list removal of inactive criteria and recording controls.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Noul expression             | Automatically wrap the snippet in a once-only strict boolean check and map true/false to the original side IDs. Non-booleans still fail. This follows the owner's automatic-expression amendment to the planning table.                                                                                                                                                                                                                                                                                                            |
| Choice/Noul LLM             | Preserve provider selections, context and route IDs. Derive candidate instructions from the question and criteria; every instruction needs owner review.                                                                                                                                                                                                                                                                                                                                                                           |
| Classifier decision         | Flatten configuration; preserve answer, model, context, thresholds, recording and route IDs without recomputing probabilities or scores.                                                                                                                                                                                                                                                                                                                                                                                           |
| Expression exit check       | Preserve strict boolean behavior, including false matching. Rebind proven `lastOutput` reads to the incoming work output. Expression checks use the full thread view. Literal always-matching terminal checks simplify to terminal exits.                                                                                                                                                                                                                                                                                          |
| Classifier/LLM exit check   | Preserve primitive route identities and compare observations in a subsequent expression decision. Noul false matches, Choice sets and Score comparisons retain their meaning. Review the graph and provider state: old provider exits received bare last-output values, and classifier rejection now fails instead of falling through. Every LLM instruction and every old reported-confidence gate, including zero, has an individual review. Confidence removal requires approval.                                               |
| Loop-back                   | Keep the old exit node ID as the graph entry; create a repeat gate and Success/Failure/Exhausted terminal exits. Seed `maxPasses` from the smallest applicable old ceiling and `maxRunTimeSeconds` from the duration limit. Seed `maxNodeVisits` so it cannot undercut any gate's pass limit. Preserve existing edge IDs when translating `loopBack` to the repeat route. Review ordered-criterion timing, separate gate counters, captures and returns: limits now apply after evaluation, only on repeat.                        |
| Unconditional terminal exit | Copy mapping/channels to `returns`/`destinations`; retain outcome and identity. Removal of ignored continuation configuration needs review.                                                                                                                                                                                                                                                                                                                                                                                        |
| Output consumers            | Walk frozen Liquid/JSONata schema metadata and parsed tokens. Propose direct `answer.optionId` to `observation.routeId`, classifier `answer` to `observation.answer`, route confidence and JSONata Noul boolean rewrites where the producer is known. These proposals need review. Rewire proven work returns automatically. Review dynamic lookups, whole outputs, removed fields, aliases, captured variables, mutation pointers/literals, schemas, scripts, transforms and subloop boundaries. Literal text is not a reference. |

Review items carry the frozen source pointer, stable rule ID, node ID (null for loop settings), kind, old/proposed values, reason, status and SHA-256 binding. The binding hashes canonical JSON containing the rule revision, the entire frozen parsed definition and the item proposal. Resolutions map item IDs to `{hash, action, reason, value?}`: approve the generated proposal or replace its source/instructions/configuration. An exit-policy replacement supplies a current `{nodes, edges}` fragment, retains the original entry ID and owns its outgoing edges. Whole-configuration/graph replacements cannot overlap source replacements. Every resulting definition passes the current schema and `validateLoop`; unknown, unused, malformed or stale resolutions refuse. A reviewed unchanged opaque consumer asserts owner-supplied evidence; static analysis does not prove arbitrary script behavior.

`run.iteration` stays at 1 in fresh format-4 runs. With exactly one loop-back exit and a proven single generated repeat gate, static expression, Liquid and return reads automatically become `gates.<gateId>.passes`, with a visible `iteration-consumer` item recording old and new text. `RunManager.start` seeds every decision with `maxPasses` at `{passes: 1}` before execution, including a provider check's separate comparison gate. If an authored graph removes this gate or adds another, affected iteration items become pending and the refusal names their IDs. Each requires a source `replace` resolution, bound to the source and authored graph; approving the automatic proposal is insufficient. These particular source edits may accompany their owning graph replacement: they update generated fields retained by that graph, while explicit authored field overrides remain authoritative. With zero or several loop-back exits, iteration reads require a source resolution. Reads of `counters`, whole run objects and unproven dynamic run paths also require review. Other explicit run identity fields remain safe.

Several loop-back exits receive a dedicated `shared-iteration-budget` item on each generated gate: V3 shared one run-wide budget, whereas independent gate limits may allow more work or hit `MAX_NODE_VISITS`. A limit criterion preceding a predicate receives its own `ordered-limit` item because a gate evaluates first and checks limits only on repeat. Ignored `loopBack` fields and edges always receive an `ignored-loop-back` removal review, including exits with predicates and literal terminal checks.

Schema-based exit policies and non-repeating ordered iteration/duration limits produce a pending `exit-policy` item with a null proposal. Conversion refuses until that item's hash-bound `replace` resolution supplies a valid current `{nodes, edges}` fragment; each refusal names the exact review item ID. Approving the absent proposal is insufficient. The converter does not approximate JSON Schema with JSONata or invent historical counters. Invalid source syntax, reserved IDs, impossible topology, stale answers and malformed graphs still refuse. No definition review approves historical rewrites, provider judgments, replay entries or external effects.

## Visible execution limits and unlimited mode (#243)

The editor's Loop tab and Settings show the defaults before a run exists:
`maxNodeVisits: 10` and no run deadline (`runDeadlineSeconds: null`). Omission means the
contract default. For visits and repeat passes, `null` is an explicit Unlimited choice,
with a warning. The deadline's neutral No run deadline choice is the default; choose
Limited and enter seconds to add one. Each new run pins the effective
values in `pinned.limits`; the run inspector shows those values and its absolute deadline.
Definition changes and Settings edits cannot alter an existing run's pin.

A run deadline starts on first execution, includes waits, pauses and restart downtime,
and excludes queue time. A durable timer aborts active work or fails a parked run with
`RUN_DEADLINE_EXCEEDED` (non-resumable). Late node results cannot overwrite this outcome;
explicit Cancel remains `cancelled`. Null removes the run timer. Node `timeoutSeconds`
and authored gate `maxRunTimeSeconds` remain independent explicit controls.

Format 4 uses per-gate passes instead of shared iterations. Set `maxPasses: null` for
unlimited marked repetition; evidence records null and passes continue increasing.
The gate's authored non-repeat routes and explicit time check still apply. Disable both
loop controls, pass limits and any authored watchdogs to permit intentionally indefinite
execution, ending through authored exits, Cancel or an external/resource failure.
GraphGoblin imposes no spending, token, subscription-usage or provider-turn budget.
Authors may use script/decision nodes for their own usage-aware behavior.
