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
  upgradeLoopV1,
  upgradeRunHistoryV1,
  upgradedFailure,
  upgradeDefaultsV1,
  validateUpgradeResolutions,
  type UpgradeIssue,
  type UpgradeResolutions,
} from '@graphgoblin/domain';

type Executor = Pick<Client, 'execute'>;
type RawRow = Record<string, unknown>;
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
  if (states.length !== 1 || states[0]?.format_version !== 2 || states[0]?.status !== 'complete')
    throw new DatabaseUpgradeRequiredError(
      'The offline upgrade is incomplete; restore the backup or finish its approved manifest',
    );
  for (const row of names.includes('loop_versions')
    ? await rows(client, 'SELECT definition FROM loop_versions')
    : []) {
    try {
      LoopDefinitionSchema.parse(json(row.definition));
    } catch {
      throw new DatabaseUpgradeRequiredError('A stored loop version is not strict v2');
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
    "INSERT INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,2,'complete','fresh','fresh')",
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
      const result = upgradeLoopV1(definition);
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
        decisions.length ||
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
          ))
      )
        affected.add(String(row.id));
      versions.push({
        id: String(row.id),
        loopId: String(row.loop_id),
        definitionHash: hash(definition),
        issues: result.ok ? [] : result.issues,
        decisions,
      });
    } catch {
      issues.push({
        code: 'UPGRADE_STORED_JSON_INVALID',
        path: '/loop_versions/' + String(row.id),
        message: 'definition cannot be inventoried',
      });
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
          events.some((event) => event.run_id === run.id && event.type === 'decision.made')),
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
  return { sourceHash: hash(stored), tables: stored, versions, failedRuns, blockedRuns, issues };
}

export interface DatabaseUpgradeManifest {
  format: 'graphgoblin-upgrade-manifest';
  targetVersion: 2;
  sourceHash: string;
  approvedBy: string;
  approvedAt: string;
  versions: Record<string, { definitionHash: string; resolutions: UpgradeResolutions }>;
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
        validateUpgradeResolutions(version.resolutions).length > 0,
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
    manifest.targetVersion !== 2 ||
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
    const manifestHash = hash(manifest);
    await structuralMigrations(tx, options.migrationsFolder ?? MIGRATIONS);
    const inventory = await inspectDatabaseUpgrade(tx);
    const converted = new Map<string, LoopDefinition>();
    for (const row of inventory.tables.loop_versions ?? []) {
      const result = upgradeLoopV1(
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
      if (['loop_versions', 'runs', 'run_events', 'settings'].includes(name))
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
      const history = upgradeRunHistoryV1({
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
      sql: "INSERT OR REPLACE INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,2,'complete',?,?)",
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
