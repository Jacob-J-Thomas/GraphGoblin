import { inspectTriggerUpgrade, rewriteWebhookThreadKey } from './trigger-upgrade.js';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Client, Transaction } from '@libsql/client';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import {
  ContextThreadSchema,
  HarnessDefaultsSchema,
  LoopDefinitionSchema,
  RunEventSchema,
  RunRecordSchema,
  TimestampSchema,
  type LoopDefinition,
} from '@graphgoblin/contracts';
import {
  stableStringify,
  upgradeLoopCurrent,
  upgradeRunHistoryCurrent,
  upgradedFailure,
  upgradeDefaultsV1,
  validateUpgradeCurrentResolutions,
  type UpgradeIssue,
  type UpgradeCurrentResolutions,
} from '@graphgoblin/domain';

type Executor = Pick<Client, 'execute'>;
type RawRow = Record<string, unknown>;
const object = (value: unknown): value is RawRow =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function legacyPredicatePaths(value: unknown): string[] {
  if (!object(value) || !Array.isArray(value.nodes)) return [];
  return value.nodes.flatMap((node: unknown, index: number) => {
    if (
      !object(node) ||
      node.kind !== 'exit' ||
      !object(node.config) ||
      !Array.isArray(node.config.criteria)
    )
      return [];
    return node.config.criteria.flatMap((criterion: unknown, criterionIndex: number) =>
      object(criterion) && criterion.when === 'predicate' && 'strategy' in criterion
        ? [`/nodes/${index}/config/criteria/${criterionIndex}`]
        : [],
    );
  });
}
function recordedAffectedChild(row: RawRow, affected: Set<string>): boolean {
  if (row.type !== 'run.queued') return false;
  try {
    const payload = json(row.payload);
    return (
      object(payload) &&
      object(payload.subloopVersions) &&
      Object.values(payload.subloopVersions).some((id) => affected.has(String(id)))
    );
  } catch {
    return false;
  }
}
const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const NONTERMINAL = new Set(['queued', 'running', 'waiting', 'paused']);
const hash = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');
function json(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('stored JSON column is not text');
  return JSON.parse(value);
}
async function rows(client: Executor, sql: string): Promise<RawRow[]> {
  const result = await client.execute(sql);
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column) => [column, row[column]])),
  );
}
async function tables(client: Executor): Promise<string[]> {
  return (await rows(client, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"))
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith('sqlite_'));
}
function quote(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}

export class DatabaseUpgradeRequiredError extends Error {
  readonly code = 'DATA_UPGRADE_REQUIRED';
  constructor(
    message = 'Stored data requires the offline graphgoblin-upgrade tool before startup',
  ) {
    super(message);
    this.name = 'DatabaseUpgradeRequiredError';
  }
}
/** Must run before Drizzle migrations, run recovery, catalog seeding or trigger admission. */
export async function guardDatabaseUpgrade(client: Executor): Promise<'fresh' | 'current'> {
  const names = await tables(client);
  const application = names.filter((name) => name !== '__drizzle_migrations');
  if (application.length === 0) {
    if (
      names.includes('__drizzle_migrations') &&
      (await rows(client, 'SELECT * FROM __drizzle_migrations')).length
    )
      throw new DatabaseUpgradeRequiredError(
        'Recorded migration history without application tables requires explicit repair',
      );
    return 'fresh';
  }
  if (!names.includes('gg_upgrade_state')) throw new DatabaseUpgradeRequiredError();
  const states = await rows(client, 'SELECT * FROM gg_upgrade_state');
  if (states.length !== 1 || states[0]?.format_version !== 3 || states[0]?.status !== 'complete')
    throw new DatabaseUpgradeRequiredError(
      'The offline upgrade is incomplete; restore the backup or finish its approved manifest',
    );
  const endpointColumns = names.includes('webhook_endpoints')
    ? await rows(client, 'PRAGMA table_info(webhook_endpoints)')
    : [];
  const receiptColumns = names.includes('webhook_receipts')
    ? await rows(client, 'PRAGMA table_info(webhook_receipts)')
    : [];
  const indexes = await rows(client, "SELECT name FROM sqlite_master WHERE type='index'");
  if (
    !endpointColumns.some((row) => row.name === 'signature_scheme' && row.notnull === 1) ||
    !endpointColumns.some((row) => row.name === 'replay_window_seconds' && row.notnull === 0) ||
    [
      'id',
      'owner_id',
      'loop_id',
      'trigger_node_id',
      'content_hash',
      'inbound_id',
      'status',
      'intent',
      'attempts',
      'next_attempt_at',
      'failure_code',
    ].some((name) => !receiptColumns.some((row) => row.name === name)) ||
    [
      'webhook_receipts_content_idx',
      'webhook_receipts_inbound_idx',
      'webhook_receipts_due_idx',
      'runs_trigger_dedupe_idx',
    ].some((name) => !indexes.some((row) => row.name === name))
  )
    throw new DatabaseUpgradeRequiredError(
      'Stored v2 data requires the explicit offline trigger structural upgrade',
    );
  const ledger = names.includes('__drizzle_migrations')
    ? await rows(client, 'SELECT created_at FROM __drizzle_migrations')
    : [];
  const receiptIndexes = await rows(client, 'PRAGMA index_list(webhook_receipts)');
  if (
    !ledger.some((row) => Number(row.created_at) >= 1791396000000) ||
    ['webhook_receipts_content_idx', 'webhook_receipts_inbound_idx'].some(
      (name) => !receiptIndexes.some((row) => row.name === name && row.unique === 1),
    )
  )
    throw new DatabaseUpgradeRequiredError(
      'The trigger structural migration and unique receipt indexes are incomplete',
    );
  const receiptDdl = (
    await rows(
      client,
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='webhook_receipts'",
    )
  )[0]?.sql;
  const normalizedReceiptDdl =
    typeof receiptDdl === 'string' ? receiptDdl.toLowerCase().replace(/[\s"`]/g, '') : '';
  if (
    !normalizedReceiptDdl.includes(
      "constraintwebhook_receipt_status_checkcheck(statusin('filtered','deduplicated','pending','admitted','failed'))",
    ) ||
    !normalizedReceiptDdl.includes(
      "constraintwebhook_receipt_intent_checkcheck((statusin('filtered','deduplicated')andintentisnull)or(statusnotin('filtered','deduplicated')andintentisnotnull))",
    )
  )
    throw new DatabaseUpgradeRequiredError('Stored webhook receipt constraints are incomplete');
  const malformed = await rows(
    client,
    "SELECT id FROM webhook_endpoints WHERE signature_scheme IS NULL OR signature_scheme NOT IN ('hmac-sha256','hmac-sha256-body') OR NOT ((signature_scheme='hmac-sha256' AND replay_window_seconds IS NOT NULL AND replay_window_seconds>0) OR (signature_scheme='hmac-sha256-body' AND replay_window_seconds IS NULL))",
  );
  if (malformed.length)
    throw new DatabaseUpgradeRequiredError('Stored webhook signing fields are inconsistent');
  for (const row of names.includes('loop_versions')
    ? await rows(client, 'SELECT definition FROM loop_versions')
    : []) {
    try {
      LoopDefinitionSchema.parse(json(row.definition));
    } catch {
      throw new DatabaseUpgradeRequiredError('A stored loop version is not strict v3');
    }
  }
  if (names.includes('settings')) {
    for (const row of await rows(client, 'SELECT key, value FROM settings')) {
      if (row.key === 'defaultModel' || row.key === 'defaultEffort')
        throw new DatabaseUpgradeRequiredError('Owner defaults require offline conversion');
      if (row.key === 'defaults') {
        try {
          HarnessDefaultsSchema.parse(json(row.value));
        } catch {
          throw new DatabaseUpgradeRequiredError('Owner harness defaults are invalid');
        }
      }
    }
  }
  return 'current';
}
const STATE_SQL =
  'CREATE TABLE IF NOT EXISTS gg_upgrade_state (id INTEGER PRIMARY KEY CHECK(id=1), format_version INTEGER NOT NULL, status TEXT NOT NULL, source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL)';
const ARCHIVE_SQL =
  'CREATE TABLE IF NOT EXISTS gg_upgrade_archive (kind TEXT NOT NULL, identity TEXT NOT NULL, source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,identity,manifest_hash))';
export async function stampFreshDatabase(client: Executor): Promise<void> {
  await client.execute(STATE_SQL);
  await client.execute(
    "INSERT INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,3,'complete','fresh','fresh')",
  );
}

export interface DatabaseUpgradeInventory {
  sourceHash: string;
  tables: Record<string, RawRow[]>;
  versions: {
    id: string;
    loopId: string;
    definitionHash: string;
    issues: UpgradeIssue[];
    decisions: string[];
    predicates: string[];
  }[];
  failedRuns: string[];
  blockedRuns: { id: string; status: string }[];
  issues: UpgradeIssue[];
}
/** Whole stopped database, including hidden/deleted versions, orphaned runs and all owners. */
export async function inspectDatabaseUpgrade(client: Executor): Promise<DatabaseUpgradeInventory> {
  const stored: Record<string, RawRow[]> = {};
  for (const name of await tables(client)) {
    if (name === 'gg_upgrade_state' || name === 'gg_upgrade_archive') continue;
    const found = await rows(client, 'SELECT * FROM ' + quote(name));
    stored[name] = found.sort((a, b) =>
      stableStringify(a) < stableStringify(b)
        ? -1
        : stableStringify(a) > stableStringify(b)
          ? 1
          : 0,
    );
  }
  const versions: DatabaseUpgradeInventory['versions'] = [];
  const issues: UpgradeIssue[] = [];
  const affected = new Set<string>();
  for (const row of stored.loop_versions ?? []) {
    try {
      const definition = json(row.definition);
      const result = upgradeLoopCurrent(definition);
      const predicates = legacyPredicatePaths(definition);
      const decisions =
        typeof definition === 'object' &&
        definition !== null &&
        'nodes' in definition &&
        Array.isArray(definition.nodes)
          ? definition.nodes
              .filter(
                (node: unknown) =>
                  typeof node === 'object' &&
                  node !== null &&
                  'kind' in node &&
                  node.kind === 'decision',
              )
              .map((node: { id?: unknown }) => String(node.id))
          : [];
      if (
        predicates.length ||
        (typeof definition === 'object' &&
          definition !== null &&
          'schemaVersion' in definition &&
          definition.schemaVersion === 1 &&
          (decisions.length ||
            (typeof definition === 'object' &&
              definition !== null &&
              'nodes' in definition &&
              Array.isArray(definition.nodes) &&
              definition.nodes.some(
                (node: unknown) =>
                  typeof node === 'object' &&
                  node !== null &&
                  'kind' in node &&
                  node.kind === 'subloop',
              ))))
      )
        affected.add(String(row.id));
      versions.push({
        id: String(row.id),
        loopId: String(row.loop_id),
        definitionHash: hash(definition),
        issues: result.ok ? [] : result.issues,
        decisions,
        predicates,
      });
    } catch {
      issues.push({
        code: 'UPGRADE_STORED_JSON_INVALID',
        path: '/loop_versions/' + String(row.id),
        message: 'definition cannot be inventoried',
      });
    }
  }
  // A failed parent can replay into an affected child even when the parent's own exit is unchanged.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of stored.loop_versions ?? []) {
      if (affected.has(String(row.id))) continue;
      try {
        const definition = json(row.definition);
        if (!object(definition) || !Array.isArray(definition.nodes)) continue;
        const reachesAffected = definition.nodes.some((node: unknown) => {
          if (
            !object(node) ||
            node.kind !== 'subloop' ||
            !object(node.config) ||
            !object(node.config.loopRef)
          )
            return false;
          const ref = node.config.loopRef;
          return (stored.loop_versions ?? []).some(
            (child) =>
              child.loop_id === ref.loopId &&
              (ref.version === 'latest'
                ? child.status === 'published'
                : child.version === ref.version) &&
              affected.has(String(child.id)),
          );
        });
        if (reachesAffected) {
          affected.add(String(row.id));
          changed = true;
        }
      } catch {
        /* malformed definitions already have an inventory refusal */
      }
    }
  }
  for (const run of stored.runs ?? [])
    if (!(stored.loop_versions ?? []).some((version) => version.id === run.version_id))
      issues.push({
        code: 'UPGRADE_ORPHAN_RUN_VERSION',
        path: '/runs/' + String(run.id) + '/version_id',
        message:
          'run references no inventoried version; explicit repair is required before classifying historical outputs',
      });
  const events = stored.run_events ?? [];
  const failedRuns = (stored.runs ?? [])
    .filter(
      (run) =>
        run.status === 'failed' &&
        (affected.has(String(run.version_id)) ||
          events.some(
            (event) =>
              event.run_id === run.id &&
              (legacyDecisionEvent(event) || recordedAffectedChild(event, affected)),
          )),
    )
    .map((run) => String(run.id));
  const blockedRuns = (stored.runs ?? [])
    .filter((run) => NONTERMINAL.has(String(run.status)))
    .map((run) => ({ id: String(run.id), status: String(run.status) }));
  for (const event of events)
    if (!(stored.runs ?? []).some((run) => run.id === event.run_id))
      issues.push({
        code: 'UPGRADE_ORPHAN_EVENTS',
        path: '/run_events/' + String(event.run_id),
        message: 'events have no run/initial thread; explicit repair is required before upgrade',
      });
  issues.push(...inspectTriggerUpgrade(stored).issues);
  return { sourceHash: hash(stored), tables: stored, versions, failedRuns, blockedRuns, issues };
}

export interface DatabaseUpgradeManifest {
  format: 'graphgoblin-upgrade-manifest';
  targetVersion: 3;
  sourceHash: string;
  approvedBy: string;
  approvedAt: string;
  versions: Record<string, { definitionHash: string; resolutions: UpgradeCurrentResolutions }>;
  failedRuns: Record<string, { disposition: 'nonresumable-replay'; reason: string }>;
}
function validateManifest(
  manifest: DatabaseUpgradeManifest,
  inventory: DatabaseUpgradeInventory,
): void {
  const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const raw: unknown = manifest;
  if (
    !object(raw) ||
    Object.keys(raw).some(
      (key) =>
        ![
          'format',
          'targetVersion',
          'sourceHash',
          'approvedBy',
          'approvedAt',
          'versions',
          'failedRuns',
        ].includes(key),
    ) ||
    typeof raw.approvedBy !== 'string' ||
    !object(raw.versions) ||
    !object(raw.failedRuns) ||
    Object.values(raw.versions).some(
      (version) =>
        !object(version) ||
        Object.keys(version).some((key) => !['definitionHash', 'resolutions'].includes(key)) ||
        typeof version.definitionHash !== 'string' ||
        validateUpgradeCurrentResolutions(version.resolutions).length > 0,
    ) ||
    Object.values(raw.failedRuns).some(
      (run) =>
        !object(run) ||
        Object.keys(run).some((key) => !['disposition', 'reason'].includes(key)) ||
        typeof run.reason !== 'string',
    )
  )
    throw new DatabaseUpgradeRequiredError(
      'The manifest must satisfy the exact documented owner approval shape',
    );
  if (
    manifest.format !== 'graphgoblin-upgrade-manifest' ||
    manifest.targetVersion !== 3 ||
    manifest.sourceHash !== inventory.sourceHash ||
    !manifest.approvedBy.trim() ||
    !TimestampSchema.safeParse(manifest.approvedAt).success
  )
    throw new DatabaseUpgradeRequiredError(
      'The approved manifest identity, timestamp or source hash is invalid/stale',
    );
  if (inventory.blockedRuns.length)
    throw new DatabaseUpgradeRequiredError(
      'Drain/cancel every nonterminal run with the old build before upgrade',
    );
  if (inventory.issues.length)
    throw new DatabaseUpgradeRequiredError(
      'Inventory contains structural refusals; resolve them before upgrade',
    );
  const ids = new Set(inventory.versions.map((version) => version.id));
  for (const version of inventory.versions) {
    const selected = manifest.versions[version.id];
    if (!selected || selected.definitionHash !== version.definitionHash)
      throw new DatabaseUpgradeRequiredError(
        'Each version requires its exact inventoried definition hash',
      );
  }
  for (const id of Object.keys(manifest.versions))
    if (!ids.has(id)) throw new DatabaseUpgradeRequiredError('Manifest names an unknown version');
  for (const id of inventory.failedRuns) {
    const selected = manifest.failedRuns[id];
    if (!selected || selected.disposition !== 'nonresumable-replay' || !selected.reason.trim())
      throw new DatabaseUpgradeRequiredError(
        'Every affected failed run requires an explicit nonresumable/replay disposition',
      );
  }
  for (const id of Object.keys(manifest.failedRuns))
    if (!inventory.failedRuns.includes(id))
      throw new DatabaseUpgradeRequiredError(
        'Manifest disposition names an unaffected or unknown failed run',
      );
}
async function structuralMigrations(tx: Transaction, folder: string): Promise<void> {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  const last = (
    await rows(tx, 'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
  )[0];
  const lastTime = Number(last?.created_at ?? 0);
  for (const migration of readMigrationFiles({ migrationsFolder: folder })) {
    if (migration.folderMillis <= lastTime) continue;
    for (const statement of migration.sql) await tx.execute(statement);
    await tx.execute({
      sql: 'INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)',
      args: [migration.hash, migration.folderMillis],
    });
  }
}
function eventOf(row: RawRow): RawRow {
  const payload = json(row.payload);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    throw new Error('invalid event JSON');
  return {
    ...payload,
    runId: row.run_id,
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    ...(row.node_id ? { nodeId: row.node_id } : {}),
  };
}
function legacyDecisionEvent(row: RawRow): boolean {
  if (row.type !== 'decision.made') return false;
  try {
    const payload = json(row.payload);
    return typeof payload !== 'object' || payload === null || !('answer' in payload);
  } catch {
    return true;
  }
}
function recordOf(row: RawRow): RawRow {
  const record: RawRow = {};
  const scalar = {
    id: 'id',
    ownerId: 'owner_id',
    loopId: 'loop_id',
    versionId: 'version_id',
    parentRunId: 'parent_run_id',
    invocationId: 'invocation_id',
    status: 'status',
    currentNodeId: 'current_node_id',
    iteration: 'iteration',
    cancelRequestedAt: 'cancel_requested_at',
    pausedAt: 'paused_at',
    outcome: 'outcome',
    createdAt: 'created_at',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    lastEventSeq: 'last_event_seq',
  };
  for (const [key, column] of Object.entries(scalar))
    if (row[column] !== null && row[column] !== undefined) record[key] = row[column];
  for (const [key, column] of Object.entries({
    waiting: 'waiting',
    failure: 'failure',
    result: 'result',
  }))
    if (row[column] !== null && row[column] !== undefined) record[key] = json(row[column]);
  return record;
}
async function archive(
  tx: Transaction,
  kind: string,
  identity: string,
  payload: unknown,
  sourceHash: string,
  manifestHash: string,
): Promise<void> {
  await tx.execute({
    sql: 'INSERT INTO gg_upgrade_archive (kind,identity,source_hash,manifest_hash,payload) VALUES (?,?,?,?,?)',
    args: [kind, identity, sourceHash, manifestHash, JSON.stringify(payload)],
  });
}

/** Offline only. Caller owns the stopped directory and a complete backup before calling. */
export async function applyDatabaseUpgrade(
  client: Client,
  manifest: DatabaseUpgradeManifest,
  options: { migrationsFolder?: string } = {},
): Promise<{ sourceHash: string; manifestHash: string; versions: number; runs: number }> {
  const tx = await client.transaction('write');
  try {
    const original = await inspectDatabaseUpgrade(tx);
    validateManifest(manifest, original);
    const triggerFacts = inspectTriggerUpgrade(original.tables);
    const manifestHash = hash(manifest);
    await structuralMigrations(tx, options.migrationsFolder ?? MIGRATIONS);
    const inventory = await inspectDatabaseUpgrade(tx);
    const converted = new Map<string, LoopDefinition>();
    for (const row of inventory.tables.loop_versions ?? []) {
      const result = upgradeLoopCurrent(
        json(row.definition),
        manifest.versions[String(row.id)]?.resolutions ?? {},
      );
      if (!result.ok)
        throw new DatabaseUpgradeRequiredError('Unresolved version conversion: ' + String(row.id));
      converted.set(String(row.id), result.value);
    }
    await tx.execute(STATE_SQL);
    await tx.execute(ARCHIVE_SQL);
    await archive(tx, 'manifest', manifestHash, manifest, original.sourceHash, manifestHash);
    for (const [name, values] of Object.entries(original.tables))
      if (
        [
          'loop_versions',
          'runs',
          'run_events',
          'settings',
          'webhook_endpoints',
          'inbound_events',
          'webhook_receipts',
        ].includes(name)
      )
        for (const row of values)
          await archive(
            tx,
            name,
            name === 'run_events'
              ? String(row.run_id) + ':' + String(row.seq)
              : typeof row.id === 'string'
                ? row.id
                : stableStringify([row.owner_id, row.key]),
            row,
            original.sourceHash,
            manifestHash,
          );
    for (const row of inventory.tables.loop_versions ?? []) {
      const definition = converted.get(String(row.id))!;
      await tx.execute({
        sql: 'UPDATE loop_versions SET definition=? WHERE id=?',
        args: [JSON.stringify(definition), String(row.id)],
      });
    }
    for (const key of triggerFacts.keys) {
      await tx.execute({
        sql: 'UPDATE inbound_events SET dedupe_key=? WHERE id=?',
        args: [key.next, key.inboundId],
      });
      for (const runId of key.runIds) {
        const run = (inventory.tables.runs ?? []).find((row) => row.id === runId);
        if (!run)
          throw new DatabaseUpgradeRequiredError('Linked webhook run vanished during conversion');
        run.initial_thread = JSON.stringify(
          rewriteWebhookThreadKey(json(run.initial_thread), key.previous, key.next),
        );
        if (run.thread_snapshot !== null && run.thread_snapshot !== undefined)
          run.thread_snapshot = JSON.stringify(
            rewriteWebhookThreadKey(json(run.thread_snapshot), key.previous, key.next),
          );
        for (const event of inventory.tables.run_events ?? []) {
          if (event.run_id !== runId || event.type !== 'run.queued') continue;
          const payload = json(event.payload);
          if (typeof payload === 'object' && payload !== null && 'initialThread' in payload) {
            payload.initialThread = rewriteWebhookThreadKey(
              payload.initialThread,
              key.previous,
              key.next,
            );
            event.payload = JSON.stringify(payload);
          }
        }
      }
    }
    const storedEvents = inventory.tables.run_events ?? [];
    for (const run of inventory.tables.runs ?? []) {
      const runId = String(run.id);
      const runEvents = storedEvents
        .filter((event) => event.run_id === run.id)
        .sort((a, b) => Number(a.seq) - Number(b.seq));
      const rawEvents = runEvents.map(eventOf);
      const decisionNodeIds = new Set(
        (converted.get(String(run.version_id))?.nodes ?? [])
          .filter((node) => node.kind === 'decision')
          .map((node) => node.id),
      );
      for (const event of rawEvents)
        if (event.type === 'decision.made' && typeof event.nodeId === 'string')
          decisionNodeIds.add(event.nodeId);
      const history = upgradeRunHistoryCurrent({
        sourceVersion: (
          json(
            (inventory.tables.loop_versions ?? []).find((version) => version.id === run.version_id)!
              .definition,
          ) as { schemaVersion: 1 | 2 | 3 }
        ).schemaVersion,
        initialThread: json(run.initial_thread),
        events: rawEvents,
        decisionNodeIds: [...decisionNodeIds],
        ...(run.thread_snapshot !== null && run.thread_snapshot !== undefined
          ? { snapshot: json(run.thread_snapshot) }
          : {}),
        ...(typeof run.thread_snapshot_seq === 'number'
          ? { snapshotSeq: run.thread_snapshot_seq }
          : {}),
      });
      if (!history.ok)
        throw new DatabaseUpgradeRequiredError(
          'Run history/replay conversion refused: ' + runId + ': ' + history.issues[0]?.message,
        );
      let failure = run.failure;
      if (manifest.failedRuns[runId])
        failure = JSON.stringify(
          upgradedFailure(json(run.failure), {
            approvedAt: manifest.approvedAt,
            reason: manifest.failedRuns[runId].reason,
            version: 3,
          }),
        );
      await tx.execute({
        sql: 'UPDATE runs SET initial_thread=?,thread_snapshot=?,failure=? WHERE id=?',
        args: [
          JSON.stringify(history.value.initialThread),
          history.value.snapshot ? JSON.stringify(history.value.snapshot) : null,
          failure as string | null,
          runId,
        ],
      });
      for (const event of history.value.events) {
        const {
          runId: _runId,
          seq,
          ts: _ts,
          type: _type,
          nodeId: _nodeId,
          ...payload
        } = event as unknown as RawRow;
        if (event.type === 'run.failed' && manifest.failedRuns[runId])
          payload.failure = upgradedFailure(event.failure, {
            approvedAt: manifest.approvedAt,
            reason: manifest.failedRuns[runId].reason,
            version: 3,
          });
        await tx.execute({
          sql: 'UPDATE run_events SET payload=? WHERE run_id=? AND seq=?',
          args: [JSON.stringify(payload), runId, Number(seq)],
        });
      }
    }
    const ownerRows = inventory.tables.settings ?? [];
    const owners = new Set(
      ownerRows
        .filter((row) => row.key === 'defaultModel' || row.key === 'defaultEffort')
        .map((row) => String(row.owner_id)),
    );
    for (const ownerId of owners) {
      const defaults: Record<string, unknown> = {};
      for (const row of ownerRows.filter((entry) => entry.owner_id === ownerId)) {
        if (row.key === 'defaultModel') defaults.model = json(row.value);
        if (row.key === 'defaultEffort') defaults.effort = json(row.value);
      }
      const result = upgradeDefaultsV1(defaults);
      if (!result.ok || ownerRows.some((row) => row.owner_id === ownerId && row.key === 'defaults'))
        throw new DatabaseUpgradeRequiredError('Owner default conversion refused');
      await tx.execute({
        sql: 'INSERT INTO settings (owner_id,key,value,updated_at) VALUES (?,?,?,?)',
        args: [ownerId, 'defaults', JSON.stringify(result.value), manifest.approvedAt],
      });
      await tx.execute({
        sql: "DELETE FROM settings WHERE owner_id=? AND key IN ('defaultModel','defaultEffort')",
        args: [ownerId],
      });
    }
    await tx.execute({
      sql: "INSERT OR REPLACE INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,3,'complete',?,?)",
      args: [original.sourceHash, manifestHash],
    });
    await guardDatabaseUpgrade(tx);
    // Validate every stored event again through the clean parser before the single atomic commit.
    for (const row of await rows(tx, 'SELECT * FROM run_events ORDER BY run_id,seq'))
      RunEventSchema.parse(eventOf(row));
    for (const row of await rows(tx, 'SELECT * FROM runs')) {
      RunRecordSchema.parse(recordOf(row));
      ContextThreadSchema.parse(json(row.initial_thread));
      if (row.thread_snapshot !== null) ContextThreadSchema.parse(json(row.thread_snapshot));
    }
    await tx.commit();
    return {
      sourceHash: original.sourceHash,
      manifestHash,
      versions: converted.size,
      runs: (inventory.tables.runs ?? []).length,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
