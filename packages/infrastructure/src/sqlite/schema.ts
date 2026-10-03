import type {
  ContextThread,
  Effort,
  JsonValue,
  LoopDefinition,
  RunFailure,
  WaitSpec,
} from '@graphgoblin/contracts';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    status: text('status', { enum: ['draft', 'published'] }).notNull(),
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
    invocationId: text('invocation_id').notNull(),
    status: text('status').notNull(),
    currentNodeId: text('current_node_id'),
    iteration: integer('iteration').notNull(),
    waiting: text('waiting', { mode: 'json' }).$type<WaitSpec>(),
    cancelRequestedAt: text('cancel_requested_at'),
    pausedAt: text('paused_at'),
    failure: text('failure', { mode: 'json' }).$type<RunFailure>(),
    outcome: text('outcome'),
    result: text('result', { mode: 'json' }).$type<JsonValue>(),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    initialThread: text('initial_thread', { mode: 'json' }).$type<ContextThread>().notNull(),
    threadSnapshot: text('thread_snapshot', { mode: 'json' }).$type<ContextThread>(),
    /** The last event seq the snapshot reflects, when it is a verified checkpoint. */
    threadSnapshotSeq: integer('thread_snapshot_seq'),
    /** Set when everything after the terminal status (timers, children, returns, parent) is done. */
    finalizedAt: text('finalized_at'),
  },
  (t) => [
    index('runs_owner_status_idx').on(t.ownerId, t.status),
    index('runs_loop_idx').on(t.loopId, t.createdAt),
    index('runs_parent_idx').on(t.parentRunId),
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
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
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
    value: text('value', { mode: 'json' }).$type<JsonValue>().notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.key] })],
);

export const modelCatalog = sqliteTable(
  'model_catalog',
  {
    harness: text('harness').notNull(),
    model: text('model').notNull(),
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
    /** Secret name in the owner's secret store; the value is resolved at verification time. */
    secretRef: text('secret_ref').notNull(),
    signatureHeader: text('signature_header').notNull(),
    replayWindowSeconds: integer('replay_window_seconds').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('webhook_endpoints_token_idx').on(t.token),
    index('webhook_endpoints_loop_idx').on(t.loopId, t.versionId),
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

export const schema = {
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
