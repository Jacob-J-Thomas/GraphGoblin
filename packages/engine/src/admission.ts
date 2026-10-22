import {
  ContextThreadSchema,
  JsonValueSchema,
  LoopVersionRecordSchema,
  SlugSchema,
  UlidSchema,
  RunRecordSchema,
  RunEventSchema,
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
  create(input: RunAdmission, receiptId?: string): Promise<RunRecord>;
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
  // A parent link belongs to a child: it needs the parent run and a node id.
  const parentNodeId =
    raw.parentNodeId === undefined ? undefined : SlugSchema.safeParse(raw.parentNodeId);
  if (parentNodeId && (!parentNodeId.success || run.data.parentRunId === undefined))
    throw new AdmissionConflictError();
  const { runId: _id, seq: _seq, ts: _ts, ...queued } = event.data;
  return {
    run: run.data,
    initialThread: initialThread.data,
    queued,
    pinnedLoopIds: [...(raw.pinnedLoopIds as string[])],
    ...(snapshot ? { snapshot } : {}),
    ...(parentNodeId?.success ? { parentNodeId: parentNodeId.data } : {}),
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
