import {
  RUN_DEADLINE_TIMER,
  runDeadline,
  deadlineFailure,
  isDeadlineAbort,
  watchRunDeadline,
} from './run-deadline.js';
import {
  AdmissionConflictError,
  type RunAdmission,
  type WebhookClaim,
  type WebhookReceipt,
} from './admission.js';
import type {
  Caller,
  ContextThread,
  InvocationSource,
  JsonValue,
  LoopDefinition,
  LoopVersionRecord,
  Node,
  Outcome,
  PinnedDefaults,
  ReturnChannel,
  RunPin,
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
  stableStringify,
  threadView,
  validateJson,
} from '@graphgoblin/domain';
import {
  AppendConflictError,
  ChildCancelledError,
  RunFailureError,
  UnreadableRunHistoryError,
  describeError,
  isAbortError,
} from './errors.js';
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
import type { EngineSettings, EnginePorts, EventDraft, RunRecordChanges } from './ports.js';
import { createInitialThread, type InitialThreadInput } from './thread.js';
import { bindClassifiers, freezeDraft, pinnedFields } from './definition-pin.js';
import { boundedFailure } from './event-validation.js';
import { assertCurrentDefinition, definitionUpgradeRequired } from './stored-definition.js';

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
      | 'WAIT_MISMATCH'
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
  eventType?: string;
  source: InvocationSource;
  caller?: Caller;
  payload?: JsonValue;
  dedupeKey?: string;
  returnDefaults?: ReturnChannel[];
  parentRunId?: string;
  seed?: InitialThreadInput['seed'];
  /** Allow running a draft version (test runs). The run pins a snapshot of it (ADR-0041). */
  allowDraft?: boolean;
  /** Subloop versions already pinned by the parent run; a child inherits them. */
  subloopVersions?: Record<string, string>;
  /** Inherited model defaults already pinned by the parent run; a child inherits them. */
  pinnedDefaults?: PinnedDefaults;
  /** Classifier bindings already pinned by the parent run; a child keeps them for shared ids. */
  pinnedClassifiers?: RunPin['classifiers'];
}

/** A run start prepared outside the pin lock, admitted inside it. */
interface PreparedStart {
  /** The immutable record the run executes: a published version or the draft snapshot. */
  version: LoopVersionRecord;
  /** The record the start read: the published version or the draft row, checked under the lock. */
  sourceId: string;
  run: RunRecord;
  thread: ContextThread;
  /** A draft start's frozen draft, committed with the run. */
  snapshot?: LoopVersionRecord;
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
  return node.config.type;
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
  const config = node?.kind === 'exit' ? node.config : undefined;
  return {
    kind: 'exit',
    patch: [],
    outcome: terminal.outcome,
    reason: 'recorded in the log',
    ...(terminal.result !== undefined ? { returnPayload: terminal.result } : {}),
    channels: config && config.returns !== 'none' ? config.destinations : [],
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

export class RunManager {
  private readonly queue: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private readonly deadlineStops = new Map<string, () => void>();
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
  private webhookSweep: ReturnType<typeof setInterval> | undefined;
  private webhookRecovery: Promise<void> | undefined;
  private readonly webhookDispatches = new Set<Promise<void>>();

  constructor(
    private readonly ports: EnginePorts,
    private readonly settings: EngineSettings,
    private readonly handlers: HandlerRegistry = defaultHandlers(),
  ) {}

  /** Arm timers and recover runs left active by a previous process. */
  async start(): Promise<void> {
    this.stopped = false;
    // Transient wake failures retain the row; unreadable history is diagnosed and acknowledged.
    this.unsubscribeTimers ??= this.ports.timers.onFire((runId, key) =>
      this.onTimer(runId, key).catch((error: unknown) => {
        if (error instanceof UnreadableRunHistoryError) {
          this.ports.logger.error(
            { runId, key, code: error.code },
            'timer acknowledged for unreadable history; inspect run diagnostics',
          );
          return true;
        }
        this.ports.logger.error({ runId, key, error: describeError(error) }, 'timer wake failed');
        throw error;
      }),
    );
    await this.recover();
    await this.retryPendingWebhooks();
    this.webhookSweep ??= setInterval(() => {
      void this.retryPendingWebhooks().catch(() => {
        this.ports.logger.error({ code: 'WEBHOOK_RECOVERY_FAILED' }, 'webhook recovery failed');
      });
    }, 15_000);
    this.webhookSweep.unref();
    this.tick();
  }

  /** Stop picking up new work. Active nodes finish; runs stay recoverable. */
  stop(): void {
    this.stopped = true;
    if (this.webhookSweep) clearInterval(this.webhookSweep);
    this.webhookSweep = undefined;
    this.unsubscribeTimers?.();
    this.unsubscribeTimers = undefined;
  }

  /** Resolves when nothing is queued or executing. */
  async waitForIdle(): Promise<void> {
    await this.waitForWebhookRecovery();
    if (this.queue.length === 0 && this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  private async prepareStart(input: StartRunInput): Promise<PreparedStart> {
    const source = await this.resolveVersion(input);
    const def = source.definition;
    const trigger = this.resolveTrigger(def, input.triggerNodeId);
    const payload: JsonValue = input.payload ?? null;
    if (trigger.config.type === 'manual' && trigger.config.inputSchema) {
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
    // The run's definition is immutable for its whole life (ADR-0041): a draft start pins a frozen
    // copy of exactly the draft read and validated above, committed with the run.
    const snapshot =
      source.status === 'draft' ? freezeDraft(source, this.ports.ids.next(), now) : undefined;
    const version = snapshot ?? source;
    const pinned = pinnedFields(version, {
      defaults: input.pinnedDefaults ?? (await this.startDefaults(input)),
      classifiers: await bindClassifiers(
        def,
        input.ownerId,
        this.ports.classifiers,
        input.pinnedClassifiers,
      ),
    });
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
          ...(input.eventType !== undefined ? { eventType: input.eventType } : {}),
          ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
        },
        ...(input.returnDefaults ? { returnDefaults: input.returnDefaults } : {}),
      },
      ...(input.seed ? { seed: input.seed } : {}),
    });
    thread.gates = Object.fromEntries(
      version.definition.nodes
        .filter((node) => node.kind === 'decision' && node.config.maxPasses !== undefined)
        .map((node) => [node.id, { passes: 1 }]),
    );
    const run: RunRecord = {
      id: runId,
      ownerId: input.ownerId,
      loopId: version.loopId,
      ...pinned,
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      invocationId,
      status: 'queued',
      iteration: 1,
      createdAt: now,
      lastEventSeq: 0,
    };
    return { version, sourceId: source.id, run, thread, ...(snapshot ? { snapshot } : {}) };
  }

  /** The defaults a new top-level run inherits, read once at its start and pinned (ADR-0041). */
  private async startDefaults(input: StartRunInput): Promise<PinnedDefaults> {
    return {
      owner: (await this.settings.ownerDefaults?.(input.ownerId)) ?? { byHarness: {} },
      process: this.settings.defaults,
    };
  }

  async startRun(input: StartRunInput): Promise<RunRecord> {
    const prepared = await this.prepareStart(input);
    const admitted = await this.withPinLock(async () => {
      await this.assertVersionPresent(prepared.sourceId, input.loopId);
      const intent = await this.prepareAdmission(prepared, input.subloopVersions ?? {});
      return this.ports.admission.create(intent);
    });
    this.enqueue(admitted.id);
    return admitted;
  }

  /** Items-mode polls serialize committed and pending key admission with webhook claim/deletion. */
  async startPollItem(input: StartRunInput): Promise<RunRecord | undefined> {
    const prepared = await this.prepareStart(input);
    const trigger = nodeById(
      prepared.version.definition,
      prepared.thread.invocation.trigger.nodeId,
    );
    if (trigger?.kind !== 'trigger' || trigger.config.type !== 'poll' || !trigger.config.items)
      throw new EngineRequestError(
        'INVALID_STATE',
        'Atomic poll admission requires an items-mode trigger',
      );
    const run = await this.withPinLock(async () => {
      await this.assertVersionPresent(prepared.sourceId, input.loopId);
      return this.ports.admission.createPollItem(await this.prepareAdmission(prepared, {}));
    });
    if (run) this.enqueue(run.id);
    return run;
  }

  private async prepareAdmission(
    { version, run, thread: initialThread, snapshot }: PreparedStart,
    inherited: Record<string, string>,
  ): Promise<RunAdmission> {
    const reached = new Set<string>([run.loopId]);
    const subloopVersions = await this.pinSubloops(version.definition, inherited, reached);
    return {
      run,
      initialThread,
      pinnedLoopIds: [...reached],
      queued: {
        type: 'run.queued',
        versionId: run.versionId,
        pinned: run.pinned,
        initialThread,
        ...(Object.keys(subloopVersions).length ? { subloopVersions } : {}),
      },
      ...(snapshot ? { snapshot } : {}),
    };
  }

  /** Acknowledge the durable claim; dispatch and execution never delay the caller. */
  async receiveWebhook(
    claim: WebhookClaim,
    input: StartRunInput,
  ): Promise<{
    state: 'deduplicated' | 'pending';
    receipt: WebhookReceipt;
  }> {
    if (
      claim.ownerId !== input.ownerId ||
      claim.loopId !== input.loopId ||
      claim.triggerNodeId !== input.triggerNodeId
    )
      throw new AdmissionConflictError();
    const result = await this.withPinLock(async () => {
      const prepared = await this.prepareStart(input);
      await this.assertVersionPresent(prepared.sourceId, input.loopId);
      const intent = await this.prepareAdmission(prepared, {});
      let claimed;
      try {
        claimed = await this.ports.admission.claim(claim, intent);
      } catch (error) {
        // Confirm a lost claim acknowledgement by its allocated identity. Never acknowledge an
        // unrelated receipt or manufacture another run after an uncertain storage result.
        const saved = await this.ports.admission.get(claim.id);
        if (
          !saved ||
          saved.ownerId !== claim.ownerId ||
          saved.loopId !== claim.loopId ||
          saved.triggerNodeId !== claim.triggerNodeId ||
          saved.contentHash !== claim.contentHash ||
          saved.inboundId !== claim.inbound.id ||
          saved.status === 'filtered' ||
          (saved.status !== 'deduplicated' &&
            stableStringify(saved.intent) !== stableStringify(intent))
        )
          throw error;
        claimed = { receipt: saved };
      }
      const { receipt } = claimed;
      if (receipt.status === 'deduplicated') return { state: 'deduplicated' as const, receipt };
      return { state: 'pending' as const, receipt };
    });
    if (result.state === 'pending') {
      const dispatch = this.dispatchWebhook(result.receipt).catch(() => {
        // The claim is already durable. Even retry-metadata failure must not turn it into a
        // public error; the unchanged pending receipt remains due at boot/the next sweep.
        this.ports.logger.error({ code: 'WEBHOOK_RECOVERY_FAILED' }, 'webhook dispatch failed');
      });
      this.webhookDispatches.add(dispatch);
      void dispatch.finally(() => this.webhookDispatches.delete(dispatch));
    }
    return result;
  }

  private async dispatchWebhook(receipt: Pick<WebhookReceipt, 'id' | 'attempts'>): Promise<void> {
    const run = await this.withPinLock(async () => {
      if (this.stopped) return undefined;
      let current = receipt;
      try {
        const saved = await this.ports.admission.get(receipt.id);
        if (saved) current = saved;
        if (!saved || saved.status !== 'pending') return undefined;
        if (saved.nextAttemptAt && saved.nextAttemptAt > this.now()) return undefined;
        const intent = saved.intent;
        if (!intent) throw new AdmissionConflictError();
        await this.assertVersionPresent(intent.run.versionId, intent.run.loopId);
        try {
          return await this.ports.admission.create(intent, receipt.id);
        } catch (error) {
          const confirmed = await this.ports.admission.get(receipt.id);
          if (confirmed?.status === 'admitted')
            return await this.ports.admission.create(intent, receipt.id);
          throw error;
        }
      } catch (error) {
        await this.recordWebhookFailure(current, error);
        return undefined;
      }
    });
    if (run && !this.stopped) this.enqueue(run.id);
  }

  private async recordWebhookFailure(
    receipt: Pick<WebhookReceipt, 'id' | 'attempts'>,
    error: unknown,
  ): Promise<void> {
    if (error instanceof AdmissionConflictError) {
      await this.ports.admission.failed(receipt.id, 'WEBHOOK_INTENT_CONFLICT');
    } else if (error instanceof EngineRequestError && error.code === 'LOOP_NOT_FOUND') {
      await this.ports.admission.failed(receipt.id, 'WEBHOOK_TARGET_REMOVED');
    } else {
      const delay = Math.min(300, 5 * 2 ** Math.min(receipt.attempts, 6));
      await this.ports.admission.failed(
        receipt.id,
        'WEBHOOK_ADMISSION_RETRY',
        new Date(this.ports.clock.now().getTime() + delay * 1000).toISOString(),
      );
    }
  }

  /** One bounded, non-overlapping sweep; boot and the 15-second timer call the same path. */
  retryPendingWebhooks(): Promise<void> {
    if (this.webhookRecovery) return this.webhookRecovery;
    this.webhookRecovery = (async () => {
      const due = await this.ports.admission.due(this.now(), 5);
      for (const receipt of due) {
        if (this.stopped) break;
        await this.dispatchWebhook(receipt);
      }
    })().finally(() => {
      this.webhookRecovery = undefined;
    });
    return this.webhookRecovery;
  }

  async waitForWebhookRecovery(): Promise<void> {
    while (this.webhookDispatches.size) await Promise.all(this.webhookDispatches);
    await this.webhookRecovery;
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
    waitId: string,
    payload: JsonValue,
    actor: Actor = SYSTEM_ACTOR,
  ): Promise<RunRecord> {
    const run = await this.mustGet(runId);
    if (run.status === 'paused' && run.waiting?.waitId === waitId) {
      throw new EngineRequestError(
        'INVALID_STATE',
        'The run is paused; resume it before providing input',
      );
    }
    if (
      run.status !== 'waiting' ||
      run.waiting?.kind !== 'input' ||
      run.waiting.waitId !== waitId
    ) {
      throw new EngineRequestError('WAIT_MISMATCH', 'The observed input wait is no longer active');
    }
    if (run.waiting.inputSchema) {
      const validation = validateJson(run.waiting.inputSchema, payload);
      if (!validation.ok) {
        throw new EngineRequestError(
          'INVALID_INPUT',
          'input is invalid: ' + validation.errors.join('; '),
          { errors: validation.errors },
        );
      }
    }
    void actor;
    return this.wake(runId, { reason: 'input', payload }, waitId);
  }

  /** Record a signal only against the park the sender observed. */
  async signal(
    runId: string,
    name: string,
    waitId: string,
    payload: JsonValue = null,
  ): Promise<{ run: RunRecord; woke: boolean }> {
    // Match wake's bounded ten conflict retries; a saturated caller must refresh its snapshot.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const run = await this.mustGet(runId);
      if (run.status === 'paused' && run.waiting?.waitId === waitId) {
        throw new EngineRequestError(
          'INVALID_STATE',
          'The run is paused; resume it before sending a signal',
        );
      }
      if (
        run.status !== 'waiting' ||
        !run.waiting ||
        run.waiting.waitId !== waitId ||
        run.cancelRequestedAt
      ) {
        throw new EngineRequestError(
          'WAIT_MISMATCH',
          'The observed signal wait is no longer active',
        );
      }
      const events = await this.ports.events.read(runId, run.waiting.startedSeq - 1);
      if (parkedWait(events)?.wait.waitId !== waitId) {
        // A retry must also complete an earlier durable signal answer's lost status write.
        // wake repairs that acknowledgement, then rejects without appending this signal.
        if (findPendingWake(events)) await this.wake(runId, { reason: 'signal', payload }, waitId);
        throw new EngineRequestError(
          'WAIT_MISMATCH',
          'The observed signal wait is already answered',
        );
      }
      let wakes = run.waiting.kind === 'signal' && run.waiting.signalName === name;
      if (wakes) {
        const version = await this.ports.loops.getVersion(run.versionId);
        const node = version ? nodeById(version.definition, run.waiting.nodeId) : undefined;
        if (node?.kind === 'wait' && node.config.mode === 'signal' && node.config.filter) {
          const thread = await this.getThread(runId);
          wakes = await evaluatePredicate(node.config.filter, payload, {
            bindings: { thread: thread ? threadView(thread) : {} },
          });
        }
      }
      const received: EventDraft = { type: 'signal.received', name, payload };
      if (wakes) {
        return {
          run: await this.wake(runId, { reason: 'signal', payload }, waitId, [received]),
          woke: true,
        };
      }
      try {
        await this.ports.events.append(runId, [received], {
          expectedLastSeq: events.at(-1)?.seq ?? 0,
        });
        return { run, woke: false };
      } catch (error) {
        if (!(error instanceof AppendConflictError)) throw error;
      }
    }
    throw new EngineRequestError(
      'WAIT_MISMATCH',
      'The observed signal wait kept changing; read it again',
    );
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
    assertCurrentDefinition(version);
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
    // The fork executes the source's pinned definition with the source's inherited defaults.
    const run: RunRecord = {
      id: runId,
      ownerId: source.ownerId,
      loopId: source.loopId,
      versionId: source.versionId,
      pinned: source.pinned,
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
    const admitted = await this.withPinLock(async () => {
      await this.assertVersionPresent(source.versionId, source.loopId);
      return this.ports.admission.create({
        run,
        initialThread: thread,
        pinnedLoopIds: [...new Set([source.loopId, ...Object.keys(subloopVersions)])],
        queued: {
          type: 'run.queued',
          versionId: run.versionId,
          pinned: run.pinned,
          replayOf,
          ...(Object.keys(subloopVersions).length > 0 ? { subloopVersions } : {}),
        },
      });
    });
    this.enqueue(runId);
    return admitted;
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
    if (await this.ports.admission.hasPendingPin(loopId)) return true;
    for (const run of await this.ports.runs.listRunReferences(ACTIVE_STATUSES)) {
      if (run.loopId === loopId) return true;
      // Pins are on run.queued, the first event: read that one, not the run's whole history.
      let pins: Record<string, string> = {};
      try {
        pins = pinnedSubloops(await this.ports.events.read(run.id, 0, 1));
      } catch (error) {
        if (!(error instanceof UnreadableRunHistoryError)) throw error;
        // The owning loop was checked above. Its stored definition still protects reachable
        // subloops even when the queued event cannot supply its pins.
        this.ports.logger.error(
          { runId: error.runId, code: error.code, reason: error.message },
          'run history unreadable during loop-use check',
        );
      }
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
        .catch(async (error: unknown) => {
          this.ports.logger.error(
            { runId, error: describeError(error) },
            'executor crashed outside node execution',
          );
          try {
            await this.failRun(
              runId,
              error instanceof RunFailureError
                ? error.toFailure((await this.ports.runs.get(runId))?.currentNodeId)
                : {
                    code: 'INTERNAL_ERROR',
                    message: describeError(error),
                    resumable: true,
                  },
            );
          } catch (recordError) {
            this.ports.logger.error(
              { runId, error: describeError(recordError) },
              'executor crash could not be recorded',
            );
          }
        })
        .then(() => this.afterExecute(runId))
        .catch((error: unknown) => {
          this.ports.logger.error(
            { runId, error: describeError(error) },
            'post-execution bookkeeping failed',
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
    const candidates = await this.ports.runs.listRecoveryCandidates();
    // Complete terminal bookkeeping before scheduling active work, as before.
    for (const candidate of [
      ...candidates.filter((r) => r.terminal),
      ...candidates.filter((r) => !r.terminal),
    ]) {
      try {
        const run = await this.ports.runs.get(candidate.id);
        if (!run) continue;
        await this.ports.runs.getInitialThread(run.id);
        await this.ports.runs.getThreadCheckpoint(run.id);
        const events = await this.ports.events.read(run.id);
        if (candidate.terminal) {
          // A failed run whose `run.resumed` is durable but whose status write was lost: resume it.
          if (run.status === 'failed' && pendingResume(events)) {
            await this.completeResume(run.id);
            continue;
          }
          await this.finalizeTerminal(run.id).catch((error: unknown) => {
            if (error instanceof UnreadableRunHistoryError) throw error;
            this.ports.logger.error(
              { runId: run.id, error: describeError(error) },
              'finalize failed',
            );
          });
          continue;
        }
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
        await this.armRunDeadline(run);
        if (await this.expireRunDeadline(run.id)) continue;
        // Complete an event-first park without executing its handler again. Its original
        // wall-clock deadlines survive an interruption before snapshot/status/timer writes.
        const parked = parkedWait(events);
        if (parked) {
          const paused = run.status === 'paused';
          const restored = await this.ports.runs.update(run.id, {
            ...(paused ? {} : { status: 'waiting' as const }),
            currentNodeId: parked.wait.nodeId,
            waiting: parked.wait,
          });
          await this.rearmTimers(run.id, parked.wait);
          if (!paused) await this.reconcileChild(restored);
          continue;
        }
        if (run.status === 'queued' || run.status === 'running') {
          if (run.status === 'running') this.recovering.add(run.id);
          this.enqueue(run.id);
        } else if (run.status === 'waiting' && run.waiting && findPendingWake(events)) {
          // A wake is durable but the waiting-to-running write was lost: finish accepting it.
          if (
            await this.ports.runs.transition(
              run.id,
              ['waiting'],
              { status: 'running' },
              { waitId: run.waiting.waitId },
            )
          ) {
            this.enqueue(run.id);
          }
        }
      } catch (error) {
        // Only identified record decoding failures are run-local. Store/schema/I/O failures
        // retain startup refusal; no history is rewritten, removed, or reconstructed here.
        if (!(error instanceof UnreadableRunHistoryError)) throw error;
        this.dequeue(candidate.id);
        this.recovering.delete(candidate.id);
        this.ports.logger.error(
          { runId: error.runId, code: error.code, reason: error.message },
          'run history unreadable; skipped recovery; repair manually or explicitly delete',
        );
      }
    }
  }

  /** Schedule the absolute deadline from the immutable run definition, never a fresh duration. */
  private async armRunDeadline(run: RunRecord): Promise<void> {
    const at = runDeadline(run);
    if (at) await this.ports.timers.schedule(run.id, RUN_DEADLINE_TIMER, at);
    const controller = this.active.get(run.id);
    if (controller) {
      this.deadlineStops.get(run.id)?.();
      const stop = watchRunDeadline(run, controller, () => this.ports.clock.now());
      if (stop) this.deadlineStops.set(run.id, stop);
    }
  }

  /** Active work must settle after abort before capacity is released. Parked work can fail now. */
  private async expireRunDeadline(runId: string): Promise<boolean> {
    const run = await this.ports.runs.get(runId);
    if (!run || isTerminal(run.status) || run.cancelRequestedAt) return true;
    const at = runDeadline(run);
    if (!at) return false;
    if (at.getTime() > this.ports.clock.now().getTime()) return false;
    const controller = this.active.get(runId);
    if (controller) {
      controller.abort(deadlineFailure());
      return false;
    }
    await this.failRun(runId, deadlineFailure().toFailure());
    return true;
  }

  /** Arm only a durable park; past deadlines are due on the very next scheduler poll. */
  private async rearmTimers(runId: string, wait: WaitSpec): Promise<void> {
    const suffix = '@' + wait.waitId;
    if ((wait.kind === 'timer' || wait.kind === 'heartbeat') && wait.until) {
      await this.ports.timers.schedule(runId, wait.kind + suffix, new Date(wait.until));
    }
    if (wait.timeoutAt) {
      await this.ports.timers.schedule(runId, 'timeout' + suffix, new Date(wait.timeoutAt));
    }
  }

  /** Wake a parent parked on a child that is already terminal. Idempotent. */
  private async reconcileChild(parent: RunRecord): Promise<void> {
    const childRunId = parent.waiting?.kind === 'child' ? parent.waiting.childRunId : undefined;
    if (!childRunId) return;
    const child = await this.ports.runs.get(childRunId);
    if (child && isTerminal(child.status))
      await this.notifyParent(child, child.status, child.outcome);
  }

  /** False retains an early delivery. Paused runs re-arm their original deadline on resume. */
  private async onTimer(runId: string, key: string): Promise<boolean> {
    if (key === RUN_DEADLINE_TIMER) return this.expireRunDeadline(runId);
    const [name, waitId] = key.split('@');
    if (!waitId || (name !== 'timer' && name !== 'heartbeat' && name !== 'timeout')) return true;
    const run = await this.ports.runs.get(runId);
    if (!run || isTerminal(run.status) || run.cancelRequestedAt) return true;
    if (run.status === 'paused') return true;
    if (run.waiting && run.waiting.waitId !== waitId) return true;
    if (run.status !== 'waiting' || !run.waiting) {
      // A row can already exist when a process is interrupted around parking. Never
      // acknowledge a due row while its park has yet to become visible.
      const events = await this.ports.events.read(runId);
      const pending = findPendingWake(events) !== undefined;
      // The status may have committed while its response (and therefore enqueue) was lost.
      if (pending && run.status !== 'waiting') this.enqueue(runId);
      return pending;
    }
    if (name !== 'timeout' && name !== run.waiting.kind) return true;
    const events = await this.ports.events.read(runId, run.waiting.startedSeq - 1);
    if (findPendingWake(events)) {
      // A previous delivery committed the wake but lost the status acknowledgement.
      if (await this.ports.runs.transition(runId, ['waiting'], { status: 'running' }, { waitId }))
        this.enqueue(runId);
      return true;
    }
    try {
      await this.wake(
        runId,
        { reason: name === 'timeout' ? 'timeout' : 'timer', key: name },
        waitId,
      );
    } catch (error) {
      if (!(error instanceof EngineRequestError)) throw error;
      // A pause can win after the read. Acknowledge its row; resume/recovery re-arm the deadline.
      if (error.code === 'INVALID_STATE' && (await this.mustGet(runId)).status === 'paused')
        return true;
      if (error.code !== 'WAIT_MISMATCH') throw error;
    }
    return true;
  }

  /**
   * Accept a wake. The log is written first: `run.woken` (with `input.received` for an input) is
   * appended only if the log is exactly as read, the run's current wait in the log is the expected
   * one (`waitId`, when given), and nothing woke it yet. That conditional append is the
   * compare-and-set: of concurrent wakes exactly one is recorded, payload and all. The status then
   * moves from waiting to running; if the process dies in between, recovery finds the durable wake
   * and completes the move. A child wake (`childRunId`) is accepted only by a park of kind `child`
   * on that same child run.
   */
  private async wake(
    runId: string,
    wake: WakeInfo,
    waitId?: string,
    preceding: EventDraft[] = [],
    childRunId?: string,
  ): Promise<RunRecord> {
    const mismatch = () =>
      new EngineRequestError(
        waitId ? 'WAIT_MISMATCH' : 'INVALID_STATE',
        'The observed wait is no longer active',
      );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const run = await this.mustGet(runId);
      if (run.status === 'paused' && (waitId === undefined || run.waiting?.waitId === waitId)) {
        throw new EngineRequestError(
          'INVALID_STATE',
          'The run is paused; resume it before answering',
        );
      }
      if (
        run.status !== 'waiting' ||
        !run.waiting ||
        run.cancelRequestedAt ||
        (waitId !== undefined && run.waiting.waitId !== waitId)
      ) {
        throw mismatch();
      }
      const after = run.waiting.startedSeq - 1;
      const events = await this.ports.events.read(runId, after);
      const parked = parkedWait(events);
      if (!parked && findPendingWake(events)) {
        // Complete the accepted answer, never the retry payload. The identity guard prevents
        // a delayed repair from changing a later park. The retry still rejects below.
        const repaired = await this.ports.runs.transition(
          runId,
          ['waiting'],
          { status: 'running' },
          { waitId: run.waiting.waitId },
        );
        if (repaired) this.enqueue(runId);
      }
      if (
        !parked ||
        parked.wait.waitId !== run.waiting.waitId ||
        (waitId !== undefined && parked.wait.waitId !== waitId) ||
        (wake.reason === 'child' &&
          (parked.wait.kind !== 'child' || parked.wait.childRunId !== childRunId))
      ) {
        throw mismatch();
      }
      const nodeId = parked.wait.nodeId;
      try {
        await this.ports.events.append(
          runId,
          [
            ...preceding,
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
      const updated = await this.ports.runs.transition(
        runId,
        ['waiting'],
        { status: 'running' },
        { waitId: parked.wait.waitId },
      );
      // Paused or cancelled in between: the wake stays in the log for resume to consume.
      if (updated) this.enqueue(runId);
      return updated ?? this.mustGet(runId);
    }
    throw new EngineRequestError(
      waitId ? 'WAIT_MISMATCH' : 'INVALID_STATE',
      'The wait kept changing; read it again',
    );
  }

  /** After an executor pass: honour a cancel request that arrived while the run was parking or finishing. */
  private async afterExecute(runId: string): Promise<void> {
    this.deadlineStops.get(runId)?.();
    this.deadlineStops.delete(runId);
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
    // A run admitted before ADR-0044 can be pinned to a definition whose exit publishes an Event:
    // fail it explicitly before any node runs, instead of running to an exit it cannot deliver.
    const refused = definitionUpgradeRequired(version);
    if (refused) {
      await this.failRun(runId, refused.toFailure());
      return;
    }
    const def = version.definition;
    // Inherited defaults (and classifier bindings, read by the decision handler) are the ones
    // pinned when the run was created (ADR-0041): a Settings or process change reaches new runs
    // only, never a run that waits, resumes or recovers.
    const { owner: ownerDefaults, process: processDefaults } = run.pinned.defaults;
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

    await this.armRunDeadline(run);

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
          processDefaults,
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
          processDefaults,
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
      resumeChild: (childRunId) => this.resumeChild(run, childRunId),
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
      if (
        !current.cancelRequestedAt &&
        (isDeadlineAbort(controller.signal) ||
          (runDeadline(run)?.getTime() ?? Infinity) <= this.ports.clock.now().getTime())
      ) {
        await this.failRun(runId, deadlineFailure().toFailure());
        return;
      }
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
      // higher attempt) beyond `maxNodeVisits` fails the run, which bounds graph cycles that never
      // pass through a marked repeat gate.
      if (
        run.pinned.limits.maxNodeVisits !== null &&
        attempt === 1 &&
        countEntries(events, nodeId) >= run.pinned.limits.maxNodeVisits
      ) {
        await this.failRun(runId, {
          code: 'MAX_NODE_VISITS',
          message: `node "${nodeId}" would start for visit ${run.pinned.limits.maxNodeVisits + 1}, above the loop's maxNodeVisits of ${run.pinned.limits.maxNodeVisits}`,
          nodeId,
          resumable: false,
          details: { maxNodeVisits: run.pinned.limits.maxNodeVisits },
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
          ports: this.ports,
          settings: this.settings,
          services,
        };
        result = await (handler as { execute(c: NodeContext): Promise<NodeResult> }).execute(ctx);
      } catch (error) {
        if (error instanceof ChildCancelledError) {
          await this.cancelForChild(runId, error.childRunId);
          return;
        }
        const terminationUnconfirmed =
          error instanceof RunFailureError && error.code === 'HARNESS_TERMINATION_UNCONFIRMED';
        if (
          !terminationUnconfirmed &&
          isDeadlineAbort(controller.signal) &&
          !(await this.mustGet(runId)).cancelRequestedAt
        ) {
          await this.failRun(runId, deadlineFailure().toFailure(nodeId));
          return;
        }
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
      // A late result cannot replace a deadline/cancel outcome, even if a port ignored abort.
      const afterNode = await this.mustGet(runId);
      if (afterNode.cancelRequestedAt) {
        await this.finalizeCancel(runId);
        return;
      }
      if (
        isDeadlineAbort(controller.signal) ||
        (runDeadline(run)?.getTime() ?? Infinity) <= this.ports.clock.now().getTime()
      ) {
        await this.failRun(runId, deadlineFailure().toFailure(nodeId));
        return;
      }
      const durationMs = Date.now() - startedAt;

      if (result.kind === 'park') {
        // The run and durable node.started sequence uniquely identify this park, without
        // relying on in-memory allocation. Each heartbeat park gets a fresh token.
        const wait: WaitSpec = { ...result.wait, startedSeq, waitId: runId + ':' + startedSeq };
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
        else {
          await this.rearmTimers(runId, wait);
          await this.reconcileChild(parked);
        }
        return;
      }

      // done, decision, exit: apply the patch and record the node as finished.
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
      const route = result.kind === 'exit' ? undefined : result.route;
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
          { type: 'exit.evaluated', nodeId, outcome: result.outcome },
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

      if (result.kind === 'decision' && result.evidence.gate) {
        thread = {
          ...thread,
          gates: { ...thread.gates, [nodeId]: { passes: result.evidence.gate.passes } },
        };
      }
      // Evaluation evidence, pass count and chosen route are a single durable completion.
      const seq = await appendAll([
        ...(result.kind === 'decision'
          ? [{ type: 'decision.made' as const, nodeId, ...result.evidence }]
          : []),
        finishedDraft,
      ]);
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
    if (run.status === 'cancelled' || run.failure?.code === 'RUN_DEADLINE_EXCEEDED') {
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

  private async failRun(runId: string, authoredFailure: RunFailure): Promise<void> {
    const failure = boundedFailure(authoredFailure);
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

  /**
   * Wake the parent parked on this finished child. The wake is bound to the park this read
   * observed (its `waitId` and child run), so a notification delayed past that park can never
   * answer a later one: another wait, or the next visit of the same subloop node.
   */
  private async notifyParent(
    run: RunRecord,
    status: RunStatus,
    outcome: Outcome | undefined,
  ): Promise<void> {
    if (!run.parentRunId) return;
    const parent = await this.ports.runs.get(run.parentRunId);
    const awaited = parent?.waiting;
    if (
      !parent ||
      parent.status !== 'waiting' ||
      awaited?.kind !== 'child' ||
      awaited.childRunId !== run.id
    )
      return;
    try {
      await this.wake(
        parent.id,
        { reason: 'child', payload: { childRunId: run.id, status, outcome: outcome ?? null } },
        awaited.waitId,
        [],
        run.id,
      );
    } catch (error) {
      // The child's own completion and the parent's post-park check can race. The wake is a
      // compare-and-set on the observed park, so the loser (or a notification delayed past that
      // park) finds it answered, gone or paused and has nothing to do: a paused parent is
      // reconciled with its child when it resumes.
      if (!(error instanceof EngineRequestError)) throw error;
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
      pinnedDefaults: parent.pinned.defaults,
      pinnedClassifiers: parent.pinned.classifiers,
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
   * cursor moved: advance along the recorded edge instead of executing it again. A finished exit has its `run.finished` in the same
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
    const { event } = last;
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
      ...(child.failure ? { failure: child.failure } : {}),
      ...(thread ? { thread } : {}),
    };
  }

  /**
   * An explicit resume of `parent` resumes its failed child in place (#251). A child that is no
   * longer in a resumable failure (resumed or finished meanwhile) is left as it is.
   */
  private async resumeChild(parent: RunRecord, childRunId: string): Promise<ChildOutcome> {
    try {
      await this.resume(childRunId, { kind: 'run', id: parent.id });
    } catch (error) {
      if (!(error instanceof EngineRequestError)) throw error;
    }
    return this.childOutcome(childRunId);
  }

  /**
   * The child this run awaited was cancelled: cancel this run too, as cancelling inline work
   * cancels the run doing it (#251). The request is recorded as the child's.
   */
  private async cancelForChild(runId: string, childRunId: string): Promise<void> {
    if (await this.ports.runs.claimCancel(runId, ACTIVE_STATUSES, this.now()))
      await this.ports.events.append(runId, [
        { type: 'run.cancel_requested', actor: { kind: 'run', id: childRunId } },
      ]);
    await this.finalizeCancel(runId);
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
    if (version.status === 'snapshot') {
      // A snapshot belongs to the draft runs that pinned it; it is never started again.
      throw new EngineRequestError(
        'VERSION_NOT_PUBLISHED',
        `version ${version.id} is a draft run's snapshot; start the loop's draft or a published version`,
      );
    }
    if (version.status !== 'published' && !input.allowDraft) {
      throw new EngineRequestError('VERSION_NOT_PUBLISHED', `version ${version.id} is a draft`);
    }
    // A definition stored before ADR-0044 can still publish an Event: refuse it at admission.
    assertCurrentDefinition(version);
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
    const manual = triggers.find((t) => t.config.type === 'manual') ?? triggers[0];
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
