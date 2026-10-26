import {
  ContextThreadSchema,
  JsonValueSchema,
  LoopVersionRecordSchema,
  SlugSchema,
  UlidSchema,
  RunRecordSchema,
  RunEventSchema,
  ReplayIntentSchema,
  type ReplayIntent,
  type ContextThread,
  type JsonValue,
  type LoopVersionRecord,
  type RunEvent,
  type RunRecord,
} from '@graphgoblin/contracts';
import { stableStringify } from '@graphgoblin/domain';

/** A frozen run start. Storage assigns queued seq 1 and publishes only after commit. */
export interface RunAdmission {
  run: RunRecord;
  initialThread: ContextThread;
  queued: Omit<Extract<RunEvent, { type: 'run.queued' }>, 'runId' | 'seq' | 'ts'>;
  pinnedLoopIds: string[];
  /**
   * A draft start's frozen draft (ADR-0041): status `snapshot`, id `run.versionId`. Storage commits
   * it with the run, so a run never references a snapshot that does not exist.
   */
  snapshot?: LoopVersionRecord;
  /**
   * A subloop child's link on its parent (#320): the parent's subloop node whose visit starts this
   * child. Storage appends the parent's `child_run.started` for this node and child in the same
   * transaction as the child, so a child never exists without its parent's record of it, and the
   * record never names a child that does not exist. Requires `run.parentRunId`.
   */
  parentNodeId?: string;
  /** The fork and its observed intent are one atomic admission, never a source-log append. */
  replayIntent?: ReplayIntent;
}
export interface WebhookInbound {
  id: string;
  ownerId: string;
  type: string;
  payload: JsonValue;
  dedupeKey?: string;
  source: string;
  receivedAt: string;
  runIds: string[];
}
export interface WebhookClaim {
  id: string;
  ownerId: string;
  loopId: string;
  triggerNodeId: string;
  contentHash: string;
  inbound: WebhookInbound;
}
export type WebhookFailureCode =
  'WEBHOOK_ADMISSION_RETRY' | 'WEBHOOK_TARGET_REMOVED' | 'WEBHOOK_INTENT_CONFLICT';
export interface WebhookReceipt {
  id: string;
  ownerId: string;
  loopId: string;
  triggerNodeId: string;
  contentHash: string;
  inboundId: string;
  status: 'filtered' | 'deduplicated' | 'pending' | 'admitted' | 'failed';
  intent?: RunAdmission;
  attempts: number;
  nextAttemptAt?: string;
  failureCode?: WebhookFailureCode;
}
/** Narrow durable webhook admission; not a general message queue. */
export interface TriggerAdmissionPort {
  events: EventAdmissionPort;
  create(input: RunAdmission, receiptId?: string): Promise<RunRecord>;
  /** Finds an admitted fork, including after a lost commit acknowledgement. */
  findReplay(
    sourceRunId: string,
    nodeId: string,
    observedSeq: number,
  ): Promise<RunRecord | undefined>;
  /** Atomic items-only key admission. Undefined means consumed/reserved, without ID reuse. */
  createPollItem(input: RunAdmission): Promise<RunRecord | undefined>;
  claim(input: WebhookClaim, intent: RunAdmission): Promise<{ receipt: WebhookReceipt }>;
  get(id: string): Promise<WebhookReceipt | undefined>;
  /** Select retry identities only; each stored intent is validated independently by get(). */
  due(now: string, limit: number): Promise<Pick<WebhookReceipt, 'id' | 'attempts'>[]>;
  failed(id: string, code: WebhookFailureCode, nextAttemptAt?: string): Promise<void>;
  hasPendingPin(loopId: string): Promise<boolean>;
}
export class AdmissionConflictError extends Error {
  readonly code = 'WEBHOOK_INTENT_CONFLICT';
  constructor() {
    super('The saved admission identity does not match the existing run');
    this.name = 'AdmissionConflictError';
  }
}
export function queuedEvent(input: RunAdmission): Extract<RunEvent, { type: 'run.queued' }> {
  return { ...input.queued, runId: input.run.id, seq: 1, ts: input.run.createdAt };
}
/** Mutable lifecycle fields may advance after commit; immutable invocation and first event may not. */
export function assertAdmissionIdentity(
  input: RunAdmission,
  run: RunRecord,
  thread: ContextThread,
  first: RunEvent | undefined,
): void {
  const identity = (value: RunRecord) => ({
    id: value.id,
    ownerId: value.ownerId,
    loopId: value.loopId,
    versionId: value.versionId,
    pinned: value.pinned,
    parentRunId: value.parentRunId ?? null,
    invocationId: value.invocationId,
    createdAt: value.createdAt,
  });
  if (
    stableStringify(identity(input.run)) !== stableStringify(identity(run)) ||
    stableStringify(input.initialThread) !== stableStringify(thread) ||
    !first ||
    stableStringify(queuedEvent(input)) !== stableStringify(first)
  )
    throw new AdmissionConflictError();
}

/** The parent's `child_run.started` that a child admission commits with the child (#320). */
export function childLinkEvent(
  input: RunAdmission,
): Omit<Extract<RunEvent, { type: 'child_run.started' }>, 'runId' | 'seq' | 'ts'> | undefined {
  return input.parentNodeId === undefined
    ? undefined
    : { type: 'child_run.started', nodeId: input.parentNodeId, childRunId: input.run.id };
}

/** A corrupt saved intent is permanently refused, never interpreted as a new invocation. */
export function parseRunAdmission(value: unknown): RunAdmission {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new AdmissionConflictError();
  const raw = value as Record<string, unknown>;
  const run = RunRecordSchema.safeParse(raw.run);
  const initialThread = ContextThreadSchema.safeParse(raw.initialThread);
  if (
    !run.success ||
    !initialThread.success ||
    !Array.isArray(raw.pinnedLoopIds) ||
    raw.pinnedLoopIds.some((id) => !UlidSchema.safeParse(id).success) ||
    !raw.pinnedLoopIds.includes(run.data.loopId) ||
    new Set(raw.pinnedLoopIds).size !== raw.pinnedLoopIds.length ||
    run.data.status !== 'queued' ||
    run.data.lastEventSeq !== 0 ||
    initialThread.data.run.id !== run.data.id ||
    initialThread.data.run.loopId !== run.data.loopId ||
    initialThread.data.run.versionId !== run.data.versionId ||
    initialThread.data.invocation.id !== run.data.invocationId
  )
    throw new AdmissionConflictError();
  const event = RunEventSchema.safeParse({
    ...(raw.queued as object),
    runId: run.data.id,
    seq: 1,
    ts: run.data.createdAt,
  });
  if (
    !event.success ||
    event.data.type !== 'run.queued' ||
    event.data.versionId !== run.data.versionId ||
    stableStringify(event.data.pinned) !== stableStringify(run.data.pinned) ||
    (event.data.initialThread &&
      stableStringify(event.data.initialThread) !== stableStringify(initialThread.data))
  )
    throw new AdmissionConflictError();
  const snapshot = raw.snapshot === undefined ? undefined : parseSnapshot(raw.snapshot, run.data);
  // A parent link belongs to a child, and every child carries one: the link is what keeps a child
  // from existing without its parent's record of it (#320), so a run that names a parent without
  // naming the parent's subloop node is refused, as is a node without a parent.
  const parentNodeId =
    raw.parentNodeId === undefined ? undefined : SlugSchema.safeParse(raw.parentNodeId);
  const parented = run.data.parentRunId !== undefined && run.data.parentRunId !== null;
  if (parentNodeId ? !parentNodeId.success || !parented : parented)
    throw new AdmissionConflictError();
  const { runId: _id, seq: _seq, ts: _ts, ...queued } = event.data;
  const replayIntent =
    raw.replayIntent === undefined ? undefined : ReplayIntentSchema.safeParse(raw.replayIntent);
  if (
    replayIntent &&
    (!replayIntent.success ||
      parented ||
      stableStringify(initialThread.data.invocation.replayOf) !==
        stableStringify({
          runId: replayIntent.data.sourceRunId,
          nodeId: replayIntent.data.nodeId,
        }) ||
      stableStringify(event.data.replayOf) !==
        stableStringify(initialThread.data.invocation.replayOf))
  )
    throw new AdmissionConflictError();
  return {
    run: run.data,
    initialThread: initialThread.data,
    queued,
    pinnedLoopIds: [...(raw.pinnedLoopIds as string[])],
    ...(snapshot ? { snapshot } : {}),
    ...(parentNodeId?.success ? { parentNodeId: parentNodeId.data } : {}),
    ...(replayIntent?.success ? { replayIntent: replayIntent.data } : {}),
  };
}

/** A draft snapshot belongs to its run's loop and is exactly what the run's pin describes. */
function parseSnapshot(value: unknown, run: RunRecord): LoopVersionRecord {
  const parsed = LoopVersionRecordSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.status !== 'snapshot' ||
    parsed.data.id !== run.versionId ||
    parsed.data.loopId !== run.loopId ||
    parsed.data.publishedAt !== undefined ||
    run.pinned.source !== 'draft' ||
    run.pinned.version !== parsed.data.version ||
    run.pinned.name !== parsed.data.definition.name
  )
    throw new AdmissionConflictError();
  return parsed.data;
}

export function assertWebhookClaim(input: WebhookClaim, intent?: RunAdmission): void {
  if (
    input.inbound.ownerId !== input.ownerId ||
    !/^[a-f0-9]{64}$/.test(input.contentHash) ||
    input.inbound.type !== 'webhook' ||
    input.inbound.runIds.length ||
    !input.inbound.source.startsWith('webhook:') ||
    !JsonValueSchema.safeParse(input.inbound.payload).success
  )
    throw new AdmissionConflictError();
  if (
    intent &&
    (intent.run.ownerId !== input.ownerId ||
      intent.run.loopId !== input.loopId ||
      intent.initialThread.invocation.trigger.nodeId !== input.triggerNodeId ||
      intent.initialThread.invocation.source !== 'webhook' ||
      intent.initialThread.invocation.trigger.kind !== 'webhook' ||
      intent.initialThread.invocation.trigger.dedupeKey !== input.inbound.dedupeKey ||
      stableStringify(intent.initialThread.invocation.trigger.payload) !==
        stableStringify(input.inbound.payload))
  )
    throw new AdmissionConflictError();
}

/** Internal items admission must carry the fully validated poll identity. */
export function pollAdmissionIdentity(input: RunAdmission): { nodeId: string; dedupeKey: string } {
  const { invocation } = input.initialThread;
  const { nodeId, dedupeKey, kind } = invocation.trigger;
  if (invocation.source !== 'poll' || kind !== 'poll' || !dedupeKey?.trim())
    throw new AdmissionConflictError();
  return { nodeId, dedupeKey };
}

/** Targeted external Events have their own receipt ledger; webhook repeat semantics stay separate. */
export interface EventClaim {
  id: string;
  ownerId: string;
  loopId: string;
  versionId: string;
  triggerNodeId: string;
  inbound: WebhookInbound;
  /** Only an authored node expression adds cross-request payload dedupe. */
  nodeDedupeKey?: string;
  /**
   * The request named no entry. Its keyed retry then matches this loop and type on any entry,
   * inside the claim, so a publication that replaces the entry ID cannot open a second delivery.
   */
  implicitEntry?: true;
}
export type EventFailureCode =
  | 'EVENT_INTENT_CONFLICT'
  | 'EVENT_TARGET_REMOVED'
  | 'EVENT_ADMISSION_RETRY'
  | 'EVENT_ADMISSION_EXHAUSTED';
export interface EventReceipt extends EventClaim {
  status: 'pending' | 'admitted' | 'failed' | 'deduplicated';
  intent?: RunAdmission;
  attempts: number;
  nextAttemptAt?: string;
  failureCode?: EventFailureCode;
}
export interface EventAdmissionPort {
  claim(
    input: EventClaim,
    intent: RunAdmission,
  ): Promise<{ receipt: EventReceipt; duplicate: boolean }>;
  find(
    ownerId: string,
    loopId: string,
    type: string,
    key: string,
    nodeId?: string,
  ): Promise<EventReceipt[]>;
  get(id: string): Promise<EventReceipt | undefined>;
  create(intent: RunAdmission, receiptId: string): Promise<RunRecord>;
  /** Due receipts in id order, after `afterId` when given, so recovery can page past a stuck head. */
  due(
    now: string,
    limit: number,
    afterId?: string,
  ): Promise<Pick<EventReceipt, 'id' | 'attempts'>[]>;
  failed(id: string, code: EventFailureCode, nextAttemptAt?: string): Promise<void>;
  hasPendingPin(loopId: string): Promise<boolean>;
}
export function assertEventClaim(input: EventClaim, intent: RunAdmission): void {
  const { invocation } = intent.initialThread;
  if (
    input.ownerId !== input.inbound.ownerId ||
    input.ownerId !== intent.run.ownerId ||
    input.loopId !== intent.run.loopId ||
    input.versionId !== intent.run.versionId ||
    input.triggerNodeId !== invocation.trigger.nodeId ||
    invocation.source !== 'event' ||
    invocation.trigger.kind !== 'event' ||
    (input.nodeDedupeKey !== undefined && input.nodeDedupeKey !== invocation.trigger.dedupeKey) ||
    invocation.trigger.eventType !== input.inbound.type ||
    stableStringify(invocation.trigger.payload) !== stableStringify(input.inbound.payload)
  )
    throw new AdmissionConflictError();
}
