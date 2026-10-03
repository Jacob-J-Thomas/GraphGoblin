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
} from '@graphgoblin/contracts';
import { ContextThreadSchema } from '@graphgoblin/contracts';
import {
  applyPatch,
  evaluatePredicate,
  isTerminal,
  nodeById,
  nodesOfKind,
  outcomeStatus,
  outgoingEdge,
  renderTemplate,
  replayThread,
  stableHash,
  threadView,
  validateJson,
} from '@graphgoblin/domain';
import { RunFailureError, describeError, isAbortError } from './errors.js';
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
import type { EngineSettings, EnginePorts, EventDraft } from './ports.js';
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

function triggerKindOf(node: Extract<Node, { kind: 'trigger' }>): TriggerKind {
  return node.config.subtype;
}

/** Find the wake that a parked node is waiting to consume, if any. */
export function findPendingWake(events: readonly RunEvent[]): WakeInfo | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i] as RunEvent;
    if (event.type === 'run.woken') {
      return {
        reason: event.reason,
        ...(event.payload !== undefined ? { payload: event.payload } : {}),
      };
    }
    if (
      event.type === 'node.finished' ||
      event.type === 'run.waiting' ||
      event.type === 'run.started'
    )
      return undefined;
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

export class RunManager {
  private readonly queue: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly recovering = new Set<string>();
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
    this.unsubscribeTimers ??= this.ports.timers.onFire((runId, key) =>
      this.onTimer(runId, key).catch((error: unknown) => {
        this.ports.logger.error({ runId, key, error: describeError(error) }, 'timer wake failed');
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
    await this.ports.runs.create(run, thread);
    await this.ports.events.append(runId, [{ type: 'run.queued', initialThread: thread }]);
    this.enqueue(runId);
    return run;
  }

  async cancel(runId: string, actor: Actor = SYSTEM_ACTOR): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    if (isTerminal(run.status)) {
      throw new EngineRequestError('INVALID_STATE', `run ${runId} is already ${run.status}`);
    }
    if (run.cancelRequestedAt) return run;
    await this.ports.runs.update(runId, { cancelRequestedAt: this.now() });
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
    const updated = await this.ports.runs.transition(runId, ['paused', 'failed'], {
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
    await this.ports.events.append(runId, [
      { type: 'input.received', nodeId: run.waiting.nodeId, payload },
    ]);
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
    await this.ports.runs.create(run, thread);
    await this.ports.events.append(runId, [{ type: 'run.queued', replayOf }]);
    this.enqueue(runId);
    return run;
  }

  // ---------------------------------------------------------------------------
  // Queries
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
    if (this.queue.includes(runId) || this.active.has(runId)) return;
    this.queue.push(runId);
    this.tick();
  }

  private dequeue(runId: string): void {
    const index = this.queue.indexOf(runId);
    if (index >= 0) this.queue.splice(index, 1);
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
    const runs = await this.ports.runs.listByStatus(['queued', 'running', 'waiting']);
    for (const run of runs) {
      if (run.cancelRequestedAt) {
        await this.finalizeCancel(run.id);
        continue;
      }
      if (run.status === 'queued' || run.status === 'running') {
        if (run.status === 'running') this.recovering.add(run.id);
        this.enqueue(run.id);
      }
      // waiting runs are woken by persisted timers, inputs, signals, or finishing children.
    }
  }

  private async onTimer(runId: string, key: string): Promise<void> {
    const run = await this.ports.runs.get(runId);
    if (!run || run.status !== 'waiting' || !run.waiting) return;
    const { kind } = run.waiting;
    if (key === 'timeout') {
      await this.wake(runId, { reason: 'timeout', key });
      return;
    }
    if (kind === 'timer' || kind === 'heartbeat') await this.wake(runId, { reason: 'timer', key });
  }

  private async wake(runId: string, wake: WakeInfo): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    const updated = run.waiting
      ? await this.ports.runs.transition(runId, ['waiting'], { status: 'running' })
      : undefined;
    if (!updated || !run.waiting) {
      throw new EngineRequestError('INVALID_STATE', `run ${runId} is not waiting`);
    }
    await this.ports.events.append(runId, [
      {
        type: 'run.woken',
        nodeId: run.waiting.nodeId,
        reason: wake.reason,
        ...(wake.payload !== undefined ? { payload: wake.payload } : {}),
      },
    ]);
    this.enqueue(runId);
    return updated;
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
    const ownerDefaults = (await this.settings.ownerDefaults?.(run.ownerId)) ?? {};
    const events: RunEvent[] = await this.ports.events.read(runId);
    let thread = await this.loadThread(run, events);
    const append = async (draft: EventDraft): Promise<void> => {
      events.push(...(await this.ports.events.append(runId, [draft])));
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

    let nodeId = run.currentNodeId ?? thread.invocation.trigger.nodeId;
    let wake = findPendingWake(events);
    let previousWait = run.waiting;

    const services: HandlerServices = {
      render: (template, extras = {}) =>
        renderTemplate(template, {
          ...(threadView(thread) as unknown as Record<string, unknown>),
          ...extras,
        }),
      record: append,
      resolveModel: (model, effort) => ({
        model:
          model ?? def.settings.defaults.model ?? ownerDefaults.model ?? this.settings.defaultModel,
        effort:
          effort ??
          def.settings.defaults.effort ??
          ownerDefaults.effort ??
          this.settings.defaultEffort,
      }),
      startChild: (request) => this.startChild(run, request),
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
      await append({
        type: 'node.started',
        nodeId,
        kind: node.kind,
        attempt,
        configHash: stableHash(node.config),
      });
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
          ports: this.ports,
          settings: this.settings,
          services,
        };
        result = await (handler as { execute(c: NodeContext): Promise<NodeResult> }).execute(ctx);
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          await this.finalizeCancel(runId);
          return;
        }
        const failure: RunFailure =
          error instanceof RunFailureError
            ? error.toFailure(nodeId)
            : {
                code: 'INTERNAL_ERROR',
                message: describeError(error),
                nodeId,
                resumable: true,
                details:
                  error instanceof Error ? { name: error.name, stack: error.stack ?? null } : null,
              };
        this.ports.logger.error({ runId, nodeId, failure }, 'node failed');
        await this.failRun(runId, failure);
        return;
      }
      const durationMs = Date.now() - startedAt;

      if (result.kind === 'park') {
        await this.ports.runs.saveThread(runId, thread);
        await append({ type: 'run.waiting', nodeId, wait: result.wait });
        const parked = await this.ports.runs.transition(runId, ['running'], {
          status: 'waiting',
          waiting: result.wait,
        });
        // Paused while the node was parking: keep the pause, remember the wait so resume re-parks.
        if (!parked) await this.ports.runs.update(runId, { waiting: result.wait });
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
      await this.ports.runs.saveThread(runId, thread);
      const route =
        result.kind === 'done'
          ? result.route
          : result.kind === 'loop-back'
            ? 'loopBack'
            : undefined;
      await append({
        type: 'node.finished',
        nodeId,
        patch: result.patch,
        ...(route ? { route } : {}),
        durationMs,
      });
      wake = undefined;
      previousWait = undefined;

      if (result.kind === 'exit') {
        await this.finish(run, def, thread, result, append);
        return;
      }

      if (result.kind === 'loop-back') {
        const from = run.iteration;
        const to = from + 1;
        thread = { ...thread, run: { ...thread.run, iteration: to } };
        await this.ports.runs.saveThread(runId, thread);
        await append({
          type: 'iteration.incremented',
          from,
          to,
          targetNodeId: result.targetNodeId,
        });
        nodeId = result.targetNodeId;
        run = await this.ports.runs.update(runId, {
          iteration: to,
          currentNodeId: nodeId,
          waiting: undefined,
        });
      } else {
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

  private async finish(
    run: RunRecord,
    def: LoopDefinition,
    thread: ContextThread,
    result: Extract<NodeResult, { kind: 'exit' }>,
    append: (draft: EventDraft) => Promise<void>,
  ): Promise<void> {
    const status = outcomeStatus(result.outcome);
    const finished = await this.ports.runs.transition(run.id, ['running', 'paused'], {
      status,
      outcome: result.outcome,
      ...(result.returnPayload !== undefined ? { result: result.returnPayload } : {}),
      finishedAt: this.now(),
      currentNodeId: undefined,
      waiting: undefined,
      pausedAt: undefined,
    });
    if (!finished) return;
    await append({
      type: 'run.finished',
      status,
      outcome: result.outcome,
      ...(result.returnPayload !== undefined ? { result: result.returnPayload } : {}),
    });
    await this.ports.timers.cancel(run.id);
    await this.deliverReturns(run, def, thread, result, append);
    await this.notifyParent(run, status, result.outcome);
  }

  private async deliverReturns(
    run: RunRecord,
    def: LoopDefinition,
    thread: ContextThread,
    result: Extract<NodeResult, { kind: 'exit' }>,
    append: (draft: EventDraft) => Promise<void>,
  ): Promise<void> {
    if (result.returnPayload === undefined) return;
    const payload = result.returnPayload;
    const channels: ReturnChannel[] = [...result.channels];
    for (const extra of thread.invocation.returnDefaults ?? []) {
      if (!channels.some((c) => JSON.stringify(c) === JSON.stringify(extra))) channels.push(extra);
    }
    for (const channel of channels) {
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
    if (!run) return;
    const failed = await this.ports.runs.transition(
      runId,
      ['queued', 'running', 'waiting', 'paused'],
      { status: 'failed', failure, finishedAt: this.now() },
    );
    if (!failed) return;
    await this.ports.events.append(runId, [{ type: 'run.failed', failure }]);
    await this.notifyParent(run, 'failed', undefined);
  }

  private async finalizeCancel(runId: string): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    if (isTerminal(run.status)) return run;
    const updated = await this.ports.runs.transition(
      runId,
      ['queued', 'running', 'waiting', 'paused'],
      { status: 'cancelled', finishedAt: this.now(), waiting: undefined },
    );
    if (!updated) return this.mustGet(runId);
    await this.ports.timers.cancel(runId);
    // Children are cancelled after the parent is terminal, so their completion does not wake it.
    for (const child of await this.ports.runs.listChildren(runId)) {
      if (!isTerminal(child.status))
        await this.cancel(child.id, { kind: 'run', id: runId }).catch(() => undefined);
    }
    await this.ports.events.append(runId, [{ type: 'run.cancelled' }]);
    await this.notifyParent(run, 'cancelled', undefined);
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
    await this.wake(parent.id, {
      reason: 'child',
      payload: { childRunId: run.id, status, outcome: outcome ?? null },
    });
  }

  private async startChild(parent: RunRecord, request: ChildStartRequest): Promise<string> {
    const version =
      request.version === 'latest'
        ? await this.ports.loops.getLatestPublished(request.loopId)
        : await this.ports.loops.getPublished(request.loopId, request.version);
    if (!version) {
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
    });
    return child.id;
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

  private async loadThread(run: RunRecord, events: readonly RunEvent[]): Promise<ContextThread> {
    const snapshot = await this.ports.runs.getThread(run.id);
    if (snapshot) return snapshot;
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
