import { createTriggerUpgradeInspector, rewriteWebhookThreadKey } from './trigger-upgrade.js';
import { createHash } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import {
  currentStoreReadiness,
  SHIPPED_MIGRATIONS,
  storeStructure,
  normalizeStoreSql,
} from './readiness.js';
import {
  rows,
  tableNames as tables,
  tableBatches,
  hashUpgradeStore,
  canonicalUpgradeRows,
  quote,
} from './upgrade-scan.js';
import type { Client, Transaction } from '@libsql/client';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import {
  CURRENT_DEFINITION_FORMAT,
  ContextThreadSchema,
  HarnessDefaultsSchema,
  HeaderNameSchema,
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
const MIGRATIONS = SHIPPED_MIGRATIONS;
const NONTERMINAL = new Set(['queued', 'running', 'waiting', 'paused']);
const hash = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');
function json(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('stored JSON column is not text');
  return JSON.parse(value);
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
export async function guardDatabaseUpgrade(
  client: Executor,
  migrationsFolder = MIGRATIONS,
  options: { skipDefinitions?: boolean; phase?: 'baseline' | 'head' } = {},
): Promise<'fresh' | 'current'> {
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
  const readiness = await currentStoreReadiness(migrationsFolder);
  if (!names.includes('gg_upgrade_state')) throw new DatabaseUpgradeRequiredError();
  const states = await rows(client, 'SELECT * FROM gg_upgrade_state');
  if (
    states.length !== 1 ||
    states[0]?.format_version !== readiness.marker.format_version ||
    states[0]?.status !== readiness.marker.status
  )
    throw new DatabaseUpgradeRequiredError(
      'The offline upgrade is incomplete; restore the backup or finish its approved manifest',
    );
  const structure = await storeStructure(client);
  for (const table of readiness[options.phase ?? 'baseline']) {
    const actual = structure.find((stored) => stored.name === table.name);
    if (!actual)
      throw new DatabaseUpgradeRequiredError('Missing current-store table: ' + table.name);
    if (
      table.columns.some(
        (column) =>
          !actual.columns.some(
            (stored) =>
              stored.name === column.name &&
              stored.notNull === column.notNull &&
              stored.pk === column.pk,
          ),
      )
    )
      throw new DatabaseUpgradeRequiredError('Incomplete current-store columns: ' + table.name);
    if (
      table.checks.some((check) => !actual.checks.includes(check)) ||
      table.constraints.some((constraint) => !actual.constraints.includes(constraint))
    )
      throw new DatabaseUpgradeRequiredError('Stored constraints are incomplete: ' + table.name);
    if (
      table.indexes.some(
        (index) =>
          !actual.indexes.some(
            (stored) =>
              stored.name === index.name &&
              normalizeStoreSql(stored.sql) === normalizeStoreSql(index.sql),
          ),
      )
    )
      throw new DatabaseUpgradeRequiredError('Stored indexes are incomplete: ' + table.name);
    if (
      options.phase === 'head' &&
      (actual.columns.length !== table.columns.length ||
        actual.checks.length !== table.checks.length ||
        actual.constraints.length !== table.constraints.length ||
        actual.indexes.length !== table.indexes.length)
    )
      throw new DatabaseUpgradeRequiredError(
        'Stored structure differs from the migration head: ' + table.name,
      );
  }
  const ledger = names.includes('__drizzle_migrations')
    ? await rows(client, 'SELECT created_at FROM __drizzle_migrations ORDER BY created_at')
    : [];
  if (
    ledger.length <
      (options.phase === 'head' ? readiness.ledger.length : readiness.requiredLedgerLength) ||
    ledger.length > readiness.ledger.length ||
    ledger.some((entry, index) => Number(entry.created_at) !== readiness.ledger[index]?.created_at)
  )
    throw new DatabaseUpgradeRequiredError(
      'The shipped migration ledger is incomplete or inconsistent',
    );
  // An explicitly selected historical SQL catalogue can stop before 0013. The current baseline above
  // always requires auth_type before this data-level validation can be reached.
  if (
    structure
      .find((table) => table.name === 'webhook_endpoints')
      ?.columns.some((column) => column.name === 'auth_type')
  ) {
    const malformed = await rows(
      client,
      `SELECT id FROM webhook_endpoints WHERE auth_type IS NULL OR NOT (("auth_type" = 'none' AND "signature_message" IS NULL AND "signature_header" IS NULL AND "secret_ref" IS NULL AND "window_seconds" IS NULL) OR ("auth_type" = 'hmac-sha256' AND "signature_header" IS NOT NULL AND "secret_ref" IS NOT NULL AND (("signature_message" IS NOT NULL AND "signature_message" = 'body' AND "window_seconds" IS NULL) OR ("signature_message" IS NOT NULL AND "signature_message" = 'timestamp-body' AND "window_seconds" IS NOT NULL AND typeof("window_seconds") = 'integer' AND "window_seconds" BETWEEN 1 AND 86400))))`,
    );
    if (malformed.length)
      throw new DatabaseUpgradeRequiredError('Stored webhook signing fields are inconsistent');
    const signingHeaders = await rows(
      client,
      "SELECT signature_header FROM webhook_endpoints WHERE auth_type = 'hmac-sha256'",
    );
    if (signingHeaders.some((row) => !HeaderNameSchema.safeParse(row.signature_header).success))
      throw new DatabaseUpgradeRequiredError(
        'Stored webhook signing headers are not lowercase RFC tokens',
      );
  }
  if (!options.skipDefinitions)
    for await (const batch of tableBatches(client, 'loop_versions'))
      for (const row of batch) {
        try {
          LoopDefinitionSchema.parse(json(row.definition));
        } catch {
          throw new DatabaseUpgradeRequiredError(
            'A stored loop version is not strict current format',
          );
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
/** After ordinary migrations, require the entire shipped catalogue and ledger. No second parse. */
export async function verifyDatabaseHead(
  client: Executor,
  migrationsFolder = MIGRATIONS,
): Promise<void> {
  if (
    (await guardDatabaseUpgrade(client, migrationsFolder, {
      phase: 'head',
      skipDefinitions: true,
    })) !== 'current'
  )
    throw new DatabaseUpgradeRequiredError('Migrations did not produce a current store');
}
const STATE_SQL =
  'CREATE TABLE IF NOT EXISTS gg_upgrade_state (id INTEGER PRIMARY KEY CHECK(id=1), format_version INTEGER NOT NULL, status TEXT NOT NULL, source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL)';
const ARCHIVE_SQL =
  'CREATE TABLE IF NOT EXISTS gg_upgrade_archive (kind TEXT NOT NULL, identity TEXT NOT NULL, source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,identity,manifest_hash))';
/** Schema, migration ledger and complete marker must commit together on first startup. */
export async function initializeFreshDatabase(
  client: Client,
  migrationsFolder = MIGRATIONS,
): Promise<'fresh' | 'current'> {
  const tx = await client.transaction('write');
  try {
    // Recheck under the write lock: only an empty store may be initialised, even if another
    // caller changed it after startup's first guard. Never authenticate an unmarked schema.
    const upgradeState = await guardDatabaseUpgrade(tx);
    if (upgradeState === 'fresh') {
      // Drizzle's libsql migrator commits its own batch; use the offline apply's SQL runner
      // so neither the schema nor its ledger can survive without the complete marker.
      await structuralMigrations(tx, migrationsFolder);
      await tx.execute(STATE_SQL);
      await tx.execute({
        sql: "INSERT INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,?,'complete','fresh','fresh')",
        args: [CURRENT_DEFINITION_FORMAT],
      });
    }
    await tx.commit();
    return upgradeState;
  } catch (error) {
    try {
      await tx.rollback();
    } catch {
      // A lost connection must not replace the failure that interrupted initialisation.
    }
    throw error;
  } finally {
    tx.close();
  }
}

export interface DatabaseUpgradeInventory {
  sourceHash: string;
  tableCounts: Record<string, number>;
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
/** The small definition/signing provenance working set; histories are read by indexed run ID.
 * Pending receipts need only their identity/status. Other runs are not retained here. */
async function upgradeContext(
  client: Executor,
  names: string[],
): Promise<Record<string, RawRow[]>> {
  const stored: Record<string, RawRow[]> = {};
  for (const name of ['loops', 'loop_versions', 'settings', 'webhook_endpoints']) {
    const found = names.includes(name) ? await rows(client, 'SELECT * FROM ' + quote(name)) : [];
    stored[name] = found
      .map((row) => ({ row, key: stableStringify(row) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ row }) => row);
  }
  // These first canonical keys precede the unique id in the original full-row sort.
  stored.webhook_receipts = names.includes('webhook_receipts')
    ? (
        await rows(
          client,
          "SELECT attempts,content_hash,failure_code,id,status FROM webhook_receipts WHERE status='pending' ORDER BY attempts,content_hash,failure_code,id",
        )
      )
        .map((row) => ({ row, key: stableStringify(row) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map(({ row }) => row)
    : [];
  stored.runs =
    names.includes('runs') && names.includes('webhook_endpoints')
      ? await rows(
          client,
          'SELECT id,owner_id,loop_id,version_id,initial_thread FROM runs WHERE loop_id IN (SELECT loop_id FROM webhook_endpoints) ORDER BY id',
        )
      : [];
  return stored;
}
/** Inbound deliveries are streamed; the projected canonical prefix dedupe_key/id has the
 * same total order as the old full rows because id is unique and precedes omitted fields. */
async function inspectStoredTriggers(
  client: Executor,
  names: string[],
  context: Record<string, RawRow[]>,
) {
  const inspector = createTriggerUpgradeInspector(context);
  if (names.includes('inbound_events'))
    for await (const serialized of canonicalUpgradeRows(
      tableBatches(client, 'inbound_events', undefined, {
        columns: 'dedupe_key,id,owner_id,type,source,run_ids',
        where: "type='webhook' AND source LIKE 'webhook:%'",
      }),
    ))
      inspector.inspectEvent(JSON.parse(serialized) as RawRow);
  return inspector.facts;
}
/** Whole stopped database, including hidden/deleted versions, orphaned runs and all owners. */
export async function inspectDatabaseUpgrade(client: Executor): Promise<DatabaseUpgradeInventory> {
  const names = (await tables(client)).filter(
    (name) => name !== 'gg_upgrade_state' && name !== 'gg_upgrade_archive',
  );
  const stored = await upgradeContext(client, names);
  const tableCounts: Record<string, number> = {};
  for (const name of names)
    tableCounts[name] = Number(
      (await rows(client, 'SELECT COUNT(*) AS count FROM ' + quote(name)))[0]!.count,
    );
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
  const versionIds = new Set((stored.loop_versions ?? []).map((row) => row.id));
  const failed: { id: string; key: string }[] = [];
  const blocked: { id: string; status: string; key: string }[] = [];
  if (names.includes('runs'))
    for await (const serialized of canonicalUpgradeRows(tableBatches(client, 'runs'))) {
      const run = JSON.parse(serialized) as RawRow;
      if (!versionIds.has(run.version_id))
        issues.push({
          code: 'UPGRADE_ORPHAN_RUN_VERSION',
          path: '/runs/' + String(run.id) + '/version_id',
          message:
            'run references no inventoried version; explicit repair is required before classifying historical outputs',
        });
      if (run.status === 'failed') {
        let needsDisposition = affected.has(String(run.version_id));
        if (!needsDisposition && names.includes('run_events')) {
          const events = await rows(
            client,
            "SELECT * FROM run_events WHERE run_id=? AND type IN ('decision.made','run.queued') ORDER BY seq",
            [String(run.id)],
          );
          needsDisposition = events.some(
            (event) => legacyDecisionEvent(event) || recordedAffectedChild(event, affected),
          );
        }
        if (needsDisposition) failed.push({ id: String(run.id), key: stableStringify(run) });
      }
      if (NONTERMINAL.has(String(run.status)))
        blocked.push({
          id: String(run.id),
          status: String(run.status),
          key: stableStringify(run),
        });
    }
  if (names.includes('run_events')) {
    const where = names.includes('runs')
      ? 'NOT EXISTS (SELECT 1 FROM runs WHERE runs.id=run_events.run_id)'
      : undefined;
    for await (const serialized of canonicalUpgradeRows(
      tableBatches(client, 'run_events', undefined, where ? { where } : {}),
    )) {
      const event = JSON.parse(serialized) as RawRow;
      issues.push({
        code: 'UPGRADE_ORPHAN_EVENTS',
        path: '/run_events/' + String(event.run_id),
        message: 'events have no run/initial thread; explicit repair is required before upgrade',
      });
    }
  }
  issues.push(...(await inspectStoredTriggers(client, names, stored)).issues);
  const compare = (a: { key: string }, b: { key: string }) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  return {
    sourceHash: await hashUpgradeStore(client, names),
    tableCounts,
    versions,
    failedRuns: failed.sort(compare).map(({ id }) => id),
    blockedRuns: blocked.sort(compare).map(({ id, status }) => ({ id, status })),
    issues,
  };
}

export interface DatabaseUpgradeManifest {
  format: 'graphgoblin-upgrade-manifest';
  targetVersion: typeof CURRENT_DEFINITION_FORMAT;
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
    manifest.targetVersion !== CURRENT_DEFINITION_FORMAT ||
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
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
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
    const sourceNames = await tables(tx);
    // Steps 26-28 replace this refusal with the real 3-to-4 conversion, deleting configured
    // instances, their loops and all their runs without an archive before structural SQL.
    const states = sourceNames.includes('gg_upgrade_state')
      ? await rows(tx, 'SELECT * FROM gg_upgrade_state')
      : [];
    if (
      states.length !== 1 ||
      states[0]?.id !== 1 ||
      states[0]?.format_version !== CURRENT_DEFINITION_FORMAT ||
      states[0]?.status !== 'complete' ||
      sourceNames.includes('template_instances') ||
      (sourceNames.includes('runs') &&
        (await rows(tx, 'PRAGMA table_info(runs)')).some(
          (column) => column.name === 'template_subject',
        ))
    )
      throw new DatabaseUpgradeRequiredError(
        'Format-3 to format-4 conversion is not available until the integrated cutover',
      );
    await guardDatabaseUpgrade(tx, options.migrationsFolder ?? MIGRATIONS, { phase: 'head' });
    let context = await upgradeContext(tx, sourceNames);
    const triggerFacts = await inspectStoredTriggers(tx, sourceNames, context);
    const manifestHash = hash(manifest);

    await tx.execute(STATE_SQL);
    await tx.execute(ARCHIVE_SQL);
    await archive(tx, 'manifest', manifestHash, manifest, original.sourceHash, manifestHash);
    for (const name of sourceNames)
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
        for await (const batch of tableBatches(tx, name))
          for (const row of batch)
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
    await structuralMigrations(tx, options.migrationsFolder ?? MIGRATIONS);
    context = await upgradeContext(tx, await tables(tx));
    const converted = new Map<string, LoopDefinition>();
    for (const row of context.loop_versions ?? []) {
      const result = upgradeLoopCurrent(
        json(row.definition),
        manifest.versions[String(row.id)]?.resolutions ?? {},
      );
      if (!result.ok)
        throw new DatabaseUpgradeRequiredError('Unresolved version conversion: ' + String(row.id));
      const current = LoopDefinitionSchema.safeParse(result.value);
      if (!current.success)
        throw new DatabaseUpgradeRequiredError(
          'Format-3 to format-4 conversion is not available until the integrated cutover',
        );
      converted.set(String(row.id), current.data);
    }
    // Keep the original source format per version even after writing the converted definition.
    const sourceVersions = new Map(
      (context.loop_versions ?? []).map((row) => [
        String(row.id),
        (json(row.definition) as { schemaVersion: 1 | 2 | 3 }).schemaVersion,
      ]),
    );
    for (const row of context.loop_versions ?? []) {
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
    }
    let runCount = 0;
    const rewrittenKeys = new Map(
      triggerFacts.keys.flatMap((key) => key.runIds.map((id) => [id, key] as const)),
    );
    for await (const batch of tableBatches(tx, 'runs'))
      for (const run of batch) {
        runCount += 1;
        const runId = String(run.id);
        const runEvents = await rows(tx, 'SELECT * FROM run_events WHERE run_id=? ORDER BY seq', [
          runId,
        ]);
        const key = rewrittenKeys.get(runId);
        if (key) {
          rewrittenKeys.delete(runId);
          run.initial_thread = JSON.stringify(
            rewriteWebhookThreadKey(json(run.initial_thread), key.previous, key.next),
          );
          if (run.thread_snapshot !== null && run.thread_snapshot !== undefined)
            run.thread_snapshot = JSON.stringify(
              rewriteWebhookThreadKey(json(run.thread_snapshot), key.previous, key.next),
            );
          for (const event of runEvents)
            if (event.type === 'run.queued') {
              const payload = json(event.payload);
              if (object(payload) && 'initialThread' in payload) {
                payload.initialThread = rewriteWebhookThreadKey(
                  payload.initialThread,
                  key.previous,
                  key.next,
                );
                event.payload = JSON.stringify(payload);
              }
            }
        }
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
          sourceVersion: sourceVersions.get(String(run.version_id))!,
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
        // Release transient native statements even when this batch contains many small runs.
        await yieldToEventLoop();
      }
    if (rewrittenKeys.size) throw new DatabaseUpgradeRequiredError('Linked webhook run vanished');
    const ownerRows = context.settings ?? [];
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
      sql: "INSERT OR REPLACE INTO gg_upgrade_state (id,format_version,status,source_hash,manifest_hash) VALUES (1,?,'complete',?,?)",
      args: [CURRENT_DEFINITION_FORMAT, original.sourceHash, manifestHash],
    });
    await guardDatabaseUpgrade(tx, options.migrationsFolder ?? MIGRATIONS);
    await verifyDatabaseHead(tx, options.migrationsFolder ?? MIGRATIONS);
    // Validate every stored event again through the clean parser before the single atomic commit.
    for await (const batch of tableBatches(tx, 'run_events'))
      for (const row of batch) RunEventSchema.parse(eventOf(row));
    for await (const batch of tableBatches(tx, 'runs'))
      for (const row of batch) {
        RunRecordSchema.parse(recordOf(row));
        ContextThreadSchema.parse(json(row.initial_thread));
        if (row.thread_snapshot !== null) ContextThreadSchema.parse(json(row.thread_snapshot));
      }
    await tx.commit();
    return {
      sourceHash: original.sourceHash,
      manifestHash,
      versions: converted.size,
      runs: runCount,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
