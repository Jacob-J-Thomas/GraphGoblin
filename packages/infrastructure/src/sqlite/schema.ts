import type { ReplayState } from '@graphgoblin/domain';
import { sql } from 'drizzle-orm';
import type { RunAdmission, WebhookFailureCode, EventFailureCode } from '@graphgoblin/engine';
import type {
  ClassifierModelEntry,
  ContextThread,
  Effort,
  LoopDefinition,
  LoopVersionStatus,
  RunFailure,
  DeletionApproval,
  RunPin,
  WaitSpec,
} from '@graphgoblin/contracts';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Drizzle schema. Every owner-scoped table carries owner_id (docs/03). JSON columns are stored as
 * text and typed through `$type` so repositories stay type-safe. Timestamps are UTC ISO strings;
 * SQLite compares them lexically, which is correct for the fixed format we write.
 */

export const loops = sqliteTable(
  'loops',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    currentVersionId: text('current_version_id'),
    draftVersionId: text('draft_version_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('loops_owner_idx').on(t.ownerId)],
);

export const loopVersions = sqliteTable(
  'loop_versions',
  {
    id: text('id').primaryKey(),
    loopId: text('loop_id').notNull(),
    version: integer('version').notNull(),
    /** `snapshot` rows are draft copies pinned by draft runs; triggers keep them immutable. */
    status: text('status', { enum: ['draft', 'published', 'snapshot'] })
      .$type<LoopVersionStatus>()
      .notNull(),
    definition: text('definition', { mode: 'json' }).$type<LoopDefinition>().notNull(),
    createdAt: text('created_at').notNull(),
    publishedAt: text('published_at'),
  },
  (t) => [index('loop_versions_loop_idx').on(t.loopId, t.version)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    loopId: text('loop_id').notNull(),
    versionId: text('version_id').notNull(),
    parentRunId: text('parent_run_id'),
    /** Indexed replay provenance; written with the initial thread at admission. */
    replaySourceRunId: text('replay_source_run_id'),
    invocationId: text('invocation_id').notNull(),
    status: text('status').notNull(),
    currentNodeId: text('current_node_id'),
    iteration: integer('iteration').notNull(),
    waiting: text('waiting', { mode: 'json' }).$type<WaitSpec>(),
    cancelRequestedAt: text('cancel_requested_at'),
    pausedAt: text('paused_at'),
    failure: text('failure', { mode: 'json' }).$type<RunFailure>(),
    outcome: text('outcome'),
    /** SQL NULL is absence; JSON text `null` is a present result. Encode explicitly. */
    result: text('result'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    initialThread: text('initial_thread', { mode: 'json' }).$type<ContextThread>().notNull(),
    threadSnapshot: text('thread_snapshot', { mode: 'json' }).$type<ContextThread>(),
    /** The last event seq the snapshot reflects, when it is a verified checkpoint. */
    threadSnapshotSeq: integer('thread_snapshot_seq'),
    /** Writer-recorded replay state at the snapshot seq; NULL checkpoints need their prefix. */
    threadSnapshotReplayState: text('thread_snapshot_replay_state', {
      mode: 'json',
    }).$type<ReplayState>(),
    /** Set when everything after the terminal status (timers, children, returns, parent) is done. */
    finalizedAt: text('finalized_at'),
    deletionApproval: text('deletion_approval', { mode: 'json' }).$type<DeletionApproval>(),
    deletionRevision: integer('deletion_revision').notNull().default(0),
    /**
     * What `version_id` pins (ADR-0041). Nullable only because SQLite cannot add a NOT NULL column
     * without a default; every run is written with one and migration 0014 pinned the runs before it.
     */
    pinned: text('pinned', { mode: 'json' }).$type<RunPin>(),
  },
  (t) => [
    index('runs_owner_status_idx').on(t.ownerId, t.status),
    index('runs_loop_idx').on(t.loopId, t.createdAt),
    index('runs_loop_owner_history_idx').on(t.loopId, t.ownerId, t.createdAt, t.id),
    // Drizzle Kit 0.31 renders SQLite expression indexes incorrectly; 0008 supplies exact SQL.
    index('runs_trigger_dedupe_idx').on(
      t.loopId,
      sql`json_extract(${t.initialThread}, '$.invocation.trigger.nodeId')`,
      sql`json_extract(${t.initialThread}, '$.invocation.trigger.dedupeKey')`,
    ),
    index('runs_parent_idx').on(t.parentRunId),
    index('runs_replay_source_idx').on(t.replaySourceRunId),
    index('runs_deletion_approval_idx').on(t.deletionApproval),
    // Which runs pin a definition record: snapshot clean-up and the snapshot delete guard (0014).
    index('runs_version_idx').on(t.versionId),
  ],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    runId: text('run_id').notNull(),
    seq: integer('seq').notNull(),
    ts: text('ts').notNull(),
    type: text('type').notNull(),
    nodeId: text('node_id'),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.seq] }),
    index('run_events_delivery_idx').on(t.runId, t.type, t.seq),
  ],
);

export const harnessSessions = sqliteTable(
  'harness_sessions',
  {
    runId: text('run_id').notNull(),
    nodeId: text('node_id').notNull(),
    attempt: integer('attempt').notNull(),
    harness: text('harness').notNull(),
    sessionId: text('session_id'),
    status: text('status').notNull(),
    model: text('model'),
    effort: text('effort').$type<Effort>(),
    scopeKey: text('scope_key'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.nodeId, t.attempt] }),
    index('harness_sessions_scope_idx').on(t.scopeKey),
  ],
);

export const timers = sqliteTable(
  'timers',
  {
    runId: text('run_id').notNull(),
    key: text('key').notNull(),
    at: text('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.key] }), index('timers_at_idx').on(t.at)],
);

export const secrets = sqliteTable(
  'secrets',
  {
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    /** base64 of iv (12) + tag (16) + ciphertext */
    ciphertext: text('ciphertext').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.name] })],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    label: text('label').notNull(),
    hash: text('hash').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('api_keys_hash_idx').on(t.hash)],
);

export const settings = sqliteTable(
  'settings',
  {
    ownerId: text('owner_id').notNull(),
    key: text('key').notNull(),
    /** JSON text, including `null`; Drizzle's json mode would write SQL NULL for it. */
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.key] })],
);

export const classifierModels = sqliteTable(
  'classifier_models',
  {
    ownerId: text('owner_id').notNull(),
    id: text('id').notNull(),
    displayName: text('display_name').notNull(),
    source: text('source', { enum: ['builtin', 'custom'] }).notNull(),
    provider: text('provider', { enum: ['typesafe', 'http'] }).notNull(),
    providerModel: text('provider_model').notNull(),
    primitives: text('primitives', { mode: 'json' })
      .$type<ClassifierModelEntry['primitives']>()
      .notNull(),
    endpoint: text('endpoint').notNull(),
    secretRef: text('secret_ref'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.id] })],
);

export const modelCatalog = sqliteTable(
  'model_catalog',
  {
    harness: text('harness').notNull(),
    model: text('model').notNull(),
    source: text('source', { enum: ['harness', 'litellm'] })
      .notNull()
      .default('harness'),
    displayName: text('display_name').notNull(),
    efforts: text('efforts', { mode: 'json' }).$type<Effort[]>().notNull(),
    defaultEffort: text('default_effort').$type<Effort>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.harness, t.model] })],
);

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    loopId: text('loop_id').notNull(),
    versionId: text('version_id').notNull(),
    triggerNodeId: text('trigger_node_id').notNull(),
    expression: text('expression').notNull(),
    timezone: text('timezone').notNull(),
    missedFirePolicy: text('missed_fire_policy', {
      enum: ['skip', 'run-once', 'run-each'],
    }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    nextFireAt: text('next_fire_at'),
    lastFiredAt: text('last_fired_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('schedules_due_idx').on(t.enabled, t.nextFireAt),
    index('schedules_loop_idx').on(t.loopId, t.versionId),
  ],
);

export const webhookEndpoints = sqliteTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    loopId: text('loop_id').notNull(),
    versionId: text('version_id').notNull(),
    triggerNodeId: text('trigger_node_id').notNull(),
    /** Random 32-byte URL-safe value; the public path is `/hooks/<token>`. Kept across versions. */
    token: text('token').notNull(),
    authType: text('auth_type', { enum: ['none', 'hmac-sha256'] }).notNull(),
    signatureMessage: text('signature_message', { enum: ['body', 'timestamp-body'] }),
    signatureHeader: text('signature_header'),
    secretRef: text('secret_ref'),
    windowSeconds: integer('window_seconds'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('webhook_endpoints_token_idx').on(t.token),
    index('webhook_endpoints_loop_idx').on(t.loopId, t.versionId),
    check(
      'webhook_endpoint_signing_check',
      sql`(${t.authType} = 'none' AND ${t.signatureMessage} IS NULL AND ${t.signatureHeader} IS NULL AND ${t.secretRef} IS NULL AND ${t.windowSeconds} IS NULL) OR (${t.authType} = 'hmac-sha256' AND ${t.signatureHeader} IS NOT NULL AND ${t.secretRef} IS NOT NULL AND ((${t.signatureMessage} IS NOT NULL AND ${t.signatureMessage} = 'body' AND ${t.windowSeconds} IS NULL) OR (${t.signatureMessage} IS NOT NULL AND ${t.signatureMessage} = 'timestamp-body' AND ${t.windowSeconds} IS NOT NULL AND typeof(${t.windowSeconds}) = 'integer' AND ${t.windowSeconds} BETWEEN 1 AND 86400)))`,
    ),
  ],
);

export const inboundEvents = sqliteTable(
  'inbound_events',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    type: text('type').notNull(),
    /** JSON text, written by hand: drizzle's json mode stores a JSON `null` as SQL NULL. */
    payload: text('payload').notNull(),
    dedupeKey: text('dedupe_key'),
    /** `api`, `run:<runId>`, or `webhook:<endpointId>`. */
    source: text('source').notNull(),
    receivedAt: text('received_at').notNull(),
    runIds: text('run_ids', { mode: 'json' }).$type<string[]>().notNull(),
  },
  (t) => [
    index('inbound_events_owner_idx').on(t.ownerId, t.receivedAt),
    index('inbound_events_type_dedupe_idx').on(t.ownerId, t.type, t.dedupeKey),
    index('inbound_events_source_dedupe_idx').on(t.ownerId, t.source, t.dedupeKey),
  ],
);

export const webhookReceipts = sqliteTable(
  'webhook_receipts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    loopId: text('loop_id').notNull(),
    triggerNodeId: text('trigger_node_id').notNull(),
    contentHash: text('content_hash').notNull(),
    inboundId: text('inbound_id').notNull(),
    status: text('status', {
      enum: ['filtered', 'deduplicated', 'pending', 'admitted', 'failed'],
    }).notNull(),
    intent: text('intent', { mode: 'json' }).$type<RunAdmission>(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    failureCode: text('failure_code').$type<WebhookFailureCode>(),
  },
  (t) => [
    index('webhook_receipts_content_idx').on(t.ownerId, t.loopId, t.triggerNodeId, t.contentHash),
    uniqueIndex('webhook_receipts_inbound_idx').on(t.inboundId),
    index('webhook_receipts_due_idx').on(t.status, t.nextAttemptAt),
    check(
      'webhook_receipt_status_check',
      sql`${t.status} IN ('filtered','deduplicated','pending','admitted','failed')`,
    ),
    check(
      'webhook_receipt_intent_check',
      sql`(${t.status} IN ('filtered','deduplicated') AND ${t.intent} IS NULL) OR (${t.status} NOT IN ('filtered','deduplicated') AND ${t.intent} IS NOT NULL)`,
    ),
  ],
);

/** Separate from URL webhook receipts: request keys resolve the original targeted delivery. */
export const eventReceipts = sqliteTable(
  'event_receipts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    loopId: text('loop_id').notNull(),
    versionId: text('version_id').notNull(),
    triggerNodeId: text('trigger_node_id').notNull(),
    inboundId: text('inbound_id').notNull(),
    eventType: text('event_type').notNull(),
    requestKey: text('request_key'),
    nodeKey: text('node_key'),
    status: text('status', { enum: ['deduplicated', 'pending', 'admitted', 'failed'] }).notNull(),
    intent: text('intent', { mode: 'json' }).$type<RunAdmission>(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    failureCode: text('failure_code').$type<EventFailureCode>(),
  },
  (t) => [
    uniqueIndex('event_receipts_inbound_idx').on(t.inboundId),
    uniqueIndex('event_receipts_request_idx').on(
      t.ownerId,
      t.loopId,
      t.triggerNodeId,
      t.eventType,
      t.requestKey,
    ),
    index('event_receipts_due_idx').on(t.status, t.nextAttemptAt),
    index('event_receipts_node_key_idx').on(t.ownerId, t.loopId, t.triggerNodeId, t.nodeKey),
    check(
      'event_receipt_status_check',
      sql`${t.status} IN ('deduplicated','pending','admitted','failed')`,
    ),
    check(
      'event_receipt_intent_check',
      sql`(${t.status} = 'deduplicated' AND ${t.intent} IS NULL) OR (${t.status} <> 'deduplicated' AND ${t.intent} IS NOT NULL)`,
    ),
  ],
);

/** Positive creation proof; pending rows survive removal of their owner's history. */
export const runResources = sqliteTable(
  'run_resources',
  {
    key: text('key').primaryKey(),
    ownerRunId: text('owner_run_id').notNull(),
    kind: text('kind', { enum: ['workspace', 'artifact'] }).notNull(),
    path: text('path').notNull(),
    identity: text('identity').notNull(),
    physicalPath: text('physical_path'),
    approval: text('approval', { mode: 'json' }).$type<DeletionApproval>(),
    pending: integer('pending', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('run_resources_owner_idx').on(t.ownerRunId),
    index('run_resources_pending_idx').on(t.pending, t.key),
  ],
);

export const runResourceUses = sqliteTable(
  'run_resource_uses',
  {
    runId: text('run_id').notNull(),
    key: text('key').notNull(),
    path: text('path').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.key] }), index('run_resource_uses_key_idx').on(t.key)],
);

/** Live workspace obligations, maintained only by admission/version/use changes, never events. */
export const workspaceReferences = sqliteTable(
  'workspace_references',
  {
    id: text('id').primaryKey(),
    runId: text('run_id'),
    versionId: text('version_id'),
    path: text('path'),
    physicalPath: text('physical_path'),
    checkedEpoch: integer('checked_epoch').notNull().default(0),
  },
  (t) => [
    index('workspace_references_physical_idx').on(t.physicalPath),
    index('workspace_references_run_idx').on(t.runId),
    index('workspace_references_version_idx').on(t.versionId),
    index('workspace_references_epoch_idx').on(t.checkedEpoch, t.id),
  ],
);

/** A bounded refresh sweep must finish before any workspace can be staged. */
export const workspaceReferenceState = sqliteTable('workspace_reference_state', {
  id: integer('id').primaryKey(),
  epoch: integer('epoch').notNull().default(0),
  sweeping: integer('sweeping', { mode: 'boolean' }).notNull().default(false),
});

export const schema = {
  workspaceReferences,
  workspaceReferenceState,
  runResources,
  runResourceUses,
  webhookReceipts,
  eventReceipts,
  classifierModels,
  loops,
  loopVersions,
  runs,
  runEvents,
  harnessSessions,
  timers,
  secrets,
  apiKeys,
  settings,
  modelCatalog,
  schedules,
  webhookEndpoints,
  inboundEvents,
};
export type Schema = typeof schema;
