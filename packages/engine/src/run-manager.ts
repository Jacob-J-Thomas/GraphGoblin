import type {
  Caller,
  ContextThread,
  InvocationSource,
  JsonValue,
  LoopDefinition,
  LoopVersionRecord,
  Node,
  Outcome,
  ReturnChannel,
  RunEvent,
  RunFailure,
  RunRecord,
  RunStatus,
  TriggerKind,
  WaitSpec,
} from '@graphgoblin/contracts';
import { resolveHarnessModel, validateHarnessDefaults } from '@graphgoblin/domain';
import { ContextThreadSchema, DecisionEmissionSchema } from '@graphgoblin/contracts';
import {
  applyPatch,
  evaluatePredicate,
  isTerminal,
  nodeById,
  nodesOfKind,
  outcomeStatus,
  outgoingEdge,
  renderTemplate,
  replayStateAt,
  replayThread,
  stableHash,
  threadView,
  validateJson,
} from '@graphgoblin/domain';
import { AppendConflictError, RunFailureError, describeError, isAbortError } from './errors.js';
import { deciderFailure, isDeciderError } from './decider-errors.js';
import type {
  ChildOutcome,
  ChildStartRequest,
  HandlerRegistry,
  HandlerServices,
  NodeContext,
  NodeResult,
  WakeInfo,
} from './handler.js';
import { defaultHandlers } from './handlers/index.js';
import type {
  EngineSettings,
  EnginePorts,
  EventDraft,
  RunRecordChanges,
  TimerPort,
} from './ports.js';
import { createInitialThread, type InitialThreadInput } from './thread.js';

/** API-facing errors: bad requests against the run manager, never engine bugs. */
export class EngineRequestError extends Error {
  constructor(
    readonly code:
      | 'LOOP_NOT_FOUND'
      | 'VERSION_NOT_PUBLISHED'
      | 'TRIGGER_NOT_FOUND'
      | 'RUN_NOT_FOUND'
      | 'INVALID_STATE'
      | 'INVALID_INPUT'
      | 'REPLAY_NODE_NOT_REACHED',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EngineRequestError';
  }
}

export interface StartRunInput {
  ownerId: string;
  loopId: string;
  /** Defaults to the latest published version. */
  versionId?: string;
  /** Defaults to the first manual trigger, then the first trigger of any kind. */
  triggerNodeId?: string;
  triggerKind?: TriggerKind;
  source: InvocationSource;
  caller?: Caller;
  payload?: JsonValue;
  dedupeKey?: string;
  returnDefaults?: ReturnChannel[];
  parentRunId?: string;
  seed?: InitialThreadInput['seed'];
  /** Allow running a draft version (test runs). */
  allowDraft?: boolean;
  /** Subloop versions already pinned by the parent run; a child inherits them. */
  subloopVersions?: Record<string, string>;
}

export interface ReplayRunInput {
  /** The run to fork. It may be in any status. */
  runId: string;
  /** The node to start the fork at. The source run must have started it at least once. */
  nodeId: string;
  /** Who asked for the replay; replaces the source's source and caller when given. */
  source?: InvocationSource;
  caller?: Caller;
}

export interface Actor {
  kind: 'user' | 'api-key' | 'mcp-client' | 'system' | 'run';
  id: string;
}

const SYSTEM_ACTOR: Actor = { kind: 'system', id: 'engine' };
const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'running', 'waiting', 'paused'];

function triggerKindOf(node: Extract<Node, { kind: 'trigger' }>): TriggerKind {
  return node.config.subtype;
}

/**
 * Find the wake that a parked node is waiting to consume, if any: the last `run.woken` that no
 * `node.finished` (the node consumed it) or later `run.waiting` (it parked again) follows.
 * Recovery markers such as `run.started` do not consume a wake.
 */
export function findPendingWake(events: readonly RunEvent[]): WakeInfo | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (event.type === 'run.woken') {
      return {
        reason: event.reason,
        ...(event.payload !== undefined ? { payload: event.payload } : {}),
      };
    }
    if (event.type === 'node.finished' || event.type === 'run.waiting') return undefined;
  }
  return undefined;
}

type WaitingEvent = Extract<RunEvent, { type: 'run.waiting' }>;

/**
 * The wait the run is parked in according to its log: the last `run.waiting`, when nothing has
 * happened to it since (no wake, and the node has not started or finished again).
 */
export function parkedWait(events: readonly RunEvent[]): WaitingEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (event.type === 'run.waiting') return event;
    if (
      event.type === 'run.woken' ||
      event.type === 'node.started' ||
      event.type === 'node.finished'
    )
      return undefined;
  }
  return undefined;
}

type TerminalEvent = Extract<RunEvent, { type: 'run.finished' | 'run.failed' | 'run.cancelled' }>;

/** The run's terminal event, unless the run was resumed or restarted after it. */
/**
 * A wait's identity: the seq of the `node.started` that parked. Waits recorded before identities
 * existed lack it on their spec; it is then derived from the log.
 */
function waitIdentity(events: readonly RunEvent[], parked: WaitingEvent): number | undefined {
  if (parked.wait.startedSeq !== undefined) return parked.wait.startedSeq;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (event.seq < parked.seq && event.type === 'node.started' && event.nodeId === parked.nodeId)
      return event.seq;
  }
  return undefined;
}

/** The exit result a durable `run.finished` records, with the channels of the exit before it. */
function exitResult(
  def: LoopDefinition,
  events: readonly RunEvent[],
  terminal: Extract<RunEvent, { type: 'run.finished' }>,
): Extract<NodeResult, { kind: 'exit' }> {
  const exitNode = [...events]
    .reverse()
    .find(
      (e): e is Extract<RunEvent, { type: 'node.finished' }> =>
        e.type === 'node.finished' && e.seq < terminal.seq,
    );
  const node = exitNode ? nodeById(def, exitNode.nodeId) : undefined;
  const config = node?.kind === 'exit' ? node.config.return : undefined;
  return {
    kind: 'exit',
    patch: [],
    outcome: terminal.outcome,
    reason: 'recorded in the log',
    ...(terminal.result !== undefined ? { returnPayload: terminal.result } : {}),
    channels: config && config.mapping !== 'none' ? config.channels : [],
  };
}

/** Whether the log's last lifecycle event after a failure is a resume (a resume in progress). */
function pendingResume(events: readonly RunEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = (events[i] as RunEvent).type;
    if (type === 'run.resumed') return true;
    if (type === 'run.failed' || type === 'run.finished' || type === 'run.cancelled') return false;
  }
  return false;
}

export function terminalEvent(events: readonly RunEvent[]): TerminalEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (
      event.type === 'run.finished' ||
      event.type === 'run.failed' ||
      event.type === 'run.cancelled'
    )
      return event;
    if (event.type === 'run.resumed' || event.type === 'run.started') return undefined;
  }
  return undefined;
}

/** 1 for a first execution; higher when the node started before without finishing (crash or park). */
export function attemptFor(events: readonly RunEvent[], nodeId: string): number {
  let started = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (event.type === 'node.finished' && event.nodeId === nodeId) break;
    if (event.type === 'node.started' && event.nodeId === nodeId) started += 1;
  }
  return started + 1;
}

/** Fresh entries into a node so far: its `node.started` events with attempt 1. */
export function countEntries(events: readonly RunEvent[], nodeId: string): number {
  let entries = 0;
  for (const event of events) {
    if (event.type === 'node.started' && event.nodeId === nodeId && event.attempt === 1) {
      entries += 1;
    }
  }
  return entries;
}

/** The subloop versions a run pinned when it was created (its `run.queued` event). */
export function pinnedSubloops(events: readonly RunEvent[]): Record<string, string> {
  const queued = events.find((e) => e.type === 'run.queued');
  return queued?.type === 'run.queued' ? { ...(queued.subloopVersions ?? {}) } : {};
}

type NodeFinishedEvent = Extract<RunEvent, { type: 'node.finished' }>;

/** The last `node.finished` when it is the log's last node event (no node started after it). */
function lastFinishedNode(
  events: readonly RunEvent[],
): { event: NodeFinishedEvent; index: number } | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (event.type === 'node.started') return undefined;
    if (event.type === 'node.finished') return { event, index: i };
  }
  return undefined;
}

/**
 * The timer port a node visit sees: its keys carry the visit's `node.started` seq (`timer@42`),
 * the identity its wait spec records, so a fire can be matched to the wait that armed it.
 * Cancelling without a key still drops every timer of the run.
 */
function timersForVisit(timers: TimerPort, startedSeq: number): TimerPort {
  return {
    schedule: (runId, key, at) => timers.schedule(runId, `${key}@${startedSeq}`, at),
    cancel: (runId, key) =>
      timers.cancel(runId, key === undefined ? undefined : `${key}@${startedSeq}`),
    onFire: (listener) => timers.onFire(listener),
  };
}

export class RunManager {
  private readonly queue: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly recovering = new Set<string>();
  /** Runs enqueued while their executor was still active: queued again once it returns. */
  private readonly requeue = new Set<string>();
  /** Serializes subloop pinning in `startRun` with loop deletion. */
  private pinLock: Promise<unknown> = Promise.resolve();
  /** Per-run serialization of finalization and failed-run resume (`withRunLock`). */
  private readonly runLocks = new Map<string, Promise<unknown>>();
  private readonly directories = new Map<string, string>();
  private idleWaiters: (() => void)[] = [];
  private unsubscribeTimers: (() => void) | undefined;
  private stopped = false;

  constructor(
    private readonly ports: EnginePorts,
    private readonly settings: EngineSettings,
    private readonly handlers: HandlerRegistry = defaultHandlers(),
  ) {}

  /** Arm timers and recover runs left active by a previous process. */
  async start(): Promise<void> {
    this.stopped = false;
    // A failed wake is rethrown so the timer port keeps the timer and delivers it again.
    this.unsubscribeTimers ??= this.ports.timers.onFire((runId, key) =>
      this.onTimer(runId, key).catch((error: unknown) => {
        this.ports.logger.error({ runId, key, error: describeError(error) }, 'timer wake failed');
        throw error;
      }),
    );
    await this.recover();
    this.tick();
  }

  /** Stop picking up new work. Active nodes finish; runs stay recoverable. */
  stop(): void {
    this.stopped = true;
    this.unsubscribeTimers?.();
    this.unsubscribeTimers = undefined;
  }

  /** Resolves when nothing is queued or executing. */
  waitForIdle(): Promise<void> {
    if (this.queue.length === 0 && this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async startRun(input: StartRunInput): Promise<RunRecord> {
    const version = await this.resolveVersion(input);
    const def = version.definition;
    const trigger = this.resolveTrigger(def, input.triggerNodeId);
    const payload: JsonValue = input.payload ?? null;
    if (trigger.config.subtype === 'manual' && trigger.config.inputSchema) {
      const validation = validateJson(trigger.config.inputSchema, payload);
      if (!validation.ok) {
        throw new EngineRequestError(
          'INVALID_INPUT',
          `trigger input is invalid: ${validation.errors.join('; ')}`,
          { errors: validation.errors },
        );
      }
    }
    const now = this.now();
    const runId = this.ports.ids.next();
    const invocationId = this.ports.ids.next();
    const thread = createInitialThread({
      runId,
      loopId: version.loopId,
      versionId: version.id,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      invocation: {
        id: invocationId,
        source: input.source,
        ...(input.caller ? { caller: input.caller } : {}),
        trigger: {
          nodeId: trigger.id,
          kind: input.triggerKind ?? triggerKindOf(trigger),
          payload,
          receivedAt: now,
          ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
        },
        ...(input.returnDefaults ? { returnDefaults: input.returnDefaults } : {}),
      },
      ...(input.seed ? { seed: input.seed } : {}),
    });
    const run: RunRecord = {
      id: runId,
      ownerId: input.ownerId,
      loopId: version.loopId,
      versionId: version.id,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      invocationId,
      status: 'queued',
      iteration: 1,
      createdAt: now,
      lastEventSeq: 0,
    };
    // Pinning and recording the run are one critical section with loop deletion
    // (`deleteLoopUnlessInUse`): a loop is either deleted before the run pins it (the run then
    // fails at that subloop) or pinned before the deletion checks, which then refuses.
    await this.withPinLock(async () => {
      // The run's own version was resolved before the lock: a deletion may have won meanwhile.
      await this.assertVersionPresent(version.id, input.loopId);
      const subloopVersions = await this.pinSubloops(def, input.subloopVersions ?? {});
      await this.ports.runs.create(run, thread);
      await this.ports.events.append(runId, [
        {
          type: 'run.queued',
          initialThread: thread,
          ...(Object.keys(subloopVersions).length > 0 ? { subloopVersions } : {}),
        },
      ]);
    });
    this.enqueue(runId);
    return run;
  }

  /**
   * Delete a loop unless an active run can still start it (`loopInUse`), atomically with run
   * creation: `remove` runs inside the same critical section that pins subloops in `startRun`.
   * Returns false, without calling `remove`, when the loop is in use. In-process: one API process
   * per data directory (docs/05).
   */
  async deleteLoopUnlessInUse(loopId: string, remove: () => Promise<void>): Promise<boolean> {
    return this.withPinLock(async () => {
      if (await this.loopInUse(loopId)) return false;
      await remove();
      return true;
    });
  }

  private withPinLock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pinLock.then(work);
    this.pinLock = result.catch(() => undefined);
    return result;
  }

  /**
   * Serializes the finalization of a run's terminal outcome with a resume of that run: a resume
   * waits for an in-flight finalizer, so the finalizer of an earlier outcome can never set the
   * marker the resume clears for the next one.
   */
  private withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve();
    const result = previous.then(work);
    const tail = result.catch(() => undefined);
    this.runLocks.set(runId, tail);
    void tail.then(() => {
      if (this.runLocks.get(runId) === tail) this.runLocks.delete(runId);
    });
    return result;
  }

  async cancel(runId: string, actor: Actor = SYSTEM_ACTOR): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    if (isTerminal(run.status)) {
      throw new EngineRequestError('INVALID_STATE', `run ${runId} is already ${run.status}`);
    }
    // Compare-and-set on the request itself: only the first of concurrent cancels records it.
    const claimed = await this.ports.runs.claimCancel(runId, ACTIVE_STATUSES, this.now());
    if (!claimed) {
      // Already requested (by a concurrent call, which may have finished it by now): the same
      // outcome, without a second audit event. Otherwise the run became terminal meanwhile.
      const current = await this.mustGet(runId);
      if (!current.cancelRequestedAt) {
        throw new EngineRequestError('INVALID_STATE', `run ${runId} is already ${current.status}`);
      }
      return current;
    }
    await this.ports.events.append(runId, [{ type: 'run.cancel_requested', actor }]);
    const controller = this.active.get(runId);
    if (controller) {
      controller.abort(new Error('run cancelled'));
      return this.mustGet(runId);
    }
    this.dequeue(runId);
    return this.finalizeCancel(runId);
  }

  async pause(runId: string, actor: Actor = SYSTEM_ACTOR): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    const updated = await this.ports.runs.transition(runId, ['queued', 'running', 'waiting'], {
      status: 'paused',
      pausedAt: this.now(),
    });
    if (!updated) {
      throw new EngineRequestError('INVALID_STATE', `cannot pause a run that is ${run.status}`);
    }
    await this.ports.events.append(runId, [{ type: 'run.paused', actor }]);
    this.dequeue(runId);
    return updated;
  }

  async resume(runId: string, actor: Actor = SYSTEM_ACTOR): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    // Paused while parked (or while parking): go back to waiting rather than re-running the node,
    // so a wait keeps its deadline and a subloop keeps its child. Anything that should have woken
    // it meanwhile is delivered now: its timers are re-armed and a finished child reconciled.
    if (run.status === 'paused' && run.waiting) {
      const parked = parkedWait(await this.ports.events.read(runId));
      if (parked) {
        const waiting = await this.ports.runs.transition(runId, ['paused'], {
          status: 'waiting',
          pausedAt: undefined,
        });
        if (!waiting) {
          throw new EngineRequestError(
            'INVALID_STATE',
            `cannot resume a run that is ${run.status}`,
          );
        }
        await this.ports.events.append(runId, [{ type: 'run.resumed', actor }]);
        if (waiting.waiting) await this.rearmTimers(runId, waiting.waiting);
        await this.reconcileChild(waiting);
        return this.mustGet(runId);
      }
    }
    if (run.status === 'failed' && run.failure?.resumable) {
      // Leaving a terminal status: the intent is written first, like every terminal transition.
      // The finalization marker of the failure is cleared so the run's next terminal outcome is
      // finalized again; recovery completes a resume whose `run.resumed` is durable. It waits for
      // any finalizer of the failure still in flight, which would otherwise set the marker again.
      // The failure this command saw: its terminal event. Inside the lock the run must still be
      // in that same resumable failure, or the command lost to another one (a concurrent resume,
      // and possibly a newer outcome) and is rejected before it writes anything.
      const observed = terminalEvent(await this.ports.events.read(runId))?.seq;
      const resumed = await this.withRunLock(runId, async () => {
        const current = await this.mustGet(runId);
        const terminal = terminalEvent(await this.ports.events.read(runId));
        if (
          current.status !== 'failed' ||
          !current.failure?.resumable ||
          terminal?.seq !== observed
        ) {
          return undefined;
        }
        await this.ports.runs.clearFinalized(runId);
        await this.ports.events.append(runId, [{ type: 'run.resumed', actor }]);
        return this.completeResume(runId);
      });
      if (!resumed) {
        throw new EngineRequestError('INVALID_STATE', `cannot resume a run that is ${run.status}`);
      }
      return resumed;
    }
    const expected: RunStatus[] = ['paused'];
    const updated = await this.ports.runs.transition(runId, expected, {
      status: 'running',
      pausedAt: undefined,
      failure: undefined,
      finishedAt: undefined,
    });
    if (!updated) {
      throw new EngineRequestError('INVALID_STATE', `cannot resume a run that is ${run.status}`);
    }
    await this.ports.events.append(runId, [{ type: 'run.resumed', actor }]);
    this.enqueue(runId);
    return updated;
  }

  /** Move a failed run whose resume is durable back to running and queue it. */
  private async completeResume(runId: string): Promise<RunRecord | undefined> {
    const updated = await this.ports.runs.transition(runId, ['failed'], {
      status: 'running',
      pausedAt: undefined,
      failure: undefined,
      finishedAt: undefined,
    });
    if (updated) this.enqueue(runId);
    return updated;
  }

  async provideInput(
    runId: string,
    payload: JsonValue,
    actor: Actor = SYSTEM_ACTOR,
  ): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    if (run.status !== 'waiting' || run.waiting?.kind !== 'input') {
      throw new EngineRequestError('INVALID_STATE', `run ${runId} is not waiting for input`);
    }
    if (run.waiting.inputSchema) {
      const validation = validateJson(run.waiting.inputSchema, payload);
      if (!validation.ok) {
        throw new EngineRequestError(
          'INVALID_INPUT',
          `input is invalid: ${validation.errors.join('; ')}`,
          { errors: validation.errors },
        );
      }
    }
    void actor;
    return this.wake(runId, { reason: 'input', payload });
  }

  /** Deliver a named signal. Always recorded; wakes the run only when it waits for that signal and the filter passes. */
  async signal(
    runId: string,
    name: string,
    payload: JsonValue = null,
  ): Promise<{ run: RunRecord; woke: boolean }> {
    const run = await this.mustGet(runId);
    if (isTerminal(run.status)) {
      throw new EngineRequestError('INVALID_STATE', `run ${runId} is already ${run.status}`);
    }
    await this.ports.events.append(runId, [{ type: 'signal.received', name, payload }]);
    if (
      run.status !== 'waiting' ||
      run.waiting?.kind !== 'signal' ||
      run.waiting.signalName !== name
    ) {
      return { run, woke: false };
    }
    const version = await this.ports.loops.getVersion(run.versionId);
    const node = version ? nodeById(version.definition, run.waiting.nodeId) : undefined;
    if (node?.kind === 'wait' && node.config.mode === 'signal' && node.config.filter) {
      const thread = await this.getThread(runId);
      const passes = await evaluatePredicate(node.config.filter, payload, {
        bindings: { thread: thread ? threadView(thread) : {} },
      });
      if (!passes) return { run, woke: false };
    }
    return { run: await this.wake(runId, { reason: 'signal', payload }), woke: true };
  }

  /**
   * Replay-at-node: fork a new run on the source's loop version and trigger envelope whose thread
   * is the source thread as it was just before `nodeId` first started, and which starts executing
   * at `nodeId`. The fork has its own id and event log; the source is untouched, and its child
   * runs are not copied (a subloop node in the fork starts a new child).
   */
  async replay(input: ReplayRunInput): Promise<RunRecord> {
    const source = await this.mustGet(input.runId);
    const events = await this.ports.events.read(source.id);
    const firstStart = events.find(
      (e): e is Extract<RunEvent, { type: 'node.started' }> =>
        e.type === 'node.started' && e.nodeId === input.nodeId,
    );
    if (!firstStart) {
      throw new EngineRequestError(
        'REPLAY_NODE_NOT_REACHED',
        `run ${source.id} never started node ${input.nodeId}`,
      );
    }
    const version = await this.ports.loops.getVersion(source.versionId);
    if (!version || !nodeById(version.definition, input.nodeId)) {
      throw new EngineRequestError(
        'INVALID_STATE',
        `node ${input.nodeId} is not in loop version ${source.versionId}`,
      );
    }
    const initial = await this.ports.runs.getInitialThread(source.id);
    if (!initial) {
      throw new EngineRequestError('INVALID_STATE', `run ${source.id} has no initial thread`);
    }
    const before = replayThread(initial, events, firstStart.seq - 1);
    const runId = this.ports.ids.next();
    const invocationId = this.ports.ids.next();
    const replayOf = { runId: source.id, nodeId: input.nodeId };
    // The fork keeps the trigger envelope (the input) but not the original caller's extra return
    // channels: those belong to whoever started the source run.
    const { returnDefaults: _dropped, ...invocation } = initial.invocation;
    const thread: ContextThread = {
      ...before,
      run: {
        id: runId,
        loopId: source.loopId,
        versionId: source.versionId,
        iteration: before.run.iteration,
      },
      invocation: {
        ...invocation,
        id: invocationId,
        ...(input.source ? { source: input.source } : {}),
        ...(input.caller ? { caller: input.caller } : {}),
        replayOf,
      },
    };
    const run: RunRecord = {
      id: runId,
      ownerId: source.ownerId,
      loopId: source.loopId,
      versionId: source.versionId,
      invocationId,
      status: 'queued',
      currentNodeId: input.nodeId,
      iteration: before.run.iteration,
      createdAt: this.now(),
      lastEventSeq: 0,
    };
    // The fork keeps the source's subloop pins: a replay re-runs the source's graph, not a newer one.
    const subloopVersions = pinnedSubloops(events);
    // Admitted in the same critical section as run creation and loop deletion: a fork either
    // registers (and pins) before a deletion checks, which then refuses, or after it, when the
    // version it would run must still exist.
    await this.withPinLock(async () => {
      await this.assertVersionPresent(source.versionId, source.loopId);
      await this.ports.runs.create(run, thread);
      await this.ports.events.append(runId, [
        {
          type: 'run.queued',
          replayOf,
          ...(Object.keys(subloopVersions).length > 0 ? { subloopVersions } : {}),
        },
      ]);
    });
    this.enqueue(runId);
    return run;
  }

  /** Inside the pin lock: the version a new run will execute still exists. */
  private async assertVersionPresent(versionId: string, loopId: string): Promise<void> {
    if (!(await this.ports.loops.getVersion(versionId))) {
      throw new EngineRequestError('LOOP_NOT_FOUND', `loop ${loopId} was deleted`);
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Whether an active run (queued, running, waiting, or paused) can still start a run of
   * `loopId`: it is a run of that loop, its pins name it, or its version reaches it through
   * subloop references. Deleting the loop would make such a run fail, so the API refuses it.
   */
  async loopInUse(loopId: string): Promise<boolean> {
    for (const run of await this.ports.runs.listByStatus(ACTIVE_STATUSES)) {
      if (run.loopId === loopId) return true;
      // Pins are on run.queued, the first event: read that one, not the run's whole history.
      const pins = pinnedSubloops(await this.ports.events.read(run.id, 0, 1));
      if (loopId in pins) return true;
      const version = await this.ports.loops.getVersion(run.versionId);
      const reached = new Set<string>();
      if (version) await this.pinSubloops(version.definition, pins, reached);
      if (reached.has(loopId)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Queries (runs)
  // ---------------------------------------------------------------------------

  getRun(runId: string): Promise<RunRecord | undefined> {
    return this.ports.runs.get(runId);
  }

  /** Current thread: the snapshot when present, otherwise a replay of the log. */
  async getThread(runId: string): Promise<ContextThread | undefined> {
    const snapshot = await this.ports.runs.getThread(runId);
    if (snapshot) return snapshot;
    const initial = await this.ports.runs.getInitialThread(runId);
    if (!initial) return undefined;
    return replayThread(initial, await this.ports.events.read(runId));
  }

  // ---------------------------------------------------------------------------
  // Internals: scheduling
  // ---------------------------------------------------------------------------

  private enqueue(runId: string): void {
    if (this.active.has(runId)) {
      // A wake or resume that lands while the executor is still returning (a child finishing as
      // its parent parks): run again once it has, or the run would sit in `running` unexecuted.
      this.requeue.add(runId);
      return;
    }
    if (this.queue.includes(runId)) return;
    this.queue.push(runId);
    this.tick();
  }

  private dequeue(runId: string): void {
    const index = this.queue.indexOf(runId);
    if (index >= 0) this.queue.splice(index, 1);
    this.requeue.delete(runId);
  }

  private tick(): void {
    if (this.stopped) return;
    while (this.active.size < this.settings.maxConcurrentRuns && this.queue.length > 0) {
      const runId = this.queue.shift() as string;
      const controller = new AbortController();
      this.active.set(runId, controller);
      void this.execute(runId, controller)
        .catch((error: unknown) => {
          this.ports.logger.error(
            { runId, error: describeError(error) },
            'executor crashed outside node execution',
          );
          return this.failRun(runId, {
            code: 'INTERNAL_ERROR',
            message: describeError(error),
            resumable: true,
          }).catch(() => undefined);
        })
        .then(() => this.afterExecute(runId))
        .catch((error: unknown) => {
          this.ports.logger.error(
            { runId, error: describeError(error) },
            'post-execution cancellation failed',
          );
        })
        .finally(() => {
          this.active.delete(runId);
          if (this.requeue.delete(runId) && !this.queue.includes(runId)) this.queue.push(runId);
          this.tick();
          this.notifyIdle();
        });
    }
    this.notifyIdle();
  }

  private notifyIdle(): void {
    if (this.queue.length === 0 && this.active.size === 0 && this.idleWaiters.length > 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private async recover(): Promise<void> {
    // Terminal runs whose finalization (timers, children, returns, parent) never completed.
    for (const run of await this.ports.runs.listUnfinalized()) {
      // A failed run whose `run.resumed` is durable but whose status write was lost: resume it.
      if (run.status === 'failed' && pendingResume(await this.ports.events.read(run.id))) {
        await this.completeResume(run.id);
        continue;
      }
      await this.finalizeTerminal(run.id).catch((error: unknown) => {
        this.ports.logger.error({ runId: run.id, error: describeError(error) }, 'finalize failed');
      });
    }
    const runs = await this.ports.runs.listByStatus(['queued', 'running', 'waiting', 'paused']);
    for (const run of runs) {
      const events = await this.ports.events.read(run.id);
      if (terminalEvent(events)) {
        // The terminal event is durable but the status write was lost: the executor completes it.
        this.recovering.add(run.id);
        this.enqueue(run.id);
        continue;
      }
      if (run.cancelRequestedAt) {
        await this.finalizeCancel(run.id);
        continue;
      }
      if (run.status === 'queued' || run.status === 'running') {
        if (run.status === 'running') this.recovering.add(run.id);
        this.enqueue(run.id);
      } else if (run.status === 'waiting' && run.waiting) {
        if (findPendingWake(events)) {
          // A wake is durable but the waiting-to-running write was lost: finish accepting it.
          if (await this.ports.runs.transition(run.id, ['waiting'], { status: 'running' })) {
            this.enqueue(run.id);
          }
          continue;
        }
        // A wait recorded before waits had an identity: give it one (the seq of the node.started
        // that parked, from the log) and replace its bare timer keys, so a stale bare timer can
        // never wake a later wait.
        let waiting = run.waiting;
        if (waiting.startedSeq === undefined) {
          const parked = parkedWait(events);
          const startedSeq = parked ? waitIdentity(events, parked) : undefined;
          if (startedSeq !== undefined) {
            waiting = { ...waiting, startedSeq };
            await this.ports.runs.update(run.id, { waiting });
            await this.ports.timers.cancel(run.id);
          }
        }
        // Waiting runs are woken by timers, inputs, signals, or finishing children. Re-arm the
        // wait's timers from its spec in case a fire was lost (an upsert, so an armed timer stays
        // as it is), and deliver a child outcome that finished while this process was down.
        await this.rearmTimers(run.id, waiting);
        await this.reconcileChild(run);
      }
    }
  }

  /**
   * Arm the timers a wait spec records: its own (`timer` or `heartbeat`, at `until`) and its
   * timeout (`timeoutAt`; for a log written before that field, an input or signal wait's
   * `until`). Keys carry the wait's identity when the spec has one.
   */
  private async rearmTimers(runId: string, wait: WaitSpec): Promise<void> {
    const suffix = wait.startedSeq !== undefined ? `@${wait.startedSeq}` : '';
    const own = wait.kind === 'timer' || wait.kind === 'heartbeat';
    if (own && wait.until) {
      await this.ports.timers.schedule(runId, `${wait.kind}${suffix}`, new Date(wait.until));
    }
    const timeoutAt =
      wait.timeoutAt ?? (wait.kind === 'input' || wait.kind === 'signal' ? wait.until : undefined);
    if (timeoutAt) await this.ports.timers.schedule(runId, `timeout${suffix}`, new Date(timeoutAt));
  }

  /** Wake a parent parked on a child that is already terminal. Idempotent. */
  private async reconcileChild(parent: RunRecord): Promise<void> {
    const childRunId = parent.waiting?.kind === 'child' ? parent.waiting.childRunId : undefined;
    if (!childRunId) return;
    const child = await this.ports.runs.get(childRunId);
    if (child && isTerminal(child.status))
      await this.notifyParent(child, child.status, child.outcome);
  }

  /**
   * A timer fired. Keys are `<name>@<startedSeq>`: the wait that armed it. Delivery is at least
   * once and a fire can be stale (its wait already ended), so the wake is checked against the
   * wait it was armed for, atomically (`wake`), and a stale fire does nothing. `timer` and
   * `heartbeat` only wake a wait of that kind. A key without an identity (armed before identities
   * existed) only wakes a wait that has none either; recovery gives such waits one and re-keys.
   */
  private async onTimer(runId: string, key: string): Promise<void> {
    const [name = key, identity] = key.split('@');
    const startedSeq = identity !== undefined ? Number(identity) : undefined;
    const run = await this.ports.runs.get(runId);
    if (!run || run.status !== 'waiting' || !run.waiting) return;
    if (startedSeq !== run.waiting.startedSeq) return;
    if (name !== 'timeout' && name !== run.waiting.kind) return;
    try {
      await this.wake(
        runId,
        { reason: name === 'timeout' ? 'timeout' : 'timer', key: name },
        startedSeq,
      );
    } catch (error) {
      // Lost a race to another wake or a pause: nothing left to deliver.
      if (!(error instanceof EngineRequestError && error.code === 'INVALID_STATE')) throw error;
    }
  }

  /**
   * Accept a wake. The log is written first: `run.woken` (with `input.received` for an input) is
   * appended only if the log is exactly as read, the run's current wait in the log is the expected
   * one (`startedSeq`, when given), and nothing woke it yet. That conditional append is the
   * compare-and-set: of concurrent wakes exactly one is recorded, payload and all. The status then
   * moves from waiting to running; if the process dies in between, recovery finds the durable wake
   * and completes the move.
   */
  private async wake(runId: string, wake: WakeInfo, startedSeq?: number): Promise<RunRecord> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const run = await this.mustGet(runId);
      if (run.status !== 'waiting' || !run.waiting || run.cancelRequestedAt) {
        throw new EngineRequestError('INVALID_STATE', `run ${runId} is not waiting`);
      }
      const after = run.waiting.startedSeq !== undefined ? run.waiting.startedSeq - 1 : 0;
      const events = await this.ports.events.read(runId, after);
      const parked = parkedWait(events);
      if (!parked || (startedSeq !== undefined && waitIdentity(events, parked) !== startedSeq)) {
        // An earlier wake is durable but its status write failed: finish that one, not this.
        if (findPendingWake(events)) {
          if (await this.ports.runs.transition(runId, ['waiting'], { status: 'running' })) {
            this.enqueue(runId);
          }
        }
        throw new EngineRequestError('INVALID_STATE', `run ${runId} is not waiting for that`);
      }
      const nodeId = parked.wait.nodeId;
      try {
        await this.ports.events.append(
          runId,
          [
            ...(wake.reason === 'input'
              ? [{ type: 'input.received' as const, nodeId, payload: wake.payload ?? null }]
              : []),
            {
              type: 'run.woken',
              nodeId,
              reason: wake.reason,
              ...(wake.payload !== undefined ? { payload: wake.payload } : {}),
            },
          ],
          { expectedLastSeq: events.at(-1)?.seq ?? after },
        );
      } catch (error) {
        if (error instanceof AppendConflictError) continue;
        throw error;
      }
      const updated = await this.ports.runs.transition(runId, ['waiting'], { status: 'running' });
      // Paused or cancelled in between: the wake stays in the log for resume to consume.
      if (updated) this.enqueue(runId);
      return updated ?? this.mustGet(runId);
    }
    throw new EngineRequestError('INVALID_STATE', `run ${runId} kept changing; try again`);
  }

  /** After an executor pass: honour a cancel request that arrived while the run was parking or finishing. */
  private async afterExecute(runId: string): Promise<void> {
    const run = await this.ports.runs.get(runId);
    if (run && !isTerminal(run.status) && run.cancelRequestedAt) await this.finalizeCancel(runId);
  }

  // ---------------------------------------------------------------------------
  // Internals: execution
  // ---------------------------------------------------------------------------

  private async execute(runId: string, controller: AbortController): Promise<void> {
    let run = await this.mustGet(runId);
    const version = await this.ports.loops.getVersion(run.versionId);
    const events: RunEvent[] = await this.ports.events.read(runId);
    // A terminal event is durable but its status write was lost: complete it, run nothing. This
    // comes before anything that could record a second terminal event.
    if (await this.completeFromLog(run, version?.definition, events)) return;
    if (!version) {
      await this.failRun(runId, {
        code: 'INTERNAL_ERROR',
        message: `loop version ${run.versionId} not found`,
        resumable: false,
      });
      return;
    }
    const def = version.definition;
    // Owner defaults are read at every (re)start, so a change in settings applies to the next run.
    const ownerDefaults = (await this.settings.ownerDefaults?.(run.ownerId)) ?? { byHarness: {} };
    // Read before any recovery marker is appended; a marker does not consume a wake either.
    const pendingWake = findPendingWake(events);
    let thread = await this.loadThread(run, events);
    /** Append drafts atomically and return the seq of the last one. */
    const appendAll = async (drafts: EventDraft[]): Promise<number> => {
      for (const draft of drafts)
        if (draft.type === 'decision.made') {
          const { type: _type, nodeId: _nodeId, ...evidence } = draft;
          DecisionEmissionSchema.parse(evidence);
        }
      const stored = await this.ports.events.append(runId, drafts);
      events.push(...stored);
      return (stored.at(-1) as RunEvent).seq;
    };
    const append = async (draft: EventDraft): Promise<void> => {
      await appendAll([draft]);
    };

    const started = await this.ports.runs.transition(runId, ['queued'], {
      status: 'running',
      startedAt: this.now(),
    });
    if (started) {
      run = started;
      await append({ type: 'run.started', attempt: 1 });
    } else {
      run = await this.mustGet(runId);
      if (run.status !== 'running') {
        this.recovering.delete(runId);
        return; // paused or cancelled between enqueue and execution
      }
      if (!run.startedAt) {
        // A paused-while-queued run that was resumed: this is its first real start.
        run = await this.ports.runs.update(runId, { startedAt: this.now() });
        await append({ type: 'run.started', attempt: 1 });
      } else if (this.recovering.delete(runId)) {
        const previousStarts = events.filter((e) => e.type === 'run.started').length;
        await append({ type: 'run.started', attempt: previousStarts + 1 });
      }
    }

    // The log is the source of truth for the cursor: a crash between a durable `node.finished` and
    // the cursor write must not run the finished node again.
    const caughtUp = await this.catchUpCursor(run, def, events);
    if (caughtUp) {
      run = caughtUp.run;
      thread = { ...thread, run: { ...thread.run, iteration: run.iteration } };
    }

    let nodeId = run.currentNodeId ?? thread.invocation.trigger.nodeId;
    let wake = pendingWake;
    let previousWait = run.waiting;

    const services: HandlerServices = {
      render: (template, extras = {}) =>
        renderTemplate(template, {
          ...(threadView(thread) as unknown as Record<string, unknown>),
          ...extras,
        }),
      record: append,
      resolveModel: async (harness, model, effort) => {
        const catalog = await this.ports.modelCatalog.list();
        const issues = validateHarnessDefaults({
          loopDefaults: def.settings.defaults,
          ownerDefaults,
          processDefaults: this.settings.defaults,
          catalog,
        });
        if (issues.length) {
          const restorable = issues.every(
            (issue) => issue.resolution.code === 'MODEL_NOT_IN_CATALOG',
          );
          throw new RunFailureError(
            restorable ? 'EVALUATION_UNAVAILABLE' : 'EVALUATION_INVALID_CONFIGURATION',
            issues[0]!.resolution.message,
            { resumable: restorable, details: issues },
          );
        }
        const resolution = resolveHarnessModel({
          harness,
          ...(model !== undefined ? { model } : {}),
          ...(effort !== undefined ? { effort } : {}),
          loopDefaults: def.settings.defaults,
          ownerDefaults,
          processDefaults: this.settings.defaults,
          catalog,
        });
        if (resolution.status !== 'ready') {
          const restorable =
            resolution.status === 'unavailable' || resolution.code === 'MODEL_NOT_IN_CATALOG';
          throw new RunFailureError(
            restorable ? 'EVALUATION_UNAVAILABLE' : 'EVALUATION_INVALID_CONFIGURATION',
            resolution.message,
            { resumable: restorable, details: { code: resolution.code, path: resolution.path } },
          );
        }
        return { model: resolution.model, effort: resolution.effort };
      },
      startChild: (request) => this.startChild(run, request, pinnedSubloops(events)),
      childOutcome: (childRunId) => this.childOutcome(childRunId),
      events: () => Promise.resolve(events),
      depth: () => this.depthOf(run),
      workingDirectory: () => this.workingDirectory(run, def, thread),
      newId: () => this.ports.ids.next(),
      now: () => this.now(),
    };

    for (;;) {
      // Yield to the event loop between nodes. With fast ports every await settles as a microtask,
      // so a graph cycle (a decision routing back to itself) would otherwise starve timers, API
      // requests, and the very cancel request that could stop it.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // Re-read after the yield: a pause or cancel may have landed while this run was parked.
      const current = await this.mustGet(runId);
      if (controller.signal.aborted || current.cancelRequestedAt) {
        await this.finalizeCancel(runId);
        return;
      }
      if (current.status === 'paused') return;
      const node = nodeById(def, nodeId);
      if (!node) {
        await this.failRun(runId, {
          code: 'INTERNAL_ERROR',
          message: `node ${nodeId} not found in loop version`,
          resumable: false,
        });
        return;
      }
      const attempt = attemptFor(events, nodeId);
      // Visit cap (docs/05): a fresh entry (attempt 1; wakes, retries, and resumes re-enter with a
      // higher attempt) beyond `maxIterations` fails the run, which bounds graph cycles that never
      // pass through an exit loop-back.
      if (attempt === 1 && countEntries(events, nodeId) >= def.settings.maxIterations) {
        await this.failRun(runId, {
          code: 'MAX_ITERATIONS',
          message: `node "${nodeId}" would start for visit ${def.settings.maxIterations + 1}, above the loop's maxIterations of ${def.settings.maxIterations}`,
          nodeId,
          resumable: false,
          details: { maxIterations: def.settings.maxIterations },
        });
        return;
      }
      // The seq of this node.started identifies the visit, and any wait it parks in.
      const startedSeq = await appendAll([
        {
          type: 'node.started',
          nodeId,
          kind: node.kind,
          attempt,
          configHash: stableHash(node.config),
        },
      ]);
      run = await this.ports.runs.update(runId, { currentNodeId: nodeId });
      thread = {
        ...thread,
        counters: {
          ...thread.counters,
          nodeVisits: {
            ...thread.counters.nodeVisits,
            [nodeId]: (thread.counters.nodeVisits[nodeId] ?? 0) + 1,
          },
        },
      };

      const startedAt = Date.now();
      let result: NodeResult;
      try {
        const handler = this.handlers[node.kind];
        const ctx: NodeContext = {
          node,
          config: node.config,
          definition: def,
          thread,
          run,
          attempt,
          ...(wake ? { wake } : {}),
          ...(previousWait ? { previousWait } : {}),
          signal: controller.signal,
          ports: { ...this.ports, timers: timersForVisit(this.ports.timers, startedSeq) },
          settings: this.settings,
          services,
        };
        result = await (handler as { execute(c: NodeContext): Promise<NodeResult> }).execute(ctx);
      } catch (error) {
        const terminationUnconfirmed =
          error instanceof RunFailureError && error.code === 'HARNESS_TERMINATION_UNCONFIRMED';
        if (!terminationUnconfirmed && (isAbortError(error) || controller.signal.aborted)) {
          await this.finalizeCancel(runId);
          return;
        }
        const providerFailure =
          !(error instanceof RunFailureError) && isDeciderError(error)
            ? deciderFailure(error)
            : undefined;
        const failure: RunFailure =
          error instanceof RunFailureError
            ? error.toFailure(nodeId)
            : {
                code: 'INTERNAL_ERROR',
                message: providerFailure?.message ?? describeError(error),
                nodeId,
                resumable: true,
                details:
                  providerFailure?.details ??
                  (error instanceof Error
                    ? {
                        name: error.name,
                        stack: error.stack ?? null,
                      }
                    : null),
              };
        if (providerFailure)
          this.ports.logger.warn(
            { runId, nodeId, ...providerFailure.diagnostic },
            'node provider failed',
          );
        else this.ports.logger.error({ runId, nodeId, failure }, 'node failed');
        await this.failRun(runId, failure);
        return;
      }
      const durationMs = Date.now() - startedAt;

      if (result.kind === 'park') {
        const wait: WaitSpec = { ...result.wait, startedSeq };
        const seq = await appendAll([{ type: 'run.waiting', nodeId, wait }]);
        await this.ports.runs.saveThread(runId, thread, seq);
        const parked = await this.ports.runs.transition(runId, ['running'], {
          status: 'waiting',
          waiting: wait,
        });
        // Paused while the node was parking: keep the pause, remember the wait so resume re-parks.
        if (!parked) await this.ports.runs.update(runId, { waiting: wait });
        // A child that finished before this park found its parent still running and could not
        // wake it; now that the wait is recorded, deliver its outcome here.
        else await this.reconcileChild(parked);
        return;
      }

      // done, loop-back, exit: apply the patch and record the node as finished.
      try {
        thread = ContextThreadSchema.parse(applyPatch(thread, result.patch));
      } catch (error) {
        await this.failRun(runId, {
          code: 'INTERNAL_ERROR',
          message: `node ${nodeId} produced an invalid patch: ${describeError(error)}`,
          nodeId,
          resumable: false,
        });
        return;
      }
      const route =
        result.kind === 'done'
          ? result.route
          : result.kind === 'loop-back'
            ? 'loopBack'
            : undefined;
      const finishedDraft: EventDraft = {
        type: 'node.finished',
        nodeId,
        patch: result.patch,
        ...(route ? { route } : {}),
        durationMs,
      };
      wake = undefined;
      previousWait = undefined;

      if (result.kind === 'exit') {
        // The exit's completion and the run's outcome are one append: recovery never has to
        // evaluate an exit again to learn what it decided.
        const status = outcomeStatus(result.outcome);
        const seq = await appendAll([
          finishedDraft,
          {
            type: 'run.finished',
            status,
            outcome: result.outcome,
            ...(result.returnPayload !== undefined ? { result: result.returnPayload } : {}),
          },
        ]);
        await this.ports.runs.saveThread(runId, thread, seq);
        await this.finish(run, def, thread, result);
        return;
      }

      if (result.kind === 'loop-back') {
        const from = run.iteration;
        const to = from + 1;
        thread = { ...thread, run: { ...thread.run, iteration: to } };
        // The loop-back and its iteration are one append, so neither is ever recorded alone.
        const seq = await appendAll([
          finishedDraft,
          { type: 'iteration.incremented', from, to, targetNodeId: result.targetNodeId },
        ]);
        await this.ports.runs.saveThread(runId, thread, seq);
        nodeId = result.targetNodeId;
        run = await this.ports.runs.update(runId, {
          iteration: to,
          currentNodeId: nodeId,
          waiting: undefined,
        });
      } else {
        const seq = await appendAll([finishedDraft]);
        await this.ports.runs.saveThread(runId, thread, seq);
        const edge = outgoingEdge(def, nodeId, result.route);
        if (!edge) {
          await this.failRun(runId, {
            code: 'INTERNAL_ERROR',
            message: `node ${nodeId} routed to "${result.route}" but no edge leaves that port`,
            nodeId,
            resumable: false,
          });
          return;
        }
        nodeId = edge.to.node;
        run = await this.ports.runs.update(runId, { currentNodeId: nodeId, waiting: undefined });
      }

      const fresh = await this.mustGet(runId);
      if (fresh.status === 'paused') return;
      run = fresh;
    }
  }

  /**
   * Complete a run whose terminal event is already in the log but whose status is not terminal
   * (the process died between the two writes): apply the recorded outcome without executing
   * anything, then finalize. Returns whether the log had such an event. `def` is absent when the
   * run's version is gone; returns declared on its exit then cannot be delivered.
   */
  private async completeFromLog(
    run: RunRecord,
    def: LoopDefinition | undefined,
    events: readonly RunEvent[],
  ): Promise<boolean> {
    const terminal = terminalEvent(events);
    if (!terminal) return false;
    this.recovering.delete(run.id);
    if (isTerminal(run.status)) return true;
    // The snapshot may predate the terminal append: bring it up to the end of the log.
    const thread = await this.loadThread(run, events);
    await this.ports.runs.saveThread(run.id, thread, (events.at(-1) as RunEvent).seq);
    const changes: RunRecordChanges =
      terminal.type === 'run.cancelled'
        ? { status: 'cancelled', waiting: undefined }
        : terminal.type === 'run.failed'
          ? { status: 'failed', failure: terminal.failure }
          : {
              status: terminal.status,
              outcome: terminal.outcome,
              ...(terminal.result !== undefined ? { result: terminal.result } : {}),
              currentNodeId: undefined,
              waiting: undefined,
              pausedAt: undefined,
            };
    const done = await this.ports.runs.transition(run.id, ACTIVE_STATUSES, {
      ...changes,
      finishedAt: this.now(),
    });
    if (done) await this.finalizeTerminal(run.id, def, thread);
    return true;
  }

  /**
   * The status side of finishing: `run.finished` is already durable (with the exit's
   * `node.finished`), so this moves the status and finalizes.
   */
  private async finish(
    run: RunRecord,
    def: LoopDefinition,
    thread: ContextThread,
    result: Extract<NodeResult, { kind: 'exit' }>,
  ): Promise<void> {
    const status = outcomeStatus(result.outcome);
    const finished = await this.ports.runs.transition(run.id, ACTIVE_STATUSES, {
      status,
      outcome: result.outcome,
      ...(result.returnPayload !== undefined ? { result: result.returnPayload } : {}),
      finishedAt: this.now(),
      currentNodeId: undefined,
      waiting: undefined,
      pausedAt: undefined,
    });
    if (finished) await this.finalizeTerminal(run.id, def, thread);
  }

  /**
   * Everything that follows a terminal status: drop the run's timers, cancel its children (when
   * it was cancelled), deliver its returns (when it finished), wake its parent, and only then
   * record it as finalized. Every step is idempotent, and a run that is terminal but not
   * finalized is finalized again at recovery, so a crash right after the status write loses
   * nothing. Returns are delivered per channel, skipping channels whose delivery is already
   * recorded; a channel interrupted mid-delivery is delivered again (at least once).
   */
  private finalizeTerminal(
    runId: string,
    knownDef?: LoopDefinition,
    knownThread?: ContextThread,
  ): Promise<void> {
    return this.withRunLock(runId, () => this.finalizeTerminalLocked(runId, knownDef, knownThread));
  }

  private async finalizeTerminalLocked(
    runId: string,
    knownDef?: LoopDefinition,
    knownThread?: ContextThread,
  ): Promise<void> {
    const run = await this.mustGet(runId);
    if (!isTerminal(run.status)) return;
    await this.ports.timers.cancel(runId);
    let complete = true;
    if (run.status === 'cancelled') {
      // Children are cancelled after the parent is terminal, so their completion does not wake it.
      // A child that could not be cancelled (and is not terminal by now) keeps the parent's
      // finalization pending, so the next recovery tries again.
      for (const child of await this.ports.runs.listChildren(runId)) {
        if (isTerminal(child.status)) continue;
        try {
          await this.cancel(child.id, { kind: 'run', id: runId });
        } catch (error) {
          const now = await this.ports.runs.get(child.id);
          if (now && isTerminal(now.status)) continue;
          complete = false;
          this.ports.logger.error(
            { runId, childRunId: child.id, error: describeError(error) },
            'child cancellation failed; finalization stays pending',
          );
        }
      }
    }
    const events = await this.ports.events.read(runId);
    const terminal = terminalEvent(events);
    if (terminal?.type === 'run.finished' && terminal.result !== undefined) {
      const def = knownDef ?? (await this.ports.loops.getVersion(run.versionId))?.definition;
      if (def) {
        const thread = knownThread ?? (await this.loadThread(run, events));
        await this.deliverReturns(run, def, thread, exitResult(def, events, terminal), events);
      }
    }
    await this.notifyParent(run, run.status, run.outcome);
    if (complete) await this.ports.runs.markFinalized(runId);
  }

  private async deliverReturns(
    run: RunRecord,
    def: LoopDefinition,
    thread: ContextThread,
    result: Extract<NodeResult, { kind: 'exit' }>,
    events: readonly RunEvent[],
  ): Promise<void> {
    if (result.returnPayload === undefined) return;
    const payload = result.returnPayload;
    const channels: ReturnChannel[] = [...result.channels];
    for (const extra of thread.invocation.returnDefaults ?? []) {
      if (!channels.some((c) => JSON.stringify(c) === JSON.stringify(extra))) channels.push(extra);
    }
    const recorded = new Set(
      events
        .filter((e) => e.type === 'return.delivered' || e.type === 'return.failed')
        .map((e) => JSON.stringify((e as { channel: ReturnChannel }).channel)),
    );
    const append = async (draft: EventDraft): Promise<void> => {
      await this.ports.events.append(run.id, [draft]);
    };
    for (const channel of channels) {
      if (recorded.has(JSON.stringify(channel))) continue;
      try {
        let target: string | undefined;
        switch (channel.kind) {
          case 'caller':
            target = 'run.result';
            break;
          case 'log':
            this.ports.delivery.log(run.id, payload);
            break;
          case 'file': {
            const dir = await this.workingDirectory(run, def, thread);
            const content =
              channel.format === 'json'
                ? JSON.stringify(payload, null, 2)
                : channel.format === 'markdown'
                  ? `# Run ${run.id}\n\nOutcome: ${result.outcome}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`
                  : typeof payload === 'string'
                    ? payload
                    : JSON.stringify(payload);
            target = await this.ports.workspace.writeFile(dir, channel.path, content);
            break;
          }
          case 'webhook': {
            const secret = channel.secretRef
              ? await this.ports.secrets.resolve(channel.secretRef)
              : undefined;
            await this.ports.delivery.webhook(
              channel.url,
              { runId: run.id, loopId: run.loopId, outcome: result.outcome, result: payload },
              secret,
            );
            target = channel.url;
            break;
          }
          case 'event':
            await this.ports.delivery.publishEvent(channel.eventType, {
              runId: run.id,
              loopId: run.loopId,
              outcome: result.outcome,
              result: payload,
            });
            target = channel.eventType;
            break;
        }
        await append({ type: 'return.delivered', channel, ...(target ? { target } : {}) });
      } catch (error) {
        await append({
          type: 'return.failed',
          channel,
          error: describeError(error).slice(0, 4000),
        });
      }
    }
  }

  private async failRun(runId: string, failure: RunFailure): Promise<void> {
    const run = await this.ports.runs.get(runId);
    if (!run || isTerminal(run.status)) return;
    // Event first, status second: a crash in between is completed from the log at recovery. A
    // terminal event already in the log is completed instead of recording a second one.
    const events = await this.ports.events.read(runId);
    if (terminalEvent(events)) {
      await this.completeFromLog(run, undefined, events);
      return;
    }
    await this.ports.events.append(runId, [{ type: 'run.failed', failure }]);
    const failed = await this.ports.runs.transition(runId, ACTIVE_STATUSES, {
      status: 'failed',
      failure,
      finishedAt: this.now(),
    });
    if (failed) await this.finalizeTerminal(runId);
  }

  private async finalizeCancel(runId: string): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    if (isTerminal(run.status)) return run;
    // Event first, status second, as for every terminal transition; recovery completes a
    // `run.cancelled` whose status write was lost, and does not append it again.
    if (terminalEvent(await this.ports.events.read(runId))?.type !== 'run.cancelled') {
      await this.ports.events.append(runId, [{ type: 'run.cancelled' }]);
    }
    const updated = await this.ports.runs.transition(runId, ACTIVE_STATUSES, {
      status: 'cancelled',
      finishedAt: this.now(),
      waiting: undefined,
    });
    if (!updated) return this.mustGet(runId);
    await this.finalizeTerminal(runId);
    return updated;
  }

  private async notifyParent(
    run: RunRecord,
    status: RunStatus,
    outcome: Outcome | undefined,
  ): Promise<void> {
    if (!run.parentRunId) return;
    const parent = await this.ports.runs.get(run.parentRunId);
    if (
      !parent ||
      parent.status !== 'waiting' ||
      parent.waiting?.kind !== 'child' ||
      parent.waiting.childRunId !== run.id
    )
      return;
    try {
      await this.wake(parent.id, {
        reason: 'child',
        payload: { childRunId: run.id, status, outcome: outcome ?? null },
      });
    } catch (error) {
      // The child's own completion and the parent's post-park check can race. The wake is a
      // compare-and-set, so the loser finds the parent already running and has nothing to do.
      if (!(error instanceof EngineRequestError && error.code === 'INVALID_STATE')) throw error;
    }
  }

  private async startChild(
    parent: RunRecord,
    request: ChildStartRequest,
    pins: Record<string, string>,
  ): Promise<string> {
    // `latest` resolves to the version pinned when the parent run was created (docs/03). A run
    // whose log predates pinning resolves it now, as before.
    const pinned = request.version === 'latest' ? pins[request.loopId] : undefined;
    const version = pinned
      ? await this.ports.loops.getVersion(pinned)
      : request.version === 'latest'
        ? await this.ports.loops.getLatestPublished(request.loopId)
        : await this.ports.loops.getPublished(request.loopId, request.version);
    // A pinned version that is gone or no longer published fails; it never falls back to latest.
    if (!version || version.status !== 'published') {
      throw new RunFailureError(
        'SUBLOOP_NOT_FOUND',
        `loop ${request.loopId} (${String(request.version)}) has no published version`,
        { resumable: false },
      );
    }
    const child = await this.startRun({
      ownerId: parent.ownerId,
      loopId: request.loopId,
      versionId: version.id,
      source: 'subloop',
      caller: { kind: 'run', id: parent.id },
      payload: request.triggerPayload,
      parentRunId: parent.id,
      seed: request.seed,
      subloopVersions: pins,
    });
    return child.id;
  }

  /**
   * Pin every `latest` subloop reference reachable from `def` (through referenced loops, at any
   * depth) to the version published now, on top of the pins a parent passed down. Numbered
   * references are immutable and need no pin, but are walked for their own references. A
   * reference that does not resolve is left unpinned and fails when the child would start.
   */
  private async pinSubloops(
    def: LoopDefinition,
    inherited: Record<string, string>,
    reached?: Set<string>,
  ): Promise<Record<string, string>> {
    const pins: Record<string, string> = { ...inherited };
    const walked = new Set<string>();
    const pending: LoopDefinition[] = [def];
    for (let current = pending.pop(); current; current = pending.pop()) {
      for (const node of nodesOfKind(current, 'subloop')) {
        const { loopId, version } = node.config.loopRef;
        reached?.add(loopId);
        const pin = pins[loopId];
        let target: LoopVersionRecord | undefined;
        if (version !== 'latest') target = await this.ports.loops.getPublished(loopId, version);
        else if (pin) target = await this.ports.loops.getVersion(pin);
        else {
          target = await this.ports.loops.getLatestPublished(loopId);
          if (target) pins[loopId] = target.id;
        }
        if (target && !walked.has(target.id)) {
          walked.add(target.id);
          pending.push(target.definition);
        }
      }
    }
    return pins;
  }

  /**
   * Bring the run's cursor up to the log. When the log's last node event is the `node.finished`
   * of the node the cursor still points at, that node completed but the process died before the
   * cursor moved: advance along the edge it took (or its loop-back, to the iteration recorded
   * with it) instead of executing it again. A finished exit has its `run.finished` in the same
   * append and is completed from the log before this runs. Returns the updated run, or undefined
   * when the cursor already agrees with the log.
   */
  private async catchUpCursor(
    run: RunRecord,
    def: LoopDefinition,
    events: readonly RunEvent[],
  ): Promise<{ run: RunRecord } | undefined> {
    const last = lastFinishedNode(events);
    const route = last?.event.route;
    if (!last || !route || last.event.nodeId !== run.currentNodeId) return undefined;
    const { event, index } = last;
    if (route === 'loopBack') {
      const node = nodeById(def, event.nodeId);
      const targetNodeId = node?.kind === 'exit' ? node.config.loopBack?.targetNodeId : undefined;
      // The loop-back and its iteration are appended together; a log without the iteration
      // (written before that) re-evaluates the exit instead, whose patch is empty.
      const recorded = events
        .slice(index + 1)
        .find(
          (e): e is Extract<RunEvent, { type: 'iteration.incremented' }> =>
            e.type === 'iteration.incremented',
        );
      if (!targetNodeId || !recorded) return undefined;
      const updated = await this.ports.runs.update(run.id, {
        iteration: recorded.to,
        currentNodeId: targetNodeId,
        waiting: undefined,
      });
      return { run: updated };
    }
    const edge = outgoingEdge(def, event.nodeId, route);
    if (!edge) return undefined;
    const updated = await this.ports.runs.update(run.id, {
      currentNodeId: edge.to.node,
      waiting: undefined,
    });
    return { run: updated };
  }

  private async childOutcome(childRunId: string): Promise<ChildOutcome> {
    const child = await this.mustGet(childRunId);
    const thread = await this.getThread(childRunId);
    return {
      runId: childRunId,
      status: child.status,
      ...(child.outcome ? { outcome: child.outcome } : {}),
      ...(child.result !== undefined ? { result: child.result } : {}),
      ...(thread ? { thread } : {}),
    };
  }

  private async depthOf(run: RunRecord): Promise<number> {
    let depth = 0;
    let current: RunRecord | undefined = run;
    while (current?.parentRunId) {
      depth += 1;
      current = await this.ports.runs.get(current.parentRunId);
      if (depth > 1000) break;
    }
    return depth;
  }

  private async workingDirectory(
    run: RunRecord,
    def: LoopDefinition,
    thread: ContextThread,
  ): Promise<string> {
    const cached = this.directories.get(run.id);
    if (cached) return cached;
    const dir = await this.ports.workspace.resolve(
      def.settings.workingDirectory,
      threadView(thread) as unknown as Record<string, unknown>,
      run.id,
    );
    this.directories.set(run.id, dir);
    return dir;
  }

  /**
   * The executor always starts from the log, never the snapshot: a crash (or a failure) can leave
   * the snapshot behind the last `node.started` or `node.finished`, and the log is the source of
   * truth (docs/05). The snapshot only serves reads.
   */
  private async loadThread(run: RunRecord, events: readonly RunEvent[]): Promise<ContextThread> {
    // A verified checkpoint: the snapshot names the seq it reflects, and that event is in the log,
    // so only the events after it are replayed. A checkpoint is always written after its event,
    // so one the log does not reach (or a snapshot without a seq) is ignored.
    const checkpoint = await this.ports.runs.getThreadCheckpoint(run.id);
    if (checkpoint && events.some((e) => e.seq === checkpoint.seq)) {
      // The visit open at the checkpoint carries over, so a duplicate completion straddling it
      // is applied once, exactly as a full replay would.
      return replayThread(
        checkpoint.thread,
        events.filter((e) => e.seq > checkpoint.seq),
        undefined,
        replayStateAt(events, checkpoint.seq),
      );
    }
    const initial = await this.ports.runs.getInitialThread(run.id);
    if (!initial) throw new Error(`run ${run.id} has no initial thread`);
    return replayThread(initial, events);
  }

  private async resolveVersion(input: StartRunInput): Promise<LoopVersionRecord> {
    const version = input.versionId
      ? await this.ports.loops.getVersion(input.versionId)
      : await this.ports.loops.getLatestPublished(input.loopId);
    if (!version || version.loopId !== input.loopId) {
      throw new EngineRequestError(
        'LOOP_NOT_FOUND',
        `loop ${input.loopId} has no ${input.versionId ? `version ${input.versionId}` : 'published version'}`,
      );
    }
    if (version.status !== 'published' && !input.allowDraft) {
      throw new EngineRequestError('VERSION_NOT_PUBLISHED', `version ${version.id} is a draft`);
    }
    return version;
  }

  private resolveTrigger(
    def: LoopDefinition,
    triggerNodeId: string | undefined,
  ): Extract<Node, { kind: 'trigger' }> {
    const triggers = nodesOfKind(def, 'trigger');
    if (triggerNodeId) {
      const found = triggers.find((t) => t.id === triggerNodeId);
      if (!found)
        throw new EngineRequestError(
          'TRIGGER_NOT_FOUND',
          `trigger node ${triggerNodeId} not found`,
        );
      return found;
    }
    const manual = triggers.find((t) => t.config.subtype === 'manual') ?? triggers[0];
    if (!manual) throw new EngineRequestError('TRIGGER_NOT_FOUND', 'loop has no trigger node');
    return manual;
  }

  private async mustGet(runId: string): Promise<RunRecord> {
    const run = await this.ports.runs.get(runId);
    if (!run) throw new EngineRequestError('RUN_NOT_FOUND', `run ${runId} not found`);
    return run;
  }

  private now(): string {
    return this.ports.clock.now().toISOString();
  }
}
